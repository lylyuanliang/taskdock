use std::{
    fs::{self, OpenOptions},
    io::{self, ErrorKind, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::{
    Manager, Monitor, PhysicalPosition as TauriPhysicalPosition, PhysicalSize as TauriPhysicalSize,
    Position, Runtime, Size, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

const COLLAPSED_SIZE: LogicalSize = LogicalSize::new(44.0, 44.0);
const EXPANDED_WIDTH: f64 = 320.0;
const EXPANDED_MAX_HEIGHT: f64 = 480.0;
const MOVED_DEBOUNCE: Duration = Duration::from_millis(140);
const PREFERENCES_FILE_NAME: &str = "quick-panel-preferences.json";
const PREFERENCES_VERSION: u8 = 2;

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum QuickPanelBehavior {
    #[default]
    Hover,
    Click,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum QuickPanelMode {
    Collapsed,
    Expanded,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
pub(crate) struct LogicalPosition {
    pub(crate) x: f64,
    pub(crate) y: f64,
}

impl LogicalPosition {
    pub(crate) const fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct LogicalSize {
    pub(crate) width: f64,
    pub(crate) height: f64,
}

impl LogicalSize {
    pub(crate) const fn new(width: f64, height: f64) -> Self {
        Self { width, height }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct PhysicalPoint {
    pub(crate) x: i32,
    pub(crate) y: i32,
}

impl PhysicalPoint {
    pub(crate) const fn new(x: i32, y: i32) -> Self {
        Self { x, y }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct PhysicalSize {
    pub(crate) width: u32,
    pub(crate) height: u32,
}

impl PhysicalSize {
    pub(crate) const fn new(width: u32, height: u32) -> Self {
        Self { width, height }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct PhysicalWorkArea {
    position: PhysicalPoint,
    size: PhysicalSize,
}

impl PhysicalWorkArea {
    pub(crate) const fn new(position: PhysicalPoint, size: PhysicalSize) -> Self {
        Self { position, size }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct MonitorDescriptor {
    id: String,
    scale_factor: f64,
    work_area: PhysicalWorkArea,
}

impl MonitorDescriptor {
    pub(crate) fn new(
        id: impl Into<String>,
        scale_factor: f64,
        work_area: PhysicalWorkArea,
    ) -> Self {
        Self {
            id: id.into(),
            scale_factor,
            work_area,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SavedPanelPosition {
    pub(crate) monitor_id: String,
    pub(crate) offset: LogicalPosition,
}

impl SavedPanelPosition {
    pub(crate) fn new(monitor_id: impl Into<String>, offset: LogicalPosition) -> Self {
        Self {
            monitor_id: monitor_id.into(),
            offset,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct WindowPlacement {
    pub(crate) monitor_id: String,
    pub(crate) position: PhysicalPoint,
    pub(crate) size: PhysicalSize,
}

struct MonitorInventory {
    available: Vec<MonitorDescriptor>,
    current_id: Option<String>,
    primary_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QuickPanelPreferences {
    pub(crate) behavior: QuickPanelBehavior,
    pub(crate) position: Option<SavedPanelPosition>,
    pub(crate) version: u8,
}

impl Default for QuickPanelPreferences {
    fn default() -> Self {
        Self {
            behavior: QuickPanelBehavior::Hover,
            position: None,
            version: PREFERENCES_VERSION,
        }
    }
}

#[derive(Clone)]
pub(crate) struct QuickPanelNativeState {
    mode: Arc<Mutex<QuickPanelMode>>,
    move_generation: Arc<AtomicU64>,
    preferences: Arc<Mutex<QuickPanelPreferences>>,
    preferences_path: PathBuf,
    programmatic_position: Arc<Mutex<Option<PhysicalPoint>>>,
}

impl QuickPanelNativeState {
    pub(crate) fn open(app_data_dir: &Path) -> io::Result<Self> {
        let preferences_path = app_data_dir.join(PREFERENCES_FILE_NAME);
        let preferences = load_preferences(&preferences_path);

        Ok(Self {
            mode: Arc::new(Mutex::new(QuickPanelMode::Collapsed)),
            move_generation: Arc::new(AtomicU64::new(0)),
            preferences: Arc::new(Mutex::new(preferences)),
            preferences_path,
            programmatic_position: Arc::new(Mutex::new(None)),
        })
    }

    pub(crate) fn preferences(&self) -> Result<QuickPanelPreferences, String> {
        self.preferences
            .lock()
            .map(|preferences| preferences.clone())
            .map_err(|_| "quick panel preferences are unavailable".to_string())
    }

    fn mode(&self) -> Result<QuickPanelMode, String> {
        self.mode
            .lock()
            .map(|mode| *mode)
            .map_err(|_| "quick panel mode is unavailable".to_string())
    }

    fn set_mode(&self, mode: QuickPanelMode) -> Result<(), String> {
        let mut current_mode = self
            .mode
            .lock()
            .map_err(|_| "quick panel mode is unavailable".to_string())?;
        *current_mode = mode;
        Ok(())
    }

    pub(crate) fn set_behavior(&self, behavior: QuickPanelBehavior) -> Result<(), String> {
        self.update_preferences(|preferences| preferences.behavior = behavior)
    }

    fn set_position(&self, position: SavedPanelPosition) -> Result<(), String> {
        self.update_preferences(|preferences| preferences.position = Some(position))
    }

    fn update_preferences(
        &self,
        update: impl FnOnce(&mut QuickPanelPreferences),
    ) -> Result<(), String> {
        let mut stored_preferences = self
            .preferences
            .lock()
            .map_err(|_| "quick panel preferences are unavailable".to_string())?;
        let mut candidate = stored_preferences.clone();
        update(&mut candidate);
        save_preferences(&self.preferences_path, &candidate).map_err(|error| error.to_string())?;
        *stored_preferences = candidate;
        Ok(())
    }

    fn next_move_generation(&self) -> u64 {
        self.move_generation.fetch_add(1, Ordering::SeqCst) + 1
    }

    fn is_latest_move(&self, generation: u64) -> bool {
        self.move_generation.load(Ordering::SeqCst) == generation
    }

    fn mark_programmatic_position(&self, position: PhysicalPoint) {
        if let Ok(mut expected_position) = self.programmatic_position.lock() {
            *expected_position = Some(position);
        }
    }

    fn consume_programmatic_position(&self, position: PhysicalPoint) -> bool {
        let Ok(mut expected_position) = self.programmatic_position.lock() else {
            return false;
        };

        if expected_position.as_ref() == Some(&position) {
            *expected_position = None;
            return true;
        }

        false
    }
}

pub(crate) fn panel_dimensions_for_monitor(
    mode: QuickPanelMode,
    monitor: &MonitorDescriptor,
) -> LogicalSize {
    match mode {
        QuickPanelMode::Collapsed => COLLAPSED_SIZE,
        QuickPanelMode::Expanded => LogicalSize::new(
            EXPANDED_WIDTH,
            EXPANDED_MAX_HEIGHT
                .min(f64::from(monitor.work_area.size.height) / valid_scale(monitor.scale_factor)),
        ),
    }
}

pub(crate) fn clamp_physical_position(
    position: PhysicalPoint,
    window_size: PhysicalSize,
    work_area: PhysicalWorkArea,
) -> PhysicalPoint {
    let minimum_x = i64::from(work_area.position.x);
    let minimum_y = i64::from(work_area.position.y);
    let maximum_x =
        (minimum_x + i64::from(work_area.size.width) - i64::from(window_size.width)).max(minimum_x);
    let maximum_y = (minimum_y + i64::from(work_area.size.height) - i64::from(window_size.height))
        .max(minimum_y);

    PhysicalPoint::new(
        clamp_i64_to_i32(i64::from(position.x).clamp(minimum_x, maximum_x)),
        clamp_i64_to_i32(i64::from(position.y).clamp(minimum_y, maximum_y)),
    )
}

pub(crate) fn save_position_for_monitor(
    position: PhysicalPoint,
    monitor: &MonitorDescriptor,
) -> SavedPanelPosition {
    let scale_factor = valid_scale(monitor.scale_factor);
    SavedPanelPosition::new(
        monitor.id.clone(),
        LogicalPosition::new(
            f64::from(position.x - monitor.work_area.position.x) / scale_factor,
            f64::from(position.y - monitor.work_area.position.y) / scale_factor,
        ),
    )
}

pub(crate) fn restore_saved_position(
    saved: &SavedPanelPosition,
    monitors: &[MonitorDescriptor],
    current_monitor_id: Option<&str>,
    primary_monitor_id: Option<&str>,
    logical_size: LogicalSize,
) -> Option<WindowPlacement> {
    let monitor = select_monitor(
        &saved.monitor_id,
        monitors,
        current_monitor_id,
        primary_monitor_id,
    )?;
    let scale_factor = valid_scale(monitor.scale_factor);
    let target = PhysicalPoint::new(
        clamp_f64_to_i32(f64::from(monitor.work_area.position.x) + saved.offset.x * scale_factor),
        clamp_f64_to_i32(f64::from(monitor.work_area.position.y) + saved.offset.y * scale_factor),
    );
    let size = logical_size_to_physical(logical_size, scale_factor);

    Some(WindowPlacement {
        monitor_id: monitor.id.clone(),
        position: clamp_physical_position(target, size, monitor.work_area),
        size,
    })
}

pub(crate) fn process_moved_position(
    position: PhysicalPoint,
    window_size: PhysicalSize,
    monitor: &MonitorDescriptor,
    state: &QuickPanelNativeState,
) -> Result<PhysicalPoint, String> {
    let clamped = clamp_physical_position(position, window_size, monitor.work_area);
    state.set_position(save_position_for_monitor(clamped, monitor))?;
    Ok(clamped)
}

fn select_monitor<'a>(
    saved_monitor_id: &str,
    monitors: &'a [MonitorDescriptor],
    current_monitor_id: Option<&str>,
    primary_monitor_id: Option<&str>,
) -> Option<&'a MonitorDescriptor> {
    monitors
        .iter()
        .find(|monitor| monitor.id == saved_monitor_id)
        .or_else(|| {
            current_monitor_id.and_then(|id| monitors.iter().find(|monitor| monitor.id == id))
        })
        .or_else(|| {
            primary_monitor_id.and_then(|id| monitors.iter().find(|monitor| monitor.id == id))
        })
        .or_else(|| monitors.first())
}

fn logical_size_to_physical(size: LogicalSize, scale_factor: f64) -> PhysicalSize {
    PhysicalSize::new(
        clamp_f64_to_u32(size.width * scale_factor),
        clamp_f64_to_u32(size.height * scale_factor),
    )
}

fn valid_scale(scale_factor: f64) -> f64 {
    if scale_factor.is_finite() && scale_factor > 0.0 {
        scale_factor
    } else {
        1.0
    }
}

fn clamp_f64_to_i32(value: f64) -> i32 {
    value
        .round()
        .clamp(f64::from(i32::MIN), f64::from(i32::MAX)) as i32
}

fn clamp_f64_to_u32(value: f64) -> u32 {
    value.round().clamp(0.0, f64::from(u32::MAX)) as u32
}

fn clamp_i64_to_i32(value: i64) -> i32 {
    value.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
}

fn load_preferences(path: &Path) -> QuickPanelPreferences {
    read_preferences(path)
        .or_else(|| read_preferences(&sibling_path(path, "backup")))
        .unwrap_or_default()
}

fn read_preferences(path: &Path) -> Option<QuickPanelPreferences> {
    let preferences = fs::read_to_string(path)
        .ok()
        .and_then(|contents| serde_json::from_str::<QuickPanelPreferences>(&contents).ok())?;

    (preferences.version == PREFERENCES_VERSION).then_some(preferences)
}

fn save_preferences(path: &Path, preferences: &QuickPanelPreferences) -> io::Result<()> {
    let serialized = serde_json::to_vec_pretty(preferences)
        .map_err(|error| io::Error::new(ErrorKind::InvalidData, error))?;
    let temporary_path = sibling_path(path, "temporary");
    let backup_path = sibling_path(path, "backup");

    if temporary_path.exists() {
        fs::remove_file(&temporary_path)?;
    }

    let write_result = (|| {
        let mut temporary_file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary_path)?;
        temporary_file.write_all(&serialized)?;
        temporary_file.sync_all()
    })();

    if let Err(error) = write_result {
        let _ = fs::remove_file(&temporary_path);
        return Err(error);
    }

    replace_preferences_file(path, &temporary_path, &backup_path)
}

fn replace_preferences_file(
    path: &Path,
    temporary_path: &Path,
    backup_path: &Path,
) -> io::Result<()> {
    if !path.exists() {
        return fs::rename(temporary_path, path);
    }

    if backup_path.exists() {
        fs::remove_file(backup_path)?;
    }
    fs::rename(path, backup_path)?;

    if let Err(error) = fs::rename(temporary_path, path) {
        let _ = fs::rename(backup_path, path);
        let _ = fs::remove_file(temporary_path);
        return Err(error);
    }

    fs::remove_file(backup_path)
}

fn sibling_path(path: &Path, suffix: &str) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(PREFERENCES_FILE_NAME);
    path.with_file_name(format!("{file_name}.{suffix}"))
}

pub(crate) trait QuickPanelWindowPort {
    fn available_monitors(&self) -> Result<Vec<MonitorDescriptor>, String>;
    fn current_monitor(&self) -> Result<Option<MonitorDescriptor>, String>;
    fn monitor_from_position(
        &self,
        position: PhysicalPoint,
    ) -> Result<Option<MonitorDescriptor>, String>;
    fn outer_position(&self) -> Result<PhysicalPoint, String>;
    fn outer_size(&self) -> Result<PhysicalSize, String>;
    fn primary_monitor(&self) -> Result<Option<MonitorDescriptor>, String>;
    fn set_physical_position(&self, position: PhysicalPoint) -> Result<(), String>;
    fn set_physical_size(&self, size: PhysicalSize) -> Result<(), String>;
}

impl<R: Runtime> QuickPanelWindowPort for WebviewWindow<R> {
    fn available_monitors(&self) -> Result<Vec<MonitorDescriptor>, String> {
        WebviewWindow::available_monitors(self)
            .map(|monitors| monitors.into_iter().map(monitor_descriptor).collect())
            .map_err(|error| error.to_string())
    }

    fn current_monitor(&self) -> Result<Option<MonitorDescriptor>, String> {
        WebviewWindow::current_monitor(self)
            .map(|monitor| monitor.map(monitor_descriptor))
            .map_err(|error| error.to_string())
    }

    fn monitor_from_position(
        &self,
        position: PhysicalPoint,
    ) -> Result<Option<MonitorDescriptor>, String> {
        WebviewWindow::monitor_from_point(self, f64::from(position.x), f64::from(position.y))
            .map(|monitor| monitor.map(monitor_descriptor))
            .map_err(|error| error.to_string())
    }

    fn outer_position(&self) -> Result<PhysicalPoint, String> {
        WebviewWindow::outer_position(self)
            .map(|position| PhysicalPoint::new(position.x, position.y))
            .map_err(|error| error.to_string())
    }

    fn outer_size(&self) -> Result<PhysicalSize, String> {
        WebviewWindow::outer_size(self)
            .map(|size| PhysicalSize::new(size.width, size.height))
            .map_err(|error| error.to_string())
    }

    fn primary_monitor(&self) -> Result<Option<MonitorDescriptor>, String> {
        WebviewWindow::primary_monitor(self)
            .map(|monitor| monitor.map(monitor_descriptor))
            .map_err(|error| error.to_string())
    }

    fn set_physical_position(&self, position: PhysicalPoint) -> Result<(), String> {
        WebviewWindow::set_position(
            self,
            Position::Physical(TauriPhysicalPosition::new(position.x, position.y)),
        )
        .map_err(|error| error.to_string())
    }

    fn set_physical_size(&self, size: PhysicalSize) -> Result<(), String> {
        WebviewWindow::set_size(
            self,
            Size::Physical(TauriPhysicalSize::new(size.width, size.height)),
        )
        .map_err(|error| error.to_string())
    }
}

fn monitor_descriptor(monitor: Monitor) -> MonitorDescriptor {
    let work_area = monitor.work_area();
    let id = monitor.name().cloned().unwrap_or_else(|| {
        format!(
            "monitor:{}:{}:{}:{}",
            monitor.position().x,
            monitor.position().y,
            monitor.size().width,
            monitor.size().height
        )
    });

    MonitorDescriptor::new(
        id,
        monitor.scale_factor(),
        PhysicalWorkArea::new(
            PhysicalPoint::new(work_area.position.x, work_area.position.y),
            PhysicalSize::new(work_area.size.width, work_area.size.height),
        ),
    )
}

fn monitor_inventory<W: QuickPanelWindowPort>(window: &W) -> Result<MonitorInventory, String> {
    let mut monitors = window.available_monitors()?;
    let current_monitor = window.current_monitor()?;
    let primary_monitor = window.primary_monitor()?;

    if let Some(monitor) = current_monitor.as_ref() {
        add_monitor_if_missing(&mut monitors, monitor.clone());
    }
    if let Some(monitor) = primary_monitor.as_ref() {
        add_monitor_if_missing(&mut monitors, monitor.clone());
    }

    Ok(MonitorInventory {
        available: monitors,
        current_id: current_monitor.map(|monitor| monitor.id),
        primary_id: primary_monitor.map(|monitor| monitor.id),
    })
}

fn add_monitor_if_missing(monitors: &mut Vec<MonitorDescriptor>, monitor: MonitorDescriptor) {
    if monitors.iter().all(|item| item.id != monitor.id) {
        monitors.push(monitor);
    }
}

fn target_monitor<W: QuickPanelWindowPort>(
    window: &W,
    position: PhysicalPoint,
) -> Result<MonitorDescriptor, String> {
    window
        .monitor_from_position(position)?
        .or(window.current_monitor()?)
        .or(window.primary_monitor()?)
        .or_else(|| window.available_monitors().ok()?.into_iter().next())
        .ok_or_else(|| "quick panel monitor is unavailable".to_string())
}

pub(crate) fn apply_quick_panel_mode<W: QuickPanelWindowPort>(
    window: &W,
    mode: QuickPanelMode,
    state: &QuickPanelNativeState,
) -> Result<(), String> {
    let current_position = window.outer_position()?;
    let monitor = target_monitor(window, current_position)?;
    let logical_size = panel_dimensions_for_monitor(mode, &monitor);
    let physical_size = logical_size_to_physical(logical_size, valid_scale(monitor.scale_factor));
    let clamped_position =
        clamp_physical_position(current_position, physical_size, monitor.work_area);

    window.set_physical_size(physical_size)?;
    if clamped_position != current_position {
        state.mark_programmatic_position(clamped_position);
        window.set_physical_position(clamped_position)?;
    }
    state.set_position(save_position_for_monitor(clamped_position, &monitor))?;
    state.set_mode(mode)
}

fn restore_window<W: QuickPanelWindowPort>(
    window: &W,
    state: &QuickPanelNativeState,
) -> Result<(), String> {
    let preferences = state.preferences()?;

    if let Some(saved_position) = preferences.position {
        let inventory = monitor_inventory(window)?;
        let selected_monitor = select_monitor(
            &saved_position.monitor_id,
            &inventory.available,
            inventory.current_id.as_deref(),
            inventory.primary_id.as_deref(),
        )
        .ok_or_else(|| "quick panel monitor is unavailable".to_string())?;
        let dimensions = panel_dimensions_for_monitor(QuickPanelMode::Collapsed, selected_monitor);
        let placement = restore_saved_position(
            &saved_position,
            &inventory.available,
            inventory.current_id.as_deref(),
            inventory.primary_id.as_deref(),
            dimensions,
        )
        .ok_or_else(|| "quick panel monitor is unavailable".to_string())?;

        state.set_position(SavedPanelPosition::new(
            placement.monitor_id.clone(),
            save_position_for_monitor(placement.position, selected_monitor).offset,
        ))?;
        window.set_physical_size(placement.size)?;
        state.mark_programmatic_position(placement.position);
        window.set_physical_position(placement.position)?;
        return Ok(());
    }

    apply_quick_panel_mode(window, QuickPanelMode::Collapsed, state)
}

pub(crate) fn build_quick_panel(
    app: &tauri::AppHandle,
    state: QuickPanelNativeState,
) -> tauri::Result<WebviewWindow> {
    let window = WebviewWindowBuilder::new(
        app,
        "quick-panel",
        WebviewUrl::App("quick-panel.html".into()),
    )
    .title("Todo")
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .maximizable(false)
    .inner_size(COLLAPSED_SIZE.width, COLLAPSED_SIZE.height)
    .build()?;

    restore_window(&window, &state).map_err(|error| tauri::Error::Io(io::Error::other(error)))?;

    let window_for_events = window.clone();
    let state_for_events = state.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::Moved(position) = event {
            schedule_moved_position(
                window_for_events.clone(),
                PhysicalPoint::new(position.x, position.y),
                state_for_events.clone(),
            );
        }
    });

    Ok(window)
}

fn schedule_moved_position(
    window: WebviewWindow,
    position: PhysicalPoint,
    state: QuickPanelNativeState,
) {
    if state.consume_programmatic_position(position) {
        return;
    }

    let generation = state.next_move_generation();
    thread::spawn(move || {
        thread::sleep(MOVED_DEBOUNCE);
        if !state.is_latest_move(generation) {
            return;
        }

        if let Err(error) = clamp_and_persist_moved_window(&window, position, &state) {
            eprintln!("quick panel moved-position update failed: {error}");
        }
    });
}

fn clamp_and_persist_moved_window<W: QuickPanelWindowPort>(
    window: &W,
    position: PhysicalPoint,
    state: &QuickPanelNativeState,
) -> Result<(), String> {
    let monitor = target_monitor(window, position)?;
    let mode = state.mode()?;
    let desired_size = logical_size_to_physical(
        panel_dimensions_for_monitor(mode, &monitor),
        valid_scale(monitor.scale_factor),
    );
    let actual_size = window.outer_size()?;
    let window_size = if actual_size == desired_size {
        actual_size
    } else {
        window.set_physical_size(desired_size)?;
        desired_size
    };
    let clamped = clamp_physical_position(position, window_size, monitor.work_area);

    if let Err(error) = process_moved_position(position, window_size, &monitor, state) {
        if clamped != position {
            state.mark_programmatic_position(clamped);
            window.set_physical_position(clamped)?;
        }
        return Err(error);
    }

    if clamped != position {
        state.mark_programmatic_position(clamped);
        window.set_physical_position(clamped)?;
    }

    Ok(())
}

#[tauri::command]
pub(crate) fn get_quick_panel_behavior(
    state: State<'_, QuickPanelNativeState>,
) -> Result<QuickPanelBehavior, String> {
    state.preferences().map(|preferences| preferences.behavior)
}

#[tauri::command]
pub(crate) fn set_quick_panel_behavior(
    behavior: QuickPanelBehavior,
    state: State<'_, QuickPanelNativeState>,
) -> Result<(), String> {
    state.set_behavior(behavior)
}

#[tauri::command]
pub(crate) fn set_quick_panel_mode(
    mode: QuickPanelMode,
    app: tauri::AppHandle,
    state: State<'_, QuickPanelNativeState>,
) -> Result<(), String> {
    let window = app
        .get_webview_window("quick-panel")
        .ok_or_else(|| "quick panel window is unavailable".to_string())?;
    apply_quick_panel_mode(&window, mode, &state)
}
