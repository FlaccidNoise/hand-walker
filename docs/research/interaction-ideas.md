# Interaction ideas for the hand: props, emotes, and a shared anchor pattern

Researched 2026-10-09. Scope: what a walking severed hand can do in the diorama, ranked by (charm x recognisability) / build cost.

Labels used throughout:

- **SOURCED** means the claim was read in a raw page fetched with `curl` (URL in section 5).
- **INFERRED** means my own design reasoning or an extrapolation from a sourced fact.
- **UNCONFIRMED** means memory or a search-engine summary only. Listed in section 5.2. Do not treat as fact.

Tiers:

- **T0** pose track only (new entry in `src/gestures.js`).
- **T1** prop that reads hand state, plus "walk to anchor, face it, play gesture, fire prop event".
- **T2** needs one new small system (sound, cursor awareness, carry attachment, digit-tip aim, mount).
- **T3** needs real grasp or contact physics.

Code facts this document relies on:

| Fact | Source |
|---|---|
| A running gesture is `s.gesture = { name, t, dur, def }`, so progress `u = t / dur` is readable | `main.js:198` |
| Hover gestures are fist-or-curl per digit plus `body.lift` and `body.roll` | `src/gestures.js:124-150` |
| Four fingers can be lifted at once in stance (`stretch`) | `src/gestures.js:187-193` |
| No body heading track is allowed. Extended digits keep `pip >= ~0.5` | `src/gestures.js:17-25` |
| Brain actions are `wait, jump, gesture, walk, walkTo, turn`. `turn` takes a relative angle | `src/brain.js:44-110` |
| Brain clamps positions to +/-4.8. Walls sit at +/-5.5, are 2.4 high, and are visual only | `src/brain.js:36`, `src/scene.js:119-140` |
| Room lighting is one hemisphere, one directional key, one ambient light | `src/scene.js:41-54` |
| Sibling project props read hand position and velocity and never write hand state | `procedural-hand-animation/src/objects.js:1-5` |
| Sibling project already synthesises a bell with WebAudio and no asset files | `procedural-hand-animation/src/objects.js:59-83` |

---

## 1. Top 12 picks

Ranked best value first. "Canon" says whether viewers will recognise it from the Addams material.

### 1. Finger snap (single and double)

- **What:** Thing snaps to get attention. A double snap is also a remote trigger for props.
- **Tier:** T0 for the pose, plus a one-shot synthesised click (T2 sound, already solved in the sibling project).
- **Canon:** SOURCED. Thing "does sometimes snap its fingers to attract attention" (Wikipedia, Thing). The double snap in the TV theme is UNCONFIRMED here because I did not fetch a source for it.
- **Trigger:** key, voice ("get my attention", "snap"), autonomous when the user has been idle.
- **Beats:** Anticipation: thumb and middle lift and swing toward each other on yaw while the body rises a little. Action: middle whips down on `mcp` in two or three frames, click sound on that frame. Reaction: small body bounce and a hold. For a double snap, repeat after 0.25 s.
- **Needs:** one gesture def, one click sound. There is no finger-to-thumb contact solver, so the snap is sold by timing and sound. INFERRED: a hover variant (hand off the ground, rolled toward camera) will read better than the stance variant. Try both.
- **Why first:** cheapest canon emote, and the double snap becomes the "use at a distance" verb for the lamp, candle, phonograph, and TV.

### 2. Hand-sign pack, led by the offered handshake

- **What:** a set of hover poses built from one helper: which digits are extended, how far the hand rolls. Handshake offer, finger gun, peace sign, rock horns, "I love you" sign, fist bump, high five.
- **Tier:** T0. Each is the `thumbsUp` template with a different extended set (`src/gestures.js:124-150`).
- **Canon:** SOURCED for two. The offered handshake is a 1964 running gag where a visitor shakes hands with everyone and is then offered one by Thing (Wikipedia, Thing). Wednesday's Thing "mimics a gun" (TV Tropes, Wednesday character page). The rest are INFERRED additions that cost almost nothing once the helper exists.
- **Trigger:** voice ("nice to meet you", "high five", "peace"), keys, click on the hand for high five.
- **Beats (handshake):** Anticipation: crouch, then lift off. Action: roll to vertical with all four fingers part-curled and thumb up, then two slow up-and-down pumps on `body.lift`. Reaction: hold one beat as if waiting, then set down and do a small `bow`.
- **Needs:** a `handSign(extended, roll)` factory in `gestures.js`. Thumb-to-finger contact signs (OK sign, crossed fingers) are out of reach for now.

