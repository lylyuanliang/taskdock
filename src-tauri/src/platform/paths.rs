use std::path::{Path, PathBuf};

use tauri::Manager;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct AppDataPath {
    root: PathBuf,
}

impl AppDataPath {
    pub(crate) fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub(crate) fn from_app_handle(app: &tauri::AppHandle) -> tauri::Result<Self> {
        Ok(Self::new(app.path().app_data_dir()?))
    }

    pub(crate) fn root(&self) -> &Path {
        &self.root
    }

    pub(crate) fn database_path(&self) -> PathBuf {
        self.root.join("todo-app.sqlite3")
    }
}
