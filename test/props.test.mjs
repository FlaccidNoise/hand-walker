// test/props.test.mjs — pure prop logic (src/props.js). Pure node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepBall, bellRings, switchFlips } from '../src/props.js';
import * as C from '../src/tuning.js';

const hand = (o = {}) => ({ x: 0, y: 1.4, z: 0, vx: 0, vz: 0, airborne: false, ...o });

test('the ball is kicked by a moving hand and rolls to a stop', () => {
  const b = { x: 0.8, z: 0, r: 0.32, vx: 0, vz: 0 };
  stepBall(b, 0.01, hand({ vx: 1.8 }));
  assert.ok(b.vx > 1.8, 'leaves faster than the hand');
  for (let i = 0; i < 1000; i++) stepBall(b, 0.01, hand({ x: -4 }));
  assert.equal(Math.hypot(b.vx, b.vz), 0);
});

test('the ball stays in the room', () => {
  const b = { x: 4, z: 0, r: 0.32, vx: 9, vz: 0 };
  for (let i = 0; i < 300; i++) stepBall(b, 0.01, hand({ x: -4 }));
  assert.ok(Math.abs(b.x) <= C.ROOM.wall && b.vx <= 0);
});

test('a hand jumping over the ball does not kick it', () => {
  const b = { x: 0.5, z: 0, r: 0.32, vx: 0, vz: 0 };
  stepBall(b, 0.01, hand({ vx: 2, y: 2.4 }));
  assert.equal(b.vx, 0);
});

test('the bell rings on a landing beside it, not on a walk past', () => {
  const bell = { x: 1, z: 0, r: 0.9 };
  assert.equal(bellRings(bell, hand({ x: 1.2 }), true), true);
  assert.equal(bellRings(bell, hand({ x: 1.2 }), false), false);
  assert.equal(bellRings(bell, hand({ x: 3 }), true), false);
});

test('the switch flips once per jump, only beneath it and only at height', () => {
  const sw = { x: 0, z: 0, r: 0.9, reachY: 1.9, armed: true };
  assert.equal(switchFlips(sw, hand({ airborne: true, y: 1.6 })), false, 'too low');
  assert.equal(switchFlips(sw, hand({ airborne: true, y: 2.0 })), true);
  assert.equal(switchFlips(sw, hand({ airborne: true, y: 2.2 })), false, 'same jump');
  switchFlips(sw, hand());                                   // lands: re-armed
  assert.equal(switchFlips(sw, hand({ airborne: true, y: 2.0, x: 3 })), false, 'not beneath it');
  assert.equal(switchFlips(sw, hand({ airborne: true, y: 2.0 })), true);
});
