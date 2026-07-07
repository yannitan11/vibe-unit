// The head warp — the whole trick of VIBE UNIT.
//
// For each direction θ around the head centre we know two radii:
//   R_base(θ)   — where the person's silhouette actually is (from the mask)
//   R_target(θ) — where the radar polygon wants it (from the axis values)
// The fragment shader remaps every output pixel's radius linearly per
// direction, so the silhouette lands exactly on the polygon: the face IS
// the chart. Interior features smear proportionally toward the spikes,
// which is the look (see the reference: noses pulled toward "edgy").
//
// Pure profile math (polygonRadii, silhouetteRadii) is exported for
// headless tests; HeadWarp owns the GL.

import { WARP, CHART } from './config.js';

const TAU = Math.PI * 2;

// ── Radar polygon radius profile ──
// values: array of 0..1 per axis. Returns Float32Array[buckets] of radii
// (same unit as innerR/outerR), sampling the straight-edged radar polygon
// whose k-th vertex sits at innerR + v[k]·(outerR − innerR) on axis k.
export function polygonRadii(values, buckets, innerR, outerR) {
  const n = values.length;
  const out = new Float32Array(buckets);
  const vx = new Float32Array(n);
  const vy = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const r = innerR + values[k] * (outerR - innerR);
    const a = CHART.startAngle + (k / n) * TAU;
    vx[k] = r * Math.cos(a);
    vy[k] = r * Math.sin(a);
  }
  for (let i = 0; i < buckets; i++) {
    const phi = CHART.startAngle + (i / buckets) * TAU;
    const rel = (i / buckets) * n;
    const k = Math.floor(rel) % n;
    const k2 = (k + 1) % n;
    // ray ∩ segment (polar line through two cartesian points)
    const num = vx[k] * vy[k2] - vx[k2] * vy[k];
    const den =
      (vy[k2] - vy[k]) * Math.cos(phi) - (vx[k2] - vx[k]) * Math.sin(phi);
    if (Math.abs(den) > 1e-6) {
      out[i] = num / den;
    } else {
      // segment nearly parallel to the ray — fall back to a lerp
      const t = rel - Math.floor(rel);
      const r1 = Math.hypot(vx[k], vy[k]);
      const r2 = Math.hypot(vx[k2], vy[k2]);
      out[i] = r1 + (r2 - r1) * t;
    }
  }
  return out;
}

// ── Silhouette radius profile from the person mask ──
// Marches rays outward from the head centre in RAW video space and records
// where the mask drops below threshold. Angles are given in the MIRRORED
// canvas space (what the user sees), so x flips going in.
//   mask: { data: Float32Array, w, h }, centre {x,y} + radii in video px.
// Returns Float32Array[buckets] of radii in video px, clamped to
// [minPx, capPx].
export function silhouetteRadii(mask, cx, cy, minPx, capPx, buckets, videoW, videoH) {
  const out = new Float32Array(buckets);
  const sx = mask.w / videoW;
  const sy = mask.h / videoH;
  const step = Math.max(1.5, capPx / 48);
  for (let i = 0; i < buckets; i++) {
    const phi = CHART.startAngle + (i / buckets) * TAU;
    const dx = -Math.cos(phi); // mirror: canvas → video flips x
    const dy = Math.sin(phi);
    let r = minPx;
    let misses = 0;
    let R = capPx;
    while (r < capPx) {
      const mx = ((cx + dx * r) * sx) | 0;
      const my = ((cy + dy * r) * sy) | 0;
      const inside =
        mx >= 0 && my >= 0 && mx < mask.w && my < mask.h
          ? mask.data[my * mask.w + mx] >= WARP.maskThreshold
          : false;
      if (inside) {
        misses = 0;
      } else {
        misses++;
        if (misses >= 2) {
          R = r - step * misses;
          break;
        }
      }
      r += step;
    }
    out[i] = Math.min(capPx, Math.max(minPx, R));
  }
  return out;
}

