// test/brain.test.mjs — the command layer and plan executor on a mock sim. Pure node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBrain } from '../src/brain.js';
import * as C from '../src/tuning.js';

// a sim that moves its body at the commanded velocity and stops dead on zero
const props = { ids: ['bell'], get: (id) => id === 'bell' ? { anchor: { x: 2, z: 0 }, facing: 0, plan: () => [{ do: 'jump' }] } : null, describe: () => '' };
function mock(camera = null) {
  const pos = { x: 0, y: 0, z: 0 };
  const s = { heading: 0, speed: 0, planted: 5, airborne: false, gesture: null, pivotTarget: null, time: 0, lastInput: 0 };
  const cmd = { x: 0, z: 0 }, calls = [];
  const sim = {
    s,
    autoWalk(x, z) { cmd.x = x; cmd.z = z; s.lastInput = s.time; calls.push(['walk', x, z]); },
    gesture(name) { calls.push(['gesture', name]); s.gesture = { name, t: 0, dur: 0.2 }; return true; },
    jump() { calls.push(['jump']); },
    pivot(deg) { calls.push(['pivot', deg]); return true; },
  };
  const brain = makeBrain(sim, { mount: { position: pos } }, camera, props);
  const said = [];                                           // [text, kind] the brain reported
  brain.st.onsay = (text, kind) => said.push([text, kind]);
  const step = (secs) => {
    for (let t = 0; t < secs; t += 0.01) {
      pos.x += cmd.x * 0.01; pos.z += cmd.z * 0.01;
      s.speed = Math.hypot(cmd.x, cmd.z); s.time += 0.01;
      if (s.gesture && (s.gesture.t += 0.01) >= s.gesture.dur) s.gesture = null;
      brain.tick(0.01);
    }
  };
  return { sim, brain, pos, calls, step, said };
}

test('a click plan runs, walks to the target and stops there', () => {
  const m = mock();
  assert.equal(m.brain.command([{ do: 'walkTo', x: 2, z: 0, speed: 0.8 }], { source: 'click' }), true);
  m.step(4);
  assert.equal(m.brain.st.i, -1, 'plan finished');
  assert.ok(Math.abs(m.pos.x - 2) < 0.2, `stopped at x=${m.pos.x}`);
  assert.deepEqual(m.calls.at(-1), ['walk', 0, 0]);
});

test('a voice plan does not replace a key plan in progress', () => {
  const m = mock();
  m.brain.command([{ do: 'walkTo', x: 4, z: 0 }], { source: 'key' });
  m.step(0.1);
  assert.equal(m.brain.command([{ do: 'gesture', name: 'wave' }], { source: 'voice' }), false);
  assert.equal(m.brain.st.plan[0].do, 'walkTo');
});

test('a click replaces a voice plan, and anything replaces an idle behavior', () => {
  const m = mock();
  m.brain.command([{ do: 'walkTo', x: 4, z: 0 }], { source: 'voice' });
  assert.equal(m.brain.command([{ do: 'gesture', name: 'wave' }], { source: 'click' }), true);
  assert.equal(m.brain.st.plan[0].do, 'gesture');
  m.brain.cancel();
  m.brain.behave('wandering');
  assert.equal(m.brain.command([{ do: 'jump' }], { source: 'voice' }), true);
});

test('an unknown source or action fails loudly', () => {
  const m = mock();
  assert.throws(() => m.brain.command([{ do: 'jump' }], { source: 'gamepad' }), /unknown source/);
  assert.equal(m.brain.command([{ do: 'teleport' }], { source: 'click' }), false);
  assert.equal(m.brain.st.status, 'idle', 'an error is reported, not a status to live in');
  assert.match(m.brain.st.error, /teleport/, 'and it is on record for the gates');
  m.brain.command([{ do: 'jump' }], { source: 'click' });
  assert.equal(m.brain.st.error, null, 'until a new plan starts');
  m.brain.command([{ do: 'teleport' }], { source: 'click' });
  assert.equal(m.said.at(-1)[1], 'error');
  assert.match(m.said.at(-1)[0], /unknown action "teleport"/);
});

