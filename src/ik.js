// src/ik.js — analytic 2-bone IK per digit in its curl plane + 3-stage ground constraint. (HANDOFF §4.2, §4.3)
import * as THREE from 'three';
import * as M from './math.js';
import * as C from './tuning.js';
import { groundY } from './terrain.js';

const _v = new THREE.Vector3();

// restore a digit's joints to their bind quaternions
export function resetToBind(d) {
  for (const j of [d.meta, d.mcp, d.pip, d.dip, d.tip].filter(Boolean))
    if (d.bindQ[j.name]) j.quaternion.copy(d.bindQ[j.name]);
}

// apply curl angles {yaw,mcp,pip,dip}: yaw = MCP ab/adduction about local Y (§4.2),
// then curls about each joint's local X (= the shared axisW). rotateOnAxis is a local
// (post-multiply) rotation; every joint hinges about the same axisW, so accumulating
// local-X rotations == the analytic in-plane curl (in the yawed plane).
export function applyCurl(d, a) {
  resetToBind(d);
  if (a.yaw) d.mcp.rotateOnAxis(_Y, a.yaw);
  if (a.mcp) d.mcp.rotateOnAxis(_X, a.mcp);
  if (d.pip && a.pip) d.pip.rotateOnAxis(_X, a.pip);
  if (a.dip) d.dip.rotateOnAxis(_X, a.dip);
}
const _X = new THREE.Vector3(1, 0, 0);
const _Y = new THREE.Vector3(0, 1, 0);

// current tip position in root-local (hand frame)
export function tipLocal(d, root) {
  return root.worldToLocal(d.tip.getWorldPosition(_v.clone()));
}

// per-digit in-plane basis: e1 = bone0 in-plane dir (finger-forward), e2 = axisW × e1 (palm-ward).
// positive curl moves the tip toward +e2 (palm), matching rotateOnAxis(localX, +).
function planeBasis(d) {
  const e1 = d.pos.pip.clone().sub(d.pos.mcp);          // bone0 (MCP→PIP), root-local
  e1.addScaledVector(d.axisW, -d.out0);                 // remove out-of-plane -> in-plane
  if (e1.lengthSq() < 1e-9) e1.set(0, -1, 0);           // degenerate fallback (bind forward)
  e1.normalize();
  const e2 = new THREE.Vector3().crossVectors(d.axisW, e1).normalize();
  return { e1, e2 };
}

// bind-pose plane data, lazily cached per digit: basis (e1,e2), in-plane bind bone
// angles beta1/beta2 (the GLB bind chain is NOT straight — ignoring them costs a
// constant ~0.024u tip offset), and the total bind out-of-plane offset outB.
function bindPlane(d) {
  if (!d._bp) {
    const { e1, e2 } = planeBasis(d);
    const inb = (b) => Math.atan2(b.dot(e2), b.dot(e1));
    const b1 = d.pip ? d.pos.dip.clone().sub(d.pos.pip) : null;
    const b2 = d.pos.tip.clone().sub(d.pos.dip);
    d._bp = { e1, e2, beta1: b1 ? inb(b1) : 0, beta2: inb(b2), outB: d.out0 + d.out1 + d.out2 };
  }
  return d._bp;
}

// Analytic 2-bone IK: solve {yaw,mcp,pip,dip} so the tip reaches `target` (root-local).
// 1. MCP ab/adduction yaw swings the curl plane through the target — solve
//    dot(axisW',t)=outB about the MCP's local-Y (abdW); nearest-branch to current yaw,
//    anatomically clamped (finger ±0.3, thumb ±0.65), faded near the knuckle (§4.2).
// 2. In the yawed plane: law-of-cosines with the bind bends folded in, iterating on the
//    SLAVED assembly's chord (DIP = slave·PIP) — the straight-l1 solve over-promises
//    (§4.4). The thumb is the same 3-bone chain rooted at its CMC (metacarpal joint).
// Elbow branch: a weight-bearing digit bows its knuckle AWAY from the ground — pick the
// branch that puts the PIP higher in world (§4.2). opts.branch forces it if given.
export function solveLeg(d, target, opts = {}) {
  const root = opts.root;
  const bp = bindPlane(d);
  const t = target.clone().sub(d.pos.mcp);

  // --- stage 1: yaw (plane through target) ---
  let yaw = 0;
  const A = t.dot(d.axisW), B = t.dot(_v.crossVectors(d.abdW, d.axisW));
  const Rm = Math.hypot(A, B);
  if (Rm > 1e-9) {
    const al = Math.atan2(B, A), ac = Math.acos(M.clamp(bp.outB / Rm, -1, 1));
    const prev = opts.yaw ?? d.yaw ?? 0;
    const y1 = M.wrapAngle(al - ac), y2 = M.wrapAngle(al + ac);
    yaw = Math.abs(M.wrapAngle(y1 - prev)) <= Math.abs(M.wrapAngle(y2 - prev)) ? y1 : y2;
    const fade = M.clamp01((t.length() / d.reach - C.YAW_FADE_LO) / (C.YAW_FADE_HI - C.YAW_FADE_LO));
    yaw = M.clamp(yaw * fade, -d.yawMax, d.yawMax);
  }
  d.yaw = yaw;
  // rotate the working basis by yaw (Rodrigues about abdW)
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const rotY = (v) => v.clone().multiplyScalar(cy)
    .addScaledVector(new THREE.Vector3().crossVectors(d.abdW, v), sy)
    .addScaledVector(d.abdW, d.abdW.dot(v) * (1 - cy));
  const e1 = rotY(bp.e1), axis = rotY(d.axisW);
  const e2 = new THREE.Vector3().crossVectors(axis, e1).normalize();

  // --- stage 2: in-plane 2-bone with bind bends. branch s: chord sits at s·(π−a1)
  // from bone0; bone angles relative to bind are what the joints actually rotate. ---
  const tx = t.dot(e1), ty = t.dot(e2);
  const d2 = Math.hypot(tx, ty);
  const base = Math.atan2(ty, tx);
  const solveBranch = (s) => {
    const r = d.slave, L1 = d.L1, L2 = d.L2;
    let th = 0, a0 = 0;
    for (let i = 0; i < 10; i++) {                        // under-relaxed: the map
      const g = (bp.beta2 - bp.beta1) + r * th;           // oscillates for deep curls
      const l1e = Math.hypot(L1 + L2 * Math.cos(g), L2 * Math.sin(g));
      const del = Math.atan2(L2 * Math.sin(g), L1 + L2 * Math.cos(g));
      const [A0, A1] = M.cosIK(d.L0, l1e, d2);
      th += 0.6 * ((s * (Math.PI - A1) - del - bp.beta1) - th);
      a0 = A0;
    }
    return { yaw, mcp: base - s * a0, pip: th };
  };
  const mk = (s) => {
    const a = solveBranch(s);
    a.mcp = M.clamp(a.mcp, C.LIMITS[0][0], C.LIMITS[0][1]);
    a.pip = M.clamp(a.pip, C.LIMITS[1][0], C.LIMITS[1][1]);
    a.dip = M.clamp(d.slave * a.pip, C.LIMITS[2][0], C.LIMITS[2][1]); // DIP follows the CLAMPED pip
    return a;
  };
  let angles;
  if (opts.branch != null) {
    angles = mk(opts.branch > 0 ? +1 : -1);
    applyCurl(d, angles);
  } else {
    // pick the branch whose PIP is higher in world (knuckle bows away from ground)
    const tryB = (s) => { applyCurl(d, mk(s)); root && root.updateMatrixWorld(true);
      return (d.pip || d.dip).getWorldPosition(_v).y; };
    const yP = tryB(+1), yM = tryB(-1);
    angles = mk(yP >= yM ? +1 : -1);
    applyCurl(d, angles);
  }
  if (root) root.updateMatrixWorld(true);
  const achieved = tipLocal(d, root || d.mcp.parent);
  return { angles, achieved, err: achieved.distanceTo(target) };
}

