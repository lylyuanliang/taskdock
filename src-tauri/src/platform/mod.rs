#[cfg(target_os = "android")]
pub(crate) mod android_keystore;
pub(crate) mod credentials;
pub(crate) mod lifecycle;
pub(crate) mod paths;

#[cfg(test)]
mod mod_test;

#[cfg(all(test, target_os = "android"))]
mod android_keystore_test;
