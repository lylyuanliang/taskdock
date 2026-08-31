use std::fmt::{Display, Formatter};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AppErrorKind {
    Validation,
    #[expect(dead_code, reason = "M2 AI 和 WebDAV 配置校验接入前预留配置错误分类")]
    Configuration,
    Conflict,
    NotFound,
    Storage,
    #[expect(dead_code, reason = "M2 后台同步失败映射接入前预留内部错误分类")]
    Internal,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AppError {
    code: &'static str,
    translation_key: &'static str,
    kind: AppErrorKind,
}

impl AppError {
    pub(crate) const fn new(
        code: &'static str,
        translation_key: &'static str,
        kind: AppErrorKind,
    ) -> Self {
        Self {
            code,
            translation_key,
            kind,
        }
    }

    pub const fn code(&self) -> &'static str {
        self.code
    }

    pub const fn translation_key(&self) -> &'static str {
        self.translation_key
    }
}

impl Display for AppError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "application error: {}", self.code)
    }
}

impl std::error::Error for AppError {}
