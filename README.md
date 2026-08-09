# hand-walker

A severed hand that walks. Five fingers act as legs, each solved with inverse
kinematics against procedural terrain. Runs in the browser with no build step.

![three.js](https://img.shields.io/badge/three.js-r175-black) ![no build](https://img.shields.io/badge/build-none-green)

## Run it

```bash
git clone https://github.com/FlaccidNoise/hand-walker.git
cd hand-walker
npm run serve
```

Open <http://localhost:8741>.

`npm run serve` is just `python3 -m http.server 8741`. Any static file server
works — the page loads `three` through a native import map pointing at the
vendored copy in `vendor/`, so there is no bundler and no `npm install` needed
to run.

## Requirements

- Python 3 (for the static server only — substitute any other one you like)
- A browser with import map support (Chrome 89+, Firefox 108+, Safari 16.4+)

## Tests

Tests need the dev dependencies:

```bash
npm install
npm run test:unit    # IK and geometry unit tests
npm run test:calib   # gait calibration gate
npm test             # headless QA gate (needs Chrome, see below)
```

`npm test` and `npm run test:calib` drive a headless browser through
`puppeteer-core`, which does **not** ship a browser. Point it at one you already
have:

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
index.html      import map + canvas
main.js         entry: builds scene, steps the gait loop
src/rig.js      finger/joint skeleton
src/ik.js       leg solver, curl, ground constraint
src/terrain.js  procedural ground height
src/scene.js    lighting and camera
vendor/         pinned three.js — do not edit by hand
scripts/        headless test gates
docs/           REBUILD-SPEC.md describes the intended architecture
```

## Note on `docs/REBUILD-SPEC.md`

The spec describes a `scripts/build-artifact.py` that bundles everything into a
single self-contained HTML file. That script was never written, so the spec is a
design document rather than a description of the current tree.

## License

MIT — see [LICENSE](LICENSE).
