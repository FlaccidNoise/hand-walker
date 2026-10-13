// main.js — sim core (HANDOFF §3): state, calibration, phase gait engine, swing
// planning in the hand frame, SI physics, input, main loop, __hand handle.
import * as THREE from 'three';
import { buildScene } from './src/scene.js';
import { buildRig, FINGERS } from './src/rig.js';
import { solveLeg, applyCurl, resetToBind, tipLocal, groundConstrain, padHeight, foldAnnulus } from './src/ik.js';
import { groundY } from './src/terrain.js';
import { GESTURES, IDLES, sampleTrack } from './src/gestures.js';
import { makeBrain } from './src/brain.js';
import { initInput } from './src/input.js';
import { makeProps, SOUNDS } from './src/props.js';
import { initUI } from './src/ui.js';
import { DebugDraw } from './src/debug.js';
import * as M from './src/math.js';
import { digitRatio, strideBudget, digitDuty } from './src/gait.js';
import * as C from './src/tuning.js';

const hud = document.getElementById('hud');
const app = document.getElementById('app');
const UP = new THREE.Vector3(0, 1, 0);
const DEV = new URLSearchParams(location.search).has('dev');   // QA harness + reset/pause keys

const state = {
  ready: false,
  paused: false,
  debug: false,
  rig: null,
};

