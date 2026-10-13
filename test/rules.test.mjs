// test/rules.test.mjs — keyword rules (src/rules.js). Pure node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRules, isQuestion, isHelp } from '../src/rules.js';
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

test('morse, routines, the piano and playing dead', () => {
  assert.deepEqual(parseRules('say hello in morse'), [{ do: 'morse', text: 'hello' }]);
  assert.deepEqual(parseRules('tap out SOS'), [{ do: 'morse', text: 'sos' }]);
  assert.deepEqual(parseRules('morse code'), [{ do: 'morse', text: 'sos' }]);
  assert.equal(one('spell supercalifragilistic in morse').text.length, 8);
  assert.deepEqual(parseRules('dance'), [{ do: 'routine', name: 'dance' }]);
  assert.deepEqual(parseRules('knock on the glass'), [{ do: 'routine', name: 'knock' }]);
  assert.deepEqual(parseRules('play the piano'), [{ do: 'use', target: 'piano' }]);
  assert.deepEqual(parseRules('play dead'), [{ do: 'gesture', name: 'playDead' }]);
  assert.ok(GESTURES.playDead && GESTURES.dance && GESTURES.knock);
  assert.deepEqual(parseRules('play with the ball'), [{ do: 'use', target: 'ball' }]);
  assert.equal(one('tap').name, 'tap', 'a bare tap is still the impatient drum');
});

test('rock, paper, scissors: the game by name, and a sign on its own is a pick', () => {
  for (const t of ['rock paper scissors', 'Rock, paper, scissors!', "let's play rps"]) assert.deepEqual(parseRules(t), [{ do: 'rps' }], t);
  assert.deepEqual(parseRules('paper'), [{ do: 'rps', pick: 'paper' }]);
  assert.deepEqual(parseRules('I pick scissors'), [{ do: 'rps', pick: 'scissors' }]);
  assert.deepEqual(parseRules('rock on'), [{ do: 'gesture', name: 'horns' }]);
});

test('the box: go home, come out, and the step is no longer called a box', () => {
  assert.deepEqual(parseRules('go home'), [{ do: 'routine', name: 'home' }]);
  assert.deepEqual(parseRules('get in your box'), [{ do: 'routine', name: 'home' }]);
  assert.deepEqual(parseRules('come out'), [{ do: 'routine', name: 'out' }]);
  assert.equal(parseRules('go to the step')[0].do, 'walkTo');
});

test('"come back" comes to the front, and help is the page\'s to answer', () => {
  assert.deepEqual(one('come back'), { do: 'walkTo', x: 3.5, z: 3.5, speed: C.SPEED.strut });
  assert.ok(one('go back').x < 0, 'a bare "back" is still away from the viewer');
  assert.ok(isHelp('help') && isHelp('What can you do?') && !isHelp('help yourself to a nap'));
});

test('every card and palette entry on the page is a command the rules know', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const says = [...html.matchAll(/data-say="([^"]+)"/g)].map(m => m[1]);
  assert.ok(says.length > 20, `found ${says.length}`);
  for (const t of says) {
    const plan = parseRules(t);
    assert.ok(plan, `"${t}" has no rule`);
    for (const a of plan) if (a.do === 'gesture') assert.ok(GESTURES[a.name], `"${t}" → ${a.name}`);
  }
});
