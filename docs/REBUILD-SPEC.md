# Hand Walker — Rebuild Spec & Handoff (distilled from essence)

**What this is:** everything a fresh session needs to rebuild the hand walker
from scratch in an empty directory — the load-bearing ideas, the invariants that
must not be broken, the constants that are anatomy not tuning, and the gotchas
that cost real sessions to discover. It is *distilled*, not exhaustive; the goal
is "what we have, or better," not a line-for-line copy.

**Date:** 2026-07-15  ·  **Companion:** `ONESHOT.md` (the launch prompt to paste
into the new session).

---

## 1. The goal

> "The world's greatest physics/physio-driven walking hand simulation, by a huge
> margin." A **left severed hand** ("Thing") walking on its fingertip pads —
> wrist high, knuckle-dome up, fingers planted forward of the knuckles as
descending
> diagonals, thumb wide. **Everything math/physics-driven; no keyframes, no
> physics engine.** Built in the browser with Three.js, no dev build step.

The next phase (§9): give it a little brain — commands via voice, a behavior
planner, and eventually learned manipulation skills (open doors, turn knobs).

## 2. Hard constraints

- **Browser-only.** Plain ES modules, served by `python3 -m http.server`. No
  bundler, no Node runtime in the artifact. Three.js via an importmap pointing
  at vendored `vendor/three.module.js` + `vendor/addons/`.
