// src/gestures.js — gesture pose-track definitions + sampler (buddy vocabulary).
// A gesture: { dur, hover?: true, body?: {pitch,roll,height,lift: Track},
//   splay?: {fingers,track},
//   digits?: { finger: { base:{yaw,mcp,pip} | 'rest', yaw?/mcp?/pip?: Track, win?:[u0,u1] } } }.
// base 'rest' = the digit's own stance angles (tip on its rest spot at offset 0).
// Track = [[u, value], ...], u in 0..1 of dur — smoothstep between keys, clamped at
// the ends. Digit tracks add to base; u is re-normalized to the win window, and the
// digit re-plants via a real swing when the window closes (main.js aloft-exit path).
//
// hover: true (thumbsUp/thumbsDown/flipBird) lifts the WHOLE hand off the ground —
// every digit needs a `digits[f]` entry (no digit falls through to stance/tuck), and
// `body.lift` is a direct world-Y offset (bypasses the capped-force stance spring,
// which can't produce a clean full liftoff — see main.js's `hovering()`). Body pose is
// applied as Euler order YZX (roll, heading, pitch): pitch is the MIDDLE axis and gimbal-
// locks at ±90°, roll is the last axis and doesn't. So TOTAL body pitch (the -0.6 posture
// plus the track) stays within ±1.2 rad, and anything bigger goes on `roll`. The perch
// peaks at +1.1 rad total (63°, measured on mount.rotation.z). heading always stays 0 (below).
// `face: true` = a sign made AT someone: the brain turns the hand to the viewer first.
//
// Authoring rules (refuted approaches — do not rediscover):
// - NO body heading track, ever: ±0.25 rad heading with world-pinned feet drives
//   stance err past the 0.05 rescue threshold → every digit re-swings (traced).
//   Head-shake motion comes from a digit (see 'no').
// - Digit base poses stay part-curled (pip ≥ ~0.5) for any digit meant to read as
//   EXTENDED: near-straight bases at RATE_CARRY 7 sweep a long lever arc and
//   visibly snap (measured 0.107u/frame) — this applies to hover's extended digit
//   too, since it's driven through the same poseLeg/RATE_CARRY path. A FIST
//   (high curl) is the opposite lever case and is not at risk.

export function sampleTrack(track, u) {
  if (!track) return 0;
  const n = track.length - 1;
  if (u <= track[0][0]) return track[0][1];
  if (u >= track[n][0]) return track[n][1];
  let i = 0;
  while (track[i + 1][0] < u) i++;
  const [u0, v0] = track[i], [u1, v1] = track[i + 1];
  const t = (u - u0) / (u1 - u0);
  return v0 + (v1 - v0) * t * t * (3 - 2 * t);
}

// keys at quarter-cycle points of env(u)·sin(2π·cycles·u); env is a Track
// (default: sin(πu) fade-in/out)
function osc(cycles, amp, env) {
  const n = 4 * cycles, keys = [];
  for (let k = 0; k <= n; k++) {
    const u = k / n;
    const e = env ? sampleTrack(env, u) : Math.sin(Math.PI * u);
    keys.push([u, amp * e * Math.sin(2 * Math.PI * cycles * u)]);
  }
  return keys;
}

// n dips to `a` and back between u0 and u1, level outside: a nod or a chuckle is dips with
// a hard stop between them, not a sine
const dips = (n, a, u0, u1) => [[0, 0],
  ...Array.from({ length: 2 * n + 1 }, (_, i) => [u0 + (u1 - u0) * i / (2 * n), i % 2 ? a : 0]), [1, 0]];

const TAP_LIFT = -0.35;
// lean in and level the palm, so an index at full extension reaches level (point, beckon)
const LEAN_IN = { pitch: [[0, 0], [0.12, -0.06], [0.28, 0.24], [0.75, 0.24], [1, 0]],
  height: [[0, 0], [0.12, 0.03], [0.28, -0.13], [0.75, -0.13], [1, 0]] };
