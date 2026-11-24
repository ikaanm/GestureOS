import assert from "node:assert/strict";
import { GestureRecognizer } from "../src/vision/gesture_recognition.ts";

const base = () => {
  const p = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  Object.assign(p[0], { x: 0.5, y: 0.72 });
  Object.assign(p[5], { x: 0.39, y: 0.54 }); Object.assign(p[6], { x: 0.39, y: 0.43 }); Object.assign(p[7], { x: 0.39, y: 0.32 }); Object.assign(p[8], { x: 0.39, y: 0.22 });
  Object.assign(p[9], { x: 0.47, y: 0.51 }); Object.assign(p[10], { x: 0.47, y: 0.40 }); Object.assign(p[11], { x: 0.47, y: 0.29 }); Object.assign(p[12], { x: 0.47, y: 0.19 });
  Object.assign(p[13], { x: 0.55, y: 0.54 }); Object.assign(p[14], { x: 0.55, y: 0.43 }); Object.assign(p[15], { x: 0.55, y: 0.33 }); Object.assign(p[16], { x: 0.55, y: 0.24 });
  Object.assign(p[17], { x: 0.63, y: 0.58 }); Object.assign(p[18], { x: 0.63, y: 0.48 }); Object.assign(p[19], { x: 0.63, y: 0.39 }); Object.assign(p[20], { x: 0.63, y: 0.32 });
  Object.assign(p[1], { x: 0.42, y: 0.63 }); Object.assign(p[2], { x: 0.37, y: 0.63 }); Object.assign(p[3], { x: 0.32, y: 0.58 }); Object.assign(p[4], { x: 0.23, y: 0.51 });
  return p;
};
const curl = (p, baseIndex, pip, tip, x) => {
  Object.assign(p[pip], { x, y: p[baseIndex].y - 0.11 });
  Object.assign(p[tip], { x: x + 0.06, y: p[pip].y + 0.02 });
};
const pose = (name) => {
  const p = base();
  if (name === "FIST") curl(p, 5, 6, 8, 0.39);
  if (["FIST", "POINTING_UP"].includes(name)) curl(p, 9, 10, 12, 0.47);
  if (["FIST", "POINTING_UP", "V_SIGN"].includes(name)) curl(p, 13, 14, 16, 0.55);
  if (["FIST", "POINTING_UP", "V_SIGN"].includes(name)) curl(p, 17, 18, 20, 0.63);
  if (["FIST", "POINTING_UP", "V_SIGN"].includes(name)) {
    Object.assign(p[2], { x: 0.42, y: 0.61 }); Object.assign(p[3], { x: 0.43, y: 0.58 }); Object.assign(p[4], { x: 0.47, y: 0.59 });
  }
  if (name === "PINCH") Object.assign(p[4], { ...p[8] });
  return p;
};
const runStatic = (name) => {
  const recognizer = new GestureRecognizer(); let state;
  for (let time = 0; time <= 600; time += 50) state = recognizer.process([{ handedness: "Right", landmarks: pose(name) }], time);
  assert.equal(state.hands[0]?.gesture, name, `${name} should stabilize`);
  assert.equal(state.history[0]?.name, name, `${name} should emit once stable`);
  assert.ok(state.hands[0].confidence > 0.6, `${name} should have useful confidence`);
};

for (const gesture of ["OPEN_PALM", "POINTING_UP", "FIST", "V_SIGN", "PINCH"]) runStatic(gesture);

const runSwipe = (direction) => {
  const recognizer = new GestureRecognizer(); const events = [];
  for (let time = 0; time <= 500; time += 40) {
    const offset = time / 500 * 0.32 * direction;
    const landmarks = pose("OPEN_PALM").map((p) => ({ ...p, x: p.x + offset }));
    events.push(...recognizer.process([{ handedness: "Right", landmarks }], time).events);
  }
  const swipes = events.filter((event) => event.name.startsWith("SWIPE_"));
  assert.ok(swipes.some((event) => event.name === (direction > 0 ? "SWIPE_LEFT" : "SWIPE_RIGHT")), `swipe ${direction} should be detected`);
  assert.equal(swipes.length, 1, `swipe ${direction} should trigger only once`);
};
runSwipe(1); runSwipe(-1);

const jitter = new GestureRecognizer(); const jitterEvents = [];
for (let time = 0; time <= 1000; time += 40) {
  const offset = time % 80 === 0 ? 0.012 : -0.012;
  const landmarks = pose("OPEN_PALM").map((p) => ({ ...p, x: p.x + offset }));
  jitterEvents.push(...jitter.process([{ handedness: "Right", landmarks }], time).events);
}
assert.ok(!jitterEvents.some((event) => event.name.startsWith("SWIPE_")), "small jitter must not trigger a swipe");
const slow = new GestureRecognizer(); const slowEvents = [];
for (let time = 0; time <= 1800; time += 40) {
  const offset = time / 1800 * 0.32;
  const landmarks = pose("OPEN_PALM").map((p) => ({ ...p, x: p.x + offset }));
  slowEvents.push(...slow.process([{ handedness: "Right", landmarks }], time).events);
}
assert.ok(!slowEvents.some((event) => event.name.startsWith("SWIPE_")), "slow movement must not trigger a swipe");
const missing = jitter.process([], 1100);
assert.equal(missing.hands.length, 0, "hand loss clears current state");

console.log("Gesture recognition checks passed: 5 static gestures, both swipes, single-trigger cooldown, jitter and slow-movement rejection, and hand-loss reset.");