### 3. Morse tapping that spells real text

- **What:** the index finger taps a message in actual Morse with a click per tap.
- **Tier:** T0 with a generated track (dots and dashes become `mcp` keys, same shape as the existing `tap`), plus sound.
- **Canon:** SOURCED and corroborated twice. The 1991 film plot has Thing inform Gomez "using Morse code" (Wikipedia, 1991 film). A separate page describes Thing "doing morse code on the table to Gomez" in the motel scene (moviemistakes.com).
- **Trigger:** voice. The LLM emits `{"do":"morse","text":"SOS"}`. Also a good autonomous "trying to tell you something" idle.
- **Beats:** Anticipation: index lifts and hovers, body leans in. Action: taps with dot and dash timing. Reaction: `point` at the viewer, then `tap` impatiently if nothing happens.
- **Needs:** a function that turns a short string into a track and a duration. Cap length at about 6 characters or the bit drags.

### 4. Light switch

- **What:** the owner's example. The hand operates a switch and the room lighting changes.
- **Tier:** T1. Full staging options are in section 3.
- **Canon:** INFERRED. Not sourced as a Thing action, but it sits with the sourced household jobs (changing the TV channel, lifting the telephone receiver).
- **Trigger:** click on the switch, voice ("lights off"), autonomous before a nap.
- **Beats:** see section 3. Reaction matters most: when the lights go out the hand should freeze for a beat, then `peek`.
- **Needs:** the anchor pattern (section 2), a light-rig tween, a click sound.

### 5. Knock on the glass

- **What:** the hand walks to the front edge nearest the camera and raps on the screen as if it were a window.
- **Tier:** T0 pose plus sound. No prop.
- **Canon:** SOURCED action, INFERRED staging. In Wednesday, Thing "knocks on his window" at Tyler's house (Addams Family Wiki, Thing).
- **Trigger:** autonomous after neglect, voice ("get my attention"), or as the opener before the hand "says" something.
- **Beats:** Anticipation: walk to about (3.5, 3.5), rear back on `pitch`. Action: index knuckle raps three times with knock sounds, and the camera gets a 1 to 2 pixel shake per rap. Reaction: `peek` side to side as if looking through the glass, then `wave`.
- **Needs:** one gesture, one sound, optional camera nudge. The camera shake is the cause-and-effect payoff.

### 6. Thing's box

- **What:** a lidded box that is the hand's home. It can retire into it, pop out of it, and peek from under the lid.
- **Tier:** T1 for enter and exit. The lid animates itself.
- **Canon:** SOURCED and the most recognisable 1964 image. Thing "customarily emerged from a series of boxes, one in each room" (Wikipedia, Thing).
- **Trigger:** click on the box, voice ("go home", "come out"), autonomous as an alternative nap spot.
- **Beats (exit):** Anticipation: lid rattles twice, then lifts a crack and two fingertips show. Action: lid flips open and the hand rises on `body.lift`, then steps out. Reaction: `stretch`. **Enter:** walk to the anchor, `jump`, the prop hides the hand mesh when it lands inside the footprint, lid drops, one last finger pulls in late.
- **Needs:** box prop with a lid hinge, a "hand is inside" flag that hides the mesh and pauses idles. INFERRED risk: hiding the hand must not disturb the gait state, so do it as render visibility only.

### 7. Cursor awareness and poke reactions

- **What:** the hand notices the mouse. It turns to face a lingering cursor, points at it, flinches when clicked, and escalates if poked repeatedly.
- **Tier:** T2 small. A floor raycast for the cursor, a hand hit-test, and an annoyance counter. All reactions are existing gestures.
- **Canon:** partly SOURCED. Thing gives the middle finger to Tyler for calling him a pet (Addams Family Wiki, Thing). `flipBird` already exists.
- **Pattern source:** SOURCED. Neko chases the cursor, paws at it on arrival, falls asleep when idle, and scratches at the window border when the cursor is outside (Wikipedia, Neko). Desktop Goose will "nab your mouse" (itch.io page).
- **Trigger:** cursor hover and click on the hand.
- **Beats:** Poke 1: startle hop (`jump`) and a pivot to face the cursor. Poke 2 within a few seconds: `no`. Poke 3: `tap`. Poke 4 and up: `flipBird`, then walk away. Counter decays over about 10 s. Cursor outside the window for a while: walk to the edge it left by and `scratch` there.
- **Needs:** cursor world position exposed to the brain, hit-test on the hand, a decay timer.

