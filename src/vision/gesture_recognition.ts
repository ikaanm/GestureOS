export type GestureName = "OPEN_PALM" | "POINTING_UP" | "FIST" | "V_SIGN" | "PINCH" | "SWIPE_LEFT" | "SWIPE_RIGHT";
export type Landmark = { x: number; y: number; z: number };
export type HandInput = { handedness: string; landmarks: Landmark[] };
export type GestureEvent = { id: number; name: GestureName; hand: string; confidence: number; timestamp: number };
export type GestureHandState = { hand: string; candidate: GestureName | null; gesture: GestureName | null; confidence: number; stability: number };
export type GestureFrame = { hands: GestureHandState[]; events: GestureEvent[]; history: GestureEvent[] };

export type GestureConfig = {
  smoothingAlpha: number;
  staticHoldMs: number;
  cooldownMs: number;
  pinchRatio: number;
  fingerStraightAngle: number;
  fingerCurledAngle: number;
  swipeWindowMs: number;
  swipeMinDistance: number;
  swipeMinSpeed: number;
  swipeMinEfficiency: number;
  swipeCooldownMs: number;
};

export const DEFAULT_GESTURE_CONFIG: GestureConfig = {
  smoothingAlpha: 0.45,
  staticHoldMs: 380,
  cooldownMs: 750,
  pinchRatio: 0.32,
  fingerStraightAngle: 150,
  fingerCurledAngle: 137,
  swipeWindowMs: 360,
  swipeMinDistance: 0.1,
  swipeMinSpeed: 0.30,
  swipeMinEfficiency: 0.60,
  swipeCooldownMs: 300,
};

type Sample = { x: number; y: number; time: number };
type Track = {
  points: Landmark[];
  candidate: GestureName | null;
  candidateSince: number;
  activeGesture: GestureName | null;
  lastTriggered: number;
  lastSwipe: number;
  swipeArmed: boolean;
  stillSince: number;
  samples: Sample[];
};

const TRACKED_GESTURES = new Set<GestureName>(["OPEN_PALM", "POINTING_UP", "FIST", "V_SIGN", "PINCH"]);
let eventSequence = 0;

