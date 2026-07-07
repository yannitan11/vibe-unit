// Verdict picker. Pure (given values + a random pick) so it's testable.

import { AXES, RESULTS, VERDICT } from './config.js';

export function pickResult(values, rand = Math.random()) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const spread = Math.max(...values) - Math.min(...values);

  let def;
  if (mean >= VERDICT.highMean) {
    def = RESULTS.high;
  } else if (mean <= VERDICT.lowMean && spread <= VERDICT.flatSpread) {
    def = RESULTS.flat;
  } else {
    // two tallest axes, keyed in AXES order
    const order = values
      .map((v, i) => [v, i])
      .sort((a, b) => b[0] - a[0])
      .slice(0, 2)
      .map((p) => p[1])
      .sort((a, b) => a - b);
    def = RESULTS.pairs[`${AXES[order[0]].key}+${AXES[order[1]].key}`];
  }

  return {
    name: def.name,
    copy: def.copy[Math.floor(rand * def.copy.length) % def.copy.length],
    mean,
  };
}

// Reading counter — a real number: how many verdicts this browser has locked.
const KEY = 'vibeunit.readings';

export function nextReadingNo() {
  let n = 0;
  try {
    n = parseInt(localStorage.getItem(KEY) || '0', 10) || 0;
  } catch {
    /* storage blocked — counter stays session-less */
  }
  n += 1;
  try {
    localStorage.setItem(KEY, String(n));
  } catch {
    /* ignore */
  }
  return `READING NO. ${String(n).padStart(4, '0')}`;
}
