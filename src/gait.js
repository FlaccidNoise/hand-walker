// src/gait.js — pure gait math (no three.js): per-digit duty and the stride budget.
//
// One cadence serves every digit, so every digit takes the same step on the floor
// (v / f). What differs is how long each stays DOWN. A digit's stance travel is
// v·duty_f/f and must fit its own band, so duty is dealt in proportion to band length:
// the longest digit holds the gait's duty, shorter digits lift earlier and swing longer.
// Before this, the shortest band (the pinky) set one shared stride for all five.

// ratio_f = duty_f / duty of the longest digit at the gait's top speed, floored at
// ratioMin so a short digit is never reduced to a dab.
export function digitRatio(len, ratioMin) {
  const max = Math.max(...Object.values(len)), out = {};
  for (const [f, l] of Object.entries(len)) out[f] = Math.max(l / max, ratioMin);
  return out;
}

// stance travel budget of the longest digit: every digit must satisfy S·ratio_f ≤ util·len_f.
// Unfloored digits all give util·lenMax; a floored digit binds harder and shortens S.
export function strideBudget(len, ratio, util) {
  return util * Math.min(...Object.keys(len).map(f => len[f] / ratio[f]));
}

// the share of the cycle a digit spends down right now: as much as its band allows at
// this speed and cadence, never more than the gait duty. Slow walks keep all five down
// for the full duty; the short digits start lifting early only as speed uses up their band.
export function digitDuty(dutyGait, lenF, util, f, v) {
  return Math.min(dutyGait, util * lenF * f / Math.max(v, 1e-6));
}
