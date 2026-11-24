#[cfg(windows)]
mod windows_actions {
    use std::mem::size_of;
    use std::sync::Mutex;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_LMENU,
        VK_LSHIFT, VK_TAB,
    };

    static ALT_TAB_ACTIVE: Mutex<bool> = Mutex::new(false);

    fn keyboard_input(key: u16, flags: u32) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT { wVk: key, wScan: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 },
            },
        }
    }

    fn send(inputs: &[INPUT]) -> Result<(), String> {
        let inserted = unsafe { SendInput(inputs.len() as u32, inputs.as_ptr(), size_of::<INPUT>() as i32) };
        if inserted == inputs.len() as u32 {
            Ok(())
        } else {
            Err("Windows did not accept the Alt+Tab key event".to_string())
        }
    }

    fn release_modifiers_and_tab() {
        let _ = send(&[
            keyboard_input(VK_TAB, KEYEVENTF_KEYUP),
            keyboard_input(VK_LSHIFT, KEYEVENTF_KEYUP),
            keyboard_input(VK_LMENU, KEYEVENTF_KEYUP),
        ]);
    }

    pub fn start_alt_tab() -> Result<(), String> {
        let mut active = ALT_TAB_ACTIVE.lock().map_err(|_| "Alt+Tab state is unavailable".to_string())?;
        if *active { return Ok(()); }
        let initial = [keyboard_input(VK_LMENU, 0), keyboard_input(VK_TAB, 0), keyboard_input(VK_TAB, KEYEVENTF_KEYUP)];
        if let Err(error) = send(&initial) {
            release_modifiers_and_tab();
            return Err(error);
        }
        *active = true;
        Ok(())
    }

    pub fn step_alt_tab(forward: bool) -> Result<(), String> {
        let mut active = ALT_TAB_ACTIVE.lock().map_err(|_| "Alt+Tab state is unavailable".to_string())?;
        if !*active { return Ok(()); }
        if forward {
            let result = send(&[keyboard_input(VK_TAB, 0), keyboard_input(VK_TAB, KEYEVENTF_KEYUP)]);
            if result.is_err() { release_modifiers_and_tab(); *active = false; }
            result
        } else {
            let result = send(&[
                keyboard_input(VK_LSHIFT, 0),
                keyboard_input(VK_TAB, 0),
                keyboard_input(VK_TAB, KEYEVENTF_KEYUP),
                keyboard_input(VK_LSHIFT, KEYEVENTF_KEYUP),
            ]);
            if result.is_err() { release_modifiers_and_tab(); *active = false; }
            result
        }
    }

    pub fn stop_alt_tab() -> Result<(), String> {
        let mut active = ALT_TAB_ACTIVE.lock().map_err(|_| "Alt+Tab state is unavailable".to_string())?;
        if !*active { return Ok(()); }
        send(&[keyboard_input(VK_LMENU, KEYEVENTF_KEYUP)])?;
        *active = false;
        Ok(())
    }
}

#[cfg(windows)]
pub fn start_alt_tab() -> Result<(), String> { windows_actions::start_alt_tab() }

#[cfg(windows)]
pub fn step_alt_tab(forward: bool) -> Result<(), String> { windows_actions::step_alt_tab(forward) }

#[cfg(windows)]
pub fn stop_alt_tab() -> Result<(), String> { windows_actions::stop_alt_tab() }

#[cfg(not(windows))]
pub fn start_alt_tab() -> Result<(), String> { Err("Alt+Tab gesture action is only available on Windows".to_string()) }

#[cfg(not(windows))]
pub fn step_alt_tab(_forward: bool) -> Result<(), String> { Err("Alt+Tab gesture action is only available on Windows".to_string()) }

#[cfg(not(windows))]
pub fn stop_alt_tab() -> Result<(), String> { Err("Alt+Tab gesture action is only available on Windows".to_string()) }