- **No physics engine.** All dynamics hand-rolled in SI units.
- **No build step is required to run** (`index.html` loads `main.js`). A build
  step exists only to produce a *single self-contained HTML artifact*
  (`scripts/build-artifact.py`, esbuild bundles `main.js`; the GLB is embedded as
  base64 so strict CSPs can't block it).
- **Determinism is sacred.** Calibration runs at fixed `dt=0.05` with no wall
  clock → genuinely bit-exact. The main loop uses wall-clock dt and is *not*
  bit-exact (±0.01). A no-op gate must assert on calibration outputs, not matrix
  metrics.

## 3. Layout (the shape to reproduce)

```
main.js        sim core: state, gait engine, calibration, input, main loop, __hand
src/tuning.js  EVERY constant (TIME_SCALE, MASS, MU, F_DIGIT*, SPEED, GAITS,
               TUNE, LIMITS, NEIGHBORS, HANDEDNESS) — single source of truth
src/math.js    wrapAngle, dampAngle, segDist/segAngle (pure, no sim state)
src/ik.js      solveLeg, tuckLeg, padReach/padHeight, foldAnnulus-related math
src/rig.js     GLB load + auto-rig → legs/standH/SI constants (instance-ready)
src/skin.js     skinMat + bakeSkinTexture (bind-pose → UV texture) + noiseTexture
src/scene.js    renderer/scene/camera/controls/lightRig/ground + rebuildGround
src/terrain.js  groundY(x,z) — the ONE place the floor shape is expressed
src/debug.js    DebugDraw (3D line/point/arrow overlay)
qa.js          dev-only harness (STRIPPED from the artifact build)
test/          unit tests (math, ik) + calibration.snapshot.json
scripts/       calib-gate.mjs, qa-gate.mjs (headless puppeteer), build-artifact.py
```

## 4. The load-bearing ideas (miss one and the rebuild fails)

1. **Auto-rig from the WebXR `generic-hand` GLB** (Apache-2.0, immersive-web
   webxr-input-profiles). The GLB ships a flat 25-joint tracking skeleton.
   At load: reparent joints into kinematic chains (wrist→metacarpal→3
   phalanges→tip), derive a per-digit **world curl axis** (`axisW`), reach,
   fingertip flesh radius (max radial distal/tip-weighted vertices from the
   bone axis), stance height, and foot rest positions — all from the bind pose.
   Mount the model into the "Thing" stance (palm down-back, fingers forward),
   scale so middle-finger reach = 1 world unit. `HANDEDNESS` flips everything;
   left/right auto-derive.

2. **Analytic 2-bone IK per digit in its curl plane** (law of cosines). All joints
   of a digit hinge about the **same world axis** `axisW`, so each bone splits
   into an in-plane part (rotates with curl) and a constant out-of-plane part
   along the axis (`out0`/`out1`/`outLen`). The solver works in plane
   projections and re-adds the out-of-plane offset. **DIP is anatomically slaved
   to PIP** (~0.62·). An **MCP ab/adduction yaw** swings the curl plane through
   the target (solve `dot(axis,t)=outLen`), branch-nearest to current yaw,
   faded out near the knuckle where the lever shrinks. Elbow branch: a
   weight-bearing digit bows its knuckle AWAY from the ground (pick the side
   that puts the PIP higher in world).

3. **3-stage ground constraint is the uncapped last word.** Tip, DIP, PIP knuckles
   must each clear the floor (each carries flesh). Stage 1 rotates about the MCP
   for the worst violation; stage 2 about the PIP for the remainder; stage 3 about
   the DIP as last resort. **The stepping fold blends toward a lifted curl BEFORE
   the constraint** so a folding digit can't be pushed through the floor. Joint
   rate limits (planted ~16 rad/s, swing ~18) cap the solve but never the
   constraint. Airborne legs never tuck below `1.15·standH` (tuck skips the
   constraint). Each contact samples the ground at its OWN world position.

4. **Stance-band calibration at startup — THE load-bearing idea.** The analytic
   reach chord **over-promises**: what a digit can actually HOLD depends on the
   tilt model × elbow branch × joint limits together (the index lands in a
   PIP-pinned "buckle" branch well inside its chord). So scan each leg's foot
   along its lane at the true walking pose (crouch −5%, sag −0.035, walk pitch,
   constant ROLL, FLAT ground) with the **real solver** and keep the contiguous
   window where tip error < 0.025. Bands are **MCP-relative**. A leg cycles once
   per gait cycle only if its band covers the stance demand at top speed/cadence;
   **short-band legs cycle at TWICE the cadence (patter)** rather than pacing
   everyone down. Generalized to a **per-height band table** (25 samples over
   ±0.15, ~25 ms at startup): each landing queries the band at the height the
   foot will actually land at. `TUNE.liveBands=1` default, 0 is the A/B control.

5. **Phase gait engine.** One **global phase** advances at a cadence solved for
   zero foot-slip: stance demand (speed × stance time) must fit the pacer leg's
   calibrated band. Below the crossover `stance = duty/f`; above it the
   `0.11 s` swing floor rules (`f = v/(S + 0.11v)`). Cadence also rises with
   `|yaw rate|` — turning consumes band. Per-leg offsets keep spatially adjacent
   digits **≥0.25 apart in phase** so neighbours never swing toward each other.

6. **Swings plan in the HAND frame about the LIVE MCP** (walk pitch shifts
   knuckles ~0.1–0.2 forward of bind — planning against bind MCP parks short legs
   in the buckle zone). Land half a stride ahead along local velocity, lane-clamped
   (±`reach·0.09`), ordered against neighbours' feet, inside `0.72·padReach` at
   the live height. Arc height per gait, **capped per frame by the fold annulus
   (`dMin`)** so the mid-swing target never enters the unreachable zone (that was
   why swings landed 0.5 short). **Stance pins at the ACHIEVED tip.** Rescue
   swings (start deep behind the band) hold the fold to t=0.55 and take ≥0.16 s —
   breaks the land-short/buckle loop.

7. **Gaits (walk→trot→run) selected by commanded speed, like a dog.** walk
   (duty 0.78, ≤3 Hz, calibrated ripple); trot (duty 0.62, ≤5.5 Hz, two-beat pairs
   {index,ring}/{middle,pinky}, **thumb carried ALOFT** — its band can't service
   trot); run (duty 0.5, ≤7 Hz, ~37% zero-support frames, bounce emerges from the
   support spring). Downshift at the lower gait's `vTop` exactly; upshift at
   `vTop + 0.15` (hysteresis). Aloft legs bear no weight anywhere. **Aloft is only
   active while speed > V_MOVE.**

8. **SI physics.** 0.45 kg, real gravity via the GLB's metric scale (`WORLD_M`,
   1 u ≈ 8.7 cm; `G = 9.81/WORLD_M` — fierce at this scale). Planted digits = a
   stiff damped spring (`SPRING_K/C`, ~critically damped) but the force they
   produce is **capped by real flexor strength** (15 N sustained, 8 N burst, 8 N
   lateral per digit) — landings squash, overloads sag. Locomotion is
   **friction-limited** (μ=1.1, `FhMax = min(μ·N, planted·F_DIGIT_LAT)`,
   `tract` clamps the lateral accel). **No air control.** Jumps are
   energy-based (burst force × push-off stroke × planted count − weight ×
   stroke). Palm bottoms out at `FLOOR_Y` and scrapes with sliding friction.
   `TIME_SCALE=0.75` slows the clock (a hand-sized creature under real gravity
   moves violently fast).