// 3-stage ground constraint (§4.3) — the uncapped last word after solveLeg. Tip, DIP
// and PIP must each clear the floor by the digit's flesh radius, each sampling the
// ground at its OWN world position. Stage 1 rotates about the MCP for the worst
// violation, stage 2 about the PIP for the remainder, stage 3 about the DIP as last
// resort. Deliberately NOT capped by LIMITS or rate limits — the floor always wins.
// `ground(x,z)` defaults to the terrain; `fleshW` is clearance in WORLD units.
// Returns total |rotation| applied (0 = no violation).
export function groundConstrain(d, root, ground = groundY, fleshW = padHeight(d)) {
  const stages = [[d.mcp, [d.pip, d.dip, d.tip]], [d.pip, [d.dip, d.tip]], [d.dip, [d.tip]]];
  let total = 0;
  // multi-pass: stage 1 lifts only the WORST violator to exact clearance, which can
  // leave a shallower PIP violation that no later stage can reach — re-pass until clean
  for (let pass = 0; pass < 3; pass++) {
    let acted = false;
    for (const [pivot, contacts] of stages) {
      // worst violation among this pivot's distal contacts (world space)
      let worst = null, worstPen = 1e-4;
      for (const c of contacts) {
        const p = c.getWorldPosition(new THREE.Vector3());
        const pen = ground(p.x, p.z) + fleshW - p.y;
        if (pen > worstPen) { worstPen = pen; worst = p; }
      }
      if (!worst) continue;
      // rotation Δ about the pivot's hinge (world X column) lifting `worst` to clearance:
      // y(Δ) = (A−K)cosΔ + B sinΔ + K, K = â.y·(â·v)  →  solve for y = ground+flesh
      const piv = pivot.getWorldPosition(new THREE.Vector3());
      const ax = new THREE.Vector3().setFromMatrixColumn(pivot.matrixWorld, 0).normalize();
      const v = worst.clone().sub(piv);
      const K = ax.y * ax.dot(v);
      const A = v.y - K, B = new THREE.Vector3().crossVectors(ax, v).y;
      const Rm = Math.hypot(A, B);
      if (Rm < 1e-9) continue;
      const yWant = ground(worst.x, worst.z) + fleshW - piv.y;
      const al = Math.atan2(B, A), ac = Math.acos(M.clamp((yWant - K) / Rm, -1, 1));
      const d1 = M.wrapAngle(al - ac), d2 = M.wrapAngle(al + ac);
      const delta = Math.abs(d1) <= Math.abs(d2) ? d1 : d2;
      pivot.rotateOnAxis(_X, delta);
      root.updateMatrixWorld(true);
      total += Math.abs(delta);
      acted = true;
    }
    if (!acted) break;
  }
  return total;
}

// --- geometry helpers (§4.2) ---
export function padReach(d) { return d.reach; }            // MCP→tip curl reach (world units after scale)
// fingertip flesh radius: max radial (distal/tip-weighted) vertex dist from the bone axis.
// Computed from mesh vertices at rig time (rig.js fills d.flesh). Fallback 0.012u.
export function padHeight(d) { return d.flesh ?? 0.012; }

// fold annulus dMin (WORLD units): the minimum reachable in-plane distance (inner
// chord) — below it the finger must fold (tuck) rather than reach.
export function foldAnnulus(d) {
  return C.TUNE.dMinK * d.innerW + C.TUNE.arcClear;
}
