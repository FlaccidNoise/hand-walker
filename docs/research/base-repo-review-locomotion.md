# Base-repo review — locomotion lens

Reviewer: locomotion auditor. Date 2026-10-09.
A = `/Users/joshtaylor/CodingProjects/hand-walker` at `92fe8e7`. B = `/Users/joshtaylor/CodingProjects/procedural-hand-animation` at `952f0ba`.
Both repos read-only. `git status` after the work: A shows only the `docs/research/` that was there before, B is clean.

## 0. Method and fairness

All my numbers come from one probe that treats both repos the same way:
`scratchpad/loco-review/vclock.mjs`. It replaces `performance.now` and `requestAnimationFrame` before any page script runs. Each repo's real main loop then integrates exactly `1/hz` of wall time per frame. Machine load cannot change the result (load was 7 to 25 during the session).

- Both repos are bit-reproducible under this clock. Two runs of `FULL=1 node vclock.mjs <A|B> 120 '{"kind":"steady","v":1.0,"secs":4}'` gave the same md5 per repo.
- Same GLB in both (`md5` of `assets/generic-hand-left.glb` and `assets/hand-left.glb` match). World unit is 0.086 m in A and 0.087 m in B, so lengths compare directly.
- Metric definitions (same code path for both): step length = world distance from the tip at liftoff to the tip at touchdown. Stance slide = net world tip travel between touchdown and next liftoff. Drag = horizontal tip travel while the pad is within 0.02 u of the floor on two successive samples. Clearance = tip joint height minus pad radius.
- Calibration gates, both green: `node scripts/calib-gate.mjs` in A printed `BIT-EXACT` (standH 0.886, strideMax 0.53). In B it printed `bit-identical to snapshot` (standH 0.758, gaitS 0.211).
- Unit tests, both green: A `node --test test/unit.test.mjs` 11/11. B `node --test 'test/*.test.js'` 61/61.

Fairness notes on the supplied scripts:
- `siblab.mjs` measures B on live rAF. B integrates wall-clock dt, and B's gait changes with frame rate (section 1c). Under load siblab puts B in its bad mode. That is unfair to B as a lab number but it is what a 60 Hz visitor sees.
- `siblab.mjs` reports `swingDur` in wall seconds. `gaitlab.mjs` reports sim seconds. Sim time is wall time x 0.75, so siblab over-states B's swing duration by 1.33x against A.
- `siblab.mjs` drives `goto` without a speed, so B never leaves the walk gait (`src/behaviors.js:92`, `main.js:97`). Do not compare it against gaitlab runs above 0.85 u/s.
- `draglab.mjs` and my drag metric both charge one frame of final swing travel to "stance" on each step, and both count the aloft thumb. Treat drag as a symptom metric, not a pass bar.
- A's QA judges slide on every scenario (`qa.js:100`). B's QA judges slide only on `steadyW` (B `qa.js:207`). "A is 7/9, B is 9/10" is not a like-for-like comparison.

## 1. Measurements

### 1a. Straight walk, 120 Hz frames (sim dt 6.25 ms)
Command: `node vclock.mjs <A|B> 120 '{"kind":"steady","v":<v>,"secs":<4|6>}'`

| v (u/s) | repo | gait | steps/s, all digits | finger step length (u) | stance slide per u | mean planted | note |
|---|---|---|---|---|---|---|---|
| 0.4 | A | walk | 4.3 | 0.47-0.50 | 0.078 | 4.18 | thumb clearance 0.035 |
| 0.4 | B | walk | 13.3 | 0.12-0.23 | 0.407 | 3.46 | |
| 0.8 | A | walk | 8.2 | 0.41-0.45 | 0.076 | 3.93 | body y constant (bob 0.000) |
| 0.8 | B | walk | 24.0 | 0.14 (ring 0.29) | 0.234 | 2.28 | four digits patter at 5.3 Hz |
| 1.3 | A | walk | 12.5 | 0.43-0.46 | 0.081 | 3.65 | |
| 1.3 | B | trot | 22.0 | 0.20-0.23 | 0.259 | 1.53 | |
| 1.8 | A | trot | 12.0 | 0.52-0.55 | 0.037 | 2.53 | |
| 1.8 | B | run | 24.5 | 0.19-0.42 | 0.463 | 1.07 | pinky clearance 0.010, 14/14 swings on the floor |
| 2.5 | A | run | 13.3 | 0.70-0.73 | 0.030 | 2.03 | |
| 2.5 | B | run | 24.5 | 0.28-0.55 | 0.412 | 1.07 | pinky towed, stance err p95 0.145 |

