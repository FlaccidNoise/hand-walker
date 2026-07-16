// test/unit.test.mjs — math + IK invariants (§6). Pure node, no browser: a synthetic
// digit built to the GLB joint convention (bone along local -Z, flexion about local X,
// abduction about local Y) exercises the real solver.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as M from '../src/math.js';
import * as C from '../src/tuning.js';
import { solveLeg, applyCurl, resetToBind, groundConstrain, foldAnnulus, padHeight, tipLocal } from '../src/ik.js';

const v = (x, y, z) => new THREE.Vector3(x, y, z);

// synthetic straight-chain digit posed like a planted finger: bone along world -Z,
// MCP frame rotated pi about Z so local X (flexion axis) points world -X and positive
// curl moves the tip DOWN (e2 = axisW x e1 = -Y), matching the hand's palm-down mount —
// the §4.2 "PIP higher" branch heuristic assumes weight-bearing curl-down geometry.
function makeDigit({ L0 = 0.5, L1 = 0.3, L2 = 0.2 } = {}) {
  const root = new THREE.Object3D();
  const mk = (name, parent, z) => {
    const j = new THREE.Object3D(); j.name = name; j.position.set(0, 0, z);
    parent.add(j); return j;
  };
  const mcp = mk('mcp', root, 0);
  mcp.quaternion.setFromAxisAngle(v(0, 0, 1), Math.PI);
  const pip = mk('pip', mcp, -L0);
  const dip = mk('dip', pip, -L1);
  const tip = mk('tip', dip, -L2);
  root.updateMatrixWorld(true);
  const bindQ = {};
  for (const j of [mcp, pip, dip, tip]) bindQ[j.name] = j.quaternion.clone();
  return {
    name: 'synth', joints: [mcp, pip, dip, tip], meta: null, mcp, pip, dip, tip,
    reach: L0 + L1 + L2, reachW: L0 + L1 + L2, axisW: v(-1, 0, 0), abdW: v(0, -1, 0),
    bindQ, pos: { mcp: v(0, 0, 0), pip: v(0, 0, -L0), dip: v(0, 0, -(L0 + L1)), tip: v(0, 0, -(L0 + L1 + L2)) },
    L0, L1, L2, out0: 0, out1: 0, out2: 0, innerW: Math.abs(L0 - (L1 + L2)),
    isThumb: false, slave: C.DIP_SLAVE, yawMax: C.YAW_MAX_FINGER,
    root,
  };
}
// in-plane target at planar distance dist, curled by phi toward e2 (-Y, palm/ground-ward)
const planeTarget = (dist, phi) => v(0, -dist * Math.sin(phi), -dist * Math.cos(phi));

test('wrapAngle maps into (-pi, pi]', () => {
  assert.ok(Math.abs(M.wrapAngle(2.5 * Math.PI) - 0.5 * Math.PI) < 1e-12);
  assert.ok(Math.abs(M.wrapAngle(-2.5 * Math.PI) + 0.5 * Math.PI) < 1e-12);
  assert.equal(M.wrapAngle(0.3), 0.3);
});

test('cosIK satisfies both law-of-cosines identities', () => {
  for (const [l0, l1, d] of [[0.5, 0.5, 0.7], [0.5, 0.3, 0.75], [0.4, 0.6, 0.35], [0.5, 0.5, 2.0]]) {
    const [a0, a1] = M.cosIK(l0, l1, d);
    const dc = M.clamp(d, Math.abs(l0 - l1) + 1e-6, l0 + l1 - 1e-6); // solver's clamped d
    assert.ok(Math.abs(dc * dc - (l0 * l0 + l1 * l1 - 2 * l0 * l1 * Math.cos(a1))) < 1e-9);
    assert.ok(Math.abs(l1 * l1 - (l0 * l0 + dc * dc - 2 * l0 * dc * Math.cos(a0))) < 1e-9);
  }
});

test('solveLeg: in-plane targets across the arc solve to <1e-3 unless a limit binds', () => {
  const d = makeDigit();
  const atLimit = (a) => [[a.mcp, C.LIMITS[0]], [a.pip, C.LIMITS[1]], [a.dip, C.LIMITS[2]]]
    .some(([v, [lo, hi]]) => v === lo || v === hi);
  let exact = 0;
  for (const dist of [0.55, 0.7, 0.85, 0.95]) {
    for (const phi of [0.2, 0.6, 1.0, 1.4]) {
      d.yaw = 0;
      const res = solveLeg(d, planeTarget(dist, phi), { root: d.root });
      if (atLimit(res.angles)) continue;                   // clamped = honestly unreachable
      assert.ok(res.err < 1e-3, `dist=${dist} phi=${phi} err=${res.err}`);
      exact++;
    }
  }
  assert.ok(exact >= 12, `only ${exact}/16 grid targets unclamped`); // clamping can't hide misses
});

