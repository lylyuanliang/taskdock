use std::{cell::RefCell, fs};

use crate::quick_panel::{
    apply_quick_panel_mode, clamp_physical_position, panel_dimensions_for_monitor,
    process_moved_position, restore_saved_position, save_position_for_monitor, LogicalPosition,
    LogicalSize, MonitorDescriptor, PhysicalPoint, PhysicalSize, PhysicalWorkArea,
    QuickPanelBehavior, QuickPanelMode, QuickPanelNativeState, QuickPanelWindowPort,
    SavedPanelPosition,
};

#[test]
fn logical_offset_survives_scale_change_from_100_to_150_percent() {
    let original_monitor = monitor("left", 1.0, -1920, 0, 1920, 1080);
    let saved = save_position_for_monitor(PhysicalPoint::new(-1720, 150), &original_monitor);
    let scaled_monitor = monitor("left", 1.5, -2880, 0, 2880, 1620);

    let restored = restore_saved_position(
        &saved,
        &[scaled_monitor],
        None,
        None,
        LogicalSize::new(320.0, 480.0),
    )
    .unwrap();

    assert_eq!(saved.offset, LogicalPosition::new(200.0, 150.0));
    assert_eq!(restored.position, PhysicalPoint::new(-2580, 225));
}

#[test]
fn logical_offset_survives_scale_change_from_150_to_100_percent() {
    let original_monitor = monitor("left", 1.5, -2880, 0, 2880, 1620);
    let saved = save_position_for_monitor(PhysicalPoint::new(-2580, 225), &original_monitor);
    let scaled_monitor = monitor("left", 1.0, -1920, 0, 1920, 1080);

    let restored = restore_saved_position(
        &saved,
        &[scaled_monitor],
        None,
        None,
        LogicalSize::new(320.0, 480.0),
    )
    .unwrap();

    assert_eq!(saved.offset, LogicalPosition::new(200.0, 150.0));
    assert_eq!(restored.position, PhysicalPoint::new(-1720, 150));
}

#[test]
fn negative_coordinate_secondary_monitor_is_selected_by_identity() {
    let monitors = [
        monitor("primary", 1.0, 0, 0, 1920, 1080),
        monitor("left", 1.0, -1920, -100, 1920, 1040),
    ];
    let saved = SavedPanelPosition::new("left", LogicalPosition::new(80.0, 40.0));

    let restored = restore_saved_position(
        &saved,
        &monitors,
        Some("primary"),
        Some("primary"),
        LogicalSize::new(44.0, 44.0),
    )
    .unwrap();

    assert_eq!(restored.monitor_id, "left");
    assert_eq!(restored.position, PhysicalPoint::new(-1840, -60));
}

#[test]
fn missing_saved_monitor_falls_back_to_current_monitor() {
    let current_monitor = monitor("primary", 1.25, 0, 0, 2400, 1300);
    let saved = SavedPanelPosition::new("removed", LogicalPosition::new(100.0, 80.0));

    let restored = restore_saved_position(
        &saved,
        &[current_monitor],
        Some("primary"),
        Some("primary"),
        LogicalSize::new(320.0, 480.0),
    )
    .unwrap();

    assert_eq!(restored.monitor_id, "primary");
    assert_eq!(restored.position, PhysicalPoint::new(125, 100));
}

#[test]
fn physical_clamp_covers_all_four_work_area_edges() {
    let work_area = PhysicalWorkArea::new(
        PhysicalPoint::new(-1920, -100),
        PhysicalSize::new(1920, 1000),
    );
    let window_size = PhysicalSize::new(480, 720);

    assert_eq!(
        clamp_physical_position(PhysicalPoint::new(-2500, 0), window_size, work_area),
        PhysicalPoint::new(-1920, 0)
    );
    assert_eq!(
        clamp_physical_position(PhysicalPoint::new(-1000, -500), window_size, work_area),
        PhysicalPoint::new(-1000, -100)
    );
    assert_eq!(
        clamp_physical_position(PhysicalPoint::new(100, 0), window_size, work_area),
        PhysicalPoint::new(-480, 0)
    );
    assert_eq!(
        clamp_physical_position(PhysicalPoint::new(-1000, 1000), window_size, work_area),
        PhysicalPoint::new(-1000, 180)
    );
}

#[test]
fn expanded_height_is_capped_by_available_logical_work_area() {
    for (physical_height, expected_height) in [
        (360, 360.0),
        (400, 400.0),
        (479, 479.0),
        (480, 480.0),
        (600, 480.0),
    ] {
        let monitor = monitor("primary", 1.0, 0, 0, 1920, physical_height);
        assert_eq!(
            panel_dimensions_for_monitor(QuickPanelMode::Expanded, &monitor).height,
            expected_height
        );
    }

    let scaled_monitor = monitor("primary", 1.5, 0, 0, 1920, 600);
    assert_eq!(
        panel_dimensions_for_monitor(QuickPanelMode::Expanded, &scaled_monitor).height,
        400.0
    );
}

#[test]
fn moved_position_is_clamped_and_persisted_with_monitor_identity() {
    let app_data_dir = unique_app_data_dir();
    fs::create_dir_all(&app_data_dir).unwrap();
    let state = QuickPanelNativeState::open(&app_data_dir).unwrap();
    let target_monitor = monitor("left", 1.5, -2880, 0, 2880, 1200);

    let clamped = process_moved_position(
        PhysicalPoint::new(-4000, 1000),
        PhysicalSize::new(480, 720),
        &target_monitor,
        &state,
    )
    .unwrap();

    let reloaded = QuickPanelNativeState::open(&app_data_dir).unwrap();
    let preferences = reloaded.preferences().unwrap();
    assert_eq!(clamped, PhysicalPoint::new(-2880, 480));
    assert_eq!(
        preferences.position,
        Some(SavedPanelPosition::new(
            "left",
            LogicalPosition::new(0.0, 320.0)
        ))
    );

    fs::remove_dir_all(app_data_dir).unwrap();
}