A takes steps 2 to 3 times longer at one third of the cadence, with 3 to 14 times less stance slide. This holds at every speed.

### 1b. Click-to-walk, pivots, turns (120 Hz)
Commands: `node vclock.mjs <A|B> 120 '{"kind":"goto","pts":[[1.0,0.3],[3,2],[-3,-2],[0.5,-3]]}'`, `'{"kind":"turn","deg":180}'`, `'{"kind":"turncycle","dirs":[[0.7,0],[0,0.7],[-0.7,0],[0,-0.7]],"each":2.2}'`, `'{"kind":"shift","vs":[0.4,1.0,1.7,2.5,1.7,1.0,0.4,0],"each":1.4}'`

| scenario | A | B |
|---|---|---|
| goto 1.04 u (near hop) | 14 steps, 2.46 s, slide/u 0.258 | 32 steps, 2.19 s, slide/u 0.229 |
| goto 2.7 u | 32 steps, slide/u 0.191 | 85 steps, slide/u 0.220 |
| goto with reversal (7.1 u, 3.6 u) | slide/u 0.573 and 0.707 (auto-pivot) | 0.299 and 0.387 |
| turn 180 in place | 2.28 s, 0 translation, **body y 0.565 to 1.406**, slide total 3.89 | 1.71 s, walks an arc with 0.288 u translation, slide total 0.705 |
| walk-and-turn cycle | slide total 6.52 (1.09 per u) | 4.89 (0.81 per u), ring on the floor in 23/23 swings |
| gait-shift staircase | slide/u 0.058, 1 zero-support frame | slide/u 0.332, 267 zero-support frames, stance slide max 0.307 |

A's slide lead is in straight travel. On short hops with heading changes the two repos slide about the same, and A's pivot is worse than B's arc on slide. A keeps its stride lead everywhere.

### 1c. Frame-rate sensitivity (v = 0.8)
Command: `node vclock.mjs <A|B> <hz> '{"kind":"steady","v":0.8,"secs":6}'` and `'{"kind":"rest","secs":5}'`

| frame rate (sim dt) | A | B |
|---|---|---|
| 144 Hz (5.2 ms) | not run | slide/u 0.268, all digits lift |
| 120 Hz (6.25 ms) | slide/u 0.076, bob 0.000 | slide/u 0.234 |
| 90 Hz (8.33 ms) | slide/u 0.078, bob 0.021 | slide/u 0.393, **ring clearance 0.006, 16/16 swings on the floor** |
| 75 Hz (10 ms) | not run | slide/u 0.510, ring clearance 0.009 |
| 60 Hz (12.5 ms) | **body y 0.826 to 1.705 while walking. At rest body y 0.427 to 6.014, mean planted 0.73** | slide/u 0.415, **ring clearance 0.004, 16/16 on the floor**. Rest is stable |
| 30 Hz (25 ms) | body y to 6.85 | body y 0.395 to 0.904 (bob 0.508), ring lifts again |

