// src/rig.js — GLB load + auto-rig → legs / reach / SI constants. Instance-ready. (HANDOFF §3, §4.1)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { solveLeg } from './ik.js';
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

  // --- hinge-axis alignment: twist each digit's distal joints about their bone axes
  // (local Z) so every hinge (local X) parallels its root joint's — the GLB's axes
  // splay a few degrees per joint (thumb ~40°), which breaks the shared-axis planar
  // model (constant tip residual with no limit binding). Bone-axis twists barely
  // change the silhouette. ---
  const colW = (o, i) => new THREE.Vector3().setFromMatrixColumn(o.matrixWorld, i).normalize();
  const boneZ = new THREE.Vector3(0, 0, 1);
  for (const f of FINGERS) {
    const rootJ = byName[f === 'thumb' ? 'thumb-metacarpal' : `${jointPrefix(f)}-phalanx-proximal`];
    for (const n of chainNames(f)) {
      const j = byName[n];
      if (!j || j === rootJ || n.endsWith('-tip') || n.endsWith('-metacarpal')) continue;
      const ax = colW(rootJ, 0);
      j.rotateOnAxis(boneZ, Math.atan2(ax.dot(colW(j, 1)), ax.dot(colW(j, 0))));
      root.updateMatrixWorld(true);
    }
  }

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
      mcpMin: isTh ? C.THUMB_CMC_EXT : C.LIMITS[0][0],
    };
  }

  // --- per-digit curl sign: positive curl must sweep the tip toward the PALM (the
  // GLB's +localX rotation is anatomical EXTENSION). Palm side = side of the palm
  // plane (wrist, indexMCP, pinkyMCP) holding the thumb column. Applied by negating
  // axisW (and its outs); applyCurl mirrors the sign onto the joint rotations. ---
  {
    const wl = wrist.getWorldPosition(new THREE.Vector3());
    const n = new THREE.Vector3().crossVectors(
      digits.index.pos.mcp.clone().sub(wl), digits.pinky.pos.mcp.clone().sub(wl)).normalize();
    const palmN = n.multiplyScalar(Math.sign(digits.thumb.pos.pip.clone().sub(wl).dot(n)));
    for (const f of FINGERS) {
      const d = digits[f];
      const motion = new THREE.Vector3().crossVectors(d.axisW, d.pos.tip.clone().sub(d.pos.mcp));
      d.curlSign = motion.dot(palmN) > 0 ? 1 : -1;
      if (d.curlSign < 0) {
        d.axisW.negate();
        d.out0 = -d.out0; d.out1 = -d.out1; d.out2 = -d.out2;
      }
    }
  }

  // --- scale so middle-finger reach (MCP→tip) = 1 world unit ---
  const middleReach = digits.middle.reach;
  const scale = 1 / middleReach;
  // world-unit inner chord per digit (fold annulus input — keeps ik.js unit-clean)
  for (const f of FINGERS) {
    const d = digits[f];
    d.innerW = Math.abs(d.L0 - (d.L1 + d.L2)) * scale;
    d.reachW = d.reach * scale;
  }
  const WORLD_M = middleReach;                          // meters per world unit (1u ≈ middle reach)
  const G = C.G_SI / WORLD_M;                            // fierce gravity (u/s^2)

  // --- mount into the "Thing" stance: bind -Y(fingers)→+X(forward), and bind +X is
  // the PALM (thumb-side-of-palm-plane verified), which must face DOWN (-Y world):
  // R = Ry(π)·Rz(∓π/2). A bare Rz(+90°) reads the palm as the knuckle dome and stands
  // the hand palm-to-the-sky on hyperextended fingers — self-consistently, so only
  // the mesh betrays it. Handedness mirrors the Rz direction.
  const mount = new THREE.Group();
  mount.name = 'ThingMount';
  root.scale.setScalar(scale);
  root.rotation.order = 'YZX';
  root.rotation.set(0, Math.PI, handedness < 0 ? -Math.PI / 2 : Math.PI / 2);
  mount.add(root);
  root.updateMatrixWorld(true);
  // recenter: the WRIST is the body origin ("wrist high" is literal — body height =
  // wrist height). The GLB's wrist is not at the scene origin; without this the sim
  // steers an invisible point ~0.5u from the hand and the stump drags underground.
  root.position.sub(wrist.getWorldPosition(new THREE.Vector3()));
  root.updateMatrixWorld(true);

  // --- thumb CMC stance pronation (§4.1 "thumb wide"): the saddle joint pronates the
  // thumb column when opposing; without it the ±0.65 yaw cone cannot contain ANY wide
  // ground target at stance heights (measured: err ≥ 0.09 at every lane angle). Scan a
  // pre-rotation about the metacarpal bone axis with the REAL solver at a probe stance
  // and bake the best passing angle into the thumb's bind pose. ---
  {
    const d = digits.thumb;
    const posL = (o) => root.worldToLocal(o.getWorldPosition(new THREE.Vector3()));
    const dirL = (o, i) => {
      const w = new THREE.Vector3().setFromMatrixColumn(o.matrixWorld, i).normalize();
      const p = o.getWorldPosition(new THREE.Vector3());
      return root.worldToLocal(p.clone().add(w)).sub(root.worldToLocal(p.clone())).normalize();
    };
    const recapture = () => {
      d.pos = { meta: null, mcp: posL(d.mcp), pip: posL(d.pip), dip: posL(d.dip), tip: posL(d.tip) };
      d.axisW = dirL(d.mcp, 0); d.abdW = dirL(d.mcp, 1);
      if (d.curlSign < 0) d.axisW.negate();
      const b0 = d.pos.pip.clone().sub(d.pos.mcp), b1 = d.pos.dip.clone().sub(d.pos.pip),
        b2 = d.pos.tip.clone().sub(d.pos.dip);
      d.out0 = b0.dot(d.axisW); d.out1 = b1.dot(d.axisW); d.out2 = b2.dot(d.axisW);
      d.L0 = b0.length(); d.L1 = b1.length(); d.L2 = b2.length();
      d.reach = d.pos.mcp.distanceTo(d.pos.tip); d.reachW = d.reach * scale;
      d.innerW = Math.abs(d.L0 - (d.L1 + d.L2)) * scale;
      for (const j of [d.mcp, d.pip, d.dip]) d.bindQ[j.name] = j.quaternion.clone();
      d._bp = null; d.yaw = 0;
    };
    const q0 = {};
    for (const j of [d.mcp, d.pip, d.dip, d.tip]) q0[j.name] = j.quaternion.clone();
    const boneZ = new THREE.Vector3(0, 0, 1);                // bone runs along local -Z
    const colW = (o, i) => new THREE.Vector3().setFromMatrixColumn(o.matrixWorld, i).normalize();
    // the thumb's joint hinge axes are NOT parallel (meta vs proximal ~40°), which
    // breaks the shared-axis planar model (0.3+ tip err with no limit binding). Twist
    // the proximal+distal about their own bone axes so every hinge ∥ the meta's — a
    // bone-axis twist barely changes the thumb's silhouette.
    const alignAxes = () => {
      for (const j of [d.pip, d.dip]) {
        const ax = colW(d.mcp, 0);
        const t = Math.atan2(ax.dot(colW(j, 1)), ax.dot(colW(j, 0)));
        j.rotateOnAxis(boneZ, t);
        mount.updateMatrixWorld(true);
      }
    };
    mount.position.set(0, 0.45, 0);
    mount.updateMatrixWorld(true);
    const mcpW0 = d.mcp.getWorldPosition(new THREE.Vector3());
    const tipW0 = d.tip.getWorldPosition(new THREE.Vector3());
    const lane = new THREE.Vector3(tipW0.x - mcpW0.x, 0, tipW0.z - mcpW0.z).normalize();
    let bestPhi = 0, bestErr = Infinity, bestReach = 0;
    const scanCurve = [];
    const tmp = new THREE.Vector3();
    const UP = new THREE.Vector3(0, 1, 0);
    for (let phi = -1.2; phi <= 1.2 + 1e-9; phi += 0.05) {
      for (const j of [d.mcp, d.pip, d.dip, d.tip]) j.quaternion.copy(q0[j.name]);
      d.mcp.rotateOnAxis(boneZ, phi);
      mount.updateMatrixWorld(true);
      alignAxes();
      recapture();
      const mcpW = d.mcp.getWorldPosition(tmp).clone();
      const drop = mcpW.y - 0.012, ext = C.REST_EXT * d.reachW;
      if (ext <= Math.abs(drop)) continue;
      const fwd = Math.max(Math.sqrt(ext * ext - drop * drop), C.REST_MIN_FWD * d.reachW);
      // best err over the SAME lane-angle sweep calibrate() refines with (±1.0 rad) —
      // a narrower probe under-rates candidates whose lane sits wide of bind
      let err = Infinity;
      for (let a = -1.0; a <= 1.0 + 1e-9; a += 0.05) {
        const dir = lane.clone().applyAxisAngle(UP, a);
        const foot = new THREE.Vector3(mcpW.x + dir.x * fwd, 0.012, mcpW.z + dir.z * fwd);
        d.yaw = 0;
        solveLeg(d, root.worldToLocal(foot.clone()), { root });
        err = Math.min(err, d.tip.getWorldPosition(tmp).distanceTo(foot));
      }
      scanCurve.push({ phi: +phi.toFixed(2), err: +err.toFixed(4), reach: +d.reachW.toFixed(3) });
      // among PASSING candidates keep the largest post-bake reach — alignment twists
      // can collapse the tip toward the CMC, and a short thumb can't descend to any
      // stance rest (restsAt nulls every height). Otherwise track the best miss.
      const passing = err < C.BAND_TIP_ERR;
      const better = passing
        ? (bestErr >= C.BAND_TIP_ERR || d.reachW > bestReach)
        : (bestErr >= C.BAND_TIP_ERR && err < bestErr);
      if (better) { bestPhi = phi; bestErr = err; bestReach = d.reachW; }
    }
    d.pronationScan = scanCurve;
    for (const j of [d.mcp, d.pip, d.dip, d.tip]) j.quaternion.copy(q0[j.name]);
    d.mcp.rotateOnAxis(boneZ, bestPhi);
    mount.updateMatrixWorld(true);
    alignAxes();
    recapture();                                             // aligned frames ARE bind now
    d.pronation = bestPhi;
    d.pronationErr = bestErr;
    mount.position.set(0, 0, 0);
    mount.updateMatrixWorld(true);
  }

  // footRest positions (world, post-mount) — bind fingertip placement
  for (const f of FINGERS) {
    const d = digits[f];
    d.footRest = d.tip.getWorldPosition(new THREE.Vector3());
    d.mcpWorld = d.mcp.getWorldPosition(new THREE.Vector3());
  }

  return { gltf, mount, root, wrist, digits, WORLD_M, G, scale, handedness };
}
