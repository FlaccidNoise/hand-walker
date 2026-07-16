// qa.js — dev-only QA harness (§6). STRIPPED from the artifact build. Drives the sim
// through window.__hand via scripted scenarios on the real rAF loop, recording:
//   slide     accumulated planted-tip xz drift (u)          < 0.5
//   cross     worst neighbour lane-order margin (hand z)    > -0.05
//   floor     min contact-joint height above ground (u)     >= -0.01
//   tipErrP95 95th pct planted solve error (u)              < 0.08
//   swingDur  observed swing durations (s)                  in [0.11, 0.20]
//   towed     any leg dragged planted at err>0.15 for >0.5s none
// `spam` is allow-listed: gate passes with 9/10 as long as the 9 are the others.
// steadyW is NOT bit-reproducible (wall-clock loop, §7) — assert bands, not bits.

const F = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const NEIGHBOR_PAIRS = [['thumb', 'index'], ['index', 'middle'], ['middle', 'ring'], ['ring', 'pinky']];
const CRIT = { slide: 0.5, cross: -0.05, floor: -0.01, tipErrP95: 0.08, swingLo: 0.11, swingHi: 0.20 };

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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
    stop() {
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
      };
      const fails = [];
      if (m.slide >= CRIT.slide) fails.push(`slide ${m.slide}`);
      if (m.cross <= CRIT.cross) fails.push(`cross ${m.cross}`);
      if (m.floor < CRIT.floor) fails.push(`floor ${m.floor}`);
      if (m.tipErrP95 >= CRIT.tipErrP95) fails.push(`tipErrP95 ${m.tipErrP95}`);
      if (m.swingMin != null && (m.swingMin < CRIT.swingLo - 0.01 || m.swingMax > CRIT.swingHi + 0.01))
        fails.push(`swingDur ${m.swingMin}-${m.swingMax}`);   // ±0.01: rAF sampling quantum
      if (m.towed) fails.push('towed digit');
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
  async gaitShift(H) {
    for (const v of [0.4, 1.0, 1.7, 2.5, 1.7, 1.0, 0.4]) {
      H.autoWalk(v, 0); await sleep(1400);
    }
    H.autoWalk(0, 0);
  },
};
const ALLOW_LIST = ['spam'];

async function scenario(name) {
  const H = window.__hand;
  if (!SCENARIOS[name]) throw new Error(`unknown scenario '${name}' (have: ${Object.keys(SCENARIOS).join(', ')})`);
  H.reset();
  await sleep(2500);                                         // settle (§7 A/B hygiene)
  const rec = makeRecorder(H);
  await SCENARIOS[name](H);
  await sleep(800);                                          // let the last swings land
  const res = rec.stop();
  return { name, ...res };
}

async function matrix() {
  const rows = [];
  for (const name of Object.keys(SCENARIOS)) rows.push(await scenario(name));
  const required = rows.filter(r => !ALLOW_LIST.includes(r.name));
  const passed = required.filter(r => r.pass).length;
  return {
    rows,
    passed: rows.filter(r => r.pass).length,
    total: rows.length,
    green: passed === required.length,                       // 9/10 with spam allow-listed
  };
}

window.__qa = { scenario, matrix, SCENARIOS, CRIT };
