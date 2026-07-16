// src/rig.js — GLB load + auto-rig → legs / reach / SI constants. Instance-ready. (HANDOFF §3, §4.1)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as C from './tuning.js';

export const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];

// joint name chain for a finger (excludes wrist). thumb has no intermediate phalanx
// and (uniquely) its names omit the '-finger' infix: 'thumb-phalanx-proximal' etc.
export function jointPrefix(f) { return f === 'thumb' ? 'thumb' : `${f}-finger`; }
export function chainNames(f) {
  const p = jointPrefix(f);
  const c = [`${p}-metacarpal`, `${p}-phalanx-proximal`];
  if (f !== 'thumb') c.push(`${p}-phalanx-intermediate`);
  c.push(`${p}-phalanx-distal`, `${p}-tip`);
  return c;
}

function loadGLTF(url) {
  return new Promise((res, rej) => new GLTFLoader().load(url, res, undefined, rej));
}

// axisW: world curl axis shared by all joints of a digit (flexion axis from bind pose).
// Derived as the mean world-X of the digit's joints (standard WebXR rig flexion = local X),
// validated for parallelism; falls back to cross of consecutive bone dirs.
// NOTE: validated/possibly overridden per-digit by a curl-test when the IK is built (§4.2).
function deriveAxisW(joints) {
  const axes = joints.map(j => new THREE.Vector3().setFromMatrixColumn(j.matrixWorld, 0).normalize());
  const mean = axes.reduce((a, b) => a.add(b), new THREE.Vector3()).normalize();
  const ok = axes.every(a => Math.abs(a.dot(mean)) > 0.985);
  if (ok) return mean;
  // fallback: cross of first two bone directions
  const p = joints.map(j => new THREE.Vector3().setFromMatrixPosition(j.matrixWorld));
  for (let i = 0; i < p.length - 2; i++) {
    const d0 = p[i + 1].clone().sub(p[i]), d1 = p[i + 2].clone().sub(p[i + 1]);
    const n = new THREE.Vector3().crossVectors(d0, d1);
    if (n.lengthSq() > 1e-8) return n.normalize();
  }
  return mean;
}

export async function buildRig(url, handedness = C.HANDEDNESS) {
  const gltf = await loadGLTF(url);
  const root = gltf.scene;
  root.updateMatrixWorld(true);

  const byName = {};
  root.traverse(o => { if (o.name) byName[o.name] = o; });
  const wrist = byName['wrist'];
  if (!wrist) throw new Error('generic-hand GLB missing wrist joint');

  // --- reparent flat joints into kinematic chains (wrist→meta→mcp→pip→dip→tip) ---
  // attach() preserves world transforms, so the skin renders identically.
  for (const f of FINGERS) {
    const names = chainNames(f);
    let parent = wrist;
    for (const n of names) {
      const j = byName[n];
      if (j) parent.attach(j);
      parent = j ?? parent;
    }
  }
  // keep wrist under Armature (rig root). drop the unused trigger anim nodes.
  for (const k of Object.keys(byName)) {
    if (k.startsWith('xr_standard_trigger')) byName[k].visible = false;
  }
  root.updateMatrixWorld(true);

  // --- per-digit geometry (world bind, pre-scale) ---
  const tmp = new THREE.Vector3();
  const digits = {};
  for (const f of FINGERS) {
    const names = chainNames(f);
    const joints = names.map(n => byName[n]).filter(Boolean);
    const p = jointPrefix(f);
    const mcp = byName[`${p}-phalanx-proximal`]; // knuckle
    const tip = byName[`${p}-tip`];
    const mcpPos = mcp.getWorldPosition(tmp.clone());
    const tipPos = tip.getWorldPosition(new THREE.Vector3());
    const reach = mcpPos.distanceTo(tipPos);            // MCP→tip (curl reach), meters
    // segment lengths along the chain (consecutive joints incl. wrist→meta)
    const chainPts = [wrist.getWorldPosition(new THREE.Vector3()),
      ...joints.map(j => j.getWorldPosition(new THREE.Vector3()))];
    const segLen = [];
    for (let i = 0; i < chainPts.length - 1; i++) segLen.push(chainPts[i].distanceTo(chainPts[i + 1]));
    const axisW = deriveAxisW([mcp, ...joints.filter(j => j !== mcp)]);
    digits[f] = {
      name: f, joints, mcp, tip, reach, segLen, axisW,
      isThumb: f === 'thumb',
    };
  }

  // --- scale so middle-finger reach (MCP→tip) = 1 world unit ---
  const middleReach = digits.middle.reach;
  const scale = 1 / middleReach;
  const WORLD_M = middleReach;                          // meters per world unit (1u ≈ middle reach)
  const G = C.G_SI / WORLD_M;                            // fierce gravity (u/s^2)

  // --- mount into the "Thing" stance: bind -Y(fingers)→+X(forward), +X(knuckles)→+Y(up) ---
  // Rz(+90°): (x,y)->(-y,x). Handedness handled by mirroring rotation direction.
  const mount = new THREE.Group();
  mount.name = 'ThingMount';
  root.scale.setScalar(scale);
  root.rotation.set(0, 0, handedness < 0 ? Math.PI / 2 : -Math.PI / 2);
  root.updateMatrixWorld(true);
  mount.add(root);

  // footRest positions (world, post-mount) — bind fingertip placement
  for (const f of FINGERS) {
    const d = digits[f];
    d.footRest = d.tip.getWorldPosition(new THREE.Vector3());
    d.mcpWorld = d.mcp.getWorldPosition(new THREE.Vector3());
  }

  return { gltf, mount, root, wrist, digits, WORLD_M, G, scale, handedness };
}