A's own note ("unstable when sim dt exceeds about 8 ms") is **confirmed, and the consequence is worse than the note says**. The live loop feeds `min(delta, 1/30) * 0.75` straight into `sim.step` (A `main.js:114-116`). The support spring uses explicit damping with `SPRING_C / MASS = 254.6 /s` (A `src/tuning.js:18-19`, `main.js:463-467`). That is unstable when `dt > 2 / 254.6 = 7.86 ms`. On any 60 Hz display the hand launches itself while standing still. The owner's 120 Hz screen hides it.

B does not blow up, but its walk is frame-rate dependent. At 60, 75 and 90 Hz the ring finger (the only walk pacer) falls into a permanent rescue-swing loop and never leaves the floor. A warm-up walk does not change it (`"warm":0.8` gave identical output). This matches B's own "bimodal slide" and "visible window reads 0.47" notes (B `CLAUDE.md:21-25,36-38`), which blamed noise. It is deterministic. Most public visitors run 60 Hz, so the deployed site drags its ring finger for them.

### 1d. Where each repo drags
Commands: `node trace.mjs <A|B> 120 0.8 <digit>`, `node thumbswing.mjs <digit> 0.8`, `node aloft.mjs <A|B> <v>`

- A thumb at walk: peak clearance 0.035 to 0.047 (other digits 0.21). CMC pinned at its -0.9 limit and PIP pinned at 1.75 for the whole swing. The tip lags its target by up to 0.26 u, touches down at swing phase 0.85, then scrubs about 0.2 u. Swing drag 0.54 to 0.78 u per u travelled.
- A index at walk: PIP rides the 18 rad/s rate cap in the last 30% of the swing. The tip is still moving 0.035 to 0.046 u per frame at touchdown and pins 0.073 u short of its target.
- B middle at walk: the first three swing frames move the tip 0.096 u at clearance 0.000, on a 0.14 u step. B scrapes at liftoff on four of five digits. Swing drag sums to 2.44 u per u against 1.11 for A.
- Both repos: the "aloft" thumb in trot and run has tip clearance 0.000 on 480/480 frames. The pad skims the floor the whole time (A `main.js:352`, B `main.js:765-775`).

### 1e. IK envelope
Command: `node reach.mjs <A|B> <digit>` (real solve stack, body at stand height, 0.05 u grid, cell passes at tip error < 0.025)

| digit | A reachable area (u^2) | B |
|---|---|---|
| index | 0.54 | 0.21 |
| middle | 0.62 | 0.26 |
| thumb | 0.20 | 0.14 |
| pinky | 0.25 | 0.22 |

Calibrated stance bands by each repo's own bit-exact calibration: A 0.53 to 0.80 u. B 0.06 to 0.26 u.

### 1f. B's small bands come from its own cap, not from its solver
Command: `node bband.mjs`. It repeats B's `scanBand` at the walk pose but scans past the `0.72 * padReach` chord limit (B `main.js:286`).

| digit | band B ships | band B's solver holds |
|---|---|---|
| index | 0.06 | 0.42 |
| middle | 0.12 | 0.50 |
| ring | 0.26 | 0.62 |
| pinky | 0.16 | 0.42 |
| thumb | 0.06 | 0.48 |

I then served a patched copy of B's `main.js` from memory (`BPATCH=<K> node vclock.mjs B ...`, repo untouched) with the two `0.72` caps (B `main.js:215`, `:286`) set to K.

| K | walk 0.8 (120 Hz) | walk 0.4 | trot 1.3 | run 2.3 | 60 Hz | 90 Hz | turn cycle |
|---|---|---|---|---|---|---|---|
| 0.72 (shipped) | step 0.14, slide/u 0.234 | 0.407 | 0.259 | 0.41 | 0.415 | 0.393 | 0.81 |
| 0.85 | ring on the floor, 0.597 | - | - | - | - | - | - |
| 1.0 | step 0.32, slide/u 0.105, thumb clearance 0.25 | **0.93** | 0.082 | 0.083 | 0.19 | **0.638** | **1.37** |
| 1.15 | - | 0.138 | 0.078 | 0.109 | **0.805** | **0.773** | **1.55** |
| 1.3 | step 0.38, slide/u 0.404 (pinky 0.137 per stance) | - | - | - | - | - | - |