const LEVEL = { yaw: 0, mcp: -0.55, pip: 0.5 };                      // rad of MCP extension that lifts a tapping digit off its rest
const CURL = { yaw: 0, mcp: 0, pip: 0.5 };   // lifted part-curled base (the "no" point)
const WAVE_CURL = { yaw: 0, mcp: -0.25, pip: 0.65 };
const WAVE_BOB = osc(2, 0.3);
const FIST = { yaw: 0, mcp: 1.3, pip: 1.6 };  // tight curl for the 4 non-extended hover digits
// thumb folded across the fist. FIST on the thumb drives its CMC 1.3 rad toward the
// floor: level at stance height it speared the ground and snapped 0.73 u on exit
const THUMB_TUCK = { yaw: 0, mcp: 0.25, pip: 1.4 };
// hover set-down: every hover digit closes its window at HOVER_WIN[1] (roll must be back
// to 0 by then), opens to the stance pose in the air over HOVER_UNFURL of the gesture,
// and only THEN does the lift lower the hand onto its fingertips (lift holds to 0.85).
// The lift must clear a finger pointing straight down mid-unfurl: 0.22 was too low.
const HOVER_WIN = [0, 0.7];
const HOVER_LIFT = [[0, 0], [0.15, 0.45], [0.85, 0.45], [1, 0]];
// hand signs: `extended` digits (one name or a list) hold `pose`, the rest make a fist
const hoverDigits = (extended, pose = CURL, thumb = FIST) => Object.fromEntries(
  ['thumb', 'index', 'middle', 'ring', 'pinky'].map(f =>
    [f, { base: [extended].flat().includes(f) ? pose : f === 'thumb' ? thumb : FIST, win: HOVER_WIN }]));
// the on-edge presentation every sign shares: lift, roll thumb-up, hold, roll back, set down
const SIGN_ROLL = [[0, 0], [0.22, -1.4], [0.55, -1.4], [0.7, 0], [1, 0]];
const LEVEL_PALM = [[0, 0], [0.22, 0.6], [0.55, 0.6], [0.7, 0], [1, 0]];   // cancels the standing posture for the hold
const sign = (extended, thumb = THUMB_TUCK) => ({
  dur: 1.8, hover: true, face: true, body: { lift: HOVER_LIFT, roll: SIGN_ROLL }, digits: hoverDigits(extended, CURL, thumb),
});
// finger snap: thumb and middle meet, the middle whips into the palm, and the sound
// lands on that frame (`cue` = [gesture u, name], played by main.js). There is no
// finger-to-thumb contact solver: timing and the click sell it.
const snapDigits = (whips) => {
  const d = hoverDigits(['thumb', 'middle'], { yaw: 0, mcp: 0.35, pip: 0.75 }, CURL);
  d.thumb.base = { yaw: 0, mcp: 0.15, pip: 0.6 };
  d.middle.mcp = whips.flatMap(u => [[u - 0.06, 0], [u, 0.95], [u + 0.14, 0.95], [u + 0.2, 0]]);
  return d;
};

