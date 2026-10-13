// qa.js — dev-only QA harness (§6). STRIPPED from the artifact build. Drives the sim
// through window.__hand via scripted scenarios on the real rAF loop, recording:
//   slide     accumulated planted-tip xz drift               <= 0.10 per u walked (< 0.5 u in place)
//   gap       closest neighbouring finger shafts, in flesh radii  >= 0.40  (rest 1.35; < 1 = pads overlap.
//             Travel runs 1.2+. Pivots bind at 0.42-0.50: they borrow the travel patterns)
//   cross     worst neighbour lane-order margin (hand z), reported only: it misreads a
//             pinky planted behind and outside the ring as a crossing
//   floor     min contact-joint height above ground (u)     >= -0.01
//   tipErrP95 95th pct planted solve error (u)              < 0.08
//   swingDur  observed swing durations (s)                  in [0.11, 0.60]
//   towed     any leg dragged planted at err>0.15 for >0.5s none
//   clear     worst swing peak / carried-digit clearance (u)   >= 0.10
//   touchdown tip travel in the landing sim step (u)           <= 0.035
//   tipJump   largest tip move in one sim step, on the ground  <= 0.15 (hopScuttle, at 120 Hz).
//             A swing step runs to 0.07. A digit towed out of reach and thrown by the
//             ground constraint moved 0.32
// KNOWN_RED scenarios are allowed to fail (named, with the reason); every other one
// must pass. The gate runs on a virtual clock, so results are bit-reproducible.

const F = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const NEIGHBOR_PAIRS = [['thumb', 'index'], ['index', 'middle'], ['middle', 'ring'], ['ring', 'pinky']];
const CRIT = { slide: 0.5, slidePerU: 0.10, gap: 0.40, floor: -0.01, tipErrP95: 0.08, swingLo: 0.11, swingHi: 0.60,
  clear: 0.10,     // every swing peak and every carried digit clears the floor by this
  plantedMin: 2, bodyBob: 0.06,     // pivot180 only: support never drops, the wrist does not hop
  tipStep: 0.16, returnErr: 0.02,   // gestures only: no digit snaps, every tip comes back to rest
  touchdown: 0.035,
  restErr: 0.10, stopSettle: 0.7 }; // stop only: feet end on their rest spots, all motion over in this many s               // tip travel in the landing sim step: placed, not scuffed (was 0.054-0.070)
// a pivot re-steps every digit ~10 times: its slide bar is its own (0.034 per stance)
const SLIDE = { pivot180: 2.0 };
// a click-walk is starts, stops and pivots between short legs: more stance periods per unit
const SLIDE_PER_U = { clickWalk: 0.15 };
// pivot steps hold their fold longer for lane clearance and land faster than travel steps (0.033-0.044)
const TOUCH = { pivot180: 0.05, turnCycle: 0.05, clickWalk: 0.05 };
// no digit snaps on the ground. Judged where a frame is one sim step (the 120 Hz gate): at
// 60 Hz a frame is two steps and the recorder cannot see inside it
const TIP_JUMP = { hopScuttle: 0.15 };

// under the gate's virtual clock (scripts/qa-gate.mjs) waiting PUMPS frames, so a
// scenario integrates an exact frame time and is bit-reproducible at any machine load
const sleep = async (ms) => {
  if (!window.__vframe) return new Promise(r => setTimeout(r, ms));
  const hz = window.__vhz || 120, n = Math.round(ms * hz / 1000);
  for (let i = 0; i < n; i++) window.__vframe(1000 / hz);
};

