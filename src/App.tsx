import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Activity, Command, Eye, Keyboard, RefreshCw, Search, Settings2, X } from "lucide-react";
import { WindowSwitcher } from "./components/WindowSwitcher";
import { StatusBar } from "./components/StatusBar";
import { CameraPreview } from "./components/CameraPreview";
import type { WindowInfo } from "./types";

function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export default function App() {
  const [windows, setWindows] = useState<WindowInfo[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [hotkeyEnabled, setHotkeyEnabled] = useState(true);
  const [loading, setLoading] = useState(false);

  const refreshWindows = useCallback(async () => {
    if (!isTauri()) {
      setWindows([]);
      return;
    }
    setLoading(true);
    try {
      const result = await invoke<WindowInfo[]>("get_open_windows");
      setWindows(result);
      setSelectedIndex(0);
      setError(null);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshWindows();
    if (!isTauri()) return;
    void invoke<boolean>("get_hotkey_enabled").then(setHotkeyEnabled).catch(() => undefined);
    let unlisten: (() => void) | undefined;
    void listen("gestureos://open-switcher", () => {
      setQuery("");
      void refreshWindows();
      void invoke<boolean>("get_hotkey_enabled").then(setHotkeyEnabled).catch(() => undefined);
    }).then((dispose) => { unlisten = dispose; });
    return () => unlisten?.();
  }, [refreshWindows]);

  const filteredWindows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized ? windows.filter((item) => item.title.toLocaleLowerCase().includes(normalized)) : windows;
  }, [query, windows]);

  const activate = useCallback(async (windowInfo: WindowInfo) => {
    try {
      await invoke("activate_window", { id: windowInfo.id });
      await invoke("hide_window");
    } catch (cause) {
      setError(String(cause));
    }
  }, []);

  const hide = useCallback(async () => {
    if (isTauri()) await invoke("hide_window").catch((cause: unknown) => setError(String(cause)));
  }, []);

  const toggleHotkey = async () => {
    const next = !hotkeyEnabled;
    try {
      const enabled = await invoke<boolean>("set_hotkey_enabled", { enabled: next });
      setHotkeyEnabled(enabled);
    } catch (cause) {
      setError(String(cause));
    }
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><Command size={19} strokeWidth={2.3} /></div>
          <div><div className="brand-name">GestureOS</div><div className="brand-caption">WINDOW SWITCHER</div></div>
        </div>
        <div className="topbar-actions">
          <span className="platform-badge"><span className="live-dot" /> WINDOWS</span>
          <button className="icon-button" type="button" title="Hide to tray" onClick={() => void hide()}><X size={17} /></button>
        </div>
      </header>

      <section className="intro">
        <div className="intro-icon"><Activity size={18} /></div>
        <div><h1>Your open windows</h1><p>Pick a window to bring it to the front.</p></div>
        <button className={`refresh-button${loading ? " spinning" : ""}`} type="button" onClick={() => void refreshWindows()} aria-label="Refresh windows"><RefreshCw size={16} /></button>
      </section>

      <div className="search-wrap"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search windows..." aria-label="Search windows" /><kbd>⌘ K</kbd></div>

      {error && <div className="error-banner" role="alert">{error}</div>}
      {!isTauri() && <div className="notice-banner">Run this window through the Tauri app to list Windows desktop windows.</div>}

      <WindowSwitcher
        windows={filteredWindows}
        selectedIndex={selectedIndex}
        onSelect={setSelectedIndex}
        onActivate={(item) => void activate(item)}
        onEscape={() => void hide()}
      />

      <CameraPreview />

      <section className="shortcut-card">
        <div className="shortcut-icon"><Keyboard size={17} /></div>
        <div className="shortcut-copy"><strong>Global shortcut</strong><span>Open the switcher from anywhere</span></div>
        <kbd className="shortcut-key">Ctrl <i>+</i> Shift <i>+</i> Space</kbd>
        <button className={`toggle${hotkeyEnabled ? " on" : ""}`} type="button" role="switch" aria-checked={hotkeyEnabled} aria-label="Enable global shortcut" onClick={() => void toggleHotkey()}><span /></button>
      </section>

      <StatusBar count={filteredWindows.length} total={windows.length} hotkeyEnabled={hotkeyEnabled} />
      <div className="keyboard-hint"><Eye size={13} /> <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> switch</span><span><kbd>Esc</kbd> hide</span><button type="button" onClick={() => void invoke("show_window").catch((cause: unknown) => setError(String(cause)))} title="Show GestureOS"><Settings2 size={14} /></button></div>
    </main>
  );
}
