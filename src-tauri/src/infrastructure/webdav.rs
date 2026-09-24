use std::{future::Future, pin::Pin, time::Duration};

use reqwest::{header::CONTENT_TYPE, Client, Method, StatusCode};
use url::Url;

use crate::{
    domain::sync::SyncConfig,
    error::{AppError, AppErrorKind},
};

const SNAPSHOT_FILE_NAME: &str = "current.snapshot.enc";
const REMOTE_ERROR_CODE: &str = "sync.remote.unavailable";
const REMOTE_ERROR_KEY: &str = "errors.sync.remote.unavailable";
const AUTH_ERROR_CODE: &str = "sync.remote.authentication_failed";
const AUTH_ERROR_KEY: &str = "errors.sync.remote.authentication_failed";
const PATH_NOT_FOUND_ERROR_CODE: &str = "sync.remote.path_not_found";
const PATH_NOT_FOUND_ERROR_KEY: &str = "errors.sync.remote.path_not_found";
const METHOD_NOT_ALLOWED_ERROR_CODE: &str = "sync.remote.method_not_allowed";
const METHOD_NOT_ALLOWED_ERROR_KEY: &str = "errors.sync.remote.method_not_allowed";
const NETWORK_ERROR_CODE: &str = "sync.remote.network_unavailable";
const NETWORK_ERROR_KEY: &str = "errors.sync.remote.network_unavailable";
const TIMEOUT_ERROR_CODE: &str = "sync.remote.timeout";
const TIMEOUT_ERROR_KEY: &str = "errors.sync.remote.timeout";
const CONFIG_ERROR_CODE: &str = "sync.configuration.invalid";
const CONFIG_ERROR_KEY: &str = "errors.sync.configuration.invalid";

pub(crate) type TransportFuture<'a, T> =
    Pin<Box<dyn Future<Output = Result<T, AppError>> + Send + 'a>>;

pub(crate) trait WebDavTransport: Send + Sync {
    fn test_connection<'a>(
        &'a self,
        config: &'a SyncConfig,
        password: &'a str,
    ) -> TransportFuture<'a, ()>;
    fn fetch_snapshot<'a>(
        &'a self,
        config: &'a SyncConfig,
        password: &'a str,
    ) -> TransportFuture<'a, Option<Vec<u8>>>;
    fn store_snapshot<'a>(
        &'a self,
        config: &'a SyncConfig,
        password: &'a str,
        payload: &'a [u8],
    ) -> TransportFuture<'a, ()>;
}

#[derive(Clone)]
pub(crate) struct WebDavClient {
    client: Client,
}

impl WebDavClient {
    pub(crate) fn new() -> Result<Self, AppError> {
        let client = Client::builder()
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(|_| remote_error())?;
        Ok(Self { client })
    }

    fn remote_directory_url(config: &SyncConfig) -> Result<Url, AppError> {
        Self::remote_directory_urls(config)?
            .pop()
            .ok_or_else(configuration_error)
    }

    fn remote_directory_urls(config: &SyncConfig) -> Result<Vec<Url>, AppError> {
        let mut url = Url::parse(config.endpoint.trim()).map_err(|_| configuration_error())?;
        if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
            return Err(configuration_error());
        }
        let endpoint_path = url.path().trim_end_matches('/');
        let directory = config.remote_directory.trim_matches('/');
        let mut urls = Vec::new();
        if directory.is_empty() {
            url.set_path(&format!("{endpoint_path}/"));
            urls.push(url);
            return Ok(urls);
        }

        let mut path = endpoint_path.to_owned();
        for segment in directory.split('/').filter(|segment| !segment.is_empty()) {
            path.push('/');
            path.push_str(segment);
            let mut directory_url = url.clone();
            directory_url.set_path(&format!("{path}/"));
            urls.push(directory_url);
        }

