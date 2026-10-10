// qa.js — dev-only QA harness (§6). STRIPPED from the artifact build. Drives the sim
// through window.__hand via scripted scenarios on the real rAF loop, recording:
//   slide     accumulated planted-tip xz drift (u)          < 0.5
//   cross     worst neighbour lane-order margin (hand z)    > -0.05
//   floor     min contact-joint height above ground (u)     >= -0.01
//   tipErrP95 95th pct planted solve error (u)              < 0.08
//   swingDur  observed swing durations (s)                  in [0.11, 0.20]
//   towed     any leg dragged planted at err>0.15 for >0.5s none
//   clear     worst swing peak / carried-digit clearance (u)   >= 0.10
//   touchdown tip travel in the landing sim step (u)           <= 0.035
// KNOWN_RED scenarios are allowed to fail (named, with the reason); every other one
// must pass. The gate runs on a virtual clock, so results are bit-reproducible.

const F = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const NEIGHBOR_PAIRS = [['thumb', 'index'], ['index', 'middle'], ['middle', 'ring'], ['ring', 'pinky']];
const CRIT = { slide: 0.5, cross: -0.05, floor: -0.01, tipErrP95: 0.08, swingLo: 0.11, swingHi: 0.20,
  clear: 0.10,     // every swing peak and every carried digit clears the floor by this
  plantedMin: 2, bodyBob: 0.06,     // pivot180 only: support never drops, the wrist does not hop
  tipStep: 0.12, returnErr: 0.02,   // gestures only: no digit snaps, every tip comes back to rest
  touchdown: 0.035 };               // tip travel in the landing sim step: placed, not scuffed (was 0.054-0.070)
// a pivot re-steps every digit ~10 times: its slide bar is its own (0.034 per stance)
const SLIDE = { pivot180: 2.0 };
// pivot steps keep the symmetric swing profile (lane order), so they land faster
const TOUCH = { pivot180: 0.05 };

// under the gate's virtual clock (scripts/qa-gate.mjs) waiting PUMPS frames, so a
// scenario integrates an exact frame time and is bit-reproducible at any machine load
const sleep = async (ms) => {
  if (!window.__vframe) return new Promise(r => setTimeout(r, ms));
  const hz = window.__vhz || 120, n = Math.round(ms * hz / 1000);
  for (let i = 0; i < n; i++) window.__vframe(1000 / hz);
};