### 8. Floor piano

- **What:** a strip of large keys on the floor. Every fingertip that lands on a key plays its note, so walking across it plays a run and standing on it allows "playing".
- **Tier:** T1. The prop reads foot-plant positions. The hand is never pushed.
- **Canon:** INFERRED. Thing playing an instrument is UNCONFIRMED. The only sourced link is that his box sat on Lurch's harpsichord in one shot (addamsfamily.com episode guide).
- **Trigger:** emergent. Any walk across it plays. Click on the piano sends the hand there. Voice ("play something").
- **Beats:** emergent on walks. For a deliberate performance: walk to the anchor, `stretch` as a knuckle-crack, then `drum` and `tap` idles on the keys, then `bow`.
- **Needs:** a per-digit "planted this frame at (x, z)" event from the sim, key meshes that dip, a note synth. INFERRED: this is the best cause-and-effect toy per line of code because the existing gait generates the content.

### 9. Phonograph and a dance

- **What:** the hand starts a record player and dances while the music plays.
- **Tier:** T1 prop plus a T0 dance gesture, plus music.
- **Canon:** SOURCED. Thing turns over records on the phonograph, "particularly when Gomez and Morticia dance the tango" (Wikipedia, Thing, in a section Wikipedia itself flags as unreferenced).
- **Trigger:** click, voice ("put some music on"), double snap.
- **Beats:** Anticipation: walk to the anchor, rear up. Action: index pokes the tone arm, record starts spinning, music fades in. Reaction: looping dance (body height bounce on the beat, alternating finger lifts, roll sway) until the music stops or the user interrupts.
- **Needs:** prop with a spinning disc, an audio loop, a `dance` gesture whose period matches the track tempo. A flipped record (second use) can switch to a second tune.

### 10. Sulk, vanish, ransom note

- **What:** the neglect behaviour. After long inactivity or after being insulted, the hand walks out through the doorway. A ransom note appears on the floor. Calling it or clicking the note brings it back.
- **Tier:** T1. Uses the existing doorway at (0, -4.5) and `walkTo`.
- **Canon:** SOURCED, 1964 episode 23 "Thing Is Missing": after Fester insults Thing he disappears, a ransom note arrives, and it turns out to be a hoax by Thing "who's been feeling neglected" (addamsfamily.com episode guide).
- **Pattern source:** SOURCED. Tamagotchi pets call for attention and suffer visibly from poor care (Wikipedia, Tamagotchi). INFERRED: take the visible need, skip the punishment.
- **Trigger:** autonomous after a long idle (minutes, not seconds), or voice insult.
- **Beats:** Anticipation: `thumbsDown` or a slow turn away, a pause. Action: slow walk out the door. Reaction: a beat of empty room, then a note slides in under the doorway. Return: sprint in, stop, `idk` as if nothing happened.
- **Needs:** note prop, off-stage flag, a longer idle clock. Keep it rare or it becomes an annoyance.

### 11. Chess

- **What:** a small board on the floor. The hand makes a move, waits impatiently for the user, and cheats when the user is not watching.
- **Tier:** T1. Pieces animate themselves when the tap fires.
- **Canon:** SOURCED twice. The 1964 series lists "playing chess" among his services (Wikipedia, 1964 series). In the 1991 film he plays Gomez, waits impatiently for a move, and sneaks a captured rook back onto the board during a distraction (belgianchesshistory.be).
- **Trigger:** click on the board, voice ("your move"), autonomous.
- **Beats:** Anticipation: `thinking` over the board. Action: index taps a piece and it slides to its square with a clack. Reaction: turn to the viewer and `tap`. Cheat: when the tab loses focus or the cursor leaves, a piece is nudged. On return the hand is doing an innocent `breathe`.
- **Needs:** board prop with scripted piece moves (no chess engine), `visibilitychange` hook for the cheat.

### 12. Fetch and deliver