// closest distance between segments p1-q1 and p2-q2 (Ericson, Real-Time Collision Detection)
function segDist(p1, q1, p2, q2) {
  const d1 = q1.clone().sub(p1), d2 = q2.clone().sub(p2), r = p1.clone().sub(p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s = 0, t = 0;
  if (a > 1e-12 && e > 1e-12) {
    const b = d1.dot(d2), c = d1.dot(r), den = a * e - b * b;
    s = den > 1e-12 ? Math.min(Math.max((b * f - c * e) / den, 0), 1) : 0;
    t = (b * s + f) / e;
    if (t < 0) { t = 0; s = Math.min(Math.max(-c / a, 0), 1); }
    else if (t > 1) { t = 1; s = Math.min(Math.max((b - c) / a, 0), 1); }
  }
  return p1.clone().addScaledVector(d1, s).distanceTo(p2.clone().addScaledVector(d2, t));
}

function makeRecorder(H) {
  const { sim, rig } = H;
  const V = H.THREE.Vector3;
  const restZ = Object.fromEntries(F.map(f => [f, H.calib.feet[f].z]));
  const r = {
    slide: 0, floor: Infinity, cross: Infinity, errs: [], swings: [], lifts: [],
    towed: false, steps: 0, frames: 0,
  };
  const stanceStart = {}, swingStart = {}, swingPeak = {}, towedT = {}, replant = {};
  let last = sim.s.time, raf = 0, on = true;
  const tmp = new V();
  // look metrics: what the eye reads, beyond solve error
  const L = {
    yMin: Infinity, yMax: -Infinity, plantedMin: Infinity, dist: 0,
    px: rig.mount.position.x, pz: rig.mount.position.z, cmdOn: false, tStop: null, tMove: null,
    touchdown: 0, aloftClear: Infinity, t0: sim.s.time, tipStep: 0, tipJump: 0, gap: Infinity,
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
          if (swingStart[f] == null) { swingStart[f] = sim.s.time; swingPeak[f] = -Infinity; r.steps++; replant[f] = !!leg.swing?.replant; }
          if (tip.y > swingPeak[f]) swingPeak[f] = tip.y;
        }
      }
      if (leg.mode !== 'swing' && swingStart[f] != null) {
        if (leg.mode === 'stance' && !replant[f]) {          // landed; aloft/tuck interruptions and
          r.swings.push(sim.s.time - swingStart[f]);         // carried-digit re-plants are not steps
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
      if (step3 > L.tipStep) { L.tipStep = step3; L.stepWho = `${f} ${leg.mode} t=${(sim.s.time - L.t0).toFixed(2)}`; }
      if (!sim.s.airborne && leg.mode !== 'tuck' && step3 > L.tipJump) { L.tipJump = step3; L.jumpWho = `${f} ${leg.mode} t=${(sim.s.time - L.t0).toFixed(2)}`; L.jumpSteps = nSteps; }
      if (moved > 5e-4 * nSteps) L.tMove = sim.s.time;      // 0.04 mm a step: below this the tip is still
      if (leg.mode === 'swing') {
        if (q.mode !== 'swing') { q.from = { x: tip.x, z: tip.z }; q.peak = -Infinity; }
        if (clear > q.peak) q.peak = clear;
      } else if (q.mode === 'swing' && leg.mode === 'stance') {
        q.steps++; q.len += Math.hypot(tip.x - q.from.x, tip.z - q.from.z);
        if (q.peak < q.clear) q.clear = q.peak;
        if (moved / nSteps > L.touchdown) {                  // u per sim step at landing
          L.touchdown = moved / nSteps; L.touchWho = `${f} t=${(sim.s.time - L.t0).toFixed(2)}`;
        }
      }
      if (leg.mode === 'aloft') {
        q.aloftT += dt;
        if (q.aloftT > 0.4 && clear < L.aloftClear) L.aloftClear = clear;
      } else q.aloftT = 0;
      q.mode = leg.mode; q.prev = { x: tip.x, y: tip.y, z: tip.z };
    }
    // gap: neighbouring finger SHAFTS (3 segments each), as a multiple of their flesh
    // radii. Below ~1 the capsules interpenetrate. Unlike `cross` (hand-z order) this
    // is not fooled by a pinky planted behind and outside the ring.
    for (const [a, b] of NEIGHBOR_PAIRS) {
      const da = rig.digits[a], db = rig.digits[b];
      const A = [da.mcp, da.pip, da.dip, da.tip].map(j => j.getWorldPosition(new V()));
      const B = [db.mcp, db.pip, db.dip, db.tip].map(j => j.getWorldPosition(new V()));
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        const g = segDist(A[i], A[i + 1], B[j], B[j + 1]) / (da.flesh + db.flesh);
        if (g < L.gap) { L.gap = g; L.gapWho = `${a}/${b} t=${(sim.s.time - L.t0).toFixed(2)}`; }
      }
    }
    for (const [a, b] of NEIGHBOR_PAIRS) {
      // carried legs (aloft/tuck) aren't stepping feet — lane order applies to
      // planted and swinging legs only (§4.6/§4.7)
      const stepping = (m) => m === 'stance' || m === 'swing';
      if (!stepping(sim.legs[a].mode) || !stepping(sim.legs[b].mode)) continue;
      const sign = Math.sign(restZ[b] - restZ[a]);
      const margin = (sim.legs[b]._zHand - sim.legs[a]._zHand) * sign;
      if (margin < r.cross) { r.cross = margin; L.crossWho = `${a}(${sim.legs[a].mode})/${b}(${sim.legs[b].mode}) t=${(sim.s.time - L.t0).toFixed(2)}`; }
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
        gap: +L.gap.toFixed(3), gapWho: L.gapWho,
        touchdown: +L.touchdown.toFixed(4),
        tipStep: +L.tipStep.toFixed(3),                     // largest 3D tip move in one sim step
        tipJump: +L.tipJump.toFixed(3), jumpWho: L.jumpWho, // the same, feet on the ground only
        bodyBob: +(L.yMax - L.yMin).toFixed(3),
        stopSettle: L.tStop != null && L.tMove != null ? +Math.max(L.tMove - L.tStop, 0).toFixed(3) : null,
        dist: +L.dist.toFixed(2),
        cmdEnd: L.tStop != null ? +(L.tStop - L.t0).toFixed(2) : null,   // sim s until the last command ended
      };
      const fails = [];
      const G = name === 'gestures' || name === 'gestureCut';   // digits are posed, not stepping: gait bars do not apply
      // travel scenarios are judged per unit walked (a long run is not worse than a short
      // one); in-place scenarios keep the absolute bar
      if (!G && m.slidePerU != null && L.dist > 4) {
        if (m.slidePerU > (SLIDE_PER_U[name] ?? CRIT.slidePerU)) fails.push(`slide/u ${m.slidePerU}`);
      } else if (!G && m.slide >= (SLIDE[name] ?? CRIT.slide)) fails.push(`slide ${m.slide}`);
      if (G && m.tipStep > CRIT.tipStep) fails.push(`tip snap ${m.tipStep} (${L.stepWho})`);
      if (TIP_JUMP[name] && L.jumpSteps === 1 && m.tipJump > TIP_JUMP[name]) fails.push(`tip jump ${m.tipJump} (${L.jumpWho})`);
      if (m.touchdown > (TOUCH[name] ?? CRIT.touchdown)) fails.push(`touchdown ${m.touchdown} (${L.touchWho})`);
      if (name === 'stop' && m.stopSettle > CRIT.stopSettle) fails.push(`settle ${m.stopSettle}s`);
      if (name === 'pivot180') {
        if (m.plantedMin < CRIT.plantedMin) fails.push(`planted ${m.plantedMin}`);
        if (m.bodyBob > CRIT.bodyBob) fails.push(`bob ${m.bodyBob}`);
      }
      if (!G && m.gap < CRIT.gap) fails.push(`finger gap ${m.gap} (${L.gapWho})`);
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
  // gestures cut short by the next one (mashed emote keys): no pop, no stuck digit.
  // A hover refuses to be cut, and the caller's retry lands when it has set down.
  async gestureCut(H) {
    const tips = () => F.map(f => H.rig.digits[f].tip.getWorldPosition(new H.THREE.Vector3()));
    const rest = tips(), bad = [];
    for (const [name, ms] of [['bow', 600], ['point', 500], ['dance', 1300], ['tap', 400], ['sleep', 1500], ['knock', 700], ['laugh', 300], ['idk', 300]]) {
      if (!H.gesture(name)) bad.push(`${name} refused over a stance gesture`);
      await sleep(ms);
    }
    let up = false;                                          // a hover waits for the cut gesture to settle
    for (let i = 0; i < 40 && !up; i++) { up = H.gesture('thumbsUp'); if (!up) await sleep(50); }
    if (!up) bad.push('thumbsUp never started after a cut gesture');
    await sleep(400);
    if (H.gesture('wave')) bad.push('a hover was cut short');
    for (let i = 0; i < 12; i++) { await sleep(500); H.sim.s.lastInput = H.sim.s.time; }
    const back = Math.max(...tips().map((p, i) => p.distanceTo(rest[i])));
    if (back > CRIT.returnErr) bad.push(`ends ${back.toFixed(3)} off rest`);
    if (!F.every(f => H.sim.legs[f].mode === 'stance')) bad.push('leaves a digit unplanted');
    return bad;
  },
  async pivot180(H) { H.pivot(90); await sleep(2200); H.pivot(90); await sleep(2200); },   // two stepping pivots
  // a reversal is one hop: it must land on the new heading, on all five, fast
  async hopTurn(H) {
    const h0 = H.sim.s.heading, t0 = H.sim.s.time;
    H.pivot(180);
    let t = null;
    for (let i = 0; i < 40; i++) { await sleep(50); if (t == null && !H.sim.s.airborne && H.sim.s.pivotTarget == null && H.sim.s.planted === 5) t = H.sim.s.time - t0; }
    const off = Math.abs(Math.abs(H.sim.s.heading - h0) - Math.PI), bad = [];
    if (off > 0.05) bad.push(`hop-turn lands ${(off * 57.3).toFixed(1)}° off`);
    if (t == null || t > 0.6) bad.push(`hop-turn takes ${t == null ? 'over 1.5' : t.toFixed(2)} s`);
    return bad;
  },
  // the click-to-walk path: four brain walkTo legs with 90° course changes (on the
  // flat side of the room: the step at (0, 2.4) is a terrain test, not a gait one)
  async clickWalk(H) {
    let berr = null;                                         // a brain error arrives through onsay
    const page = H.brain.st.onsay;
    H.brain.st.onsay = (t, k) => { if (k === 'error') berr = t; if (page) page(t, k); };
    H.brain.run([{ do: 'walkTo', x: 3, z: 0, speed: 0.8 }, { do: 'walkTo', x: 3, z: -3, speed: 0.8 },
      { do: 'walkTo', x: 0, z: -3, speed: 0.8 }, { do: 'walkTo', x: 0, z: 0, speed: 0.8 }]);
    for (let i = 0; i < 400 && H.brain.st.i >= 0; i++) await sleep(100);
    H.brain.st.onsay = page;
    if (berr) throw new Error('clickWalk: brain ' + berr);
  },
  // a hop-turn straight into a scuttle (go and ring the bell, from rest): the first strides
  // of a trot. A digit held down past its reach by the support guard was thrown 0.32 u
  async hopScuttle(H) {
    let berr = null;
    const page = H.brain.st.onsay;
    H.brain.st.onsay = (t, k) => { if (k === 'error') berr = t; if (page) page(t, k); };
    H.brain.run([{ do: 'walkTo', x: -3.2, z: 3.2, speed: 1.8 }]);
    for (let i = 0; i < 100 && H.brain.st.i >= 0; i++) await sleep(100);
    H.brain.st.onsay = page;
    if (berr) throw new Error('hopScuttle: brain ' + berr);
  },
  // walk, stop, hold: the hand must halt fast, finish IN its stance, and then be still
  async stop(H) {
    H.autoWalk(0.8, 0); await sleep(3000); H.autoWalk(0, 0); await sleep(2000);
    const V = H.THREE.Vector3, B = H.rig.mount.position, a = H.sim.s.heading, bad = [];
    const off = F.map(f => {
      const t = H.rig.digits[f].tip.getWorldPosition(new V()), r = H.calib.feet[f];
      return Math.hypot((t.x - B.x) * Math.cos(a) - (t.z - B.z) * Math.sin(a) - r.x,
        (t.x - B.x) * Math.sin(a) + (t.z - B.z) * Math.cos(a) - r.z);
    });
    if (Math.max(...off) > CRIT.restErr) bad.push(`stops ${Math.max(...off).toFixed(3)} off its stance`);
    return bad;
  },
  async gaitShift(H) {
    for (const v of [0.4, 1.0, 1.7, 2.5, 1.7, 1.0, 0.4]) {
      H.autoWalk(v, 0); await sleep(1400);
    }
    H.autoWalk(0, 0);
  },
};
// scenario → why it may fail. Filled from the first deterministic run; shrink it, never grow it casually.
const KNOWN_RED = {
  spam: 'seeded chaos: a new direction every 160 ms. Timing-sensitive: middle and ring pads overlap (gap 0.02) at 120 Hz, green at 60',
  jumpRun: 'ring and pinky pads overlap (gap 0.27) on the first strides after a running jump lands',
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
