use std::any::type_name;

use super::{
    credentials::PlatformCredentialStore,
    lifecycle::{PlatformReminderWorker, PlatformSyncWorker},
    paths::AppDataPath,
};

#[test]
fn selects_a_platform_credential_store() {
    let name = type_name::<PlatformCredentialStore>();

    #[cfg(windows)]
    assert!(name.contains("WindowsCredentialStore"));

    #[cfg(target_os = "android")]
    assert!(name.contains("AndroidKeystoreStore"));

    #[cfg(all(not(windows), not(target_os = "android")))]
    assert!(name.contains("UnsupportedCredentialStore"));
}

#[test]
fn app_data_path_uses_the_application_private_database_name() {
    let path = AppDataPath::new("C:/taskdock-data");

    assert_eq!(
        path.database_path().file_name().unwrap(),
        "todo-app.sqlite3"
    );
    assert_eq!(path.database_path().parent().unwrap(), path.root());
}

#[cfg(target_os = "android")]
#[test]
fn mobile_workers_are_disabled() {
    assert!(PlatformSyncWorker::is_disabled());
    assert!(PlatformReminderWorker::is_disabled());
}

#[cfg(desktop)]
#[test]
fn desktop_worker_ports_are_enabled() {
    assert!(!PlatformSyncWorker::is_disabled());
    assert!(!PlatformReminderWorker::is_disabled());
}