- **What:** the hand picks up a small object (letter, ball, ring), carries it on its back, and drops it at a target.
- **Tier:** T2. Needs a carry attachment: the prop parents to the wrist while a flag is set. No grasp.
- **Canon:** SOURCED. "Fetching the mail" and "retrieving the mail" (Wikipedia, Thing and 1964 series). In the 1991 film he takes a job as a courier (Wikipedia, 1991 film).
- **Trigger:** click an object then click a destination, voice ("bring me the letter").
- **Beats:** Anticipation: walk to the item, crouch over it. Action: body dips to the floor, item snaps onto the back of the hand, body rises. Walk with a slightly lower ride height. Reaction: at the target, pitch forward so the item slides off, then `bow`.
- **Needs:** attach and detach on a prop, a ride-height offset while loaded. This one system unlocks mail, a toy ring, a nail file, and cigar delivery, which is why it is the first carry feature to build.

---

## 2. The interactable anchor pattern

One registry of props. Each prop is either **used** (the hand goes to it and performs) or **sensed** (it watches the hand and fires itself), or both. Data flows one way, as in the sibling project: props read the hand, the brain tells props when to fire, and nothing writes into the gait.

### What a prop declares

| Field | Meaning |
|---|---|
| `id`, `label`, `aliases` | Name for clicks, keys, and the LLM room map |
| `anchor {x, z}` | Where the body stands to use it. Must be inside the +/-4.8 clamp |
| `facing` | World heading at the anchor, or "toward prop" |
| `prep` | Optional actions before the gesture, such as `jump` or a `wait` |
| `gesture` | Gesture name to play at the anchor |
| `fireAt` | Progress `u` (0..1) of that gesture at which the prop event fires. This is the contact frame |
| `event` | Name passed to the prop's own handler. The prop animates itself, plays its sound, and changes world state |
| `state` | Small enum the prop owns, such as `on` or `off` |
| `reaction` | Gesture to play afterward. May depend on the new state |
| `sense(hand, footPlants, landed)` | Optional per-frame predicate for sensed props (bell, piano, jump-slap switch, ball) |
| `cooldown` | Seconds before it can fire again |
| `remote` | Whether a double snap can fire it from a distance |
| `idleWeight` | How often autonomous behaviour picks it. Zero means never |

### What the hand does

A single new brain action, `use {target}`, expands to a plan made of existing actions:

1. `walkTo` the anchor.
2. `turn` by the difference between `facing` and current heading. The existing `turn` is relative, so `use` computes the delta.
3. Run `prep` if any.
4. Start `gesture`. While it runs, watch `s.gesture.t / s.gesture.dur`. When it crosses `fireAt`, call the prop's `event` once.
5. Play `reaction`.

Rules:

- Clicking a prop mesh runs `use` on it. Keys can bind to `use` by id.
- The LLM prompt's "Named spots" list and the per-message state line are generated from the registry, including each prop's `state`. The planner then knows the lights are already off.
- If the gesture is cancelled before `fireAt`, the event does not fire. This keeps cause and effect honest.
- Sensed props run every frame regardless of the brain, so a wandering hand can still ring the bell or play the piano by accident. That accident is a feature.
- INFERRED: the brain's per-action timeout (`src/brain.js:111-118`) needs an entry for `use` sized from walk distance plus gesture duration.

Props this pattern covers without new systems: light switch, desk bell, lamp, candle, phonograph, TV, chess board, box, music box, door, toy telephone, floor button.

---

## 3. Light switch: three stagings

The problem: a wall switch at a believable height is above the hand. Wall height is 2.4 and the hand is about 1.5 long and stands low. The brain clamp stops the body 0.7 short of the wall, so the fingertips roughly reach the wall plane but not upward.

### A. Jump and slap

A normal wall switch mounted at jump-apex height. The hand walks under it, crouches, jumps, and the switch flips when the hand is within a small radius and above a height threshold. This is a sensed prop, the same idea as the bell that rings on landing.

- Beats: look up (`pitch` back), crouch, jump, click and light change at apex, land in the new lighting.
- Cost: lowest. Uses the existing `jump`. No pose aiming.
- Charm: high, and it can miss. A deliberate first miss followed by a retry is the joke. SOURCED design basis: Octodad builds its comedy on "otherwise mundane tasks made difficult" by the wrong body (Wikipedia, Octodad).
- Risk: jump apex height is not documented anywhere I looked (`src/tuning.js`, `HANDOFF.md`, `docs/REBUILD-SPEC.md`). Measure it before placing the switch.

### B. Pull cord

A ceiling lamp with a cord that hangs to fingertip height. The hand rears back, lifts the index, and dips the body. During the gesture window the cord end follows the index tip, then springs back and swings.

