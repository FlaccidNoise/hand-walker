// main.js — sim core entry. (HANDOFF §3: state, gait, calibration, input, loop, __hand)
import * as THREE from 'three';
import { buildScene } from './src/scene.js';
import { buildRig, FINGERS } from './src/rig.js';
import { solveLeg, resetToBind, tipLocal, groundConstrain, padHeight, foldAnnulus } from './src/ik.js';
import { DebugDraw } from './src/debug.js';
import * as C from './src/tuning.js';

const hud = document.getElementById('hud');
const app = document.getElementById('app');

const state = {
  ready: false,
  paused: false,
  debug: false,
  rig: null,
};

async function init() {
  const { renderer, scene, camera, controls, ground } = buildScene(app);
  const dbg = new DebugDraw(scene);
  dbg.visible = false;

  let rig;
  try {
    rig = await buildRig('./assets/generic-hand-left.glb', C.HANDEDNESS);
  } catch (e) {
    console.error('rig load failed', e);
    state._rigErr = (e && (e.stack || e.message)) || String(e);
    hud.textContent = 'RIG LOAD FAILED: ' + state._rigErr;
    return;
  }
  state.rig = rig;

  // park the hand palm-down, fingers forward, hovering for visual check
  rig.mount.position.set(0, 0.6, 0);
  rig.root.updateMatrixWorld(true);
  scene.add(rig.mount);

  // expose dev handles (QA harness reaches window.__hand, window.__qa later)
  const __hand = {
    rig, scene, camera, controls, dbg, C,
    THREE, solveLeg, resetToBind, tipLocal,
    state,
    reset() { /* full reset incl. digit reseed — §7 gotcha */ },
    autoWalk(x, z) { /* set velocity command */ },
    airborne: false,
  };
  window.__hand = __hand;

  // keyboard: ` toggles debug overlay
  addEventListener('keydown', (e) => {
    if (e.key === '`') { state.debug = !state.debug; dbg.visible = state.debug; }
    if (e.key === 'p') { state.paused = !state.paused; }
  });

  const clock = new THREE.Clock();
  let frames = 0, fpsT = 0;

  const t0 = performance.now();
  const calib = calibrate(rig);
  calib.calibMs = performance.now() - t0;
  __hand.calib = calib;
  window.__stand = calib;                                    // legacy probe handle
  controls.target.set(0, calib.standH, 0); camera.position.set(1.4, 0.9 + calib.standH, 2.0); controls.update();

  function loop() {
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 1 / 30);
    controls.update();
    renderer.render(scene, camera);
    if (state.debug) drawDebug(dbg, rig);
    frames++; fpsT += dt;
    if (fpsT > 0.5) {
      const fps = frames / fpsT;
      hud.innerHTML = devHUD(fps, dt, rig);
      frames = 0; fpsT = 0;
    }
  }
  loop();
  state.ready = true;
}

