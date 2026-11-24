import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import { GestureRecognizer, type HandInput } from "./gesture_recognition";

type InputMessage =
  | { type: "initialize"; modelUrl: string; wasmUrl: string }
  | { type: "frame"; frame: ImageBitmap; timestamp: number; capturedEpoch: number; cameraFps: number; captureFps: number }
  | { type: "dispose" };

let landmarker: HandLandmarker | null = null;
let stopping = false;
let inferenceBackend: "CPU" | "GPU" = "CPU";
const samples: number[] = [];
const detectionTimes: number[] = [];
const gestureTimes: number[] = [];
const totalTimes: number[] = [];
const gestureRecognizer = new GestureRecognizer();

function average(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length); }
function remember(values: number[], value: number) { values.push(value); if (values.length > 30) values.shift(); }

function dispose() {
  if (landmarker) {
    landmarker.close();
    landmarker = null;
  }
}

self.onmessage = (event: MessageEvent<InputMessage>) => {
  const message = event.data;
  if (message.type === "initialize") {
    void (async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(message.wasmUrl, true);
        const options = {
          runningMode: "VIDEO" as const,
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        };
        try {
          landmarker = await HandLandmarker.createFromOptions(vision, {
            ...options, baseOptions: { modelAssetPath: message.modelUrl, delegate: "GPU" },
          });
          inferenceBackend = "GPU";
        } catch {
          landmarker = await HandLandmarker.createFromOptions(vision, {
            ...options, baseOptions: { modelAssetPath: message.modelUrl, delegate: "CPU" },
          });
          inferenceBackend = "CPU";
        }
        if (stopping) {
          dispose();
          self.postMessage({ type: "disposed" });
        } else {
          self.postMessage({ type: "ready" });
        }
      } catch (error) {
        self.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
      }
    })();
    return;
  }
  if (message.type === "dispose") {
    stopping = true;
    gestureRecognizer.reset();
    if (landmarker) {
      dispose();
      self.postMessage({ type: "disposed" });
    }
    return;
  }
  if (message.type === "frame") {
    try {
      if (!landmarker || stopping) return;
      const started = performance.now();
      const result = landmarker.detectForVideo(message.frame, message.timestamp);
      const detectionMs = performance.now() - started;
      const now = performance.now();
      samples.push(now);
      while (samples.length && samples[0] < now - 1000) samples.shift();
      const hands = result.landmarks.map((points, index) => ({
        handedness: result.handedness[index]?.[0]?.categoryName ?? "Unknown",
        landmarks: points.map(({ x, y, z }) => ({ x, y, z })),
      }));
      const gestureStarted = performance.now();
      const gestures = gestureRecognizer.process(hands as HandInput[], message.timestamp);
      const gestureMs = performance.now() - gestureStarted;
      const totalMs = performance.now() - started;
      remember(detectionTimes, detectionMs);
      remember(gestureTimes, gestureMs);
      remember(totalTimes, totalMs);
      self.postMessage({
        type: "result", hands, gestures,
        cameraFps: message.cameraFps,
        captureFps: message.captureFps,
        inferenceBackend,
        handFps: samples.length,
        gestureFps: samples.length,
        detectionMs: average(detectionTimes),
        gestureMs: average(gestureTimes),
        totalMs: average(totalTimes),
        latencyMs: Date.now() - message.capturedEpoch,
      });
    } catch (error) {
      self.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      message.frame.close();
    }
  }
};
