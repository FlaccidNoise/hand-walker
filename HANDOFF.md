# Handoff — Phase A Brain Shipped (voice/LLM control); Direct Control Removed

**Date:** 2026-07-16
**Project:** hand-walker (`/Users/joshtaylor/CodingProjects/hand-walker`)

## Current Task
Thing now runs on voice: hold Space → STT → Gemini planner → JSON action plan →
executor. WASD/1-0/Space-jump direct control is GONE — the brain is the only driver.
Next: live user pass on voice quality/latency/persona (headless can exercise the full
loop via `brain.ask(text)`, but real mic + real ears is a human judgment call).

## Completed (this session, on top of the gesture/idle work — see git log for those)
- **`src/brain.js`**: sequential action-plan executor (`{do:'walk'|'turn'|'gesture'|
  'jump'|'wait', ...}`) driving the sim ONLY through `autoWalk`/`gesture`/`jump` —
  every locomotion invariant still applies, nothing pokes sim state directly. `turn`
  walks a small arc (no pivot-in-place gait exists — turnCycle is still red).
  Per-action timeouts; unknown action/gesture/empty plan → visible `error` status
  (no silent failures). `__hand.reset()` now stops the brain first.
- **LLM planner**: `POST /llm` in `scripts/serve.py` proxies to Gemini (key stays
  server-side, read from `GEMINI_API_KEY` env at server start — restart serve.py from
  a shell that has sourced it). `brain.ask(text)` sends `[state: pos, heading, user
  direction]` + the message, gets back `{say, plan}`, speaks `say` via
  SpeechSynthesis (pitch 1.6 tiny-robot voice) and runs `plan`. History capped at 12
  turns.
- **Voice UI** (`index.html` + main.js): hold-Space push-to-talk (Web Speech STT,
  interim transcript shown live) or type into the `#talkText` box + Enter. Status bar
  shows listening/thinking/saying/acting/error (error styled red) — built error-state
  first per house rule.
- Gates every milestone: unit ok, calib bit-exact, QA 7/9 baseline unchanged (brain
  drives through the same player API qa.js uses, so nothing regressed).

## Key Decision — model choice (VERIFIED, don't re-litigate)
- **`gemini-3.5-flash` is UNUSABLE for this**: it's a reasoning model that leaks
  "thinking out loud" text after a complete, valid JSON object even with
  `responseMimeType:'application/json'` AND `thinkingConfig.thinkingBudget:0`.
  Reproduced nondeterministically (~1/3 of calls at temp 0.4) with two DIFFERENT
  corruption shapes (trailing prose once, trailing stray `}` once) — this is not a
  one-off fluke, don't retry it hoping thinkingBudget fixes it.
- **`gemini-2.5-flash` is the pick**: 5/5 clean JSON in manual trials, no thinking
  leakage. `gemini-2.0-flash-001` (was in earlier notes) is 404 GONE — Google
  deprecated it; don't hardcode it anywhere.
- Defense in depth kept anyway: `parseFirstJSON()` in brain.js extracts the first
  balanced (string-aware) `{...}` instead of `JSON.parse`-ing the whole reply — cheap
  insurance against the next model swap having the same issue.

## Verification Method (carried from prior session, still true)
- Manual `sim.step(dt)` needs dt ≤ ~0.008 (spring damping unstable at 0.0125 — probes
  now standardize on 0.00625).
- `node scripts/probe.mjs "<expr>"` can drive `h.brain.ask('...')` directly and poll
  `h.brain.st.i` — this is how the full voice-free loop (planner + executor) was
  verified: compound commands, spatial commands (uses `camera.position` via
  `makeBrain(sim, rig, camera)`), and question→gesture answers all confirmed working
  end to end against the live Gemini API.
- Restarting `serve.py` for `/llm` changes: `lsof -ti :8741 | xargs kill`, then relaunch
  with `source ~/.zshrc` in the same shell (the key is read at process start only).

## Pending (priority order)
1. **Live user pass**: real mic (Chrome permission prompt — first use only), real TTS
   voice/pacing, latency feel (network + LLM roundtrip currently un-timed against a
   human's patience). Iterate the `SYSTEM` prompt in brain.js and `say` tone from
   there — it's the one place persona lives.
2. §4.9 separation on SWING LANDINGS only (plumbing ready: `opts.sepBias`, `d.yawZSign`).
3. Pivot-in-place step pattern for turnCycle (would let `turn` be instant instead of
   an arc-walk, and unblocks a true "turn around" gesture-scale command).
4. Consider: barge-in (Space while brain is 'acting'/'saying' should interrupt, not
   queue) — not built; current behavior is last-command-wins only between actions.

## Relevant Files
| File | Notes |
|------|-------|
| `src/brain.js` | executor + planner + SYSTEM prompt (persona lives here) |
| `scripts/serve.py` | `/llm` proxy — model name, key handling, error JSON shapes |
| `main.js` | brain wiring: `brain.tick()` in the loop, talk-UI event handlers |
| `index.html` | `#talk` bar markup/CSS (listening/error states) |
| `src/gestures.js` | unchanged this milestone — 10 gestures + 3 idles, still the vocabulary |
| `scripts/probe.mjs` | can call `h.brain.ask(text)` directly for headless brain testing |

## Context & Warnings
- Dev server must be started with `GEMINI_API_KEY` in its environment or `/llm`
  returns a visible 503 (by design — no silent failures); `source ~/.zshrc` before
  `python3 scripts/serve.py 8741`.
- Verify HEADLESS only; visible Chrome throttles rAF, hidden tabs freeze the sim.
- Commits: `--no-verify`, no Co-Authored-By trailers, one commit per verified milestone.
