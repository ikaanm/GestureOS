use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfo {
    /// Opaque hexadecimal identifier. It is resolved and validated by the backend.
    pub id: String,
    pub title: String,
    pub is_minimized: bool,
    pub is_visible: bool,
}

#[cfg(windows)]
mod platform {
    use super::WindowInfo;
    use windows_sys::core::BOOL;
    use windows_sys::Win32::Foundation::{HWND, LPARAM};
    use windows_sys::Win32::System::Threading::GetCurrentProcessId;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindow, GetWindowLongPtrW, GetWindowTextLengthW, GetWindowTextW,
        GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible, SetForegroundWindow,
        ShowWindow, GW_OWNER, GWL_EXSTYLE, SW_RESTORE, WS_EX_TOOLWINDOW,
    };

    const MAX_TITLE_UNITS: usize = 32_768;

    pub fn list() -> Result<Vec<WindowInfo>, String> {
        let mut windows = Vec::<WindowInfo>::new();
        let context = &mut windows as *mut Vec<WindowInfo>;
        // EnumWindows calls the callback synchronously; the pointer remains valid for the call.
        let completed = unsafe { EnumWindows(Some(collect_window), context as LPARAM) };
        if completed == 0 {
            return Err("Windows could not enumerate top-level windows.".into());
        }
        Ok(windows)
    }

    unsafe extern "system" fn collect_window(hwnd: HWND, context: LPARAM) -> BOOL {
        let windows = &mut *(context as *mut Vec<WindowInfo>);
        if IsWindowVisible(hwnd) == 0 {
            return 1;
        }

        let mut process_id = 0;
        GetWindowThreadProcessId(hwnd, &mut process_id);
        if process_id == GetCurrentProcessId() {
            return 1;
        }

        let extended_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        let is_tool_window = (extended_style & WS_EX_TOOLWINDOW) != 0;
        let has_owner = !GetWindow(hwnd, GW_OWNER).is_null();
        if is_tool_window || (has_owner && (extended_style & 0x0004_0000) == 0) {
            return 1;
        }

        let length = GetWindowTextLengthW(hwnd);
        if length <= 0 || length as usize >= MAX_TITLE_UNITS {
            return 1;
        }
        let mut title = vec![0u16; length as usize + 1];
        let copied = GetWindowTextW(hwnd, title.as_mut_ptr(), title.len() as i32);
        if copied <= 0 {
            return 1;
        }
        title.truncate(copied as usize);
        let title = String::from_utf16_lossy(&title).trim().to_owned();
        if title.is_empty() {
            return 1;
        }

        let handle = hwnd as usize;
        windows.push(WindowInfo {
            id: format!("{handle:x}"),
            title,
            is_minimized: IsIconic(hwnd) != 0,
            is_visible: true,
        });
        1
    }

    pub fn activate(id: &str) -> Result<(), String> {
        let handle = usize::from_str_radix(id, 16)
            .map_err(|_| "The selected window identifier is invalid.".to_string())?;
        if handle == 0 {
            return Err("The selected window no longer exists.".into());
        }
        let hwnd = handle as HWND;
        if unsafe { IsWindow(hwnd) } == 0 || unsafe { IsWindowVisible(hwnd) } == 0 {
            return Err("The selected window is no longer available.".into());
        }

        // Restore only when minimized, then ask Windows for normal foreground activation.
        if unsafe { IsIconic(hwnd) } != 0 {
            unsafe { ShowWindow(hwnd, SW_RESTORE) };
        }
        if unsafe { SetForegroundWindow(hwnd) } == 0 {
            return Err(
                "Windows did not allow GestureOS to activate this window. Select it directly or try again.".into(),
            );
        }
        Ok(())
    }
}

#[cfg(not(windows))]
mod platform {
    use super::WindowInfo;

    pub fn list() -> Result<Vec<WindowInfo>, String> {
        Err("Window switching is available on Windows 11 only.".into())
    }

    pub fn activate(_id: &str) -> Result<(), String> {
        Err("Window activation is available on Windows 11 only.".into())
    }
}

pub fn list_windows() -> Result<Vec<WindowInfo>, String> {
    platform::list()
}

pub fn activate_window(id: &str) -> Result<(), String> {
    platform::activate(id)
}