test('a stale LLM reply is dropped when a newer ask is in flight', async () => {
  const m = mock(), pending = [];
  globalThis.fetch = () => new Promise(res => pending.push(res));
  const reply = (plan) => ({ ok: true, json: async () => ({ text: JSON.stringify({ plan }) }) });
  const first = m.brain.ask('recite a poem'), second = m.brain.ask('tell me a story');
  pending[1](reply([{ do: 'jump' }]));                       // the newer answer lands first
  await second;
  pending[0](reply([{ do: 'gesture', name: 'wave' }]));      // the older one lands late
  assert.equal(await first, null);
  assert.equal(m.brain.st.plan[0].do, 'jump');
  delete globalThis.fetch;
});

test('a plain command is obeyed by rules with no LLM call', async () => {
  const m = mock(); let called = 0;
  globalThis.fetch = () => { called++; return new Promise(() => {}); };
  await m.brain.ask('wave');
  m.step(0.05);
  assert.equal(called, 0);
  assert.deepEqual(m.calls.at(-1), ['gesture', 'wave']);
  delete globalThis.fetch;
});

test('with no LLM reachable, an unknown request shrugs and says what works', async () => {
  const m = mock();
  globalThis.fetch = async () => ({ ok: false, json: async () => { throw new SyntaxError('Unexpected token <'); } });
  assert.deepEqual(await m.brain.ask('recite a poem'), { lost: true });
  assert.equal(m.brain.st.status, 'acting', 'the shrug');
  assert.equal(m.said.at(-1)[1], 'notice');
  assert.match(m.said.at(-1)[0], /simple words/);
  m.step(0.05);
  assert.deepEqual(m.calls.at(-1), ['gesture', 'idk']);
  m.step(0.5);
  assert.equal(m.brain.st.status, 'idle');
  let called = 0; globalThis.fetch = () => { called++; return new Promise(() => {}); };
  await m.brain.ask('sing an aria');                          // does not ask the dead endpoint again
  assert.equal(called, 0);
  delete globalThis.fetch;
});

test('pokes escalate from a giggle to a sulk, and are forgotten after a quiet spell', () => {
  const m = mock();
  const first = () => { const a = m.brain.st.plan[0]; return a.name ?? a.do; };
  const seen = [];
  for (let i = 0; i < 5; i++) { m.brain.poke(); seen.push(first()); m.step(0.6); }
  assert.deepEqual(seen, ['laugh', 'jump', 'shake', 'tap', 'flipBird']);
  m.brain.poke(); m.step(0.6); m.brain.poke();
  assert.equal(first(), 'jump', 'two quick pokes: the second startles');
  m.brain.cancel(); m.step(C.POKE_FORGET + 1);
  m.brain.poke();
  assert.equal(first(), 'laugh', 'a poke after a quiet spell is a giggle again');
});

test('a routine expands to plain actions, and an unknown one fails loudly', () => {
  const m = mock();
  assert.equal(m.brain.command([{ do: 'routine', name: 'dance' }], { source: 'click' }), true);
  assert.ok(m.brain.st.plan.length > 3 && m.brain.st.plan.every(a => a.do !== 'routine'));
  assert.equal(m.brain.command([{ do: 'routine', name: 'moonwalk' }], { source: 'click' }), false);
  assert.match(m.said.at(-1)[0], /unknown routine "moonwalk" — have: dance/);
});

test('morse taps the asked text, and text with no code fails loudly', () => {
  const m = mock();
  m.brain.command([{ do: 'morse', text: 'hi' }], { source: 'voice' });
  m.step(0.05);
  assert.deepEqual(m.calls.at(-1), ['gesture', 'morse']);
  m.brain.command([{ do: 'morse', text: '!!' }], { source: 'voice' });
  m.step(0.05);
  assert.match(m.said.at(-1)[0], /no Morse code|has a Morse code/);
});

test('a gesture the sim cannot start yet is tried again, and an unknown one fails loudly', () => {
  const m = mock();
  let busy = true;
  const start = m.sim.gesture;
  m.sim.gesture = (name) => busy ? false : start(name);
  m.brain.command([{ do: 'gesture', name: 'wave' }], { source: 'key' });
  m.step(0.3);
  assert.equal(m.brain.st.status, 'acting', 'still waiting, not an error');
  busy = false; m.step(0.05);
  assert.deepEqual(m.calls.at(-1), ['gesture', 'wave']);
  m.brain.command([{ do: 'gesture', name: 'moonwalk' }], { source: 'key' });
  m.step(0.05);
  assert.match(m.said.at(-1)[0], /unknown gesture "moonwalk"/);
  assert.equal(m.brain.st.status, 'idle');
});

