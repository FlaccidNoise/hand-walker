# Thing walk, control feel, and interactions

Date: 2026-10-09. Status as of 2026-10-10: Tasks 1–18 and 20–23 built. Task 19 (deploy) waits for the owner. What changed against this plan, and the measured results, are in `HANDOFF.md`.

## Header

**Goal.** Make the hand walk and respond like Thing: tall on its fingertips, long cohesive steps that grip the floor, staccato starts and stops, driven by click, keys, and voice through one command layer.

**Architecture.** hand-walker is the base. Its sim (`makeSim` in `main.js`) keeps the solver, calibration, and zero-slip cadence law. The work changes four things around that core: a fixed timestep, a posture and per-digit gait layer, a single command layer above the player API, and a prop registry. The sibling repo `procedural-hand-animation` is a donor for click-to-walk, props, the rules parser, and the in-browser LLM.

**Tech stack.** Vanilla ES modules, three.js r175 vendored in `vendor/`, no build step. Node 20+ `node --test` for unit tests. `puppeteer-core` 23 with local Chrome for headless gates. Python 3 for the dev server.

**Global constraints.**
- Sim step is fixed at `SIM_DT = 0.00625` s of sim time. Every measurement in this plan uses it.
- 1 world unit (u) is the middle-finger reach, 8.65 cm.
- No new runtime dependency except `@mlc-ai/web-llm`, pinned to an exact version (Task 18).
- Gesture authoring rules in `src/gestures.js:17-25` stay in force.
- Commits use `--no-verify` and carry no Co-Authored-By trailer (`HANDOFF.md:87`).
- Nothing deploys to the website without the owner's approval (Task 19).

## Why hand-walker is the base

Two independent reviewers rated both repos on the same rubric and both chose hand-walker (65% and 80% confidence). Full reports: `docs/research/base-repo-review-locomotion.md` and `docs/research/base-repo-review-product.md`.

| Measure, straight walk at 0.8 u/s | Sibling, 60 Hz display | Sibling, 120 Hz display | hand-walker, fixed step |
|---|---|---|---|
| Finger step length | 0.13–0.16 u (ring 0.27) | 0.14 u (ring 0.29) | 0.41–0.49 u |
| Steps per second, all digits | not measured | 24 | 8.2 |
| Stance slide per u travelled | 0.40 | 0.18–0.23 | 0.077 |
| Ring finger swing clearance | 0.004 u (never lifts) | 0.15 u | 0.22 u |
| Narrowest calibrated stance band | 0.06 u | 0.06 u | 0.53 u |

The website serves the sibling at commit `8ce8992` (2026-07-14), which predates its click-to-walk, props, and voice. That exact build was not measured separately.

The sibling's small steps come from a 0.72 reach cap in its planner (`procedural-hand-animation/main.js:215,286`). Lifting the cap gave 0.32–0.39 u steps but regressed slow walk, 60–90 Hz displays, and turns. Moving hand-walker's core into the sibling replaces the sibling's solver, rig, calibration, gait, QA harness, and all 16 gesture clips. Moving the sibling's features into hand-walker is about twelve small or medium additions above the player API.

What would reverse this choice: the thumb fix in Task 5 needs a rig rebuild, or hand-walker's gait numbers do not hold after Task 1.

## What is wrong today (measured)

hand-walker, fixed step, commands in `.debug/2026-10-09-review/`:

| # | Defect | Evidence | Fixed by |
|---|---|---|---|
| 1 | Sim diverges on 60 Hz displays | standing wrist height swings 0.43 to 6.0 (stand height 0.886) | Task 1 |
| 2 | QA gate measures the machine | gate read 0/10 at 60.3 fps headless | Task 2 |
| 3 | Thumb scrapes every step | swing clearance 0.044 u, fingers 0.21 u | Task 5 |
| 4 | "Aloft" thumb skims the floor | clearance 0.000 on 480 of 480 frames in trot and run | Task 5 |
| 5 | Every pivot starts with a slam and hop | 19 frames with zero digits planted, wrist 0.565 to 1.406 | Task 6 |
| 6 | Pinky towed in turns | stance error up to 0.47 u on a zigzag, 0.03 u straight | Tasks 9, 17 |
| 7 | Landings scuff | index tip moves 0.035–0.046 u per frame at touchdown, pins 0.073 u short | Task 7 |
| 8 | Body is a steadicam | wrist height constant to 3 decimals while walking | Task 13 |
| 9 | All digits treated alike | one shared stride of 0.376 u set by the pinky | Tasks 9, 10 |
| 10 | Posture is flat | palm about 9° nose-down. Reference is 45–60° with the stump high | Task 8 |
| 11 | No control on a static host | only path is `POST /llm`. No click, no keys | Tasks 14–18 |
| 12 | Dev server exposed the Gemini proxy on the LAN | bound `0.0.0.0` | Fixed 2026-10-09, `scripts/serve.py:76` |

## Target look

From `docs/research/thing-motion-reference.md`. Tags: S = sourced, O = observed in frames, I = inferred.

1. Stump up and behind as the "head". Palm pitched nose-down. Heel of the palm is the highest point. (S, O)
2. Staccato timing. Fast attack, hard stop, dead-still hold. No slow ease, no drifting settle. (S)
3. Tall stance on long, mostly straight fingers fanned wide. (O)
4. Pinky is a straight splayed outrigger, planted wide and behind the other tips, short stride. (O, 1991 frames, medium confidence)
5. Thumb is a rear strut on the other side. It props. It does not reach. (O)
6. Index and middle lead with the longest reach. (O)
7. Body rides level. Fingers work underneath. Small bob only. (O, low confidence)
8. Contacts never slide. (S)
9. Landing squash and quick recover. (O)
10. Emotion rides on tempo and tremor. (S)

**Not known.** No source gives Thing's footfall order or cadence. Decision D2 below settles the order by eye.

## Pass bars

