// VIBE UNIT — orchestration: camera → face/mask/hands → axis engine →
// head warp into the radar → scan ritual → verdict + poster.
// One mirrored render loop. Vanilla ES modules, no build.

import { BRAND, AXES, CHART, GESTURE, SCAN, SMOOTH, TICKER, STATUS, WARP } from './config.js';
import { startCamera, CameraError } from './camera.js';
import * as T from './tracking.js';
import * as G from './gestures.js';
import { AxisEngine, LM } from './axes.js';
import { HeadWarp, polygonRadii, silhouetteRadii, smoothProfile } from './warp.js';
import * as HUD from './hud.js';
import { pickResult, nextReadingNo } from './results.js';
import { renderPoster, downloadPoster } from './poster.js';

// ── DOM ──
const el = (id) => document.getElementById(id);
const video = el('cam');
const canvas = el('view');
const ctx = canvas.getContext('2d');
const startScreen = el('startScreen');
const errorScreen = el('errorScreen');
const loading = el('loading');
const resultCard = el('resultCard');
startScreen.querySelector('.eyebrow').textContent = `${BRAND.watermark} — ${BRAND.build}`;

// ── State ──
const engine = new AxisEngine();
const warp = new HeadWarp();
let dpr = Math.min(window.devicePixelRatio || 1, 2);
let running = false;
let mode = 'AUTO'; // 'AUTO' | 'SCULPT'
let phase = 'LIVE'; // 'LIVE' | 'SCAN' | 'LOCKED'
let status = STATUS.BOOTING;

let chart = null; // { cx, cy, innerR, outerR, s } device px
let face = null; // last face detection
let faceSeenAt = 0;
let rBase = null; // smoothed silhouette profile, device px
let headPx = null; // head centre in canvas device px

let sculptValues = AXES.map(() => 0.3);
const grabbed = new Map(); // hand index (or 'mouse') → axis index
const pinched = new Map(); // hand index → bool (hysteresis)
let fistHold = 0;

let scanStart = 0;
let scanSum = null;
let scanFrames = 0;
let flashAt = 0;
let locked = null; // { values, snapshot, result, readingNo }

let fps = 0;
let lastNow = performance.now();

// ── Sizing ──
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  const m = Math.min(canvas.width, canvas.height);
  chart = {
    cx: canvas.width / 2,
    cy: canvas.height / 2,
    innerR: m * CHART.innerR,
    outerR: m * CHART.outerR,
    s: dpr,
  };
  warp.setSize(Math.round(2 * (chart.outerR + CHART.pad * dpr)));
  rBase = null; // profile is in device px — rebuild after resize
}
window.addEventListener('resize', resize);