// Morse: the index taps real code on the floor. A dot is a tap, a dash is a press held
// three units. Each strike carries a `dit` or `dah` cue so the beep lands on contact.
const MORSE = { a: '.-', b: '-...', c: '-.-.', d: '-..', e: '.', f: '..-.', g: '--.', h: '....', i: '..',
  j: '.---', k: '-.-', l: '.-..', m: '--', n: '-.', o: '---', p: '.--.', q: '--.-', r: '.-.', s: '...',
  t: '-', u: '..-', v: '...-', w: '.--', x: '-..-', y: '-.--', z: '--..', 0: '-----', 1: '.----',
  2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.' };
const MORSE_LIFT = -0.3;                   // rad of MCP extension between strikes
export const MORSE_UNIT = 0.12;              // s sim per Morse unit: the down-stroke stays under RATE_CARRY
export const MORSE_MAX = 8;                  // characters: past this the bit drags
export function morseGesture(text) {
  const chars = [...String(text).toLowerCase()].filter(c => MORSE[c]).slice(0, MORSE_MAX);
  if (!chars.length) return null;
  const els = [];                            // [start, length] in units
  let t = 2;                                 // lead-in: the finger lifts first
  for (const c of chars) {
    for (const e of MORSE[c]) { const len = e === '.' ? 1 : 3; els.push([t, len]); t += len + 1; }
    t += 2;                                  // letter gap (3 units with the element gap)
  }
  const n = t + 1, mcp = [[0, 0]], cue = [];
  for (const [s, len] of els) {
    mcp.push([(s - 0.45) / n, MORSE_LIFT], [s / n, 0], [(s + len) / n, 0], [(s + len + 0.5) / n, MORSE_LIFT]);
    cue.push([s / n, len === 1 ? 'dit' : 'dah']);
  }
  mcp.push([(n - 0.4) / n, MORSE_LIFT], [1, 0]);
  return { dur: n * MORSE_UNIT, text: chars.join(''), cue,
    body: { pitch: [[0, 0], [1.5 / n, 0.05], [(n - 1.5) / n, 0.05], [1, 0]] },
    digits: { index: { base: 'rest', mcp } } };
}
// a level envelope for loops that should hold their size (osc's default fades in and out)
const HOLD = [[0, 0], [0.07, 1], [0.93, 1], [1, 0]];
const KNOCKS = [0.3, 0.47, 0.64].map(u => 0.05 + u * 0.87), KNOCK_REAR = -0.18;   // gesture u of each rap
const DANCE_BEATS = 8;
const DEAD_ROLL = 3.0, DEAD_PITCH = 0.6, DEAD_LIFT = -1.05;   // on its back, level, wrist near the floor
const FLARE = { yaw: 0, mcp: -0.3, pip: 0.55 };
const THROW = { yaw: 0, mcp: -0.5, pip: 0.6 };   // a digit thrown high in the dance

export const GESTURES = {
  // nod: a small wind-up, two dips of the stump, a hard stop. The body sinks with the pitch
  // or the planted digits cannot follow (osc(2, 0.16) with no sink moved the stump 7 px on
  // screen: nothing). Measured: 0 re-steps, 5 planted
  yes: { dur: 1.0, body: {
    pitch:  [[0, 0], [0.1, -0.05], [0.28, 0.26], [0.42, 0.06], [0.58, 0.26], [0.8, 0], [1, 0]],
    height: [[0, 0], [0.1, 0.02], [0.28, -0.14], [0.42, -0.03], [0.58, -0.14], [0.8, 0], [1, 0]] } },
  // cross: the whole hand shakes itself. Roll holds on planted digits to 0.3 rad (scanned);
  // at 0.22 the twist did not read from the app camera
  shake: { dur: 0.9, body: { roll: [[0, 0], [0.15, 0.28], [0.4, -0.28], [0.65, 0.28], [0.85, 0], [1, 0]] } },
  no:  { dur: 1.3, digits: { index: { base: CURL, yaw: osc(3, 0.28) } } },
  // shrug: snappy rise+pitch-back (fast rise, slow settle), splayed fingers, thumb
  // flares out and re-plants during the settle
  // (rear-back holds on planted digits to pitch -0.3 with height +0.08: scanned)
  idk: {
    dur: 1.3,
    body: {
      pitch:  [[0, 0], [0.15, -0.26], [0.6, -0.22], [1, 0]],
      height: [[0, 0], [0.15, 0.08], [0.6, 0.07], [1, 0]],
      roll:   [[0, 0], [0.15, 0.12], [0.6, 0.1], [1, 0]],
    },
    splay: { fingers: ['index', 'pinky'], track: [[0, 0], [0.15, 0.14], [0.6, 0.12], [1, 0]] },
    digits: { thumb: { base: { yaw: 0, mcp: -0.3, pip: 0.55 }, win: [0, 0.75] } },
  },
  // hello: fingers lift and bob in a ripple (index→pinky), each re-planting via a
  // real swing as its window closes
  wave: {
    dur: 1.6,
    digits: {
      index:  { base: WAVE_CURL, pip: WAVE_BOB, win: [0, 0.4] },
      middle: { base: WAVE_CURL, pip: WAVE_BOB, win: [0.15, 0.55] },
      ring:   { base: WAVE_CURL, pip: WAVE_BOB, win: [0.3, 0.7] },
      pinky:  { base: WAVE_CURL, pip: WAVE_BOB, win: [0.45, 0.85] },
    },
  },
  // chuckle: five dips with a sway under them (a 0.05 sine bounce was 5 px on screen).
  // Measured: 0 re-steps, 5 planted
  laugh: { dur: 1.3, body: { height: dips(5, -0.11, 0.08, 0.8), pitch: dips(5, 0.1, 0.08, 0.8),
    roll: [[0, 0], [0.2, 0.07], [0.5, -0.07], [0.8, 0.05], [1, 0]] } },
  // a deep bow and hold: the stump (the tall stance's "head") comes down level while
  // the body sinks (positive pitch = stump-down — opposite of idk's rear-back). Pitch
  // 0.35 is past what the planted digits hold: they re-step (scanned: 0.3 holds, err 0.039)
  bow: {
    dur: 1.6,
    body: {
      pitch:  [[0, 0], [0.1, -0.05], [0.3, 0.28], [0.65, 0.28], [1, 0]],
      height: [[0, 0], [0.1, 0.03], [0.3, -0.18], [0.65, -0.18], [1, 0]],
    },
  },
  // point: lean in and level the palm so the index can reach level. The MCP stops at
  // -0.55 and the palm stands 34° nose-down: on the standing posture an index at
  // mcp -0.35 still pointed 30° into the floor (measured). 0 re-steps
  point: { dur: 1.6, body: LEAN_IN, digits: { index: { base: LEVEL, win: [0.1, 0.8] } } },
  // come here: the same level index, curled in twice
  beckon: { dur: 1.6, body: LEAN_IN, digits: { index: { base: LEVEL, win: [0.1, 0.8],
    pip: [[0, 0], [0.25, 0], [0.42, 0.8], [0.58, 0], [0.75, 0.8], [0.92, 0], [1, 0]] } } },
  // hmm: the head cocks and stays cocked while the index taps the floor, slowly, twice
  thinking: {
    dur: 2.2,
    body: { roll: [[0, 0], [0.1, 0.26], [0.85, 0.26], [1, 0]], pitch: [[0, 0], [0.1, -0.12], [0.85, -0.12], [1, 0]] },
    digits: { index: { base: 'rest', win: [0.1, 0.95],
      mcp: [[0, 0], [0.25, TAP_LIFT], [0.32, 0], [0.5, 0], [0.6, TAP_LIFT], [0.67, 0], [1, 0]] } },
    cue: [0.32, 0.67].map(u => [0.1 + u * 0.85, 'tick']),
  },
  // impatient: index drums the ground. base 'rest' + a lift offset: offset 0 IS the
  // tip on the floor, so every down-stroke strikes exactly, at any posture
  tap: {
    dur: 1.3,
    body: { pitch: [[0, 0], [0.08, 0.12], [0.9, 0.12], [1, 0]], height: [[0, 0], [0.08, -0.06], [0.9, -0.06], [1, 0]] },
    cue: [0.16, 0.38, 0.6, 0.82].map(u => [u, 'tick']),
    digits: { index: { base: 'rest',
      mcp: [[0, 0], [0.08, TAP_LIFT], [0.16, 0], [0.22, 0], [0.3, TAP_LIFT],
        [0.38, 0], [0.44, 0], [0.52, TAP_LIFT], [0.6, 0], [0.66, 0],
        [0.74, TAP_LIFT], [0.82, 0], [0.88, 0], [1, 0]] } },
  },
  // hover: full liftoff, fist + thumb. The palm levels (pitch) and rolls past its edge:
  // at roll -1.4 on the standing posture the thumb pointed at the viewer, never up (filmed)
  thumbsUp: {
    dur: 1.8, hover: true, face: true,
    body: { lift: HOVER_LIFT, roll: [[0, 0], [0.22, -2.6], [0.55, -2.6], [0.7, 0], [1, 0]],
      pitch: LEVEL_PALM },
    digits: hoverDigits('thumb'),
  },
  // the thumb points DOWN: the wrist must ride a thumb-length higher than the other
  // hovers, and stay up until the roll is back — at HOVER_LIFT the thumb speared the
  // floor and the ground constraint snapped it 1.3-1.6 u in one step, twice per play
  thumbsDown: {
    dur: 1.8, hover: true, face: true,
    body: { lift: [[0, 0], [0.2, 0.8], [0.85, 0.8], [1, 0]],
      roll: [[0, 0], [0.12, 0], [0.3, 1.4], [0.55, 1.4], [0.7, 0], [1, 0]] },
    digits: hoverDigits('thumb'),
  },
  // middle finger extended, same roll thumbsUp/Down use (pitch was tried first —
  // rejected in-sim, the whole hand read as bunched to one side instead of a clean
  // one-finger-up silhouette; roll reads cleanly since it already works for thumb)
  flipBird: {
    dur: 1.8, hover: true, face: true,
    body: { lift: HOVER_LIFT, roll: [[0, 0], [0.22, -1.4], [0.55, -1.4], [0.7, 0], [1, 0]] },
    digits: hoverDigits('middle', CURL, THUMB_TUCK),
  },
  peace: sign(['index', 'middle']),
  horns: sign(['index', 'pinky']),
  fingerGun: sign(['index', 'thumb'], CURL),
  highFive: sign(['thumb', 'index', 'middle', 'ring', 'pinky']),
  // whip keys are in the digit window's own 0..1 (HOVER_WIN = 0.7 of the gesture)
  // (the roll leaves at u 0.55: the last click lands before 0.47 so the pose holds a beat after it)
  snap: { dur: 1.4, hover: true, face: true, body: { lift: HOVER_LIFT, roll: SIGN_ROLL, pitch: LEVEL_PALM },
    digits: snapDigits([0.6]), cue: [[0.6 * 0.7, 'snap']] },
  // two snaps: Thing's remote. The second one works the light switch from anywhere.
  doubleSnap: { dur: 1.8, hover: true, face: true, body: { lift: HOVER_LIFT, roll: SIGN_ROLL, pitch: LEVEL_PALM },
    digits: snapDigits([0.42, 0.66]), cue: [[0.42 * 0.7, 'snap'], [0.66 * 0.7, 'snap'], [0.66 * 0.7, 'remote']] },
  // rap on the glass: the index cocks back and knocks three times. The knock sound and
  // a camera shake land on each strike (cues, played by main.js)
  // The whole hand pecks with each rap: the index alone moved a few pixels (filmed)
  knock: {
    dur: 1.7,
    body: { pitch: [[0, 0], [0.15, KNOCK_REAR], ...KNOCKS.flatMap(u => [[u - 0.06, KNOCK_REAR], [u, 0.16], [u + 0.06, KNOCK_REAR]]), [0.85, KNOCK_REAR], [1, 0]],
      height: [[0, 0], [0.15, 0.05], ...KNOCKS.flatMap(u => [[u - 0.06, 0.05], [u, -0.08], [u + 0.06, 0.05]]), [0.85, 0.05], [1, 0]] },
    digits: { index: { base: { yaw: 0, mcp: -0.5, pip: 0.85 }, win: [0.05, 0.92],
      mcp: [0.3, 0.47, 0.64].flatMap(u => [[u - 0.07, 0], [u, 0.4], [u + 0.07, 0]]) } },
    cue: KNOCKS.map(u => [u, 'knock']),
  },
  // dance: bounce on the beat, sway, and throw one digit after another. The beat is cues.
  dance: {
    dur: 0.6 * DANCE_BEATS,
    // the bounce digs deeper and the stump dips at the end of each four: an accent
    body: { height: osc(DANCE_BEATS, 0.1, HOLD).map(([u, v], k) => k === 15 || k === 27 ? [u, -0.17] : [u, v]),
      roll: osc(DANCE_BEATS / 2, 0.16, HOLD),
      pitch: [[0, 0], [0.125, 0.09], [0.25, 0], [0.375, -0.09], [0.44, 0], [0.469, 0.2], [0.5, 0], [0.625, 0.09], [0.75, 0], [0.81, 0], [0.844, 0.2], [0.875, -0.09], [1, 0]] },
    digits: {
      index:  { base: THROW, pip: osc(2, 0.35), win: [0.04, 0.28] },
      pinky:  { base: THROW, pip: osc(2, 0.35), win: [0.27, 0.51] },
      middle: { base: THROW, pip: osc(2, 0.35), win: [0.5, 0.74] },
      thumb:  { base: FLARE, pip: osc(2, 0.25), win: [0.72, 0.95] },
    },
    cue: Array.from({ length: DANCE_BEATS * 2 }, (_, k) => [k / (DANCE_BEATS * 2) + 0.002, k % 2 ? 'hat' : `beat${(k / 2) % 4}`]),
  },
  // play dead: up, over onto its back, down to the floor, legs in the air, one last
  // twitch. Then it gets up as if nothing happened. `pitch` cancels the walking
  // posture so the hand lies level (pitch stays far from its ±90° gimbal lock).
  playDead: {
    dur: 6, hover: true,
    body: {
      lift:  [[0, 0], [0.07, 0.5], [0.22, 0.5], [0.28, DEAD_LIFT], [0.5, DEAD_LIFT], [0.57, 0.5], [0.85, 0.5], [1, 0]],
      // it reels once at the top of the lift, then goes over. (A reel during the lift put the
      // thumb through the floor: 0.51 u in one step)
      roll:  [[0, 0], [0.07, 0], [0.1, 0.3], [0.13, -0.2], [0.22, DEAD_ROLL], [0.57, DEAD_ROLL], [0.68, 0], [1, 0]],
      pitch: [[0, 0], [0.13, 0], [0.22, DEAD_PITCH], [0.57, DEAD_PITCH], [0.68, 0], [1, 0]],
    },
    digits: Object.fromEntries(['thumb', 'index', 'middle', 'ring', 'pinky'].map((f, i) => [f, {
      base: { yaw: 0, mcp: 0.45, pip: 1.0 }, win: HOVER_WIN,
      // the legs curl in one after another, and the middle one twitches late
      pip: f === 'middle' ? [[0, -0.5], [0.4, -0.5], [0.5, 0], [0.62, 0], [0.65, -0.45], [0.69, 0], [1, 0]]
        : [[0, -0.5], [0.36 + 0.03 * i, -0.5], [0.46 + 0.03 * i, 0], [1, 0]],
    }])),
    cue: [[0.28, 'knock']],                    // the thud as it hits the floor
  },
  morse: morseGesture('sos'),                // the brain's morse action swaps in the asked text
  // nap: settle low with the stump laid down level, lean over, and breathe slowly for the
  // whole hold — user-invokable ("take a nap") and the payoff of the 'nap' idle
  // behavior. Long dur is fine: any input cancels via the normal gesture path.
  sleep: {
    dur: 16,
    body: {
      height: (() => {
        const keys = [[0, 0], [0.05, -0.18]];
        for (let k = 0; k <= 16; k++)
          keys.push([0.06 + 0.86 * k / 16, -0.18 + 0.02 * Math.sin(2 * Math.PI * 4 * k / 16)]);
        keys.push([1, 0]);
        return keys;
      })(),
      pitch: [[0, 0], [0.06, 0.25], [0.94, 0.25], [1, 0]],
      roll:  [[0, 0], [0.06, 0.1], [0.94, 0.1], [1, 0]],
    },
  },
};

// idles: subtle low-amplitude fidgets, weighted-random after IDLE_AFTER s without
// input (see step()); same format, w = pick weight
const DRUM_BASE = 'rest';
const DRUM_STROKE = [[0, 0], [0.3, TAP_LIFT], [0.55, 0], [0.7, 0], [1, 0]];
export const IDLES = {
  // (breathe and shift are gone: 2 px and under 1 px on screen. Stillness is the idle.)
  // one digit up at a time: with the windows overlapped only two stayed planted (measured)
  drum: {
    w: 2, dur: 1.5,
    digits: {
      index:  { base: DRUM_BASE, mcp: DRUM_STROKE, win: [0, 0.3] },
      middle: { base: DRUM_BASE, mcp: DRUM_STROKE, win: [0.3, 0.6] },
      ring:   { base: DRUM_BASE, mcp: DRUM_STROKE, win: [0.6, 0.9] },
    },
  },
  // cat stretch: up onto the fingertips, slowly, and down again. (Four fingers lifted at once
  // left it standing on the thumb: measured 1 planted.) The one slow idle
  stretch: {
    w: 2, dur: 2.8,
    body: { pitch: [[0, 0], [0.35, -0.3], [0.65, -0.3], [1, 0]], height: [[0, 0], [0.35, 0.08], [0.65, 0.08], [1, 0]] },
    splay: { fingers: ['index', 'pinky'], track: [[0, 0], [0.35, 0.12], [0.65, 0.12], [1, 0]] },
  },
  // the head cocks, holds, and snaps back: still, then a twitch
  cock: {
    w: 3, dur: 2.2,
    body: { roll: [[0, 0], [0.08, 0.28], [0.8, 0.28], [0.88, 0], [1, 0]], pitch: [[0, 0], [0.08, -0.2], [0.8, -0.2], [0.88, 0], [1, 0]],
      height: [[0, 0], [0.08, 0.05], [0.8, 0.05], [0.88, 0], [1, 0]] },
  },
  // periscope: up tall, look one way, hold, look the other, hold. (A slow 0.12 sway was 5 px.)
  peek: {
    w: 2, dur: 3.6,
    body: { height: [[0, 0], [0.1, 0.08], [0.85, 0.08], [1, 0]], pitch: [[0, 0], [0.1, -0.25], [0.85, -0.25], [1, 0]],
      roll: [[0, 0], [0.12, 0], [0.2, 0.28], [0.42, 0.28], [0.52, -0.28], [0.75, -0.28], [0.85, 0], [1, 0]] },
  },
};
