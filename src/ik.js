// src/ik.js — analytic 2-bone IK per digit in its curl plane + 3-stage ground constraint. (HANDOFF §4.2, §4.3)
import * as THREE from 'three';
import * as M from './math.js';
import * as C from './tuning.js';

const _v = new THREE.Vector3();

// restore a digit's joints to their bind quaternions
export function resetToBind(d) {
  for (const j of [d.meta, d.mcp, d.pip, d.dip, d.tip].filter(Boolean))
    if (d.bindQ[j.name]) j.quaternion.copy(d.bindQ[j.name]);
}

// apply curl angles {mcp,pip,dip} about each joint's local X (= the shared axisW).
// rotateOnAxis(localX) is a local (post-multiply) rotation; since every joint hinges
// about the same axisW, accumulating local-X rotations == the analytic in-plane curl.
export function applyCurl(d, a) {
  resetToBind(d);
  if (a.mcp) d.mcp.rotateOnAxis(_X, a.mcp);
  if (d.pip && a.pip) d.pip.rotateOnAxis(_X, a.pip);
  if (a.dip) d.dip.rotateOnAxis(_X, a.dip);
}
const _X = new THREE.Vector3(1, 0, 0);

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

// Analytic 2-bone IK: solve {mcp,pip,dip} so the tip reaches `target` (root-local).
// Bones L0 (MCP→PIP) and (L1+L2) (PIP→tip, DIP slaved afterwards → small over-promise, §4.4).
// Elbow branch: a weight-bearing digit bows its knuckle AWAY from the ground — pick the
// branch that puts the PIP higher in world (§4.2). opts.branch forces it if given.
export function solveLeg(d, target, opts = {}) {
  const root = opts.root;
  const mcp = d.pos.mcp;
  const { e1, e2 } = planeBasis(d);
  const t = target.clone().sub(mcp);
  const tx = t.dot(e1), ty = t.dot(e2);
  let d2 = Math.hypot(tx, ty);
  const l0 = d.L0, l1 = (d.isThumb ? d.L1 : d.L1) + d.L2; // PIP→tip straight assembly
  const [a0, a1] = M.cosIK(l0, l1, d2);
  const base = Math.atan2(ty, tx);
  const thetaPip = Math.PI - a1;
  const thetaDip = d.isThumb ? thetaPip * 0.5 : thetaPip * C.DIP_SLAVE;
  // candidate branches for the MCP angle (bone0 = base ± a0 from e1)
  const mk = (br) => {
    const ang = { mcp: base + br * a0, pip: thetaPip, dip: thetaDip };
    ang.mcp = M.clamp(ang.mcp, C.LIMITS[0][0], C.LIMITS[0][1]);
    ang.pip = M.clamp(ang.pip, C.LIMITS[1][0], C.LIMITS[1][1]);
    ang.dip = M.clamp(ang.dip, C.LIMITS[2][0], C.LIMITS[2][1]);
    return ang;
  };
  let angles;
  if (opts.branch != null) {
    angles = mk(opts.branch > 0 ? +1 : -1);
    applyCurl(d, angles);
  } else {
    // pick the branch whose PIP is higher in world (knuckle bows away from ground)
    const tryB = (br) => { const a = mk(br); applyCurl(d, a); root && root.updateMatrixWorld(true);
      return d.pip ? d.pip.getWorldPosition(_v.clone()).y : d.dip.getWorldPosition(_v.clone()).y; };
    const yP = tryB(+1), yM = tryB(-1);
    angles = (yP >= yM) ? mk(+1) : mk(-1);
    applyCurl(d, angles);
  }
  if (root) root.updateMatrixWorld(true);
  const achieved = tipLocal(d, root || d.mcp.parent);
  return { angles, achieved, err: achieved.distanceTo(target) };
}

// --- geometry helpers (§4.2) ---
export function padReach(d) { return d.reach; }            // MCP→tip curl reach (world units after scale)
// fingertip flesh radius: max radial (distal/tip-weighted) vertex dist from the bone axis.
// Computed from mesh vertices at rig time (rig.js fills d.flesh). Fallback 0.012u.
export function padHeight(d) { return d.flesh ?? 0.012; }

// fold annulus dMin: the minimum reachable in-plane distance (inner chord) — below it the
// finger must fold (tuck) rather than reach. dMin = dMinK · |L0 - (L1+L2)| + arcClear margin.
export function foldAnnulus(d) {
  const l0 = d.L0, l1 = (d.isThumb ? d.L1 : d.L1) + d.L2;
  return C.TUNE.dMinK * Math.abs(l0 - l1) + C.TUNE.arcClear;
}
