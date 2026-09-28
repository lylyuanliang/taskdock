use super::android_keystore::{credential_slot, validate_key, validate_secret, ALLOWED_KEYS};

#[test]
fn accepts_only_the_webdav_credential_keys() {
    for key in ALLOWED_KEYS {
        assert!(validate_key(key).is_ok(), "key should be accepted: {key}");
    }

    assert!(validate_key("").is_err());
    assert!(validate_key("token").is_err());
    assert!(validate_key("password\n").is_err());
}

#[test]
fn maps_existing_sync_keys_to_fixed_android_slots() {
    assert_eq!(credential_slot("webdav:alice").unwrap(), "password");
    assert_eq!(
        credential_slot("encryption:alice").unwrap(),
        "encryption-passphrase"
    );
    assert!(credential_slot("webdav:").is_err());
}

#[test]
fn rejects_empty_secrets_without_echoing_the_value() {
    let error = validate_secret("").expect_err("empty secrets must be rejected");

    assert_eq!(error.code(), "sync.credential.failed");
    assert!(!format!("{error:?}").contains("password"));
}
