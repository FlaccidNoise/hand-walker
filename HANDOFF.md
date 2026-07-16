# Handoff — Gesture Vocabulary Expansion + Idle Animations

**Date:** 2026-07-16
**Project:** hand-walker (`/Users/joshtaylor/CodingProjects/hand-walker`)

## Current Task
Expand the gesture vocabulary toward an interactive buddy (STT→LLM→TTS brain, later
session). New gestures wanted: **wave, laugh, bow, point, beckon, thinking, tap
(impatient)** — plus **idle animations** that play when not interacted with. Aim for
near-full versatility of a human hand; the gesture engine is the substrate.

## Completed
- Gesture engine (f3326f8): `s.gesture={name,t,dur}` in step(); `__hand.gesture(name)`
  + keys 1/2/3; blocked while airborne/moving; body-pose offsets via gesturePose() →
  applyBodyPose (pitch/heading/roll) + ride-height spring (height); per-digit override
  via poseLeg + leg mode `'gesture'` (replants via the aloft-exit real-swing path).
- **Yes** (pitch bob ×2) and **No** (index wag ±0.28 ×3, WAG_BASE pip 0.5) — both read
  well. **IDK** (rise+pitch+splay) works but USER SAYS: too slow, doesn't read well —
  rework it (see Pending).
- Full locomotion stack (walk/trot/run/jump/turn, 5-leg ripple) — don't re-litigate.
- QA baseline: 7/9 required median-green; turnCycle red-by-choice; gaitShift ~0.556.

## Pending (priority order)
1. **Rework IDK/shrug** — feels slow and flat. Try: shorter dur (~1.1 s), snappier
   rise (asymmetric envelope: fast up, slow settle), more pitch-back, maybe a double
   pulse or digit lift (not just sepBias splay). Feel-over-metric; snap.mjs first.
2. **New gestures**: wave, laugh, bow, point, beckon, thinking, tap (impatient).
   Point/beckon/tap are single-digit poseLeg scripts (the "no" wag is the template —
   part-curled base pose, keyframe or oscillate joints). Wave/bow are body-pose
   scripts (the "yes" nod is the template). Laugh = body bounce (height pulses).
   Consider a small keyframe/pose-track format in the engine instead of one bespoke
   function per gesture — 7+ gestures will outgrow hand-written sine envelopes.
3. **Idle animations**: after N s without input, play subtle random idles (breathing
   height sway, finger drum, look-around heading drift, weight shift). Needs an idle
   timer + random picker + instant cancel on any input/command.
4. §4.9 separation on SWING LANDINGS only (plumbing: `opts.sepBias`, `d.yawZSign`).
5. Pivot-in-place step pattern for turnCycle.
6. Then Phase A brain: Web Speech STT → LLM intent → `__hand.gesture/autoWalk/jump`.

## Key Decisions
- Gestures = timed pose-scripts over stance: body-pose offsets absorb automatically
  (planted legs re-solve to world-pinned feet every frame); digits via poseLeg.
  NEVER teleport feet; NEVER body-yaw at stance (see warning below).
- **Body-heading wiggle at stance is REFUTED** (traced): ±0.25 rad drives stance err
  ~0.06 > 0.05 rescue threshold → every digit re-swings. Same ±0.3 finger-yaw wall
  that keeps turnCycle red. Head-shake-style motion must come from a digit instead.
- poseLeg base poses must stay part-curled (pip ≥ ~0.5): near-straight poses at
  RATE_CARRY 7 sweep a long lever arc and visibly snap (measured 0.107u/frame).
- Feel-over-metric is the standing user priority; median gate is the honesty tool.

## Relevant Files
| File | Notes |
|------|-------|
| `main.js` | sim core; gesture engine: gesturePose(), gesture(), wagPose, leg mode 'gesture' |
| `src/tuning.js` | all constants; GESTURE_DUR / YES_* / NO_* / IDK_* at the bottom |
| `src/ik.js` | solveLeg/applyCurl/groundConstrain — poseLeg consumes applyCurl |
| `docs/REBUILD-SPEC.md` | §4 invariants, §5 anatomy (do not "fix"), §9 buddy phases |
| `scripts/probe.mjs` | headless eval: `node scripts/probe.mjs "<expr>"` — THE metrics path |
| `scripts/snap.mjs` | headless screenshots → `.debug/*.png` (Read-able). Visual verify |
| `scripts/trace.mjs` | per-frame JSONL; tip-continuity checks (frame-jump ≤ ~0.08) |
| `scripts/qa-gate.mjs` | `--repeat 2` median gating (~200 s, run backgrounded); `calib-gate.mjs` bit-exact |

## Context & Warnings
- Tree is CLEAN at f3326f8; all gates green at that SHA.
- Dev server: `python3 scripts/serve.py 8741` (probably running; serves LIVE working
  tree — stamp measurements with git SHA).
- Verify HEADLESS only (visible Chrome throttles rAF; hidden tabs freeze the sim).
- Gestures only run at stance (speed ≤ V_MOVE 0.15, not airborne) — idles must obey
  the same gate.
- Project memory (`~/.claude/projects/-Users-joshtaylor-CodingProjects-hand-walker/
  memory/`) holds refuted approaches — trust its "don't do X again" notes.
- Commits: `--no-verify`, no Co-Authored-By trailers, one commit per verified milestone.
- Gate after each gesture: `npm run test:unit`, `node scripts/calib-gate.mjs`,
  `node scripts/qa-gate.mjs --repeat 2` (expect 7/9 + turnCycle/gaitShift as above).

## Suggested Next Steps
1. Read this file, then `main.js` (gesture engine block + step() + poseLeg) and
   `src/tuning.js` gesture constants.
2. Rework IDK per Pending #1; verify with snap.mjs + trace tip-continuity; gate.
3. Design the pose-track format (keyframes over {body offsets, per-digit poses}),
   port yes/no/idk onto it, then add the 7 new gestures on the same rails.
4. Add the idle scheduler (timer + weighted random idle + cancel-on-input); gate.