| Metric (fixed step, 120 Hz and 60 Hz) | Today | Target |
|---|---|---|
| Standing wrist excursion at 60 Hz | 5.6 u | ≤ 0.01 u |
| Step length, strut (same for every digit at one cadence) | 0.45–0.49 u | ≥ 0.70 u |
| Footfalls per u travelled, strut | 10 | ≤ 7 |
| Stance slide per u, straight | 0.077 | ≤ 0.08 |
| Stance slide per u, click-walk with a 90° course change | 0.47 | ≤ 0.15 |
| Swing peak clearance, every digit, every gait | thumb 0.044, aloft 0.000 | ≥ 0.10 u |
| Minimum planted digits outside jump and hover | 0 (pivot) | ≥ 2, and ≥ 3 in strut |
| Wrist excursion during a pivot | 0.84 u | ≤ 0.04 u |
| Touchdown tip speed | 0.046 u per frame | ≤ 0.015 u per frame |
| Palm pitch in strut | 9° | ≥ 35° |
| Stop: time from command to zero tip motion | not measured | ≤ 0.35 s, then still for 1 s |
| Static host: click, keys, typed text all move the hand | none work | all work |

## Owner decisions

| ID | Decision | When | How it is put to the owner |
|---|---|---|---|
| D1 | Posture | Task 8 | Three rendered filmstrips: 26°, 34°, 43° nose-down |
| D2 | Footfall order for strut | Task 10 | Three patterns on a live toggle key |
| D3 | Deploy to the website | Task 19 | Explicit yes before the push |
| D4 | Left hand or right hand | After Task 13 | 1991 Thing is a right hand. Sibling has `assets/hand-right.glb`. Default: stay left |

## File map

| File | Responsibility | Change |
|---|---|---|
| `main.js` | page loop, sim core, calibration | fixed-step loop, posture calibration, per-digit homes, stop planner, plant events |
| `src/gait.js` | pure gait math: per-digit duty, cadence law, phase windows | new |
| `src/tuning.js` | every constant | `SIM_DT`, `ROOM`, per-gait swing window, posture path, body springs |
| `src/brain.js` | command layer, plan executor, behaviors | `command()`, generation counter, `use` action, status recovery |
| `src/input.js` | pointer and key handlers, calls `brain.command` and `sim.autoWalk` | new |
| `src/props.js` | prop registry, sensed-prop updates, events | new |
| `src/voice.js`, `src/llm.js` | rules parser, in-browser LLM | ported from the sibling |
| `src/gestures.js` | gesture defs | new emotes, hand-sign factory |
| `src/scene.js` | room, lights, prop meshes | light rig tween, prop meshes |
| `qa.js` | scenario recorder | virtual-clock waits, look metrics |
| `scripts/qa-gate.mjs` | headless gate | virtual clock, frame-rate sweep, named allow-list |
| `scripts/film.mjs` | fixed-step filmstrip tool | new, promoted from `.debug/2026-10-09-review/gaitlab.mjs` |
| `test/gait.test.mjs`, `test/brain.test.mjs`, `test/props.test.mjs` | node unit tests | new |

## Seams

1. **`sim.step(dt)` behind `window.__hand`, driven by a virtual clock.** Already exists (`main.js:396`, `main.js:51-61`). The gate replaces `performance.now` and `requestAnimationFrame` before page scripts load, so the real loop integrates an exact frame time. Every gait, posture, and control task is checked here.
2. **Pure functions under `node --test`.** Already exists for the solver (`test/unit.test.mjs`). New pure modules `src/gait.js`, the brain executor on a mock sim, and prop step functions are tested here.

No third seam. Pixels are checked with `scripts/film.mjs` contact sheets, read by a person or an agent, at each owner decision.

---

## Phase 0: make measurement trustworthy

### Task 1: Fixed-step loop

**Files:**
- Modify: `main.js:110-128`, `src/tuning.js:4-6`

**Blocked by:** None.

**Interfaces:** produces `C.SIM_DT`, `C.SIM_MAX_SUBSTEPS`. `sim.step` and `brain.tick` are only ever called with `C.SIM_DT`.

- [ ] Add to `src/tuning.js` under `// --- Time ---`:

```js
export const SIM_DT = 0.00625;        // s sim — the rate every band, gain and gate was measured at
export const SIM_MAX_SUBSTEPS = 8;    // per frame; past this the sim runs slow instead of unstable
```

- [ ] Replace the body of `loop()` in `main.js`:

```js
let acc = 0;
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 1 / 30);
  if (!state.paused) {
    acc += dt * C.TIME_SCALE;
    let n = 0;
    while (acc >= C.SIM_DT && n++ < C.SIM_MAX_SUBSTEPS) {
      sim.step(C.SIM_DT);
      brain.tick(C.SIM_DT);
      acc -= C.SIM_DT;
    }
    if (acc >= C.SIM_DT) acc = 0;     // overloaded: drop time, never feed a long step
  }
  // render, debug, HUD unchanged
}
```

- [ ] Check at 60 Hz with the reviewer's probe: `cd .debug/2026-10-09-review/loco-review && node vclock.mjs A 60 '{"kind":"rest","secs":5}'`. Expect body y within 0.876–0.896. Before the change it reads 0.427–6.014.
- [ ] Check at 30 Hz and 144 Hz with the same command. Expect the same range.
- [ ] Run `npm run test:unit` and `node scripts/calib-gate.mjs`. Expect 11/11 and `BIT-EXACT`.
- [ ] Commit.

Known limit: at 144 Hz some frames run zero sim steps. Add render interpolation only if the owner sees judder.

### Task 2: Deterministic gate

**Files:**
- Modify: `qa.js:16`, `qa.js:117-166`, `scripts/qa-gate.mjs`, `package.json:8-12`

**Blocked by:** Task 1.

**Interfaces:** produces `node scripts/qa-gate.mjs [scenario] [--hz N]`, bit-reproducible. `window.__vframe(dtMs)` exists only under the gate.

- [ ] In `scripts/qa-gate.mjs`, before `page.goto`, inject the virtual clock:

```js
await page.evaluateOnNewDocument(() => {
  let vnow = 0, id = 0; const q = new Map();
  performance.now = () => vnow;
  window.requestAnimationFrame = (cb) => { q.set(++id, cb); return id; };
  window.cancelAnimationFrame = (i) => q.delete(i);
  window.__vframe = (dtMs) => { vnow += dtMs; const cbs = [...q.values()]; q.clear(); for (const cb of cbs) cb(vnow); };
});
```