function dist(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function angle(a: Landmark, vertex: Landmark, c: Landmark): number {
  const ax = a.x - vertex.x, ay = a.y - vertex.y;
  const cx = c.x - vertex.x, cy = c.y - vertex.y;
  const denominator = Math.hypot(ax, ay) * Math.hypot(cx, cy);
  if (!denominator) return 0;
  return Math.acos(Math.max(-1, Math.min(1, (ax * cx + ay * cy) / denominator))) * 180 / Math.PI;
}

function clamp(value: number, min = 0, max = 1): number { return Math.max(min, Math.min(max, value)); }

function blend(previous: Landmark[], next: Landmark[], alpha: number): Landmark[] {
  if (previous.length !== next.length) return next.map((p) => ({ ...p }));
  return next.map((point, i) => ({
    x: previous[i].x + alpha * (point.x - previous[i].x),
    y: previous[i].y + alpha * (point.y - previous[i].y),
    z: previous[i].z + alpha * (point.z - previous[i].z),
  }));
}

function classify(points: Landmark[], config: GestureConfig): { name: GestureName | null; confidence: number } {
  if (points.length < 21) return { name: null, confidence: 0 };
  const wrist = points[0];
  const palmScale = [5, 9, 13, 17].reduce((sum, index) => sum + dist(wrist, points[index]), 0) / 4;
  if (palmScale < 0.015) return { name: null, confidence: 0 };

  const pinchRatio = dist(points[4], points[8]) / palmScale;
  if (pinchRatio < config.pinchRatio) return { name: "PINCH", confidence: clamp(0.68 + (config.pinchRatio - pinchRatio) * 0.8, 0.68, 0.98) };

  const fingerAngles = [
    angle(points[5], points[6], points[8]),
    angle(points[9], points[10], points[12]),
    angle(points[13], points[14], points[16]),
    angle(points[17], points[18], points[20]),
  ];
  const thumbAngle = angle(points[2], points[3], points[4]);
  const extended = fingerAngles.map((value) => value >= config.fingerStraightAngle);
  const curled = fingerAngles.map((value) => value <= config.fingerCurledAngle);
  const thumbExtended = thumbAngle >= config.fingerStraightAngle && dist(points[4], points[5]) / palmScale > 0.55;
  const extensionConfidence = (values: number[]) => values.reduce((sum, value) => sum + clamp((value - config.fingerStraightAngle) / (180 - config.fingerStraightAngle)), 0) / values.length;
  const curlConfidence = (values: number[]) => values.reduce((sum, value) => sum + clamp((config.fingerCurledAngle - value) / config.fingerCurledAngle), 0) / values.length;

  if (extended.every(Boolean) && thumbExtended) return { name: "OPEN_PALM", confidence: clamp(0.68 + 0.3 * (extensionConfidence(fingerAngles) + clamp((thumbAngle - config.fingerStraightAngle) / 30)) / 2, 0.68, 0.98) };
  if (extended[0] && extended[1] && curled[2] && curled[3] && dist(points[8], points[12]) / palmScale > 0.25) {
    return { name: "V_SIGN", confidence: clamp(0.68 + 0.3 * (extensionConfidence(fingerAngles.slice(0, 2)) + curlConfidence(fingerAngles.slice(2))) / 2, 0.68, 0.98) };
  }
  if (extended[0] && curled.slice(1).every(Boolean) && points[8].y < points[6].y - palmScale * 0.12) {
    return { name: "POINTING_UP", confidence: clamp(0.68 + 0.3 * (extensionConfidence([fingerAngles[0]]) + curlConfidence(fingerAngles.slice(1))) / 2, 0.68, 0.98) };
  }
  if (curled.every(Boolean)) return { name: "FIST", confidence: clamp(0.68 + 0.3 * curlConfidence(fingerAngles), 0.68, 0.98) };
  return { name: null, confidence: 0 };
}

function palmX(points: Landmark[]): number {
  return (points[0].x + points[5].x + points[9].x + points[13].x + points[17].x) / 5;
}

export class GestureRecognizer {
  readonly config: GestureConfig;
  private readonly tracks = new Map<string, Track>();
  private readonly history: GestureEvent[] = [];

  constructor(config: GestureConfig = DEFAULT_GESTURE_CONFIG) { this.config = { ...config }; }

  reset(): GestureFrame {
    this.tracks.clear();
    return { hands: [], events: [], history: [...this.history] };
  }

  process(input: HandInput[], timestamp: number): GestureFrame {
    const events: GestureEvent[] = [];
    const activeKeys = new Set<string>();
    const states: GestureHandState[] = [];

    input.forEach((hand, index) => {
      if (hand.landmarks.length < 21) return;
      const key = `${hand.handedness}:${index}`;
      activeKeys.add(key);
      let track = this.tracks.get(key);
      if (!track) {
        track = { points: hand.landmarks.map((p) => ({ ...p })), candidate: null, candidateSince: timestamp, activeGesture: null, lastTriggered: -Infinity, lastSwipe: -Infinity, swipeArmed: true, stillSince: timestamp, samples: [] };
        this.tracks.set(key, track);
      } else {
        const previousTime = track.samples[track.samples.length - 1]?.time ?? timestamp - 50;
        const elapsedMs = Math.max(1, timestamp - previousTime);
        // Keep the filter's time constant stable when the inference FPS varies.
        const alpha = 1 - Math.pow(1 - this.config.smoothingAlpha, elapsedMs / 50);
        track.points = blend(track.points, hand.landmarks, alpha);
      }

      const pose = classify(track.points, this.config);
      const candidate = pose.name;
      if (candidate !== track.candidate) {
        track.candidate = candidate;
        track.candidateSince = timestamp;
      }
      const stableFor = candidate && TRACKED_GESTURES.has(candidate) ? timestamp - track.candidateSince : 0;
      const stability = candidate ? clamp(stableFor / this.config.staticHoldMs) : 0;
      let recognized = candidate && stability >= 1 ? candidate : null;
      let confidence = candidate ? clamp(pose.confidence * (0.65 + 0.35 * stability)) : 0;

      const x = palmX(track.points);
      const y = (track.points[0].y + track.points[5].y + track.points[9].y + track.points[13].y + track.points[17].y) / 5;
      track.samples.push({ x, y, time: timestamp });
      track.samples = track.samples.filter((sample) => timestamp - sample.time <= this.config.swipeWindowMs);
      const first = track.samples[0], last = track.samples[track.samples.length - 1];
      if (first && last && last.time > first.time) {
        const dx = last.x - first.x;
        const dy = last.y - first.y;
        const elapsedSeconds = (last.time - first.time) / 1000;
        const path = track.samples.slice(1).reduce((sum, sample, i) => sum + Math.hypot(sample.x - track.samples[i].x, sample.y - track.samples[i].y), 0);
        const directDistance = Math.hypot(dx, dy);
        const efficiency = path > 0 ? directDistance / path : 0;
        const speed = Math.abs(dx) / elapsedSeconds;
        const horizontal = Math.abs(dx) > Math.max(this.config.swipeMinDistance, Math.abs(dy) * 1.35);
        if (track.swipeArmed && timestamp - track.lastSwipe >= this.config.swipeCooldownMs && horizontal && Math.abs(dx) >= this.config.swipeMinDistance && speed >= this.config.swipeMinSpeed && efficiency >= this.config.swipeMinEfficiency) {
          // Direction follows the horizontally mirrored camera preview.
          const swipe: GestureName = dx < 0 ? "SWIPE_RIGHT" : "SWIPE_LEFT";
          const swipeConfidence = clamp(0.62 + 0.18 * Math.min(Math.abs(dx) / (this.config.swipeMinDistance * 2), 1) + 0.2 * efficiency);
          events.push(this.emit(swipe, hand.handedness, swipeConfidence, timestamp));
          recognized = swipe;
          confidence = swipeConfidence;
          track.lastSwipe = timestamp;
          track.swipeArmed = false;
          track.samples = [last];
        }
        if (directDistance < 0.055 && speed < 0.18) {
          if (timestamp - track.stillSince > 100) track.swipeArmed = true;
        } else {
          track.stillSince = timestamp;
        }
      }

      if (recognized && TRACKED_GESTURES.has(recognized)) {
        if (track.activeGesture !== recognized && timestamp - track.lastTriggered >= this.config.cooldownMs) {
          events.push(this.emit(recognized, hand.handedness, confidence, timestamp));
          track.lastTriggered = timestamp;
          track.activeGesture = recognized;
        }
      } else if (!candidate) {
        track.activeGesture = null;
      }
      states.push({ hand: hand.handedness, candidate, gesture: recognized, confidence, stability });
    });

    for (const key of this.tracks.keys()) if (!activeKeys.has(key)) this.tracks.delete(key);
    return { hands: states, events, history: [...this.history] };
  }

  private emit(name: GestureName, hand: string, confidence: number, timestamp: number): GestureEvent {
    const event = { id: ++eventSequence, name, hand, confidence, timestamp };
    this.history.unshift(event);
    this.history.splice(8);
    return event;
  }
}
