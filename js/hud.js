// Canvas radar chart + instrument overlay. Everything takes an explicit
// chart object so the poster can re-render at its own scale:
//   chart = { cx, cy, innerR, outerR, s }   (device px; s = dpr-ish scale)

import { AXES, CHART, HUD } from './config.js';

const TAU = Math.PI * 2;

export function axisAngle(k) {
  return CHART.startAngle + (k / AXES.length) * TAU;
}

export function spikeTip(chart, k, value) {
  const r = chart.innerR + value * (chart.outerR - chart.innerR);
  const a = axisAngle(k);
  return { x: chart.cx + Math.cos(a) * r, y: chart.cy + Math.sin(a) * r };
}

// Rings + spokes — drawn UNDER the head so the face occludes them,
// like the reference poster.
export function drawChartBase(ctx, chart) {
  const { cx, cy, outerR, s } = chart;
  ctx.save();
  ctx.lineWidth = s;

  ctx.strokeStyle = HUD.ring;
  ctx.beginPath();
  ctx.arc(cx, cy, outerR, 0, TAU);
  ctx.stroke();

  ctx.strokeStyle = HUD.ringDotted;
  ctx.setLineDash([s, 4 * s]);
  ctx.beginPath();
  ctx.arc(cx, cy, outerR * CHART.midRing, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = HUD.spoke;
  for (let k = 0; k < AXES.length; k++) {
    const a = axisAngle(k);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * outerR, cy + Math.sin(a) * outerR);
    ctx.stroke();
  }
  ctx.restore();
}

// Labels, live values and value markers — drawn OVER the head.
// dominant: index of the tallest axis (gets the accent).
export function drawChartLabels(ctx, chart, values, dominant) {
  const { cx, cy, outerR, s } = chart;
  ctx.save();
  ctx.textBaseline = 'middle';

  for (let k = 0; k < AXES.length; k++) {
    const a = axisAngle(k);
    const isDom = k === dominant;
    const lx = cx + Math.cos(a) * (outerR + CHART.labelGap * s);
    const ly = cy + Math.sin(a) * (outerR + CHART.labelGap * s);
    const cos = Math.cos(a);
    ctx.textAlign = cos > 0.35 ? 'left' : cos < -0.35 ? 'right' : 'center';

    ctx.font = `700 ${11 * s}px "Space Mono", monospace`;
    ctx.fillStyle = isDom ? HUD.accent : HUD.label;
    ctx.fillText(AXES[k].key, lx, ly - 7 * s);
    ctx.font = `${10 * s}px "Space Mono", monospace`;
    ctx.fillStyle = isDom ? HUD.accent : HUD.labelDim;
    ctx.fillText(values[k].toFixed(2), lx, ly + 7 * s);

    // value marker: small square at the spike tip
    const tip = spikeTip(chart, k, values[k]);
    const t = HUD.tickSize * s;
    ctx.fillStyle = isDom ? HUD.accent : HUD.label;
    ctx.save();
    ctx.translate(tip.x, tip.y);
    ctx.rotate(a + Math.PI / 4);
    ctx.fillRect(-t / 2, -t / 2, t, t);
    ctx.restore();
  }
  ctx.restore();
}

// Scan ring: accent arc sweeping the outer ring while sampling.
export function drawScanRing(ctx, chart, progress) {
  const { cx, cy, outerR, s } = chart;
  ctx.save();
  ctx.strokeStyle = HUD.accent;
  ctx.lineWidth = 2 * s;
  ctx.beginPath();
  ctx.arc(
    cx, cy, outerR + 8 * s,
    CHART.startAngle, CHART.startAngle + progress * TAU
  );
  ctx.stroke();
  ctx.restore();
}

// Capture flash across the chart box right after locking.
export function drawFlash(ctx, chart, now, flashAt, flashMs) {
  if (!flashAt) return;
  const t = (now - flashAt) / flashMs;
  if (t < 0 || t > 1) return;
  const { cx, cy, outerR } = chart;
  ctx.save();
  ctx.globalAlpha = 0.55 * (1 - t);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(cx, cy, outerR, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// Pinch grip cross (SCULPT mode).
export function drawGrip(ctx, p, s, active) {
  const r = 9 * s;
  ctx.save();
  ctx.strokeStyle = active ? HUD.accent : HUD.grip;
  ctx.lineWidth = s;
  ctx.beginPath();
  ctx.moveTo(p.x - r, p.y);
  ctx.lineTo(p.x + r, p.y);
  ctx.moveTo(p.x, p.y - r);
  ctx.lineTo(p.x, p.y + r);
  ctx.stroke();
  ctx.restore();
}
