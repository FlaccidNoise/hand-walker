// test/gestures.test.mjs — generated gesture tracks (src/gestures.js). Pure node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GESTURES, morseGesture, MORSE_UNIT, MORSE_MAX, sampleTrack } from '../src/gestures.js';

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
