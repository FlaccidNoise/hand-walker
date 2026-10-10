# Thing motion reference

Research date: 2026-10-09. Purpose: define the target motion for the procedural hand walker and list the techniques that produce it.

Claim tags used throughout:

- **SOURCED**: a named person or publication says it. URL given.
- **OBSERVED**: read directly from extracted video frames. Clip URL and timestamp given. Both clips were only available at 640x360, so digit-level detail is coarse.
- **INFERRED**: my reasoning from the above. Not a fact.

Headline limits, stated up front:

- No interview, breakdown, or article I found states a footfall order, a cadence, or which digits bear weight. Everything about digit roles below is OBSERVED or INFERRED.
- Neither clip I pulled contains a clean side-on walk cycle. Posture findings are solid. Footfall order and cadence are not confirmed for any source.

Source key (full URLs in section 6): [Munro], [Hart], [Turnbull-AoV], [Turnbull-BA26], [Turnbull-MPA], [MARZ-vfxwire], [MARZ-VFXV], [MARZ-BA23], [Dorobantu-Spotlight], [Netflix-BTS], [Tudum], [Wiki-Thing], [Clip-1991], [Clip-Wed], [Rosen], [Weaver], [Godot], [ETH], [Holden], [RainWorld], [HagerRoss], [LangSchieber], [vonSchroeder], [FingerLen].

---

## 1. What makes it read as Thing

Ranked by how much each trait contributes to the look. The ranking itself is INFERRED.