// ── Expression-gated pull ──
// The warp target per bucket: your own silhouette, pulled OUTWARD toward
// the radar polygon by how excited the nearby axes are. All values ≈ 0
// (neutral face) → target == silhouette → the shader is an exact identity
// and the head renders as an untouched cutout.
//   rBase/rPoly: Float32Array[buckets]; values: 0..1 per axis.
export function pullProfile(rBase, rPoly, values, dead) {
  const n = values.length;
  const buckets = rBase.length;
  const e = values.map((v) => Math.max(0, Math.min(1, (v - dead) / (1 - dead))));
  const out = new Float32Array(buckets);
  for (let i = 0; i < buckets; i++) {
    const rel = (i / buckets) * n;
    const k = Math.floor(rel) % n;
    const t = rel - Math.floor(rel);
    const w = e[k] * (1 - t) + e[(k + 1) % n] * t;
    out[i] = rBase[i] + w * Math.max(0, rPoly[i] - rBase[i]);
  }
  return out;
}

// Circular smoothing pass ([.25,.5,.25]) — run 1-2× on the silhouette so
// hair strands don't make the star flicker.
export function smoothProfile(arr, passes = 1) {
  const n = arr.length;
  for (let p = 0; p < passes; p++) {
    const prev = Float32Array.from(arr);
    for (let i = 0; i < n; i++) {
      arr[i] =
        prev[(i - 1 + n) % n] * 0.25 + prev[i] * 0.5 + prev[(i + 1) % n] * 0.25;
    }
  }
  return arr;
}

// ── GL ──

const VERT = `
attribute vec2 aPos;
varying vec2 vPos; // px offset from the warp-canvas centre
uniform float uSize;
void main() {
  vPos = aPos * uSize * 0.5;
  gl_Position = vec4(aPos.x, -aPos.y, 0.0, 1.0);
}`;

