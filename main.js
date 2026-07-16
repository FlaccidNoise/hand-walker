// main.js — sim core (HANDOFF §3): state, calibration, phase gait engine, swing
// planning in the hand frame, SI physics, input, main loop, __hand handle.
import * as THREE from 'three';
import { buildScene } from './src/scene.js';
import { buildRig, FINGERS } from './src/rig.js';
import { solveLeg, applyCurl, resetToBind, tipLocal, groundConstrain, padHeight, foldAnnulus } from './src/ik.js';
import { groundY } from './src/terrain.js';
import { DebugDraw } from './src/debug.js';
import * as M from './src/math.js';
import * as C from './src/tuning.js';

const hud = document.getElementById('hud');
const app = document.getElementById('app');
const UP = new THREE.Vector3(0, 1, 0);

const state = {
  ready: false,
  paused: false,
  debug: false,
  rig: null,
};

async function init() {
  const { renderer, scene, camera, controls } = buildScene(app);
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
  scene.add(rig.mount);

  const t0 = performance.now();
  const calib = calibrate(rig);
  calib.calibMs = performance.now() - t0;
  window.__stand = calib;                                    // legacy probe handle

  const sim = makeSim(rig, calib);
  sim.reset();

  const __hand = {
    rig, scene, camera, controls, dbg, C, THREE,
    solveLeg, resetToBind, tipLocal, state, calib, sim,
    reset: (...a) => sim.reset(...a),
    autoWalk: (x, z) => sim.autoWalk(x, z),
    jump: () => sim.jump(),
    get airborne() { return sim.s.airborne; },
  };
  window.__hand = __hand;

  // keyboard: ` debug overlay · p pause · r reset · WASD walk · Space jump
  const keyVel = { w: [1, 0], s: [-1, 0], a: [0, -1], d: [0, 1] };
  const down = new Set();
  const applyKeys = () => {
    let x = 0, z = 0;
    for (const k of down) if (keyVel[k]) { x += keyVel[k][0]; z += keyVel[k][1]; }
    const l = Math.hypot(x, z);
    sim.autoWalk(l ? x / l : 0, l ? z / l : 0);
  };
  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === '`') { state.debug = !state.debug; dbg.visible = state.debug; }
    if (k === 'p') state.paused = !state.paused;
    if (k === 'r') sim.reset();
    if (k === ' ') sim.jump();
    if (keyVel[k]) { down.add(k); applyKeys(); }
  });
  addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (keyVel[k]) { down.delete(k); applyKeys(); }
  });

  controls.target.set(0, calib.standH, 0);
  camera.position.set(1.4, 0.9 + calib.standH, 2.6);
  controls.update();

  const clock = new THREE.Clock();
  let frames = 0, fpsT = 0;
  function loop() {
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 1 / 30);
    if (!state.paused) sim.step(dt * C.TIME_SCALE);          // TIME_SCALE slows the clock (§4.8)
    controls.target.lerp(new THREE.Vector3(
      rig.mount.position.x, calib.standH, rig.mount.position.z), 0.08);
    controls.update();
    renderer.render(scene, camera);
    if (state.debug) drawDebug(dbg, rig, sim);
    frames++; fpsT += dt;
    if (fpsT > 0.5) {
      hud.innerHTML = devHUD(frames / fpsT, rig, sim, calib);
      frames = 0; fpsT = 0;
    }
  }
  loop();
  state.ready = true;
}

