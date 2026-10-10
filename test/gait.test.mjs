// test/gait.test.mjs — per-digit duty and stride budget (src/gait.js). Pure node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digitRatio, strideBudget, digitDuty } from '../src/gait.js';

const len = { thumb: 0.60, index: 0.68, middle: 0.76, ring: 0.72, pinky: 0.47 };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('longest digit holds the gait duty, shorter digits scale down', () => {
  const r = digitRatio(len, 0.4);
  near(r.middle, 1);
  near(r.pinky, 0.47 / 0.76);
});

test('the budget is the longest band, not the shortest', () => {
  near(strideBudget(len, digitRatio(len, 0.4), 0.8), 0.8 * 0.76);
});

test('a floored digit shortens the budget instead of overrunning its band', () => {
  const r = digitRatio(len, 0.7), S = strideBudget(len, r, 0.8);
  near(r.pinky, 0.7);
  near(S, 0.8 * 0.47 / 0.7);
  for (const f of Object.keys(len)) assert.ok(S * r[f] <= 0.8 * len[f] + 1e-9, f);
});

test('equal bands reproduce the single shared stride', () => {
  const eq = { a: 0.5, b: 0.5 };
  near(strideBudget(eq, digitRatio(eq, 0.4), 0.8), 0.4);
});

test('at the cadence the budget sets, no digit travels past util of its band', () => {
  const D = 0.78, r = digitRatio(len, 0.7), S = strideBudget(len, r, 0.8), v = 0.8, f = v * D / S;
  for (const k of Object.keys(len)) {
    const d = digitDuty(D, len[k], 0.8, f, v);
    assert.ok(v * d / f <= 0.8 * len[k] + 1e-9, k);
    assert.ok(d >= D * r[k] - 1e-9, k);            // and never less than its dealt share
  }
});

test('a slow walk on a cadence floor keeps every digit down for the full duty', () => {
  for (const k of Object.keys(len)) near(digitDuty(0.78, len[k], 0.8, 0.9, 0.3), 0.78);
});