async function init() {
  let built;
  try { built = buildScene(app); }
  catch (e) {
    console.error('no WebGL context, so the page cannot draw: use a current browser with hardware acceleration on.', e);
    window.__fatal('This page needs WebGL. Try a current Chrome, Firefox or Safari.');
    return;
  }
  const { renderer, scene, camera, view, aim, controls, lights } = built;
  const dbg = new DebugDraw(scene);
  dbg.visible = false;
  const props = makeProps({ scene, lights });
  renderer.render(scene, camera);                            // the room shows while the hand loads

  let rig;
  try {
    rig = await buildRig('./assets/generic-hand-left.glb', C.HANDEDNESS);
  } catch (e) {
    console.error('rig load failed: check that assets/generic-hand-left.glb is served, then reload.', e);
    state._rigErr = (e && (e.stack || e.message)) || String(e);
    window.__fatal('The hand did not load.');
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
  const brain = makeBrain(sim, rig, camera, props);
  const ui = initUI({ renderer, camera, rig, sim, brain, dev: DEV });
  // gesture cues: sounds, and the double snap that works any `remote` prop from afar
  sim.onCue = (name) => {
    if (name === 'remote') props.fire('switch');
    else if (SOUNDS[name]) SOUNDS[name]();
    if (name === 'knock') view.shake = 1;                    // a knock on the glass rattles the view
    ui.cue();
  };
  sim.onStep = (f, foot) => props.footfall(f, foot.x, foot.z, sim.s.speed);

  const __hand = {
    rig, scene, camera, renderer, view, controls, dbg, C, THREE, GESTURES, IDLES, props,
    solveLeg, resetToBind, tipLocal, groundY, state, calib, sim, brain,
    reset: (...a) => { brain.stop(); sim.reset(...a); },
    autoWalk: (x, z) => sim.autoWalk(x, z),
    jump: () => sim.jump(),
    gesture: (name) => sim.gesture(name),
    pivot: (deg) => sim.pivot(deg),
    get airborne() { return sim.s.airborne; },
  };
  window.__hand = __hand;

  const input = initInput({ renderer, camera, controls, scene, rig, brain, props, ui });

  // dev keys (movement, emotes and clicks live in src/input.js, page keys in src/ui.js)
  if (DEV) addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === '`') { state.debug = !state.debug; dbg.visible = state.debug; controls.enabled = state.debug; }
    if (k === 'p') state.paused = !state.paused;
    if (k === 'r') { brain.stop(); sim.reset(); }
  });

  const clock = new THREE.Clock();
  let frames = 0, fpsT = 0, acc = 0;
  function loop() {
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 1 / 30);
    if (!state.paused) {
      // fixed step: the support spring's explicit damping diverges past ~7.9 ms, so a
      // 60 Hz frame (12.5 ms sim) fed straight in launches the standing hand
      acc += dt * C.TIME_SCALE;                              // TIME_SCALE slows the clock (§4.8)
      let n = 0;
      while (acc >= C.SIM_DT - 1e-9 && n++ < C.SIM_MAX_SUBSTEPS) {  // ε: a 120 Hz frame is one step, not 0-then-2
        sim.step(C.SIM_DT);
        brain.tick(C.SIM_DT);
        const B = rig.mount.position, landed = sim.s.landed;
        sim.s.landed = false;
        props.update(C.SIM_DT, { x: B.x, y: B.y, z: B.z, vx: sim.s.v.x, vz: sim.s.v.z, airborne: sim.s.airborne }, landed);
        acc -= C.SIM_DT;
      }
      if (acc >= C.SIM_DT) acc = 0;                          // overloaded: drop time, never feed a long step
      else if (acc < 0) acc = 0;
    }
    input.update(dt);
    if (controls.enabled) controls.update();                 // orbit is debug-only
    else aim(dt, rig.mount.position, !!sim.s.gesture && !sim.s.gesture.idle && !sim.s.airborne, clock.elapsedTime);
    renderer.render(scene, camera);
    ui.update(dt);                                           // after the render: it reads this frame's camera
    if (state.debug) drawDebug(dbg, rig, sim);
    frames++; fpsT += dt;
    if (fpsT > 0.5) {
      hud.innerHTML = DEV || state.debug ? devHUD(frames / fpsT, rig, sim, calib, brain) : '';   // numbers are a dev view
      frames = 0; fpsT = 0;
    }
  }
  loop();
  if (DEV) await import('./qa.js');
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
  const SEP_PAIRS = [['thumb', 'index'], ['index', 'middle'], ['middle', 'ring'], ['ring', 'pinky']];
  const restA = {};                                          // per-digit stance angles, captured in reset()
  const sepPrev = {};

  const s = {
    v: new THREE.Vector3(), cmd: new THREE.Vector3(), cmdT: new THREE.Vector3(),
    vy: 0, heading: 0, yawRate: 0,
    gait: 'walk', gaitT: 0, phase: 0, f: 0, vEff: 0, speed: 0, planted: 0,
    airborne: false, replant: false, landed: false, time: 0,
    spr: { pitch: { x: 0, v: 0 }, roll: { x: 0, v: 0 } },
    gaitP: {}, gesture: null, carry: null, lastInput: 0, nextIdleAt: 0, pivotTarget: null, turnWait: 0, hop: null, rng: 1,
  };
  // seeded LCG: the sim core replays exactly (Math.random broke that after 8 s idle)
  let stopKick = false;
  const kick = (pitch, roll) => { s.spr.pitch.v += pitch; s.spr.roll.v += roll; };
  const rand = () => (s.rng = (s.rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

  // --- per-gait derived params (§4.5/§4.7): stride budget, per-digit duty ratio, top speed ---
  for (const g of C.GAIT_ORDER) {
    const gd = C.GAITS[g];
    const used = FINGERS.filter(f => !gd.aloft.includes(f));
    const len = {};                                          // usable band: margins eat the edges
    used.forEach(f => len[f] = calib.bands[f]
      ? Math.max(calib.bands[f].hi - calib.bands[f].lo - 2 * C.BAND_MARGIN, 0.05) : 0.05);
    // per-digit duty (src/gait.js): the longest band sets the stride, shorter digits
    // lift earlier. TUNE.digitDuty 0 = one shared stride paced by the shortest band (A/B)
    const ratio = C.TUNE.digitDuty ? digitRatio(len, gd.ratioMin)
      : Object.fromEntries(used.map(f => [f, 1]));
    const S = strideBudget(len, ratio, C.BAND_UTIL);
    const crossF = (1 - gd.duty) / C.SWING_MIN;
    const vTop = Math.min(gd.vCap, gd.fMax <= crossF
      ? gd.fMax * S / gd.duty
      : gd.fMax * S / (1 - C.SWING_MIN * gd.fMax));
    s.gaitP[g] = { S, len, vTop };
  }

  const handToWorld = (p, out) => out.copy(p).applyAxisAngle(UP, s.heading)
    .add(_c.set(body.position.x, 0, body.position.z));
  const worldToHand = (p, out) => out.copy(p)
    .sub(_c.set(body.position.x, 0, body.position.z)).applyAxisAngle(UP, -s.heading);
  // gesture engine (buddy vocabulary): a timed pose-script layer over the standing
  // stance. Body-pose offsets absorb automatically (planted legs re-solve to their
  // pinned world feet every frame); digits via pose tracks in src/gestures.js.
  const NO_GESTURE = { pitch: 0, roll: 0, heading: 0, height: 0, lift: 0 };
  function gesturePose() {
    const g = s.gesture, b = g && g.def.body, c = s.carry;
    if (!b && !c) return NO_GESTURE;
    const u = g ? g.t / g.dur : 0;
    const p = b ? { pitch: sampleTrack(b.pitch, u), roll: sampleTrack(b.roll, u),
      heading: 0, height: sampleTrack(b.height, u), lift: sampleTrack(b.lift, u) } : { ...NO_GESTURE };
    if (c) {                                                 // a gesture cut short eases out, it does not pop
      const k = 1 - c.t * c.t * (3 - 2 * c.t);
      p.pitch += c.pitch * k; p.roll += c.roll * k; p.height += c.height * k;
    }
    return p;
  }
  // end a stance gesture now: its body pose is carried and eased out over GESTURE_CUT s
  function dropGesture() {
    const p = gesturePose();
    s.gesture = null;
    s.carry = Math.abs(p.pitch) + Math.abs(p.roll) + Math.abs(p.height) > 1e-4
      ? { pitch: p.pitch, roll: p.roll, height: p.height, t: 0 } : null;
  }
  // hover gestures (thumbsUp/thumbsDown/flipBird): the whole hand leaves the ground
  // (def.hover === true) — every digit gets a pose-track entry (def.digits[f] for
  // all five), so the EXISTING single-digit gesture-pose branch in the per-leg loop
  // already generalizes with no new branching there. What hover DOES need: body.lift
  // driving body.position.y directly (the capped-force stance spring can't produce a
  // clean full liftoff) and the grounded physics/belly-scrape blocks skipped — see
  // step(). Re-plants via applyBodyPose+reseedFeet on end, mirroring jump's landing.
  const hovering = () => !!(s.gesture && s.gesture.def.hover);
  const cancelIdle = () => { if (s.gesture && s.gesture.idle) dropGesture(); };
  const markInput = () => { cancelIdle(); s.lastInput = s.time; };
  function gesture(name) {
    const def = GESTURES[name];
    markInput();
    if (!def || s.airborne || s.speed > C.V_MOVE || s.pivotTarget != null) return false;
    // a new gesture replaces a stance gesture at once. A hover has the hand in the air
    // as a fist: it finishes first (the caller tries again)
    if (s.gesture) { if (s.gesture.def.hover) return false; dropGesture(); }
    // a hover lifts off from the settled stance only: started while a cut gesture was
    // still easing out, the closing fist met the floor and a digit was thrown 1.03 u
    if (def.hover && (s.carry || !FINGERS.every(f => legs[f].mode === 'stance'))) return false;
    s.gesture = { name, t: 0, dur: def.dur, def };
    return true;
  }
  // pivot-in-place: rotate to face a new heading with zero translation. Distinct
  // from steering (which only turns while cmdSpeed>V_MOVE, i.e. walk-and-turn) —
  // this drives yawRate directly at rest, and startSwing gets a dedicated
  // rotation-only landing target (§ see startSwing) instead of the translation
  // drift-compensation math, whose lane clamp saturates under a fast pure yaw rate
  // exactly like it does for continuous walk-turn (re-derived, not assumed).
  function pivot(deg) {
    markInput();
    if (s.airborne || s.speed > C.V_MOVE || s.gesture || s.pivotTarget != null) return false;
    s.pivotTarget = M.wrapAngle(s.heading + deg * Math.PI / 180);
    return true;
  }
  const applyBodyPose = () => {
    const g = gesturePose();
    body.rotation.order = 'YZX';
    body.rotation.set(C.TUNE.walkRoll + g.roll + s.spr.roll.x, s.heading + g.heading,
      C.TUNE.walkPitch + g.pitch + s.spr.pitch.x);
    rig.root.updateMatrixWorld(true);
  };
  // how far a planted foot sits from its rest spot under the body (ground plane)
  const offRest = (f) => {
    handToWorld(_b.copy(calib.feet[f]), _a);
    return Math.hypot(legs[f].foot.x - _a.x, legs[f].foot.z - _a.z);
  };
  // jump the (unwrapped, monotonic) phase forward to fraction `want` of a cycle
  const enterPhase = (want) => { s.phase = Math.floor(s.phase) + want + (s.phase % 1 > want ? 1 : 0); };
  // every digit down and on its rest spot (a pivot starts from the stance, not mid-stride)
  const settled = () => FINGERS.every(f => legs[f].mode === 'stance' && offRest(f) <= C.SETTLE_TOL);
  const dutyEff = () => 1 - Math.min(0.9,
    Math.max(1 - C.GAITS[s.gait].duty, C.SWING_MIN * s.f)); // 0.11 s swing floor (§4.5)
  // this digit's share of the cycle on the ground at the current speed and cadence
  const dutyOf = (f) => C.TUNE.digitDuty && s.gaitP[s.gait].len[f] != null
    ? digitDuty(dutyEff(), s.gaitP[s.gait].len[f], C.BAND_UTIL, s.f, s.vEff) : dutyEff();

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
  // `branch` pins the elbow branch (stance stickiness — the thumb's oblique plane makes
  // the auto-selector's two candidates near-equal, and per-frame flip-flop wobbles the
  // planted tip); swings pass null and re-select freely (§4.2).
  function solveLegWorld(f, targetW, rateCap, dt, fold = 0, branch = null, unloaded = false) {
    const d = rig.digits[f], leg = legs[f];
    const res = solveLeg(d, rig.root.worldToLocal(_a.copy(targetW)),
      { root: rig.root, branch, sepBias: leg.sepBias || 0,
        mcpMin: unloaded && d.isThumb ? C.THUMB_SWING_EXT : undefined });
    leg.branch = res.branch;
    const a = { ...res.angles };
    if (fold > 0) {
      a.pip = M.clamp(a.pip + C.FOLD[f] * fold, C.LIMITS[1][0], C.LIMITS[1][1]);
      a.dip = M.clamp(d.slave * a.pip, C.LIMITS[2][0], C.LIMITS[2][1]);
    }
    if (leg.angles && rateCap) {
      const cap = rateCap * dt;
      for (const k of ['yaw', 'mcp', 'pip', 'dip'])
        a[k] = leg.angles[k] + M.clamp(a[k] - leg.angles[k], -cap, cap);
    }
    applyCurl(d, a);
    rig.root.updateMatrixWorld(true);
    // §4.3 says "tuck skips the constraint", but the constraint no-ops unless a
    // contact is actually below the floor — the skip was redundant AND let
    // rate-limited tucks lag through the ground during jumps. Always constrain.
    groundConstrain(d, rig.root);
    leg.angles = a;
    leg.err = d.tip.getWorldPosition(_a).distanceTo(targetW);
    return leg.err;
  }
  const solveStance = (f, dt = 0) =>
    solveLegWorld(f, legs[f].foot, dt ? C.RATE_PLANTED : 0, dt, 0, legs[f].branch ?? null);

  // a digit's rest spot under the pose the body will have when it has stopped (the
  // body still travels v·(|v|/2·STOP_DECEL + ACCEL_TAU) once the command is zero)
  function restLanding(f) {
    const sp = Math.hypot(s.v.x, s.v.z);
    const k = s.cmdT.x === 0 && s.cmdT.z === 0 ? sp / (2 * C.STOP_DECEL) + C.ACCEL_TAU : 0;
    const landW = new THREE.Vector3().copy(calib.feet[f]).applyAxisAngle(UP, s.heading)
      .add(_c.set(body.position.x + s.v.x * k, 0, body.position.z + s.v.z * k));
    landW.y = groundY(landW.x, landW.z) + padHeight(rig.digits[f]);
    return landW;
  }

  // --- swing planning (§4.6): hand frame, live MCP, band at live height ---
  function startSwing(f) {
    const d = rig.digits[f], leg = legs[f], gp = s.gaitP[s.gait];
    const duty = dutyOf(f);
    const mcpW = d.mcp.getWorldPosition(_a);
    const mcpHX = worldToHand(mcpW, _b).x;
    const band = bandAt(f, body.position.y) ?? { lo: calib.workC[f] - 0.1, hi: calib.workC[f] + 0.1 };
    const sFrom = worldToHand(leg.foot, _b).x - mcpHX;
    const rescue = sFrom < band.lo - 0.05;                   // started deep behind the band
    const dur = M.clamp(Math.max((1 - duty) / Math.max(s.f, 1e-3),
      C.SWING_MIN, rescue ? C.RESCUE_DUR : 0), C.SWING_MIN, C.SWING_MAX);
    if (s.pivotTarget != null) {                             // pivot: rest foot rotated to the
      const predHeading = s.heading + s.yawRate * dur;       // PREDICTED touchdown heading —
      const landW = new THREE.Vector3().copy(calib.feet[f])  // same predictive idea as the
        .applyAxisAngle(UP, predHeading)                      // translation path (§4.6), just
        .add(_c.set(body.position.x + s.v.x * dur, 0, body.position.z + s.v.z * dur));
      landW.y = groundY(landW.x, landW.z) + padHeight(d);
      leg.swing = { from: leg.foot.clone(), to: landW, t: 0, dur, rescue, piv: true };
      leg.mode = 'swing';
      return;
    }
    // stopping or stopped: every swing lands on its REST spot, at the pose the body
    // will have once it halts — so the hand finishes in its stance, not mid-stride
    if (s.f === 0 || (s.cmdT.x === 0 && s.cmdT.z === 0)) {
      leg.swing = { from: leg.foot.clone(), to: restLanding(f), t: 0,
        dur: s.f === 0 ? C.SETTLE_DUR : dur, rescue: false };
      leg.mode = 'swing';
      return;
    }
    const T = duty / Math.max(s.f, 1e-3);                    // this leg's stance time
    const vLoc = _b.copy(s.v).applyAxisAngle(UP, -s.heading);
    // plan in the PREDICTED hand frame at landing time — the body translates v·dur and
    // rotates yawRate·dur during the swing; planning in the current frame lands feet
    // systematically stale (drained bands when walking, swept lanes when turning §4.6)
    const cen = (band.lo + band.hi) / 2;
    const lz = calib.laneZ[f] ?? calib.feet[f].z;            // yaw-centred walking lane
    // in-frame drift velocity of a world-fixed foot at (x,z): dq/dt = -v_loc - ω×q →
    // (−vx − ω·z, −vz + ω·x). Land half a sweep up-drift so the stance excursion is
    // CENTRED — one-sided excursions run the ∝|yaw| error ramp and the tip scrubs it
    // (measured: 0.05-0.07 net/stance while rotating for the centred-less legs; the
    // pattering pinky's naturally short, centred stances scrubbed only 0.005)
    const om = s.yawRate;                                     // sign verified by A/B
    const driftX = -vLoc.x - om * lz;
    const driftZ = -vLoc.z + om * (mcpHX + cen);
    const sLand = M.clamp(cen - 0.5 * driftX * T,
      band.lo + C.BAND_MARGIN, band.hi - C.BAND_MARGIN);
    const zLand = M.clamp(lz - 0.5 * driftZ * T,
      lz - d.reachW * C.LANE_CLAMP, lz + d.reachW * C.LANE_CLAMP);
    // NOTE: no 0.72·reach cap here — the ORIGINAL's proxy for live-height reachability
    // contradicts this stance (rests at 0.92·reach) and pulled land targets airborne.
    // The band clamp above IS the live-height capability (scanned at ground height
    // through the real solve stack).
    const landW = new THREE.Vector3(mcpHX + sLand, 0, zLand)
      .applyAxisAngle(UP, s.heading + s.yawRate * dur)
      .add(_c.set(body.position.x + s.v.x * dur, 0, body.position.z + s.v.z * dur));
    landW.y = groundY(landW.x, landW.z) + padHeight(d);
    leg.swing = { from: leg.foot.clone(), to: landW, t: 0, dur, rescue };
    leg.mode = 'swing';
  }

  function advanceSwing(f, dt) {
    const d = rig.digits[f], leg = legs[f], sw = leg.swing;
    sw.t = Math.min(sw.t + dt / sw.dur, 1);
    if (sw.a0) {
      // hover set-down ("landing gear"): while the body is still UP, blend JOINT ANGLES
      // from the fist to the calibrated stance pose, hold it, and let the lift track
      // lower the hand onto its fingertips. Unfurling at or near the floor walked the
      // joints through the ground and the uncapped constraint threw the tip (0.6-1.3 u a step)
      const a1 = restA[f], u = sw.t * sw.t * (3 - 2 * sw.t), a = {};
      for (const k of ['yaw', 'mcp', 'pip', 'dip']) a[k] = sw.a0[k] + (a1[k] - sw.a0[k]) * u;
      applyCurl(d, a);
      rig.root.updateMatrixWorld(true);
      groundConstrain(d, rig.root);
      leg.angles = a;
      if (sw.t >= 1 && !hovering()) {                         // touchdown: pin where the tip is
        d.tip.getWorldPosition(leg.foot);
        leg.mode = 'stance'; leg.swing = null; leg.err = 0;
        solveStance(f);
      }
      return;
    }
    // ease-OUT: the tip arrives with ~zero horizontal speed (smoothstep left the unfold
    // racing the rate cap: 0.054 u per step at touchdown → 0.006). Pivot swings use a
    // softer ease-out and hold the fold longer: extended early, a rotating swing cuts
    // across its neighbour's lane (cross -0.091 at cubic/0.6 vs +0.002 at quadratic/0.8)
    const t = sw.t, ease = 1 - (1 - t) ** (sw.piv ? 2 : 3), fEnd = sw.piv ? C.FOLD_END_PIVOT : C.FOLD_END;
    const target = _b.lerpVectors(sw.from, sw.to, ease);
    target.y += C.GAITS[s.gait].arcH * Math.sin(Math.PI * t); // the ask; annulus is the cap (§5)
    const mcpW = d.mcp.getWorldPosition(_a);
    const vm = _c.copy(target).sub(mcpW);
    if (vm.length() < calib.dMin[f])                          // fold-annulus cap (§4.6)
      target.copy(mcpW).addScaledVector(vm.normalize(), calib.dMin[f]);
    // fold is a liftoff pulse that ends by FOLD_END: the finger is extended for the
    // rest of the swing, so the unfold never races the rate cap into touchdown
    const fold = sw.rescue && t < C.RESCUE_HOLD ? 1
      : t < fEnd ? Math.sin(Math.PI * t / fEnd) : 0;
    solveLegWorld(f, target, C.RATE_SWING, dt, fold, null, true);
    if (t >= 1) {                                            // pin stance at the ACHIEVED tip
      d.tip.getWorldPosition(leg.foot);
      // a footfall twitches the body: a nod, and a lean toward the side that landed
      kick(-C.STEP_KICK, C.STEP_KICK * 1.4 * Math.sign(calib.feet[f].z));
      if (sim.onStep && !sw.replant) sim.onStep(f, leg.foot);
      leg.mode = 'stance';
      leg.swing = null;
      leg.err = 0;    // vs the pinned foot — a stale swing-target err re-triggered settles
      // snap the stance solve uncapped once: the target IS the current tip, so nothing
      // visibly moves, but the angles normalize (no fold, exact solution) — otherwise
      // the rate-limited settle sweeps the tip for a few frames and reads as slide
      solveStance(f);
    }
  }

  // aloft (moving-gait thumb): carried lifted, bears no weight (§4.7) — the pose is
  // calib.aloft[f], the mildest curl MEASURED to clear the floor (see calibrate)
  // gesture digit: sample the finger's pose tracks (base + offsets, u re-normalized
  // to the win window) — one digit, its own local anatomical cone, no gait coupling
  // base 'rest' = this digit's own stance angles: offset 0 puts the tip exactly on its
  // rest spot, so taps STRIKE the floor at any posture instead of leaning on the
  // ground constraint (which flipped the ring 0.46 u when the posture changed)
  function gestureDigitPose(f, gd, u, win) {
    const uu = (u - win[0]) / (win[1] - win[0]), b = gd.base === 'rest' ? restA[f] : gd.base;
    const pip = b.pip + sampleTrack(gd.pip, uu);
    return { yaw: b.yaw + sampleTrack(gd.yaw, uu),
      mcp: b.mcp + sampleTrack(gd.mcp, uu),
      pip, dip: M.clamp(pip * rig.digits[f].slave, C.LIMITS[2][0], C.LIMITS[2][1]) };
  }
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
    // ramp the command toward its target at CMD_ACCEL — see tuning.js
    // TURN POLICY (every input path gets it): a commanded direction more than TURN_PIVOT
    // off the heading means stop, pivot, go. Steering a walking hand through a big turn
    // sweeps planted feet out of the finger-yaw cone and they scrub; the pivot does not.
    const wantHd = s.cmdT.x !== 0 || s.cmdT.z !== 0 ? Math.atan2(-s.cmdT.z, s.cmdT.x) : null;
    if (wantHd != null && !s.airborne && !s.gesture
        && (s.pivotTarget != null || Math.abs(M.wrapAngle(wantHd - s.heading)) > C.TURN_PIVOT))
      s.pivotTarget = wantHd;                                 // (tracks the command while turning)
    const hold = s.pivotTarget != null;                       // translate only once the turn is done
    const dcx = (hold ? 0 : s.cmdT.x) - s.cmd.x, dcz = (hold ? 0 : s.cmdT.z) - s.cmd.z;
    // slowing is not leg-limited the way speeding up is (no foot is stranded behind a
    // body that stops), so a stop ramps at STOP_DECEL: hard stops, staccato
    const braking = hold || Math.hypot(s.cmdT.x, s.cmdT.z) < Math.hypot(s.cmd.x, s.cmd.z);
    const dcl = Math.hypot(dcx, dcz), dcMax = (braking ? C.STOP_DECEL : C.CMD_ACCEL) * dt;
    if (dcl > dcMax) { s.cmd.x += dcx / dcl * dcMax; s.cmd.z += dcz / dcl * dcMax; }
    else { s.cmd.x = hold ? 0 : s.cmdT.x; s.cmd.z = hold ? 0 : s.cmdT.z; }
    const cmdSpeed = Math.hypot(s.cmd.x, s.cmd.z);

    // --- steering ---
    if (s.airborne && s.hop) {                                // hop-turn: spin to the new heading in the air
      s.hop.t = Math.min(s.hop.t + dt / C.HOP_TIME, 1);
      const u = s.hop.t * s.hop.t * (3 - 2 * s.hop.t);
      s.heading = M.wrapAngle(s.hop.from + M.wrapAngle(s.hop.to - s.hop.from) * u);
      s.yawRate = 0;
    }
    if (s.airborne) s.pivotTarget = null;                    // a jump interrupts a pivot
    if (s.pivotTarget != null) {                              // pivot-in-place: decoupled from
      const err = M.wrapAngle(s.pivotTarget - s.heading);     // the cmdSpeed gate below — turns
      if (Math.abs(err) < C.PIVOT_DONE_EPS) { s.pivotTarget = null; s.yawRate = 0; s.turnWait = 0; }
      else if (s.speed > C.V_MOVE || (s.yawRate === 0 && !settled() && (s.turnWait += dt) < C.TURN_WAIT))
        s.yawRate = 0;                                        // still braking or stepping home: the turn waits
      else if (s.yawRate === 0 && Math.abs(err) > C.HOP_TURN && s.planted >= 3) {
        // a big turn is ONE small hop: stepping round 180° takes 2.4 s (the finger-yaw
        // cone caps a stepping pivot near 1.5 rad/s) and reads as dithering. No foot slides.
        s.hop = { from: s.heading, to: s.pivotTarget, t: 0 };
        s.vy = rig.G * C.HOP_TIME / 2; s.airborne = true; s.pivotTarget = null; s.turnWait = 0;
      }
      else {
        const want = M.clamp(C.PIVOT_GAIN * err, -C.PIVOT_YAW_MAX, C.PIVOT_YAW_MAX);
        s.yawRate += M.clamp(want - s.yawRate, -C.PIVOT_ACCEL * dt, C.PIVOT_ACCEL * dt);
      }
    } else if (cmdSpeed > C.V_MOVE && !s.airborne) {
      // under way, steer only as fast as planted feet can follow: ARC_SWEEP rad of
      // hand-frame arc per stance. Small corrections stay smooth; big ones pivot (above)
      const hd = Math.atan2(-s.cmd.z, s.cmd.x);
      const cap = Math.min(C.YAW_RATE_MAX, C.ARC_SWEEP * Math.max(s.f, C.F_MIN) / dutyEff());
      s.yawRate = M.clamp(C.STEER_GAIN * M.wrapAngle(hd - s.heading), -cap, cap);
    } else s.yawRate *= Math.exp(-6 * dt);
    s.heading = M.wrapAngle(s.heading + s.yawRate * dt);

    // --- gait selection by commanded speed with hysteresis (§4.7) ---
    // pivoting has zero cmdSpeed but real rotational cadence demand (|yawRate|·rFoot,
    // the same term the phase engine below already uses) — without this, gait stays
    // stuck at walk's fMax=3.0 ceiling regardless of yaw rate, so cadence SATURATES
    // while sweep-per-stance keeps growing with yaw rate past that saturation point
    // (measured: yawRate 1.6-2.2 both blow stance err to 0.38-0.57, worse at higher
    // rate, exactly as fMax-saturated sweep = yawRate·(duty/fMax) predicts).
    // a pivot paces on its own stride budget: the arc a planted foot may sweep before
    // the finger-yaw cone binds (PIVOT_SWEEP·rFoot), not the translation band
    const pivS = Math.min(s.gaitP[s.gait].S, C.PIVOT_SWEEP * calib.rFoot);
    const gaitDemand = s.pivotTarget != null
      ? Math.abs(s.yawRate) * calib.rFoot * s.gaitP[s.gait].S / pivS : cmdSpeed;
    const gi = C.GAIT_ORDER.indexOf(s.gait);
    s.gaitT += dt;
    if (s.gaitT > C.GAIT_DWELL) {
      const g0 = s.gait;
      if (gi < 2 && gaitDemand > s.gaitP[s.gait].vTop + C.GAIT_HYST) s.gait = C.GAIT_ORDER[gi + 1];
      else if (gi > 0 && gaitDemand < s.gaitP[C.GAIT_ORDER[gi - 1]].vTop) s.gait = C.GAIT_ORDER[gi - 1];
      if (s.gait !== g0) { s.gaitT = 0; if (s.f > 0 && s.pivotTarget == null) enterPhase(C.GAITS[s.gait].enter); }
    }

    // --- SI physics (§4.8) ---
    s.speed = Math.hypot(s.v.x, s.v.z);
    // gesture engine: block/cancel while airborne or moving (locomotion owns the pose then)
    if (s.carry && (s.carry.t += dt / C.GESTURE_CUT) >= 1) s.carry = null;
    if (s.gesture) {
      const wasHover = hovering();
      if (s.airborne || s.speed > C.V_MOVE) { if (wasHover) s.gesture = null; else dropGesture(); }
      else {
        const u0 = s.gesture.t / s.gesture.dur;
        s.gesture.t += dt;
        const u1 = s.gesture.t / s.gesture.dur;
        for (const [u, name] of s.gesture.def.cue ?? []) if (u0 < u && u1 >= u && sim.onCue) sim.onCue(name);
        if (s.gesture.t >= s.gesture.dur) s.gesture = null;
      }
      // hover end: digits re-plant through real swings (the gesture-exit path in the
      // leg loop). The body is HELD at stance height until they are down — a reseed
      // snapped all five from fist to planted in one step (0.95-1.33 u)
      if (wasHover && !s.gesture) { s.replant = true; s.vy = 0; }
    } else if (!s.airborne && s.f === 0 && s.speed <= C.V_MOVE
        && s.time - s.lastInput > C.IDLE_AFTER && s.time >= s.nextIdleAt) {
      // left alone: weighted-random subtle idle; any input cancels instantly
      const names = Object.keys(IDLES).filter(n => n !== s.lastIdle);   // never the same fidget twice running
      let r = rand() * names.reduce((a, n) => a + IDLES[n].w, 0);
      const name = names.find(n => (r -= IDLES[n].w) <= 0) ?? names[0];
      s.gesture = { name, t: 0, dur: IDLES[name].dur, def: IDLES[name], idle: true };
      s.lastIdle = name;
      s.nextIdleAt = s.time + IDLES[name].dur + C.IDLE_GAP * (0.7 + 0.6 * rand());
    }
    s.planted = s.airborne ? 0 : FINGERS.filter(f => legs[f].mode === 'stance').length;
    // ride height is TERRAIN-RELATIVE (identical on flat ground where gY=0): with an
    // absolute target the body steadicams over bumps at constant world height and the
    // terrain reads as inert — legs silently absorb everything (measured: body y
    // flat to 3 decimals across ±0.12 bumps). RIDE_TAU eases the transitions.
    const gY = groundY(body.position.x, body.position.z);
    const rideT = gY + Math.max(cmdSpeed > C.V_MOVE ? calib.standH * C.POSE_CROUCH : calib.standH,
      rig.palmDepth + C.BELLY_CLEAR);
    s.rideH += (rideT - s.rideH) * (1 - Math.exp(-dt / C.RIDE_TAU)); // eased — no stop-pop
    // body secondary motion: two damped springs carry twitches (kick()): a nod per
    // footfall, a wind-up on a start, one nod as a stop bites. The body still rides level
    // and the fingers do the work. Planted tips do not move: the stance solve absorbs it.
    // (A/B'd and dropped for costing grip: a ride-height bob per lifted digit, slide
    // +10-30% and stop settle 0.56 → 1.35 s; lean into acceleration, run slide +25%.)
    // (armed on the commanded speed this fired on every step of a start, about 12 in a
    // row: the hand reared 0.22 rad as it left, where one small kick was meant)
    if (stopKick && s.speed < C.V_MOVE) { stopKick = false; kick(C.STOP_KICK, 0); }
    if (s.speed > C.V_MOVE) stopKick = true;
    for (const q of [s.spr.pitch, s.spr.roll]) {
      q.v += (-C.BODY_K * q.x - C.BODY_C * q.v) * dt;         // semi-implicit Euler: stable at SIM_DT
      q.x += q.v * dt;
    }
    // gesture height rides OUTSIDE the ease: RIDE_TAU smears a snappy shrug flat;
    // the support spring is the physical smoother
    const rideH = s.rideH + gesturePose().height;
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
      // the last creep of a stop is planted fingers gripping: kill it, do not coast it out
      if (cmdSpeed === 0 && s.speed < C.V_MOVE) { const g = Math.exp(-C.STOP_GRIP * dt); s.v.x *= g; s.v.z *= g; }
    }
    body.position.x += s.v.x * dt;
    body.position.z += s.v.z * dt;
    // hover: direct Y from the lift track, no ballistic fall — the capped-force
    // stance spring can't produce a clean full liftoff (planted is already 0 while
    // hovering, so N/traction above are already no-ops; this replaces the integrator)
    if (hovering() || s.replant) { body.position.y = gY + calib.standH + gesturePose().lift; s.vy = 0; }
    else body.position.y += s.vy * dt;
    if (s.airborne && s.vy <= 0 && body.position.y <= gY + calib.standH) {
      s.airborne = false; s.vy *= C.LAND_KEEP;               // touchdown: the stance spring takes the rest (squash)
      if (s.hop) { s.heading = s.hop.to; s.hop = null; }
      else s.landed = true;                                  // a real jump came down (props listen: the bell)
      applyBodyPose(); reseedFeet();
    }
    applyBodyPose();
    if (!hovering()) {                                       // belly/knuckle scrape assumes an
      // palm/stump belly bottoms out at the floor and scrapes (§4.8) — mesh-measured depth
      let pen = groundY(body.position.x, body.position.z) + rig.palmDepth - body.position.y;
      for (const f of FINGERS) {
        const p = rig.digits[f].mcp.getWorldPosition(_a);
        pen = Math.max(pen, groundY(p.x, p.z) + 0.012 - p.y);
      }
      if (pen > 0) {
        body.position.y += pen;
        s.vy = Math.max(s.vy, 0);
        const drag = Math.exp(-8 * dt);                      // sliding friction
        s.v.x *= drag; s.v.z *= drag;
        applyBodyPose();
      }
    }

    // --- phase engine (§4.5): cadence solved for zero foot-slip. Rotation IS slip
    // demand: a foot at radius r sweeps |yawRate|·r of hand-frame arc, so it enters
    // the law as extra velocity (an additive Hz bolt-on stopped scaling when the
    // polished solver widened the bands) ---
    const gd = C.GAITS[s.gait], gp = s.gaitP[s.gait];
    if (!s.airborne && (cmdSpeed > C.V_MOVE || s.speed > C.V_MOVE || Math.abs(s.yawRate) > 0.05)) {
      const v = Math.max(s.speed + Math.abs(s.yawRate) * calib.rFoot, C.V_MOVE);
      const crossF = (1 - gd.duty) / C.SWING_MIN;
      const S = s.pivotTarget != null ? pivS : gp.S;
      let f = v * gd.duty / S;
      if (f > crossF) f = v / (S + C.SWING_MIN * v);
      // cadence floor: a slow walk takes shorter steps at a natural beat instead of
      // holding a swing in the air for seconds (and a start steps at once)
      const starting = s.f === 0;
      if (starting && s.pivotTarget == null) kick(C.GO_KICK, 0);    // wind up: rear back as the first step lifts
      s.f = Math.min(Math.max(f, C.F_MIN), gd.fMax);
      s.vEff = v;
      // decisive, repeatable start: enter the cycle at the gait's own entry phase, so
      // the first step begins at once (it waited up to a cycle: 0.24 s of nothing) and
      // the start-up footfalls are the ones the pattern was checked with
      if (starting && s.pivotTarget == null) enterPhase(gd.enter);   // (entry phases are tuned for travel, not pivots)
      s.phase += s.f * dt;                                   // UNWRAPPED: floor() is the cycle id
    } else s.f = 0;

    // §4.9 separation controller: DISABLED after A/B refutation. Two gate variants
    // (splay < SEP_ANG, and scissor-only splay < 0.05, both closing-gated) each made
    // things WORSE: yaw-shoving planted feet costs more slide than the crossing it
    // prevents (steadyW 0.49→4.5 / 0.84; turnCycle 2.3→9.0 / 4.5; cross barely moved).
    // The sepBias solver channel and per-digit yawZSign (measured in calibrate) stay
    // for a swing-landing-only separation approach.
    for (const f of FINGERS) legs[f].sepBias = 0;
    const sp = s.gesture && s.gesture.def.splay;               // gesture splay: reuses the
    if (sp) {                                                  // §4.9 sepBias channel
      const v = sampleTrack(sp.track, s.gesture.t / s.gesture.dur);
      for (const f of sp.fingers)
        legs[f].sepBias = v * (rig.digits[f].yawZSign ?? 1);
    }

    // --- legs ---
    const de = dutyEff();
    // support guard: a swing waits (phase slot stays open) while lifting would leave
    // fewer than MIN_PLANTED digits down — gait changes and pivot starts re-deal the
    // swing windows and used to lift all five at once (body dropped 0.3u and bounced)
    let down = FINGERS.filter(f => legs[f].mode === 'stance').length;
    // a pivot borrows run cadence, not its aerial phase; and a gait change re-deals
    // the swing windows (trot→run lifted all four at once and dropped the wrist 0.6 u)
    const minDown = s.f === 0 ? 3                            // settling at rest: two feet at a time, no more
      : s.pivotTarget != null || s.gaitT < C.GAIT_SETTLE ? 2 : C.MIN_PLANTED[s.gait];
    const mayLift = () => down - 1 >= minDown;
    for (const f of FINGERS) {
      const leg = legs[f];
      if (s.airborne) { leg.mode = 'tuck'; tuckLeg(f, dt); continue; }
      const gdig = s.gesture && s.gesture.def.digits && s.gesture.def.digits[f];
      if (gdig) {                                              // gesture digit: lifted, bears no weight
        const u = s.gesture.t / s.gesture.dur, win = gdig.win ?? [0, 1];
        if (u >= win[0] && u < win[1]) {
          leg.mode = 'gesture'; poseLeg(f, gestureDigitPose(f, gdig, u, win), C.RATE_CARRY, dt); continue;
        }
      }
      if (gd.aloft.includes(f) && s.speed > C.V_MOVE) {      // aloft only while moving (§4.7)
        leg.mode = 'aloft'; poseLeg(f, calib.aloft[f], C.RATE_CARRY, dt); continue;
      }
      if (leg.mode === 'aloft' || leg.mode === 'tuck' || leg.mode === 'gesture') { // re-plant via a REAL swing —
        // teleporting the foot dragged the tip across at the rate cap (jank)
        leg.swing = { from: rig.digits[f].tip.getWorldPosition(new THREE.Vector3()),
          to: restLanding(f), t: 0, dur: C.REPLANT_DUR, rescue: false, replant: true };
        if (hovering()) {                                     // digits' window closed mid-hover: gear down
          leg.swing.a0 = { ...leg.angles };
          leg.swing.dur = C.HOVER_UNFURL * s.gesture.dur;
        }
        leg.mode = 'swing'; leg.cycleId = -1;
      }
      const cyc = s.phase + gd.offsets[f];
      const p = cyc % 1, id = Math.floor(cyc);
      if (leg.mode === 'stance' && s.f > 0 && p >= dutyOf(f) && leg.cycleId !== id) {
        // a digit towed out of reach is not support: the gait-settle floor does not hold
        // it down. (Held, the middle finger trailed 0.25 u behind its band on the first
        // strides of a trot, and the ground constraint threw its tip 0.32 u in one step)
        if (mayLift() || (leg.err > 4 * C.BAND_TIP_ERR && s.pivotTarget == null && down - 1 >= C.MIN_PLANTED[s.gait])) {
          leg.cycleId = id; startSwing(f); down--;
        }
      } else if (leg.mode === 'stance' && s.f > 0 && leg.cycleId !== id) {
        // band-exit rescue (§4.6): a foot dragged past the band bottom, swept out of
        // its lane by rotation, or unreachable can't wait for its phase slot
        const d2 = rig.digits[f];
        const mcpHX = worldToHand(d2.mcp.getWorldPosition(_a), _b).x;
        const fh = worldToHand(leg.foot, _b);
        const sFoot = fh.x - mcpHX;
        const zOff = Math.abs(fh.z - (calib.laneZ[f] ?? calib.feet[f].z));
        const band = bandAt(f, body.position.y);
        // NOTE: tighter thresholds (1.2×, 2×tol) A/B'd WORSE — earlier rescues churn
        // more slide than the yaw-clamp boundary layer they trim
        if ((band && sFoot < band.lo - 0.02)
          || zOff > 2 * d2.reachW * C.LANE_CLAMP
          || leg.err > 4 * C.BAND_TIP_ERR) {
          if (mayLift()) { leg.cycleId = id; startSwing(f); down--; }
        }
      } else if (leg.mode === 'stance' && s.f === 0 && mayLift()
          && (leg.err > 2 * C.BAND_TIP_ERR || offRest(f) > C.SETTLE_TOL)) {
        startSwing(f); down--;                               // settle: step a stray foot home
      }
      if (leg.mode === 'swing') advanceSwing(f, dt);
      else solveStance(f, dt);
    }
    if (s.replant && FINGERS.every(f => legs[f].mode === 'stance')) s.replant = false;
  }

  function reset(px = 0, pz = 0, heading = 0) {
    s.v.set(0, 0, 0); s.cmd.set(0, 0, 0); s.cmdT.set(0, 0, 0);
    s.vy = 0; s.heading = heading; s.yawRate = 0;
    s.gait = 'walk'; s.gaitT = 0; s.phase = 0; s.f = 0; s.speed = 0; s.planted = 5;
    s.airborne = false; s.replant = false; s.rideH = calib.standH; s.gesture = null; s.carry = null; s.pivotTarget = null; s.turnWait = 0; s.hop = null;
    s.lastInput = s.time; s.nextIdleAt = s.time; s.rng = DEV ? 1 : Date.now() % 0x7fffffff || 1; s.lastIdle = null;
    s.spr.pitch.x = s.spr.pitch.v = s.spr.roll.x = s.spr.roll.v = 0; stopKick = false;
    body.position.set(px, calib.standH, pz);
    applyBodyPose();
    for (const f of FINGERS) {
      rig.digits[f].yaw = 0;
      legs[f] = { mode: 'stance', foot: new THREE.Vector3(), swing: null, angles: null, err: 0, cycleId: -1 };
    }
    reseedFeet();                                            // reseed DIGITS, not just body (§7)
    for (const f of FINGERS) restA[f] = { ...legs[f].angles };   // stance angles in the LIVE standing pose
  }

  function autoWalk(x, z) {                                  // velocity command, u/s
    markInput();
    const l = Math.hypot(x, z);
    const k = l > C.V_MAX ? C.V_MAX / l : 1;                 // leash tops out at V_MAX
    s.cmdT.set(x * k, 0, z * k);                             // ramped toward in step()
  }

  function jump() {
    markInput();
    if (s.airborne || s.planted === 0) return;
    // energy-based (§4.8): burst force × push-off stroke × planted − weight × stroke
    const E = (C.F_DIGIT_BURST * s.planted - C.MASS * C.G_SI) * (C.JUMP_STROKE * rig.WORLD_M);
    if (E <= 0) return;
    s.vy = Math.sqrt(2 * E / C.MASS) / rig.WORLD_M;
    s.airborne = true;
  }

  const sim = { s, legs, step, reset, autoWalk, jump, bandAt, gesture, pivot, onCue: null, onStep: null };
  return sim;
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
  const bellyFloor = rig.palmDepth + C.BELLY_CLEAR;          // lowest body height with the
                                                             // palm/stump off the ground
  // POSTURE: the palm pitch is a chosen constant and EVERY scan below runs at it —
  // lanes, rests, stand height and bands all describe the pose the hand really stands
  // in. (Before: rests and stand height were derived level, then walked at a pitch
  // picked by a band scan that stopped at -0.3.) Negative pitch = nose-down, stump up.
  const PITCH = C.TUNE.walkPitch = DEV && new URLSearchParams(location.search).has('pitch')
    ? +new URLSearchParams(location.search).get('pitch') : C.POSTURE_PITCH;
  const setPose = (h, walk) => {
    body.position.set(0, h, 0);
    body.rotation.order = 'YZX';
    body.rotation.set(walk ? C.TUNE.walkRoll : 0, 0, PITCH);
    rig.root.updateMatrixWorld(true);
  };
  // probe height for the lane and extension scans: the wrist height that puts the
  // middle knuckle 0.47 u up (where it sat for the old level probe at 0.5)
  setPose(1, false);
  const hProbe = Math.max(1 + 0.47 - rig.digits.middle.mcp.getWorldPosition(tmp).y, bellyFloor + 0.02);

  const solveTo = (d, target) => {
    solveLeg(d, rig.root.worldToLocal(target.clone()), { root: rig.root });
    groundConstrain(d, rig.root);
    return d.tip.getWorldPosition(tmp).distanceTo(target);   // world-unit tip err
  };

  // lane direction per digit: MCP toward bind tip in the ground plane, then refined to
  // the nearest angle the REAL solver can hold on the ground at a probe height — the
  // thumb's oblique CMC plane can't descend along its raw bind lane (yaw pegs at ±0.65
  // and still misses). Nearest-to-bind keeps it as wide as reachable ("thumb wide").
  const laneDir = {};
  setPose(0, false);
  for (const f of FINGERS) {
    const d = rig.digits[f];
    const tipW = rig.root.localToWorld(d.pos.tip.clone());
    const mcpW = rig.root.localToWorld(d.pos.mcp.clone());
    laneDir[f] = new THREE.Vector3(tipW.x - mcpW.x, 0, tipW.z - mcpW.z).normalize();
  }
  setPose(hProbe, false);
  for (const f of FINGERS) {
    const d = rig.digits[f];
    const mcpW = d.mcp.getWorldPosition(tmp).clone();
    const drop = mcpW.y - padHeight(d);
    const ext = C.REST_EXT * d.reachW;
    if (ext <= Math.abs(drop)) continue;
    const fwd = Math.max(Math.sqrt(ext * ext - drop * drop), C.REST_MIN_FWD * d.reachW);
    let best = null;
    for (let a = -1.0; a <= 1.0 + 1e-9; a += 0.05) {
      const dir = laneDir[f].clone().applyAxisAngle(UP, a);
      const foot = new THREE.Vector3(mcpW.x + dir.x * fwd, padHeight(d), mcpW.z + dir.z * fwd);
      d.yaw = 0;
      if (solveTo(d, foot) < C.BAND_TIP_ERR && (best === null || Math.abs(a) < Math.abs(best)))
        best = a;
    }
    if (best !== null) laneDir[f].applyAxisAngle(UP, best);
  }
  // per-digit usable extension: a pronated/bent bind can't straighten to a fixed
  // fraction of reach (slave coupling) — measure the largest extension the real
  // solver holds along each refined lane (the thumb holds ~0.88, fingers ~0.92)
  const restExt = {};
  setPose(hProbe, false);
  for (const f of FINGERS) {
    const d = rig.digits[f];
    const mcpW = d.mcp.getWorldPosition(tmp).clone();
    restExt[f] = 0.6;
    for (let e = C.REST_EXT; e >= 0.6; e -= 0.02) {
      const ext = e * d.reachW, drop = mcpW.y - padHeight(d);
      if (ext <= Math.abs(drop)) continue;
      const fwd = Math.max(Math.sqrt(ext * ext - drop * drop), C.REST_MIN_FWD * d.reachW);
      const foot = new THREE.Vector3(mcpW.x + laneDir[f].x * fwd, padHeight(d),
        mcpW.z + laneDir[f].z * fwd);
      d.yaw = 0;
      if (solveTo(d, foot) < 0.8 * C.BAND_TIP_ERR) { restExt[f] = e; break; }
    }
  }

  // stance rests at height h (§5): descending diagonals — on the ground at the digit's
  // usable extension, ≥REST_MIN_FWD·reach forward of the live MCP. Null if a digit's
  // MCP rides too high to descend that steeply (pins the stance from above).
  const restsAt = (h) => {
    setPose(h, false);
    const out = {};
    for (const f of FINGERS) {
      const d = rig.digits[f];
      const mcpW = d.mcp.getWorldPosition(tmp);
      const drop = mcpW.y - padHeight(d);
      const ext = restExt[f] * d.reachW;
      if (ext * ext <= drop * drop) return null;             // can't descend that steeply
      const fwd = Math.max(Math.sqrt(ext * ext - drop * drop), C.REST_MIN_FWD * d.reachW);
      out[f] = new THREE.Vector3(mcpW.x + laneDir[f].x * fwd, padHeight(d),
        mcpW.z + laneDir[f].z * fwd);
    }
    return out;
  };
  let feet = null;
  const plantDigit = (f) => solveTo(rig.digits[f], feet[f]);

  // --- standH: HIGHEST wrist height where every digit (incl. thumb) plants (§5:
  // wrist high; the pinky pins it) ---
  let standH = 0;
  const perDigitH = {};
  for (let h = 2.20; h >= 0.20; h -= 0.002) {
    if (h < bellyFloor) break;                               // belly would rest on the floor
    const fts = restsAt(h);
    if (!fts) continue;
    feet = fts;
    let allOk = true;
    for (const f of FINGERS) {
      if (plantDigit(f) > C.BAND_TIP_ERR) { allOk = false; break; }
      if (perDigitH[f] == null) perDigitH[f] = h;
    }
    if (allOk) { standH = h; break; }
  }
  feet = restsAt(standH) ?? feet;

  // --- stance bands: scan each leg's foot along its lane (MCP-relative forward
  // offset s, constant lateral z) at the walking pose; keep the contiguous window
  // (holding the rest offset) where tip err < BAND_TIP_ERR ---
  const scanBand = (f, h, step = C.BAND_S_STEP, laneZOverride = null) => {
    if (h < bellyFloor) return null;
    setPose(h, true);
    const d = rig.digits[f];
    const mcpW = d.mcp.getWorldPosition(tmp);
    if (mcpW.y < padHeight(d)) return null;
    const mcpX = mcpW.x;
    const sRest = feet[f].x - mcpX;                          // the stance the leg actually uses
    const target = new THREE.Vector3(0, padHeight(d), laneZOverride ?? feet[f].z);
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
  const walkH = Math.max(standH * C.POSE_CROUCH + C.POSE_SAG, bellyFloor);

  const bands = {}, workC = {}, dMin = {};
  for (const f of FINGERS) {
    bands[f] = scanBand(f, walkH);
    workC[f] = bands[f] ? (bands[f].lo + bands[f].hi) / 2 : null;
    dMin[f] = foldAnnulus(rig.digits[f]);
  }

  // walking lane z per digit: the z that zeroes the ab/adduction yaw at the band
  // centre. Stance tip error grows ∝|yaw| (irreducible hinge-axis elevation), and a
  // rest-z lane runs the yaw one-sided across the sweep — the tip scrubs the error
  // gradient. A yaw-centred lane makes the residual symmetric, so NET scrub cancels.
  const laneZ = {};
  for (const f of FINGERS) {
    const d = rig.digits[f];
    laneZ[f] = feet[f].z;
    if (!workC[f]) continue;
    setPose(walkH, true);
    const mcpW = d.mcp.getWorldPosition(tmp).clone();
    let best = Infinity;
    for (let z = feet[f].z - 0.15; z <= feet[f].z + 0.15 + 1e-9; z += 0.01) {
      d.yaw = 0;
      solveTo(d, new THREE.Vector3(mcpW.x + workC[f], padHeight(d), z));
      if (Math.abs(d.yaw) < best) { best = Math.abs(d.yaw); laneZ[f] = z; }
    }
    // re-scan the band on the final lane (it shifts slightly off the rest z)
    bands[f] = scanBand(f, walkH, C.BAND_S_STEP, laneZ[f]) ?? bands[f];
    workC[f] = bands[f] ? (bands[f].lo + bands[f].hi) / 2 : workC[f];
  }
  const strideMax = Math.min(...FINGERS.map(f => bands[f] ? bands[f].hi - bands[f].lo : 0));

  // --- per-height band table (§4.4): each landing queries the band at the height the
  // foot will actually land at. TUNE.liveBands=1 uses it; 0 is the A/B control. ---
  const bandTable = [];
  for (let i = 0; i < C.BAND_HEIGHT_SAMPLES; i++) {
    const h = walkH - C.BAND_HEIGHT_RANGE
      + (2 * C.BAND_HEIGHT_RANGE * i) / (C.BAND_HEIGHT_SAMPLES - 1);
    const row = { h };
    for (const f of FINGERS) row[f] = scanBand(f, h, C.BAND_S_STEP, laneZ[f]);
    bandTable.push(row);
  }

  // per-digit sign of yaw-bias → lateral tip motion (measured, not assumed — it
  // depends on abdW orientation and curl sign). The §4.9 separation controller
  // multiplies its push by this to move a tip toward +z or -z on demand.
  setPose(walkH, true);
  for (const f of FINGERS) {
    const d = rig.digits[f];
    if (!workC[f]) { d.yawZSign = 1; continue; }
    const mcpW = d.mcp.getWorldPosition(tmp).clone();
    const target = new THREE.Vector3(mcpW.x + workC[f], padHeight(d), laneZ[f]);
    d.yaw = 0;
    solveLeg(d, rig.root.worldToLocal(target.clone()), { root: rig.root });
    const z0 = d.tip.getWorldPosition(tmp).z;
    d.yaw = 0;
    solveLeg(d, rig.root.worldToLocal(target.clone()), { root: rig.root, sepBias: 0.15 });
    d.yawZSign = Math.sign(d.tip.getWorldPosition(tmp).z - z0) || 1;
  }

  // aloft pose per carried digit: the mildest lift+curl whose tip clears the floor by
  // ALOFT_CLEAR at the walk pose AFTER the ground constraint. A fixed mild curl
  // (mcp -0.15, pip 0.9) measured 0.000 clearance — the pad skimmed the floor all run.
  const aloft = {};
  setPose(walkH, true);
  for (const f of new Set(C.GAIT_ORDER.flatMap(g => C.GAITS[g].aloft))) {
    const d = rig.digits[f], lo = d.isThumb ? C.THUMB_SWING_EXT : C.LIMITS[0][0];
    let best = 0;
    scan: for (let mcp = -0.15; mcp >= lo - 1e-9; mcp -= 0.05)
      for (let pip = 0.9; pip <= 1.6 + 1e-9; pip += 0.1) {
        const a = { yaw: 0, mcp, pip, dip: M.clamp(pip * d.slave, C.LIMITS[2][0], C.LIMITS[2][1]) };
        applyCurl(d, a);
        rig.root.updateMatrixWorld(true);
        groundConstrain(d, rig.root);
        const clear = d.tip.getWorldPosition(tmp).y - padHeight(d);
        best = Math.max(best, clear);
        if (clear >= C.ALOFT_CLEAR) { aloft[f] = a; break scan; }
      }
    if (!aloft[f]) throw new Error(`calibrate: no aloft pose for ${f} clears ${C.ALOFT_CLEAR}u ` +
      `(best ${best.toFixed(3)}) — widen the mcp/pip scan or lower ALOFT_CLEAR in tuning.js`);
  }

  // settle: park at standH with every digit planted at its rest
  setPose(standH, false);
  const plantErr = {};
  for (const f of FINGERS) { rig.digits[f].yaw = 0; plantErr[f] = plantDigit(f); }
  // mean foot radius — the rotational term of the zero-slip cadence law (§4.5)
  const rFoot = FINGERS.reduce((sum, f) => sum + Math.hypot(feet[f].x, feet[f].z), 0) / FINGERS.length;
  return { standH, walkH, perDigitH, plantErr, feet, laneZ, rFoot, bands, workC, dMin, strideMax, bandTable, aloft,
    // dev/debug handles (mutate the pose — probe use only)
    laneDir, restExt, restsAt, scanBand, solveTo, setPose, bellyFloor };
}

