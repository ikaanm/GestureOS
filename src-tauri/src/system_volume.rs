#[cfg(windows)]
fn with_endpoint_volume<T>(
    operation: impl FnOnce(&windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume) -> windows::core::Result<T>,
) -> Result<T, String> {
    use windows::Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
    };

    struct ComGuard;
    impl Drop for ComGuard {
        fn drop(&mut self) { unsafe { CoUninitialize() } }
    }

    let initialized = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    // Tauri may already have initialized this worker as STA. In that case COM is
    // usable in its existing apartment, but this call must not be uninitialized here.
    let _com = if initialized.is_ok() {
        Some(ComGuard)
    } else if initialized.0 == 0x80010106u32 as i32 {
        None
    } else {
        return Err(format!("Could not initialize Windows audio COM: {initialized:?}"));
    };
    let result = unsafe { CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL) }
        .and_then(|enumerator| unsafe { enumerator.GetDefaultAudioEndpoint(eRender, eConsole) })
        .and_then(|device| unsafe {
            device
                .Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None)
                .and_then(|volume| operation(&volume))
        });
    result.map_err(|error| format!("Windows audio volume control failed: {error}"))
}

#[cfg(windows)]
pub fn get_level() -> Result<f32, String> {
    with_endpoint_volume(|volume| unsafe { volume.GetMasterVolumeLevelScalar() })
}

#[cfg(windows)]
pub fn set_level(level: f32) -> Result<f32, String> {
    let level = level.clamp(0.0, 1.0);
    with_endpoint_volume(|volume| unsafe {
        volume.SetMasterVolumeLevelScalar(level, std::ptr::null())?;
        volume.GetMasterVolumeLevelScalar()
    })
}

#[cfg(not(windows))]
pub fn get_level() -> Result<f32, String> {
    Err("System volume gesture control is only available on Windows".to_string())
}

#[cfg(not(windows))]
pub fn set_level(_level: f32) -> Result<f32, String> {
    Err("System volume gesture control is only available on Windows".to_string())
}