| # | Trait | What to implement | Tag | Source |
|---|-------|-------------------|-----|--------|
| 1 | **The wrist stump is up, not trailing.** The stump sits on top of the rear of the hand and points upward. The back of the hand slopes down and forward from it to the knuckles. The heel of the palm is the highest point of the body, never the lowest. | Pitch the palm nose-down. Roughly 45 to 60 degrees from horizontal in the Wednesday side view. Steeper in the 1991 front view, where the back of the hand faces a floor-level camera almost square on. Nothing behind the knuckles touches the ground. | SOURCED + OBSERVED | [Turnbull-AoV], [Munro], [Clip-Wed] 0:43-0:47 and 1:00-1:03, [Clip-1991] 0:02.9-0:04.1 |
| 2 | **The stump is the head.** Productions built stump variants to change its angle and a rod or servo version so it could turn and tilt on its own for "looking around". | Treat wrist yaw and pitch as a look-at channel that leads the body into turns and reacts during idles. Keep it independent of the gait. | SOURCED (the mapping to a look-at channel is INFERRED) | [Turnbull-AoV], [Turnbull-BA26] |
| 3 | **Staccato timing.** Hart: "I decided on a sort of precise staccato movement for Thing when he runs or 'looks' around. Other emotions are done with slower movements — shaking when nervous or afraid." MARZ had to "make the animation less smooth" and names "the twitchiness" as "what makes Thing… Thing". | Fast attack, hard stop, then a held pose. No slow ease-in on starts. No drifting settle. Idles are dead still, then a twitch. | SOURCED + OBSERVED (the 1991 standing pose holds with no visible motion for the full 0.6 s of the shot) | [Hart], [MARZ-vfxwire], [Clip-1991] 0:05.9-0:06.5 |
| 4 | **Tall stance on fingertips with long, mostly straight fingers fanned wide.** Not a tight claw. "Run on his fingertips, much like a spider." | Stand height near full finger length. Rest pose has fingertips in a wide arc ahead of the palm. | OBSERVED + SOURCED | [Clip-1991], [Wiki-Thing] |
| 5 | **The pinky is a splayed outrigger.** In the 1991 frames it is nearly straight, abducted about 40 to 50 degrees from the middle finger, tip planted, and its tip lands behind and outside the arc of the other three fingertips. It is not tucked, not dragged, and not placed in line with the others. | Give the pinky its own home position: further back and further out. Shorter stride. Straighter pose. See section 3 for why an even-treatment gait drags it. | OBSERVED, medium confidence, 1991 only | [Clip-1991] 0:03.6 and 0:06.2 |
| 6 | **The thumb is a rear strut on the opposite side.** In the 1991 standing pose it is bent and set back beside the palm, behind the finger arc. In the Wednesday side views the near-side rear support is a near-vertical column under the wrist side. | Thumb home position sits behind the knuckle line and close to the body. Short steps. It props, it does not reach. | OBSERVED, medium (1991) and low (Wednesday) confidence | [Clip-1991] 0:06.2, [Clip-Wed] 0:43-0:47 |
| 7 | **Index and middle lead.** The middle fingertip is the furthest forward in the 1991 stance. The Wednesday stance shows the index reaching well forward of the other contacts. | Longest reach and longest stride on index and middle. They are the front legs. | OBSERVED (1991 medium, Wednesday low). Role as "front legs" is INFERRED. | [Clip-1991], [Clip-Wed] |
| 8 | **The body rides level. The fingers do the work underneath.** During the 1991 creep the wrist height stays constant across about 0.8 s while individual fingers lift and replant. | Small vertical bob. Do not let each step drop the palm. | OBSERVED, low confidence | [Clip-1991] 0:03.1-0:04.1 |
| 9 | **The motion is light because the performer's arm carried the weight.** Hart lay on a mechanic's dolly or was pushed on a cart. Dorobantu used dollies for fast and long moves. The fingers paddle under a body that is being translated smoothly by something else. | Root motion first, feet follow. Steps are quick taps with short ground contact, not weight-shifting lunges. This is the same architecture as a procedural walker, which is why the look is reachable. | SOURCED production facts. The "light paddle" reading is INFERRED. | [Munro], [Hart], [Tudum], [Turnbull-AoV] |
| 10 | **Contacts never slide.** On Wednesday a finger sliding on the floor was a defect that got fixed in 2D or 3D. | Hard foot locking in stance. Zero tip slip. | SOURCED | [Turnbull-BA26] |
| 11 | **Landing squash and recover.** On the 1991 drop-in the hand arrives low with fingers splayed wide, then rises to full stance height in about 4 frames (0.17 s). | Drive body height with a spring. Add a downward impulse on landings and hard stops. | OBSERVED | [Clip-1991] 0:02.9-0:03.1 |
| 12 | **Gesture from the stance.** Thing frees one finger to point or tap while standing on the rest, and rolls back onto the stump to free all fingers. | Support polygon must survive one lifted digit. A "sit back on stump" pose is a separate state. | SOURCED + OBSERVED | [MARZ-vfxwire], [MARZ-VFXV], [Clip-Wed] 0:24-0:25 |
| 13 | **Emotion is carried by tempo and tremor.** Dorobantu: "Even walking is very specific. It has to be balanced. It has to be with a specific emotion, anger or happiness." Hart: shaking for nervous or afraid. | Expose gait tempo, stance height, and a tremor amplitude as mood inputs. | SOURCED | [Dorobantu-Spotlight], [Hart] |
| 14 | **Character model is a dancer or silent comic, not a rodent.** Munro pitched Fred Astaire and rejected "a hapless hamster, who simply scurries". Hart cites Chaplin, Keaton, an excited puppy, and "a spider moving creepily". MARZ cites Buster Keaton, "an upright human being walking", parkour, and "swagger". | Bias toward deliberate, posed motion with clear stops over continuous skittering. | SOURCED | [Munro], [Hart], [MARZ-VFXV], [MARZ-vfxwire] |

---

## 2. Per-source gait notes

### 2.1 The Addams Family (1991) and Addams Family Values (1993)

Performer: Christopher Hart, real right hand [Wiki-Thing].

How it was shot (SOURCED, [Munro]):

- Every shot was done in two passes, with and without Hart. His body was rotoscoped out and the clean pass filled the hole.
- "For front, top and profile shots, Chris would lie face-down on a car mechanic's dolly, his arm outstretched, wearing a black sleeve. The false prosthetic wrist would be added, turned upwards, giving the illusion that his missing body was positioned above."
- "For shots from behind (or when Thing had to turn around), Chris would be positioned above the camera, with a prosthetic placed around his actual wrist."
- Real-hand shots were intercut with mechanical latex hand puppets built for specific tasks.

What Hart says about the performance (SOURCED, [Hart]):

