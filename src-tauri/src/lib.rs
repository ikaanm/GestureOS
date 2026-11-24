mod commands;
mod hotkey;
mod system_brightness;
mod system_volume;
mod system_window_actions;
mod tray;
mod window_manager;

use std::sync::atomic::AtomicBool;
use tauri::Manager;
use tauri_plugin_global_shortcut::GlobalShortcutExt;

pub struct AppState {
    pub hotkey_enabled: AtomicBool,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(AppState {
            hotkey_enabled: AtomicBool::new(true),
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_open_windows,
            commands::activate_window,
            commands::hide_window,
            commands::show_window,
            commands::set_hotkey_enabled,
            commands::get_hotkey_enabled,
            commands::get_system_volume,
            commands::set_system_volume,
            commands::get_system_brightness,
            commands::set_system_brightness,
            commands::start_alt_tab,
            commands::step_alt_tab,
            commands::stop_alt_tab
        ])
        .setup(|app| {
            tray::install(app.handle())?;
            if let Err(error) = hotkey::register(app.handle()) {
                app.state::<AppState>()
                    .hotkey_enabled
                    .store(false, std::sync::atomic::Ordering::SeqCst);
                eprintln!("GestureOS hotkey could not be registered: {error}");
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if let Err(error) = window.hide() {
                    eprintln!("Could not hide GestureOS window: {error}");
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building GestureOS")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                if let Err(error) = system_window_actions::stop_alt_tab() {
                    eprintln!("Could not release Alt+Tab modifier: {error}");
                }
                if let Err(error) = app.global_shortcut().unregister_all() {
                    eprintln!("Could not release GestureOS global shortcuts: {error}");
                }
            }
        })
}