// Cover-fit mapping video ↔ mirrored canvas (device px).
function coverFit() {
  const w = canvas.width;
  const h = canvas.height;
  const vw = video.videoWidth || w;
  const vh = video.videoHeight || h;
  const scale = Math.max(w / vw, h / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  return { w, h, vw, vh, scale, dw, dh, ox: (w - dw) / 2, oy: (h - dh) / 2 };
}
const mapPoint = (cov, p) => ({
  x: cov.w - (cov.ox + p.x * cov.dw),
  y: cov.oy + p.y * cov.dh,
});

// ── Per-frame step ──
function step(now, dtMs) {
  const cov = coverFit();
  const camReady = video.readyState >= 2;

  // detection
  const f = camReady ? T.detectFace(video, now) : null;
  if (f) {
    face = f;
    faceSeenAt = now;
  } else if (now - faceSeenAt > 600) {
    face = null;
  }
  if (camReady) T.segment(video, now);
  const hands = mode === 'SCULPT' && camReady ? T.detectHands(video, now) : [];

  // axis readings (always run, so SCULPT's fist-reset has a live target)
  if (face) engine.update(face, cov.vw, cov.vh, dtMs);
  const values = phase === 'LOCKED'
    ? locked.values
    : mode === 'SCULPT' ? sculptValues : engine.values;

  // sculpt interactions
  const gripsPx = [];
  if (mode === 'SCULPT' && phase !== 'LOCKED') {
    updateSculpt(hands, cov, gripsPx);
  }

  // scan ritual
  if (phase === 'SCAN') {
    for (let i = 0; i < values.length; i++) scanSum[i] += values[i];
    scanFrames++;
    if (now - scanStart >= SCAN.durationMs) lock(now);
  }

  // head warp profiles
  const mask = T.getMask();
  let headOk = false;
  if (face && mask && warp.ok && phase !== 'LOCKED') {
    const a = face.landmarks[LM.eyeR];
    const b = face.landmarks[LM.eyeL];
    const n = face.landmarks[LM.nose];
    const emx = (a.x + b.x) / 2;
    const emy = (a.y + b.y) / 2;
    const cxN = emx + (n.x - emx) * WARP.centerBias;
    const cyN = emy + (n.y - emy) * WARP.centerBias;
    const faceSizeV = Math.hypot((b.x - a.x) * cov.vw, (b.y - a.y) * cov.vh);
    const sil = silhouetteRadii(
      mask,
      cxN * cov.vw, cyN * cov.vh,
      WARP.minR * faceSizeV, WARP.maxR * faceSizeV,
      WARP.rays, cov.vw, cov.vh
    );
    smoothProfile(sil, 2);
    if (!rBase) rBase = new Float32Array(WARP.rays);
    const fresh = !headPx;
    for (let i = 0; i < WARP.rays; i++) {
      const px = sil[i] * cov.scale; // video px → canvas device px
      rBase[i] = fresh ? px : rBase[i] + (px - rBase[i]) * SMOOTH.profileLerp;
    }
    headPx = mapPoint(cov, { x: cxN, y: cyN });
    const rTarget = polygonRadii(values, WARP.rays, chart.innerR, chart.outerR);
    headOk = warp.render(video, mask, rBase, rTarget, headPx, cov, dpr);
  }
  if (!face) headPx = null;

  // ── draw ──
  ctx.fillStyle = '#0a0a0c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  HUD.drawChartBase(ctx, chart);

  const box = warp.canvas.width;
  if (phase === 'LOCKED' && locked.snapshot) {
    ctx.drawImage(locked.snapshot, chart.cx - box / 2, chart.cy - box / 2);
  } else if (headOk) {
    ctx.drawImage(warp.canvas, chart.cx - box / 2, chart.cy - box / 2);
  }

  const dominant = values.indexOf(Math.max(...values));
  HUD.drawChartLabels(ctx, chart, values, dominant);
  if (phase === 'SCAN') {
    HUD.drawScanRing(ctx, chart, (now - scanStart) / SCAN.durationMs);
  }
  HUD.drawFlash(ctx, chart, now, flashAt, SCAN.flashMs);
  for (const g of gripsPx) HUD.drawGrip(ctx, g, dpr, g.active);

  // status
  if (phase === 'SCAN') status = STATUS.SAMPLING;
  else if (phase === 'LOCKED') status = STATUS.LOCKED;
  else if (!face) status = STATUS.NOFACE;
  else status = mode === 'SCULPT' ? STATUS.SCULPTING : STATUS.READING;

  updateHud(hands.length);
}

// ── SCULPT: pinch a spike tip and pull it; fists snap back to AUTO. ──
function updateSculpt(hands, cov, gripsPx) {
  const grabR = GESTURE.grabRadiusPx * dpr;

  hands.forEach((lm, hi) => {
    const amt = G.pinchAmount(lm);
    const was = pinched.get(hi) || false;
    const isP = amt < (was ? GESTURE.pinchReleaseRatio : GESTURE.pinchRatio);
    pinched.set(hi, isP);
    const grip = mapPoint(cov, G.gripPoint(lm));

    if (isP && !grabbed.has(hi)) {
      const k = nearestTip(grip, grabR);
      if (k >= 0) grabbed.set(hi, k);
    }
    if (!isP) grabbed.delete(hi);
    if (grabbed.has(hi)) setAxisFromPoint(grabbed.get(hi), grip);
    gripsPx.push({ ...grip, active: grabbed.has(hi) });
  });
  for (const hi of [...grabbed.keys()]) {
    if (hi !== 'mouse' && hi >= hands.length) grabbed.delete(hi);
  }

  // fists (all visible hands, held) → snap back to the live reading
  if (hands.length > 0 && hands.every((lm) => G.isFist(lm))) {
    if (++fistHold >= GESTURE.fistHoldFrames) {
      sculptValues = engine.values.slice();
      fistHold = 0;
    }
  } else {
    fistHold = 0;
  }
}

function nearestTip(p, maxDist) {
  let best = -1;
  let bestD = maxDist;
  for (let k = 0; k < AXES.length; k++) {
    const tip = HUD.spikeTip(chart, k, sculptValues[k]);
    const d = Math.hypot(p.x - tip.x, p.y - tip.y);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

function setAxisFromPoint(k, p) {
  const a = HUD.axisAngle(k);
  const r =
    (p.x - chart.cx) * Math.cos(a) + (p.y - chart.cy) * Math.sin(a);
  sculptValues[k] = Math.min(
    1,
    Math.max(0, (r - chart.innerR) / (chart.outerR - chart.innerR))
  );
}

// ── The ritual ──
function startScan() {
  if (phase !== 'LIVE' || !running) return;
  phase = 'SCAN';
  scanStart = performance.now();
  scanSum = AXES.map(() => 0);
  scanFrames = 0;
}

function lock(now) {
  const values =
    scanFrames > 0
      ? scanSum.map((s) => s / scanFrames)
      : (mode === 'SCULPT' ? sculptValues : engine.values).slice();
  const result = pickResult(values);
  locked = {
    values,
    snapshot: warp.ok ? warp.snapshot() : null,
    result,
    readingNo: nextReadingNo(),
  };
  phase = 'LOCKED';
  flashAt = now;
  el('resName').textContent = result.name.toLowerCase();
  el('resCopy').textContent = result.copy;
  el('resNo').textContent = locked.readingNo;
  resultCard.hidden = false;
}

function reset() {
  phase = 'LIVE';
  locked = null;
  resultCard.hidden = true;
}

function toggleMode() {
  if (phase === 'LOCKED') reset();
  if (mode === 'AUTO') {
    mode = 'SCULPT';
    sculptValues = engine.values.slice();
    if (!T.ready.hands) {
      setLoading('LOADING HAND MODEL…');
      T.loadHands().finally(() => setLoading(null));
    }
  } else {
    mode = 'AUTO';
    grabbed.clear();
  }
}

async function savePoster() {
  if (phase !== 'LOCKED' || !locked) return;
  const poster = await renderPoster(locked);
  downloadPoster(
    poster,
    `vibe-unit-${locked.readingNo.replace(/\D+/g, '')}.png`
  );
}

// ── HUD DOM ──
const rStatus = el('rStatus');
const rFps = el('rFps');
const rInput = el('rInput');
const rMode = el('rMode');

function updateHud(nHands) {
  if (rStatus.textContent !== status) rStatus.textContent = status;
  rStatus.classList.toggle('is-locked', phase === 'LOCKED');
  rStatus.classList.toggle('is-scan', phase === 'SCAN');
  rFps.textContent = String(Math.round(fps)).padStart(2, '0');
  const input =
    mode === 'SCULPT'
      ? `${nHands} HAND${nHands === 1 ? '' : 'S'}`
      : face ? 'FACE LOCK' : 'NO FACE';
  if (rInput.textContent !== input) rInput.textContent = input;
  const m = mode === 'SCULPT' ? 'SCULPT' : 'AUTO READ';
  if (rMode.textContent !== m) rMode.textContent = m;
}

function setLoading(text) {
  if (text) {
    loading.querySelector('span').textContent = text;
    loading.hidden = false;
  } else {
    loading.hidden = true;
  }
}

// ── Loop ──
function frame() {
  if (!running) return;
  const now = performance.now();
  const dt = now - lastNow;
  lastNow = now;
  fps = fps * 0.9 + (1000 / Math.max(dt, 1)) * 0.1;
  step(now, dt);
  requestAnimationFrame(frame);
}

// ── State-aware ticker ──
let tick = 0;
function tickerLines() {
  if (phase === 'SCAN') return TICKER.scanning;
  if (phase === 'LOCKED') return TICKER.locked;
  if (!face) return TICKER.noface;
  return mode === 'SCULPT' ? TICKER.sculpt : TICKER.live;
}
function startTicker() {
  const node = el('ticker');
  setInterval(() => {
    node.classList.add('blink');
    setTimeout(() => {
      const lines = tickerLines();
      tick = (tick + 1) % lines.length;
      node.textContent = lines[tick];
      node.classList.remove('blink');
    }, 250);
  }, TICKER.intervalMs);
}

// ── Input ──
function bindInput() {
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === ' ') {
      e.preventDefault();
      startScan();
    } else if (k === 'r') reset();
    else if (k === 'm') toggleMode();
    else if (k === 's') savePoster();
  });

  el('kRead').addEventListener('click', startScan);
  el('kMode').addEventListener('click', toggleMode);
  el('kReset').addEventListener('click', reset);
  el('kSave').addEventListener('click', savePoster);
  el('saveBtn').addEventListener('click', savePoster);
  el('againBtn').addEventListener('click', reset);

  // mouse/touch: drag a spike tip (SCULPT only)
  const pt = (e) => {
    const r = canvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return { x: (src.clientX - r.left) * dpr, y: (src.clientY - r.top) * dpr };
  };
  const down = (e) => {
    if (mode !== 'SCULPT' || phase === 'LOCKED') return;
    const k = nearestTip(pt(e), GESTURE.grabRadiusPx * dpr);
    if (k >= 0) grabbed.set('mouse', k);
  };
  const move = (e) => {
    if (grabbed.has('mouse')) setAxisFromPoint(grabbed.get('mouse'), pt(e));
  };
  const up = () => grabbed.delete('mouse');
  canvas.addEventListener('mousedown', down);
  canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
  canvas.addEventListener('touchstart', down, { passive: true });
  canvas.addEventListener('touchmove', move, { passive: true });
  window.addEventListener('touchend', up);
}

