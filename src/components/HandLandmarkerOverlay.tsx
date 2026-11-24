import { useEffect, useRef, type RefObject } from "react";
import type { GestureFrame } from "../vision/gesture_recognition";

type Hand = { handedness: string; landmarks: { x: number; y: number; z: number }[] };
export type VisionState = {
  hands: Hand[]; error: string | null; gestures: GestureFrame;
  cameraFps: number; handFps: number; gestureFps: number;
  captureFps: number; inferenceBackend: "CPU" | "GPU" | "—";
  detectionMs: number; gestureMs: number; totalMs: number; latencyMs: number;
  cameraWidth: number; cameraHeight: number;
};
type WorkerMessage = { type: "ready" | "disposed" } | {
  type: "result"; hands: Hand[]; gestures: GestureFrame;
  cameraFps: number; handFps: number; gestureFps: number;
  captureFps: number; inferenceBackend: "CPU" | "GPU";
  detectionMs: number; gestureMs: number; totalMs: number; latencyMs: number;
} | { type: "error"; message: string };

const EMPTY_GESTURES: GestureFrame = { hands: [], events: [], history: [] };
const emptyVision = (): VisionState => ({ hands: [], error: null, gestures: EMPTY_GESTURES, cameraFps: 0, handFps: 0, gestureFps: 0, captureFps: 0, inferenceBackend: "—", detectionMs: 0, gestureMs: 0, totalMs: 0, latencyMs: 0, cameraWidth: 0, cameraHeight: 0 });

const CONNECTIONS: [number, number][] = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
const COLORS = ["#9f83ff", "#70dba5"];
const IDLE_AFTER_MS = 650;
const IDLE_DETECTION_INTERVAL_MS = 100;
const DASHBOARD_INTERVAL_MS = 400;

function paint(canvas: HTMLCanvasElement, hands: Hand[]) {
  const { width, height } = canvas;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, width, height);
  hands.forEach((hand, handIndex) => {
    const color = COLORS[handIndex % COLORS.length];
    context.strokeStyle = color;
    context.lineWidth = Math.max(2, width / 320);
    context.beginPath();
    for (const [from, to] of CONNECTIONS) {
      const a = hand.landmarks[from], b = hand.landmarks[to];
      if (!a || !b) continue;
      context.moveTo((1 - a.x) * width, a.y * height);
      context.lineTo((1 - b.x) * width, b.y * height);
    }
    context.stroke();
    context.beginPath();
    hand.landmarks.forEach((point, index) => {
      if (index === 0) return;
      const x = (1 - point.x) * width, y = point.y * height;
      context.moveTo(x + 2.5, y);
      context.arc(x, y, 2.5, 0, Math.PI * 2);
    });
    context.fillStyle = color;
    context.fill();
    const wrist = hand.landmarks[0];
    if (wrist) {
      context.beginPath();
      context.arc((1 - wrist.x) * width, wrist.y * height, 4, 0, Math.PI * 2);
      context.fillStyle = "#fff";
      context.fill();
      context.font = "600 12px Segoe UI"; context.fillStyle = color;
      context.fillText(hand.handedness, (1 - wrist.x) * width + 8, Math.max(14, wrist.y * height - 8));
    }
  });
}