Lifting the cap gives B steps of 0.32 to 0.39 u and A-class slide in some cells. It also makes other cells worse, and the result flips with K, speed and frame rate. B's gait engine has the reach but not the margin: it paces at 0.9 of the pacer band with no landing margin (B `main.js:391`), and its phase offsets assume the shipped patter assignment (B `src/tuning.js:26-32`). A paces at 0.8 with a 0.03 margin (A `src/tuning.js:50,95`).

## 2. Scores

| # | Item | A | B | Evidence |
|---|---|---|---|---|
| a | Gait quality against the goal | 6 | 3 | A: steps 0.41-0.73 u, slide/u 0.03-0.08 at every speed (1a). Loses points for thumb scrub, pivot bounce, rigid body. B: steps 0.12-0.23 u at 13-24 steps/s, slide/u 0.23-0.46, pinky towed in run, ring on the floor at 60-90 Hz. |
| b | IK solver and calibration, soundness and headroom | 8 | 6 | A: reach area 2.6x B for index, bands 0.53-0.80, lanes, rest extension, thumb pronation and walk pitch all measured through the real solver (A `main.js:625-850`, `src/rig.js:223-314`), solver unit-tested in Node. B: solver holds 0.42-0.62 bands but its scan caps them at 0.06-0.26 (1f). Per-digit `use`, `tilt`, `rest` are hand constants (B `src/rig.js:64-71`). Known dead zone left open (B `plans/README.md` 006). |
| c | Physics, timestep stability, determinism | 3 | 5 | A: diverges at 60 Hz (1c). Pivot produces 19 zero-support frames. But `sim.step(dt)` is public and exact at fixed dt. B: stable 30-144 Hz, gait quality depends on frame rate, `update(dt)` is module-private (B `main.js:556`). Neither has a fixed step. |
| d | Gesture and emote authoring | 8 | 5 | A: declarative keyframe tracks for body pitch, roll, height, lift, splay and per-digit joint angles with windows, plus hover (A `src/gestures.js:57-205`). Can author a fist, thumbs-up, a nap. No tests. B: clips are `t -> {pitch, roll, digits:{lift,lat,foldW}}` (B `src/gesture.js:20-127`). Digits move only through an IK target under the knuckle, lifts must step over a solver dead zone, no fist. Has bounds tests. |
| e | Input and brain architecture | 5 | 7 | A: plan executor with timeouts, visible errors, plan normalisation, auto-pivot, behaviours through the same executor (A `src/brain.js:44-191`). No click, no keys, no grab, no tests. B: `Brain.command/commandPlan/cancel`, rules-first parser, superseded-reply guard, click-to-go, grab, 31 brain tests. Real key presses are blocked (B `main.js:108`). Turns walk an arc. |
| f | Props and interaction extensibility | 3 | 6 | A: one terrain step (A `src/terrain.js:27-29`) and visual-only walls. No prop framework. B: `src/objects.js` with pure, tested `stepBall` and `stepBell`, read-only contract, brain queries. Contact is body-radius only. Neither has a digit-reaches-prop primitive. |
| g | Static-site deployability | 3 | 8 | A: sim is static, but planner and TTS need `POST /llm` and `/tts` on a key-holding server (A `src/brain.js:232,263`). It also fails on 60 Hz screens. B: deployed today. Web-LLM loads from a CDN at run time (B `src/llm.js:23`), rules parser works offline, single-file build exists. WebGPU only for the LLM. |
| h | Code health, tests, QA gates | 5 | 7 | A: 11 solver tests, bit-exact calib gate, trace, snap and probe tools. `npm test` runs only the wall-clock matrix, whose accepted baseline is 7/9, so it exits 1 at baseline (A `package.json:11`, `HANDOFF.md:56-58`). B: 61 tests, `npm test` chains unit, calib and matrix, self-serving harness, decision log. Its judge checks slide on one scenario only, so the towed pinky passes. |

