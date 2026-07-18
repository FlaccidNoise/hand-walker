# Handoff — User Feedback Round: Auto-Pivot, Sprint Speed, Procedural Terrain

**Date:** 2026-07-17
**Project:** hand-walker (`/Users/joshtaylor/CodingProjects/hand-walker`)

## Current Task
Live user testing of the pivot/hover/run/obstacle round surfaced 3 real issues (1
was a stale-tab false alarm); all fixed and gated. Next: another live pass —
particularly whether the reversal fix and terrain read right by eye/feel, not just
by probe numbers.

## Completed (this session, 2 commits on top of the pivot/hover/run/obstacle round)
- **Auto-pivot on large course changes**: user reported "turn around and walk back"
  took a slow arc. Root cause was in the EXECUTOR, not the pivot itself — the LLM
  planned the reversal as a single `walk` to a point behind the hand, which steers
  via the walking arc (pivot only ever engages for an explicit `turn` action).
  `brain.js`'s `walk` action now checks target bearing vs heading; if >1 rad it
  brakes to stance, pivots to face it, then walks — one pivot max per action.
  Verified with the user's exact scenario (`forward:3` then `forward:-3`): hand
  returns to exactly (0,0), pivot fires mid-plan.
- **Sprint speed**: user couldn't tell run from walk. `V_MAX` 2.6→3.4 (the leash
  cap only — QA's `runFast` commands 2.5 explicitly and is untouched); SYSTEM
  prompt's top speed tier raised to 3-3.4. Verified: 3.4 u/s reaches cleanly (not
  towed, stance err 0.0335, trot-family), LLM requests 3.4 for "sprint as fast as
  you can" and gait reaches `run`.
- **thumbsUp/thumbsDown "flipped" — investigated, no code change.** Numerically
  re-verified the committed defs: thumbsUp's thumb tip is the highest point of any
  digit, thumbsDown's the lowest. This matches last session's screenshot-verified
  fix. Most likely explanation: the user's open tab predated that mid-session sign
  correction — ES modules don't hot-reload, so a stale tab keeps running the old
  code until refreshed. **If still backwards after a hard reload, the roll-track
  signs in `thumbsUp`/`thumbsDown` need swapping — check live, don't assume.**
- **Procedural low-poly bumpy terrain**: two-octave deterministic value-noise
  heightfield (`OCTAVES` in terrain.js), flat-shaded low-poly mesh + height-tinted
  vertex colors + wide grazing-angle key light + reduced IBL in scene.js. `groundY`
  plane-interpolates over the EXACT triangulation the mesh renders (shared
  cell/diagonal) — feet stand on the visible facets, not an approximation.
  `flatMask` keeps the spawn disc and the +x QA corridor flat (qa.js's forward
  scenarios sweep 10+ units on that lane). Obstacle box unchanged, still inside
  the flat disc.

## Hard-won findings (do not re-derive)
- **Ride height was WORLD-ABSOLUTE, making terrain invisible to the walker even
  once it was visible to the camera.** `rideT` (main.js) targeted `calib.standH`
  regardless of local ground height — the body steadicams at constant world Y over
  bumps while legs silently absorb everything (measured: body Y flat to 3 decimals
  crossing ±0.12u bumps, before the fix). Fixed by adding `groundY(bodyX,bodyZ)` to
  `rideT`, the hover-Y override, and the airborne landing-check threshold — all
  three needed it, missing any one leaves a seam. RIDE_TAU still eases it.
- **The §7 slope trap is a DISPLAY problem, not a geometry problem — solved with
  display tools.** Flat shading alone (single octave, no color) was too subtle to
  read in a screenshot even though the walkability math was already fine. What
  actually worked, in order of impact: height-tinted vertex colors (smoothstepped
  to use LOCAL contrast, not just global min/max), a wider/lower-angle key light
  for long grazing shadows across the whole field (not just the spawn disc), a
  second shorter-wavelength noise octave (relief FREQUENCY, same per-facet slope
  budget), and — biggest single jump — cutting `scene.environmentIntensity` from
  the default full IBL to 0.45 (ambient light was flatly filling every shadow the
  other three techniques were trying to create).
