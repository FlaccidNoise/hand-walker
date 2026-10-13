// src/rig.js — GLB load + auto-rig → legs / reach / SI constants. Instance-ready. (HANDOFF §3, §4.1)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { solveLeg } from './ik.js';
import * as C from './tuning.js';
import { PAINT } from './paint.js';

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

  // --- mesh-derived flesh (§4.1) — measured at EXACT bind, before any joint edits:
  // per-digit tip pad radius = max radial distance of distal/tip-weighted skin
  // vertices from the distal bone axis; palm/stump under-depth = how far palm-region
  // vertices (wrist + finger metacarpals) extend along the bind palm normal (+X)
  // past the wrist. Joint centers with a token radius made fingertips clip the floor
  // and the belly rest on it. Values in bind meters here; scaled to world below. ---
  const fleshM = {};
  let palmDepthM = 0;
  {
    let mesh = null;
    root.traverse(o => { if (o.isSkinnedMesh && !mesh) mesh = o; });
    const posA = mesh.geometry.attributes.position;
    const idxA = mesh.geometry.attributes.skinIndex;
    const wA = mesh.geometry.attributes.skinWeight;
    const boneName = mesh.skeleton.bones.map(b => b.name);
    const tipSets = {};
    for (const f of FINGERS) {
      const p = jointPrefix(f);
      tipSets[f] = new Set([`${p}-phalanx-distal`, `${p}-tip`]);
    }
    const palmSet = new Set(['wrist', ...FINGERS.filter(f => f !== 'thumb')
      .map(f => `${jointPrefix(f)}-metacarpal`)]);
    const axes = {};                                          // distal bone axis per digit
    for (const f of FINGERS) {
      const p = jointPrefix(f);
      const D = byName[`${p}-phalanx-distal`].getWorldPosition(new THREE.Vector3());
      const T = byName[`${p}-tip`].getWorldPosition(new THREE.Vector3());
      axes[f] = { D, u: T.clone().sub(D).normalize() };
      fleshM[f] = 0;
    }
    const wristX = wrist.getWorldPosition(new THREE.Vector3()).x;
    const v = new THREE.Vector3(), r = new THREE.Vector3();
    for (let i = 0; i < posA.count; i++) {
      let dom = 0, wMax = -1;
      for (let k = 0; k < 4; k++) {
        const w = wA.getComponent(i, k);
        if (w > wMax) { wMax = w; dom = idxA.getComponent(i, k); }
      }
      const name = boneName[dom];
      mesh.getVertexPosition(i, v);
      mesh.localToWorld(v);
      if (palmSet.has(name) && v.x - wristX > palmDepthM) palmDepthM = v.x - wristX;
      for (const f of FINGERS) {
        if (!tipSets[f].has(name)) continue;
        r.copy(v).sub(axes[f].D);
        r.addScaledVector(axes[f].u, -r.dot(axes[f].u));      // radial from the bone axis
        if (r.length() > fleshM[f]) fleshM[f] = r.length();
        break;
      }
    }
  }

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
  // world-unit inner chord + mesh flesh per digit (fold annulus / ground clearance)
  for (const f of FINGERS) {
    const d = digits[f];
    d.innerW = Math.abs(d.L0 - (d.L1 + d.L2)) * scale;
    d.reachW = d.reach * scale;
    d.flesh = fleshM[f] * scale;
  }
  const palmDepth = palmDepthM * scale;                       // belly bottom below the wrist
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
    mount.position.set(0, Math.max(0.5, palmDepth + C.BELLY_CLEAR + 0.02), 0);
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
      const drop = mcpW.y - d.flesh, ext = C.REST_EXT * d.reachW;
      if (ext <= Math.abs(drop)) continue;
      const fwd = Math.max(Math.sqrt(ext * ext - drop * drop), C.REST_MIN_FWD * d.reachW);
      // best err over the SAME lane-angle sweep calibrate() refines with (±1.0 rad) —
      // a narrower probe under-rates candidates whose lane sits wide of bind
      let err = Infinity;
      for (let a = -1.0; a <= 1.0 + 1e-9; a += 0.05) {
        const dir = lane.clone().applyAxisAngle(UP, a);
        const foot = new THREE.Vector3(mcpW.x + dir.x * fwd, d.flesh, mcpW.z + dir.z * fwd);
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

  let skin = null;
  root.traverse(o => { if (o.isSkinnedMesh && !skin) skin = o; });
  dressHand(skin, wrist, digits);

  return { gltf, mount, root, wrist, digits, WORLD_M, G, scale, handedness, palmDepth };
}