// HUD goes through innerHTML and shows typed + LLM text: escape every dynamic field
const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
function devHUD(fps, rig, sim, calib, brain) {
  const s = sim.s;
  const lines = [
    `<b>Hand Walker</b>  fps ${fps.toFixed(0)}  ${state.paused ? '<b>PAUSED</b>' : ''}`,
    `WORLD_M ${(rig.WORLD_M * 100).toFixed(2)}cm/u  G ${rig.G.toFixed(1)} u/s²  standH ${calib.standH.toFixed(3)}`,
    `gait <b>${s.gait}</b>  f ${s.f.toFixed(2)}Hz  v ${s.speed.toFixed(2)}  cmd ${Math.hypot(s.cmd.x, s.cmd.z).toFixed(2)}  planted ${s.planted}${s.airborne ? '  <b>AIR</b>' : ''}`,
    ...FINGERS.map(f => {
      const l = sim.legs[f];
      return `${f.padEnd(6)} ${l.mode.padEnd(6)} err ${l.err.toFixed(3)}`;
    }),
    s.gesture ? `<b>${s.gesture.idle ? 'idle' : 'gesture'}</b> ${esc(s.gesture.name)} t ${s.gesture.t.toFixed(2)}/${s.gesture.dur}` : '',
    brain.st.status !== 'idle' ? `<b>brain</b> ${esc(brain.st.status)} ${esc(brain.st.detail)}` : '',
    DEV ? `R reset · \` debug · P pause` : '',
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
