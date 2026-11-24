#[cfg(windows)]
mod windows_brightness {
    use windows::core::{w, BSTR, GUID, HRESULT, PCWSTR};
    use windows::core::Interface;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoSetProxyBlanket, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_MULTITHREADED, EOAC_NONE, RPC_C_AUTHN_LEVEL_CALL, RPC_C_IMP_LEVEL_IMPERSONATE,
    };
    use windows::Win32::System::Variant::{VARIANT, VARIANT_0_0, VT_BSTR, VT_I4, VT_UI1};
    use windows::Win32::System::Wmi::{
        IEnumWbemClassObject, IWbemClassObject, IWbemLocator, WBEM_FLAG_FORWARD_ONLY,
        WBEM_FLAG_RETURN_WBEM_COMPLETE, WBEM_FLAG_RETURN_IMMEDIATELY,
    };

    struct ComGuard;
    impl Drop for ComGuard {
        fn drop(&mut self) { unsafe { CoUninitialize() } }
    }

    fn with_wmi<T>(operation: impl FnOnce(&windows::Win32::System::Wmi::IWbemServices) -> windows::core::Result<T>) -> Result<T, String> {
        let initialized = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        let _com = if initialized.is_ok() {
            Some(ComGuard)
        } else if initialized.0 == 0x80010106u32 as i32 {
            None
        } else {
            return Err(format!("Could not initialize Windows brightness COM: {initialized:?}"));
        };

        let locator_clsid = GUID::from_u128(0x4590f8111d3a11d0891f00aa004b2e24);
        let result = unsafe {
            CoCreateInstance::<_, IWbemLocator>(&locator_clsid, None, CLSCTX_INPROC_SERVER)
                .and_then(|locator| {
                    locator.ConnectServer(&BSTR::from("ROOT\\WMI"), &BSTR::new(), &BSTR::new(), &BSTR::new(), 0, &BSTR::new(), None)
                })
                .and_then(|services| {
                    CoSetProxyBlanket(&services, 10, 0, PCWSTR::null(), RPC_C_AUTHN_LEVEL_CALL, RPC_C_IMP_LEVEL_IMPERSONATE, None, EOAC_NONE)?;
                    operation(&services)
                })
        };
        result.map_err(|error| format!("Windows display brightness control failed: {error}"))
    }

    fn query_one(services: &windows::Win32::System::Wmi::IWbemServices, class: &str) -> windows::core::Result<Option<IWbemClassObject>> {
        let query = BSTR::from(format!("SELECT * FROM {class}"));
        let enumerator: IEnumWbemClassObject = unsafe {
            services.ExecQuery(&BSTR::from("WQL"), &query, WBEM_FLAG_FORWARD_ONLY | WBEM_FLAG_RETURN_IMMEDIATELY, None)?
        };
        let mut objects = [None];
        let mut returned = 0;
        let status = unsafe { enumerator.Next(5000, &mut objects, &mut returned) };
        if returned == 0 || status.is_err() { return Ok(None); }
        Ok(objects[0].take())
    }

    unsafe fn get_u8(object: &IWbemClassObject, name: PCWSTR) -> windows::core::Result<u8> {
        let mut value = VARIANT::default();
        object.Get(name, 0, &mut value, None, None)?;
        let result = unsafe { value.Anonymous.Anonymous.Anonymous.bVal };
        Ok(result)
    }

    fn numeric_variant(kind: windows::Win32::System::Variant::VARENUM, value: u32) -> VARIANT {
        let mut variant = VARIANT::default();
        variant.Anonymous.Anonymous = std::mem::ManuallyDrop::new(VARIANT_0_0 {
            vt: kind,
            ..Default::default()
        });
        unsafe {
            let inner = &mut *variant.Anonymous.Anonymous;
            if kind == VT_UI1 { inner.Anonymous.bVal = value.min(100) as u8; }
            else { inner.Anonymous.lVal = value as i32; }
        }
        variant
    }

    fn unavailable(message: &'static str) -> windows::core::Error {
        windows::core::Error::new(HRESULT(0x80004005u32 as i32), message)
    }

    fn at_step<T>(step: &str, result: windows::core::Result<T>) -> windows::core::Result<T> {
        result.map_err(|error| windows::core::Error::new(error.code(), format!("{step}: {error}")))
    }

    pub fn get_level() -> Result<f32, String> {
        with_wmi(|services| {
            query_brightness(services)
        })
    }

    fn query_brightness(services: &windows::Win32::System::Wmi::IWbemServices) -> windows::core::Result<f32> {
        let Some(object) = query_one(services, "WmiMonitorBrightness")? else {
            return Err(unavailable("No compatible display brightness controller was found."));
        };
        let value = unsafe { get_u8(&object, w!("CurrentBrightness"))? };
        Ok(value as f32 / 100.0)
    }

    pub fn set_level(level: f32) -> Result<f32, String> {
        let target = (level.clamp(0.0, 1.0) * 100.0).round() as u32;
        with_wmi(|services| unsafe {
            let Some(instance) = query_one(services, "WmiMonitorBrightnessMethods")? else {
                return Err(unavailable("No compatible display brightness controller was found."));
            };

            let mut path_value = VARIANT::default();
            instance.Get(w!("__PATH"), 0, &mut path_value, None, None)?;
            let path = if path_value.Anonymous.Anonymous.vt == VT_BSTR {
                (&*path_value.Anonymous.Anonymous.Anonymous.bstrVal).clone()
            } else {
                return Err(unavailable("Windows did not return a display brightness controller path."));
            };
            let _ = windows::Win32::System::Variant::VariantClear(&mut path_value);

            let mut class = None;
            at_step("Reading brightness method class", services.GetObject(&BSTR::from("WmiMonitorBrightnessMethods"), WBEM_FLAG_RETURN_WBEM_COMPLETE, None, Some(&mut class), None))?;
            let class = class.ok_or_else(|| unavailable("Windows did not return a display brightness controller."))?;
            let mut input_signature_raw = std::ptr::null_mut();
            let mut output_signature_raw = std::ptr::null_mut();
            (windows::core::Interface::vtable(&class).GetMethod)(
                windows::core::Interface::as_raw(&class), w!("WmiSetBrightness"), 0,
                &mut input_signature_raw, &mut output_signature_raw,
            ).ok().map_err(|error| windows::core::Error::new(error.code(), "Reading WmiSetBrightness method signature failed"))?;
            if input_signature_raw.is_null() { return Err(unavailable("Windows did not return the brightness command signature.")); }
            let input_signature = IWbemClassObject::from_raw(input_signature_raw);
            let _output_signature = if output_signature_raw.is_null() { None } else { Some(IWbemClassObject::from_raw(output_signature_raw)) };
            let input = input_signature.SpawnInstance(0)?;
            // WMI represents CIM_UINT32 inputs as VT_I4 for IWbemClassObject::Put.
            let timeout = numeric_variant(VT_I4, 0);
            let brightness = numeric_variant(VT_UI1, target);
            at_step("Setting Timeout input", input.Put(w!("Timeout"), 0, &timeout, 0))?;
            at_step("Setting Brightness input", input.Put(w!("Brightness"), 0, &brightness, 0))?;

            let mut output = None;
            at_step("Executing WmiSetBrightness", services.ExecMethod(&path, &BSTR::from("WmiSetBrightness"), WBEM_FLAG_RETURN_WBEM_COMPLETE, None, &input, Some(&mut output), None))?;
            // Some laptop providers apply the change successfully but omit the output object.
            let _output = output;
            // Avoid a second WMI query on every tracking update; the UI already knows the requested level.
            Ok(target as f32 / 100.0)
        })
    }
}

#[cfg(windows)]
pub fn get_level() -> Result<f32, String> { windows_brightness::get_level() }

#[cfg(windows)]
pub fn set_level(level: f32) -> Result<f32, String> { windows_brightness::set_level(level) }

#[cfg(not(windows))]
pub fn get_level() -> Result<f32, String> { Err("System brightness control is only available on Windows".to_string()) }

#[cfg(not(windows))]
pub fn set_level(_level: f32) -> Result<f32, String> { Err("System brightness control is only available on Windows".to_string()) }