- Scripts gave only "Thing scampers to the door" or "Thing dashes across the street". He built the rest.
- "I decided on a sort of precise staccato movement for Thing when he runs or 'looks' around. Other emotions are done with slower movements — shaking when nervous or afraid."
- References: "Charlie Chaplin doing a funny slide across the floor or the physical comedy of Buster Keaton bouncing off a wall", "an excited puppy jumping up and down, or shaking back and forth after a bath, or a spider moving creepily".
- He was "pushed on a cart to track a moving camera down a hallway".
- Real impact loads existed: "bursts of pain shooting through my hand each time my fingers landed on the hard asphalt". "The hand is not designed to run on the floor for hours."
- For the 1993 office sequence "they did numerous takes at different frame rates to have options to speed up or slow the footage down". Some of the scuttle speed on screen is undercranking.

Character intent (SOURCED, [Munro]): "Thing needs to be much more. He needs to be magical. He needs to be Fred Astaire." "Natural, yet unnatural. Bounded, yet unbound."

Direct frame observation ([Clip-1991], 640x360, 23.976 fps):

- 0:02.9 to 0:04.1. Thing drops into frame and creeps toward a floor-level camera. Back of hand faces camera. Stump is vertical and directly above the hand. Fingers hang long and nearly straight with tips on the floor. The pinky is abducted wide and planted. Arrival is squashed and wide, rising to full height in about 4 frames. After that the wrist height stays level while single fingers lift and replant. At least three tips appear planted in every frame. Digit-by-digit order is not resolvable at this resolution.
- 0:05.9 to 0:06.5. Standing pose, front view. Four fingertips planted in a fan. Middle fingertip furthest forward. Pinky furthest out and furthest back of the four. Thumb bent and set back beside the palm on the other side. No motion for the length of the shot.

Not confirmed for 1991/1993: footfall order, cadence, run versus walk differences, turns, sneak. The trailer is a recent Paramount re-cut and I did not verify which film scene each shot comes from.

### 2.2 Wednesday (Netflix, 2022 onward)

Performer: Victor Dorobantu, real hand with prosthetics. About 90% practical and 10% CG in season 1 [Turnbull-AoV]. MARZ did the CG Thing in season 1. WeFX did it in season 2 [Turnbull-BA26].

The stump (SOURCED, [Turnbull-AoV]):

- A painted-out performer still reads as a hidden body. "The brain sees a hand and automatically knows it is attached to a body."
- The fix was the 1990s trick. "The prosthetic stump was a misdirect that made Thing feel totally independent." "It broke the bond between the puppeteer and the puppet."
- Four configurations: Full, Lazy, Relaxed, Collar. "The relaxed stump, the most frequently used, was best for general 'walking' and 'talking' scenes. The collar stump was used for occasions when he needed to 'stand' upright on his stump. The Full stump was more erect and allowed Victor the option to puppeteer the stump with a rod, useful for character gestures or 'looking around'."
- Season 2 added an animatronic "robo stump" with servos so the wrist could "twist this way, that way, go forward a bit, or go backward a bit" [Turnbull-BA26].

Walk development (SOURCED):

- Rehearsals were used "to show him what worked with a walk and what didn't work with a walk" [Netflix-BTS] (captions do not name the speaker, most likely Turnbull). No source says what did not work.
- Dorobantu's second audition was "videos, like walking with the hand" [Dorobantu-Spotlight].
- "Even walking is very specific. It has to be balanced. It has to be with a specific emotion, anger or happiness." He also warns against making it "look like a cartoon character" [Dorobantu-Spotlight].
- Dollies and camera rigs were used "to improve Victor's freedom of movement for long walking shots" [Turnbull-AoV] and "having a dolly carry him around for speedy movement" [Tudum].
- Contact errors were fixed in post: "if his finger slides on the floor in a way that it shouldn't make total contact, then we'd go in and start manipulating it" [Turnbull-BA26].

CG animators on matching him (SOURCED):

- MARZ tests "explored how Thing may walk, crawl, leap, carry objects, communicate, rolling onto its stump so the fingers could emote/perform, and there were early discussions of a potential parkour movement" [MARZ-vfxwire].
- "Some of the early tests were how would a walk cycle look like with a hand. It's looking at it like an upright human being walking. The great advantage Thing has is he can move from all fours to upright to back to all fours. The direction we were getting was almost like parkour." Burton cares about "posing and silhouettes". Buster Keaton was a reference [MARZ-VFXV].
- "In many instances, it was a process to make the animation less smooth to feel more like real human movement." "We had to match Victor's incredible swagger." "The twitchiness which is what makes Thing… Thing!" [MARZ-vfxwire].
- Season 2: tabletop Vicon mocap of Dorobantu's hand. WeFX "built a library of walk and run cycles". Most screen time was hand-keyed interaction, not locomotion [Turnbull-BA26].