        Ok(urls)
    }

    fn snapshot_url(config: &SyncConfig) -> Result<Url, AppError> {
        let mut url = Self::remote_directory_url(config)?;
        let path = format!("{}{}", url.path(), SNAPSHOT_FILE_NAME);
        url.set_path(&path);
        Ok(url)
    }

    async fn send_request(
        &self,
        method: Method,
        url: Url,
        username: &str,
        password: &str,
        body: Option<&[u8]>,
    ) -> Result<reqwest::Response, AppError> {
        let is_propfind = method.as_str() == "PROPFIND";
        let mut request = self
            .client
            .request(method, url)
            .basic_auth(username, Some(password));
        if is_propfind {
            request = request.header("Depth", "0");
        }
        if let Some(body) = body {
            request = request
                .header(CONTENT_TYPE, "application/octet-stream")
                .body(body.to_vec());
        }
        request.send().await.map_err(|error| {
            if error.is_timeout() {
                timeout_error()
            } else if error.is_connect() {
                network_error()
            } else {
                remote_error()
            }
        })
    }

    async fn ensure_remote_directory(
        &self,
        config: &SyncConfig,
        password: &str,
    ) -> Result<(), AppError> {
        let method = Method::from_bytes(b"PROPFIND").map_err(|_| remote_error())?;
        let make_collection = Method::from_bytes(b"MKCOL").map_err(|_| remote_error())?;
        for url in Self::remote_directory_urls(config)? {
            let response = self
                .send_request(
                    method.clone(),
                    url.clone(),
                    &config.username,
                    password,
                    None,
                )
                .await?;
            if response.status() == StatusCode::NOT_FOUND {
                let response = self
                    .send_request(
                        make_collection.clone(),
                        url,
                        &config.username,
                        password,
                        None,
                    )
                    .await?;
                Self::validate_response(&response)?;
            } else {
                Self::validate_response(&response)?;
            }
        }

        Ok(())
    }

    fn validate_response(response: &reqwest::Response) -> Result<(), AppError> {
        if response.status().is_success() {
            Ok(())
        } else {
            Err(error_for_status(response.status()))
        }
    }
}

impl WebDavTransport for WebDavClient {
    fn test_connection<'a>(
        &'a self,
        config: &'a SyncConfig,
        password: &'a str,
    ) -> TransportFuture<'a, ()> {
        Box::pin(async move {
            let url = Self::remote_directory_url(config)?;
            let response = self
                .send_request(
                    Method::from_bytes(b"PROPFIND").map_err(|_| remote_error())?,
                    url,
                    &config.username,
                    password,
                    None,
                )
                .await?;
            Self::validate_response(&response)
        })
    }

    fn fetch_snapshot<'a>(
        &'a self,
        config: &'a SyncConfig,
        password: &'a str,
    ) -> TransportFuture<'a, Option<Vec<u8>>> {
        Box::pin(async move {
            let url = Self::snapshot_url(config)?;
            let response = self
                .send_request(Method::GET, url, &config.username, password, None)
                .await?;
            if response.status() == StatusCode::NOT_FOUND {
                return Ok(None);
            }
            Self::validate_response(&response)?;
            response
                .bytes()
                .await
                .map(|bytes| Some(bytes.to_vec()))
                .map_err(|_| remote_error())
        })
    }

    fn store_snapshot<'a>(
        &'a self,
        config: &'a SyncConfig,
        password: &'a str,
        payload: &'a [u8],
    ) -> TransportFuture<'a, ()> {
        Box::pin(async move {
            self.ensure_remote_directory(config, password).await?;
            let url = Self::snapshot_url(config)?;
            let response = self
                .send_request(Method::PUT, url, &config.username, password, Some(payload))
                .await?;
            Self::validate_response(&response)
        })
    }
}

fn configuration_error() -> AppError {
    AppError::new(
        CONFIG_ERROR_CODE,
        CONFIG_ERROR_KEY,
        AppErrorKind::Configuration,
    )
}

