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

  // --- per-digit geometry (root-local = world here, root still identity pre-mount) ---
  // axisW = the MCP joint's world-X (curl-test confirmed local X is the flexion axis,
  // ~-Z lateral for the four fingers; thumb differs as it's opposed). All joints of a
  // digit share it (verified); the MCP is the authoritative hinge.
  const tmp = new THREE.Vector3();
  const digits = {};
  for (const f of FINGERS) {
    const names = chainNames(f);
    const joints = names.map(n => byName[n]).filter(Boolean);
    const p = jointPrefix(f);
    const isTh = f === 'thumb';
    // thumb roots at the CMC (metacarpal joint) — that's where its reach and ±0.65
    // ab/adduction live; its chain is then a standard 3-bone like a finger.
    const meta = isTh ? null : byName[`${p}-metacarpal`];
    const mcp = isTh ? byName['thumb-metacarpal'] : byName[`${p}-phalanx-proximal`];
    const pip = isTh ? byName['thumb-phalanx-proximal'] : byName[`${p}-phalanx-intermediate`];
    const dip = byName[`${p}-phalanx-distal`];
    const tip = byName[`${p}-tip`];
    const mcpPos = mcp.getWorldPosition(tmp.clone());
    const tipPos = tip.getWorldPosition(new THREE.Vector3());
    const reach = mcpPos.distanceTo(tipPos);          // MCP→tip (curl reach), meters
    const chainPts = [wrist.getWorldPosition(new THREE.Vector3()),
      ...joints.map(j => j.getWorldPosition(new THREE.Vector3()))];
    const segLen = [];
    for (let i = 0; i < chainPts.length - 1; i++) segLen.push(chainPts[i].distanceTo(chainPts[i + 1]));

    // root-local positions + bind quaternions (for reset during IK)
    const pos = (o) => root.worldToLocal(o.getWorldPosition(new THREE.Vector3()));
    const bindQ = {};
    for (const j of [meta, mcp, pip, dip, tip].filter(Boolean)) bindQ[j.name] = j.quaternion.clone();
    const axisW = new THREE.Vector3().setFromMatrixColumn(mcp.matrixWorld, 0).normalize();
    // abduction axis: MCP local Y (bone runs along local -Z, flexion along local X)
    const abdW = new THREE.Vector3().setFromMatrixColumn(mcp.matrixWorld, 1).normalize();
    // bone vectors (root-local) and out-of-plane components along axisW
    const mcpP = pos(mcp), pipP = pos(pip||dip), dipP = pos(dip), tipP = pos(tip);
    const b0 = pipP.clone().sub(mcpP), b1 = (pip?dipP.clone().sub(pipP):new THREE.Vector3()), b2 = tipP.clone().sub(dipP);
    const out0 = b0.dot(axisW), out1 = b1.dot(axisW), out2 = b2.dot(axisW);
    const L0 = b0.length(), L1 = b1.length(), L2 = b2.length();

    digits[f] = {
      name: f, joints, meta, mcp, pip, dip, tip, reach, segLen, axisW, abdW,
      bindQ, pos: { meta: meta && pos(meta), mcp: mcpP, pip: pipP, dip: dipP, tip: tipP },
      L0, L1, L2, out0, out1, out2,
      isThumb: isTh,
      slave: isTh ? C.THUMB_SLAVE : C.DIP_SLAVE,
      yawMax: isTh ? C.YAW_MAX_THUMB : C.YAW_MAX_FINGER,
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
