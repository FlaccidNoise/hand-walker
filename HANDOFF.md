# Handoff — Thing walk, control, props

**Date:** 2026-10-10
**Project:** hand-walker (`~/CodingProjects/hand-walker`)

## State

hand-walker is the only hand project. `procedural-hand-animation` was the donor
for click-to-walk, props, the rules parser and the in-browser model. The plan is
`docs/plans/2026-10-09-thing-walk-and-control.md`. Research is in
`docs/research/`. Tasks 1–23 are built.

Josh watched it on 2026-10-10: "already looking pretty good", and asked for more
fun. The fun pass below is the answer. He has not yet watched the fun pass.

The website builds from this repo: `personal-website/scripts/build-demos.mjs`
copies `index.html main.js qa.js src vendor assets` into
`public/demos/hand-walker/`. To redeploy: `node scripts/build-demos.mjs hand-walker`
in `personal-website`, commit, push. The site caches `/demos/*/assets/*` for a year:
if the hand model changes, give the file a new name.

The hand stands tall with the palm 34° nose-down and the stump up. It struts on
0.61 u steps, scuttles on 0.80 u steps, stops hard into its stance, and turns
by stop, pivot, go. A turn over 100° is one hop. It is driven by clicks, keys,
typed or spoken text, on-page buttons, and idle behaviors through one command layer.

## Verify

```bash
npm run serve          # dev server on 127.0.0.1:8741 (serve.py: static + /llm + /tts)
npm test               # unit (51) → calibration → matrix at 120 Hz → matrix at 60 Hz → behave-check
node scripts/behave-check.mjs   # every idle behaviour, routine and poke runs start to finish with no brain error
node scripts/qa-gate.mjs [scenario] [--hz N] [--save file.json]
node scripts/film.mjs --run "h.autoWalk(0.8,0)" --view sideL --label NAME
```

- The matrix runs on a **virtual clock**. It is bit-reproducible and takes 15 s.
  Baseline: 14/16 pass, 2 known red (`KNOWN_RED` in `qa.js`, each with its reason).
  `rest` slide must read exactly 0.
- `test/look.baseline.json` holds every metric of the last accepted run.
- `scripts/film.mjs` writes a contact sheet to `.debug/`. Look at it. Numbers and
  pixels catch different bugs.
- The page loads `qa.js` and binds R/P only with `?dev` in the URL.

## Numbers (120 Hz gate, start of this work → now)

| Metric | Before | Now |
|---|---|---|
| Standing wrist excursion at 60 Hz | 5.6 u (sim diverged) | 0 |
| Wrist height, palm pitch | 0.886 u, 9° | 1.40 u, 34° |
| Walk step length (trot) | 0.435 u (0.54) | 0.61 u (0.80) |
| Footfalls per u, walk | 10.4 | 8.0 |
| Slide per u, straight walk | 0.089 | 0.065 |
| Thumb swing clearance, carried thumb | 0.031, 0.000 | 0.17, 0.20 |
| Pivot start: min planted, wrist hop | 0, 0.84 u | 2, 0 |
| turnCycle slide (red since July) | 6.94 | 0.41, green |
| Click-walk slide per u | 0.47 | 0.12 |
| Touchdown tip speed, walk | 0.054 u per step | 0.015 |
| First lift after a command | 0.24 s | 0.044 s |
| Stop from 0.8 u/s: settled, feet off rest | 1.29 s, up to 0.32 u | 0.56 s, ≤ 0.08 u |
| Gate run time, reproducible | 200 s, no | 15 s, yes |

## How it works now (what is new)

- **Fixed step.** The loop feeds the sim 6.25 ms steps. The support spring diverges past 7.9 ms.
- **Posture.** `POSTURE_PITCH` (-0.6). `calibrate()` derives lanes, rests, stand height, and bands at that pitch. `?dev&pitch=-0.45` tries another.
- **Per-digit duty** (`src/gait.js`). One cadence. Each digit stays down as long as its own band allows at the current speed. The longest band sets the stride. Cadence floor 0.9 Hz.
- **Footfall patterns** were chosen by simulating every pattern on a 0.1 grid and ranking by finger-shaft clearance, planted count, and slide. Each gait has an entry phase so starts and gait changes replay checked footfalls.
- **Starts and stops.** `STOP_DECEL`, landing on the rest spot under the predicted halt pose, settle steps.
- **Turn policy lives in the sim.** A command more than `TURN_PIVOT` off the heading brakes, steps home, pivots, and goes. Over `HOP_TURN` it hops.
- **Body springs** carry twitches: footfall nod, start lean, stop nod.
- **Command layer.** `brain.command(plan, {source})`. Sources rank key > click > voice > auto.
- **Text.** `src/rules.js` answers plain commands with no model. A local Gemini proxy answers the rest. On a static host the in-browser model (`src/llm.js`, Web-LLM pinned to 0.2.85) loads after the person presses "load brain (340 MB)".
- **Props** (`src/props.js`): switch, bell, ball, rug. `{do:'use',target}`.