// the look of the hand: a painted skin (nails, creases, blush: src/paint.js) and a
// stitched scar where the wrist ends. A texture and wrist-bone children only: no joint
// or skin weight changes, so the calibration never sees it. All of it is worked out in
// the mesh's bind space, in metres.
function dressHand(mesh, wrist, digits) {
  mesh.castShadow = mesh.receiveShadow = true;               // without a shadow the hand floats
  const g = mesh.geometry, pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv, tri = g.index;
  const V = (...a) => new THREE.Vector3(...a), mix = (a, b, t) => V().lerpVectors(a, b, t);
  const bones = mesh.skeleton.bones;
  const joint = (name) => new THREE.Matrix4()                // a joint's bind frame, in the geometry's space
    .multiplyMatrices(mesh.skeleton.boneInverses[bones.findIndex(b => b.name === name)], mesh.bindMatrix).invert();
  const at = (name) => V().setFromMatrixPosition(joint(name));

  // the skin's UV where a ray from inside the hand comes out. `far` is how far that was
  const ray = new THREE.Ray(), A = V(), B = V(), C = V(), hit = V(), u2 = [0, 1, 2].map(() => new THREE.Vector2());
  let far = 0;
  const skinUV = (from, dir) => {
    let best = Infinity, out = null;
    ray.set(from, dir);
    for (let t = 0; t < tri.count; t += 3) {
      const [a, b, c] = [tri.getX(t), tri.getX(t + 1), tri.getX(t + 2)];
      if (!ray.intersectTriangle(A.fromBufferAttribute(pos, a), B.fromBufferAttribute(pos, b), C.fromBufferAttribute(pos, c), false, hit)) continue;
      const d = hit.distanceToSquared(from);
      if (d < best) { best = d; out = THREE.Triangle.getInterpolation(hit, A, B, C, u2[0].fromBufferAttribute(uv, a), u2[1].fromBufferAttribute(uv, b), u2[2].fromBufferAttribute(uv, c), new THREE.Vector2()); }
    }
    far = Math.sqrt(best);
    return out;
  };
  // a patch of skin: its UV, and the UV step per metre across and along the digit
  const patch = (p, along, out, e = 0.002) => {
    const side = V().crossVectors(along, out).normalize();
    const o = skinUV(p, out), x = skinUV(mix(p, V().addVectors(p, side), e), out), y = skinUV(mix(p, V().addVectors(p, along), e), out);
    return [(x.x - o.x) / e, (x.y - o.y) / e, (y.x - o.x) / e, (y.y - o.y) / e, o.x, o.y];
  };

  const marks = [], J = {}, palm = V();
  for (const f of FINGERS) {
    const j = J[f] = chainNames(f).map(at), n = j.length, thumb = f === 'thumb';
    // the hinge: the root joint's flexion axis, signed so a curl closes toward the palm.
    // The thumb's last joint keeps its own (the GLB's thumb hinges are 40° apart)
    const hinge = V().setFromMatrixColumn(joint(chainNames(f)[thumb ? 0 : 1]), 0).normalize().multiplyScalar(digits[f].curlSign);
    const own = V().setFromMatrixColumn(joint(`${jointPrefix(f)}-phalanx-distal`), 0).normalize();
    const along = (i) => V().subVectors(j[i + 1], j[i]).normalize();
    const pad = (i) => V().crossVectors(thumb && i === n - 2 ? own.multiplyScalar(Math.sign(own.dot(hinge))) : hinge, along(i)).normalize();
    const back = (i) => pad(i).negate();
    // the last segment runs past the GLB's tip joint, to the skin. Its length and the digit's half width, in mm
    skinUV(j[n - 1], along(n - 2));
    const end = V().copy(j[n - 1]).addScaledVector(along(n - 2), far), len = end.distanceTo(j[n - 2]) * 1000;
    skinUV(j[n - 2], back(n - 2));
    const r = far * 1000;
    marks.push(['nail', patch(mix(j[n - 2], end, 0.64), along(n - 2), back(n - 2)), thumb ? 1.2 * len : len],
      ['pad', patch(mix(j[n - 2], end, 0.55), along(n - 2), pad(n - 2)), r]);
    for (let i = 1; i < n - 1; i++) {
      marks.push([i === 1 ? 'knuckle' : 'joint', patch(j[i], along(i), back(i)), r, i === n - 2 ? 2 : 3]);
      if (i > 1 || thumb) marks.push(['crease', patch(j[i], along(i), pad(i)), r, i === n - 2 ? 1 : 2]);
    }
    if (!thumb) marks.push(['crease', patch(mix(j[1], j[2], 0.42), along(1), pad(1)), r, 2]);   // where the finger leaves the palm
    if (f === 'middle') palm.copy(pad(0));
  }
  const W = at('wrist'), mid = (a, b) => mix(a, b, 0.5), web = mix(J.index[1], J.thumb[1], 0.4);
  marks.push(['flush', patch(mid(J.thumb[0], J.thumb[1]), V().subVectors(J.thumb[1], J.thumb[0]).normalize(), palm), 22],
    ['flush', patch(mix(W, J.pinky[1], 0.4), V().subVectors(J.pinky[1], W).normalize(), palm), 20]);
  const lines = [                                            // the palm's three lines
    [mix(J.pinky[1], W, 0.08), mix(J.ring[1], W, 0.1), mix(J.middle[1], W, 0.08), mix(mid(J.middle[1], J.index[1]), W, -0.02)],
    [web, mix(J.middle[1], W, 0.3), mix(J.ring[1], W, 0.4), mix(J.pinky[1], W, 0.5)],
    [web, mix(J.index[1], W, 0.5), mix(mix(W, J.middle[1], 0.25), J.thumb[0], 0.35), mix(W, J.thumb[0], 0.3)],
  ].map(l => l.map(p => skinUV(p, palm)));

  let yMax = -Infinity;
  for (let i = 0; i < pos.count; i++) yMax = Math.max(yMax, pos.getY(i));
  const rim = [], ctr = V(), capUV = new THREE.Vector2(), rimUV = [];
  for (let i = 0; i < pos.count; i++) if (nor.getY(i) > 0.8 && pos.getY(i) > yMax - 0.012) {    // the flat face of the stump (bind +Y)
    const v = mesh.getVertexPosition(i, V());
    rim.push(wrist.worldToLocal(mesh.localToWorld(v))); ctr.add(v);
    rimUV.push(new THREE.Vector2().fromBufferAttribute(uv, i)); capUV.add(rimUV.at(-1));
  }
  capUV.divideScalar(rimUV.length);
  marks.push(['cap', [1, 0, 0, 1, capUV.x, capUV.y], 1250 * Math.max(...rimUV.map(p => p.distanceTo(capUV)))]);   // its own UV island: sized in UV / 1000

  const m = mesh.material;
  m.map = PAINT.skin(marks, lines); m.color.set(0xffffff); m.roughness = 1;
  m.emissive.set(0x4a140c); m.emissiveIntensity = 0.22;      // a warm lift in the shadow side
  m.onBeforeCompile = (sh) => {                              // roughness is the right half of the skin texture
    sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>',
      '#include <roughnessmap_fragment>\n\troughnessFactor *= texture2D( map, vMapUv + vec2( 0.5, 0.0 ) ).g;');
  };

  // scar ridge: a tube through the face's rim, with stitches across it
  ctr.divideScalar(rim.length);
  const a = rim[0].clone().sub(ctr).normalize(), n = new THREE.Vector3(), c = new THREE.Vector3();
  for (const p of rim) { c.crossVectors(a, p.clone().sub(ctr)); n.add(c.dot(n) < 0 ? c.negate() : c); }
  n.normalize();
  if (n.dot(ctr) < 0) n.negate();                            // out of the stump, away from the fingers
  const b = new THREE.Vector3().crossVectors(n, a);
  const ang = (p) => Math.atan2(p.clone().sub(ctr).dot(b), p.clone().sub(ctr).dot(a));
  const rMax = Math.max(...rim.map(p => p.distanceTo(ctr)));
  const curve = new THREE.CatmullRomCurve3(
    rim.filter(p => p.distanceTo(ctr) > 0.5 * rMax).sort((p, q) => ang(p) - ang(q)), true);
  // one material for both (the stitches darken it per instance), and no Object3D to place
  // them: every three.js object made at startup moves the gates' seeded random stream
  const scar = new THREE.MeshStandardMaterial({ color: 0xb98676, roughness: 0.75, emissive: 0x4a140c, emissiveIntensity: 0.2 });
  const ridge = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.0022, 8, true), scar);
  ridge.castShadow = true;
  const N = 12, stitches = new THREE.InstancedMesh(new THREE.BoxGeometry(0.0009, 0.0009, 0.007), scar, N);
  const M = new THREE.Matrix4(), P = V(), Q = new THREE.Quaternion(), Z = V(0, 0, 1), ONE = V(1, 1, 1), thread = new THREE.Color(0.03, 0.022, 0.02);
  for (let i = 0; i < N; i++) {                              // each lies over the ridge and down the wrist's side
    curve.getPointAt(i / N, P);
    P.addScaledVector(c.copy(P).sub(ctr).normalize(), 0.002).addScaledVector(n, -0.0015);
    Q.setFromUnitVectors(Z, c.copy(n).addScaledVector(curve.getTangentAt(i / N), 0.35).normalize());
    stitches.setMatrixAt(i, M.compose(P, Q, ONE)); stitches.setColorAt(i, thread);
  }
  wrist.add(ridge, stitches);
}