Direct frame observation ([Clip-Wed], 640x360):

- 0:22 to 0:25, 0:43 to 0:47, 1:00 to 1:03. Side views on a desk. Thing is standing, not walking. Stump is tall and at the top rear. Back of hand slopes forward and down at roughly 45 to 60 degrees. A long finger, most likely the index, reaches well forward. A near-vertical digit, most likely the thumb, props the rear on the camera side. The pinky is on the far side and not visible.
- 0:24 to 0:25. Thing extends one finger straight forward to point while the other contacts stay planted.
- 2:14 to 2:17. Low front view of Thing walking on a bed. Motion blur and resolution hide the digits. Stump stays upright during the move.
- Most of this compilation is held poses with short moves between them.

Not confirmed for Wednesday: footfall order, cadence, pinky handling, run and sneak variants.

### 2.3 Animated films (2019, 2021)

- Full CG by Cinesite (source: Cinesite news page and trade coverage, found via search only).
- Thing wears a watch with an eye on it, "used at various times to express Thing's feelings, such as indicating exasperation with an eye roll" [Wiki-Thing]. SOURCED, secondary.
- I found no animator or supervisor statement about Thing's gait in these films. Looked at: Cinesite news, Post Magazine, CGW, VFX Voice, befores & afters, by search. I did not pull frames from these films.
- Gait for the animated films: I don't know.

---

## 3. Real hand biomechanics

### 3.1 Digit reach is unequal

SOURCED [FingerLen], 51 adults aged 18 to 30, mean finger length from proximal crease to tip:

| Digit | Mean length | Ratio to middle |
|-------|-------------|-----------------|
| Thumb | 49.5 mm | 0.70 |
| Index | 63.9 mm | 0.90 |
| Middle | 70.7 mm | 1.00 |
| Ring | 65.5 mm | 0.93 |
| Little | 53.3 mm | 0.75 |

Ratios are my arithmetic. The knuckle line is also slanted, so the pinky starts further back as well as being shorter. That second point is general anatomy and I did not source a number for it.

INFERRED consequences for a walker:

- A level palm with all five tips on the ground forces the long fingers to flex while the pinky is near full extension. The pinky has almost no reach margin left.
- If the pinky is given the same stride length or the same forward home offset as the middle finger, its target leaves its reach band early in stance. The IK then either stretches flat and slides or lifts late. Both read as dragging.
- Real hands and both live-action Things avoid this by pitching and tilting the palm and by planting the pinky wide and back with a short stride (section 1, trait 5).

### 3.2 Finger independence

- SOURCED [HagerRoss]: "Movements of the thumb, index finger, and little finger typically were more highly individuated than were movements of the middle or ring fingers." The common belief that the pinky is the least independent digit is not what this study measured. The ring finger is the weak one.
- SOURCED [HagerRoss]: self-paced movements at about 2 Hz "were more highly individuated than were externally paced movements at 3 Hz". Independence drops as speed rises.
- SOURCED [LangSchieber]: "Mechanical coupling limited the independence of the index, middle, and ring fingers to the greatest degree, followed by the little finger, and placed only negligible limitations on the independence of the thumb." Neuromuscular control "primarily limited the independence of the ring, and little fingers during large-arc movements".
- SOURCED [vonSchroeder]: "Independent extension of each finger is not possible because of anatomic constraints including the juncturae tendinum and intertendinous fascia between the extrinsic extensor tendons."

INFERRED consequences:

- When a real ring finger lifts, the middle and pinky move with it. A believable hand gait lets neighbours ghost each other's lift by a small fraction instead of holding them rigid.
- At scuttle speed, treat ring and pinky as a coupled pair that swings together. At slow walk they can separate.
- The thumb is mechanically free. It can keep its own timing.

### 3.3 Walking on fingertips is hard for a real hand

- SOURCED [Hart]: pain on hard ground, hand iced at night after running on the floor.
- SOURCED [ETH]: "A hand with an opposed thumb and four unequal fingers has no such mirror." Quadruped gait templates assume left-right symmetry and do not transfer. Their hand "rests at a tilt". Each fingertip gets "its own nominal stance position".
- SOURCED (press summary of [ETH], Popular Science): earlier walking robot hands "required altering the hand's structure, making each finger the same length so it could balance".