#[test]
fn production_behavior_setter_persists_click_behavior() {
    let app_data_dir = unique_app_data_dir();
    fs::create_dir_all(&app_data_dir).unwrap();
    let state = QuickPanelNativeState::open(&app_data_dir).unwrap();

    state.set_behavior(QuickPanelBehavior::Click).unwrap();

    let reloaded = QuickPanelNativeState::open(&app_data_dir).unwrap();
    assert_eq!(
        reloaded.preferences().unwrap().behavior,
        QuickPanelBehavior::Click
    );

    fs::remove_dir_all(app_data_dir).unwrap();
}

#[test]
fn failed_preferences_write_does_not_mutate_memory_state() {
    let invalid_app_data_dir = unique_app_data_dir();
    fs::write(&invalid_app_data_dir, "not a directory").unwrap();
    let state = QuickPanelNativeState::open(&invalid_app_data_dir).unwrap();

    assert!(state.set_behavior(QuickPanelBehavior::Click).is_err());
    assert_eq!(
        state.preferences().unwrap().behavior,
        QuickPanelBehavior::Hover
    );

    fs::remove_file(invalid_app_data_dir).unwrap();
}

#[test]
fn production_mode_application_resizes_then_clamps_moves_and_persists() {
    let app_data_dir = unique_app_data_dir();
    fs::create_dir_all(&app_data_dir).unwrap();
    let state = QuickPanelNativeState::open(&app_data_dir).unwrap();
    let port = FakeQuickPanelWindowPort::new(
        state.clone(),
        monitor("primary", 1.0, 0, 0, 1000, 800),
        PhysicalPoint::new(-100, 1000),
        PhysicalSize::new(44, 44),
    );

    apply_quick_panel_mode(&port, QuickPanelMode::Expanded, &state).unwrap();

    assert_eq!(
        port.calls(),
        vec![
            WindowPortCall::OuterPosition,
            WindowPortCall::MonitorFromPosition(PhysicalPoint::new(-100, 1000)),
            WindowPortCall::SetSize(PhysicalSize::new(320, 480)),
            WindowPortCall::SetPosition(PhysicalPoint::new(0, 320)),
        ]
    );
    assert_eq!(
        state.preferences().unwrap().position,
        Some(SavedPanelPosition::new(
            "primary",
            LogicalPosition::new(0.0, 320.0)
        ))
    );

    fs::remove_dir_all(app_data_dir).unwrap();
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum WindowPortCall {
    MonitorFromPosition(PhysicalPoint),
    OuterPosition,
    SetPosition(PhysicalPoint),
    SetSize(PhysicalSize),
}

struct FakeQuickPanelWindowPort {
    calls: RefCell<Vec<WindowPortCall>>,
    monitor: MonitorDescriptor,
    position: PhysicalPoint,
    size: PhysicalSize,
    state: QuickPanelNativeState,
}

impl FakeQuickPanelWindowPort {
    fn new(
        state: QuickPanelNativeState,
        monitor: MonitorDescriptor,
        position: PhysicalPoint,
        size: PhysicalSize,
    ) -> Self {
        Self {
            calls: RefCell::new(Vec::new()),
            monitor,
            position,
            size,
            state,
        }
    }

    fn calls(&self) -> Vec<WindowPortCall> {
        self.calls.borrow().clone()
    }
}

impl QuickPanelWindowPort for FakeQuickPanelWindowPort {
    fn available_monitors(&self) -> Result<Vec<MonitorDescriptor>, String> {
        Ok(vec![self.monitor.clone()])
    }

    fn current_monitor(&self) -> Result<Option<MonitorDescriptor>, String> {
        Ok(Some(self.monitor.clone()))
    }

    fn monitor_from_position(
        &self,
        position: PhysicalPoint,
    ) -> Result<Option<MonitorDescriptor>, String> {
        self.calls
            .borrow_mut()
            .push(WindowPortCall::MonitorFromPosition(position));
        Ok(Some(self.monitor.clone()))
    }

    fn outer_position(&self) -> Result<PhysicalPoint, String> {
        self.calls.borrow_mut().push(WindowPortCall::OuterPosition);
        Ok(self.position)
    }

    fn outer_size(&self) -> Result<PhysicalSize, String> {
        Ok(self.size)
    }

    fn primary_monitor(&self) -> Result<Option<MonitorDescriptor>, String> {
        Ok(Some(self.monitor.clone()))
    }

    fn set_physical_position(&self, position: PhysicalPoint) -> Result<(), String> {
        assert_eq!(self.state.preferences()?.position, None);
        self.calls
            .borrow_mut()
            .push(WindowPortCall::SetPosition(position));
        Ok(())
    }

    fn set_physical_size(&self, size: PhysicalSize) -> Result<(), String> {
        self.calls.borrow_mut().push(WindowPortCall::SetSize(size));
        Ok(())
    }
}

fn monitor(
    id: &str,
    scale_factor: f64,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> MonitorDescriptor {
    MonitorDescriptor::new(
        id,
        scale_factor,
        PhysicalWorkArea::new(PhysicalPoint::new(x, y), PhysicalSize::new(width, height)),
    )
}

fn unique_app_data_dir() -> std::path::PathBuf {
    std::env::temp_dir().join(format!("todo-quick-panel-{}", uuid::Uuid::new_v4()))
}