function makeRecorder(H) {
  const { sim, rig } = H;
  const V = H.THREE.Vector3;
  const restZ = Object.fromEntries(F.map(f => [f, H.calib.feet[f].z]));
  const r = {
    slide: 0, floor: Infinity, cross: Infinity, errs: [], swings: [], lifts: [],
    towed: false, steps: 0, frames: 0,
  };
  const stanceStart = {}, swingStart = {}, swingPeak = {}, towedT = {};
  let last = sim.s.time, raf = 0, on = true;
  const tmp = new V();
  // look metrics: what the eye reads, beyond solve error
  const L = {
    yMin: Infinity, yMax: -Infinity, plantedMin: Infinity, dist: 0,
    px: rig.mount.position.x, pz: rig.mount.position.z, cmdOn: false, tStop: null, tMove: null,
    touchdown: 0, aloftClear: Infinity, t0: sim.s.time, tipStep: 0,
    d: Object.fromEntries(F.map(f => [f, { mode: null, prev: null, from: null, peak: 0, clear: Infinity, steps: 0, len: 0, aloftT: 0 }])),
  };
  const tick = () => {
    if (!on) return;
    raf = requestAnimationFrame(tick);
    const dt = sim.s.time - last;
    if (dt <= 0) return;                                     // paused or same frame
    last = sim.s.time;
    r.frames++;
    const heading = sim.s.heading, body = rig.mount.position;
    for (const f of F) {
      const leg = sim.legs[f], d = rig.digits[f];
      const tip = d.tip.getWorldPosition(tmp);
      // floor: contact joints vs ground (flat: groundY = 0)
      for (const j of [d.pip, d.dip, d.tip]) {
        const y = j.getWorldPosition(new V()).y;
        if (y < r.floor) r.floor = y;
      }
      // cross: hand-frame z order vs rest order (positive = keeps its lane side)
      const zHand = new V().copy(tip).sub(body).applyAxisAngle(new V(0, 1, 0), -heading).z;
      leg._zHand = zHand;
      if (leg.mode === 'stance') {
        r.errs.push(leg.err);
        // slide = NET tip drift per stance period (per-frame |Δ| just integrates jitter)
        if (!stanceStart[f]) stanceStart[f] = tip.clone();
        else { leg._slide = Math.hypot(tip.x - stanceStart[f].x, tip.z - stanceStart[f].z); }
        towedT[f] = leg.err > 0.15 ? (towedT[f] ?? 0) + dt : 0;
        if (towedT[f] > 0.5) r.towed = true;
      } else {
        if (stanceStart[f]) { r.slide += leg._slide ?? 0; leg._slide = 0; stanceStart[f] = null; }
        towedT[f] = 0;
        if (leg.mode === 'swing') {
          if (swingStart[f] == null) { swingStart[f] = sim.s.time; swingPeak[f] = -Infinity; r.steps++; }
          if (tip.y > swingPeak[f]) swingPeak[f] = tip.y;
        }
      }
      if (leg.mode !== 'swing' && swingStart[f] != null) {
        if (leg.mode === 'stance') {                         // landed; aloft/tuck interruptions
          r.swings.push(sim.s.time - swingStart[f]);         // are not swings
          r.lifts.push(swingPeak[f]);
        }
        swingStart[f] = null;
      }
    }
    const hover = sim.s.gesture && sim.s.gesture.def.hover;
    if (!sim.s.airborne && !hover) {
      const hgt = body.y - H.groundY(body.x, body.z);
      if (hgt < L.yMin) L.yMin = hgt;
      if (hgt > L.yMax) L.yMax = hgt;
      if (sim.s.planted < L.plantedMin) L.plantedMin = sim.s.planted;
    }
    L.dist += Math.hypot(body.x - L.px, body.z - L.pz); L.px = body.x; L.pz = body.z;
    const cmdOn = Math.hypot(sim.s.cmdT.x, sim.s.cmdT.z) > 1e-6 || sim.s.pivotTarget != null;
    if (L.cmdOn && !cmdOn) L.tStop = sim.s.time;
    L.cmdOn = cmdOn;
    const nSteps = Math.max(1, Math.round(dt / H.C.SIM_DT));
    for (const f of F) {
      const leg = sim.legs[f], d = rig.digits[f], q = L.d[f];
      const tip = d.tip.getWorldPosition(tmp);
      const clear = tip.y - d.flesh - H.groundY(tip.x, tip.z);
      const moved = q.prev ? Math.hypot(tip.x - q.prev.x, tip.z - q.prev.z) : 0;
      const step3 = q.prev ? Math.hypot(moved, tip.y - q.prev.y) / nSteps : 0;
      if (step3 > L.tipStep) L.tipStep = step3;
      if (moved > 1e-4) L.tMove = sim.s.time;
      if (leg.mode === 'swing') {
        if (q.mode !== 'swing') { q.from = { x: tip.x, z: tip.z }; q.peak = -Infinity; }
        if (clear > q.peak) q.peak = clear;
      } else if (q.mode === 'swing' && leg.mode === 'stance') {
        q.steps++; q.len += Math.hypot(tip.x - q.from.x, tip.z - q.from.z);
        if (q.peak < q.clear) q.clear = q.peak;
        if (moved / nSteps > L.touchdown) L.touchdown = moved / nSteps;   // u per sim step at landing
      }
      if (leg.mode === 'aloft') {
        q.aloftT += dt;
        if (q.aloftT > 0.4 && clear < L.aloftClear) L.aloftClear = clear;
      } else q.aloftT = 0;
      q.mode = leg.mode; q.prev = { x: tip.x, y: tip.y, z: tip.z };
    }
    for (const [a, b] of NEIGHBOR_PAIRS) {
      // carried legs (aloft/tuck) aren't stepping feet — lane order applies to
      // planted and swinging legs only (§4.6/§4.7)
      const stepping = (m) => m === 'stance' || m === 'swing';
      if (!stepping(sim.legs[a].mode) || !stepping(sim.legs[b].mode)) continue;
      const sign = Math.sign(restZ[b] - restZ[a]);
      const margin = (sim.legs[b]._zHand - sim.legs[a]._zHand) * sign;
      if (margin < r.cross) r.cross = margin;
    }
  };
  tick();
  return {
    stop(name) {
      on = false; cancelAnimationFrame(raf);
      for (const f of F) if (stanceStart[f]) r.slide += sim.legs[f]._slide ?? 0; // open periods
      const errs = r.errs.sort((x, y) => x - y);
      const p95 = errs.length ? errs[Math.floor(errs.length * 0.95)] : 0;
      const m = {
        slide: +r.slide.toFixed(3),
        cross: +(r.cross === Infinity ? 1 : r.cross).toFixed(3),
        floor: +(r.floor === Infinity ? 1 : r.floor).toFixed(3),
        tipErrP95: +p95.toFixed(3),
        swingMin: r.swings.length ? +Math.min(...r.swings).toFixed(3) : null,
        swingMax: r.swings.length ? +Math.max(...r.swings).toFixed(3) : null,
        towed: r.towed,
        steps: r.steps,
        lift: r.lifts.length ? +(r.lifts.reduce((a, b) => a + b, 0) / r.lifts.length).toFixed(3) : null,
        // look metrics (clear = worst swing peak clearance per digit; touchdown = tip
        // travel in the landing sim step; stopSettle = s from zero command to stillness)
        clear: Object.fromEntries(F.map(f => [f, L.d[f].steps ? +L.d[f].clear.toFixed(3) : null])),
        aloftClear: L.aloftClear === Infinity ? null : +L.aloftClear.toFixed(3),
        plantedMin: L.plantedMin === Infinity ? null : L.plantedMin,
        stepLen: Object.fromEntries(F.map(f => [f, L.d[f].steps ? +(L.d[f].len / L.d[f].steps).toFixed(3) : null])),
        footfallsPerU: L.dist > 0.5 ? +(r.steps / L.dist).toFixed(2) : null,
        slidePerU: L.dist > 0.5 ? +(r.slide / L.dist).toFixed(3) : null,
        touchdown: +L.touchdown.toFixed(4),
        tipStep: +L.tipStep.toFixed(3),                     // largest 3D tip move in one sim step
        bodyBob: +(L.yMax - L.yMin).toFixed(3),
        stopSettle: L.tStop != null && L.tMove != null ? +Math.max(L.tMove - L.tStop, 0).toFixed(3) : null,
        dist: +L.dist.toFixed(2),
        cmdEnd: L.tStop != null ? +(L.tStop - L.t0).toFixed(2) : null,   // sim s until the last command ended
      };
      const fails = [];
      const G = name === 'gestures';                         // digits are posed, not stepping: gait bars do not apply
      if (!G && m.slide >= (SLIDE[name] ?? CRIT.slide)) fails.push(`slide ${m.slide}`);
      if (name === 'gestures' && m.tipStep > CRIT.tipStep) fails.push(`tip snap ${m.tipStep}`);
      if (m.touchdown > (TOUCH[name] ?? CRIT.touchdown)) fails.push(`touchdown ${m.touchdown}`);
      if (name === 'pivot180') {
        if (m.plantedMin < CRIT.plantedMin) fails.push(`planted ${m.plantedMin}`);
        if (m.bodyBob > CRIT.bodyBob) fails.push(`bob ${m.bodyBob}`);
      }
      if (!G && m.cross <= CRIT.cross) fails.push(`cross ${m.cross}`);
      if (m.floor < CRIT.floor) fails.push(`floor ${m.floor}`);
      if (m.tipErrP95 >= CRIT.tipErrP95) fails.push(`tipErrP95 ${m.tipErrP95}`);
      if (!G && m.swingMin != null && (m.swingMin < CRIT.swingLo - 0.01 || m.swingMax > CRIT.swingHi + 0.01))
        fails.push(`swingDur ${m.swingMin}-${m.swingMax}`);   // ±0.01: frame sampling quantum
      if (m.towed) fails.push('towed digit');
      const low = F.filter(f => m.clear[f] != null && m.clear[f] < CRIT.clear);
      if (low.length) fails.push(`clearance ${low.map(f => `${f} ${m.clear[f]}`).join(' ')}`);
      if (m.aloftClear != null && m.aloftClear < CRIT.clear) fails.push(`aloft clearance ${m.aloftClear}`);
      return { metrics: m, fails, pass: fails.length === 0 };
    },
  };
}

