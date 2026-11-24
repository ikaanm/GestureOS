use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub const SWITCHER_SHORTCUT: &str = "Ctrl+Shift+Space";

pub fn register(app: &AppHandle) -> Result<(), String> {
    app.global_shortcut()
        .on_shortcut(SWITCHER_SHORTCUT, |app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                if let Err(error) = crate::tray::show_main_window(app) {
                    eprintln!("Could not open GestureOS from hotkey: {error}");
                }
            }
        })
        .map_err(|error| format!("Could not register {SWITCHER_SHORTCUT}: {error}"))
}

pub fn unregister(app: &AppHandle) -> Result<(), String> {
    app.global_shortcut()
        .unregister(SWITCHER_SHORTCUT)
        .map_err(|error| format!("Could not release {SWITCHER_SHORTCUT}: {error}"))
}
