use tauri::{Manager, Runtime, WebviewWindow, WebviewWindowBuilder};

pub(crate) trait MainWindowPort {
    fn set_focus(&mut self) -> Result<(), String>;
    fn show(&mut self) -> Result<(), String>;
    fn unminimize(&mut self) -> Result<(), String>;
}

pub(crate) trait MainWindowProvider {
    type Window: MainWindowPort;

    fn create_main_window(&self) -> Result<Self::Window, String>;
    fn get_main_window(&self) -> Option<Self::Window>;
}

impl<R: Runtime> MainWindowPort for WebviewWindow<R> {
    fn set_focus(&mut self) -> Result<(), String> {
        WebviewWindow::set_focus(self).map_err(|error| error.to_string())
    }

    fn show(&mut self) -> Result<(), String> {
        WebviewWindow::show(self).map_err(|error| error.to_string())
    }

    fn unminimize(&mut self) -> Result<(), String> {
        WebviewWindow::unminimize(self).map_err(|error| error.to_string())
    }
}

impl<R: Runtime> MainWindowProvider for tauri::AppHandle<R> {
    type Window = WebviewWindow<R>;

    fn create_main_window(&self) -> Result<Self::Window, String> {
        let config = self
            .config()
            .app
            .windows
            .iter()
            .find(|config| config.label == "main")
            .ok_or_else(|| "main window configuration is unavailable".to_string())?;

        WebviewWindowBuilder::from_config(self, config)
            .map_err(|error| error.to_string())?
            .build()
            .map_err(|error| error.to_string())
    }

    fn get_main_window(&self) -> Option<Self::Window> {
        self.get_webview_window("main")
    }
}

pub(crate) fn restore_main_window<W: MainWindowPort>(window: &mut W) -> Result<(), String> {
    window.unminimize()?;
    window.show()?;
    window.set_focus()
}

pub(crate) fn restore_main_window_for_provider<P: MainWindowProvider>(
    provider: &P,
) -> Result<(), String> {
    let mut window = match provider.get_main_window() {
        Some(window) => window,
        None => provider.create_main_window()?,
    };

    restore_main_window(&mut window)
}

pub(crate) async fn open_main_window_for_app(app: tauri::AppHandle) -> Result<(), String> {
    restore_main_window_for_provider(&app)
}

#[tauri::command]
pub(crate) async fn open_main_window(app: tauri::AppHandle) -> Result<(), String> {
    open_main_window_for_app(app).await
}

#[tauri::command]
pub(crate) fn exit_app(app: tauri::AppHandle) -> Result<(), String> {
    app.exit(0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{
        cell::{Cell, RefCell},
        rc::Rc,
    };

    use super::{
        restore_main_window, restore_main_window_for_provider, MainWindowPort, MainWindowProvider,
    };

    #[derive(Clone, Default)]
    struct FakeMainWindow {
        calls: Rc<RefCell<Vec<&'static str>>>,
        failure: Option<&'static str>,
    }

    impl MainWindowPort for FakeMainWindow {
        fn set_focus(&mut self) -> Result<(), String> {
            self.calls.borrow_mut().push("set_focus");
            self.result_for("set_focus")
        }

        fn show(&mut self) -> Result<(), String> {
            self.calls.borrow_mut().push("show");
            self.result_for("show")
        }

        fn unminimize(&mut self) -> Result<(), String> {
            self.calls.borrow_mut().push("unminimize");
            self.result_for("unminimize")
        }
    }

    impl FakeMainWindow {
        fn result_for(&self, operation: &'static str) -> Result<(), String> {
            match self.failure {
                Some(failure) if failure == operation => {
                    Err(format!("main window {operation} failed"))
                }
                _ => Ok(()),
            }
        }

        fn calls(&self) -> Vec<&'static str> {
            self.calls.borrow().clone()
        }
    }

    struct FakeMainWindowProvider {
        created_window: Result<FakeMainWindow, String>,
        create_requests: Cell<u8>,
        existing_window: Option<FakeMainWindow>,
    }

    impl MainWindowProvider for FakeMainWindowProvider {
        type Window = FakeMainWindow;

        fn create_main_window(&self) -> Result<Self::Window, String> {
            self.create_requests.set(self.create_requests.get() + 1);
            self.created_window.clone()
        }

        fn get_main_window(&self) -> Option<Self::Window> {
            self.existing_window.clone()
        }
    }

    #[test]
    fn restores_main_window_before_focusing_it() {
        let mut window = FakeMainWindow::default();

        restore_main_window(&mut window).expect("main window should restore");

        assert_eq!(window.calls(), vec!["unminimize", "show", "set_focus"]);
    }

    #[test]
    fn returns_the_first_window_operation_error() {
        let mut window = FakeMainWindow {
            failure: Some("show"),
            ..FakeMainWindow::default()
        };

        let error = restore_main_window(&mut window).expect_err("show failure should propagate");

        assert_eq!(error, "main window show failed");
        assert_eq!(window.calls(), vec!["unminimize", "show"]);
    }

    #[test]
    fn creates_and_focuses_the_main_window_when_its_existing_webview_was_closed() {
        let created_window = FakeMainWindow::default();
        let provider = FakeMainWindowProvider {
            created_window: Ok(created_window.clone()),
            create_requests: Cell::new(0),
            existing_window: None,
        };

        restore_main_window_for_provider(&provider)
            .expect("closed main window should be recreated before it is focused");

        assert_eq!(provider.create_requests.get(), 1);
        assert_eq!(
            created_window.calls(),
            vec!["unminimize", "show", "set_focus"]
        );
    }
}