### 3.4 Digit pairings people use

I found no source on which digit pairings people choose when finger-walking. The common two-finger "walking fingers" gesture uses index and middle. That is general knowledge and unsourced here.

---

## 4. Procedural techniques that produce the look

### 4.1 Body first, feet follow

- SOURCED [Rosen, 3:30 to 4:30]: start with "controller input equals acceleration and wrap everything around there and never interfere with it". "First you do no harm to the game play."
- SOURCED [RainWorld, 8:00 to 10:30]: keep a simple locomotion simulation and put the cosmetic layer on top with "a one-way dependence".
- Fit to Thing: this is literally how the live-action effect worked (section 1, trait 9).

### 4.2 Step triggering and placement

- SOURCED [Weaver]: each leg has a home position "at the center of the leg's reachable area". "When the leg goes out of range, we will trigger a step." The step should "overshoot the home position" by a fraction of the trigger distance, lift along a quadratic Bezier arc, and run through cubic in-out easing.
- SOURCED [Godot]: step destination is the ground hit point "plus the player's velocity". Step when destination and current foot target differ by more than a threshold.
- SOURCED [ETH]: fingertip targets are per digit. Lateral and vertical departures from the nominal stance are penalised four times as strongly as fore-aft motion. Stride happens along the travel axis and the stance shape stays fixed.
- INFERRED for the hand: set each digit's home, trigger radius, and overshoot from its own reach. Pinky and thumb get smaller radii and smaller overshoot. This is the direct fix for a dragged pinky.

### 4.3 Gait pattern and phase

- SOURCED [Weaver]: per-leg triggering alone puts "too many legs up in the air at the same time". Fix by allowing only one diagonal pair to move at a time. Known failure: "one pair of legs hogging the loop" at high speed.
- SOURCED [Godot]: diagonal pairs, one group at a time.
- SOURCED (Wikipedia, Hexapod robotics): gaits can come from a central pattern or from a decentralized scheme where "gaits arise by the interaction between neighbouring legs".
- SOURCED [ETH]: stepping frequency is tied to commanded speed, mapped linearly from 1 Hz at 0.02 m/s to 3.5 Hz at 0.16 m/s. The robot's hand length is not stated in what I read, so scale the speeds before reusing them. The 1 to 3.5 Hz cycle range is a usable starting band for cadence.
- INFERRED for five unequal legs: a five-leg hand has no symmetric pairing. Candidate grouping that matches the observed roles: group A is index plus ring, group B is middle plus pinky, and the thumb steps on its own phase or with group A. Ring and pinky may merge at speed (section 3.2). At slow speed use a one-at-a-time wave so four tips stay down. This grouping is my proposal. No source prescribes it.

### 4.4 Letting a short leg skip or tap

- I found no published write-up of a "skip or tap" rule for a short leg. Stated as a gap.
- INFERRED options, in order of preference: (a) shorter stride and offset home so the pinky never needs to skip, which is what the 1991 frames show. (b) At high speed, let the pinky swing with the ring and touch down for a shorter stance. (c) Let the pinky hover as a non-weight-bearing digit during a run. Option (c) is not supported by any frame I saw.

### 4.5 Body secondary motion

- SOURCED [Rosen, 5:00]: "whenever he accelerates it tilts in that direction".
- SOURCED [Rosen, 6:30]: bounce is larger at low speed and "gets flatter the faster he goes" because gravity is constant and there is less time per step.
- SOURCED [Rosen, 7:30 to 9:00]: linear interpolation looks wrong on organic creatures (paraphrase, the caption is garbled here). A spring damper with stiffness and damping "adds a lot of the nice easing in and follow-through". Landings are handled by adding "downwards force to the crouching spring".
- SOURCED [Rosen, 18:30]: a rotational spring kicked by impulses, used "for footsteps" as well as recoil, to "accent the movements".
- SOURCED [Rosen, 12:30 to 13:00]: a per-bone softness parameter gives secondary wobble.
- SOURCED [Godot]: body height from the average foot position. Body orientation from the plane through the feet.
- SOURCED [Holden]: a critically damped spring "returns to the goal as fast as possible without extra oscillation". Under-damped springs oscillate.
- INFERRED tuning for Thing: body translation and stance height near critical damping with high stiffness, which gives the hard stops in trait 3. Stump pitch and yaw slightly under-damped, which gives one small overshoot on stops and reads as the head settling. Per-footfall impulses into the stump spring give the twitch without bobbing the palm.

