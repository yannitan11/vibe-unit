// Poster export: a 1080×1920 dark spec-sheet with the locked chart,
// the warped-head snapshot, and the verdict. Reuses hud.js so the chart
// on the poster is the chart on screen.

import { BRAND, HUD } from './config.js';
import { drawChartBase, drawChartLabels } from './hud.js';

const W = 1080;
const H = 1920;

export async function renderPoster({ snapshot, values, result, readingNo }) {
  await document.fonts.ready;

  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  const s = 2; // poster scale relative to the 11px HUD type

  ctx.fillStyle = '#08080a';
  ctx.fillRect(0, 0, W, H);

  const pad = 72;
  const mono = (size, weight = 400) =>
    `${weight} ${size}px "Space Mono", monospace`;

  // top chrome
  ctx.strokeStyle = 'rgba(244,242,236,0.16)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pad, pad + 54);
  ctx.lineTo(W - pad, pad + 54);
  ctx.stroke();

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = mono(24, 700);
  ctx.fillStyle = '#f4f2ec';
  ctx.fillText(BRAND.watermark, pad, pad + 26);
  ctx.textAlign = 'right';
  ctx.font = mono(20);
  ctx.fillStyle = 'rgba(244,242,236,0.45)';
  const dt = new Date();
  ctx.fillText(
    `${readingNo}   ${dt.toISOString().slice(0, 10)}`,
    W - pad,
    pad + 26
  );

  // headline
  ctx.textAlign = 'left';
  ctx.font = `500 84px "Space Grotesk", sans-serif`;
  ctx.fillStyle = '#f4f2ec';
  ctx.fillText('what’s your vibe', pad, pad + 220);
  ctx.fillText('today?', pad, pad + 310);

  // chart + head snapshot
  const chart = { cx: W / 2, cy: 960, innerR: 118, outerR: 330, s };
  const dominant = values.indexOf(Math.max(...values));
  drawChartBase(ctx, chart);
  if (snapshot) {
    const box = chart.outerR * 2 + 16;
    ctx.drawImage(snapshot, chart.cx - box / 2, chart.cy - box / 2, box, box);
  }
  drawChartLabels(ctx, chart, values, dominant);

  // verdict block
  const vy = 1520;
  ctx.font = mono(22);
  ctx.fillStyle = 'rgba(244,242,236,0.45)';
  ctx.fillText('RESULT :', pad, vy);
  ctx.font = `500 64px "Space Grotesk", sans-serif`;
  ctx.fillStyle = HUD.accent;
  ctx.fillText(result.name.toLowerCase(), pad, vy + 76);

  ctx.font = mono(24);
  ctx.fillStyle = 'rgba(244,242,236,0.72)';
  wrapText(ctx, result.copy, pad, vy + 136, W - pad * 2, 38);

  // bottom chrome
  ctx.strokeStyle = 'rgba(244,242,236,0.16)';
  ctx.beginPath();
  ctx.moveTo(pad, H - pad - 40);
  ctx.lineTo(W - pad, H - pad - 40);
  ctx.stroke();
  ctx.font = mono(18);
  ctx.fillStyle = 'rgba(244,242,236,0.45)';
  ctx.fillText(BRAND.url, pad, H - pad);
  ctx.textAlign = 'right';
  ctx.fillText('NOTHING LEAVES YOUR DEVICE', W - pad, H - pad);

  return c;
}

function wrapText(ctx, text, x, y, maxW, lineH) {
  const words = text.split(' ');
  let line = '';
  for (const w of words) {
    const probe = line ? `${line} ${w}` : w;
    if (ctx.measureText(probe).width > maxW && line) {
      ctx.fillText(line, x, y);
      line = w;
      y += lineH;
    } else {
      line = probe;
    }
  }
  if (line) ctx.fillText(line, x, y);
}

export function downloadPoster(canvas, name) {
  canvas.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, 'image/png');
}