Unweighted totals: A 41, B 47. The verdict below weights (a), (b) and (d) because they are the hard parts to move. (e), (f), (g), (h) are mostly glue. (c) is the same small fix in both.

## 3. Port cost

### (i) Bring A's locomotion core into B

| Item | Size | Risk |
|---|---|---|
| Fixed-step accumulator around `update(dt)` | S | Low |
| Rig bakes: wrist-origin mount, thumb CMC pronation scan, hinge-axis alignment, curl sign, mesh palm depth | M | High. Every calibrated number moves, snapshot re-baseline |
| Solver swap: slaved-DIP solve with bind bends and polish, separate ground constraint | L | High. B's `foldW`, tilt model, crumple, tuck and gesture digit claims all live inside B's `solveLeg` and its `leg.angles[]` record |
| Calibration: stand-height scan, refined lanes, rest extension, lane-centred bands, walk pitch | M | High |
| Gait engine: unwrapped phase, 0.8 band use plus margin, predicted-frame landings, rescue rules, command ramp, ride easing | M | Medium-high |
| Pivot-in-place | M | Medium. B's yaw follows velocity (B `main.js:687`), so it needs a new steering mode |
| Re-author B's 16 clips on the new solver, or port A's gesture engine too | M | Medium |
| Re-baseline matrix, snapshot and every documented number | M | Low |

After the first four rows nothing of B's sim core is left. B's sim is module-level state behind a top-level `await` (B `main.js:29-36,119-141`), so the swap cannot be staged behind an interface. A already has that seam: `makeSim(rig, calib)` returns `{s, legs, step, reset, autoWalk, jump, gesture, pivot}` (A `main.js:136,616`).

A lighter variant exists: keep B's solver and move only A's ideas (lift the 0.72 caps, pace at 0.8 with a landing margin, re-author offsets, fixed step). Size M. Risk medium-high, and the outcome is not known: section 1f shows large gains and large regressions from the first knob alone.

**Riskiest item:** the solver and rig swap under B's gesture, fold and tilt channels. For the lighter variant: gait stability across speed and frame rate after the cap lift.

### (ii) Bring B's product features into A

| Item | Size | Risk |
|---|---|---|
| Fixed-step accumulator in the loop (needed anyway) | S | Low. One `sim.step` costs 0.09 ms here (`node cost.mjs`) |
| Click-to-walk: ground raycast, marker, `brain.run([{do:'walkTo'}])` | S | Low. Camera is fixed and `clampRoom` exists (A `src/brain.js:36-37,92-101`) |
| Direct keys onto `sim.autoWalk`, with `brain.stop()` on key-down | S | Low |
| One command entry (`command`, `commandPlan`, `cancel`, superseded-reply guard) for click, keys, voice | S-M | Low |
| Grab-and-carry: pointer handlers plus a held mode in `sim.step` | M | Medium. A has airborne and hover states that the held state must not fight (A `main.js:432-486`) |
| Props: copy `stepBall`, `stepBell`, `buildObjects`, `updateObjects`, feed `{x,z,vx,vz}` and a landed flag | S-M | Low. The functions are pure and their tests port as written |
| Light-switch style prop: proximity or landing trigger plus animation | S | Low. A true fingertip press needs a digit-reach leg mode (M) in either repo |
| In-browser LLM: copy `src/llm.js`, map its steps to A plan actions, port the rules parser from `src/voice.js`, keep `/llm` and `/tts` as an optional upgrade | M | Medium-high (see below) |
| Missing behaviours: chase, go-to-object, face-camera, look-at, stage | S-M | Low |
| Missing clips (excited, ack nod) and a name map (puzzled to idk, sleepy to sleep, bird to flipBird) | S | Low. A's vocabulary already covers the rest and adds hover gestures |
| Tests: port brain, gesture-bounds and object tests | M | Low |
| Skin bake (`src/skin.js`) and single-file build | M | Low. The bake must run before A's hinge-axis twists (A `src/rig.js:103-119`) |