### 4.6 Foot roll and toe-off

- I found no source specific to fingertip roll.
- OBSERVED: in the 1991 frames the fingers stay close to straight through stance and the tips look like point contacts. No visible roll at this resolution.
- INFERRED: keep the distal joint slightly flexed at touchdown and let it straighten through stance. Skip a heel-to-toe roll.

### 4.7 Anticipation, follow-through, and response feel

- SOURCED (Wikipedia, Twelve basic principles of animation): anticipation prepares the audience for an action. Squash and stretch gives weight.
- SOURCED [Rosen, 9:30]: a small anticipation at the start of a curve makes manufactured momentum look "a lot more plausible". [Rosen, 21:30]: add a reusable overshoot curve instead of animating overshoot by hand.
- SOURCED [RainWorld, 7:00 to 8:00]: visible cause and effect in procedural motion makes players "project personality" onto a creature.
- Steve Swink's attack and release envelope model for input response is in his book *Game Feel*. I could not verify it online. His article only defines response as "how the system processes, modifies, and responds to player input in real time".
- INFERRED for Thing: anticipation should be a posture change, not a delay. A quick stump dip or lean one or two frames before the first step keeps the staccato start. Follow-through belongs on the stump, not the feet.

### 4.8 Other hand creatures

- ETH Zurich walking hand [ETH]: adds what Thing lacks, a physically valid gait for an unequal-fingered hand with per-digit targets and learned per-digit timing. Useful as a parameter reference.
- Evil Dead II: the film used "extensive stop-motion animation" (Wikipedia). The Rick Catizone interview on the hand armature did not load. No gait notes obtained.
- Elden Ring Fingercreepers: I found no developer animation notes. One search. An Xbox Wire interview with Miyazaki mentions them and I did not read it.

---

## 5. Unconfirmed items and open questions

### Looked for and could not confirm

| Item | Where I looked |
|------|----------------|
| Footfall order, any source | All interviews in section 6. Frames from two clips at 360p. |
| Step cadence, any source | Same. The only hard number is the robot's 1 to 3.5 Hz range. |
| Pinky handling in Wednesday | Pinky is on the far side in every side view in [Clip-Wed]. |
| Walk versus run versus sneak versus turn differences | No source separates them. WeFX mentions "walk and run cycles" with no detail. |
| What "didn't work with a walk" in Dorobantu's rehearsals | [Netflix-BTS] raises it and gives no detail. The befores & afters podcast with Turnbull (2023-08-22) has no transcript. |
| Gait in the 2019 and 2021 animated films | Trade press by search. No frames pulled. |
| Cinefex coverage of the 1991 film | Not online. |
| "No Small Parts" episode on Hart | Video only, not transcribed here. |
| Which fingers people pair when finger-walking | No source found. |

### Method notes

- Video tools: `ffmpeg` present. `yt-dlp` was not on PATH but was importable as a Python module and worked on the second attempt.
- Two clips pulled, per the brief. Frames are in the session scratchpad under `thing-frames/`. Nothing was added to the repo besides this file.
- A side-on, well-lit walking shot at 720p or higher would settle footfall order and cadence. Candidates: the 1991 stair and hallway runs, and the Wednesday season 1 episode 1 dorm sequence. I did not pull these.

### Questions for the owner

1. Which Thing is the target? The 1991 Hart version is tall, fanned, and staccato. The Wednesday version adds a taller stump, swagger, and more gesture.
2. Does the rig have a wrist stump, and can it pitch and yaw separately from the palm? Traits 1 and 2 depend on it.
3. What does "drags the pinky" look like on screen? Tip sliding while planted, lifting late, or trailing behind the hand in the rest pose? Each has a different fix.
4. Which speed matters most: creep, walk, or scuttle?
5. Is a light, non-load-bearing tap acceptable, given that the real effect had the arm carrying the weight? Or should it look like the fingers support the body?
6. Right hand or left hand? The 1991 Thing is Hart's right hand [Wiki-Thing]. Wednesday season 2 identifies Thing as a right hand in story [Turnbull-BA26].

---

## 6. Sources

