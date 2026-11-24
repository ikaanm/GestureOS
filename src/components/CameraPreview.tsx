import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Camera, CameraOff, CircleAlert } from "lucide-react";
import "./CameraPreview.css";
import { HandLandmarkerOverlay } from "./HandLandmarkerOverlay";
import type { VisionState } from "./HandLandmarkerOverlay";

type CameraStatus = "idle" | "requesting" | "running";

function cameraError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "Камера не найдена. Подключите или включите веб-камеру.";
  if (["NotAllowedError", "PermissionDeniedError", "SecurityError"].includes(name)) return "Нет доступа к камере. Разрешите её использование в запросе WebView2 и настройках конфиденциальности Windows.";
  if (name === "NotReadableError" || name === "TrackStartError") return "Не удалось открыть камеру. Возможно, её уже использует другое приложение.";
  if (error instanceof Error && error.message) return `Не удалось запустить камеру: ${error.message}`;
  return "Не удалось запустить камеру. Проверьте подключение и разрешения.";
}

export function CameraPreview() {
  const [vision, setVision] = useState<VisionState>({ hands: [], error: null, gestures: { hands: [], events: [], history: [] }, cameraFps: 0, handFps: 0, gestureFps: 0, captureFps: 0, inferenceBackend: "—", detectionMs: 0, gestureMs: 0, totalMs: 0, latencyMs: 0, cameraWidth: 0, cameraHeight: 0 });
  const [uiFps, setUiFps] = useState(0);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [volumeLevel, setVolumeLevel] = useState(0);
  const volumeLevelRef = useRef(0);
  const pinchVolumeRef = useRef({ active: false, startX: 0, filteredX: 0, startLevel: 0, lastSentAt: 0, lastSentLevel: -1, inFlight: false, pendingLevel: null as number | null });
  const [brightnessLevel, setBrightnessLevel] = useState(0);
  const brightnessLevelRef = useRef(0);
  const pointingBrightnessRef = useRef({ active: false, startX: 0, filteredX: 0, startLevel: 0, lastSentLevel: -1, inFlight: false, pendingLevel: null as number | null });
  const altTabActiveRef = useRef(false);
  const altTabReleaseTimerRef = useRef<number | null>(null);
  const lastAltTabSwipeId = useRef(0);
  const uiSample = useRef({ start: 0, commits: 0 });
  useLayoutEffect(() => {
    const now = performance.now();
    if (!uiSample.current.start) uiSample.current.start = now;
    uiSample.current.commits += 1;
    const elapsed = now - uiSample.current.start;
    if (elapsed >= 1000) {
      setUiFps(Math.round(uiSample.current.commits * 1000 / elapsed));
      uiSample.current = { start: now, commits: 0 };
    }
  }, [vision]);
  const updateVision = useCallback((next: VisionState) => setVision(next), []);
  const flushVolume = useCallback(() => {
    const state = pinchVolumeRef.current;
    if (state.inFlight || state.pendingLevel === null) return;
    const level = state.pendingLevel;
    state.pendingLevel = null;
    state.inFlight = true;
    void invoke<number>("set_system_volume", { level }).then((actual) => {
      volumeLevelRef.current = actual;
      setVolumeLevel(actual);
      setActionStatus(`Volume ${Math.round(actual * 100)}% · pinch drag`);
      setActionError(null);
    }).catch((cause: unknown) => setActionError(String(cause))).finally(() => {
      state.inFlight = false;
      if (state.pendingLevel !== null) window.setTimeout(flushVolume, 35);
    });
  }, []);
  const flushBrightness = useCallback(() => {
    const state = pointingBrightnessRef.current;
    if (state.inFlight || state.pendingLevel === null) return;
    const level = state.pendingLevel;
    state.pendingLevel = null;
    state.inFlight = true;
    void invoke<number>("set_system_brightness", { level }).then((actual) => {
      brightnessLevelRef.current = actual;
      setBrightnessLevel(actual);
      setActionStatus(`Brightness ${Math.round(actual * 100)}% · pointing drag`);
      setActionError(null);
    }).catch((cause: unknown) => setActionError(String(cause))).finally(() => {
      state.inFlight = false;
      if (state.pendingLevel !== null) window.setTimeout(flushBrightness, 70);
    });
  }, []);
  const updateAltTabGesture = useCallback((active: boolean) => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    if (active) {
      if (altTabReleaseTimerRef.current !== null) {
        window.clearTimeout(altTabReleaseTimerRef.current);
        altTabReleaseTimerRef.current = null;
      }
      if (altTabActiveRef.current) return;
      altTabActiveRef.current = true;
      void invoke("start_alt_tab").then(() => {
        setActionStatus("Alt+Tab open · swipe left/right, release V-sign to select");
        setActionError(null);
      }).catch((cause: unknown) => {
        altTabActiveRef.current = false;
        setActionError(String(cause));
      });
      return;
    }
    if (!altTabActiveRef.current || altTabReleaseTimerRef.current !== null) return;
    // A short grace period avoids closing the switcher during a single noisy frame.
    altTabReleaseTimerRef.current = window.setTimeout(() => {
      altTabReleaseTimerRef.current = null;
      if (!altTabActiveRef.current) return;
      altTabActiveRef.current = false;
      void invoke("stop_alt_tab").then(() => {
        setActionStatus("Alt+Tab selection confirmed");
        setActionError(null);
      }).catch((cause: unknown) => setActionError(String(cause)));
    }, 220);
  }, []);
  const stepAltTab = useCallback((id: number, forward: boolean) => {
    if (id <= lastAltTabSwipeId.current) return;
    lastAltTabSwipeId.current = id;
    if (!altTabActiveRef.current) return;
    void invoke("step_alt_tab", { forward }).then(() => {
      setActionStatus(`Alt+Tab · ${forward ? "next" : "previous"} window`);
      setActionError(null);
    }).catch((cause: unknown) => setActionError(String(cause)));
  }, []);
  const updatePinchVolume = useCallback((rawLevel: number | null) => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    if (rawLevel === null) {
      pinchVolumeRef.current.active = false;
      pinchVolumeRef.current.pendingLevel = null;
      return;
    }
    if (!pinchVolumeRef.current.active) {
      pinchVolumeRef.current.active = true;
      pinchVolumeRef.current.startX = rawLevel;
      pinchVolumeRef.current.filteredX = rawLevel;
      pinchVolumeRef.current.startLevel = volumeLevelRef.current;
      pinchVolumeRef.current.lastSentLevel = volumeLevelRef.current;
    }
    // One full preview width maps to the complete 0–100% range; rightward motion raises volume.
    pinchVolumeRef.current.filteredX += 0.24 * (rawLevel - pinchVolumeRef.current.filteredX);
    const level = Math.max(0, Math.min(1, pinchVolumeRef.current.startLevel + pinchVolumeRef.current.filteredX - pinchVolumeRef.current.startX));
    const now = performance.now();
    if (now - pinchVolumeRef.current.lastSentAt < 90 || Math.abs(level - pinchVolumeRef.current.lastSentLevel) < 0.005) return;
    pinchVolumeRef.current.lastSentAt = now;
    pinchVolumeRef.current.lastSentLevel = level;
    pinchVolumeRef.current.pendingLevel = level;
    flushVolume();
  }, [flushVolume]);
  const updatePointingBrightness = useCallback((rawLevel: number | null) => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    if (rawLevel === null) {
      pointingBrightnessRef.current.active = false;
      pointingBrightnessRef.current.pendingLevel = null;
      return;
    }
    if (!pointingBrightnessRef.current.active) {
      pointingBrightnessRef.current.active = true;
      pointingBrightnessRef.current.startX = rawLevel;
      pointingBrightnessRef.current.filteredX = rawLevel;
      pointingBrightnessRef.current.startLevel = brightnessLevelRef.current;
      pointingBrightnessRef.current.lastSentLevel = brightnessLevelRef.current;
    }
    const state = pointingBrightnessRef.current;
    state.filteredX += 0.32 * (rawLevel - state.filteredX);
    const level = Math.max(0, Math.min(1, state.startLevel + state.filteredX - state.startX));
    if (Math.abs(level - state.lastSentLevel) < 0.008) return;
    state.lastSentLevel = level;
    state.pendingLevel = level;
    flushBrightness();
  }, [flushBrightness]);
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    void invoke<number>("get_system_volume").then((level) => { volumeLevelRef.current = level; setVolumeLevel(level); }).catch((cause: unknown) => setActionError(String(cause)));
    void invoke<number>("get_system_brightness").then((level) => { brightnessLevelRef.current = level; setBrightnessLevel(level); }).catch((cause: unknown) => setActionError(String(cause)));
  }, []);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const requestRef = useRef<Promise<void> | null>(null);
  const cancelRef = useRef(false);
  const [status, setStatus] = useState<CameraStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const stopCamera = useCallback(() => {
    if (requestRef.current) cancelRef.current = true;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStatus("idle");
  }, []);

  const startCamera = useCallback(() => {
    if (streamRef.current || document.visibilityState !== "visible") return;
    setError(null);
    setStatus("requesting");
    cancelRef.current = false;
    // A permission request can still be pending when the window is reopened.
    if (requestRef.current) return;
    const request = (async () => {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Захват камеры недоступен. Запустите GestureOS через Tauri/WebView2.");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 }, facingMode: "user" } });
      if (cancelRef.current || document.visibilityState !== "visible") {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setStatus("running");
    })();
    requestRef.current = request;
    void request.catch((cause: unknown) => { if (!cancelRef.current) setError(cameraError(cause)); }).finally(() => {
      requestRef.current = null;
      if (!streamRef.current) setStatus("idle");
    });
  }, []);

  useEffect(() => {
    const syncCameraWithWindow = () => {
      if (document.visibilityState !== "visible") stopCamera();
      else if ("__TAURI_INTERNALS__" in window) startCamera();
    };
    document.addEventListener("visibilitychange", syncCameraWithWindow);
    syncCameraWithWindow();
    return () => {
      document.removeEventListener("visibilitychange", syncCameraWithWindow);
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  return <section className="camera-card" aria-label="Camera preview">
    <div className="camera-copy">
      <div className="camera-heading"><Camera size={15} /><span>CAMERA PREVIEW</span></div>
      <p>{status === "running" ? "Camera is on" : status === "requesting" ? "Waiting for camera permission…" : "Camera is off"}</p>
      <div className="camera-controls">
        <button className="camera-button primary" type="button" onClick={startCamera} disabled={status !== "idle"}><Camera size={14} />{status === "requesting" ? "Starting…" : "Start Camera"}</button>
        <button className="camera-button" type="button" onClick={stopCamera} disabled={status === "idle"}><CameraOff size={14} />Stop Camera</button>
      </div>
    </div>
    <div className={`camera-frame${status === "running" ? " active" : ""}`}>
      <video ref={videoRef} autoPlay muted playsInline aria-label="Live camera preview" />
      <HandLandmarkerOverlay videoRef={videoRef} active={status === "running"} onUpdate={updateVision} onPinchVolume={updatePinchVolume} onPointingBrightness={updatePointingBrightness} onAltTabGesture={updateAltTabGesture} onAltTabSwipe={stepAltTab} />
      {status !== "running" && <div className="camera-placeholder"><Camera size={22} /><span>{status === "requesting" ? "Requesting access" : "Preview is off"}</span></div>}
    </div>
    <div className="gesture-dashboard" aria-live="polite">
      <div className="gesture-current">
        <span className={vision.hands.length ? "hand-status-live" : ""}>{vision.error ? "Detection error" : vision.hands.length ? `Hand detected · ${vision.hands.length}` : "No hand detected"}</span>
        <strong>{vision.gestures.hands[0]?.gesture ?? (vision.gestures.hands[0]?.candidate ? `Stabilizing ${vision.gestures.hands[0].candidate}` : "—")}</strong>
        <span>UI {uiFps} FPS</span>
      </div>
      <div className="gesture-metrics"><span>Confidence <b>{Math.round((vision.gestures.hands[0]?.confidence ?? 0) * 100)}%</b></span><span>Stability <b>{Math.round((vision.gestures.hands[0]?.stability ?? 0) * 100)}%</b></span></div>
      <div className="performance-line"><span>Camera <b>{vision.captureFps.toFixed(0)} FPS track / {vision.cameraFps} delivered</b> {vision.cameraWidth}×{vision.cameraHeight}</span><span>Hands <b>{vision.handFps} FPS</b></span><span>Gestures <b>{vision.gestureFps} FPS</b></span></div>
      <div className="performance-line"><span>Avg/frame <b>{vision.totalMs.toFixed(1)} ms</b> (MP {vision.detectionMs.toFixed(1)} + gesture {vision.gestureMs.toFixed(2)}, {vision.inferenceBackend})</span><span>Frame→result <b>{vision.latencyMs.toFixed(0)} ms</b></span></div>
      <div className="volume-control-hint"><span>VOLUME</span><span>Hold PINCH and drag right: + · left: −</span><b>{Math.round(volumeLevel * 100)}%</b><input aria-label="System volume" type="range" min="0" max="100" value={Math.round(volumeLevel * 100)} onChange={(event) => { const level = Number(event.target.value) / 100; volumeLevelRef.current = level; setVolumeLevel(level); void invoke<number>("set_system_volume", { level }).catch((cause: unknown) => setActionError(String(cause))); }} /><span>V_SIGN: hold to open Alt+Tab; swipe left/right to choose</span></div>
      <div className="volume-control-hint"><span>BRIGHTNESS</span><span>Hold POINTING UP and drag right: + · left: −</span><b>{Math.round(brightnessLevel * 100)}%</b><input aria-label="System brightness" type="range" min="0" max="100" value={Math.round(brightnessLevel * 100)} onChange={(event) => { const level = Number(event.target.value) / 100; brightnessLevelRef.current = level; setBrightnessLevel(level); void invoke<number>("set_system_brightness", { level }).then((actual) => { brightnessLevelRef.current = actual; setBrightnessLevel(actual); setActionError(null); }).catch((cause: unknown) => setActionError(String(cause))); }} /></div>
      <div className="volume-control-hint"><span>VOLUME</span><span>Hold PINCH and drag right: + · left: −</span><b>{Math.round(volumeLevel * 100)}%</b><input aria-label="System volume" type="range" min="0" max="100" value={Math.round(volumeLevel * 100)} onChange={(event) => { const level = Number(event.target.value) / 100; volumeLevelRef.current = level; setVolumeLevel(level); void invoke<number>("set_system_volume", { level }).catch((cause: unknown) => setActionError(String(cause))); }} />{actionStatus && <b>{actionStatus}</b>}{actionError && <i title={actionError}>Action failed</i>}<span>V-sign: Alt+Tab</span></div>
      <div className="gesture-history"><span>RECENT</span>{vision.gestures.history.slice(0, 4).map((event) => <b key={event.id}>{event.name.replace(/_/g, " ")}</b>)}{vision.gestures.history.length === 0 && <i>—</i>}</div>
      {vision.error && <div className="gesture-error" title={vision.error}>{vision.error}</div>}
    </div>
    {error && <div className="camera-error" role="alert"><CircleAlert size={14} />{error}</div>}
  </section>;
}