- Beats: reach up, hook, tug down (body height dip), click, cord swings and lamp sways.
- Cost: medium. The prop must read one digit tip position. No grasp solver is needed because the cord follows the finger, the finger does not hold the cord.
- Charm: highest secondary motion. The swinging lamp moves the shadows.
- Risk: the index must read as extended upward while keeping `pip >= ~0.5`. May need a rear-up pose test.

### C. Low switch at skirting height

A hand-scale toggle or a floor foot-button near the wall. Walk to the anchor, face it, jab with the index (`point` with a harder `mcp` punch), fire at the contact frame.

- Beats: step up, cock the finger back, jab, click, lights change, glance back at the room.
- Cost: lowest risk. This is the plain "used" prop and proves the anchor pattern.
- Charm: lowest of the three. It solves the height problem by removing it.

A fourth option costs nothing extra once pick 1 exists: a double snap toggles the lamp from anywhere.

### Recommendation

Build **C first as the anchor-pattern test piece, then ship A as the real light switch.** C exercises every field of the spec with no physics doubt. A is the version with a visible struggle and reuses the jump. Keep B for when a digit-tip read exists, and wire the double snap to the same `event` so all routes share one lighting tween.

Lighting change itself: tween the hemisphere, key, and ambient intensities down together and bring up one warm point light or an emissive window so the hand stays visible. A fully black room hides the character.

---

## 4. Backlog

| Idea | Tier | Source or inspiration | Note |
|---|---|---|---|
| Play dead (flip palm-up, fingers curl, one twitch) | T0 | INFERRED. Thing is stabbed and near death in Wednesday S1E7 (Screen Rant) | Hover roll near pi. Good answer to an insult |
| Inspect and buff nails | T0 | SOURCED: he is vain, moisturises, gets manicures (TV Tropes) | Idle. Hover, roll palm toward camera, fingers curl in |
| Candle lit by a snap | T1 | SOURCED: lights cigars for Gomez (Wikipedia) | Flame plus point light. Shares the lamp event |
| TV with channel button | T1 | SOURCED: changes the channel on the TV (Wikipedia) | Canvas texture cycles. Remote by double snap |
| Toy telephone, lift receiver | T1 | SOURCED: lifts the receiver on telephones (Wikipedia, 1964 series) | Receiver animates itself. Ring sound summons the hand |
| Desk bell | T1 | Sibling project | Port as a sensed prop. Add an index-tap ring as a used prop |
| Ball chase and pounce | T1 | Sibling project. SOURCED: launches himself like a jumping spider (TV Tropes) | Port. Add a pounce that ends in a jump |
| Door push at the doorway | T1 | INFERRED | Door swings on proximity. Exit and entrance beats |
| Music box | T1 | INFERRED | Lid opens, tune plays, hand sways |
| Floor button that drops confetti or rings a buzzer | T1 | INFERRED cause-and-effect toy | Sensed by foot plant |
| Statue to topple | T1 | SOURCED: Wednesday has Thing destroy a statue (Wikipedia, Wednesday) | Prop tips when bumped at speed |
| Write the reply on the floor | T2 | SOURCED: communicates by writing, writes a note for Tyler (Wikipedia, Addams Family Wiki) | Index scratches while a text decal reveals. Could replace speech for short answers |
| Fingerspelling a few easy letters | T0 to T2 | SOURCED: manual alphabet (Wikipedia). SOURCED: Wednesday's "Thing language was just made up on the day" (Screen Rant) | Canon licenses invented signs. Start with letters that need no finger contact |
| Follow the cursor at heel | T2 | SOURCED: Neko (Wikipedia) | Uses the pick 7 cursor system |
| Steal the cursor and run | T2 | SOURCED: Desktop Goose (itch.io) | Carry attachment applied to a fake cursor sprite |
| Ride a toy car or roller skate | T2 | SOURCED: drives a car erratically in Addams Family Values (Wikipedia) | Needs a mount system where the prop carries the hand |
| Deliver mail from a mailbox | T2 | SOURCED (Wikipedia) | Carry attachment. Box and mailbox share the lid code |
| Hand over a nail file | T2 | SOURCED: hands Wednesday a nail file (Addams Family Wiki) | Carry attachment |
| Thumb war or arm wrestle against the cursor | T2 | SOURCED: arm-wrestles Grandmama (Wikipedia) | Hover pose plus cursor. A real mini game |
| Engagement ring on a pillow | T2 | SOURCED: holds the ring in the musical tour (Wikipedia) | Carry attachment |
| Stack blocks | T3 | INFERRED | Needs grasp |
| Pour tea | T3 | SOURCED (Wikipedia, 1964 series) | Needs grasp |
| Hold wool for knitting | T3 | SOURCED (Wikipedia) | Needs grasp and a second character |
| Shuffle and deal cards | T3 | INFERRED | Needs grasp |

