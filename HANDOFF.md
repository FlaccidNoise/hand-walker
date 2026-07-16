# Handoff — Gesture Vocabulary + Idles Shipped; Next: User Feel Pass / Brain

**Date:** 2026-07-16
**Project:** hand-walker (`/Users/joshtaylor/CodingProjects/hand-walker`)

## Current Task
Gesture vocabulary + idle layer are BUILT (this session). Next: user feel pass on the
10 gestures in the live browser (static-frame look was verified headless; motion feel
was not user-judged), then §9 Phase A brain (STT → LLM intent → `__hand` calls).

## Completed (this session)
- **Pose-track engine** (`src/gestures.js`): gesture = `{ dur, body?{pitch,roll,height},
  splay?{fingers,track}, digits?{f:{base, yaw/mcp/pip tracks, win:[u0,u1]}} }`;
  Track = `[[u,v],...]` smoothstep keys; `osc(cycles,amp,env?)` generates oscillation
  keys. Digit `win` windows let digits join/leave mid-gesture (exit re-plants via the
  existing aloft-exit real-swing path). main.js samples defs generically — no bespoke
  per-gesture code. Defs ARE the tuning (constants moved out of tuning.js).
- **10 gestures** (keys 1-0): yes, no, idk (reworked: 1.1 s, fast-rise/slow-settle,
  pitch-back −0.15, +0.1 rise, thumb flare), wave (finger ripple via windows), laugh
  (height+pitch bounce ×4), bow (+pitch dip + crouch hold), point, beckon, thinking,
  tap (4 verified ground strikes).
- **Idles** (`IDLES` in gestures.js + scheduler in step()): breathe/shift/drum,
  weighted-random after IDLE_AFTER 8 s sim without input, re-fire every IDLE_GAP 5 s
  ±30%; `markInput()` in autoWalk/jump/gesture cancels instantly; real gestures
  replace a running idle. Gated: idles need stance + f===0 + speed ≤ V_MOVE.
- Gesture height now bypasses the RIDE_TAU ease (it smeared the shrug flat); the
  support spring is the physical smoother. `__hand.GESTURES/IDLES` exposed (brain
  phase can enumerate the vocabulary).
- Gates at every milestone: unit ok, calib bit-exact, QA 7/9 baseline
  (turnCycle red-by-choice, gaitShift ~0.55, spam allow-listed).

## Verification Method (NEW — use this)
- **Paused deterministic stepping**: `h.state.paused=true; h.sim.reset(); loop
  h.sim.step(0.00625)`. dt MUST be ≤~0.008: the support spring's explicit-Euler
  damping is UNSTABLE at dt 0.0125 (c·dt/m ≈ 3.2 > 2 — body launches to y≈5 in a
  plain settle). Live headless runs ~120 fps (sim dt ~6 ms), which is why rAF runs
  never showed it.
- **Continuity probe**: step DT 0.00625, sample tips every 4th step (0.025 s sim ≈
  old trace cadence). Yardsticks ON THIS PROBE: walking swing 0.22, approved 'no'
  0.138 (RATE_CARRY digit-raise entry — the dominant term for all digit gestures),
  body-only gestures ≈ 0 (feet pinned). Don't compare against the old "≤0.08" bar —
  different method.
- Snap mid-gesture: pause + step to phase, then screenshot (`snap.mjs --run` with a
  ready-wait loop; snap's --run fires before page ready).

## Key Decisions / Gotchas (this session)
- Track keyframe peaks that must be REACHED need a hold (two keys): tap's
  instantaneous 0.25-rad peaks got rate-clipped and never hit ground; held 0.4-rad
  strokes strike (index stance tip y = pad height 0.0896 — "ground" for strike
  detection, not y≈0).
- Sign conventions: pitch − = stump-up/rear-back (idk), + = dip/bow; digit mcp − =
  lift. walkPitch itself is −0.15.
- IDLE_AFTER (8 s sim) must exceed every QA quiet stretch (rest = 3 s) or idles
  contaminate the gate — checked, safe, qa.js untouched.
- Still true: NO body-heading tracks (refuted, re-swing storm); digit bases stay
  part-curled pip ≥ ~0.5 (rate-cap snap).

## Pending (priority order)
1. **User feel pass** on all 10 gestures + 3 idles live (keys 1-0; idles fire after
   8 s hands-off). Iterate amplitudes/durations in `src/gestures.js` defs only.
2. §4.9 separation on SWING LANDINGS only (plumbing ready: `opts.sepBias`, `d.yawZSign`).
3. Pivot-in-place step pattern for turnCycle.
4. §9 Phase A brain: Web Speech STT → LLM intent → `__hand.gesture/autoWalk/jump`
   (+ TTS — the hand talks back; see memory buddy-goal-and-tooling).

## Relevant Files
| File | Notes |
|------|-------|
| `src/gestures.js` | THE gesture/idle tuning surface: defs + sampler + authoring rules |
| `main.js` | engine integration: gesturePose/gestureDigitPose/poseLeg, idle scheduler in step() |
| `src/tuning.js` | IDLE_AFTER/IDLE_GAP; gesture defs deliberately NOT here |
| `scripts/probe.mjs` | headless eval; use paused-stepping recipe above |
| `scripts/snap.mjs` / `trace.mjs` / `qa-gate.mjs` / `calib-gate.mjs` | unchanged |

## Context & Warnings
- Dev server `python3 scripts/serve.py 8741` serves the LIVE tree — stamp measurements
  with git SHA; never edit sim code while qa-gate runs.
- Verify HEADLESS only (visible Chrome throttles rAF; hidden tabs freeze the sim).
- Commits: `--no-verify`, no Co-Authored-By trailers, one commit per verified milestone.
