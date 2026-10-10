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
  const first = m.brain.ask('wave at me'), second = m.brain.ask('jump');
  pending[1](reply([{ do: 'jump' }]));                       // the newer answer lands first
  await second;
  pending[0](reply([{ do: 'gesture', name: 'wave' }]));      // the older one lands late
  assert.equal(await first, null);
  assert.equal(m.brain.st.plan[0].do, 'jump');
  delete globalThis.fetch;
});