// scenario scripts: each drives H for its duration; recorder wraps the whole run.
// A/B hygiene (§7): every scenario starts from reset() + settle.
const SCENARIOS = {
  async steadyW(H) { H.autoWalk(0.8, 0); await sleep(8000); H.autoWalk(0, 0); },
  async turnCycle(H) {
    for (const [x, z] of [[0.7, 0], [0, 0.7], [-0.7, 0], [0, -0.7]]) {
      H.autoWalk(x, z); await sleep(2200);
    }
    H.autoWalk(0, 0);
  },
  async spam(H) {                                            // deterministic seeded chaos
    let seed = 42;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 36; i++) {
      H.autoWalk((rnd() * 2 - 1) * 2.2, (rnd() * 2 - 1) * 2.2);
      if (rnd() < 0.12) H.jump();
      await sleep(160);
    }
    H.autoWalk(0, 0);
  },
  async rest(H) { await sleep(4000); },
  async jumpRest(H) { await sleep(600); H.jump(); await sleep(2600); },
  async jumpRun(H) {
    H.autoWalk(1.8, 0); await sleep(2200); H.jump(); await sleep(2600); H.autoWalk(0, 0);
  },
  async pulse(H) {
    for (let i = 0; i < 3; i++) {
      H.autoWalk(0.9, 0); await sleep(1500);
      H.autoWalk(0, 0); await sleep(1500);
    }
  },
  async trot(H) { H.autoWalk(1.8, 0); await sleep(6000); H.autoWalk(0, 0); },
  async runFast(H) { H.autoWalk(2.5, 0); await sleep(6000); H.autoWalk(0, 0); },
  // every gesture and idle, back to back: none may snap a digit, all must return to rest
  async gestures(H) {
    const tips = () => F.map(f => H.rig.digits[f].tip.getWorldPosition(new H.THREE.Vector3()));
    const rest = tips(), bad = [];
    for (const [name, def] of [...Object.entries(H.GESTURES), ...Object.entries(H.IDLES)]) {
      if (H.GESTURES[name]) { if (!H.gesture(name)) bad.push(`${name} refused`); }
      else { H.sim.s.gesture = null; H.sim.s.gesture = { name, t: 0, dur: def.dur, def, idle: true }; }
      for (let t = 0; t < (def.dur + 0.5) / H.C.TIME_SCALE; t += 0.5) {
        await sleep(500);
        H.sim.s.lastInput = H.sim.s.time;                  // keep random idles and brain behaviors out
      }
      const back = Math.max(...tips().map((p, i) => p.distanceTo(rest[i])));
      if (back > CRIT.returnErr) bad.push(`${name} returns ${back.toFixed(3)} off rest`);
      if (!F.every(f => H.sim.legs[f].mode === 'stance')) bad.push(`${name} leaves a digit unplanted`);
    }
    return bad;
  },
  async pivot180(H) { H.pivot(180); await sleep(4500); },
  // the click-to-walk path: four brain walkTo legs with 90° course changes
  async clickWalk(H) {
    H.brain.run([{ do: 'walkTo', x: 3, z: 0, speed: 0.8 }, { do: 'walkTo', x: 3, z: 3, speed: 0.8 },
      { do: 'walkTo', x: 0, z: 3, speed: 0.8 }, { do: 'walkTo', x: 0, z: 0, speed: 0.8 }]);
    for (let i = 0; i < 400 && H.brain.st.i >= 0; i++) await sleep(100);
    if (H.brain.st.status === 'error') throw new Error('clickWalk: brain ' + H.brain.st.detail);
  },
  async stop(H) { H.autoWalk(0.8, 0); await sleep(3000); H.autoWalk(0, 0); await sleep(2000); },
  async gaitShift(H) {
    for (const v of [0.4, 1.0, 1.7, 2.5, 1.7, 1.0, 0.4]) {
      H.autoWalk(v, 0); await sleep(1400);
    }
    H.autoWalk(0, 0);
  },
};
// scenario → why it may fail. Filled from the first deterministic run; shrink it, never grow it casually.
const KNOWN_RED = {
  spam: 'seeded chaos input: lane order breaks under 160 ms direction flips',
  turnCycle: 'walk-and-turn scrub, the finger yaw cone binds (plan Task 17)',
  gaitShift: 'slide 0.55 across six gait changes (plan Tasks 6, 11)',
  clickWalk: 'course changes scrub 0.47 per u (plan Tasks 6, 17)',
};

async function scenario(name) {
  const H = window.__hand;
  if (!SCENARIOS[name]) throw new Error(`unknown scenario '${name}' (have: ${Object.keys(SCENARIOS).join(', ')})`);
  H.reset();
  await sleep(2500);                                         // settle (§7 A/B hygiene)
  const rec = makeRecorder(H);
  const extra = await SCENARIOS[name](H);                    // a scenario may return its own fail strings
  await sleep(800);                                          // let the last swings land
  const res = rec.stop(name);
  if (Array.isArray(extra)) res.fails.push(...extra);
  return { name, ...res, pass: res.fails.length === 0 };
}

async function matrix() {
  const rows = [];
  for (const name of Object.keys(SCENARIOS)) rows.push(await scenario(name));
  return {
    rows,
    passed: rows.filter(r => r.pass).length,
    total: rows.length,
    green: rows.every(r => r.pass || KNOWN_RED[r.name]),
  };
}

window.__qa = { scenario, matrix, SCENARIOS, CRIT, KNOWN_RED };