**Riskiest item:** the voice brain swap. A's planner today is Gemini with a room map, world coordinates, a `say` line and a server TTS voice. A 0.6B in-browser model cannot fill that schema, so on the static site A's voice drops to B's level: rules first, a small fixed step list, yes/no style answers, browser speech. The code is small. The risk is a visible drop in what the owner has in A today, plus WebGPU-only support and a 340 MB download. Grab-and-carry is second.

## 4. Verdict

**Base = A (hand-walker). Confidence about 65%.**

Why:
- The owner's complaints are gait complaints. At a fixed 6.25 ms step A already gives steps 2 to 3 times longer, at a third of the cadence, with 3 to 14 times less stance slide, at every speed from 0.4 to 2.5 u/s. B gives that only in some cells of an untested knob sweep.
- A's hard parts are measured and have margin: solver reach, lane and band calibration, pivot, a step obstacle, joint-angle gesture authoring. B's hard parts are where its history shows knob sensitivity, bimodal results and an unexplained first-walk effect.
- What A lacks is glue with a working reference in B. Each item is small and can be checked alone.
- A's worst defect (60 Hz) is a small fix that also makes A's QA load-immune.

What would change my mind:
1. A one-session spike on B: caps lifted to about 1.0-1.15, pacing at 0.8 with a landing margin, fixed 6.25 ms step. If that holds slide/u at or below 0.1 from 0.4 to 2.5 u/s and from 60 to 144 Hz in `vclock.mjs`, choose B. All product features, tests and the deploy path already exist there. Section 1f says this is possible but not likely to be clean.
2. If the A thumb scrub and the pivot bounce do not yield to the fixes in section 5. Then A's lead is stride length only.
3. If the owner ranks "voice works on the static site this week" above gait. Then B, with no port.
4. If the owner will not accept the voice drop described in 3(ii).

Not confirmed:
- Root cause of B's ring-finger loop at 60-90 Hz. I measured the symptom only.
- Whether `FOLD_K = 0` for the thumb fixes A's thumb clearance. The joint-saturation trace supports it. I did not test it (read-only).
- A's full QA matrix. I did not run it: it uses wall-clock rAF and load was 7 to 25.
- Port sizes are estimates from reading the code.

## 5. Defects in the chosen base (A) that the plan must fix, ranked