| Key | Source |
|-----|--------|
| [Munro] | Alan Munro, VFX supervisor, 1991 film. https://beforesandafters.com/2019/10/07/you-might-be-surprised-how-thing-was-made-for-the-addams-family |
| [Hart] | Christopher Hart interview. https://www.cracked.com/article_36050_i-was-the-hand-for-thing-in-the-addams-family.html |
| [Turnbull-AoV] | Tom Turnbull, production VFX supervisor, Wednesday. https://www.artofvfx.com/wednesday-tom-turnbull-production-vfx-supervisor/ |
| [Turnbull-BA26] | Turnbull, Tristan Versluis, Sam Javanrouh (WeFX), season 2. https://beforesandafters.com/2026/03/02/the-thing-about-thing/ |
| [Turnbull-MPA] | Turnbull. https://www.motionpictures.org/2023/06/how-the-wednesday-visual-effects-supervisor-created-thing-nevermore-academy-more/ |
| [MARZ-vfxwire] | Lon Molnar, MARZ. https://vfxwire.com/breakdowns/how-marz-created-spooky-vfx-for-addams-family-spin-off-wednesday |
| [MARZ-VFXV] | Lon Molnar in VFX Voice. https://vfxvoice.com/?p=13137990 |
| [MARZ-BA23] | MARZ team. https://beforesandafters.com/2023/01/18/a-cg-test-for-thing-in-wednesday-involved-several-tests-including-animating-a-short-with-a-dancing-appendage/ |
| [Dorobantu-Spotlight] | Victor Dorobantu. https://www.spotlight.com/news-and-advice/the-industry/my-casting-story-victor-teodor-dorobantu-netflix-wednesday/ |
| [Netflix-BTS] | Still Watching Netflix making-of, official captions. https://www.youtube.com/watch?v=pPosAHahdXI |
| [Tudum] | https://www.netflix.com/tudum/articles/wednesday-thing-interview-video |
| [Wiki-Thing] | https://en.wikipedia.org/wiki/Thing_(The_Addams_Family) |
| [Clip-1991] | "THE ADDAMS FAMILY, Official Trailer", Paramount Movies. https://www.youtube.com/watch?v=A6X4VAHdDVg |
| [Clip-Wed] | "Thing's Greatest Hits, Wednesday", Netflix Philippines. https://www.youtube.com/watch?v=UMWaiehKCWM |
| [Rosen] | David Rosen, GDC 2014, "An Indie Approach to Procedural Animation". Timestamps are from auto-captions. https://www.youtube.com/watch?v=LNidsMesxSE and https://www.gdcvault.com/play/1020583/Animation-Bootcamp-An-Indie-Approach |
| [RainWorld] | Joar Jakobsson and James Therrien, GDC 2016, "The Rain World Animation Process". https://www.youtube.com/watch?v=sVntwsrjNe4 |
| [Weaver] | Weaver Dev procedural animation tutorial. https://weaverdev.io/projects/proc-anim-tutorial |
| [Godot] | 80 Level write-up of a Godot procedural spider. https://80.lv/articles/ik-driven-procedural-spider-locomotion-in-godot-4-5 |
| [ETH] | Kazemipour, Zheng, Katzschmann, "Fingers as Legs", arXiv preprint, not peer reviewed. https://arxiv.org/abs/2609.17172 . Press summary: https://www.popsci.com/technology/robot-hand-thing-addams-family/ |
| [Holden] | Daniel Holden, "Spring-It-On". https://theorangeduck.com/page/spring-roll-call |
| [HagerRoss] | Häger-Ross and Schieber, J Neurosci 2000. https://doi.org/10.1523/JNEUROSCI.20-22-08542.2000 |
| [LangSchieber] | Lang and Schieber, J Neurophysiol 2004. https://doi.org/10.1152/jn.00480.2004 |
| [vonSchroeder] | von Schroeder and Botte, Clin Orthop Relat Res 2001. https://doi.org/10.1097/00003086-200102000-00010 |
| [FingerLen] | Anat Cell Biol 57(2), hand parameters in young adults. https://synapse.koreamed.org/articles/1516087497 |
| Other | https://en.wikipedia.org/wiki/Hexapod_(robotics) , https://en.wikipedia.org/wiki/Twelve_basic_principles_of_animation , https://en.wikipedia.org/wiki/Evil_Dead_II , https://www.gamedeveloper.com/design/game-feel-the-secret-ingredient |
