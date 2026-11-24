# GestureOS

GestureOS Stage 1 is a Windows 11 desktop window switcher built with Tauri 2, Rust, React, TypeScript, and Vite. It lists visible top-level windows, restores minimized windows, and asks Windows to bring a selected window to the foreground. Closing the main window hides it to the system tray.

## Run on Windows 11

Install the Rust MSVC toolchain, Node.js, Microsoft C++ Build Tools, and WebView2. Then, from the repository root:

```powershell
npm install
npm run tauri dev
```

Build an installer with:

```powershell
npm run tauri build
```

The default global shortcut is `Ctrl+Shift+Space`. It can be turned off from the interface or tray menu. If Windows or another application rejects registration, GestureOS stays open and reports the shortcut as unavailable.

## Current scope

- Window enumeration, title filtering, self-process exclusion, and activation live in `src-tauri/src/window_manager.rs`.
- Tray, hotkey, and typed IPC commands are split into their own Rust modules.
- The UI has mouse selection, search, arrow-key navigation, Enter activation, and Escape-to-hide.
- No camera, computer vision, network requests, administrator elevation, or startup registration is included.
- Windows may refuse foreground activation for security reasons. GestureOS returns an error in that case and does not try to bypass the restriction.

Stage 2 can connect a gesture recognition module to the same independent window manager API.
