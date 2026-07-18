# Handoff — Diorama Room, Gemini Voice, Idle Life

**Date:** 2026-07-18
**Project:** hand-walker (`/Users/joshtaylor/CodingProjects/hand-walker`)

## Current Task
Thing is now a diorama pet: fixed camera looking into his room, Gemini British-
butler voice, room-aware voice commands, and a two-layer idle life (micro-idles +
autonomous behaviors: wandering, napping, looking about). All gated and committed.
Next: live user pass on the whole experience — voice sound, room feel, behavior
pacing (BEHAVE_AFTER/GAP), whether idle life reads charming or fidgety.

## Completed (this session, 4 commits)
- **Gemini TTS voice** (55a0175): `/tts` proxy → `gemini-3.1-flash-tts-preview`;
  browser decodes s16 LITTLE-endian PCM (the `audio/l16` mime lies — verified by
  waveform-smoothness A/B) into an AudioContext. Persona = voice `Charon` +
  `TTS_STYLE` British-butler directive (both constants atop brain.js's speak
  section). Fallback to speechSynthesis on error, visibly.
- **Diorama room + fixed camera** (c9abc74): camera fixed at (7.8,5.4,9.4);
  orbit is debug-only (backtick). Room: floor slab + west/north walls + doorway,
  open toward the viewer; step = furniture; bumpy terrain beyond. Walls VISUAL
  ONLY — no sim collision (QA corridor safe); the brain clamps every walk target
  to the room interior instead (`clampRoom`, ROOM=4.8). New `walkTo{x,z}` world
  action; SYSTEM prompt has the room map with named spots AND stable screen
  directions ("screen-right = +x,-z") — the fixed camera's real payoff.
  snap.mjs gained a `live` view (shoots the app's own camera).
- **Idle life** (19a83f0): micro-idles stretch/peek/scratch + a 16 s `sleep`
  gesture (settle + visible breathing; user-invokable "take a nap"). Brain-level
  BEHAVIORS (wandering / looking about / napping in the back corner / fidgeting /
  visiting the step) run through the same executor as voice commands, fire after
  30 s user-quiet + 12 s sim-quiet, show as `idling <name>`, cancel instantly on
  ask(). `brain.behave(name)` is the test hook.

## Hard-won findings (do not re-derive)
- **Autonomous layers must gate on SIM quiet, not just user quiet**: qa-gate
  drives the sim without ever calling ask(), so a user-quiet-only condition
  started behaviors mid-QA-settle (caught before the contaminated run finished,
  gate killed + re-run). `BEHAVE_SIM_QUIET` 12 s > QA's ~5 s max quiet stretch.
  Same class as IDLE_AFTER>rest, one level up. Every future autonomous trigger
  needs this.
- **Per-tick timeouts freeze their budget at action start**: walkTo's timeout
  recomputed from remaining distance shrank while elapsed grew — long slow walks
  died at ~9 s (broke napping). Compute once from initial distance.
- **Normalize LLM plan slips in the executor**: Gemini emitted `{do:'sleep'}`
  (gesture-as-action). run() rewrites any `do` naming a gesture into
  `{do:'gesture',name}` — heals the class for all 14 gestures.
- Gemini TTS PCM is little-endian s16 despite the `audio/l16` label (RFC says
  big) — decided by decoding a real sample both ways (mean|Δ| 568 vs 14122).

## Verification recipes (canonical)
- Paused deterministic stepping at dt 0.00625 via probe.mjs; sample every 4th step.
- `snap.mjs --views live` for the diorama camera; other views reposition as before.
- `brain.behave('<name>')` to force one behavior; `brain.ask('<text>')` for the
  full voice-free loop.
- Gates: `npm run test:unit`, `node scripts/calib-gate.mjs`,
  `node scripts/qa-gate.mjs --repeat 2` (~200 s backgrounded; 7/9 with turnCycle
  ~6.9 + gaitShift ~0.55 red = THE baseline; rest slide must be exactly 0 — it's
  the canary for idle/behavior leakage into the gate). Check `uptime` first.

## Pending
1. **Live user pass**: voice sound (swap `TTS_VOICE`/`TTS_STYLE` in brain.js if
   Charon isn't right; try Puck/Fenrir/Enceladus/Iapetus), behavior pacing
   (BEHAVE_AFTER/BEHAVE_GAP in tuning.js), room look, terrain readability.
2. Room props beyond the step (a rug, a low table to hide under?) — visual only,
   same pattern as walls.
3. §4.9 separation on swing landings; turnCycle continuous-turn (both unchanged,
   long-standing).
4. Possible: behaviors that use the doorway (peek out, half-exit) — needs a
   deliberate exception to the room clamp.

## Relevant Files
| File | Notes |
|------|-------|
| `src/brain.js` | executor+behaviors+clampRoom+walkTo; SYSTEM prompt (room map, directions); TTS speak() |
| `src/gestures.js` | 14 gestures (incl. sleep) + 6 micro-idles |
| `src/scene.js` | room geometry, fixed camera, terrain mesh, lighting |
| `src/terrain.js` | two-octave noise + flatMask (room square + QA corridor) |
| `src/tuning.js` | BEHAVE_AFTER/GAP/SIM_QUIET, IDLE_*, PIVOT_*, V_MAX |
| `scripts/serve.py` | /llm + /tts proxies (GEMINI_API_KEY at launch) |
| `scripts/snap.mjs` | views incl. 'live' |

## Context & Warnings
- Dev server needs `GEMINI_API_KEY` (`source ~/.zshrc` before launch); `/llm` and
  `/tts` 503 visibly without it. Planning: gemini-2.5-flash. TTS:
  gemini-3.1-flash-tts-preview.
- Verify HEADLESS only; ES modules don't hot-reload (stale-tab reports).
- Commits: `--no-verify`, no Co-Authored-By, one commit per verified milestone.