## The fun pass (2026-10-10)

- **Floor piano** along the west wall. `sim.onStep(f, foot)` fires at each touchdown
  and `props.footfall` plays the key under the fingertip. On bare floor it is a soft tick.
- **Sound** is synthesised in `src/props.js` and gated by `audio.on`, which the page
  sets on the first key or pointer press. The headless gates never set it. M mutes.
- **Poke**: a click within 0.6 u of the palm calls `brain.poke()`. Giggle, jump, wag,
  tap, then the `sulk` routine. The count resets after `POKE_FORGET` (10 s).
- **Cursor awareness** (`notice` in `src/input.js`): a mouse that rests on the floor for
  1.6 s gets a turn and a point, and after 5 s more the hand walks over. `auto` source.
- **Gestures**: `dance` (beat cues), `knock` (camera shake cue), `playDead`, and
  `morseGesture(text)`, which builds a tap track from text (8 characters at most).
- **Brain**: `{do:'morse',text}`, `{do:'routine',name}` with `dance`, `knock`, `sulk`,
  and seven idle behaviours that use the room. Behaviours start after 14 s of quiet.
- **A new gesture replaces a running stance gesture.** The old body pose eases out over
  `GESTURE_CUT`. A hover finishes first and lifts off from the settled stance only.
  Gate scenario `gestureCut` holds this.
- **Page**: button row (`#keys`), phone layouts, and the camera backs off on a narrow
  screen so the room fits. The numbers HUD shows only with `?dev` or the backtick.
- `bow` and `sleep` are re-authored for the tall stance. Pitch +0.3 holds on the
  planted digits (err 0.039). At +0.35 they re-step.
- Voice is not offered when the host blocks the microphone. joshtaylor.world does,
  with `Permissions-Policy: microphone=()` in `personal-website/netlify.toml`.

## Findings worth keeping

- **The cross metric lied.** Hand-z lane order reads a pinky planted behind and outside the ring as a crossing. The gate now measures capsule distance between neighbouring finger shafts (`gap`, in flesh radii).
- **Body bob and acceleration lean cost grip.** Bob per lifted digit: slide +10–30%, stop settle 0.56 → 1.35 s. Lean: run slide +25%. Both A/B'd and removed. Twitch impulses are free.
- **A stepping pivot tops out near 1.5 rad/s.** The finger-yaw cone limits the arc a planted foot may sweep to about 0.16 rad. Faster pivots scrub and clash. That is why big turns hop.
- **Pivots must start from the settled stance.** Starting mid-stride gave finger gap 0.18. Waiting for the feet to step home gave 0.86.
- **Start-up transients depend on the phase the cycle is entered at.** A pattern that is clean in steady state clashed on start from the wrong phase. Hence per-gait entry phases.
- **Jump energy scales with planted digits.** A jump issued mid-step reached 1.68 u of 2.32 u. The brain's jump waits for five planted.
- **Hover gestures must open the fist in the air** and only then lower the hand. A fist carried to the floor threw digits 0.6–1.6 u in one step.
- **Taps strike from `base: 'rest'`** (the digit's own stance angles), not by leaning on the ground constraint.
- **The pinky cannot splay wide at this posture.** 0.3 rad of lane splay moved its tip 0.05 u and more broke the stance. Not pursued.

## Open

0. **Never run on a real phone or in Safari.** Taps, the phone layout and the audio unlock were checked in headless Chrome only.
1. **Look pass on the fun pass.** Sound levels were set without ears: nobody has heard the footfall ticks, the piano, the dance beat or the Morse beeps yet.
2. **Voice on the website** needs `microphone=(self)` for `/demos/hand-walker/*` in `personal-website/netlify.toml`. Josh's call: the site review switched it off on purpose.
3. `jumpRun` red: ring and pinky pads overlap on the first strides after a running jump lands.
4. `spam` red at 90 Hz only (chaos input).
5. Pivots borrow the travel footfall patterns (finger gap 0.42–0.50). A pivot-specific pattern search is the fix.
6. The pinky re-steps twice during `dance` (roll plus bounce reach its limit). It reads as part of the dance.
7. The stump is rigid with the palm. A stump bent further upright would match the films more closely (geometry bake at rig time).
8. Backlog in `docs/research/interaction-ideas.md`: Thing's box, chess, the ransom note, grab-and-carry, a phonograph.

## Context and warnings

- Dev server binds 127.0.0.1. `/llm` and `/tts` need `GEMINI_API_KEY` in the shell that starts it.
- The in-browser model was run for real in headless Chrome with WebGPU: "stroll over to the doorway and then give me a wave" gave walkTo door + wave.
- Commits: `--no-verify`, no Co-Authored-By, one commit per verified milestone.