### Design rules drawn from the pattern research

- **Verbs come from the body.** SOURCED: House House chose the goose's verbs as "the things we thought a goose does" and wanted control to feel "performative", like puppeteering for an audience (Game Developer interview). For a hand that list is tap, snap, point, knock, poke, drum, wave, grab.
- **Keep a gag list.** SOURCED: the same team wrote "a big list of gags", mostly slapstick cliches, and pulled from it when adding content (Game Developer interview). The backlog above is that list.
- **Every gesture gets anticipation and a reaction.** SOURCED: anticipation prepares the audience for an action, and secondary action supports the main one without stealing attention (Wikipedia, Twelve basic principles of animation).
- **Joy reads as bouncing.** SOURCED: Team Asobi's animation director models "how children express joy, like jumping up and down" (PlayStation Blog).
- **The cursor is a character.** SOURCED: Neko and Desktop Goose both treat the pointer as prey or as a thing to steal.
- **Needs should be visible and never punishing.** SOURCED basis in Tamagotchi's attention calls. INFERRED rule for this project.
- **A small verb set feels rich when props combine.** INFERRED: the double snap firing any `remote` prop, the piano reacting to any walk, and the cheat firing on tab blur each multiply existing content without new animation.

---

## 5. Sources

### 5.1 Fetched and read (raw page via curl)

| Finding | Source | Confidence |
|---|---|---|
| Snaps fingers for attention. Communicates by Morse, writing, manual alphabet. Offered-handshake running gag. Fetches mail, hands and lights cigars, changes TV channel, holds wool, turns records, arm-wrestles Grandmama | https://en.wikipedia.org/wiki/Thing_(The_Addams_Family) section "Role in the series" | MEDIUM. Wikipedia tags this section as unreferenced. The two fandom pages below repeat the same text |
| Emerges from boxes in each room, the mailbox, a curtain, a plant pot, the wall safe. Runs on fingertips in the films. Drives a car in Addams Family Values. Holds the ring in the musical tour | Same article, "Appearances" | HIGH |
| 1964 services include lifting telephone receivers, retrieving mail, lighting cigars, pouring tea, playing chess. Hands Gomez a paper from his briefcase in court | https://en.wikipedia.org/wiki/The_Addams_Family_(1964_TV_series) | HIGH |
| 1991 film: Thing informs Gomez using Morse code. Thing becomes a courier | https://en.wikipedia.org/wiki/The_Addams_Family_(1991_film) | HIGH |
| 1991 film: Morse is tapped on the motel table | https://moviemistakes.com/main19 | MEDIUM (user-submitted) |
| 1991 film: plays chess with Gomez, waits impatiently, sneaks a rook back onto the board | https://www.belgianchesshistory.be/cipc-115-the-addams-family/ | MEDIUM (single blog with a film still) |
| 1991 film: gets a courier job, sees Morticia captured and tells Gomez, helps dig graves | https://addamsfamily.fandom.com/wiki/The_Addams_Family_(1991) via web.archive.org | MEDIUM |
| Addams Family Values: Fester flees "with Thing's help" | https://addamsfamily.fandom.com/wiki/Addams_Family_Values via web.archive.org snapshot 20260505031150 | MEDIUM |
| 1964 "Thing Is Missing": insulted, disappears, ransom note, hoax because he felt neglected. Box sits on Lurch's harpsichord in one shot. Stops Gomez and Morticia in one episode. Sells pencils | https://www.addamsfamily.com/detail.html | MEDIUM (unofficial episode guide) |
| Wednesday: knocks on Tyler's window, takes the bat from him, flips the middle finger at being called a pet, hands Wednesday a nail file, writes a note, does nails and makeup tutorials with Enid, holds Enid's hand, frees Xavier from handcuffs | https://addamsfamily.fandom.com/wiki/Thing via web.archive.org (2024 snapshot) | MEDIUM (fan wiki) |
| Wednesday: follows Rowan, destroys a statue, breaks into the coroner's office with Wednesday, is gravely injured | https://en.wikipedia.org/wiki/Wednesday_(TV_series) | HIGH |
| Wednesday: vain, moisturises, gets manicures. Mimics a gun. Chokes Fester. Launches himself like a jumping spider | https://tvtropes.org/pmwiki/pmwiki.php/Characters/WednesdayTheAddamsFamily via web.archive.org snapshot 20251108172738 | MEDIUM (fan wiki) |
| "The Thing language was just made up on the day." Performer Victor Dorobantu wore a blue suit with a prosthetic wrist | https://screenrant.com/wednesday-show-thing-language-creation-ortega/ via web.archive.org snapshot 20221213141204 | HIGH (direct quote from Jenna Ortega) |
| Thing injured and near death in S1E7 | https://screenrant.com/wednesday-thing-hand-actor-explained/ via web.archive.org snapshot 20230828024947 | HIGH |
| Goose verbs, performative control, the gag list | https://www.gamedeveloper.com/game-platforms/road-to-the-igf-house-house-s-i-untitled-goose-game-i- | HIGH (developer interview) |
| Goose can honk, duck, run, flap, grab | https://en.wikipedia.org/wiki/Untitled_Goose_Game | HIGH |
| Neko chases the cursor, paws at it, sleeps when idle, scratches the window border | https://en.wikipedia.org/wiki/Neko_(software) | HIGH |
| Desktop Goose nabs the mouse, tracks mud, brings memes and notepad windows | https://samperson.itch.io/desktop-goose | HIGH (author's page) |
| Tamagotchi attention calls, droppings, sickness, death from poor care | https://en.wikipedia.org/wiki/Tamagotchi | HIGH |
| Octodad: mundane chores made hard by tentacle limbs | https://en.wikipedia.org/wiki/Octodad:_Dadliest_Catch | HIGH |
| Astro Bot animation models children's joy | https://blog.playstation.com/2024/09/09/astro-bot-how-team-asobi-created-a-unified-vision-for-fun/ | HIGH (developer interview) |
| Little Nightmares II has detached "Living Hands" in the Hospital | https://en.wikipedia.org/wiki/Little_Nightmares_II | HIGH for existence only |
| Anticipation, staging, secondary action | https://en.wikipedia.org/wiki/Twelve_basic_principles_of_animation | HIGH |