test('a gesture that replaces a walk stops the walk first', () => {
  const m = mock();
  m.brain.command([{ do: 'walkTo', x: 4, z: 0, speed: 1.8 }], { source: 'click' });
  m.step(0.5);
  m.brain.command([{ do: 'gesture', name: 'wave' }], { source: 'key' });
  assert.deepEqual(m.calls.at(-1), ['walk', 0, 0], 'the walk command is zeroed at once');
  m.step(0.1);
  assert.deepEqual(m.calls.at(-1), ['gesture', 'wave']);
  assert.ok(m.pos.x < 1.2, `stayed put: x=${m.pos.x}`);
});

test('a walk that replaces a walk is not zeroed in between', () => {
  const m = mock();
  m.brain.command([{ do: 'walkTo', x: 4, z: 0 }], { source: 'key' });
  m.step(0.2);
  const n = m.calls.length;
  m.brain.command([{ do: 'walkTo', x: 4, z: 1 }], { source: 'key' });
  assert.equal(m.calls.length, n, 'no stop between two carrots');
});

test('a turn the sim cannot start yet is tried again', () => {
  const m = mock();
  let busy = true;
  const pivot = m.sim.pivot;
  m.sim.pivot = (deg) => busy ? false : pivot(deg);
  m.brain.command([{ do: 'turn', deg: 45 }], { source: 'key' });
  m.step(0.3);
  assert.equal(m.brain.st.status, 'acting', 'still waiting, not an error');
  busy = false; m.step(0.05);
  assert.deepEqual(m.calls.at(-1), ['pivot', 45]);
});

test('a poke that is outranked does not count', () => {
  const m = mock();
  m.brain.command([{ do: 'walkTo', x: 4, z: 0 }], { source: 'key' });
  m.step(0.1);
  assert.equal(m.brain.poke(), false);
  assert.equal(m.brain.poke(), false);
  m.brain.cancel();
  assert.equal(m.brain.poke(), true);
  assert.equal(m.brain.st.plan[0].name, 'laugh');
});

test('a used prop tags every action of the errand with `for`', () => {
  const m = mock();
  m.brain.command([{ do: 'use', target: 'bell' }], { source: 'click' });
  assert.deepEqual(m.brain.st.plan.map(a => [a.do, a.for]), [['walkTo', 'bell'], ['face', 'bell'], ['jump', 'bell']]);
});

// every way out of 'thinking' must land on idle or acting: idle behaviors and the cursor wait on it
const llm = (reply) => { globalThis.fetch = async () => reply; };
const json = (o, ok = true) => ({ ok, json: async () => o });
test('an LLM reply with words and a plan says the words and runs the plan', async () => {
  const m = mock(); llm(json({ text: '{"say":"Right then","plan":[{"do":"jump"}]}' }));
  m.brain.mute(true);
  await m.brain.ask('are you well');
  assert.deepEqual(m.said.at(-1), ['Right then', 'say']);
  assert.equal(m.brain.st.status, 'acting');
  delete globalThis.fetch;
});

test('an LLM reply with words only says them and goes idle', async () => {
  const m = mock(); llm(json({ text: '{"say":"Quite"}' }));
  m.brain.mute(true);
  await m.brain.ask('are you well');
  assert.deepEqual(m.said.at(-1), ['Quite', 'say']);
  assert.equal(m.brain.st.status, 'idle');
  delete globalThis.fetch;
});

test('an empty LLM reply and a proxy error are notices, and the brain goes idle', async () => {
  const m = mock(); llm(json({ text: '{}' }));
  await m.brain.ask('are you well');
  assert.equal(m.said.at(-1)[1], 'notice');
  assert.equal(m.brain.st.status, 'idle');
  llm(json({ error: 'GEMINI_API_KEY not set' }, false));
  await m.brain.ask('are you well');
  assert.match(m.said.at(-1)[0], /not answering/);
  assert.equal(m.brain.st.status, 'idle');
  delete globalThis.fetch;
});

test('a reply that lands while a key holds the controls is dropped whole', async () => {
  const m = mock(); let land;
  globalThis.fetch = () => new Promise(res => { land = res; });
  const asked = m.brain.ask('are you well');
  m.brain.command([{ do: 'walkTo', x: 4, z: 0 }], { source: 'key' });
  m.step(0.1);
  land(json({ text: '{"say":"Right then","plan":[{"do":"jump"}]}' }));
  assert.equal(await asked, null);
  assert.equal(m.said.length, 0, 'no words without the deed');
  assert.equal(m.brain.st.plan[0].do, 'walkTo');
  delete globalThis.fetch;
});

