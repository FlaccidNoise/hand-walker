// test/rules.test.mjs — keyword rules (src/rules.js). Pure node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRules, isQuestion } from '../src/rules.js';
import { GESTURES } from '../src/gestures.js';
import * as C from '../src/tuning.js';

const one = (t) => parseRules(t)[0];

test('gestures by keyword', () => {
  assert.deepEqual(parseRules('wave'), [{ do: 'gesture', name: 'wave' }]);
  assert.equal(one('give me a thumbs up').name, 'thumbsUp');
  assert.equal(one('Hello there!').name, 'wave');
  assert.equal(one('take a bow').name, 'bow');
});

test('every gesture a rule names exists', () => {
  for (const t of ['thumbs up', 'thumbs down', 'the bird', 'wave', 'nod', 'shake', 'shrug', 'laugh', 'bow', 'point', 'beckon', 'think', 'tap', 'nap'])
    for (const a of parseRules(t)) if (a.do === 'gesture') assert.ok(GESTURES[a.name], `${t} → ${a.name}`);
});

test('movement: spots, screen directions, speed words, room clamp', () => {
  assert.deepEqual(one('go to the door'), { do: 'walkTo', x: 0, z: -4.2, speed: C.SPEED.strut });
  assert.equal(one('run to the step').speed, C.SPEED.sprint);
  const right = one('walk right');
  assert.ok(right.x > 0 && right.z < 0, 'screen-right is +x, -z');
  const far = parseRules('go far left', { x: -4, z: 4 })[0];
  assert.ok(Math.abs(far.x) <= C.ROOM.half && Math.abs(far.z) <= C.ROOM.half);
});

test('turns and jumps', () => {
  assert.deepEqual(parseRules('turn around'), [{ do: 'turn', deg: 180 }]);
  assert.deepEqual(parseRules('turn right'), [{ do: 'turn', deg: -90 }]);
  assert.deepEqual(parseRules('jump'), [{ do: 'jump' }]);
});

test('multi-step plans chain clauses', () => {
  const p = parseRules('go to the door, then wave and jump');
  assert.deepEqual(p.map(a => a.do), ['walkTo', 'gesture', 'jump']);
});

test('stop is an empty plan, negations and nonsense are null', () => {
  assert.deepEqual(parseRules('stop'), []);
  assert.equal(parseRules("don't move"), null);
  assert.equal(parseRules('what is the airspeed of a swallow'), null);
  assert.equal(parseRules('wave then solve world hunger'), null);
});

test('questions are detected', () => {
  assert.ok(isQuestion('are you happy'));
  assert.ok(isQuestion('you ok?'));
  assert.ok(!isQuestion('wave at me'));
});