test('solveLeg: DIP slaved to PIP, all angles within LIMITS, |yaw| within yawMax', () => {
  const d = makeDigit();
  for (const t of [planeTarget(0.7, 0.8), planeTarget(0.3, 1.2), v(0.2, -0.4, -0.5), v(-0.3, 0.9, -0.1), v(0, 0, -2)]) {
    d.yaw = 0;
    const { angles } = solveLeg(d, t, { root: d.root });
    assert.ok(Math.abs(angles.dip - C.DIP_SLAVE * angles.pip) < 1e-9 ||
      angles.dip === C.LIMITS[2][0] || angles.dip === C.LIMITS[2][1]);
    assert.ok(angles.mcp >= C.LIMITS[0][0] && angles.mcp <= C.LIMITS[0][1]);
    assert.ok(angles.pip >= C.LIMITS[1][0] && angles.pip <= C.LIMITS[1][1]);
    assert.ok(angles.dip >= C.LIMITS[2][0] && angles.dip <= C.LIMITS[2][1]);
    assert.ok(Math.abs(angles.yaw) <= d.yawMax + 1e-12);
  }
});

test('solveLeg: out-of-plane target engages yaw and still lands <1e-3', () => {
  const d = makeDigit();
  d.yaw = 0;
  const t = planeTarget(0.8, 0.6); t.x = 0.1;               // 0.1 off-plane
  const res = solveLeg(d, t, { root: d.root });
  assert.ok(Math.abs(res.angles.yaw) > 0.05, `yaw=${res.angles.yaw}`);
  assert.ok(res.err < 1e-3, `err=${res.err}`);
});

test('solveLeg: auto elbow branch picks the higher-PIP pose (§4.2)', () => {
  const d = makeDigit();
  const t = planeTarget(0.7, 0.7);
  const pipY = (branch) => {
    d.yaw = 0;
    solveLeg(d, t, { root: d.root, branch });
    return d.pip.getWorldPosition(new THREE.Vector3()).y;
  };
  const yP = pipY(+1), yM = pipY(-1);
  d.yaw = 0;
  solveLeg(d, t, { root: d.root });
  const yAuto = d.pip.getWorldPosition(new THREE.Vector3()).y;
  assert.ok(Math.abs(yAuto - Math.max(yP, yM)) < 1e-9);
});

test('applyCurl/resetToBind roundtrip restores the bind tip', () => {
  const d = makeDigit();
  const bindTip = d.tip.getWorldPosition(new THREE.Vector3());
  applyCurl(d, { yaw: 0.2, mcp: 0.5, pip: 0.8, dip: 0.4 });
  d.root.updateMatrixWorld(true);
  resetToBind(d);
  d.root.updateMatrixWorld(true);
  assert.ok(d.tip.getWorldPosition(new THREE.Vector3()).distanceTo(bindTip) < 1e-12);
});

test('groundConstrain: lifts tip/DIP/PIP to flesh clearance (§4.3)', () => {
  const d = makeDigit();
  // curl the digit so the distal joints dive below the floor
  applyCurl(d, { mcp: 0.9, pip: 0.2, dip: 0.1 });           // curl+ rotates chain toward -Y
  d.root.updateMatrixWorld(true);
  assert.ok(d.tip.getWorldPosition(new THREE.Vector3()).y < 0, 'setup should penetrate');
  const moved = groundConstrain(d, d.root);
  assert.ok(moved > 0);
  const flesh = padHeight(d);
  for (const j of [d.pip, d.dip, d.tip]) {
    const y = j.getWorldPosition(new THREE.Vector3()).y;
    assert.ok(y >= flesh - 1e-6, `${j.name} y=${y}`);
  }
});

test('groundConstrain: no-op on a clear pose', () => {
  const d = makeDigit();
  d.root.position.y = 1; d.root.updateMatrixWorld(true);
  assert.equal(groundConstrain(d, d.root), 0);
});

test('foldAnnulus is dMinK·innerW + arcClear (world units)', () => {
  const d = makeDigit();
  assert.ok(Math.abs(foldAnnulus(d) - (C.TUNE.dMinK * d.innerW + C.TUNE.arcClear)) < 1e-12);
});

test('tipLocal reports the tip in root-local', () => {
  const d = makeDigit();
  d.root.position.set(3, 2, 1); d.root.updateMatrixWorld(true);
  assert.ok(tipLocal(d, d.root).distanceTo(d.pos.tip) < 1e-12);
});