- **Executor-level auto-pivot beats prompt-tuning for "why didn't it turn fast."**
  The SYSTEM prompt already told the LLM the `turn` action pivots — the actual gap
  was that a *reversal* naturally gets planned as `walk` with a negative/behind
  target, a plan shape the prompt never told the LLM maps to a large bearing
  change. Fixing it in the executor (bearing-check + auto-pivot inside the `walk`
  action) covers every plan shape the LLM might produce, not just ones that
  happen to phrase the turn explicitly.
- **Puppeteer/Chrome crashed mid-QA-run once this session** (`CallbackRegistry`
  stack trace, no JS-level error) — a plain infra flake, not a code signal. One
  retry at normal `uptime` load returned the clean baseline. Don't debug code for
  a gate run that shows a raw Node/puppeteer stack trace instead of scenario
  output — just re-run it.

## Verification recipes (unchanged, still canonical)
- Paused deterministic stepping at dt 0.00625 via probe.mjs; sample every 4th step.
- Mid-gesture/mid-motion screenshots: snap.mjs with a ready-wait + paused stepping.
- Gates: `npm run test:unit`, `node scripts/calib-gate.mjs`,
  `node scripts/qa-gate.mjs --repeat 2` (~200 s backgrounded; 7/9 with
  turnCycle ~6.9 and gaitShift ~0.55 red is THE baseline). Check `uptime` before
  trusting a slow/anomalous gate run — see machine-load corruption signature in
  project memory (hand-walker-gotchas.md).

## Pending
1. **Live user re-verification**: does the reversal actually feel snappy now? Does
   the terrain read as bumpy in normal play (not just in a screenshot)? Is 3.4 u/s
   sprint visually distinct enough, or does it need to go higher still?
2. §4.9 separation on SWING LANDINGS only (plumbing ready, unchanged for many sessions).
3. turnCycle (continuous walk-and-turn) is still the one accepted-red QA scenario —
   deliberately untouched; a true fix needs routing large in-motion heading errors
   through the pivot path, not dialing YAW_RATE_MAX further.
4. More/varied obstacles once the single step + bump field are user-validated.

## Relevant Files
| File | Notes |
|------|-------|
| `src/brain.js` | walk action auto-pivot logic; speed tiers; turn timeout |
| `src/tuning.js` | V_MAX 3.4 |
| `src/terrain.js` | OCTAVES, flatMask, vertexH/groundY (shared triangulation) |
| `src/scene.js` | low-poly mesh from vertexH, vertex-color tinting, light/IBL tuning |
| `main.js` | rideT/hover-Y/landing-check all terrain-relative now |
| `src/gestures.js` | thumbsUp/thumbsDown defs — re-check live if user reports flipped again |

## Voice (added 2026-07-18)
- Gemini TTS (`gemini-3.1-flash-tts-preview`) via `POST /tts` in serve.py; browser
  decodes raw s16 **little-endian** PCM (the `audio/l16` mime lies — verified by
  waveform-smoothness comparison, 568 vs 14122 mean|Δ|) into an AudioContext.
- Persona = `TTS_VOICE ('Charon')` + `TTS_STYLE` (British-butler style directive)
  at the top of brain.js's speak section — the two dials for changing how he
  sounds. Errors surface in the status bar then fall back to speechSynthesis.
- User has NOT yet judged the actual sound — voice choice may need iteration
  (other male-leaning prebuilts to try: Puck, Fenrir, Enceladus, Iapetus).

## Context & Warnings
- Dev server needs `GEMINI_API_KEY` in env (`source ~/.zshrc` first); `/llm` and
  `/tts` 503 visibly without it. Models: gemini-2.5-flash for planning (3.5-flash
  leaks thinking text), gemini-3.1-flash-tts-preview for voice.
- Verify HEADLESS only; check `uptime` before trusting any qa-gate numbers.
- ES modules don't hot-reload — a live browser tab can run stale code indefinitely;
  when a user reports a visual bug already fixed in source, ask for a hard reload
  before re-investigating.
- Commits: `--no-verify`, no Co-Authored-By, one commit per verified milestone.