test('a question the rules answer with "stop" does not leave the brain thinking', async () => {
  const m = mock();
  globalThis.fetch = async () => ({ ok: false, json: async () => { throw new SyntaxError('<'); } });
  await m.brain.ask('can you stop?');
  assert.equal(m.brain.st.status, 'idle');
  delete globalThis.fetch;
});

test('the model download reports through onload, never through the status', async () => {
  const m = mock(), seen = [];
  m.brain.st.onload = (o) => seen.push(o.state);
  assert.equal(await m.brain.loadLocal(), false, 'node has no WebGPU');
  assert.deepEqual(seen, ['error']);
  assert.equal(m.brain.st.status, 'idle');
});

test('a sign turns to the viewer first, a body gesture does not', () => {
  const m = mock({ position: { x: -8, y: 5, z: 0 } });       // the viewer is behind the hand
  m.brain.command([{ do: 'gesture', name: 'thumbsUp' }], { source: 'key' });
  assert.deepEqual(m.brain.st.plan.map(a => a.do), ['face', 'gesture']);
  m.step(0.5);
  assert.equal(m.calls[0][0], 'pivot', 'it turns before it signs');
  assert.ok(Math.abs(Math.abs(m.calls[0][1]) - 180) < 1, `turned ${m.calls[0][1]}°`);
  m.brain.command([{ do: 'gesture', name: 'yes' }], { source: 'key' });
  assert.deepEqual(m.brain.st.plan.map(a => a.do), ['gesture']);
});

test('a sign made while already facing the viewer starts at once', () => {
  const m = mock({ position: { x: 8, y: 5, z: 1 } });
  m.brain.command([{ do: 'gesture', name: 'thumbsUp' }], { source: 'key' });
  m.step(0.1);
  assert.deepEqual(m.calls.map(c => c[0]), ['gesture']);
});

test('a reaction is ignored by a hand with no plan, and joins a plan right after the current action', () => {
  const m = mock();
  m.step(3);
  assert.equal(m.brain.react('bell'), false, 'nothing running, nothing recent: the QA gate lives here');
  assert.equal(m.brain.st.i, -1);
  m.brain.command([{ do: 'wait', s: 1 }, { do: 'gesture', name: 'laugh' }], { source: 'click' });
  m.step(0.05);
  assert.equal(m.brain.react('bell'), true);
  assert.deepEqual(m.brain.st.plan.map(a => a.name ?? a.do), ['wait', 'startle', 'laugh']);
  assert.equal(m.brain.react('bell'), false, 'the same event again while its reaction waits: no pile-up');
});

test('a reaction just after a plan ends runs on its own, and any input replaces it', () => {
  const m = mock();
  m.brain.command([{ do: 'wait', s: 0.1 }], { source: 'click' });
  m.step(0.5);
  assert.equal(m.brain.st.i, -1);
  assert.equal(m.brain.react('lightsOff'), true);
  assert.deepEqual(m.brain.st.plan.map(a => a.name ?? a.do), ['wait', 'peek']);
  assert.equal(m.brain.command([{ do: 'jump' }], { source: 'voice' }), true);
  assert.equal(m.brain.react('nonsense'), false);
});

test('while the model is asked, the hand thinks; a rules command does not wait', async () => {
  const m = mock();
  globalThis.fetch = () => new Promise(() => {});           // a model that never answers
  m.brain.ask('is it tea time?');                           // a question: it goes to the model
  m.step(0.1);
  assert.deepEqual(m.calls.filter(c => c[0] === 'gesture').map(c => c[1]), ['thinking']);
  m.step(4);
  assert.equal(m.calls.filter(c => c[1] === 'thinking').length, 2, 'and again after a pause');
  delete globalThis.fetch;
  const n = mock();
  n.brain.ask('jump');
  n.step(0.1);
  assert.ok(!n.calls.some(c => c[1] === 'thinking'));
});

test('a pet forgives the pokes', () => {
  const m = mock();
  m.brain.poke(); m.step(0.6); m.brain.poke(); m.step(0.6);
  m.brain.soothe();
  m.brain.poke();
  assert.equal(m.brain.st.plan.find(a => a.do === 'gesture').name, 'laugh', 'the first poke again');
});