- [ ] Parse `--hz N` (default 120) and pass it to the page as `window.__vhz`.
- [ ] In `qa.js`, replace `sleep` with a wait that pumps frames under the gate:

```js
const sleep = async (ms) => {
  if (!window.__vframe) return new Promise(r => setTimeout(r, ms));
  const hz = window.__vhz || 120, n = Math.round(ms * hz / 1000);
  for (let i = 0; i < n; i++) window.__vframe(1000 / hz);
};
```

- [ ] The gate must pump frames until `__hand.state.ready` is true, because the page loop no longer advances by itself.
- [ ] Remove `--repeat` and the median code from `qa-gate.mjs`. A deterministic gate needs one run.
- [ ] Read `CRIT` from `window.__qa.CRIT` and delete the hand-copied table at `scripts/qa-gate.mjs:15-27`.
- [ ] Replace `ALLOW_LIST = ['spam']` in `qa.js:152` with a named map of known reds and their reason: `{ spam: 'chaos input', turnCycle: 'walk-and-turn scrub, Task 17', gaitShift: 'record after first deterministic run' }`. Record the actual red set from the first deterministic run and keep only those names.
- [ ] Run the matrix twice at 120 Hz. Expect identical output. Run once at `--hz 60`. Expect the same pass set.
- [ ] Set `package.json` `"test"` to `node --test test/*.test.mjs && node scripts/calib-gate.mjs && node scripts/qa-gate.mjs && node scripts/qa-gate.mjs --hz 60`.
- [ ] `rest` slide must read exactly 0. That is the canary for idle leakage.
- [ ] Commit, and update `HANDOFF.md:55-58` with the new baseline.

### Task 3: Look metrics and filmstrip tool

**Files:**
- Modify: `qa.js:19-113`
- Create: `scripts/film.mjs`, `test/look.baseline.json`

**Blocked by:** Task 2.

**Interfaces:** `metrics` gains `clearMin` (per digit, min swing peak clearance), `plantedMin`, `stepLen` (per digit mean), `footfallsPerU`, `touchdownSpeed` (max tip travel in the last swing frame), `bodyBob` (max − min wrist height over ground), `stopSettle` (s from zero command to zero tip motion). `scripts/film.mjs --run "<js>" --view <side|sideL|rear|top|live> --frames N --every K --label X` writes a contact sheet PNG to `.debug/`.

- [ ] Add the seven metrics to `makeRecorder`. Clearance is `tip.y − d.flesh − groundY`. Count aloft digits in `clearMin`.
- [ ] Add `CRIT` entries: `clearMin ≥ 0.10`, `plantedMin ≥ 2`, `touchdownSpeed ≤ 0.015`. Scenarios with jumps skip `plantedMin`.
- [ ] Add scenarios `pivot180` (`H.pivot(180)`, 2.5 s), `clickWalk` (`H.brain.run` of four `walkTo` targets with 90° course changes), `stop` (walk 0.8 for 3 s, command 0, 2 s).
- [ ] Build `scripts/film.mjs` from `.debug/2026-10-09-review/gaitlab.mjs` `film` mode. Use the virtual clock from Task 2. Tile with `ffmpeg -vf tile=4x2`.
- [ ] Run the matrix. Save every metric to `test/look.baseline.json`. The new criteria fail today on thumb clearance, pivot, and touchdown speed. Add those scenario names to the allow-list with the task number that clears each.
- [ ] Commit.

### Task 4: Hygiene that blocks a public page

**Files:**
- Modify: `main.js:124`, `main.js:444-448`, `main.js:852-867`, `src/tuning.js`, `src/brain.js:36`, `src/scene.js:122`, `src/terrain.js:45-48`, `index.html:23,44`

**Blocked by:** None.

- [ ] HUD: build the text with `textContent` and a `<b>` only for fixed labels. No LLM or user text reaches `innerHTML`.
- [ ] Idle picker: replace `Math.random()` in `main.js:445-448` with a seeded LCG held in `s.rng`, reseeded in `reset()`.
- [ ] Add `export const ROOM = { half: 4.8, wall: 5.5 }` to `src/tuning.js`. Use it in `brain.js:36`, `scene.js:122`, `terrain.js:45-48`, and the prompt text at `brain.js:205`.
- [ ] Load `qa.js` and bind the R and P keys only when the URL has `?dev`. The gate adds `?dev` to its URL.
- [ ] Replace the help line with the real controls after Task 16.
- [ ] Run `npm test`. Commit.

---

## Phase 1: remove the drags

### Task 5: Thumb clears the floor

**Files:**
- Modify: `main.js:239-263` (fold), `main.js:326-337` (arc), `main.js:352` (ALOFT), `src/tuning.js:96`
- Test: gate scenarios `steadyW`, `trot`, `runFast`

**Blocked by:** Task 3.

**Interfaces:** `C.FOLD_K` becomes per digit: `C.FOLD = { thumb: 0, index: 0.6, middle: 0.6, ring: 0.6, pinky: 0.6 }`. `calib.aloft[f]` holds a checked aloft pose.

- [ ] Trace the cause first: `cd .debug/2026-10-09-review/loco-review && node thumbswing.mjs thumb 0.8`. The reviewer saw the CMC pinned at −0.9 and the PIP pinned at 1.75 for the whole swing.
- [ ] Set the thumb fold to 0. Re-run the trace. Expect peak clearance ≥ 0.10.
- [ ] If clearance stays under 0.10, raise the thumb with CMC abduction during swing: add a `yawLift` term to the thumb swing target that moves the tip outward along its lane by up to 0.1 u at mid-swing. Re-measure.
- [ ] Aloft pose: in `calibrate()`, scan `mcp` from −0.15 down to `THUMB_CMC_EXT` and `pip` from 0.9 to 1.6 at the walk pose. Keep the first pose with tip clearance ≥ 0.12 u after `groundConstrain`. Store it in `calib.aloft.thumb`. Throw with the scan table if none passes.
- [ ] Gate: `clearMin.thumb ≥ 0.10` in `steadyW`, `trot`, `runFast`. Remove their allow-list entries.
- [ ] Film: `node scripts/film.mjs --run "__hand.autoWalk(0.8,0)" --view rear --label thumb-after`. Look at it.
- [ ] Commit.

