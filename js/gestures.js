// Pure gesture math over 21 MediaPipe hand landmarks (from HÄND STUDIO).
// Landmarks are normalized {x,y,z} in the *unmirrored* video space (0..1).

import { GESTURE } from './config.js';

const TIP = { thumb: 4, index: 8, middle: 12, ring: 16, pinky: 20 };
const WRIST = 0;
const MID_MCP = 9;

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function handSize(lm) {
  return dist(lm[WRIST], lm[MID_MCP]) || 1e-6;
}

// distance thumb-tip ↔ index-tip, normalized to hand size
export function pinchAmount(lm) {
  return dist(lm[TIP.thumb], lm[TIP.index]) / handSize(lm);
}

// Fist: every fingertip pulled in close to the wrist. A pinch doesn't pass —
// its thumb+index tips sit far forward of the palm.
export function isFist(lm) {
  const max = GESTURE.fistReach * handSize(lm);
  return (
    dist(lm[WRIST], lm[TIP.index]) < max &&
    dist(lm[WRIST], lm[TIP.middle]) < max &&
    dist(lm[WRIST], lm[TIP.ring]) < max &&
    dist(lm[WRIST], lm[TIP.pinky]) < max
  );
}

// The point a hand grabs with: midpoint of thumb & index tips — which is
// exactly the pinch point once the fingers close.
export function gripPoint(lm) {
  const t = lm[TIP.thumb];
  const i = lm[TIP.index];
  return { x: (t.x + i.x) / 2, y: (t.y + i.y) / 2 };
}