// LUT: 64×1 RGBA. rg = R_target hi/lo bytes, ba = R_base hi/lo bytes,
// both normalized by uMaxR. Linear filtering distributes over the hi/lo
// split, so interpolation stays exact.
const FRAG = `
precision mediump float;
varying vec2 vPos;
uniform sampler2D uVideo;
uniform sampler2D uMask;
uniform sampler2D uLUT;
uniform float uStart;     // CHART.startAngle
uniform float uMaxR;      // LUT normalization, device px
uniform float uBuckets;
uniform vec2 uHead;       // head centre, full-canvas device px
uniform float uW;         // full canvas width, device px
uniform vec2 uCoverOff;   // ox, oy of the cover-fit video
uniform vec2 uCoverSize;  // dw, dh of the cover-fit video
uniform float uThresh;
uniform float uFeather;
uniform float uEdgePx;
uniform float uCore;      // WARP.coreLock — identity fraction of min(Rb, Rt)

const float TAU = 6.28318530718;

float lutR(vec2 texel) { // two-byte decode, normalized 0..1
  return (texel.x * 255.0 * 256.0 + texel.y * 255.0) / 65535.0;
}

void main() {
  float r = length(vPos);
  float theta = atan(vPos.y, vPos.x);
  float t = fract((theta - uStart) / TAU) + 0.5 / uBuckets;
  vec4 lut = texture2D(uLUT, vec2(t, 0.5));
  float Rt = lutR(lut.rg) * uMaxR;
  float Rb = lutR(lut.ba) * uMaxR;
  if (r > Rt + 1.0 || Rt < 1.0) { discard; }

  // Identity-core remap: inside the core radius the face maps 1:1 (flat);
  // only the rim band [core, Rt] stretches/compresses onto [core, Rb], so
  // the silhouette still lands exactly on the polygon but eyes/nose keep
  // their natural scale — a fully-linear remap dishes the face concave.
  float core = uCore * min(Rb, Rt);
  float rSrc;
  if (r <= core) {
    rSrc = r;
  } else {
    float t = (r - core) / max(Rt - core, 1.0);
    rSrc = core + t * (Rb - core);
  }
  vec2 srcPx = uHead + (r > 0.5 ? vPos / r : vec2(0.0)) * rSrc;

  // full-canvas device px → raw video uv (undo mirror + cover fit)
  vec2 uv = vec2(
    (uW - srcPx.x - uCoverOff.x) / uCoverSize.x,
    (srcPx.y - uCoverOff.y) / uCoverSize.y
  );
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { discard; }

  vec3 col = texture2D(uVideo, uv).rgb;
  float m = texture2D(uMask, uv).r;
  float alpha = smoothstep(uThresh - uFeather, uThresh + uFeather, m);
  alpha *= 1.0 - smoothstep(Rt - uEdgePx, Rt, r);
  gl_FragColor = vec4(col * alpha, alpha);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(sh) || 'shader compile failed');
  }
  return sh;
}

export class HeadWarp {
  constructor() {
    this.canvas = document.createElement('canvas');
    const gl =
      this.canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true }) ||
      this.canvas.getContext('experimental-webgl', { premultipliedAlpha: true, alpha: true });
    this.gl = gl;
    this.ok = !!gl;
    if (!gl) return;

    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      this.ok = false;
      return;
    }
    gl.useProgram(prog);
    this.prog = prog;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW
    );
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.u = {};
    for (const name of [
      'uSize', 'uVideo', 'uMask', 'uLUT', 'uStart', 'uMaxR', 'uBuckets',
      'uHead', 'uW', 'uCoverOff', 'uCoverSize', 'uThresh', 'uFeather', 'uEdgePx',
      'uCore',
    ]) {
      this.u[name] = gl.getUniformLocation(prog, name);
    }

    this.videoTex = this._makeTex(gl.LINEAR, gl.CLAMP_TO_EDGE);
    this.maskTex = this._makeTex(gl.LINEAR, gl.CLAMP_TO_EDGE);
    this.lutTex = this._makeTex(gl.LINEAR, gl.REPEAT); // angle wraps; 64 is POT
    gl.uniform1i(this.u.uVideo, 0);
    gl.uniform1i(this.u.uMask, 1);
    gl.uniform1i(this.u.uLUT, 2);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    this.lutBytes = new Uint8Array(WARP.rays * 4);
    this.maskBytes = null;
    this.size = 0;
  }

  _makeTex(filter, wrap) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  setSize(px) {
    if (!this.ok || px === this.size) return;
    this.size = px;
    this.canvas.width = px;
    this.canvas.height = px;
    this.gl.viewport(0, 0, px, px);
  }

  // rBase/rTarget: Float32Array[WARP.rays] in device px.
  // cover: { ox, oy, dw, dh, w } from the canvas cover-fit mapping.
  // headPx: head centre in full-canvas device px. dpr for edge feather.
  render(video, mask, rBase, rTarget, headPx, cover, dpr) {
    if (!this.ok || !this.size) return false;
    const gl = this.gl;

    // video → unit 0
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.videoTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);

    // mask (float 0..1 → bytes) → unit 1
    const n = mask.w * mask.h;
    if (!this.maskBytes || this.maskBytes.length !== n) {
      this.maskBytes = new Uint8Array(n);
    }
    for (let i = 0; i < n; i++) this.maskBytes[i] = mask.data[i] * 255;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.LUMINANCE, mask.w, mask.h, 0,
      gl.LUMINANCE, gl.UNSIGNED_BYTE, this.maskBytes
    );

    // radius LUT → unit 2
    let maxR = 1;
    for (let i = 0; i < WARP.rays; i++) {
      maxR = Math.max(maxR, rBase[i], rTarget[i]);
    }
    maxR *= 1.01;
    for (let i = 0; i < WARP.rays; i++) {
      const t = Math.round((rTarget[i] / maxR) * 65535);
      const b = Math.round((rBase[i] / maxR) * 65535);
      this.lutBytes[i * 4] = t >> 8;
      this.lutBytes[i * 4 + 1] = t & 255;
      this.lutBytes[i * 4 + 2] = b >> 8;
      this.lutBytes[i * 4 + 3] = b & 255;
    }
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA, WARP.rays, 1, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, this.lutBytes
    );

    gl.uniform1f(this.u.uSize, this.size);
    gl.uniform1f(this.u.uStart, CHART.startAngle);
    gl.uniform1f(this.u.uMaxR, maxR);
    gl.uniform1f(this.u.uBuckets, WARP.rays);
    gl.uniform2f(this.u.uHead, headPx.x, headPx.y);
    gl.uniform1f(this.u.uW, cover.w);
    gl.uniform2f(this.u.uCoverOff, cover.ox, cover.oy);
    gl.uniform2f(this.u.uCoverSize, cover.dw, cover.dh);
    gl.uniform1f(this.u.uThresh, WARP.maskThreshold);
    gl.uniform1f(this.u.uFeather, WARP.maskFeather);
    gl.uniform1f(this.u.uEdgePx, WARP.edgeFadePx * dpr);
    gl.uniform1f(this.u.uCore, WARP.coreLock);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return true;
  }

  // Copy the current warped head into a plain canvas (for LOCKED + poster).
  snapshot() {
    const c = document.createElement('canvas');
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    c.getContext('2d').drawImage(this.canvas, 0, 0);
    return c;
  }
}