### Task 6: Pivot without the slam

**Files:**
- Modify: `main.js:207-212`, `main.js:407-427`, `main.js:554-581`, `src/tuning.js:168-170`
- Test: gate scenario `pivot180`

**Blocked by:** Task 3.

**Interfaces:** `C.PIVOT_ACCEL` (rad/s²), `C.GAIT_DWELL` (s), `C.MIN_PLANTED = 2`.

- [ ] Ramp the pivot yaw rate: `s.yawRate` moves toward its target by at most `PIVOT_ACCEL · dt`. Start at 8 rad/s².
- [ ] Gait dwell: after a gait change, no second change for `GAIT_DWELL = 0.3` s.
- [ ] Resync on gait change: for every leg set `leg.cycleId = floor(phase · mult + newOffset)` so the new offsets do not open five swing windows at once.
- [ ] Support guard in the leg loop: before `startSwing(f)`, count legs in stance. If the count is `≤ MIN_PLANTED`, defer this swing to the next step. The band-exit rescue path obeys the same guard.
- [ ] Gate: `pivot180` must show `plantedMin ≥ 2` and `bodyBob ≤ 0.04`. Before: 0 and 0.84.
- [ ] Check the pivot still finishes: 180° in ≤ 2.5 s, final heading error ≤ 3°.
- [ ] Commit.

### Task 7: Placed landings and clean hover exits

**Files:**
- Modify: `main.js:326-348`, `main.js:436-440`, `src/tuning.js:93-106`

**Blocked by:** Task 3.

- [ ] Fold profile: replace `Math.sin(Math.PI * t)` at `main.js:336` with a pulse that ends by `t = 0.6`: `t < 0.6 ? Math.sin(Math.PI * t / 0.6) : 0`. The finger is extended for the last 40% of the swing.
- [ ] Horizontal profile: replace the smoothstep at `main.js:329` with an ease-out so horizontal tip speed reaches zero at touchdown: `ease = 1 − (1 − t)³`.
- [ ] Arc peak at `t = 0.4`: `arcH · sin(π · t^0.76)`.
- [ ] Gate: `touchdownSpeed ≤ 0.015` on `steadyW`. Slide must not rise above its baseline.
- [ ] Hover exit: at `main.js:436-440` replace `reseedFeet()` with the aloft-exit path at `main.js:547-553`, so each digit re-plants through a 0.2 s swing. Check max tip travel per step ≤ 0.25 u after `thumbsUp` and `flipBird`. Before: 0.95 and 1.33.
- [ ] Commit.

---

## Phase 2: the Thing look

### Task 8: Posture (stump high, palm nose-down)

**Files:**
- Modify: `main.js:625-850` (`calibrate`), `main.js:213-218`, `main.js:455-461`, `src/tuning.js:126-138`
- Test: `scripts/calib-gate.mjs` (deliberate re-baseline), gate

**Blocked by:** Tasks 5, 6, 7.

**Interfaces:** `calib.posture(u)` returns `{ pitch, h }` for `u` in 0..1, where 0 is the tall strut stance and 1 is the low scuttle stance. `calib.bandsAt(u)` replaces the height-only `bandTable`. `s.postureU` is eased in `step()`.

Evidence that this is a calibration change: with the current solver, all five digits hold bands of 0.51–0.81 u at 34° nose-down with the wrist at 1.2–1.3 u, and at 43° with the wrist at 1.4 u. At 52° the thumb cannot reach the floor. Today's scan stops at 17° and fixes stand height at zero pitch (`main.js:714-781`). Negative pitch is nose-down.

- [ ] Replace the stand-height scan and the pitch scan with one joint scan. For pitch from −0.15 to −0.80 in steps of 0.05, and height from 0.7 to 1.6 in steps of 0.02, compute rests with `restsAt` at that pitch, then `scanBand` for every digit. Record `minBand(pitch, h)`.
- [ ] `restsAt(h)` must pose with the candidate pitch. It poses at zero pitch today (`main.js:697`).
- [ ] Pick three candidates: the tallest height at each of −0.45, −0.60, −0.75 where `minBand ≥ 0.50`.
- [ ] **D1.** Render each: `node scripts/film.mjs --view sideL` and `--view live`, standing and walking at 0.8. Show the three sheets to the owner next to a reference frame. The owner picks the strut posture.
- [ ] Scuttle posture: the scan point with the widest `minBand` at pitch between −0.30 and −0.45. Wider bands give longer strides at speed.
- [ ] `calib.posture(u)` is a straight line between the two points. Sample 9 values of `u`. Store bands per sample. `bandAt(f, h)` at `main.js:223-232` becomes `bandAt(f, u)`.
- [ ] `s.postureU` targets 0 below 1.0 u/s commanded and 1 above 1.6 u/s, linear between. Ease with `RIDE_TAU`.
- [ ] `applyBodyPose` uses `posture(s.postureU).pitch` in place of `C.TUNE.walkPitch`. `rideT` uses `posture(s.postureU).h`. Return the pitch in `calib`. Stop writing `C.TUNE.walkPitch`.
- [ ] Re-check every gesture with `scripts/film.mjs`. Body pitch tracks add to the new base, so `bow`, `sleep`, `idk` may need smaller amplitudes. Belly clearance must hold in `sleep`.
- [ ] Re-baseline: `node scripts/calib-gate.mjs --update`. State the old and new stand height in the commit message.
- [ ] Gate: all Phase 1 bars still pass. Palm pitch in strut ≥ 35°.
- [ ] Commit.

Risk: the thumb is the limiting digit for tall postures. If the owner picks 43° and the thumb band is under 0.5 u after the rests move, drop to the next candidate.

### Task 9: Per-digit homes (pinky outrigger, thumb strut)