9. **Separation controller.** Angle-gated (`sepAng=0.35` rad) to **genuine
   crossing threats only** — parallel flesh contact between neighbours is
   natural; pushing on it shoves the middle finger across the index.
   `sepSign = +1`. Authority ±0.18 planted / ±0.3 swinging.

10. **Grab-and-carry.** Click the hand: it hangs from the cursor on a stiff damped
    spring (`goAirborne`), physics resumes on release (release mid-motion throws
    it). Steering: left-drag ground = leash (speed ∝ distance, up to 2.6 u/s);
    right-drag orbit; WASD camera-relative; gamepad (full 0..2.6 range → walk
    through run); touch joystick + jump button.

11. **Skin bake.** Tan base, mottle noise, knuckle redness around joints, lighter
    palm, nail beds — baked into the mesh UVs from 3D bind-pose data + joint
    positions at load. ~86 ms one-time long task.

## 5. Constants that are anatomy, NOT tuning — do not "fix" them

| Constant | Value | Why it's fixed |
|---|---|---|
| `LIMITS` | `[[−0.55,1.6],[0,1.75],[−0.35,1.35]]` | anatomical joint ranges. PIP 1.75 rad = 100° (real ~100–110°). `dMin` is downstream of it. |
| `MASS` 0.45 kg, `MU` 1.1, `F_DIGIT` 15 N | — | SI-correct for a real severed adult hand |
| `SWING_MIN` 0.11 s | — | the cadence law, startSwing and QA all share it |
| `sepSign` +1 | — | verified for the angle-gated controller |
| `standH` rule | lowest body height where every digit (incl. thumb) reaches rest ×0.97 | the pinky pins it; **accidentally near-optimal for step height** — see gotcha |
| `TUNE.dMinK` 1.1 / `arcClear` 0.05 | — | load-bearing step-height margins; bind on ~80% of swing frames |

**Step height is at its geometric ceiling (~0.24, not the nominal `arcH` 0.30).**
`arcH` is fiction — it's the *ask*, the annulus is the *cap*. Accept it; don't chase 0.30.

## 6. QA gate (build this early — it's a prerequisite, not a side quest)

- **Unit tests** (`npm run test:unit`, ~1 s): math + IK invariants.
- **Calibration gate** (`npm run test:calib`, ~5 s, BIT-EXACT): dumps
  `standH`/bands/`workC`/`strideMax`/`dMin` (fixed dt=0.05, no wall clock) and
  diffs `test/calibration.snapshot.json`. This is the no-op gate any refactor
  must hold. Re-baseline only deliberately (`--update`).