fn remote_error() -> AppError {
    AppError::new(REMOTE_ERROR_CODE, REMOTE_ERROR_KEY, AppErrorKind::Remote)
}

fn authentication_error() -> AppError {
    AppError::new(AUTH_ERROR_CODE, AUTH_ERROR_KEY, AppErrorKind::Remote)
}

fn path_not_found_error() -> AppError {
    AppError::new(
        PATH_NOT_FOUND_ERROR_CODE,
        PATH_NOT_FOUND_ERROR_KEY,
        AppErrorKind::Remote,
    )
}

fn method_not_allowed_error() -> AppError {
    AppError::new(
        METHOD_NOT_ALLOWED_ERROR_CODE,
        METHOD_NOT_ALLOWED_ERROR_KEY,
        AppErrorKind::Remote,
    )
}

fn network_error() -> AppError {
    AppError::new(NETWORK_ERROR_CODE, NETWORK_ERROR_KEY, AppErrorKind::Remote)
}

fn timeout_error() -> AppError {
    AppError::new(TIMEOUT_ERROR_CODE, TIMEOUT_ERROR_KEY, AppErrorKind::Remote)
}

fn error_for_status(status: StatusCode) -> AppError {
    match status {
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => authentication_error(),
        StatusCode::NOT_FOUND => path_not_found_error(),
        StatusCode::METHOD_NOT_ALLOWED => method_not_allowed_error(),
        _ => remote_error(),
    }
}

#[cfg(test)]
mod tests {
    use super::{configuration_error, error_for_status, WebDavClient};
    use crate::domain::sync::{SyncConfig, SyncFrequency, SyncStrategy};
    use reqwest::StatusCode;

    fn config(endpoint: &str, directory: &str) -> SyncConfig {
        SyncConfig {
            endpoint: endpoint.to_owned(),
            remote_directory: directory.to_owned(),
            username: "user".to_owned(),
            encryption_enabled: true,
            paused: false,
            strategy: SyncStrategy::SmartMerge,
            frequency: SyncFrequency::FiveMinutes,
        }
    }

    #[test]
    fn builds_webdav_paths_without_dropping_endpoint_prefix() {
        let url = WebDavClient::snapshot_url(&config("https://dav.example.test/base", "Task Dock"))
            .unwrap();

        assert_eq!(
            url.as_str(),
            "https://dav.example.test/base/Task%20Dock/current.snapshot.enc"
        );
    }

    #[test]
    fn builds_each_nested_directory_for_first_upload() {
        let urls = WebDavClient::remote_directory_urls(&config(
            "https://dav.example.test/base",
            "Task Dock/Archive",
        ))
        .unwrap();

        assert_eq!(
            urls.into_iter()
                .map(|url| url.as_str().to_owned())
                .collect::<Vec<_>>(),
            vec![
                "https://dav.example.test/base/Task%20Dock/",
                "https://dav.example.test/base/Task%20Dock/Archive/",
            ]
        );
    }

    #[test]
    fn rejects_non_http_endpoints() {
        assert_eq!(
            WebDavClient::snapshot_url(&config("file:///tmp", "todo"))
                .unwrap_err()
                .code(),
            configuration_error().code()
        );
    }

    #[test]
    fn classifies_webdav_authentication_failures() {
        assert_eq!(
            error_for_status(StatusCode::UNAUTHORIZED).code(),
            "sync.remote.authentication_failed"
        );
        assert_eq!(
            error_for_status(StatusCode::FORBIDDEN).code(),
            "sync.remote.authentication_failed"
        );
    }

    #[test]
    fn classifies_missing_paths_and_unsupported_methods() {
        assert_eq!(
            error_for_status(StatusCode::NOT_FOUND).code(),
            "sync.remote.path_not_found"
        );
        assert_eq!(
            error_for_status(StatusCode::METHOD_NOT_ALLOWED).code(),
            "sync.remote.method_not_allowed"
        );
    }
}
