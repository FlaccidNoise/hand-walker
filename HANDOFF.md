# Handoff — Gestures: Yes / No / I-don't-know

**Date:** 2026-07-16
**Project:** hand-walker (`/Users/joshtaylor/CodingProjects/hand-walker`)

## Current Task
Add three expressive gestures to the walking severed hand ("Thing"): **Yes** (nod), **No**
(head-shake or index-finger wag), **I-don't-know** (shrug). These are the first bricks of
the end goal: an interactive buddy driven by STT→LLM→TTS that gestures and follows
commands. Locomotion is polished and stays untouched except where gestures layer on top.

## Completed (locomotion is in good shape — don't re-litigate)
- Full gait stack: calibrated stance (standH 0.886 tip-toe), walk/trot/run, jumps,
  turning, thumb walks in the 5-leg ripple (aloft in trot/run).
- Solver is exact in-band (one-step target-compensation polish in `src/ik.js`).
- QA: 7–8/9 scenarios median-green (`node scripts/qa-gate.mjs --repeat 2`).
  turnCycle red by choice (feel over metric), gaitShift 0.56 marginal.
- Dev tools: probe/snap/trace/median-gate (see Relevant Files) — use them reflexively.

## Pending (priority order)
1. **Gesture engine + 3 gestures** (this session's goal — see Suggested Next Steps).
2. §4.9 separation done right: bias SWING LANDINGS only (v1 yaw-shove on planted feet
   is A/B-refuted, disabled; plumbing kept: `opts.sepBias`, `d.yawZSign`).
3. Pivot-in-place step pattern for turnCycle (yaw cone ±0.3 bounds sustained rotation).
4. Then Phase A: Web Speech STT → LLM intent → behavior library (docs/REBUILD-SPEC.md §9).

## Key Decisions
- Gestures should be a **timed pose-script layer** over the standing stance: drive body
  pose offsets (pitch/roll/height/heading wiggle) and optional per-digit pose overrides
  while planted legs keep solving normally (`solveStance` adapts automatically — that's
  how the whole sim works). Expose `sim.gesture(name)`; block/queue while airborne.
- Candidate motions — Yes: body pitch nod (rock forward/back about the wrist, 2 bobs).
  No: heading wiggle ±0.25 rad ×3 (feet planted — small enough for the yaw cones) OR the
  classic index-finger wag (lift index via poseLeg, wag its yaw). IDK: rise ~+0.08,
  pitch back slightly, splay/lift index+pinky briefly, settle. Verify LOOK via snap.mjs.
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
1. Read this file + `docs/REBUILD-SPEC.md` §4/§5/§9; skim `main.js` makeSim.
2. Build the gesture layer in `main.js`: `s.gesture = {name, t}` advanced in `step()`,
   applying body-pose offsets via `applyBodyPose` inputs + optional `poseLeg` overrides;
   `__hand.gesture('yes'|'no'|'idk')` + keyboard keys (1/2/3) for manual testing.
3. Implement Yes first (pure body pitch bob — no digit work), verify with
   `snap.mjs --run "window.__hand.gesture('yes')"` sequence + a tip-continuity probe
   (no frame-jumps > ~0.08), then No, then IDK.
4. Gate: unit + calib-gate + `qa-gate.mjs --repeat 2` must not regress; commit per gesture.
