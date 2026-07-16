# Handoff — Gestures: Yes / No / I-don't-know

**Date:** 2026-07-16
**Project:** hand-walker (`/Users/joshtaylor/CodingProjects/hand-walker`)

## Current Task
Add three expressive gestures to the walking severed hand ("Thing"): **Yes** (nod), **No**
(head-shake or index-finger wag), **I-don't-know** (shrug). These are the first bricks of
the end goal: an interactive buddy driven by STT→LLM→TTS that gestures and follows
commands. Locomotion is polished and stays untouched except where gestures layer on top.

## Completed (locomotion is in good shape — don't re-litigate)
- **Gesture engine + yes/no/idk** (this session): `s.gesture={name,t,dur}` advanced in
  step(), `__hand.gesture('yes'|'no'|'idk')` + keys 1/2/3, blocked while airborne or
  speed > V_MOVE. Yes = body-pitch bob ×2 (YES_PITCH_AMP 0.16). No = index-finger wag
  (lift to pip 0.5, yaw ±0.28 ×3 via poseLeg, replant via real swing) — the heading-
  wiggle variant was A/B-refuted (see Key Decisions). IDK = rise +0.08 through the
  ride-height spring, pitch back 0.08, index+pinky sepBias splay. All verified: tip
  continuity ≤0.073/frame (swing-normal), snap.mjs visual, unit+calib+qa gates hold.
- Full gait stack: calibrated stance (standH 0.886 tip-toe), walk/trot/run, jumps,
  turning, thumb walks in the 5-leg ripple (aloft in trot/run).
- Solver is exact in-band (one-step target-compensation polish in `src/ik.js`).
- QA: 7–8/9 scenarios median-green (`node scripts/qa-gate.mjs --repeat 2`).
  turnCycle red by choice (feel over metric), gaitShift 0.56 marginal.
- Dev tools: probe/snap/trace/median-gate (see Relevant Files) — use them reflexively.

## Pending (priority order)
1. §4.9 separation done right: bias SWING LANDINGS only (v1 yaw-shove on planted feet
   is A/B-refuted, disabled; plumbing kept: `opts.sepBias`, `d.yawZSign`).
2. Pivot-in-place step pattern for turnCycle (yaw cone ±0.3 bounds sustained rotation).
3. Then Phase A: Web Speech STT → LLM intent → behavior library (docs/REBUILD-SPEC.md §9);
   gestures are the first vocabulary entries.

## Key Decisions
- Gestures should be a **timed pose-script layer** over the standing stance: drive body
  pose offsets (pitch/roll/height/heading wiggle) and optional per-digit pose overrides
  while planted legs keep solving normally (`solveStance` adapts automatically — that's
  how the whole sim works). Expose `sim.gesture(name)`; block/queue while airborne.
- **No-gesture heading wiggle REFUTED** (traced, this session): ±0.25 rad of body
  heading with feet world-pinned drives stance IK err to ~0.06 — past the 0.05 rescue
  threshold — firing real re-swings on every digit (3 swings/leg, netSlide 0.27–0.33).
  It is NOT "small enough for the yaw cones"; it's the same ±0.3 finger-yaw wall that
  keeps turnCycle red. The index-finger wag replaced it: single digit via poseLeg
  (mode 'gesture'), WAG_BASE pip 0.5 (a near-straight base pose at RATE_CARRY 7 sweeps
  too long a lever arc — visible snap), replant through the aloft-exit real-swing path.
- Feel-over-metric is the standing user priority; median gate is the honesty tool.

## Relevant Files
| File | Notes |
|------|-------|
| `main.js` | sim core: makeSim (gait/physics/legs), calibrate(). Gesture layer goes here. |
| `src/ik.js` | solveLeg (+polish), applyCurl, groundConstrain. `poseLeg` pattern in main.js. |
| `src/tuning.js` | every constant; add gesture timings here. |
| `docs/REBUILD-SPEC.md` | the original distilled spec (§4 invariants, §5 anatomy, §9 phases). |
| `scripts/probe.mjs` | headless eval: `node scripts/probe.mjs "<expr>"` — THE metrics path. |
| `scripts/snap.mjs` | headless screenshots → `.debug/*.png` (agent-readable). Visual verify. |
| `scripts/trace.mjs` | per-frame JSONL gait traces + per-leg summaries. |
| `scripts/qa-gate.mjs` | `--repeat N` median gating; `calib-gate.mjs` bit-exact snapshot. |

## Context & Warnings
- Dev server: `python3 scripts/serve.py 8741` (no-cache, threaded; probably running).
- Headless-only verification: hidden Chrome tabs freeze rAF; visible tabs throttle it.
- The no-cache server serves the LIVE working tree — concurrent sessions/agents measure
  each other's uncommitted edits; stamp measurements with git SHA.
- Project memory (`~/.claude/projects/-Users-joshtaylor-CodingProjects-hand-walker/memory/`)
  holds hard-won gotchas (frames, thumb, scrub law, refuted approaches). Read before tuning.
- Commits: `--no-verify`, no Co-Authored-By trailers.
- If gestures change calibration outputs, re-baseline deliberately: `calib-gate.mjs --update`.

## Suggested Next Steps
1. Read this file + `docs/REBUILD-SPEC.md` §4/§5/§9; skim `main.js` makeSim + the
   gesture engine (gesturePose/gesture/wagPose + the 'gesture' leg mode).
2. Phase A (REBUILD-SPEC §9): Web Speech STT → LLM intent → behavior library. The
   action interface already exists: `__hand.gesture/autoWalk/jump`. Start with a
   command grammar mapping intents onto it.
3. Gesture polish if it reads flat in person: amplitudes/durations live in
   `src/tuning.js` (GESTURE_DUR, YES_*, NO_*, IDK_*) — feel-over-metric, snap.mjs first.
