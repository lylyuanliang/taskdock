#[cfg(all(not(windows), not(target_os = "android")))]
use crate::{error::AppError, infrastructure::sync_crypto::CredentialStore};

#[cfg(target_os = "android")]
pub(crate) use super::android_keystore::AndroidKeystoreStore;

#[cfg(windows)]
pub(crate) type PlatformCredentialStore =
    crate::infrastructure::sync_crypto::WindowsCredentialStore;

#[cfg(target_os = "android")]
pub(crate) type PlatformCredentialStore = AndroidKeystoreStore;

#[cfg(all(not(windows), not(target_os = "android")))]
pub(crate) type PlatformCredentialStore = UnsupportedCredentialStore;

#[cfg(all(not(windows), not(target_os = "android")))]
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct UnsupportedCredentialStore;

#[cfg(all(not(windows), not(target_os = "android")))]
impl CredentialStore for UnsupportedCredentialStore {
    fn save_secret(&self, _key: &str, _secret: &str) -> Result<(), AppError> {
        Err(crate::infrastructure::sync_crypto::credential_error())
    }

    fn load_secret(&self, _key: &str) -> Result<Option<String>, AppError> {
        Err(crate::infrastructure::sync_crypto::credential_error())
    }

    fn delete_secret(&self, _key: &str) -> Result<(), AppError> {
        Err(crate::infrastructure::sync_crypto::credential_error())
    }
}
