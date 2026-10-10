# Base-repo review, product lens

Reviewer: product-layer auditor. Date: 2026-10-09.
A = `/Users/joshtaylor/CodingProjects/hand-walker` at `92fe8e7` (clean, one untracked `docs/research/`).
B = `/Users/joshtaylor/CodingProjects/procedural-hand-animation` at `952f0ba` (clean).
Both repos were read-only. No edits, no commits.

## 0. Verdict

**Base = A (hand-walker). Confidence: about 80%.**

A's walk is measurably closer to the goal (3x longer steps, 7x longer ground contact, 2x to 5x less slide per distance). B's product layer is ahead, but it sits above a narrow command API and ports as files plus an adapter. A's locomotion core cannot move into B without a rewrite of B's `main.js`, `ik.js`, `rig.js`, `qa.js` and all 16 gesture clips.

A is not shippable today. It has two blockers that the plan must fix first: the sim explodes on 60 Hz displays, and A has no control path that works on static hosting.

## 1. Facts that change the framing

1. **The website does not serve B's current code.** `personal-website/public/demos/hand-walker/main.js` is byte-identical to B at commit `8ce8992` (2026-07-14). It has no `behaviors.js`, `voice.js`, `llm.js`, `objects.js`, `gesture.js`. Click-to-walk, props, voice and the LLM were never deployed. Command: `diff -rq public/demos/hand-walker/src ../procedural-hand-animation/src` and a `git show <c>:main.js | diff` loop over B's history. The public project page (`src/content/projects/hand-walker.md`) still describes WASD and drag-to-lead.
2. **Headless Chrome ran at 60.3 fps on this machine today**, for both pages (`node product-probes/fps.mjs`). A's memory file says headless runs at about 120 fps. Both repos tuned and gated their gait at the 120 fps rate. Both gates are red at 60 fps (section 2, row h).
3. **Neither repo has direct keys in the product.** A removed them (`main.js:63-69`). B keeps the WASD code but blocks real key presses with `e.isTrusted` (`main.js:108`, `src/behaviors.js:146`).
4. **Neither repo selects a gait by target distance.** Both have a speed-indexed gait table. B's click always commands `SPEED` 0.85 (`main.js:97`, `src/behaviors.js:92`). A's `walkTo` takes a speed from the LLM (`src/brain.js:88`).
5. **Neither repo can flick a switch.** No prop writes to the hand, and no digit can be sent to a world target. B says so itself (`src/gesture.js:67-68`). A's solver misses elevated targets (section 2, row b).

## 2. Score table

