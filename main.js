// main.js — sim core entry. (HANDOFF §3: state, gait, calibration, input, loop, __hand)
import * as THREE from 'three';
import { buildScene } from './src/scene.js';
import { buildRig, FINGERS } from './src/rig.js';
import { solveLeg, resetToBind, tipLocal, groundConstrain, padHeight } from './src/ik.js';
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

  // --- standH: lowest body height where every digit (incl. thumb) reaches its rest
  //     ×0.97 through the REAL solve stack (solveLeg + ground constraint) with tip
  //     err < BAND_TIP_ERR. The pinky pins it (§5). ---
  // solveLeg works in ROOT-local (bind meters); targets go through root.worldToLocal.
  // Post-constraint tip error is measured in WORLD units (the constraint yanks the tip
  // off-target whenever a knuckle would be underground, so those heights self-reject).
  const body = rig.mount;
  const feet = {};
  const tmp = new THREE.Vector3();
  body.position.set(0, 0, 0); rig.root.updateMatrixWorld(true);
  for (const f of FINGERS) {
    const d = rig.digits[f];
    const tipW = rig.root.localToWorld(d.pos.tip.clone());   // bind rest, world at body y=0
    const mcpW = rig.root.localToWorld(d.pos.mcp.clone());
    feet[f] = new THREE.Vector3(
      mcpW.x + C.REST_SCALE * (tipW.x - mcpW.x), padHeight(d),
      mcpW.z + C.REST_SCALE * (tipW.z - mcpW.z));
  }
  const plantDigit = (f) => {
    const d = rig.digits[f];
    // the MCP knuckle dome is BODY geometry — IK can't lift it, so a buried dome
    // invalidates the height outright (returns err = Infinity)
    if (d.mcp.getWorldPosition(tmp).y < padHeight(d)) return Infinity;
    solveLeg(d, rig.root.worldToLocal(feet[f].clone()), { root: rig.root });
    groundConstrain(d, rig.root);
    return d.tip.getWorldPosition(tmp).distanceTo(feet[f]); // world-unit tip err
  };
  let standH = 0;
  const perDigitH = {};
  for (let h = 0.20; h <= 0.85; h += 0.002) {
    body.position.y = h; rig.root.updateMatrixWorld(true);
    let allOk = true;
    for (const f of FINGERS) {
      if (plantDigit(f) > C.BAND_TIP_ERR) { allOk = false; break; }
      if (perDigitH[f] == null) perDigitH[f] = h;            // first (lowest) h each digit reaches
    }
    if (allOk) { standH = h; break; }                       // lowest h where ALL reach
  }
  // settle at standH, plant every digit to its foot
  body.position.y = standH; rig.root.updateMatrixWorld(true);
  const plantErr = {};
  for (const f of FINGERS) plantErr[f] = plantDigit(f);
  window.__stand = { standH, perDigitH, plantErr, feet };
  controls.target.set(0, standH, 0); camera.position.set(1.4, 0.9 + standH, 2.0); controls.update();

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