// --- calibrate() — §4.4 stance-band calibration, THE load-bearing scan. ---
// Reachability is measured through the REAL solve stack (solveLeg + ground constraint):
// the analytic chord over-promises. Deterministic — no wall clock, fixed sample grids.
// solveLeg works in ROOT-local (bind meters); targets go through root.worldToLocal;
// tip error is measured in WORLD units. A buried MCP knuckle-dome (body geometry — IK
// can't lift it) invalidates a height outright.
function calibrate(rig) {
  const body = rig.mount;
  const tmp = new THREE.Vector3();
  const setPose = (h, walk) => {
    body.position.set(0, h, 0);
    body.rotation.set(walk ? C.TUNE.walkRoll : 0, 0, walk ? C.TUNE.walkPitch : 0);
    rig.root.updateMatrixWorld(true);
  };

  // foot rests: bind tip xz pulled 3% toward the MCP (§5 standH rule), pad height up
  const feet = {};
  setPose(0, false);
  for (const f of FINGERS) {
    const d = rig.digits[f];
    const tipW = rig.root.localToWorld(d.pos.tip.clone());
    const mcpW = rig.root.localToWorld(d.pos.mcp.clone());
    feet[f] = new THREE.Vector3(
      mcpW.x + C.REST_SCALE * (tipW.x - mcpW.x), padHeight(d),
      mcpW.z + C.REST_SCALE * (tipW.z - mcpW.z));
  }
  const solveTo = (d, target) => {
    solveLeg(d, rig.root.worldToLocal(target.clone()), { root: rig.root });
    groundConstrain(d, rig.root);
    return d.tip.getWorldPosition(tmp).distanceTo(target);   // world-unit tip err
  };
  const plantDigit = (f) => {
    const d = rig.digits[f];
    if (d.mcp.getWorldPosition(tmp).y < padHeight(d)) return Infinity;
    return solveTo(d, feet[f]);
  };

  // --- standH: lowest body height where every digit (incl. thumb) plants (§5) ---
  let standH = 0;
  const perDigitH = {};
  for (let h = 0.20; h <= 0.85; h += 0.002) {
    setPose(h, false);
    let allOk = true;
    for (const f of FINGERS) {
      if (plantDigit(f) > C.BAND_TIP_ERR) { allOk = false; break; }
      if (perDigitH[f] == null) perDigitH[f] = h;
    }
    if (allOk) { standH = h; break; }
  }

  // --- stance bands: scan each leg's foot along its lane (MCP-relative forward
  // offset s, constant lateral z) at the walking pose; keep the contiguous window
  // (containing the best sample) where tip err < BAND_TIP_ERR ---
  const scanBand = (f, h, step = C.BAND_S_STEP) => {
    setPose(h, true);
    const d = rig.digits[f];
    const mcpW = d.mcp.getWorldPosition(tmp);
    if (mcpW.y < padHeight(d)) return null;
    const mcpX = mcpW.x;
    const sRest = feet[f].x - mcpX;                          // the stance the leg actually uses
    const target = new THREE.Vector3(0, padHeight(d), feet[f].z);
    d.yaw = 0;                                               // deterministic branch seed
    const runs = []; let cur = null;
    for (let s = C.BAND_S_MIN; s <= C.BAND_S_MAX + 1e-9; s += step) {
      target.x = mcpX + s;
      const err = solveTo(d, target);
      if (err < C.BAND_TIP_ERR) { if (cur) cur.hi = s; else runs.push(cur = { lo: s, hi: s }); }
      else cur = null;
    }
    // keep the run holding the rest offset (else nearest to it) — a global-best-error
    // selector is fragile: the thumb's yaw cone reaches spurious pockets behind the MCP
    return runs.find(r => sRest >= r.lo && sRest <= r.hi)
      ?? runs.sort((a, b) => Math.min(Math.abs(a.lo - sRest), Math.abs(a.hi - sRest))
        - Math.min(Math.abs(b.lo - sRest), Math.abs(b.hi - sRest)))[0]
      ?? null;
  };
  const walkH = standH * C.POSE_CROUCH + C.POSE_SAG;

  // --- walk pitch ("set at rig time from bind geometry"): nose-up pitch about the
  // wrist lifts the knuckle dome (MCPs sit forward of the wrist) and shifts knuckles
  // forward of bind (§4.6). Read-only scan with the real solver (§8): keep the
  // smallest pitch that maximizes the weakest digit's band at the walk pose. ---
  let bestPitch = 0, bestScore = -1;
  for (let p = 0; p <= 0.4 + 1e-9; p += 0.05) {
    C.TUNE.walkPitch = p;
    let score = Infinity;
    for (const f of FINGERS) {
      const b = scanBand(f, walkH, 0.03);
      score = Math.min(score, b ? b.hi - b.lo : 0);
      if (score === 0) break;
    }
    if (score > bestScore + 1e-9) { bestScore = score; bestPitch = p; }
  }
  C.TUNE.walkPitch = bestPitch;

  const bands = {}, workC = {}, dMin = {};
  for (const f of FINGERS) {
    bands[f] = scanBand(f, walkH);
    workC[f] = bands[f] ? (bands[f].lo + bands[f].hi) / 2 : null;
    dMin[f] = foldAnnulus(rig.digits[f]);
  }
  const strideMax = Math.min(...FINGERS.map(f => bands[f] ? bands[f].hi - bands[f].lo : 0));

  // --- per-height band table (§4.4): each landing queries the band at the height the
  // foot will actually land at. TUNE.liveBands=1 uses it; 0 is the A/B control. ---
  const bandTable = [];
  for (let i = 0; i < C.BAND_HEIGHT_SAMPLES; i++) {
    const h = walkH - C.BAND_HEIGHT_RANGE
      + (2 * C.BAND_HEIGHT_RANGE * i) / (C.BAND_HEIGHT_SAMPLES - 1);
    const row = { h };
    for (const f of FINGERS) row[f] = scanBand(f, h);
    bandTable.push(row);
  }

  // settle: park at standH with every digit planted at its rest
  setPose(standH, false);
  const plantErr = {};
  for (const f of FINGERS) { rig.digits[f].yaw = 0; plantErr[f] = plantDigit(f); }
  return { standH, walkH, perDigitH, plantErr, feet, bands, workC, dMin, strideMax, bandTable };
}

function devHUD(fps, dt, rig) {
  if (!rig) return '';
  const d = rig.digits;
  const st = window.__stand || {};
  const lines = [
    `<b>Hand Walker</b>  fps ${fps.toFixed(0)}  ${state.paused?'<b>PAUSED</b>':''}`,
    `WORLD_M ${(rig.WORLD_M * 100).toFixed(2)}cm/u  G ${rig.G.toFixed(1)} u/s²  scale ${rig.scale.toFixed(2)}`,
    `<b>standH ${((st.standH||0)*1).toFixed(4)}u</b>  (${((st.standH||0)*rig.WORLD_M*100).toFixed(2)}cm)  pinky pins it (§5)`,
    ...FINGERS.map(f => `${f.padEnd(6)} reach ${d[f].reach.toFixed(3)}m  reachH ${(st.perDigitH?.[f]||0).toFixed(3)}  plantErr ${(st.plantErr?.[f]||0).toFixed(4)}`),
  ];
  return lines.join('\n');
}

function drawDebug(dbg, rig) {
  dbg.clear();
  const p = new THREE.Vector3();
  const p2 = new THREE.Vector3();
  for (const f of FINGERS) {
    const d = rig.digits[f];
    const chain = [rig.wrist, ...d.joints];
    for (let i = 0; i < chain.length - 1; i++) {
      chain[i].getWorldPosition(p); chain[i + 1].getWorldPosition(p2);
      dbg.line(p, p2, 0x8fe0ff);
    }
    d.mcp.getWorldPosition(p); dbg.point(p, 0xff60a0);
    d.tip.getWorldPosition(p); dbg.point(p, 0xffd060);
  }
}

init();