// ── Boot ──
async function boot() {
  startScreen.hidden = true;
  errorScreen.hidden = true;
  setLoading('LOADING FACE MODEL…');
  try {
    await startCamera(video);
  } catch (err) {
    setLoading(null);
    showError(err);
    return;
  }
  video.classList.add('pip');
  el('pipTag').hidden = false;
  resize();
  running = true;
  lastNow = performance.now();
  requestAnimationFrame(frame);
  startTicker();

  T.loadCore().finally(() => setLoading(null));
}

function showError(err) {
  errorScreen.hidden = false;
  const title = el('errTitle');
  const msg = el('errMsg');
  if (err instanceof CameraError && err.kind === 'denied') {
    title.textContent = 'Camera blocked.';
    msg.textContent =
      'Allow camera access in your browser’s site settings, then try again. Nothing is recorded — the feed stays on your device.';
  } else if (err instanceof CameraError && err.kind === 'notfound') {
    title.textContent = 'No camera found.';
    msg.textContent = 'Plug in or enable a webcam and try again.';
  } else if (err instanceof CameraError && err.kind === 'insecure') {
    title.textContent = 'Needs a secure link.';
    msg.textContent = err.message;
  } else {
    title.textContent = 'Something went wrong.';
    msg.textContent = err?.message || 'Could not start the camera.';
  }
}

el('enterBtn').addEventListener('click', boot);
el('retryBtn').addEventListener('click', boot);
bindInput();

// debug handle for headless verification
window.__vibe = { engine, warp, get chart() { return chart; } };
