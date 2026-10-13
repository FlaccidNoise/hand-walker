// test/gestures.test.mjs — generated gesture tracks (src/gestures.js). Pure node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GESTURES, IDLES, morseGesture, MORSE_UNIT, MORSE_MAX, sampleTrack } from '../src/gestures.js';
import { POSTURE_PITCH } from '../src/tuning.js';

test('morse: one strike per element, dots and dashes in order, keys strictly increasing', () => {
  const g = morseGesture('SOS');
  assert.deepEqual(g.cue.map(c => c[1]), ['dit', 'dit', 'dit', 'dah', 'dah', 'dah', 'dit', 'dit', 'dit']);
  const keys = g.digits.index.mcp;
  for (let i = 1; i < keys.length; i++) assert.ok(keys[i][0] > keys[i - 1][0], `key ${i} not after key ${i - 1}`);
  assert.equal(keys.at(-1)[0], 1);
  assert.equal(keys.at(-1)[1], 0, 'the finger ends on its rest spot');
});

test('morse: the finger is down for the whole of a dash and up between strikes', () => {
  const g = morseGesture('t'), [u] = g.cue[0], n = g.dur / MORSE_UNIT, mcp = g.digits.index.mcp;
  assert.equal(sampleTrack(mcp, u + 1.5 / n), 0, 'mid-dash: on the floor');
  assert.ok(sampleTrack(mcp, u - 0.45 / n) < -0.2, 'just before: lifted');
});

test('morse: text is capped, and text with no code gives null', () => {
  assert.equal(morseGesture('abcdefghijklmnop').text.length, MORSE_MAX);
  assert.equal(morseGesture('?!'), null);
  assert.equal(morseGesture('a b').text, 'ab');
});

test('every cue sits inside its gesture and can fire (a cue at u = 0 never does)', () => {
  for (const [name, def] of Object.entries(GESTURES))
    for (const [u] of def.cue ?? []) assert.ok(u > 0 && u <= 1, `${name} cue at ${u}`);
});

const ALL = [...Object.entries(GESTURES), ...Object.entries(IDLES)];
const scan = (track, f) => { for (let u = 0; u <= 1.0001; u += 0.005) f(sampleTrack(track, u), u); };

test('total body pitch stays inside the gimbal margin (posture + track within ±1.2 rad)', () => {
  for (const [name, def] of ALL)
    scan(def.body?.pitch, (v) => assert.ok(Math.abs(POSTURE_PITCH + v) <= 1.2, `${name} reaches ${(POSTURE_PITCH + v).toFixed(2)} rad`));
});

test('a hover poses all five digits, and is level again before the digits re-plant', () => {
  for (const [name, def] of ALL.filter(([, d]) => d.hover)) {
    const ends = ['thumb', 'index', 'middle', 'ring', 'pinky'].map(f => (assert.ok(def.digits[f], `${name} leaves the ${f} unposed`), def.digits[f].win[1]));
    for (const k of ['roll', 'pitch'])
      scan(def.body[k], (v, u) => { if (u >= Math.min(...ends)) assert.ok(Math.abs(v) < 1e-9, `${name} ${k} is ${v.toFixed(2)} at u=${u.toFixed(2)}`); });
  }
});

test('every stance body track starts and ends at zero (no pop in, no pop out)', () => {
  for (const [name, def] of ALL.filter(([, d]) => !d.hover))
    for (const [k, track] of Object.entries(def.body ?? {}))
      assert.ok(Math.abs(sampleTrack(track, 0)) < 1e-9 && Math.abs(sampleTrack(track, 1)) < 1e-9, `${name} ${k}`);
});

test('a hover that an input can wake holds its body pose across the span it skips', () => {
  for (const [name, def] of ALL.filter(([, d]) => d.hold)) {
    const [u0, u1] = def.hold;
    assert.ok(def.hover && u0 < u1 && u1 < Math.min(...Object.values(def.digits).map(d => d.win[1])), `${name} hold ${def.hold}`);
    for (const k of ['roll', 'pitch']) scan(def.body[k], (v, u) => { if (u >= u0 && u <= u1)
      assert.ok(Math.abs(v - sampleTrack(def.body[k], u1)) < 1e-9, `${name} ${k} moves inside its hold at u=${u.toFixed(3)}`); });
    scan(def.body.lift, (v, u) => { if (u >= u0 && u <= u1)
      assert.ok(Math.abs(v - sampleTrack(def.body.lift, u1)) <= 0.03 + 1e-9, `${name} lift is ${v.toFixed(2)} inside its hold (a breath is 0.03)`); });
  }
});
