use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use rand::{rng, RngCore};
use zeroize::Zeroizing;

use crate::error::{AppError, AppErrorKind};

const ENVELOPE_VERSION: u8 = 1;
const SALT_LENGTH: usize = 16;
const NONCE_LENGTH: usize = 12;
const KEY_LENGTH: usize = 32;
const ARGON2_MEMORY_KIB: u32 = 19_456;
const ARGON2_ITERATIONS: u32 = 2;
const ARGON2_PARALLELISM: u32 = 1;
const CREDENTIAL_SERVICE: &str = "taskdock-webdav";

const ENCRYPTION_ERROR_CODE: &str = "sync.encryption.failed";
const ENCRYPTION_ERROR_KEY: &str = "errors.sync.encryption.failed";
const CREDENTIAL_ERROR_CODE: &str = "sync.credential.failed";
const CREDENTIAL_ERROR_KEY: &str = "errors.sync.credential.failed";

pub(crate) fn encrypt_snapshot(payload: &[u8], passphrase: &str) -> Result<String, AppError> {
    let salt = random_salt();
    let key = derive_key(passphrase, &salt)?;
    let mut nonce_bytes = [0_u8; NONCE_LENGTH];
    rng().fill_bytes(&mut nonce_bytes);
    let cipher = Aes256Gcm::new_from_slice(&key[..]).map_err(|_| encryption_error())?;
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), payload)
        .map_err(|_| encryption_error())?;

    let mut envelope = Vec::with_capacity(1 + SALT_LENGTH + NONCE_LENGTH + ciphertext.len());
    envelope.push(ENVELOPE_VERSION);
    envelope.extend_from_slice(&salt);
    envelope.extend_from_slice(&nonce_bytes);
    envelope.extend_from_slice(&ciphertext);

    Ok(BASE64.encode(envelope))
}

pub(crate) fn decrypt_snapshot(encoded: &str, passphrase: &str) -> Result<Vec<u8>, AppError> {
    let envelope = BASE64.decode(encoded).map_err(|_| encryption_error())?;
    let minimum_length = 1 + SALT_LENGTH + NONCE_LENGTH + 1;
    if envelope.len() < minimum_length || envelope[0] != ENVELOPE_VERSION {
        return Err(encryption_error());
    }

    let salt_start = 1;
    let nonce_start = salt_start + SALT_LENGTH;
    let salt = &envelope[salt_start..nonce_start];
    let nonce = &envelope[nonce_start..nonce_start + NONCE_LENGTH];
    let ciphertext = &envelope[nonce_start + NONCE_LENGTH..];
    let key = derive_key(passphrase, salt)?;
    let cipher = Aes256Gcm::new_from_slice(&key[..]).map_err(|_| encryption_error())?;

    cipher
        .decrypt(Nonce::from_slice(nonce), ciphertext)
        .map_err(|_| encryption_error())
}

pub(crate) trait CredentialStore: Send + Sync {
    fn save_secret(&self, key: &str, secret: &str) -> Result<(), AppError>;
    fn load_secret(&self, key: &str) -> Result<Option<String>, AppError>;
    fn delete_secret(&self, key: &str) -> Result<(), AppError>;
}

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct WindowsCredentialStore;

impl CredentialStore for WindowsCredentialStore {
    fn save_secret(&self, key: &str, secret: &str) -> Result<(), AppError> {
        let entry = keyring::Entry::new(CREDENTIAL_SERVICE, key).map_err(|_| credential_error())?;
        entry.set_password(secret).map_err(|_| credential_error())
    }

    fn load_secret(&self, key: &str) -> Result<Option<String>, AppError> {
        let entry = keyring::Entry::new(CREDENTIAL_SERVICE, key).map_err(|_| credential_error())?;
        match entry.get_password() {
            Ok(password) => Ok(Some(password)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(credential_error()),
        }
    }

    fn delete_secret(&self, key: &str) -> Result<(), AppError> {
        let entry = keyring::Entry::new(CREDENTIAL_SERVICE, key).map_err(|_| credential_error())?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(credential_error()),
        }
    }
}

fn derive_key(passphrase: &str, salt: &[u8]) -> Result<Zeroizing<[u8; KEY_LENGTH]>, AppError> {
    if passphrase.is_empty() || salt.len() != SALT_LENGTH {
        return Err(encryption_error());
    }
    let params = Params::new(
        ARGON2_MEMORY_KIB,
        ARGON2_ITERATIONS,
        ARGON2_PARALLELISM,
        Some(KEY_LENGTH),
    )
    .map_err(|_| encryption_error())?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = Zeroizing::new([0_u8; KEY_LENGTH]);
    argon2
        .hash_password_into(passphrase.as_bytes(), salt, key.as_mut())
        .map_err(|_| encryption_error())?;
    Ok(key)
}

fn random_salt() -> [u8; SALT_LENGTH] {
    let mut salt = [0_u8; SALT_LENGTH];
    rng().fill_bytes(&mut salt);
    salt
}

fn encryption_error() -> AppError {
    AppError::new(
        ENCRYPTION_ERROR_CODE,
        ENCRYPTION_ERROR_KEY,
        AppErrorKind::Encryption,
    )
}

fn credential_error() -> AppError {
    AppError::new(
        CREDENTIAL_ERROR_CODE,
        CREDENTIAL_ERROR_KEY,
        AppErrorKind::Configuration,
    )
}

#[cfg(test)]
mod tests {
    use super::{decrypt_snapshot, encrypt_snapshot};

    #[test]
    fn encrypt_then_decrypt_round_trips_without_exposing_plaintext() {
        let payload = br#"{"title":"private task"}"#;
        let encrypted = encrypt_snapshot(payload, "correct horse battery staple").unwrap();

        assert!(!encrypted.contains("private task"));
        assert_eq!(
            decrypt_snapshot(&encrypted, "correct horse battery staple").unwrap(),
            payload
        );
    }

    #[test]
    fn decrypt_rejects_wrong_password_and_tampering() {
        let encrypted = encrypt_snapshot(b"payload", "password").unwrap();
        assert!(decrypt_snapshot(&encrypted, "wrong password").is_err());

        let mut tampered = encrypted.into_bytes();
        let last = tampered.len() - 1;
        tampered[last] = if tampered[last] == b'A' { b'B' } else { b'A' };
        let tampered = String::from_utf8(tampered).unwrap();
        assert!(decrypt_snapshot(&tampered, "password").is_err());
    }

    #[test]
    fn empty_password_is_rejected() {
        assert!(encrypt_snapshot(b"payload", "").is_err());
    }
}
