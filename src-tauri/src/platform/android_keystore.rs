use serde::Serialize;
use tauri::{
    plugin::{Builder, PluginApi, PluginHandle, TauriPlugin},
    AppHandle, Manager, Runtime, Wry,
};

use crate::{
    error::AppError,
    infrastructure::sync_crypto::{credential_error, CredentialStore},
};

pub(crate) const PLUGIN_NAME: &str = "taskdock-keystore";
const PLUGIN_IDENTIFIER: &str = "io.github.lylyuanliang.taskdock";
const PLUGIN_CLASS: &str = "TaskDockKeystorePlugin";
pub(crate) const ALLOWED_KEYS: &[&str] =
    &["endpoint", "account", "password", "encryption-passphrase"];

#[derive(Clone, Debug)]
pub(crate) struct AndroidKeystoreStore {
    handle: PluginHandle<Wry>,
}

impl AndroidKeystoreStore {
    pub(crate) fn from_app(app: &AppHandle<Wry>) -> Result<Self, AppError> {
        let handle = app
            .try_state::<PluginHandle<Wry>>()
            .ok_or_else(credential_error)?;

        Ok(Self {
            handle: (*handle).clone(),
        })
    }
}

#[derive(Serialize)]
struct SaveSecretRequest<'a> {
    key: &'a str,
    secret: &'a str,
}

#[derive(Serialize)]
struct SecretRequest<'a> {
    key: &'a str,
}

impl CredentialStore for AndroidKeystoreStore {
    fn save_secret(&self, key: &str, secret: &str) -> Result<(), AppError> {
        let key = credential_slot(key)?;
        validate_secret(secret)?;

        self.handle
            .run_mobile_plugin::<()>("saveSecret", SaveSecretRequest { key, secret })
            .map_err(|_| credential_error())
    }

    fn load_secret(&self, key: &str) -> Result<Option<String>, AppError> {
        let key = credential_slot(key)?;

        self.handle
            .run_mobile_plugin::<Option<String>>("loadSecret", SecretRequest { key })
            .map_err(|_| credential_error())
    }

    fn delete_secret(&self, key: &str) -> Result<(), AppError> {
        let key = credential_slot(key)?;

        self.handle
            .run_mobile_plugin::<()>("deleteSecret", SecretRequest { key })
            .map_err(|_| credential_error())
    }
}

pub(crate) fn validate_key(key: &str) -> Result<(), AppError> {
    credential_slot(key).map(|_| ())
}

pub(crate) fn credential_slot(key: &str) -> Result<&'static str, AppError> {
    match key {
        "endpoint" => return Ok("endpoint"),
        "account" => return Ok("account"),
        "password" => return Ok("password"),
        "encryption-passphrase" => return Ok("encryption-passphrase"),
        _ => {}
    }

    if key.starts_with("webdav:") && key.len() > "webdav:".len() {
        return Ok("password");
    }

    if key.starts_with("encryption:") && key.len() > "encryption:".len() {
        return Ok("encryption-passphrase");
    }

    Err(credential_error())
}

pub(crate) fn validate_secret(secret: &str) -> Result<(), AppError> {
    if secret.is_empty() {
        Err(credential_error())
    } else {
        Ok(())
    }
}

pub(crate) fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new(PLUGIN_NAME)
        .setup(|app, api: PluginApi<R, ()>| {
            #[cfg(target_os = "android")]
            {
                let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, PLUGIN_CLASS)?;
                app.manage(handle);
            }

            Ok(())
        })
        .build()
}
