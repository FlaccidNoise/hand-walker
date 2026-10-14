# hand-walker

A severed hand that walks, in the manner of Thing. Five digits act as legs, each
solved with inverse kinematics. It stands tall on its fingertips, struts and
scuttles, turns with a hop, and lives in a small panelled room with a light
switch, a bell, a ball, a rug, a floor piano, and a box that is its home. It
rears up on its stump to wave, plays rock paper scissors, taps Morse code, knocks
on the glass, and loses patience when poked. Runs in the browser with no build step.

![three.js](https://img.shields.io/badge/three.js-r175-black) ![no build](https://img.shields.io/badge/build-none-green)

## Run it

```bash
git clone https://github.com/FlaccidNoise/hand-walker.git
cd hand-walker
npm run serve
```

Open <http://localhost:8741>.

`npm run serve` starts `scripts/serve.py`: a static server on 127.0.0.1 with two
optional proxies (`/llm`, `/tts`) that need `GEMINI_API_KEY`. Any static file
server also works. The page loads `three` through a native import map pointing at
the vendored copy in `vendor/`, so there is no bundler and no `npm install`
needed to run.

## Controls

| Input | What it does |
|---|---|
| Click the floor | Walk there. Near targets strut, far ones scuttle, a double-click sprints |
| Hold and drag on the floor | The hand follows the pointer. Release to stop |
| Click the switch, bell, ball, rug, piano, or box | Go and use it. A brass ring and a label show what a click will do |
| Click the hand | Poke it. It giggles, then jumps, then loses patience |
| Rub the pointer over the hand | Pet it. This forgives the pokes |
| Hold on the hand | High five. Let go while the palm is up |
| Drag off the hand | Fling: it sprints that way |
| Drag the ball | Throw it. The hand goes after it |
| Rest the cursor on the floor | The hand turns and points at it, and comes over if it stays |
| Move the mouse off the page | The hand goes to that side and knocks |
| Wheel, or pinch | Look closer. The view also leans in by itself while a gesture plays |
| The cards | Wave, dance, piano, knock, rock paper scissors, lights, play dead, and "more…" for the rest |
| WASD or arrows | Walk, relative to the camera. Hold Shift to scuttle. Release to stop |
| Q, E | Turn 45° left, right |
| Space | Jump |
| 1–0 | Wave, yes, no, shrug, laugh, bow, thumbs-up, peace, snap, double snap |
| R, P, S | Your sign, while the hand counts in a round of rock paper scissors |
| `/`, then type. Or hold V and speak | Plain commands work with no model: "wave", "go home", "come out", "take a nap", "go to the door then jump", "say hi in morse". "help" opens the list |
| M | Sound on or off |

A double snap works the light switch from anywhere. Left alone, the hand finds
things to do: it plays the piano, chases the ball, knocks on the glass, naps in
its box. A click or a key wakes it from a nap. A caption above the hand says what
it is doing and what it says.

Sound starts with the first click or key press. All of it is synthesised: there
are no audio files.

Free-form requests need a language model. With the dev server and a key, that is
Gemini. On a static host the page offers a 340 MB model that runs in the browser
on WebGPU. Nothing downloads before that offer is pressed.

## Requirements

- Python 3 (for the static server only — substitute any other one you like)
- A browser with import map support (Chrome 89+, Firefox 108+, Safari 16.4+)

## Tests

Tests need the dev dependencies:

```bash
npm install
npm run serve &      # the gates load the page from localhost:8741
npm run test:unit    # solver, gait math, rules, brain, props
npm run test:calib   # calibration snapshot gate
npm test             # all of the above, the gait matrix at 120 Hz and 60 Hz, then every idle behaviour
```

The gait matrix runs the real page on a virtual clock, so its numbers do not
depend on machine load or frame rate. It takes about 15 seconds.

The gates drive a headless browser through `puppeteer-core`, which does **not**
ship a browser. Point it at one you already have:

```bash
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm test
```

| Variable | Default | Purpose |
|---|---|---|
| `CHROME_PATH` | none | Chrome/Chromium binary for the headless gates |
| `SETTLE_MS` | script default | Frames to let the rig settle before sampling |
| `URL` | `http://localhost:8741` | Page under test |

## Layout

```
index.html      import map, canvas, the page's cards, palette, help and their styles
main.js         page loop, sim core, calibration
src/ui.js       the page around the room: caption, cards, text box, speech, hints, states
src/rig.js      finger/joint skeleton, the hand's skin and stitched wrist
src/ik.js       leg solver, curl, ground constraint
src/gait.js     per-digit duty and stride budget
src/gestures.js gesture and emote pose tracks
src/brain.js    command layer, plan executor, idle behaviors
src/rules.js    text → plan by keyword rules
src/llm.js      in-browser language model
src/input.js    clicks, keys, pokes, pets, flings, throws, pinch, cursor awareness
src/props.js    light switch, bell, ball, rug, floor piano, the box, all sound
src/tuning.js   every constant
src/terrain.js  procedural ground height
src/scene.js    room, lighting, the camera and its follow
src/paint.js    the room's textures and the hand's skin, painted on canvases at startup
vendor/         pinned three.js — do not edit by hand
scripts/        dev server, headless gates, filmstrip tool, reel.mjs (video of the real page)
docs/           plans, research, and REBUILD-SPEC.md (the original design)
```

## Related: procedural-hand-animation

[procedural-hand-animation](https://github.com/FlaccidNoise/procedural-hand-animation)
is the sibling of this project: the same premise explored down a different path.
Its click-to-walk, props, rules parser, and in-browser model were ported here in
October 2026. This repo is the one under development, and the one the live demo
at <https://joshtaylor.world/demos/hand-walker/> is built from.

## Note on `docs/REBUILD-SPEC.md`

The spec describes a `scripts/build-artifact.py` that bundles everything into a
single self-contained HTML file. That script does not exist in this repo — the
sibling project above is where it lives. Treat the spec as a design document
rather than a description of this tree.

## License

MIT — see [LICENSE](LICENSE).