export function HandLandmarkerOverlay({ videoRef, active, onUpdate, onPinchVolume, onPointingBrightness, onAltTabGesture, onAltTabSwipe }: { videoRef: RefObject<HTMLVideoElement>; active: boolean; onUpdate: (vision: VisionState) => void; onPinchVolume: (level: number | null) => void; onPointingBrightness: (level: number | null) => void; onAltTabGesture: (active: boolean) => void; onAltTabSwipe: (id: number, forward: boolean) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!active) { if (canvasRef.current) paint(canvasRef.current, []); onPinchVolume(null); onPointingBrightness(null); onAltTabGesture(false); onUpdate(emptyVision()); return; }
    const video = videoRef.current;
    if (!video) return;
    const worker = new Worker(new URL("../vision/handLandmarker.worker.ts", import.meta.url), { type: "module" });
    let stopped = false, ready = false, busy = false, lastFrameTime = -1, animation = 0;
    let callbackId: number | null = null, lastCameraTime = -1, lastUiUpdate = 0, lastUiEventId = 0;
    let cameraWindowStart = performance.now(), cameraFrames = 0, cameraFps = 0;
    let noHandsSince: number | null = null;
    let lastCaptureAt = -Infinity;
    let displayedHandCount = 0;
    let overlayHasHands = false;
    const captureFps = video.srcObject instanceof MediaStream ? video.srcObject.getVideoTracks()[0]?.getSettings().frameRate ?? 0 : 0;
    const frameVideo = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (callback: (now: number, metadata: { mediaTime: number }) => void) => number;
      cancelVideoFrameCallback?: (id: number) => void;
    };
    const onVideoFrame = (_now: number, metadata?: { mediaTime: number }) => {
      if (stopped) return;
      const currentTime = metadata?.mediaTime ?? video.currentTime;
      const frameNow = performance.now();
      if (currentTime !== lastCameraTime) { cameraFrames += 1; lastCameraTime = currentTime; }
      if (frameNow - cameraWindowStart >= 1000) {
        cameraFps = Math.round(cameraFrames * 1000 / (frameNow - cameraWindowStart));
        cameraFrames = 0; cameraWindowStart = frameNow;
      }
      const idle = noHandsSince !== null && frameNow - noHandsSince >= IDLE_AFTER_MS;
      const detectionDue = !idle || frameNow - lastCaptureAt >= IDLE_DETECTION_INTERVAL_MS;
      if (ready && !busy && detectionDue && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && currentTime !== lastFrameTime) {
        lastFrameTime = currentTime; busy = true;
        lastCaptureAt = frameNow;
        const capturedEpoch = Date.now();
        void createImageBitmap(video).then((frame) => {
          if (stopped) { frame.close(); busy = false; return; }
          worker.postMessage({ type: "frame", frame, timestamp: frameNow, capturedEpoch, cameraFps, captureFps }, [frame]);
        }).catch((error: unknown) => {
          if (stopped) return;
          busy = false;
          onUpdate({ ...emptyVision(), error: error instanceof Error ? error.message : String(error) });
        });
      }
      scheduleFrames();
    };
    const scheduleFrames = () => {
      if (stopped) return;
      if (frameVideo.requestVideoFrameCallback) callbackId = frameVideo.requestVideoFrameCallback(onVideoFrame);
      else animation = requestAnimationFrame((now) => onVideoFrame(now));
    };
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.type === "ready") { ready = true; scheduleFrames(); }
      if (message.type === "result") {
        busy = false;
        const now = performance.now();
        const handCount = message.hands.length;
        noHandsSince = handCount ? null : (noHandsSince ?? now);
        const pinchIndex = message.gestures.hands.findIndex((hand) => hand.gesture === "PINCH");
        const pinchLandmarks = pinchIndex >= 0 ? message.hands[pinchIndex]?.landmarks : undefined;
        onPinchVolume(pinchLandmarks ? 1 - [0, 5, 9, 13, 17].reduce((sum, index) => sum + pinchLandmarks[index].x, 0) / 5 : null);
        const pointingIndex = message.gestures.hands.findIndex((hand) => hand.gesture === "POINTING_UP");
        const pointingLandmarks = pointingIndex >= 0 ? message.hands[pointingIndex]?.landmarks : undefined;
        onPointingBrightness(pointingLandmarks ? 1 - [0, 5, 9, 13, 17].reduce((sum, index) => sum + pointingLandmarks[index].x, 0) / 5 : null);
        const vSignHeld = message.gestures.hands.some((hand) => hand.gesture === "V_SIGN" || (hand.candidate === "V_SIGN" && hand.stability >= 1));
        onAltTabGesture(vSignHeld);
        for (const gestureEvent of message.gestures.events) {
          if (gestureEvent.name === "SWIPE_LEFT") onAltTabSwipe(gestureEvent.id, false);
          if (gestureEvent.name === "SWIPE_RIGHT") onAltTabSwipe(gestureEvent.id, true);
        }
        const next: VisionState = { hands: message.hands, error: null, gestures: message.gestures, cameraFps: message.cameraFps, handFps: message.handFps, gestureFps: message.gestureFps, captureFps: message.captureFps, inferenceBackend: message.inferenceBackend, detectionMs: message.detectionMs, gestureMs: message.gestureMs, totalMs: message.totalMs, latencyMs: message.latencyMs, cameraWidth: video.videoWidth, cameraHeight: video.videoHeight };
        const latestEventId = next.gestures.history[0]?.id ?? 0;
        if (now - lastUiUpdate >= DASHBOARD_INTERVAL_MS || latestEventId > lastUiEventId || handCount !== displayedHandCount) {
          lastUiUpdate = now;
          lastUiEventId = latestEventId;
          displayedHandCount = handCount;
          onUpdate(next);
        }
        if (canvasRef.current && (handCount || overlayHasHands)) {
          if (video.videoWidth && (canvasRef.current.width !== video.videoWidth || canvasRef.current.height !== video.videoHeight)) {
            canvasRef.current.width = video.videoWidth; canvasRef.current.height = video.videoHeight;
          }
          paint(canvasRef.current, next.hands);
          overlayHasHands = handCount > 0;
        }
      }
      if (message.type === "error") { busy = false; onPinchVolume(null); onPointingBrightness(null); onAltTabGesture(false); onUpdate({ ...emptyVision(), error: message.message }); }
    };
    worker.onerror = (event) => {
      onPinchVolume(null); onPointingBrightness(null); onAltTabGesture(false);
      const next = { ...emptyVision(), error: event.message || "Hand Landmarker worker failed." };
      onUpdate(next);
    };
    worker.postMessage({
      type: "initialize",
      modelUrl: new URL("/models/hand_landmarker.task", window.location.href).href,
      wasmUrl: new URL("/mediapipe/wasm/", window.location.href).href,
    });
    return () => {
      onPinchVolume(null);
      onPointingBrightness(null);
      onAltTabGesture(false);
      stopped = true; cancelAnimationFrame(animation);
      if (callbackId !== null) frameVideo.cancelVideoFrameCallback?.(callbackId);
      worker.postMessage({ type: "dispose" });
      const timeout = window.setTimeout(() => worker.terminate(), 1000);
      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        if (event.data.type === "disposed") { window.clearTimeout(timeout); worker.terminate(); }
      };
    };
  }, [active, onPinchVolume, onPointingBrightness, onAltTabGesture, onAltTabSwipe, onUpdate, videoRef]);

  return <canvas ref={canvasRef} className="hand-overlay" aria-label="Detected hand landmarks" />;
}