// =============================== sim ========================================
// Phase gait engine (§4.5) + swing planning in the HAND frame about the LIVE MCP
// (§4.6) + SI physics (§4.8). The hand frame is the ground-anchored, heading-rotated
// frame at the body's xz; calib.feet are the rest positions expressed in it.
function makeSim(rig, calib) {
  const body = rig.mount;
  const legs = {};
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

  const s = {
    v: new THREE.Vector3(), cmd: new THREE.Vector3(),
    vy: 0, heading: 0, yawRate: 0,
    gait: 'walk', phase: 0, f: 0, speed: 0, planted: 0,
    airborne: false, time: 0,
    gaitP: {},
  };

  // --- per-gait derived params (§4.5/§4.7): pacer band, patter multipliers, top speed ---
  for (const g of C.GAIT_ORDER) {
    const gd = C.GAITS[g];
    const used = FINGERS.filter(f => !gd.aloft.includes(f));
    const len = {};                                          // usable band: margins eat the edges
    used.forEach(f => len[f] = calib.bands[f]
      ? Math.max(calib.bands[f].hi - calib.bands[f].lo - 2 * C.BAND_MARGIN, 0.05) : 0.05);
    const maxLen = Math.max(...used.map(f => len[f]));
    const mult = {};                                         // short-band legs patter at 2× (§4.4)
    used.forEach(f => mult[f] = len[f] < 0.5 * maxLen ? 2 : 1);
    const S = Math.min(...used.map(f => len[f] * mult[f]));
    const crossF = (1 - gd.duty) / C.SWING_MIN;
    const vTop = Math.min(gd.vCap, gd.fMax <= crossF
      ? gd.fMax * S / gd.duty
      : gd.fMax * S / (1 - C.SWING_MIN * gd.fMax));
    s.gaitP[g] = { S, mult, vTop };
  }

  const handToWorld = (p, out) => out.copy(p).applyAxisAngle(UP, s.heading)
    .add(_c.set(body.position.x, 0, body.position.z));
  const worldToHand = (p, out) => out.copy(p)
    .sub(_c.set(body.position.x, 0, body.position.z)).applyAxisAngle(UP, -s.heading);
  const applyBodyPose = () => {
    body.rotation.order = 'YZX';
    body.rotation.set(C.TUNE.walkRoll, s.heading, C.TUNE.walkPitch);
    rig.root.updateMatrixWorld(true);
  };
  const dutyEff = () => 1 - Math.min(0.9,
    Math.max(1 - C.GAITS[s.gait].duty, C.SWING_MIN * s.f)); // 0.11 s swing floor (§4.5)

  // band at the height the foot will actually land at (§4.4, TUNE.liveBands)
  function bandAt(f, h) {
    if (!C.TUNE.liveBands) return calib.bands[f];
    let best = null, bd = Infinity;
    for (const row of calib.bandTable) {
      if (!row[f]) continue;
      const dd = Math.abs(row.h - h);
      if (dd < bd) { bd = dd; best = row[f]; }
    }
    return best ?? calib.bands[f];
  }

  // solve a leg to a WORLD target: rate limits cap the solve, NEVER the constraint
  // (§4.3); the stepping fold is blended in BEFORE the constraint.
  function solveLegWorld(f, targetW, rateCap, dt, fold = 0) {
    const d = rig.digits[f], leg = legs[f];
    const res = solveLeg(d, rig.root.worldToLocal(_a.copy(targetW)), { root: rig.root });
    const a = { ...res.angles };
    if (fold > 0) {
      a.pip = M.clamp(a.pip + C.FOLD_K * fold, C.LIMITS[1][0], C.LIMITS[1][1]);
      a.dip = M.clamp(d.slave * a.pip, C.LIMITS[2][0], C.LIMITS[2][1]);
    }
    if (leg.angles && rateCap) {
      const cap = rateCap * dt;
      for (const k of ['yaw', 'mcp', 'pip', 'dip'])
        a[k] = leg.angles[k] + M.clamp(a[k] - leg.angles[k], -cap, cap);
    }
    applyCurl(d, a);
    rig.root.updateMatrixWorld(true);
    if (!s.airborne) groundConstrain(d, rig.root);           // tuck skips it (§4.3)
    leg.angles = a;
    leg.err = d.tip.getWorldPosition(_a).distanceTo(targetW);
    return leg.err;
  }
  const solveStance = (f, dt = 0) => solveLegWorld(f, legs[f].foot, dt ? C.RATE_PLANTED : 0, dt);

  // --- swing planning (§4.6): hand frame, live MCP, band at live height ---
  function startSwing(f) {
    const d = rig.digits[f], leg = legs[f], gp = s.gaitP[s.gait];
    const mult = gp.mult[f] ?? 1;
    const mcpW = d.mcp.getWorldPosition(_a);
    const mcpHX = worldToHand(mcpW, _b).x;
    const band = bandAt(f, body.position.y) ?? { lo: calib.workC[f] - 0.1, hi: calib.workC[f] + 0.1 };
    const sFrom = worldToHand(leg.foot, _b).x - mcpHX;
    const rescue = sFrom < band.lo - 0.05;                   // started deep behind the band
    const dur = M.clamp(Math.max((1 - dutyEff()) / Math.max(s.f, 1e-3),
      C.SWING_MIN, rescue ? C.RESCUE_DUR : 0), C.SWING_MIN, 0.2);
    const stanceTime = dutyEff() / Math.max(s.f, 1e-3);
    const vLoc = _b.copy(s.v).applyAxisAngle(UP, -s.heading);
    const stanceDist = Math.min(Math.abs(vLoc.x) * stanceTime / mult,
      band.hi - band.lo - 2 * C.BAND_MARGIN);
    // half a stride ahead PLUS the body's advance during the swing itself — the land
    // target is fixed world, but the band is MCP-relative at LANDING time (§4.6)
    const sLand = M.clamp((band.lo + band.hi) / 2 + 0.5 * stanceDist + vLoc.x * dur,
      band.lo + C.BAND_MARGIN, band.hi - C.BAND_MARGIN + Math.max(vLoc.x, 0) * dur);
    const zLand = M.clamp(calib.feet[f].z + vLoc.z * (0.5 * stanceTime + dur),
      calib.feet[f].z - d.reachW * C.LANE_CLAMP, calib.feet[f].z + d.reachW * C.LANE_CLAMP);
    const landW = handToWorld(_b.set(mcpHX + sLand, 0, zLand), new THREE.Vector3());
    landW.y = groundY(landW.x, landW.z) + padHeight(d);
    const vm = _b.copy(landW).sub(d.mcp.getWorldPosition(_a));
    const cap = C.SWING_LAND_FRAC * d.reachW + s.speed * dur; // inside 0.72·padReach at landing
    if (vm.length() > cap) {
      landW.copy(_a).addScaledVector(vm.normalize(), cap);
      landW.y = Math.max(landW.y, groundY(landW.x, landW.z) + padHeight(d));
    }
    leg.swing = { from: leg.foot.clone(), to: landW, t: 0, dur, rescue };
    leg.mode = 'swing';
  }

  function advanceSwing(f, dt) {
    const d = rig.digits[f], leg = legs[f], sw = leg.swing;
    sw.t = Math.min(sw.t + dt / sw.dur, 1);
    const t = sw.t, ease = t * t * (3 - 2 * t);
    const target = _b.lerpVectors(sw.from, sw.to, ease);
    target.y += C.GAITS[s.gait].arcH * Math.sin(Math.PI * t); // the ask; annulus is the cap (§5)
    const mcpW = d.mcp.getWorldPosition(_a);
    const vm = _c.copy(target).sub(mcpW);
    if (vm.length() < calib.dMin[f])                          // fold-annulus cap (§4.6)
      target.copy(mcpW).addScaledVector(vm.normalize(), calib.dMin[f]);
    const fold = sw.rescue && t < C.RESCUE_HOLD ? 1 : Math.sin(Math.PI * t);
    solveLegWorld(f, target, C.RATE_SWING, dt, fold);
    if (t >= 1) {                                            // pin stance at the ACHIEVED tip
      d.tip.getWorldPosition(leg.foot);
      leg.mode = 'stance';
      leg.swing = null;
    }
  }

  // aloft (trot/run thumb): carried lifted, bears no weight (§4.7)
  const ALOFT = { yaw: 0, mcp: -0.3, pip: 1.3, dip: M.clamp(1.3 * C.DIP_SLAVE, C.LIMITS[2][0], C.LIMITS[2][1]) };
  function poseLeg(f, pose, rate, dt) {
    const d = rig.digits[f], leg = legs[f];
    const a = { ...pose };
    if (leg.angles && rate) {
      const cap = rate * dt;
      for (const k of ['yaw', 'mcp', 'pip', 'dip'])
        a[k] = leg.angles[k] + M.clamp(a[k] - leg.angles[k], -cap, cap);
    }
    applyCurl(d, a);
    rig.root.updateMatrixWorld(true);
    if (!s.airborne) groundConstrain(d, rig.root);
    leg.angles = a;
  }

  // airborne tuck: reach toward the landing rest, never below 1.15·standH under the
  // body (§4.3); the ground constraint is skipped while airborne.
  function tuckLeg(f, dt) {
    const d = rig.digits[f];
    const target = handToWorld(_b.copy(calib.feet[f]), new THREE.Vector3());
    target.y = Math.max(groundY(target.x, target.z) + padHeight(d),
      body.position.y - C.TUCK_MIN * calib.standH);
    solveLegWorld(f, target, C.RATE_SWING, dt);
  }

  function reseedFeet() {
    for (const f of FINGERS) {
      const d = rig.digits[f], leg = legs[f];
      handToWorld(_b.copy(calib.feet[f]), leg.foot);
      leg.foot.y = groundY(leg.foot.x, leg.foot.z) + padHeight(d);
      leg.mode = 'stance'; leg.swing = null; leg.cycleId = -1;
      solveStance(f);
    }
  }

  function step(dt) {
    s.time += dt;
    const cmdSpeed = Math.hypot(s.cmd.x, s.cmd.z);

    // --- steering ---
    if (cmdSpeed > C.V_MOVE && !s.airborne) {
      const hd = Math.atan2(-s.cmd.z, s.cmd.x);
      s.yawRate = M.clamp(C.STEER_GAIN * M.wrapAngle(hd - s.heading), -C.YAW_RATE_MAX, C.YAW_RATE_MAX);
    } else s.yawRate *= Math.exp(-6 * dt);
    s.heading = M.wrapAngle(s.heading + s.yawRate * dt);

    // --- gait selection by commanded speed with hysteresis (§4.7) ---
    const gi = C.GAIT_ORDER.indexOf(s.gait);
    if (gi < 2 && cmdSpeed > s.gaitP[s.gait].vTop + C.GAIT_HYST) s.gait = C.GAIT_ORDER[gi + 1];
    else if (gi > 0 && cmdSpeed < s.gaitP[C.GAIT_ORDER[gi - 1]].vTop) s.gait = C.GAIT_ORDER[gi - 1];

    // --- SI physics (§4.8) ---
    s.speed = Math.hypot(s.v.x, s.v.z);
    s.planted = s.airborne ? 0 : FINGERS.filter(f => legs[f].mode === 'stance').length;
    const rideH = cmdSpeed > C.V_MOVE ? calib.standH * C.POSE_CROUCH : calib.standH;
    let N = 0;                                               // support, newtons
    if (!s.airborne && s.planted > 0) {
      const cM = (rideH - body.position.y) * rig.WORLD_M;
      N = M.clamp(C.SPRING_K * cM - C.SPRING_C * s.vy * rig.WORLD_M, 0, s.planted * C.F_DIGIT);
    }
    s.vy += (N / (C.MASS * rig.WORLD_M) - rig.G) * dt;
    if (!s.airborne && s.planted > 0) {
      // friction-limited traction (§4.8): FhMax = min(μN, planted·F_DIGIT_LAT), no air control
      const ax = (s.cmd.x - s.v.x) / C.ACCEL_TAU, az = (s.cmd.z - s.v.z) / C.ACCEL_TAU;
      const aCap = Math.min(C.MU * N, s.planted * C.F_DIGIT_LAT) / (C.MASS * rig.WORLD_M);
      const aLen = Math.hypot(ax, az);
      const k = aLen > aCap ? aCap / aLen : 1;               // tract clamp
      s.v.x += ax * k * dt; s.v.z += az * k * dt;
    }
    body.position.x += s.v.x * dt;
    body.position.z += s.v.z * dt;
    body.position.y += s.vy * dt;
    if (s.airborne && s.vy <= 0 && body.position.y <= calib.standH) {
      s.airborne = false; s.vy *= 0.1;                       // touchdown; springs absorb the rest
      applyBodyPose(); reseedFeet();
    }
    applyBodyPose();
    // palm/knuckle-dome bottoms out at the floor and scrapes (§4.8)
    let pen = 0;
    for (const f of FINGERS) {
      const d = rig.digits[f];
      const p = d.mcp.getWorldPosition(_a);
      pen = Math.max(pen, groundY(p.x, p.z) + padHeight(d) - p.y);
    }
    if (pen > 0) {
      body.position.y += pen;
      s.vy = Math.max(s.vy, 0);
      const drag = Math.exp(-8 * dt);                        // sliding friction
      s.v.x *= drag; s.v.z *= drag;
      applyBodyPose();
    }

    // --- phase engine (§4.5): cadence solved for zero foot-slip ---
    const gd = C.GAITS[s.gait], gp = s.gaitP[s.gait];
    if (!s.airborne && (cmdSpeed > C.V_MOVE || s.speed > C.V_MOVE)) {
      const v = Math.max(s.speed, C.V_MOVE);
      const crossF = (1 - gd.duty) / C.SWING_MIN;
      let f = v * gd.duty / gp.S;
      if (f > crossF) f = v / (gp.S + C.SWING_MIN * v);
      f += C.CAD_YAW_GAIN * Math.abs(s.yawRate);             // turning consumes band
      s.f = Math.min(f, gd.fMax);
      s.phase += s.f * dt;                                   // UNWRAPPED: floor() is the cycle id
    } else s.f = 0;

    // --- legs ---
    const de = dutyEff();
    for (const f of FINGERS) {
      const leg = legs[f];
      if (s.airborne) { leg.mode = 'tuck'; tuckLeg(f, dt); continue; }
      if (gd.aloft.includes(f) && s.speed > C.V_MOVE) {      // aloft only while moving (§4.7)
        leg.mode = 'aloft'; poseLeg(f, ALOFT, C.RATE_SWING, dt); continue;
      }
      if (leg.mode === 'aloft' || leg.mode === 'tuck') {     // re-plant at the rest
        handToWorld(_b.copy(calib.feet[f]), leg.foot);
        leg.foot.y = groundY(leg.foot.x, leg.foot.z) + padHeight(rig.digits[f]);
        leg.mode = 'stance'; leg.cycleId = -1;
      }
      const cyc = s.phase * (gp.mult[f] ?? 1) + gd.offsets[f];
      const p = cyc % 1, id = Math.floor(cyc);
      if (leg.mode === 'stance' && s.f > 0 && p >= de && leg.cycleId !== id) {
        leg.cycleId = id;
        startSwing(f);
      } else if (leg.mode === 'stance' && s.f === 0 && leg.err > 2 * C.BAND_TIP_ERR) {
        startSwing(f);                                       // settle a stretched leg at rest
      }
      if (leg.mode === 'swing') advanceSwing(f, dt);
      else solveStance(f, dt);
    }
  }

  function reset(px = 0, pz = 0, heading = 0) {
    s.v.set(0, 0, 0); s.cmd.set(0, 0, 0);
    s.vy = 0; s.heading = heading; s.yawRate = 0;
    s.gait = 'walk'; s.phase = 0; s.f = 0; s.speed = 0; s.planted = 5;
    s.airborne = false;
    body.position.set(px, calib.standH, pz);
    applyBodyPose();
    for (const f of FINGERS) {
      rig.digits[f].yaw = 0;
      legs[f] = { mode: 'stance', foot: new THREE.Vector3(), swing: null, angles: null, err: 0, cycleId: -1 };
    }
    reseedFeet();                                            // reseed DIGITS, not just body (§7)
  }

  function autoWalk(x, z) {                                  // velocity command, u/s
    const l = Math.hypot(x, z);
    const k = l > C.V_MAX ? C.V_MAX / l : 1;                 // leash tops out at V_MAX
    s.cmd.set(x * k, 0, z * k);
  }

  function jump() {
    if (s.airborne || s.planted === 0) return;
    // energy-based (§4.8): burst force × push-off stroke × planted − weight × stroke
    const E = (C.F_DIGIT_BURST * s.planted - C.MASS * C.G_SI) * (C.JUMP_STROKE * rig.WORLD_M);
    if (E <= 0) return;
    s.vy = Math.sqrt(2 * E / C.MASS) / rig.WORLD_M;
    s.airborne = true;
  }

  return { s, legs, step, reset, autoWalk, jump, bandAt };
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
    body.rotation.order = 'YZX';
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
  // (holding the rest offset) where tip err < BAND_TIP_ERR ---
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

function devHUD(fps, rig, sim, calib) {
  const s = sim.s;
  const lines = [
    `<b>Hand Walker</b>  fps ${fps.toFixed(0)}  ${state.paused ? '<b>PAUSED</b>' : ''}`,
    `WORLD_M ${(rig.WORLD_M * 100).toFixed(2)}cm/u  G ${rig.G.toFixed(1)} u/s²  standH ${calib.standH.toFixed(3)}`,
    `gait <b>${s.gait}</b>  f ${s.f.toFixed(2)}Hz  v ${s.speed.toFixed(2)}  cmd ${Math.hypot(s.cmd.x, s.cmd.z).toFixed(2)}  planted ${s.planted}${s.airborne ? '  <b>AIR</b>' : ''}`,
    ...FINGERS.map(f => {
      const l = sim.legs[f];
      return `${f.padEnd(6)} ${l.mode.padEnd(6)} err ${l.err.toFixed(3)}`;
    }),
    `WASD walk · Space jump · R reset · \` debug`,
  ];
  return lines.join('\n');
}

function drawDebug(dbg, rig, sim) {
  dbg.clear();
  const p = new THREE.Vector3(), p2 = new THREE.Vector3();
  for (const f of FINGERS) {
    const d = rig.digits[f], leg = sim.legs[f];
    const chain = [rig.wrist, ...d.joints];
    for (let i = 0; i < chain.length - 1; i++) {
      chain[i].getWorldPosition(p); chain[i + 1].getWorldPosition(p2);
      dbg.line(p, p2, leg.mode === 'stance' ? 0x8fe0ff : leg.mode === 'swing' ? 0xffd060 : 0x777788);
    }
    dbg.point(leg.foot, leg.mode === 'stance' ? 0x40ff90 : 0x666666);
    if (leg.swing) dbg.point(leg.swing.to, 0xff60a0);
  }
}

init();