| Item | A | B | Evidence |
|---|---|---|---|
| (a) Gait against the goal | 6 | 3 | A walk at 0.8 u/s: stride 0.47 to 0.49 u on all five digits, stance 0.47 s, finger clearance 0.21 to 0.23 u, net slide 0.004 to 0.016 u per stance. B walk at 0.85 u/s, 60 Hz: four digits step 0.13 to 0.16 u with 0.066 s on the ground and 0.113 s in the air. B's ring finger does not lift (peak 0.004 u). A loses points for the thumb, the pivot hop and turn scrub (section 5). |
| (b) IK and calibration | 7 | 5 | Both calibration gates are bit-exact today. A's narrowest stance band is 0.53 u (`strideMax`). B's pacer stride limit is 0.21 u (`gaitS`). A's unit tests run the real solver (`test/unit.test.mjs:58-138`). B's only solver test checks that `solveLeg` is a function (`test/ik.test.js:62`). Headroom is limited in both: A reached 18 of 53 elevated index targets at 0.6 u forward, with 1.4 to 1.7 rad joint jumps near the knuckle. B documents a dead zone at 0.3 to 0.6 standH (`plans/README.md:23`). |
| (c) Physics, timestep, determinism | 5 | 4 | A: `sim.step(dt)` is a closed function and replays exactly, but the live loop has no substep. At 60 Hz the standing hand launches from y 0.43 to 4.99 (standH 0.886). B: body height is stable from 45 to 144 Hz, but the gait result depends on frame rate (slide per unit 0.18 at 120 Hz, 0.40 at 60 Hz, ring lift 0.154 vs 0.004). B integrates wall-clock dt and has no step function. |
| (d) Gesture and emote authoring | 7 | 6 | A: keyframe data tracks, 14 gestures plus 6 idles, whole-hand hover gestures. Feet return to within 0.008 u after every gesture. A has no gesture tests, and hover gestures end with a 0.95 to 1.33 u one-step snap. B: 16 function clips, 5 bound tests, wired to LLM answers. Raised-digit clips jump 0.31 to 0.39 u per 25 ms (A's digit gestures: 0.14 to 0.24) and leave the index displaced by up to 0.108 u. |
| (e) Input and brain | 4 | 7 | B: click, grab and voice all enter `Brain.command` or `commandPlan`. 34 unit tests pass. Seven of eight end-to-end scenarios finished on the real sim. The eighth is the persistent walk in the last table of section 5. A: one input (voice or typed text to a server Gemini proxy). A's executor has timeouts and visible errors, but three measured defects (stale-reply race, stuck status, HTML sink) and no tests. |
| (f) Props and interaction | 2 | 5 | A has one static step and visual-only walls. B has ball, bell, rug, object queries, chase and go-to behaviors, voice verbs. B's three props are hard-coded (`src/objects.js:90-143`). A new prop touches five files. |
| (g) Static-site deployability | 2 | 6 | A on a static host: every command returns `error Unexpected token '<'` and the hand cannot be controlled. A is also unstable at 60 Hz. B runs from static files. B's LLM comes from an unpinned CDN URL and downloads about 340 MB on the first mic press. B's `qa.js` ships with live L and T debug keys. |
| (h) Code health, tests, gates | 5 | 6 | A: sim is a factory with a narrow API (`main.js:136-617`), 11 unit tests, a 10-scenario gate that scores every scenario. A's gate read 0/10 today and A's own baseline is 7/9 red. B: 61 unit tests, `npm test` chains three gates, decision log. B's `main.js` is 1,045 lines of module globals with top-level await. B's judge scores walking slide on one scenario only (`qa.js:204-215`). B's gate read steadyW slide 0.92 today. |

### Measurements behind rows (a) and (c)

Same sampler on both repos (`product-probes/sampler.js`). A ran paused at fixed dt 0.00625. B ran its real loop on a virtual clock. Units agree to 0.2% (A's 1 u is the middle-finger chord, B's is the phalanx sum, ratio 0.998). 1 u is 8.65 cm.

| Run | Stride (u) | Stance (s) | Peak clearance (u) | Net slide per u travelled |
|---|---|---|---|---|
| A walk 0.8 | 0.47 to 0.49 | 0.47 | fingers 0.21 to 0.23, thumb 0.044 | 0.077 |
| A trot 1.6 | 0.61 | 0.24 | 0.24 to 0.25, thumb carried at 0.000 | 0.041 |
| A run 3.0 | 0.75 | 0.13 | 0.25, thumb carried at -0.009 mean, -0.045 min | 0.038 |
| B walk 0.85, 120 Hz | 0.14 to 0.15 (ring 0.30) | 0.066 (ring 0.245) | 0.15 to 0.26 | 0.181 |
| B walk 0.85, 60 Hz | 0.13 to 0.16 (ring 0.27) | 0.066 (ring 0.196) | ring 0.004, others 0.17 to 0.27 | 0.398 |
| B trot 1.3, 60 Hz | 0.20 to 0.24 | 0.069 | 0.16 to 0.22, thumb carried at 0.000 | 0.182 |
| B run 2.4, 60 Hz | 0.32 to 0.59 | 0.03 to 0.12 | ring 0.011, pinky 0.045 | 0.588 |

B ring-lift map, 6 display rates by 3 speeds: the ring lifts in 4 of 18 cells (120 and 144 Hz at 0.85 u/s, 50 and 60 Hz at 0.6 u/s). In the other 14 cells its peak clearance is 0.022 u or less. B's own gate confirmed this today: `lift 0.26/0.14/0/0.18/0.21`. B's docs call this the "first-walk artifact" and blame boot-time canvas bakes (`src/scene.js:156-161`, `scripts/lib/harness.mjs:41-51`). The measurements show it follows frame rate and speed.

Frame-rate sweep, body height while standing then walking at the default walk speed:

| Display rate | A body y range (standH 0.886) | B body y range (standH 0.758) |
|---|---|---|
| 120 Hz | 0.836 to 0.883 | 0.577 to 0.770 |
| 90 Hz | 0.833 to 0.894 | not run |
| 75 Hz | 0.831 to 1.024 | not run |
| 60 Hz | 0.427 to 4.991 | 0.543 to 0.770 |
| 30 Hz | 0.427 to 10.058 | 0.342 to 1.049 |

Turning and click-to-walk (A through `brain.run([{do:'walkTo'}])`, B through the click handler's `goto` command, B at 60 Hz):

| Scenario | A | B |
|---|---|---|
| Straight 4 u | 5.5 s, slide per u 0.086, end error 0.075 | 5.2 s, slide per u 0.661, end error 0.122 |
| Diagonal 5 u | 6.8 s, 0.257 | 6.3 s, 0.484 |
| Reverse 3 u | 6.0 s, 1.496 | 4.0 s, 1.002 |
| Zigzag 16.4 u | 24.5 s, 0.474 | 20.6 s, 0.604 |
| 180 degree turn | 1.9 s, 0 drift, lands at 178.3 degrees | 1.3 s, 0.286 u drift, lands at 175 degrees |

### Commands

All from `scratchpad/product-probes/`. All fixed-step or virtual-clock, so machine load does not change them. Load average was 15 to 32 for most of the session.

- `node probeA.mjs walk <0.5|0.8|1.6|3.0> 0.00625 8` then `node show.mjs A-walk-*.json`
- `node probeA.mjs dts`, `node probeA.mjs turn`, `node probeA.mjs click`, `node probeA.mjs gestures`
- `node liveA.mjs` (A's real rAF loop on a virtual clock at 120, 90, 75, 60, 30 Hz)
- `node detailA.mjs` (pivot height trace, hover-gesture snap)
- `node reachA.mjs` (elevated IK targets)
- `node brainA.mjs` (A brain with `/llm` and `/tts` mocked by request interception. No API call left the page.)
- `node probeB.mjs walk <speed> <hz> 8`, `node probeB.mjs hzs`, `detail`, `turn`, `click`, `gestures`, `seams`
- `node fps.mjs` (headless frame rate)
- Each repo's own gates: `npm run test:unit` (A 11/11, B 61/61), `node scripts/calib-gate.mjs` (both bit-exact), `node scripts/qa-gate.mjs` in A (0/10), `node scripts/qa-gate.mjs --allow-fail spam` in B (steadyW and runFast fail).

### Metric fairness

- `siblab.mjs` reads B on live rAF. Under load its numbers are not B's numbers. Its `swingDur` is wall time, and A's is sim time, so B's swings look 33% longer than they are. I did not use it.
- `gaitlab.mjs` and `draglab.mjs` step A only at dt 0.00625. That is A's best case and hides the 60 Hz failure. `gaitlab` also measures straight walking only. A's slide per unit is 3x to 17x higher when it turns.
- The `drag` path metric in `draglab` and `siblab` integrates per-sample jitter and depends on sample rate. I report net slide per stance and peak clearance instead.
- My `lowTravel` metric turned out to be limited by sample spacing. I dropped it.
- B's slide per unit is partly a step-count effect. Per stance, B at 120 Hz is as tight as A (0.001 to 0.014 u). B takes about 3x more steps per unit.
- Not measured: visual quality. B has a baked skin and a textured room with visible props. A has a plain grey hand in a dark room (screenshots `A-live-rest.png`, `B-live-rest.png`).
- Not confirmed: B's IK dead zone. I cite B's own documents for it. B exposes no way to send a digit to a target from outside.

## 3. Port cost

Sizes: S is under about 100 changed lines in one or two files. M is 100 to 400 lines or several files. L is more than 400 lines or a core rewrite.

### (i) B's product features into A

| # | Item | Size | Risk | Notes |
|---|---|---|---|---|
| 1 | Fixed-step loop in A (prerequisite) | S | Low | Accumulator around `sim.step` and `brain.tick` at `main.js:114-117`. Step at 0.00625, the rate A was tuned at. |
| 2 | Click-to-walk | S | Low | B `main.js:78-100` is 23 lines. Needs a public `brain.command(plan)` in A that stamps `lastUserAt`. |
| 3 | Direct keys | S | Low to medium | Keys to `sim.autoWalk`, key press calls `brain.stop()`. A's walls have no collision, so add a sim-level room clamp (B `main.js:676-679`). |
| 4 | Grab-and-carry | M | Medium to high | B `main.js:38-76`, `610-620`, `744-763`. Adds a `held` state inside A's `sim.step`. A's landing path teleports feet (`reseedFeet`), and A has no landing squash. |
| 5 | Props module | S to M | Low | `src/objects.js` is pure XZ math and copies as is. Needs a `landed` flag from `main.js:483`, object queries on `__hand`, and one room constant. A has four different room sizes today. |
| 6 | Chase, go-to-object, fidget pool | S to M | Low | New entries in A's `ACTIONS` and `BEHAVIORS`. |
| 7 | Voice rules parser, question routing, staged gestures | M | Low to medium | `src/voice.js` (268 lines) plus an adapter from B action structs to A plan actions. About 16 of B's 34 brain tests port unchanged. The rest test B's `Brain` class. |
| 8 | In-browser LLM | S to copy, M to ship | Medium | `src/llm.js` (171 lines). Pin or self-host the web-llm bundle. Ask before the 340 MB download. Rewrite `SYS` for A's actions. A's Gemini prompt is too large for a 0.6B model. |
| 9 | Gesture parity | S | Low | Author `ackNod`, `excited`, short `sleepy`. Alias `puzzled` to `idk` and `bird` to `flipBird`. Make idles callable. |
| 10 | Gesture and prop unit tests | S | Low | Endpoint and bound tests on A's tracks. `test/objects.test.js` copies. |
| 11 | Skin bake and room art | S to M | Low | `src/skin.js` takes raw bind-space inputs. Call it from A's `rig.js` before the mount. |
| 12 | Deploy wiring | S | Low | Remove `qa.js` and dev keys from the shipped page. Change `SOURCES` and `STATIC_KEEP` in `build-demos.mjs`. |

Total: about L, but every item except 1 and 4 sits above A's player API (`autoWalk`, `jump`, `gesture`, `pivot`).

**Riskiest item: 4, grab-and-carry.** It is the only port that edits the physics branch of `sim.step`, next to the spring that is already unstable and the foot teleport on landing.

### (ii) A's locomotion core into B

| # | Item | Size | Risk | Notes |
|---|---|---|---|---|
| 1 | Replace `src/ik.js` | M | High | A's solver is stateless and returns angles. B's is stateful, with damping and rate caps inside (`src/ik.js:99-100`, `163-166`). Every caller changes. |
| 2 | Replace `src/rig.js` | L | High | A's digit model, thumb CMC bake, hinge alignment, wrist-origin mount. A faces +x with a YZX mount. B faces +z with `hand` and `lean` groups. |
| 3 | Replace calibration | M to L | High | B `main.js:262-414` out, A `main.js:619-850` in. B's 869-line snapshot is void. |
| 4 | Replace gait and physics | L | High | B `main.js:556-939` is one function over module globals. Grab, gesture offsets, room clamp, lean and weight shift are threaded through it. |
| 5 | Re-author all 16 clips | M | Medium | B's `lift`, `lat`, `foldW` channels are defined by B's solver. They must become pose tracks, which is A's format. |
| 6 | Rewrite `qa.js` | M | Medium | It reads `legs[i].swing`, `planted`, `aloft`, `r`, and drives synthetic key events. |
| 7 | Rewrite debug overlay, IK tests, `__hand` surface | M | Low | B `main.js:448-550`, `test/ik.test.js`. |
| 8 | Fixed-step loop | S | Low | Same as (i) item 1. |

Total: L, high risk. What survives from B is `behaviors.js`, `voice.js`, `llm.js`, `objects.js`, `skin.js` and the room art, about 1,300 lines. Those are the same files that direction (i) copies. Direction (ii) is direction (i) plus a rebuild of A's validated core inside B's globals.

**Riskiest item: 2 and 4 together, moving A's rig and sim into B's frame.** A's memory file records two cases in this exact work where every metric passed while the hand stood palm-up or steered an invisible origin.

## 4. What would change the verdict

- A local fix in B that gives strides of 0.4 u or more with stance of 0.2 s or more at 60 Hz. I think the limit is structural (band 0.21 u), but the locomotion reviewer should confirm.
- A's thumb cannot be made to clear the floor without reopening the thumb rig. Then A's lead narrows.
- The owner wants the buddy features on the website now and accepts the current walk. B at HEAD can ship after pinning the CDN import and removing `qa.js`. A cannot.
- A's gait numbers do not hold after the loop is sub-stepped. I expect them to hold, because the substep equals the dt I measured at.

## 5. Defects in the chosen base (A) that the plan must fix, ranked

| Severity | File:Line | Issue | Fix |
|----------|-----------|-------|-----|
| CRITICAL | `main.js:114-117`, `src/tuning.js:18-19` | No substep. At 60 Hz (sim dt 0.0125) the support spring's explicit damping term is 3.2 per step. The standing hand launches from y 0.43 to 4.99. At 75 Hz it overshoots to 1.02. Measured on the real loop with `liveA.mjs`. | Fixed-step accumulator at 0.00625 s with a cap on substeps per frame. Then run the gate at a forced 60 Hz. |
| CRITICAL | `src/brain.js:232`, `src/brain.js:263`, `main.js:63-69` | The only control path is `POST /llm` and `/tts` on a Python proxy. On a static host the reply is HTML and the user sees `error Unexpected token '<'`. No click, no keys. Measured with `brainA.mjs`. | Add click-to-walk and keys into `brain.run` and `sim.autoWalk`. Port B's rules parser and in-browser LLM. Keep the proxy as a dev option. |
| HIGH | `main.js:352`, `main.js:544-545`, `main.js:372`, `src/tuning.js:70-75` | The thumb drags. Walk: peak clearance 0.044 u, 43% of swing time under 0.02 u. Trot and run: the "aloft" thumb sits at 0.000 clearance, and at -0.045 at run speed. The ground constraint pins the `ALOFT` pose to the floor. | Give the aloft pose real clearance and check it at calibration. Raise the thumb's swing arc or give it its own. |
| HIGH | `main.js:424-427`, `src/brain.js:78-85` | Every pivot starts with all five digits off the ground (planted 0 at t 0.1 s). The body drops to 0.565 then pops to 1.406. This runs on every `turn` and on every walk with a bearing error over 57 degrees. Measured with `detailA.mjs`. | Stagger the first swings of a pivot so support never reaches zero. Ramp the pivot yaw rate instead of the instant gait upshift. |
| HIGH | `main.js:268-324` (swing planning), `HANDOFF.md:56-58` | Turning scrubs. Slide per unit is 1.50 on a reversal and 0.47 on a zigzag, against 0.086 straight. A's own gate baseline is 7/9 red. | A real step pattern for turns. Until then, record the red scenarios in an explicit allow-list so the gate can exit 0 and block regressions. |
| HIGH | `scripts/qa-gate.mjs:80-89`, `qa.js:27-35` | The gate measures the machine. It read 0/10 today at 60.3 fps headless, with `rest` slide 3.185 where the baseline is exactly 0. | Drive the gate with paused fixed-step stepping, as `scripts/probe.mjs` recipes already do. Gate on that, not on live rAF. |
| MEDIUM | `src/brain.js:222-253` | Stale-reply race. A slow reply to an older `ask()` replaces the plan of a newer one. Measured: plan went `gesture` then `walkTo`. B solved this with a generation counter (`src/voice.js:207`). | Add a generation counter. Drop any reply whose generation is not current. |
| MEDIUM | `src/brain.js:246-251`, `src/brain.js:42`, `src/brain.js:163` | Status sticks at `saying` or `error`. Idle behaviors need `idle`, so they never fire again. Measured: no behavior in 60 s after a say-only reply, against 12 s in the control. | Return to `idle` when speech ends, and a few seconds after an error. |
| MEDIUM | `main.js:124`, `main.js:862-863` | The HUD is written with `innerHTML` and includes typed text, LLM `say` text and server error text. A mocked reply with `<b id="xssprobe">` created that element. | Use `textContent`, or escape the dynamic fields. |
| MEDIUM | `main.js:436-440` | Hover gestures end with `reseedFeet()`. All digits jump from fist to planted in one step: 0.95 u (thumbsUp) and 1.33 u (flipBird). | Exit through real swings, as the aloft and digit-gesture exits already do (`main.js:547-553`). |
| MEDIUM | `scripts/serve.py:76`, `scripts/serve.py:40-73` | The dev server binds `0.0.0.0` and forwards any `system` and `contents` to Gemini with the owner's key. No auth. `lsof` shows it listening on `*:8741` now. | Bind `127.0.0.1`. Fix the system prompt on the server side. |
| MEDIUM | `index.html:44`, `main.js:64-69`, `main.js:51-61` | The shipped page loads `qa.js`, exposes all sim state on `window.__hand`, and binds R (reset) and P (pause) to real keys. | Load `qa.js` and dev keys only behind a query flag. Leave them out of the deploy copy. |
| MEDIUM | `src/ik.js:73-155` | The solver cannot reach elevated world targets. Index at 0.6 u forward: 18 of 53 targets within 0.025 u, worst miss 0.34 u. Near the knuckle the joints jump 1.4 to 1.7 rad between targets 0.02 u apart. | For props, position the body with walk and pivot, then play a pose-track gesture. Do not promise IK reach to a switch without solver work. |
| LOW | `src/brain.js:36`, `src/scene.js:122`, `src/terrain.js:48`, `src/brain.js:205` | Four different room sizes: 4.8, 5.5, 6 and "-5 to 5". | One `ROOM` constant in `tuning.js`. |
| LOW | `index.html:23`, `package.json:8` | Help text advertises orbit and "click hand:grab", which do not exist. `npm run serve` starts a server with no `/llm`. | Correct both. |
| LOW | `scripts/qa-gate.mjs:15-27` | Pass criteria are duplicated by hand from `qa.js:14` and `qa.js:100-106`. | Read them from `window.__qa.CRIT`. |
| LOW | `test/unit.test.mjs` | No tests for the brain executor or the gesture tracks. | Add executor tests on a mock sim, and track endpoint and bound tests. |

### Defects that come with the B files being ported

| Severity | File:Line | Issue | Fix |
|----------|-----------|-------|-----|
| HIGH | B `src/llm.js:23`, `src/llm.js:98` | `import('https://esm.run/@mlc-ai/web-llm')` has no version and no integrity check. Remote code would run in the site's origin. | Pin an exact version, or self-host the bundle. |
| MEDIUM | B `src/voice.js:159`, `src/llm.js:16` | The first mic press starts a download of about 340 MB without asking. | Ask first, and show the size. |
| MEDIUM | B `src/behaviors.js:190-191` | Unknown plan actions are skipped without any message. | Surface an error, as A's `fail()` does. |
| LOW | B `src/behaviors.js:19-24` | `goForward` never ends. "walk left" walked into the wall and kept walking for the full 12 s of the probe. | Give it a default time budget, or stop at the room edge. |
