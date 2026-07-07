// Blendshapes + head motion → the five axis readings, smoothed.
// Pure math (computeRaw, motionFeatures) is exported for headless tests.

import { AXES, SMOOTH } from './config.js';

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// One axis: bias + Σ weight·blendshape + Σ weight·feature, clamped to 0..1.
export function computeRaw(def, shapes, features = {}) {
  let v = def.bias || 0;
  for (const name in def.weights) v += def.weights[name] * (shapes[name] || 0);
  if (def.features) {
    for (const f in def.features) v += def.features[f] * (features[f] || 0);
  }
  return clamp01(v);
}

// Head-motion features from face landmarks across frames.
//   prev/curr: {x, y} face centre in video px; faceSize in video px;
//   rollRad: head roll in radians; dtMs since last frame.
export function motionFeatures(prev, curr, faceSize, rollRad, dtMs) {
  let speed = 0;
  if (prev && dtMs > 0 && faceSize > 0) {
    const d = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    speed = clamp01(d / faceSize / (dtMs / 1000) / SMOOTH.speedNorm);
  }
  return {
    speed,
    still: 1 - speed,
    roll: clamp01(Math.abs(rollRad) / SMOOTH.rollNorm),
  };
}

// Landmark indices (MediaPipe 478-point face topology).
export const LM = { eyeR: 33, eyeL: 263, nose: 1 };

export class AxisEngine {
  constructor() {
    this.values = AXES.map(() => 0.3);
    this._prevCenter = null;
    this._speedSm = 0;
  }

  // face: { landmarks, shapes } from tracking.detectFace; video dims in px.
  update(face, videoW, videoH, dtMs) {
    if (!face) return this.values;
    const lm = face.landmarks;
    const a = lm[LM.eyeR];
    const b = lm[LM.eyeL];
    const center = {
      x: ((a.x + b.x) / 2) * videoW,
      y: ((a.y + b.y) / 2) * videoH,
    };
    const faceSize = Math.hypot((b.x - a.x) * videoW, (b.y - a.y) * videoH);
    const roll = Math.atan2((b.y - a.y) * videoH, (b.x - a.x) * videoW);

    const feats = motionFeatures(this._prevCenter, center, faceSize, roll, dtMs);
    // speed is spiky frame to frame — smooth it before it drives axes
    this._speedSm = this._speedSm * 0.8 + feats.speed * 0.2;
    feats.speed = this._speedSm;
    feats.still = 1 - this._speedSm;
    this._prevCenter = center;

    for (let i = 0; i < AXES.length; i++) {
      const raw = computeRaw(AXES[i], face.shapes, feats);
      this.values[i] += (raw - this.values[i]) * SMOOTH.axisLerp;
    }
    return this.values;
  }
}
