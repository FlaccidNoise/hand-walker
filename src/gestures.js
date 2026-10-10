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
// which can't produce a clean full liftoff — see main.js's `hovering()`). Large body
// reorientation for a hover MUST use `roll`, not `pitch`: body pose is applied as
// Euler order YZX (roll, heading, pitch) — pitch is the MIDDLE axis, which gimbal-
// locks at ±90°; roll is the last axis and doesn't. heading always stays 0 (below).
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

const TAP_LIFT = -0.35;                      // rad of MCP extension that lifts a tapping digit off its rest
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
const sign = (extended, thumb = THUMB_TUCK) => ({
  dur: 1.8, hover: true, body: { lift: HOVER_LIFT, roll: SIGN_ROLL }, digits: hoverDigits(extended, CURL, thumb),
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
const DANCE_BEATS = 8;
const DEAD_ROLL = 3.0, DEAD_PITCH = 0.6, DEAD_LIFT = -1.05;   // on its back, level, wrist near the floor
const FLARE = { yaw: 0, mcp: -0.3, pip: 0.55 };
const THROW = { yaw: 0, mcp: -0.5, pip: 0.6 };   // a digit thrown high in the dance

export const GESTURES = {
  yes: { dur: 1.1, body: { pitch: osc(2, 0.16) } },
  no:  { dur: 1.3, digits: { index: { base: CURL, yaw: osc(3, 0.28) } } },
  // shrug: snappy rise+pitch-back (fast rise, slow settle), splayed fingers, thumb
  // flares out and re-plants during the settle
  idk: {
    dur: 1.1,
    body: {
      pitch:  [[0, 0], [0.22, -0.15], [0.5, -0.12], [1, 0]],
      height: [[0, 0], [0.2, 0.1], [0.5, 0.08], [1, 0]],
    },
    splay: { fingers: ['index', 'pinky'], track: [[0, 0], [0.22, 0.14], [0.55, 0.12], [1, 0]] },
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
  // giggle: quick body bounces with a pitch jiggle
  laugh: { dur: 1.3, body: { height: osc(4, 0.05), pitch: osc(4, 0.045) } },
  // a deep bow and hold: the stump (the tall stance's "head") comes down level while
  // the body sinks (positive pitch = stump-down — opposite of idk's rear-back). Pitch
  // 0.35 is past what the planted digits hold: they re-step (scanned: 0.3 holds, err 0.039)
  bow: {
    dur: 1.6,
    body: {
      pitch:  [[0, 0], [0.3, 0.28], [0.65, 0.28], [1, 0]],
      height: [[0, 0], [0.3, -0.18], [0.65, -0.18], [1, 0]],
    },
  },
  // index raised to a steady forward point, small emphasis bobs
  point: {
    dur: 1.2,
    digits: { index: { base: { yaw: 0, mcp: -0.35, pip: 0.5 },
      mcp: [[0, 0], [0.3, -0.08], [0.5, 0.02], [0.7, -0.06], [1, 0]] } },
  },
  // come here: index curls twice
  beckon: {
    dur: 1.4,
    digits: { index: { base: { yaw: 0, mcp: -0.3, pip: 0.6 },
      pip: [[0, 0], [0.2, 0.55], [0.4, -0.05], [0.6, 0.55], [0.8, -0.05], [1, 0]] } },
  },
  // hmm: slow rear + side tilt while the index taps the air
  thinking: {
    dur: 2.0,
    body: {
      pitch: [[0, 0], [0.25, -0.07], [0.8, -0.05], [1, 0]],
      roll:  [[0, 0], [0.25, 0.08], [0.8, 0.06], [1, 0]],
    },
    digits: { index: { base: { yaw: 0, mcp: -0.3, pip: 0.7 }, pip: osc(3, 0.18), win: [0.05, 0.9] } },
  },
  // impatient: index drums the ground. base 'rest' + a lift offset: offset 0 IS the
  // tip on the floor, so every down-stroke strikes exactly, at any posture
  tap: {
    dur: 1.3,
    digits: { index: { base: 'rest',
      mcp: [[0, 0], [0.08, TAP_LIFT], [0.16, 0], [0.22, 0], [0.3, TAP_LIFT],
        [0.38, 0], [0.44, 0], [0.52, TAP_LIFT], [0.6, 0], [0.66, 0],
        [0.74, TAP_LIFT], [0.82, 0], [0.88, 0], [1, 0]] } },
  },
  // hover: full liftoff, fist + one extended digit, big body roll (thumb swings
  // from its neutral lateral position to point up/down)
  thumbsUp: {
    dur: 1.8, hover: true,
    body: { lift: HOVER_LIFT, roll: [[0, 0], [0.22, -1.4], [0.55, -1.4], [0.7, 0], [1, 0]] },
    digits: hoverDigits('thumb'),
  },
  // the thumb points DOWN: the wrist must ride a thumb-length higher than the other
  // hovers, and stay up until the roll is back — at HOVER_LIFT the thumb speared the
  // floor and the ground constraint snapped it 1.3-1.6 u in one step, twice per play
  thumbsDown: {
    dur: 1.8, hover: true,
    body: { lift: [[0, 0], [0.2, 0.8], [0.85, 0.8], [1, 0]],
      roll: [[0, 0], [0.12, 0], [0.3, 1.4], [0.55, 1.4], [0.7, 0], [1, 0]] },
    digits: hoverDigits('thumb'),
  },
  // middle finger extended, same roll thumbsUp/Down use (pitch was tried first —
  // rejected in-sim, the whole hand read as bunched to one side instead of a clean
  // one-finger-up silhouette; roll reads cleanly since it already works for thumb)
  flipBird: {
    dur: 1.8, hover: true,
    body: { lift: HOVER_LIFT, roll: [[0, 0], [0.22, -1.4], [0.55, -1.4], [0.7, 0], [1, 0]] },
    digits: hoverDigits('middle', CURL, THUMB_TUCK),
  },
  peace: sign(['index', 'middle']),
  horns: sign(['index', 'pinky']),
  fingerGun: sign(['index', 'thumb'], CURL),
  highFive: sign(['thumb', 'index', 'middle', 'ring', 'pinky']),
  // whip keys are in the digit window's own 0..1 (HOVER_WIN = 0.7 of the gesture)
  snap: { dur: 1.4, hover: true, body: { lift: HOVER_LIFT, roll: SIGN_ROLL },
    digits: snapDigits([0.62]), cue: [[0.62 * 0.7, 'snap']] },
  // two snaps: Thing's remote. The second one works the light switch from anywhere.
  doubleSnap: { dur: 1.8, hover: true, body: { lift: HOVER_LIFT, roll: SIGN_ROLL },
    digits: snapDigits([0.5, 0.78]), cue: [[0.5 * 0.7, 'snap'], [0.78 * 0.7, 'snap'], [0.78 * 0.7, 'remote']] },
  // rap on the glass: the index cocks back and knocks three times. The knock sound and
  // a camera shake land on each strike (cues, played by main.js)
  knock: {
    dur: 1.7,
    body: { pitch: [[0, 0], [0.15, -0.1], [0.85, -0.1], [1, 0]], height: [[0, 0], [0.15, 0.06], [0.85, 0.06], [1, 0]] },
    digits: { index: { base: { yaw: 0, mcp: -0.5, pip: 0.85 }, win: [0.05, 0.92],
      mcp: [0.3, 0.47, 0.64].flatMap(u => [[u - 0.07, 0], [u, 0.4], [u + 0.07, 0]]) } },
    cue: [0.3, 0.47, 0.64].map(u => [0.05 + u * 0.87, 'knock']),
  },
  // dance: bounce on the beat, sway, and throw one digit after another. The beat is cues.
  dance: {
    dur: 0.6 * DANCE_BEATS,
    body: { height: osc(DANCE_BEATS, 0.1, HOLD), roll: osc(DANCE_BEATS / 2, 0.16, HOLD), pitch: osc(DANCE_BEATS / 4, 0.09, HOLD) },
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
      lift:  [[0, 0], [0.07, 0.5], [0.2, 0.5], [0.27, DEAD_LIFT], [0.5, DEAD_LIFT], [0.57, 0.5], [0.85, 0.5], [1, 0]],
      roll:  [[0, 0], [0.07, 0], [0.2, DEAD_ROLL], [0.57, DEAD_ROLL], [0.68, 0], [1, 0]],
      pitch: [[0, 0], [0.07, 0], [0.2, DEAD_PITCH], [0.57, DEAD_PITCH], [0.68, 0], [1, 0]],
    },
    digits: Object.fromEntries(['thumb', 'index', 'middle', 'ring', 'pinky'].map((f, i) => [f, {
      base: { yaw: 0, mcp: 0.45, pip: 1.0 }, win: HOVER_WIN,
      // the legs curl in one after another, and the middle one twitches late
      pip: f === 'middle' ? [[0, -0.5], [0.4, -0.5], [0.5, 0], [0.62, 0], [0.65, -0.45], [0.69, 0], [1, 0]]
        : [[0, -0.5], [0.36 + 0.03 * i, -0.5], [0.46 + 0.03 * i, 0], [1, 0]],
    }])),
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
const STRETCH = { yaw: 0, mcp: -0.35, pip: 0.5 };
export const IDLES = {
  breathe: { w: 4, dur: 3.5, body: { height: osc(2, 0.015) } },
  shift:   { w: 2, dur: 2.8, body: { roll: osc(1, 0.06) } },
  drum: {
    w: 2, dur: 1.5,
    digits: {
      index:  { base: DRUM_BASE, mcp: DRUM_STROKE, win: [0, 0.35] },
      middle: { base: DRUM_BASE, mcp: DRUM_STROKE, win: [0.22, 0.57] },
      ring:   { base: DRUM_BASE, mcp: DRUM_STROKE, win: [0.44, 0.79] },
    },
  },
  // cat stretch: all four fingers extend forward while the body rears slightly
  stretch: {
    w: 2, dur: 2.8,
    body: { pitch: [[0, 0], [0.3, -0.07], [0.7, -0.06], [1, 0]] },
    digits: {
      index:  { base: STRETCH, win: [0.05, 0.9] }, middle: { base: STRETCH, win: [0.08, 0.92] },
      ring:   { base: STRETCH, win: [0.08, 0.92] }, pinky:  { base: STRETCH, win: [0.05, 0.9] },
    },
  },
  // periscope peek: rise up and sway slowly side to side, looking around
  peek: {
    w: 2, dur: 3.6,
    body: { height: [[0, 0], [0.2, 0.07], [0.8, 0.07], [1, 0]], roll: osc(1, 0.12) },
  },
  // idle scritch: index scratches the floor absently
  scratch: {
    w: 1, dur: 2.2,
    digits: { index: { base: { yaw: 0, mcp: -0.05, pip: 1.05 }, mcp: osc(5, 0.12), win: [0.1, 0.9] } },
  },
};
