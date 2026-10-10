// test/brain.test.mjs — the command layer and plan executor on a mock sim. Pure node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBrain } from '../src/brain.js';
import * as C from '../src/tuning.js';

// a sim that moves its body at the commanded velocity and stops dead on zero
function mock() {
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
  const brain = makeBrain(sim, { mount: { position: pos } }, null);
  const step = (secs) => {
    for (let t = 0; t < secs; t += 0.01) {
      pos.x += cmd.x * 0.01; pos.z += cmd.z * 0.01;
      s.speed = Math.hypot(cmd.x, cmd.z); s.time += 0.01;
      if (s.gesture && (s.gesture.t += 0.01) >= s.gesture.dur) s.gesture = null;
      brain.tick(0.01);
    }
  };
  return { sim, brain, pos, calls, step };
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
  assert.equal(m.brain.st.status, 'error');
  assert.match(m.brain.st.detail, /unknown action "teleport"/);
});

test('an error status clears to idle after STATUS_HOLD', () => {
  const m = mock();
  m.brain.command([{ do: 'teleport' }], { source: 'click' });
  m.step(C.STATUS_HOLD + 0.2);
  assert.equal(m.brain.st.status, 'idle');
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
  await m.brain.ask('recite a poem');
  assert.equal(m.brain.st.status, 'saying');
  assert.match(m.brain.st.detail, /No language model/);
  m.step(0.05);
  assert.deepEqual(m.calls.at(-1), ['gesture', 'idk']);
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
  assert.deepEqual(seen, ['laugh', 'jump', 'no', 'tap', 'flipBird']);
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
  assert.match(m.brain.st.detail, /unknown routine "moonwalk" — have: dance/);
});

test('morse taps the asked text, and text with no code fails loudly', () => {
  const m = mock();
  m.brain.command([{ do: 'morse', text: 'hi' }], { source: 'voice' });
  m.step(0.05);
  assert.deepEqual(m.calls.at(-1), ['gesture', 'morse']);
  m.brain.command([{ do: 'morse', text: '!!' }], { source: 'voice' });
  m.step(0.05);
  assert.match(m.brain.st.detail, /no Morse code|has a Morse code/);
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
  assert.match(m.brain.st.detail, /unknown gesture "moonwalk"/);
});