**Files:**
- Modify: `main.js:643-710` (lane and rest derivation), `src/tuning.js:110-116`

**Blocked by:** Task 8.

**Interfaces:** `C.HOME = { thumb: { ext, laneBias }, index: …, middle: …, ring: …, pinky: … }`. `ext` is the rest extension as a fraction of reach. `laneBias` is a yaw of the lane about the MCP in radians, positive outward.

- [ ] Today every digit rests at up to `REST_EXT = 0.92` of reach along a lane refined toward the bind direction. That gives the pinky the same forward home as the long fingers.
- [ ] Scan the pinky: for `laneBias` 0 to 0.5 in steps of 0.05 and `ext` 0.80 to 0.95, measure band width at the strut posture. Choose the widest band among cells where the pinky rest lies at least 0.25 u behind the ring rest in hand x. Expect a splayed, nearly straight pinky.
- [ ] Scan the thumb the same way with the rest constrained behind the index MCP line in hand x.
- [ ] Index and middle keep the furthest-forward rests.
- [ ] Film from `top` and `live`. Compare with report section 1, traits 4 to 6.
- [ ] Gate `clickWalk`: pinky `stanceErrMax` ≤ 0.10. Before: 0.47 on a zigzag.
- [ ] Re-baseline calibration. Commit.

### Task 10: Per-digit duty (long fingers stride long, pinky taps)

**Files:**
- Create: `src/gait.js`, `test/gait.test.mjs`
- Modify: `main.js:151-167` (gaitP), `main.js:219-220` (dutyEff), `main.js:268-324` (startSwing), `main.js:504-516` (phase engine), `main.js:554-560` (swing trigger), `src/tuning.js:66-78`

**Blocked by:** Task 9.

**Interfaces:**

```js
// src/gait.js — pure, no three.js
export function digitDuty(len, duty, dutyMin)        // → { [finger]: duty_f }
export function cadence(v, duty, lenMax, util, swingMin, fMax)   // → Hz
export function stanceTravel(v, f, dutyF)            // → u
```

The idea. Today one stride `S = 0.8 · min(band)` serves every digit, so the pinky's 0.47 u usable band sets a 0.376 u stride for all. Instead give each digit a duty in proportion to its band at one shared cadence: `duty_f = D · len_f / len_max`, floored at `dutyMin`. Every digit then uses the same fraction of its own band. The middle finger holds contact for `0.8 · 0.74 = 0.59 u` of travel. The pinky keeps its 0.376 u of contact and spends the rest of the cycle lifted. Cadence at 0.8 u/s drops from 1.66 Hz to about 1.06 Hz. All digits share that cadence, so every digit's step on the floor is `v / f`, which rises from 0.48 u to about 0.75 u. No digit patters.

- [ ] Write the failing tests first:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digitDuty, cadence, stanceTravel } from '../src/gait.js';

const len = { thumb: 0.62, index: 0.66, middle: 0.74, ring: 0.64, pinky: 0.47 };

