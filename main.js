// main.js — sim core entry. (HANDOFF §3: state, gait, calibration, input, loop, __hand)
import * as THREE from 'three';
import { buildScene } from './src/scene.js';
import { buildRig, FINGERS } from './src/rig.js';
import { solveLeg, resetToBind, tipLocal } from './src/ik.js';
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
  // --- IK reach-test: middle finger tracks a target circling in its curl plane ---
  const mid = rig.digits.middle;
  const pb = planeBasis(mid);
  let testErr = 0, testTarget = new THREE.Vector3();
  function planeBasis(d) {
    const e1 = d.pos.pip.clone().sub(d.pos.mcp).addScaledVector(d.axisW, -d.out0);
    if (e1.lengthSq() < 1e-9) e1.set(0, -1, 0); e1.normalize();
    return { e1, e2: new THREE.Vector3().crossVectors(d.axisW, e1).normalize() };
  }
  function loop() {
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 1 / 30);
    const T = clock.elapsedTime;
    if (!state.paused) {
      // animate target in the curl plane: radius 0.7·reach, full revolution
      const r = 0.7 * mid.reach;
      const ang = T * 1.2;
      testTarget.copy(mid.pos.mcp).addScaledVector(pb.e1, r * Math.cos(ang)).addScaledVector(pb.e2, r * Math.sin(ang));
      const res = solveLeg(mid, testTarget, { root: rig.root });
      testErr = res.err;
      rig.root.updateMatrixWorld(true);
      window.__ikTest = { err: testErr, target: testTarget.toArray(), achieved: res.achieved.toArray() };
    }
    controls.update();
    renderer.render(scene, camera);
    if (state.debug) drawDebug(dbg, rig, testTarget);
    frames++; fpsT += dt;
    if (fpsT > 0.5) {
      const fps = frames / fpsT;
      hud.innerHTML = devHUD(fps, dt, rig, testErr, testTarget);
      frames = 0; fpsT = 0;
    }
  }
  loop();
  state.ready = true;
}

function devHUD(fps, dt, rig, testErr, testTarget) {
  if (!rig) return '';
  const d = rig.digits;
  const lines = [
    `<b>Hand Walker</b>  fps ${fps.toFixed(0)}  ${state.paused?'<b>PAUSED</b>':''}`,
    `WORLD_M ${(rig.WORLD_M * 100).toFixed(2)}cm/u  G ${rig.G.toFixed(1)} u/s²  scale ${rig.scale.toFixed(2)}`,
    `IK test: middle tip err ${testErr?.toFixed(4)}u  target(${testTarget?.toArray().map(v=>v.toFixed(2)).join(',')})`,
    ...FINGERS.map(f => `${f.padEnd(6)} reach ${d[f].reach.toFixed(3)}m  seg [${d[f].segLen.map(s=>s.toFixed(3)).join(',')}]  axisW(${d[f].axisW.toArray().map(v=>v.toFixed(2)).join(',')})`),
  ];
  return lines.join('\n');
}

function drawDebug(dbg, rig, testTarget) {
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
    d.mcp.getWorldPosition(p); dbg.arrow(p, d.axisW, 0.04, 0x60ff90);
  }
  if (testTarget) {
    const w = rig.root.localToWorld(testTarget.clone());
    dbg.point(w, 0xff3030);
  }
}

init();
