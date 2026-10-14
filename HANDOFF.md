# Handoff — the polish pass: room, page, character

**Date:** 2026-10-13
**Project:** hand-walker (`~/CodingProjects/hand-walker`)

## State

hand-walker is the only hand project. The website builds from it:
`personal-website/scripts/build-demos.mjs` copies `index.html main.js qa.js src vendor assets`
into `public/demos/hand-walker/`. To redeploy: `node scripts/build-demos.mjs hand-walker`
in `personal-website`, commit, push. The site caches `/demos/*/assets/*` for a year.

On 2026-10-13 Josh asked for a full review and polish of look, feel, function and
performance. Three review agents (look, interaction, character) each wrote a report, then
built their own proposal in a worktree. Everything is merged to `main` locally.

**Nothing from this pass has been pushed or deployed. Josh has not seen or heard it.**
He also had not watched the 2026-10-10 fun pass. Pushing either repo needs his yes.

## Verify

```bash
npm run serve          # dev server on 127.0.0.1:8741 (serve.py: static + /llm + /tts)
npm test               # unit (88) → calibration → matrix at 120 Hz → matrix at 60 Hz → behave-check (61 plans)
node scripts/qa-gate.mjs [scenario] [--hz N] [--save file.json]
node scripts/behave-check.mjs
node scripts/film.mjs --run "h.autoWalk(0.8,0)" --view sideL --label NAME     # contact sheet, ?dev view
node scripts/reel.mjs --cues cues.mjs --out x.mp4                             # video of the SHIPPED page
```

- Baseline: matrix 16/18 at 120 Hz, 17/18 at 60 Hz. Known red: `jumpRun`, and `spam` at 120 Hz only.
  Calibration is bit-exact. `rest` slide must read exactly 0.
- `scripts/reel.mjs` drives the real page (not `?dev`) with real pointer and key events on the
  virtual clock. About 1.5 s of wall time per second of video. Sheets:
  `ffmpeg -i x.mp4 -vf "fps=2,scale=640:-1,tile=4x4" -frames:v 1 sheet.png`.
- A tool that places the camera itself must set `window.__hand.view.hold = true`.
- `?dev` shows the gates' view: the bump field outside the room, the wide shadow frustum,
  `qa.js`, the R/P keys and the backtick orbit. The shipped page shows the room alone.

## Numbers (120 Hz gate, start of this pass → now)

| Metric | Before | Now |
|---|---|---|
| Fingers through a wall, worst case (sprint at it) | 0.72 u through | 0.18 u clear |
| Tip jump in one sim step, every trot start | 0.31 u | 0.08 u |
| Tip jump at the stop after a sprint (pinky) | 0.82 u | 0.14 u |
| Body rear-back at every walk start | 0.224 rad (a bug) | 0.083 rad (one wind-up kick) |
| turnCycle slide, finger gap | 0.41, 0.41 | 0.31, 0.82 |
| clickWalk touchdown speed | 0.041 | 0.027 |
| A key or a poke during a click-walk | hand walks out of the room | walk stops, action plays |
| Idle picks that move the hand under 2 px on screen | 46% of weight | 0 |
| Thumbs-up thumb, off vertical on screen | about 30° | under 6° |
| Triangles drawn per frame | 10.9 k | 6.5 k before the box was dressed |
| Unit tests, behave-check plans | 51, 20 | 88, 61 |

## What changed

### Look (`src/scene.js`, `src/paint.js`, `src/props.js`, `src/rig.js`)

- The room is a shadow box on a dark table: oak boards, bottle-green striped paper over
  walnut wainscot, brass, one warm sconce against moonlight through the door. Every
  texture is painted on a canvas at startup (`src/paint.js`, about 8 ms). No asset files.
- The bump field and its wire draw only under `?dev`.
- The hand casts and takes shadows. Its skin is a painted map: nails, knuckle and joint
  creases, palm lines, pink pads, a stitched scar ring at the wrist.
- Lights off is sconce plus moon, never black. The key turns to moonlight, so the hand
  keeps a shadow. The switch toggle glows in the dark.
- The door's moonlight patch takes the hand's shadow. Dust drifts in the beam.
- Props restyled: striped ball, patterned rug, a piano with black keys, a book for the step.
- Camera: FOV 36 on a wide window, a higher rig on an upright phone, blended by aspect.
  `aim()` slides the view's target toward the hand and dollies to 0.72 while a gesture
  plays. The wheel and a pinch dolly to 0.5. Azimuth and elevation never change, so the
  brain's screen directions hold. `prefers-reduced-motion` turns the follow, the push-in,
  the shake, the dust and the sconce flicker off.

### Page (`index.html`, `src/ui.js`, `src/input.js`)

- Page wiring moved out of `main.js` into `src/ui.js`.
- A caption above the hand: line 1 is what it does ("off to ring the bell"), line 2 is
  what it says or a notice, on its own timer.
- Cards, a palette of every command ("more…", or type "help"), one text box with a
  hold-to-speak button, a sound button with three states, a help panel.
- States: the room draws while the hand loads ("Waking the hand…"). A rig failure or no
  WebGL shows a card with "Try again". The model download has its own progress bar.
- Hover: pointer cursor, a brass ring, a label ("bell · click to ring"). On touch a tap
  near a small thing counts as on it.
- New input: hold and drag to lead the hand, rub to pet, hold on the hand for a high five,
  drag off the hand to fling, drag the ball to throw, pinch to dolly, R P S during a round.
