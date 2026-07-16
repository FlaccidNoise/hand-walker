# Oneshot prompt — paste into a fresh session in a NEW empty directory

Copy the fenced block below. Place `HANDOFF.md` (the companion file) in that same
empty directory first. Then paste the prompt as the first message.

```
You are a senior Three.js / physics-sim engineer who builds browser-only,
no-build-step sims with hand-rolled SI dynamics (no physics engine).

## Context
We're rebuilding a project whose essence was distilled after many iterations: a
severed LEFT hand ("Thing") that walks on its fingertip pads — wrist high,
knuckle-dome up, fingers planted forward of the knuckles as descending
diagonals, thumb wide. Everything math/physics-driven, no keyframes. Built in the
browser with Three.js via an importmap (vendored), no dev build step. After the
locomotion works, the next phase is giving it a brain: voice commands parsed by
an LLM into the hand's existing action interface, a behavior library, then later
grip/manipulation (open doors, turn knobs) — NOT a from-scratch learned
locomotion controller.

## What's been done (the essence is fully captured in one file)
- Read `HANDOFF.md` in this directory FIRST and in FULL. It is the distilled
  rebuild spec: the 10 load-bearing ideas, the anatomy-not-tuning constants, the
  3-layer QA gate (bit-exact calibration snapshot + headless puppeteer matrix),
  the gotchas that cost sessions to discover, and the opinionated next-phase
  plan. Do not start writing code until you've read it.
- Nothing else exists yet — this is an empty directory. You are building from
  zero, licensed to reproduce what HANDOFF.md describes or improve on it, but
  you must NOT break the load-bearing invariants it lists (§4) and must NOT
  "fix" the constants it marks as anatomy (§5).

## Key discoveries (you will get these wrong if not told — they're in HANDOFF.md too)
- The analytic reach chord OVER-PROMISES. Reachability must be measured through
  the REAL IK solver at the walking pose — that's the load-bearing idea. Bands
  are MCP-relative; short-band legs cycle at 2× cadence (patter).
- The 3-stage ground constraint is the uncapped last word; the stepping fold
  blends BEFORE it. Each contact samples the ground at its own world position.
- Swings plan in the HAND frame about the LIVE MCP, arc capped per frame by the
  fold annulus (dMin). Stance pins at the ACHIEVED tip.
- standH is pinned by the shortest digit (pinky) and is accidentally near-
  optimal; step height is at its ~0.24 geometric ceiling, NOT the nominal arcH
  0.30 — accept it, don't chase 0.30. Don't raise PIP max (1.75 rad = anatomy).
- Terrain/undulation is a trap: the walkable range is INVISIBLE and clips at
  ~8° slope. Skip undulation; go straight to obstacle discontinuities (steps,
  ledges). Cut vertical climbing (no grip, world-up is foundational).
- The main loop is wall-clock and NOT bit-exact; the calibration run IS. A no-op
  gate asserts on calibration outputs. reset() must reseed the DIGITS, not just
  the body. Run A/Bs headless (visible chrome throttles rAF).

## Current state
Empty directory with only `HANDOFF.md`. No code, no package.json, no vendored
Three.js yet. The original used the free `generic-hand` GLB from the WebXR Input
Profiles project (Apache-2.0) — you'll need that asset (or a compatible hand
GLB) and a vendored Three.js r174+ with GLTFLoader/OrbitControls/RoomEnvironment
addons under `vendor/`.

## What I need you to do next
1. Read `HANDOFF.md` in full. Confirm the 10 load-bearing ideas and the anatomy
   constants back to me in one tight paragraph so I know you've internalised them.
2. Scaffold the project: package.json (type:module; devDeps: three as a local
   shim or vendored, puppeteer-core, esbuild), index.html with the importmap, and
   the module layout from HANDOFF.md §3. Get a static server rendering a scene
   with the hand model loaded and auto-rigged before anything else.
3. Build in this order, with the QA gates landing as early as feasible:
   scene → rig (auto-rig + standH/SI) → ik (solveLeg + 3-stage constraint) →
   math → main (state, calibrate, applyGait, phase engine, swing planning,
   SI physics, __hand) → qa.js + the two gates (bit-exact calib, then headless
   matrix) → unit tests for math/IK.
   Hold the §4 invariants and the §5 constants exactly. Reproduce the §6
   criteria (slide < 0.5, cross > −0.05, floor ≥ −0.01, tipErrP95 < 0.08,
   swingDur ∈ [0.11,0.20], no towed digit; 9/10 with spam allow-listed).
4. Once the walker passes its gate, begin HANDOFF.md §9 Phase A: Web Speech API
   STT → a small LLM intent parser → structured action struct → the existing
   autoWalk/key interface, plus a behavior library (goto, turnTo, jump, approach,
   rest, wander). No neural net for locomotion. Do NOT start Phase B/C until A
   works end-to-end.
5. Commit with `--no-verify`, no Co-Authored-By trailers.

Start by reading HANDOFF.md and confirming the invariants back to me.
```
