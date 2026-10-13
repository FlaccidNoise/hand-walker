// test/llm.test.mjs — the in-browser model's vocabulary mapping and reply parsing. Pure node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepsToPlan, firstObject } from '../src/llm.js';
import * as C from '../src/tuning.js';

test('steps map onto plan actions', () => {
  const p = stepsToPlan([{ do: 'go', to: 'door' }, { do: 'gesture', name: 'wave' }, { do: 'turn', dir: 'around' }, { do: 'jump' }]);
  assert.deepEqual(p, [{ do: 'walkTo', x: 0, z: -C.ROOM.half, speed: C.SPEED.strut }, { do: 'gesture', name: 'wave' },
    { do: 'turn', deg: 180 }, { do: 'jump' }]);
});

test('moves chain from the last position, run on fast, and stay in the room', () => {
  const p = stepsToPlan([{ do: 'go', to: 'corner' }, { do: 'move', dir: 'back', fast: true }]);
  assert.equal(p[1].speed, C.SPEED.sprint);
  assert.ok(p[1].x >= -C.ROOM.half && p[1].z >= -C.ROOM.half);
  assert.ok(p[1].x < p[0].x || p[0].x === -C.ROOM.half);
});

test('unknown steps are dropped, an empty plan is null', () => {
  assert.equal(stepsToPlan([{ do: 'teleport' }, { do: 'gesture', name: 'moonwalk' }, null, 7]), null);
  assert.equal(stepsToPlan('not an array'), null);
  assert.equal(stepsToPlan([{ do: 'go', to: 'mars' }, { do: 'jump' }]).length, 1);
});

test('the reply parser survives think blocks and fences', () => {
  assert.deepEqual(firstObject('<think>hmm</think>\n```json\n{"steps":[{"do":"jump"}]}\n```'), { steps: [{ do: 'jump' }] });
  assert.deepEqual(firstObject('cut off thinking</think>{"answer":"yes"}'), { answer: 'yes' });
  assert.throws(() => firstObject('I cannot do that'), /no JSON object/);
});