- It notices you leave: the mouse off the page for 2.5 s, or the tab hidden for 20 s.
- First-run hints, and a knock on the glass after 6 s for a visitor who only watches.

### Character (`src/gestures.js`, `src/brain.js`)

- The perch: the hand rears up on its stump, palm to the viewer. Wave, no, peace, horns,
  high five, the rude one and rock paper scissors all sit on it. Signs face the viewer first.
- Stance gestures re-authored to read at the app's scale: yes, laugh, point, bow, shrug,
  thinking, tap, knock, dance. Idles that could not be seen are cut.
- The room answers back: startle when the lights go out, a reaction to the bell and the ball.
- A jump crouches first and squashes on landing.
- A head-cock while a question is out with the model.
- Thing's box (`use box`, "go home", "come out"): the hand walks in, lies down, the box
  shuts. Any command brings it out first. A command at any moment of either sequence ends
  with hand and box in agreement (61-plan behave-check holds this).
- Rock paper scissors: `{do:'rps'}`, `brain.rpsPick(sign)`, `brain.rps`.
- A click or a key wakes a nap or play dead. The nap is a lie-down on the rug.

### Sim (`main.js` makeSim): three small fixes, each with a gate criterion

- A digit held down past its reach by the support guard may take its open phase slot
  (4 lines). New scenario `hopScuttle`, new metric `tipJump`.
- A finger's swing keeps the elbow branch it left the floor with (1 line).
- `stopKick` arms on real speed, plus one deliberate wind-up kick on a start.
- A hover def may name its held span (`hold`), which any input skips: the wake.

### Contracts worth knowing

- Brain status is `idle | acting | idling | thinking`. Words go out through
  `brain.st.onsay(text, kind)`, kind `say | notice | error`. A failed plan sets `st.error`,
  which `qa.js` and `behave-check.mjs` read.
- Expanded `use` actions carry `for: <prop id>`. The model download reports through `st.onload`.
- `ROOM.half` 3.9 = `ROOM.wall` 5.75 − 1.85. The clamp is on the wrist and the fingers
  lead it by up to 1.67 u.
- `initUI` must be registered before `initInput` (R P S are swallowed before S walks).

## Findings worth keeping (new this pass)

- **Finger-only motion does not read at the app's scale.** The hand was about 130 px tall
  and digit tracks moved 1 to 6 px. Body-scale motion, the perch and the push-in fixed it.
- **The gimbal, not "roll only", limits hover pitch.** Total body pitch stays within ±1.2 rad.
- **Every new three.js object draws 4 `Math.random` for its uuid.** One more object at
  startup shifts the seeded stream and moves behave-check plan TIMES. That is not a regression.
- **A status value removed by one change can make a gate check pass for good.** After the
  `error` status went, `clickWalk` could not fail. Prove a gate still goes red.
- **`mesh.bindMatrixInverse` is the inverse of the WORLD matrix in attached mode.** Joint
  frames for painting come from `boneInverses × bindMatrix`.
- **Gesture marks must outlive their plan.** The box was worked by marks on a gesture action.
  A replaced plan took them with it while the hover played on.
- **Parallel agents:** one worktree and one server port each (`.claude/worktrees/<name>`,
  `URL=http://localhost:<port>/index.html`). Stop servers by pid, never by port.

Findings from 2026-10-10 still hold (the `gap` metric, bob and lean cost grip, pivots start
from the settled stance, hover fists open in the air, taps strike from `base: 'rest'`).
They are in git history: `git show 5c37738:HANDOFF.md`.

## Open

0. **Nobody has seen this on a real GPU in motion, a real phone, Safari or Firefox.**
   Every picture and film came from headless Chrome with software rendering.
1. **Nobody has heard any of it.** Every sound level is set blind, including the new cues.
2. **Not exercised for real:** the microphone, a real `/llm` or `/tts` call, the 340 MB
   model download, touch with real fingers (pinch, rub, fling), the tab-return greeting.
3. **Josh's calls:** the page heading is "Thing" and the tab title is "Hand Walker".
   Skin tone `#d9b29a`. A stitched stump (2022 series) or a bare one (1991 film).
4. Voice on the website needs `microphone=(self)` in `personal-website/netlify.toml`.
5. `jumpRun` red: ring and pinky pads overlap after a running jump lands. `spam` red at 120 Hz.
6. A click-walk with a turn that is not 90° fails the finger-gap bar.
7. The mesh is faceted at the knuckles in the perch poses (1360 vertices). Paint cannot fix it.
8. The stump is rigid with the palm: it cannot look at things (needs a bone or a vertex bend).
9. A dragged ball does not follow the pointer. A missed high five has no feedback.
10. Not built: mood that persists, the fingertips-over-the-rim box idle, the box as the
    loading state, the ransom note, chess, the phonograph, fetch and carry
    (`docs/research/interaction-ideas.md`).

## Context and warnings

- Dev server binds 127.0.0.1. `/llm` and `/tts` need `GEMINI_API_KEY` in the shell that starts it.
- ES modules do not hot-reload: hard-reload the tab after a change.
- Review reports and build notes from this pass were written to the session scratchpad,
  not the repo. The decisions they led to are in the commit messages.
- Commits: `--no-verify`, no Co-Authored-By, one commit per verified milestone.
- Branches `polish/look`, `polish/ui`, `polish/char` and their worktrees are merged and kept
  as rewind targets. Remove with `git worktree remove .claude/worktrees/<name>`.