Blocked or empty: `addamsfamily.fandom.com`, `wednesday.fandom.com`, and `tvtropes.org` return a Cloudflare challenge to curl. I used Wayback Machine raw snapshots where they existed. `wednesday.fandom.com/wiki/Thing` and the TV Tropes page for the classic-series Thing have no snapshot, so they were not read.

### 5.2 Unconfirmed

Not found in any page I fetched. These come from memory or from a search-engine summary. Verify before leaning on them.

- The double finger snap of the TV theme, and a double snap as the Nightshades signal in Wednesday.
- Thing accompanying or assisting the "Paint It Black" cello scene. A targeted search found no source that says so.
- Thing hailing a taxi, giving a massage, playing castanets or any instrument, fainting dramatically, typing, or throwing a railway switch in the 1991 film.
- What exactly Thing does to help Fester escape in Addams Family Values beyond driving the car.
- The Tudum article on Victor Dorobantu. The fetch returned an error page.
- Astro Bot's late-added idle where Astro hops and points forward (GDC talk). Search summary only.
- A PC Gamer quote that NPC reactions do the work of making the goose seem awful. Search summary only.
- Behaviour of the Little Nightmares II Living Hands (scuttling, leaping, grabbing).
- Shimeji behaviours beyond "run around your screen": climbing window edges, being dragged and thrown, multiplying. The page I fetched (kilkakon.com/shimeji) confirms only the first.
- The film Big as inspiration for the floor piano.
- Luigi's Mansion and Human Fall Flat were not researched.

## Open questions

- What is the jump apex height? Staging A depends on it and no file I read states it.
- Does the sim expose a per-digit plant event with world position? The floor piano and floor button need it. I confirmed `s.gesture` state in `main.js` but did not trace foot-plant events.
- Can `body.lift` go negative, and can `roll` reach pi without artefacts? Play dead and nail inspection depend on it.
- Does a stance-mode snap read from the fixed camera, or does it need the hover variant?
- Is there appetite for audio assets (tango loop, music box), or must all sound be synthesised like the sibling project's bell?
- Left hand or right hand? `src/brain.js:194` says left. Handshake convention and sign readability flip with it.