test('longest digit gets the gait duty, shorter digits scale down', () => {
  const d = digitDuty(len, 0.78, 0.4);
  assert.equal(d.middle, 0.78);
  assert.ok(Math.abs(d.pinky - 0.78 * 0.47 / 0.74) < 1e-9);
});
test('no digit travels past util of its own band in stance', () => {
  const d = digitDuty(len, 0.78, 0.4), f = cadence(0.8, 0.78, 0.74, 0.8, 0.11, 3);
  for (const k of Object.keys(len)) assert.ok(stanceTravel(0.8, f, d[k]) <= 0.8 * len[k] + 1e-9);
});
test('duty floor raises cadence instead of breaking a band', () => {
  const d = digitDuty({ ...len, pinky: 0.2 }, 0.78, 0.4);
  assert.equal(d.pinky, 0.4);
});
```

- [ ] Run `node --test test/gait.test.mjs`. Expect FAIL (module missing).
- [ ] Write `src/gait.js`:

```js
export function digitDuty(len, duty, dutyMin) {
  const max = Math.max(...Object.values(len)), out = {};
  for (const [f, l] of Object.entries(len)) out[f] = Math.max(duty * l / max, dutyMin);
  return out;
}
// zero-slip: every digit's stance travel v·duty_f/f must fit util·len_f. With
// duty_f ∝ len_f the longest digit binds. A floored digit binds harder, so take the max.
export function cadence(v, duty, lenMax, util, swingMin, fMax, floorTerm = 0) {
  let f = Math.max(v * duty / (util * lenMax), floorTerm);
  const cross = (1 - duty) / swingMin;
  if (f > cross) f = v / (util * lenMax + swingMin * v);
  return Math.min(f, fMax);
}
export const stanceTravel = (v, f, dutyF) => v * dutyF / f;
```

`floorTerm` is `max over floored digits of v · dutyMin / (util · len_f)`. Compute it once per gait in `gaitP`.

- [ ] Run the tests. Expect PASS.
- [ ] Wire it in. `gaitP[g]` stores `duty` per digit and `lenMax`. The swing trigger at `main.js:556` compares `p` with that digit's duty. `startSwing` uses that digit's stance time `T = duty_f / f` and swing time `(1 − duty_f) / f`.
- [ ] Per-gait swing window: add `swingMax` to each gait (strut 0.30 s, others 0.20 s). Replace the hard `0.2` at `main.js:277`. A digit whose swing would exceed `swingMax` holds a lifted pose at mid-arc until its landing window. Read `swingHi` in `qa.js` from the gait.
- [ ] Keep `(1 − D) ≤ 0.25` for the four long digits so at least three of them are always planted.
- [ ] Put it behind `TUNE.digitDuty` (default 1, 0 is the A/B control). Run the gate both ways.
- [ ] **D2.** Add three strut offset sets and a dev key to cycle them live:
  - Ripple (today): index 0, ring 0.2, thumb 0.4, middle 0.6, pinky 0.8.
  - Drum roll: pinky 0, ring 0.25, middle 0.5, index 0.75, thumb 0.4.
  - Diagonal pairs: index and ring 0, middle and pinky 0.5, thumb 0.25.
  Film each from `live` and `sideL`. The owner picks. Delete the other two and the key.
- [ ] Gate: step length ≥ 0.70 u, footfalls per u ≤ 7, slide per u ≤ 0.08, `plantedMin ≥ 3` in `steadyW`.
- [ ] Commit.

If the lifted pinky reads as a limp, raise `dutyMin` toward 0.6 and accept a higher cadence. The bars above decide.

### Task 11: Strut and scuttle

**Files:**
- Modify: `src/tuning.js:66-78`, `main.js:417-427`

**Blocked by:** Task 10.

**Interfaces:** gait keys stay `walk`, `trot`, `run`. `walk` is the strut. `trot` and `run` together are the scuttle. `C.SPEED = { strut: 0.7, scuttle: 2.0, sprint: 3.2 }` are the three commanded speeds the command layer uses.

- [ ] Strut: duty 0.78, offsets from D2, `arcH` 0.20, `swingMax` 0.30, strut posture (`postureU` 0).
- [ ] Scuttle: two-beat pairs. Group A index and ring, group B middle and pinky. Thumb aloft with the checked pose from Task 5. Duty 0.60 in trot, 0.50 in run. Scuttle posture.
- [ ] Remove the dead zone between gaits: with the Task 10 law, recompute each gait's `vTop`. Put the strut-to-scuttle shift between 1.0 and 1.3 u/s so `SPEED.strut` and `SPEED.scuttle` sit well inside their gaits.
- [ ] Gate: `gaitShift` has zero frames with fewer than two planted digits and slide per u ≤ 0.08.
- [ ] Film strut at 0.7 and scuttle at 2.0 from `live`. They must read as two different walks.
- [ ] Commit.

### Task 12: Staccato starts, hard stops, still holds

**Files:**
- Modify: `main.js:396-403`, `main.js:288-294`, `main.js:576-578`, `main.js:441-449`, `src/brain.js:86-90`, `src/tuning.js:86-90,152-154`

**Blocked by:** Task 11.

**Interfaces:** `sim.stopAt()` returns the predicted stop point `{x, z}`. `C.STOP_DECEL` (u/s²), `C.STILL_HOLD` (s).

- [ ] Start. On a command from rest, fire a pitch impulse into the stump spring (Task 13) on the same step. The first two digits in gait order start their swings at once. The body follows at `CMD_ACCEL`. Measure time from command to first liftoff. Bar: ≤ 0.1 s.
- [ ] Stop. When the command goes to zero, decelerate at `STOP_DECEL` (start at 8 u/s², the legs' re-step limit decides the final value). Predict the stop point `p = pos + v · |v| / (2 · STOP_DECEL)`.
- [ ] Final footfalls. Every swing that starts or is in flight after the stop command lands on its rest position relative to the predicted stop point and heading. After the body stops, a digit more than `2 · BAND_TIP_ERR` from rest takes one settle swing, at most two digits at a time, in gait order. Then nothing moves.
- [ ] Gate scenario `stop`: `stopSettle ≤ 0.35 s`, then tip motion is exactly zero for 1 s.
- [ ] Still holds. After any stop, no idle starts for `STILL_HOLD = 2.5` s. Replace the continuous `breathe` and `shift` sine idles with twitch idles: 0.15 s move, long still. Keep `breathe` only inside `sleep`.
- [ ] Arrival. In `brain.js:88` remove the `max(0.4, 2·d)` creep. Walk at the commanded speed until `d ≤` stop distance, then stop. Bar: final position error ≤ 0.12 u.
- [ ] Commit.

### Task 13: Body secondary motion and mood

**Files:**
- Modify: `main.js:213-218`, `main.js:338-347`, `main.js:455-467`, `src/tuning.js`

**Blocked by:** Task 12.

**Interfaces:** `s.spr = { pitch, roll }`, each `{ x, v }`, integrated in `step()`. `sim.mood = { tempo: 1, height: 0, tremor: 0 }`. `sim.onPlant(cb)` fires `cb(finger, worldPos)` when a swing lands (`main.js:338-341`). Props use it later.

- [ ] Two damped springs for pitch and roll offsets. Stiff and slightly under-damped (ζ about 0.6) so a stop gives one small nod. Add their outputs in `applyBodyPose`.
- [ ] Impulses: each footfall kicks pitch by an amount that scales with step length and roll toward the landing side. A start kicks pitch nose-down. A stop kicks it nose-up. Landings from a jump kick height down, which gives the squash in trait 9.
- [ ] Lean: pitch offset proportional to forward acceleration, roll proportional to yaw rate. Clamp each to 0.08 rad.
- [ ] Weight shift: move the body up to 0.05 u toward the centroid of planted feet, eased at 5 per second. The sibling does this at `procedural-hand-animation/main.js:706-718`.
- [ ] Bob: ride height drops 0.012 u per lifted digit. Bar: `bodyBob` between 0.01 and 0.03 in strut, under 0.015 in scuttle. The body rides level, per trait 7.
- [ ] Mood: `tempo` scales commanded speeds and swing times. `height` offsets `postureU`. `tremor` adds a 12 Hz roll jitter of that amplitude. Gestures and the brain set mood. Nervous is high tremor and low height.
- [ ] Stance yaw glance: test a body heading offset of ±0.06 rad at rest. If no digit re-swings, expose it as a `look` track for idles. The old ±0.25 rad attempt forced re-steps (`src/gestures.js:18-20`). If ±0.06 also forces re-steps, drop this step.
- [ ] Gate: every Phase 1 and Phase 2 bar still passes with springs on. Slide must not rise.
- [ ] Film the full set and show the owner: start, strut, scuttle, stop, pivot. Ask D4.
- [ ] Commit.

---

## Phase 3: control feel

### Task 14: One command layer

**Files:**
- Modify: `src/brain.js:120-133`, `src/brain.js:222-253`, `main.js:476-477`
- Create: `test/brain.test.mjs`

**Blocked by:** Task 4.

**Interfaces:**

```js
brain.command(plan, { source })   // source: 'key' | 'click' | 'voice' | 'auto'. Returns false if refused.
brain.cancel()                    // stops the plan and zeroes the walk command
```

Priority: key > click > voice > auto. A lower source never replaces a running higher one inside 0.5 s of its last input. Any user source cancels `auto`.

- [ ] Write `test/brain.test.mjs` on a mock sim object with `autoWalk`, `gesture`, `jump`, `pivot`, and `s`. Tests: a click plan replaces an auto plan. An auto plan does not replace a click plan. A stale voice reply is dropped. Status returns to `idle` after a say-only reply and 3 s after an error.
- [ ] Run. Expect FAIL.
- [ ] Add a generation counter to `ask()`: increment on entry, drop the reply if the counter moved. The sibling does this at `procedural-hand-animation/src/voice.js:207`.
- [ ] Status recovery: return to `idle` when speech ends, and 3 s after `error`.
- [ ] Sim-level room clamp in `step()` after the position integrate, using `C.ROOM.half`. QA sets `TUNE.roomClamp = 0` for its scenarios.
- [ ] Run. Expect PASS. Run the gate. Commit.

### Task 15: Click-to-walk

**Files:**
- Create: `src/input.js`
- Modify: `main.js:63-69`, `src/scene.js`

**Blocked by:** Tasks 11, 14.

**Interfaces:** `initInput({ renderer, camera, sim, brain, scene })`.

- [ ] Port the ground raycast and fading ring marker from `procedural-hand-animation/main.js:78-100`.
- [ ] Distance sets the gait: target under 2.5 u away uses `SPEED.strut`. Further uses `SPEED.scuttle`. A second click within 350 ms uses `SPEED.sprint`.
- [ ] The click calls `brain.command([{ do: 'walkTo', x, z, speed }], { source: 'click' })`.
- [ ] A click while walking retargets without a stop when the new bearing is within 0.35 rad of the heading.
- [ ] Test on the gate with synthetic pointer events: three clicks, final position error ≤ 0.12 u each.
- [ ] Commit.

### Task 16: Direct keys

**Files:**
- Modify: `src/input.js`, `index.html:23`

**Blocked by:** Task 15.

- [ ] WASD and arrows give a camera-relative direction. The fixed camera makes screen directions stable: screen-right is +x −z (`src/brain.js:206`).
- [ ] While a direction is held, command a carrot: `walkTo` a point 1.5 u ahead in that direction, refreshed each 0.1 s, `source: 'key'`. Keys and clicks then share the turn policy and stop planner.
- [ ] A tap shorter than one stride time still takes one full step. Release stops with the Task 12 planner.
- [ ] Shift held uses `SPEED.scuttle`. Space jumps. Q and E pivot 45°.
- [ ] Keys 1 to 0 play gestures. Show the bindings in a small on-screen legend.
- [ ] Keys are ignored while the text box has focus.
- [ ] Update the help line in `index.html`.
- [ ] Commit.

### Task 17: Turn policy

**Files:**
- Modify: `src/brain.js:75-87`, `main.js:411-414`, `src/tuning.js:81-84`

**Blocked by:** Tasks 6, 12.

Walk-and-turn scrub is the oldest open item. Total scrub over a turn does not depend on yaw rate, and the ±0.3 rad finger yaw cone is the binding limit. The plan routes around it.

- [ ] Stop, pivot, go. Lower the auto-pivot threshold at `brain.js:79` from 1.0 rad to 0.35 rad. This is also the staccato behaviour in the reference.
- [ ] Arc budget. Under way, cap yaw rate so a planted foot sweeps at most 0.1 rad per stance: `yawMax = 0.1 · f / duty`. Small corrections stay smooth. Large ones go through the pivot.
- [ ] Gate `clickWalk`: slide per u ≤ 0.15. Gate `turnCycle`: record the new value. Remove it from the allow-list only if it passes.
- [ ] Commit.

### Task 18: Voice on a static site

**Files:**
- Create: `src/voice.js`, `src/llm.js` (ported from the sibling)
- Modify: `src/brain.js:193-290`, `main.js:71-106`

**Blocked by:** Task 14.

**Interfaces:** `brain.ask(text)` tries, in order: rules parser, local Gemini proxy if present, in-browser LLM if loaded. Each returns a plan for `brain.command(plan, { source: 'voice' })`.

- [ ] Port `parse()` and question routing from `procedural-hand-animation/src/voice.js`. Map its actions to this repo's plan actions. Port the tests that do not depend on the sibling's `Brain` class.
- [ ] Proxy detect: on load, `POST /llm` with an empty body. A JSON reply means the dev server is there. Use Gemini and server TTS. Any other reply means static hosting.
- [ ] In-browser LLM: port `src/llm.js`. Pin the import to an exact `@mlc-ai/web-llm` version. Look up the current version and check that it loads before writing it in. Vendor the bundle if the pinned CDN path does not support import maps.
- [ ] Ask before the download. Show the size (about 340 MB for Qwen3 0.6B). No download starts on the first mic press without a yes.
- [ ] No WebGPU: say so in the status line and keep the rules parser and text box working.
- [ ] Small-model schema: the 0.6B model gets the sibling's reduced step list, not the full Gemini prompt. Map: go to named spot, gesture name, turn, jump, answer enum.
- [ ] Speech on static hosting: `speechSynthesis`. Server TTS stays for local use.
- [ ] Unknown plan actions show an error. They are never skipped without a message.
- [ ] Test on a plain static server (`python3 -m http.server`): typed "wave", "go to the step", "turn around", and a yes or no question each move the hand with no proxy.
- [ ] Commit.

### Task 19: Ship to the website

**Files:**
- Modify: `/Users/joshtaylor/CodingProjects/personal-website/scripts/build-demos.mjs:18,24`, `/Users/joshtaylor/CodingProjects/personal-website/src/content/projects/hand-walker.md`

**Blocked by:** Tasks 1–18. **D3.**

- [ ] `npm test` is green at 120 Hz and 60 Hz.
- [ ] Set `SOURCES['hand-walker']` to `'hand-walker'`. `STATIC_KEEP` is `['index.html', 'main.js', 'src', 'vendor', 'assets']`. `qa.js` is not shipped.
- [ ] Rewrite the project page text. It describes WASD and drag-to-lead from the July build.
- [ ] Build, serve `public/` locally, and test click, keys, typed text, and one emote in Chrome and Safari.
- [ ] Ask the owner. Push only on a yes.

---

## Phase 4: interactions and emotes

Source: `docs/research/interaction-ideas.md`. The research found seven of the top twelve ideas need no new system beyond the anchor pattern.

### Task 20: Prop registry and the `use` action

**Files:**
- Create: `src/props.js`, `test/props.test.mjs`
- Modify: `src/brain.js:44-118`, `main.js` (per-step `props.update`), `src/input.js`

**Blocked by:** Tasks 13, 15.

**Interfaces:**

```js
// a prop declares:
{ id, label, aliases, anchor: {x, z}, facing, prep, gesture, fireAt, event, state,
  reaction, sense(hand, plants, landed), cooldown, remote, idleWeight, mesh }
