use crate::{hotkey, system_brightness, system_volume, system_window_actions, window_manager, AppState};
use tauri::{AppHandle, State};

#[tauri::command]
pub fn get_open_windows() -> Result<Vec<window_manager::WindowInfo>, String> {
    window_manager::list_windows()
}

#[tauri::command]
pub fn activate_window(id: String) -> Result<(), String> {
    window_manager::activate_window(&id)
}

#[tauri::command]
pub fn hide_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|error| format!("Could not hide GestureOS: {error}"))
}

#[tauri::command]
pub fn show_window(app: AppHandle) -> Result<(), String> {
    crate::tray::show_main_window(&app)
}

#[tauri::command]
pub fn set_hotkey_enabled(
    app: AppHandle,
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<bool, String> {
    let result = if enabled {
        hotkey::register(&app)
    } else {
        hotkey::unregister(&app)
    };
    result?;
    state.hotkey_enabled.store(enabled, std::sync::atomic::Ordering::SeqCst);
    Ok(enabled)
}

#[tauri::command]
pub fn get_hotkey_enabled(state: State<'_, AppState>) -> Result<bool, String> {
    Ok(state.hotkey_enabled.load(std::sync::atomic::Ordering::SeqCst))
}

#[tauri::command]
pub fn get_system_volume() -> Result<f32, String> { system_volume::get_level() }

#[tauri::command]
pub fn set_system_volume(level: f32) -> Result<f32, String> { system_volume::set_level(level) }

#[tauri::command]
pub fn get_system_brightness() -> Result<f32, String> { system_brightness::get_level() }

#[tauri::command]
pub fn set_system_brightness(level: f32) -> Result<f32, String> { system_brightness::set_level(level) }

#[tauri::command]
pub fn start_alt_tab() -> Result<(), String> { system_window_actions::start_alt_tab() }

#[tauri::command]
pub fn step_alt_tab(forward: bool) -> Result<(), String> { system_window_actions::step_alt_tab(forward) }

#[tauri::command]
pub fn stop_alt_tab() -> Result<(), String> { system_window_actions::stop_alt_tab() }