| Severity | File:Line | Issue | Fix |
|----------|-----------|-------|-----|
| CRITICAL | main.js:112-117, src/tuning.js:18-19, main.js:463-467 | No fixed timestep. Explicit spring damping is unstable above 7.86 ms sim dt. At 60 Hz frames the hand at rest swings body y 0.427 to 6.014 with mean planted 0.73. At 90 Hz it is marginal (bob 0.021). | Accumulator in the loop: call `sim.step` and `brain.tick` at a fixed 6.25 ms, cap sub-steps per frame. Then drive QA on sim time, not wall time. |
| HIGH | main.js:407-410, main.js:424-427, main.js:554-558, src/brain.js:79-85 | Pivot start: yaw rate jumps to 2.2 rad/s in one step, the gait goes walk to run in two steps, phase offsets change with no resync, all five legs swing at once. 19 zero-support frames, body y 0.565 to 1.406. Hits every `turn` and every walk that auto-pivots. | Ramp the pivot yaw rate. Do not start a swing when planted would drop below 2. Resync `cycleId` on gait change and add a dwell time (B does both at B main.js:381-389, 585-593). |
| HIGH | main.js:245-248, src/tuning.js:32, src/tuning.js:96 | Thumb swing at walk: fold drives PIP to 1.75 and the CMC sits on its -0.9 limit. Peak clearance 0.035-0.047, lands at swing phase 0.85, scrubs about 0.2 u per step. | Per-digit fold (thumb 0) and re-measure with `thumbswing.mjs`. If clearance stays under 0.1, lift the thumb with abduction or body roll. Add per-digit swing clearance to QA. |
| HIGH | src/brain.js:232, src/brain.js:263, scripts/serve.py:41-74 | Planner and voice need a server that holds a Gemini key. On static hosting every command ends in an error status. | Port B's rules parser and Web-LLM path. Keep the proxy as an optional upgrade. |
| MEDIUM | main.js:352, main.js:362-374, main.js:544-545 | "Aloft" thumb in trot and run: tip clearance 0.000 on 480/480 frames. The pad skims the floor above walk speed. | Raise the ALOFT pose until tip clearance is at least 0.1. Add an aloft clearance check to QA. |
| MEDIUM | main.js:326-337, src/tuning.js:6, src/tuning.js:105 | Finger landings: PIP unfold rides the rate cap in the last 30% of the swing. The index tip moves 0.035-0.046 u per frame at touchdown and pins 0.073 u short. Reads as a scuff, not a placed foot. | End the fold by swing phase 0.6, or give the strut a longer swing. Add touchdown speed and landing error to QA. |
| MEDIUM | main.js:296-321, src/tuning.js:82 | Walk-and-turn: 0.05-0.10 u slide per stance, 6.52 u total over four 90 degree turns (B: 4.89). Already red in A's own gate. | Send large heading changes to the fixed pivot. Limit yaw rate by band use. Open design item. |
| MEDIUM | package.json:11, qa.js:16-34, HANDOFF.md:56-58 | `npm test` runs only the wall-clock matrix, and its accepted baseline is 7/9, so the gate exits 1 on good code. Unit and calib gates are not chained. | Chain unit, calib, matrix. Run the matrix on the fixed step. Fix or allow-list the two reds by name. |
| MEDIUM | scripts/serve.py:76, scripts/serve.py:41-70 | Dev server binds 0.0.0.0 and forwards unauthenticated `POST /llm` and `/tts`, with a caller-supplied system prompt, on the owner's Gemini key. Any host on the network can spend the key. | Bind 127.0.0.1. |
| LOW | main.js:445-448 | `Math.random` inside `sim.step` (idle picker). The sim core is not reproducible after 8 s idle. | Pass in a seeded RNG. |
| LOW | main.js:64-69, index.html:23 | No click-to-walk, keys or grab. The help line advertises orbit and grab that do not exist. | Port from B main.js:38-100. Fix the help text. |
| LOW | README.md:44-49, scripts/qa-gate.mjs:10, scripts/calib-gate.mjs:10, scripts/probe.mjs:6 | README documents `CHROME_PATH`. The scripts hard-code the Chrome path. | Read the variable. |
| LOW | main.js:768, main.js:780 | `calibrate()` writes `C.TUNE.walkPitch` into the shared tuning module. Hidden global state, blocks a second hand. | Return it in `calib`. |
| LOW | main.js:42-44 | Calibration blocks startup for 480 ms (measured under load). | Yield before it, or cache the result. |

Style note, not a defect: A's body height is constant to three decimals while walking (bob 0.000). B adds sag per lifted digit, idle bob and weight shift (B `main.js:598-603, 706-718`). Porting that is small and would help "cohesive".

## 6. Probe files

All in `/private/tmp/claude-501/-Users-joshtaylor-CodingProjects-hand-walker/11627a21-df7a-406e-af77-8324ea6f2372/scratchpad/loco-review/`:
`vclock.mjs` (main probe), `trace.mjs`, `thumbswing.mjs`, `aloft.mjs`, `pivot.mjs`, `reach.mjs`, `bband.mjs`, `cost.mjs`. Raw output: `steady120.txt`, `dt.txt`, `nav.txt`, `bpatch.txt`.