props.register(def)
props.update(dt, hand, plants, landed)      // sensed props. Reads hand state, never writes it
props.fire(id, event)                        // the prop animates itself and changes its state
// brain action:
{ do: 'use', target: id }   // expands to walkTo anchor → turn to facing → prep → gesture → fire at fireAt → reaction
```

- [ ] `use` watches `sim.s.gesture.t / sim.s.gesture.dur`. It calls `props.fire` once when progress crosses `fireAt`. A cancelled gesture fires nothing.
- [ ] Clicking a prop mesh runs `use`. The LLM room map and state line are built from the registry, with each prop's `state`.
- [ ] Add a `TIMEOUT.use` sized from walk distance plus gesture duration.
- [ ] Tests: `use` expands to the right plan. The event fires once at `fireAt`. Cancel before `fireAt` fires nothing.
- [ ] Commit.

### Task 21: Port ball, bell, rug

**Blocked by:** Task 20.

- [ ] Copy `stepBall`, `stepBell`, and their tests from `procedural-hand-animation/src/objects.js` and `test/objects.test.js`. Register each as a sensed prop.
- [ ] The bell needs the `landed` flag from the touchdown branch at `main.js:483-486`.
- [ ] Port the `chase` and go-to-object behaviors as plan actions.

### Task 22: Light switch

**Blocked by:** Task 20.

- [ ] Low switch first, at skirting height. Walk to anchor, face it, jab with the index (`point` with a harder `mcp` punch), fire at the contact frame. This proves every field of the registry.
- [ ] Lighting: tween the hemisphere, key, and ambient lights down together (`src/scene.js:41-54`) and bring up one warm point light so the hand stays visible.
- [ ] Reaction: on lights out the hand freezes one beat, then plays `peek`.
- [ ] Then the wall switch at 1.9 u, flipped by a jump. Measured jump apex puts the wrist at 1.80 u, and the wall is 2.4 u high. It is a sensed prop: it fires when the hand is inside a small radius and above a height threshold. Script a first miss, then a hit.
- [ ] A double snap (Task 23) fires any prop with `remote: true`.

### Task 23: Emote pack one

**Blocked by:** Task 13.

- [ ] Finger snap, single and double, with a synthesised click. The sibling builds its bell sound with WebAudio and no assets (`procedural-hand-animation/src/objects.js:59-83`). Use the same approach.
- [ ] `handSign(extended, roll)` factory from the `thumbsUp` template (`src/gestures.js:124-150`): offered handshake, high five, peace, finger gun, horns.
- [ ] Morse: a function that turns up to six characters into an index `mcp` track shaped like `tap`. New plan action `{ do: 'morse', text }`.
- [ ] Knock on the glass: walk to the front edge, three index raps with sound and a 1–2 pixel camera nudge, then `peek`.
- [ ] Sit back on the stump: a held pose that frees all five digits for acting, per the Wednesday reference. Test whether `body.pitch` plus `body.lift` can hold it. If the pitch limit blocks it (`src/gestures.js:13-15`), build it on roll.

### Later, in ranked order

Thing's box. Cursor awareness with poke escalation. Floor piano (uses `sim.onPlant`). Grab-and-carry (the only port that edits `sim.step` physics, so it goes last). Phonograph and dance. Sulk and ransom note. Chess with cheating. Fetch and deliver (needs a carry attachment).

## Risks

| Risk | Where | What limits it |
|---|---|---|
| Posture change moves every calibrated number | Task 8 | One deliberate re-baseline. Phase 1 bars re-run. Three candidates, so a fallback exists |
| Lifted pinky reads as a limp | Task 10 | `TUNE.digitDuty` A/B. `dutyMin` raises contact time at the cost of cadence |
| Fewer planted digits with lower duties | Tasks 10, 11 | `plantedMin` bar in the gate. Support guard from Task 6 |
| Stop planner strands a foot | Task 12 | `stop` scenario. Settle swings capped at one per digit |
| Body springs add stance error | Task 13 | Slide bar must hold with springs on. Amplitudes clamp at 0.08 rad |
| Walk-and-turn stays red | Task 17 | Routed around with stop, pivot, go. Not promised as solved |
| 0.6B in-browser model plans poorly | Task 18 | Rules parser runs first. Reduced schema. Gemini stays for local use |
| Footfall order has no reference | Task 10 | Owner picks by eye from three live options |

## Not in this plan

- Moving anything into `procedural-hand-animation`. It stays as the donor and the July snapshot.
- Undulating terrain. Both repos found that walkable slopes are not visible at hand scale.
- Finger-to-object grasp physics. Props are staged with walk, pivot, and pose-track gestures. The solver reached only 18 of 53 elevated index targets.

## Self-review

- Every defect in the table maps to a task. Every target-look trait maps to Tasks 8–13.
- Tuned values that only a scan can produce are given as a scan procedure with a start value and a pass bar, not as a guessed constant.
- Names used across tasks: `SIM_DT`, `calib.posture(u)`, `s.postureU`, `C.HOME`, `digitDuty`, `cadence`, `C.SPEED`, `brain.command`, `sim.onPlant`, `props.fire`.