- **Headless matrix** (`npm test` runs all three, ~115 s, exit 0 = green with
  `spam` allow-listed): puppeteer-core drives `__qa.matrix()` — 10 scripted
  scenarios (steadyW, turnCycle, spam, rest, jumpRest, jumpRun, pulse, trot,
  runFast, gaitShift) with pass/fail vs criteria: slide < 0.5, cross > −0.05,
  floor ≥ −0.01, tipErrP95 < 0.08, swingDur ∈ [0.11,0.20], no towed digit.
- **Metrics to trust:** `lift` and `steps` are stable run-to-run. `slide` is
  **bimodal/noise-dominated** (0.27–0.29 with no rescue swing, 0.32–0.33 when one
  fires) — **check `swingDur` before reading a slide jump as a regression.**
  `spam` is ±0.02 noise. **Run A/Bs headless** — a visible chrome-devtools window
  throttles rAF hard enough to read steadyW slide 0.47 where the gate reads 0.28.
- **Numbers and pixels catch different bugs.** Always also screenshot the debug
  overlay (` key: bones, IK targets, support polygon, forces, the full numeric
  panel) before declaring visual quality.

## 7. Gotchas (each cost a session to learn)

- **`steadyW` is NOT bit-reproducible** — the main loop integrates wall-clock dt.
  Any "bit-exact" claim must be on calibration outputs, not matrix metrics.
- **`reset()` must reseed the digits**, not just the body. The IK picks branches
  relative to the current pose, so digits settle into different attractors
  depending on history — measured ring MCP 0.577 fresh vs 0.691 after a walk,
  enough to swing steadyW slide 1.06 vs 0.33 at amp 0.09. Seed the canonical
  stance pose and re-settle through the real solver, exactly as startup does.
- **`A/B hygiene`:** park the hand (`reset()` + 2.5 s settle) between variants or
  scores are garbage. Always interleave repeats and confirm they score alike.
- **Terrain is a trap.** `terrainAmp` is peak ground deviation (sum of sines, C1).
  The binding limit is **SLOPE not amplitude** (~4° walks, ~8° clips). Worse:
  the gym is **INVISIBLE** — nothing walkable (<8°) is visible and nothing
  visible (≥11°) is walkable; wavelength can't buy round it. **Don't invest in
  undulation.** What reads at hand scale is a **discontinuity** (step/ledge/rock)
  — that's what "climbs objects" meant. Go to obstacles, not height-fields.
- **Vertical climbing = rewrite everything.** World-up is a foundation assumption
  in the IK (plane-coord up, elbow branch), reach/stance/physics. The hand also
  can't grip (abduct ±0.3, thumb ±0.65, no wrist DOF, no opposed-normal force
  closure). **Scope "climbs objects" to surmounting obstacles up to ~knuckle
  height.** Cut vertical.
- **Commit convention:** `--no-verify`, no Co-Authored-By trailers (enforced by a
  user-level PreToolUse guard, not repo hooks).

## 8. What to distill *better* (the rebuild is licensed to improve)

- The module boundaries are already clean — keep them. `main.js` is large (≈1070
  lines); a rebuild may split the gait engine / physics / input into their own
  modules. Do NOT singleton `main.js` state if you ever want twin hands (it's
  currently singleton; `buildRig` is instance-ready).
- `right-hand` and `twin-hands` are cheap follow-ups (URL param / de-singleton).
- Consider a **contact `surface` interface** (point + normal) from day one if
  obstacles are on the roadmap — the flat-ground constraint bakes "ground = y=0"
  into closed-form lift math at three joints per digit; obstacles need it. The
  per-contact ground sampling is already done (each contact samples `groundY` at
  its own position); generalizing to a normal is the remaining gap.
- Keep the **read-only scan** as a permanent dev tool: before any stance/reach
  change, scan candidate values with the real solver. It refuted a predicted 2×
  step-height win in 15 minutes and surfaced a stride win nobody was looking for.

## 9. Next phase — giving it a brain (opinionated recommendation)

The romantic vision is "a neural network that learns behaviors on its own." The
pragmatic path, in order of payoff ÷ risk:

### Phase A — Voice → LLM intent → the action interface that ALREADY EXISTS (build first)
The hand already exposes a clean action surface: `autoWalk(x,z)` sets a velocity
command, gait is selected by commanded speed, `Space` jumps, `reset()`, scripted
views. **You do not need a neural net to drive it.** You need:
1. **STT:** the browser **Web Speech API** (`SpeechRecognition` / `webkitSpeechRecognition`)
   is free, in-browser, no server — well-supported in Chrome/Edge/Safari 14.1+;
   Firefox lags. Use it for "push to talk." (Whisper API as a fallback for
   robustness, at the cost of a network round-trip + key.)
2. **Intent parser:** a small LLM call (or local rules first) maps the utterance
   → a **structured action struct** `{cmd, dir, speed, target, action}` —
   e.g. "walk to the door" → `{cmd:'goto', target:doorPos}`. The LLM is the
   *planner*, not the *controller*.
3. **Behavior library:** scripted primitives the planner composes —
   `goto(p)`, `turnTo(θ)`, `jump()`, `approach(object)`, `rest()`, `wander()`.
   Each maps onto the existing `autoWalk`/key interface. **No training required.**
   This alone delivers "give the hand commands via my voice, interpreted and
   driven by an AI" — and it's all browser-native.

This is the highest-payoff, lowest-risk first step. Ship it before any learning.

### Phase B — Manipulation needs GRIP first, then optionally learning
"Open doors, turn knobs" is **not a locomotion problem and not yet reachable.**
The architecture doc is explicit: this hand has **no opposed-normal force
closure** (fingers abduct ±0.3, thumb ±0.65, no wrist DOF). Before any learned
skill helps, you need:
1. A **grip/contact model** — a way for fingers to wrap an object and exert
   opposed normal force (pinch/grasp), and a contact-normal `surface` interface
   (see §8). This is new mechanics, not learning.
2. Then a **manipulation skill** can be either scripted (closed-loop IK targets
   around a known object — a knob turn is just "orbit the fingers about an axis")
   or learned.

### Phase C — Learned controllers, only where the analytic approach can't reach
Do **not** start by replacing the analytic gait with a neural net. It is already
good, deterministic, and cheap; a learned locomotion controller (DeepMimic-style)
needs a physics engine + GPU training and buys little here. Learning earns its
place selectively, on top of the analytic base as a **residual/low-level skill
policy** for manipulation where closed-form IK genuinely can't reach (contact-
rich, under-actuated grasping). Keep the analytic IK as the scaffold; learn the
residual. Browser-only training is impractical at scale — train off-line (e.g. a
worker or a small MLP exported to ONNX/tfjs), run inference in-browser.

### Recommended sequence
A (voice + LLM planner + behavior library) → grip/contact mechanics + obstacle
surmounting (the real "climbs objects") → scripted manipulation primitives →
(optional) residual learned skill policy for contact-rich tasks. Leave
full learned locomotion off the table.

## 10. Suggested first steps for the fresh session

1. Scaffold: `index.html` + importmap + vendored Three.js; `src/scene.js` with
   renderer/camera/OrbitControls/lightRig/ground; `python3 -m http.server 8741`.
2. `src/rig.js`: load the `generic-hand` GLB, auto-rig, derive legs/standH/SI.
3. `src/ik.js`: `solveLeg` + 3-stage ground constraint; `src/math.js` helpers.
4. `main.js`: state, `calibrate()` (the load-bearing scan), `applyGait`, phase
   engine, swing planning in the hand frame, SI physics loop, `__hand` handle.
5. `qa.js` + the two gates (calib bit-exact; headless matrix). Add the **unit
   tests for math/IK before tuning** — they catch solver regressions the matrix
   can't see.
6. Verify against the criteria in §6. Then start §9 Phase A.
