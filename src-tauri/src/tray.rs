use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager,
};

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open GestureOS", true, None::<&str>)?;
    let enabled = CheckMenuItem::with_id(app, "enabled", "Enable / Disable GestureOS", true, true, None::<&str>)?;
    let exit = MenuItem::with_id(app, "exit", "Exit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &enabled, &exit])?;

    TrayIconBuilder::new()
        .tooltip("GestureOS")
        .icon(tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png"))?)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "open" => report(show_main_window(app)),
            "enabled" => {
                let state = app.state::<crate::AppState>();
                let was_enabled = state.hotkey_enabled.load(std::sync::atomic::Ordering::SeqCst);
                let result = if was_enabled {
                    crate::hotkey::unregister(app)
                } else {
                    crate::hotkey::register(app)
                };
                match result {
                    Ok(()) => {
                        state.hotkey_enabled.store(!was_enabled, std::sync::atomic::Ordering::SeqCst);
                        if let Err(error) = enabled.set_checked(!was_enabled) {
                            eprintln!("Could not update GestureOS tray state: {error}");
                        }
                    }
                    Err(error) => {
                        let _ = enabled.set_checked(was_enabled);
                        eprintln!("Could not toggle GestureOS hotkey: {error}");
                    }
                }
            }
            "exit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event
            {
                report(show_main_window(tray.app_handle()));
            }
        })
        .build(app)?;
    Ok(())
}

pub fn show_main_window(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "GestureOS main window is unavailable.".to_string())?;
    window.show().map_err(|error| format!("Could not show GestureOS: {error}"))?;
    window.unminimize().map_err(|error| format!("Could not restore GestureOS: {error}"))?;
    window.set_focus().map_err(|error| format!("Could not focus GestureOS: {error}"))?;
    app.emit("gestureos://open-switcher", ())
        .map_err(|error| format!("Could not refresh the window switcher: {error}"))?;
    Ok(())
}

fn report(result: Result<(), String>) {
    if let Err(error) = result {
        eprintln!("{error}");
    }
}
