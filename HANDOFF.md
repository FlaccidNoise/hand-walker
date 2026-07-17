# Handoff — Nimble+Emotive Session: Pivot, Hover Gestures, Run, Obstacles

**Date:** 2026-07-16
**Project:** hand-walker (`/Users/joshtaylor/CodingProjects/hand-walker`)

## Current Task
All four asks from the nimble+emotive round are SHIPPED and gated: pivot-in-place
turning, hover gestures (thumbsUp/thumbsDown/flipBird), brain-side run, obstacle
terrain. Next: user feel pass in the live browser (talk to it — everything routes
through voice/typed commands now; direct control was removed last session).

## Completed (this session, 4 commits on top of the Phase A brain)
- **Pivot-in-place** (`sim.pivot(deg)`, keys: none — brain-only): 90° in ~1.0 s,
  180° in ~1.7 s, zero net translation. Yaw controller decoupled from the
  cmdSpeed>V_MOVE steering gate; `startSwing` grew a pivot branch that targets the
  REST foot rotated to the predicted touchdown heading (the translation drift-
  compensation formula's lane clamp saturates under fast yaw). `PIVOT_GAIN/
  PIVOT_YAW_MAX(2.2)/PIVOT_DONE_EPS` in tuning.js. brain `turn` action now pivots.
- **Hover gestures** (`hover: true` defs in gestures.js): whole hand lifts
  (`body.lift` track drives Y directly), 4 digits fist + 1 extended, ~1.4 rad ROLL
  reorientation, explicit replant on end. `s.hovering` is derived state, NOT
  `s.airborne`. All five digits ride the existing gestureDigitPose path.
- **Run via brain**: SYSTEM prompt documents speed tiers (0.8 relaxed default /
  1.5 jog / 2.2-2.5 run) matching real gait vCaps; walk-action default lowered
  1.2→0.8. Verified: "run as fast as you can" → walk→trot→run transition at 2.5 u/s.
- **Obstacle terrain**: `OBSTACLES` box-field in terrain.js (exported; scene.js
  renders a real mesh per box — an invisible obstacle is the §7 "invisible gym"
  trap). One step at x[-0.4,0.4] z[2.0,2.8] h=0.12, OFF the +x lane qa.js scenarios
  sweep. Ceiling scanned: ≤0.14 walks clean (silently absorbed by leg IK, no body
  response), 0.15 hard-stalls at the leading edge.

## Hard-won findings (do not re-derive)
- **Pivot needed TWO fixes beyond the obvious controller**, found via probe, in order:
  (1) cadence-vs-yawRate self-cancellation — cadence ∝ yawRate makes sweep-per-stance
  (yawRate × stance duration) INVARIANT to the chosen max rate, always landing at the
  ~0.3 rad anatomical wall (measured at both 0.3 and 1.6 rad/s); (2) gait selection
  keyed only on cmdSpeed left cadence saturated at walk's fMax=3.0 — while pivoting,
  gait demand is now `|yawRate|·rFoot`, which upshifts through trot/run and halves
  the error. QA's own "towed" bar (err>0.15 sustained >0.5 s) is the pass criterion:
  false for 90° and 180°. Instantaneous max err ~0.25 during a fast pivot is normal.
- **Hover roll-not-pitch**: pitch is the middle axis of the body's YZX Euler order
  (gimbal-locks at ±90°) — and a 1.4 rad pitch flipBird also just LOOKED wrong
  (hand bunched sideways). Roll reads clean for all three. thumbsUp roll sign is
  NEGATIVE (-1.4; positive rolls the thumb down — caught by screenshot).
- **QA corruption signature — recognize before debugging**: if a qa-gate run shows
  first-repeats-at-baseline + later-measurements-catastrophic (slides 5-17,
  errP95 in whole units) + runtime ~3× normal (577 s vs 197 s), CHECK MACHINE LOAD.
  Load 12/12 cores collapsed headless fps; the live loop's dt cap (1/30 wall) can't
  keep sim dt under the support spring's ~8 ms explicit-Euler stability cliff below
  ~95 fps. Verify with the fixed-dt paused-stepping probe (immune to fps), then
  re-run the gate at normal load. This burned ~30 min this session; the deterministic
  replication of every failing scenario was clean and the re-run was exact baseline.
- Obstacle placement matters for QA hygiene: qa.js's forward scenarios sweep +x
  10+ units from origin — anything on that lane silently contaminates the
  flat-ground baseline.

## Verification recipes (unchanged from prior sessions, still canonical)
- Paused deterministic stepping at dt 0.00625 via probe.mjs; sample every 4th step.
- Mid-gesture/mid-motion screenshots: snap.mjs with a ready-wait + paused stepping.
- Gates: `npm run test:unit`, `node scripts/calib-gate.mjs`,
  `node scripts/qa-gate.mjs --repeat 2` (~200 s backgrounded; 7/9 with
  turnCycle ~6.9 and gaitShift ~0.55 red is THE baseline).

## Pending (priority order)
1. **User feel pass**: pivot speed feel, hover gesture look in motion, obstacle
   discoverability ("walk right and climb the step"), run responsiveness. All
   tunable in tuning.js (PIVOT_*) and src/gestures.js (hover defs).
2. §4.9 separation on SWING LANDINGS only (plumbing ready: `opts.sepBias`, `d.yawZSign`).
3. turnCycle continuous walk-and-turn is STILL the accepted-red scenario — the pivot
   is a different interaction and deliberately did not target it. A future idea:
   route large heading errors at low speed through the pivot path automatically.
4. More obstacles / an obstacle course once the single step is user-validated.

## Relevant Files
| File | Notes |
|------|-------|
| `main.js` | pivot controller + startSwing pivot branch; hovering() + hover physics/replant |
| `src/gestures.js` | hover defs (FIST/HOVER_LIFT), authoring rules incl. roll-not-pitch |
| `src/tuning.js` | PIVOT_GAIN / PIVOT_YAW_MAX / PIVOT_DONE_EPS |
| `src/terrain.js` | OBSTACLES box-field (exported to scene.js for meshes) |
| `src/brain.js` | turn→pivot, speed tiers, hover-gesture vocabulary + flipBird guardrail |
| `qa.js` / gates | untouched — flat-ground baseline preserved |

## Context & Warnings
- Dev server needs `GEMINI_API_KEY` in env (`source ~/.zshrc` first); `/llm` 503s
  visibly without it. Model: gemini-2.5-flash (3.5-flash leaks thinking text — see memory).
- Verify HEADLESS only; check `uptime` before trusting any qa-gate numbers.
- Commits: `--no-verify`, no Co-Authored-By, one commit per verified milestone.
