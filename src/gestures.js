// src/gestures.js — gesture pose-track definitions + sampler (buddy vocabulary).
// A gesture: { dur, hover?: true, body?: {pitch,roll,height,lift: Track},
//   splay?: {fingers,track},
//   digits?: { finger: { base:{yaw,mcp,pip}, yaw?/mcp?/pip?: Track, win?:[u0,u1] } } }.
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

const CURL = { yaw: 0, mcp: 0, pip: 0.5 };   // lifted part-curled base (the "no" point)
const WAVE_CURL = { yaw: 0, mcp: -0.25, pip: 0.65 };
const WAVE_BOB = osc(2, 0.3);
const FIST = { yaw: 0, mcp: 1.3, pip: 1.6 };  // tight curl for the 4 non-extended hover digits
const HOVER_LIFT = [[0, 0], [0.15, 0.22], [0.6, 0.2], [0.85, 0.05], [1, 0]];

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
  // dip forward and hold (positive pitch = stump-down — opposite of idk's rear-back)
  bow: {
    dur: 1.5,
    body: {
      pitch:  [[0, 0], [0.3, 0.18], [0.65, 0.18], [1, 0]],
      height: [[0, 0], [0.3, -0.07], [0.65, -0.07], [1, 0]],
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
  // impatient: index drums the ground (down-strokes push past stance into the
  // ground constraint = the tap)
  tap: {
    dur: 1.3,
    digits: { index: { base: { yaw: 0, mcp: -0.1, pip: 1.1 },
      mcp: [[0, 0], [0.08, -0.15], [0.16, 0.4], [0.22, 0.4], [0.3, -0.15],
        [0.38, 0.4], [0.44, 0.4], [0.52, -0.15], [0.6, 0.4], [0.66, 0.4],
        [0.74, -0.15], [0.82, 0.4], [0.88, 0.4], [1, 0]] } },
  },
  // hover: full liftoff, fist + one extended digit, big body roll (thumb swings
  // from its neutral lateral position to point up/down)
  thumbsUp: {
    dur: 1.8, hover: true,
    body: { lift: HOVER_LIFT, roll: [[0, 0], [0.22, -1.4], [0.7, -1.4], [0.95, -0.15], [1, 0]] },
    digits: {
      thumb: { base: CURL }, index: { base: FIST }, middle: { base: FIST },
      ring: { base: FIST }, pinky: { base: FIST },
    },
  },
  thumbsDown: {
    dur: 1.8, hover: true,
    body: { lift: HOVER_LIFT, roll: [[0, 0], [0.22, 1.4], [0.7, 1.4], [0.95, 0.15], [1, 0]] },
    digits: {
      thumb: { base: CURL }, index: { base: FIST }, middle: { base: FIST },
      ring: { base: FIST }, pinky: { base: FIST },
    },
  },
  // middle finger extended, same roll thumbsUp/Down use (pitch was tried first —
  // rejected in-sim, the whole hand read as bunched to one side instead of a clean
  // one-finger-up silhouette; roll reads cleanly since it already works for thumb)
  flipBird: {
    dur: 1.8, hover: true,
    body: { lift: HOVER_LIFT, roll: [[0, 0], [0.22, -1.4], [0.7, -1.4], [0.95, -0.15], [1, 0]] },
    digits: {
      middle: { base: CURL }, thumb: { base: FIST }, index: { base: FIST },
      ring: { base: FIST }, pinky: { base: FIST },
    },
  },
  // nap: settle low, pitch nose-down, curl slightly, and breathe slowly for the
  // whole hold — user-invokable ("take a nap") and the payoff of the 'nap' idle
  // behavior. Long dur is fine: any input cancels via the normal gesture path.
  sleep: {
    dur: 16,
    body: {
      height: (() => {
        const keys = [[0, 0], [0.05, -0.1]];
        for (let k = 0; k <= 16; k++)
          keys.push([0.06 + 0.86 * k / 16, -0.1 + 0.015 * Math.sin(2 * Math.PI * 4 * k / 16)]);
        keys.push([1, 0]);
        return keys;
      })(),
      pitch: [[0, 0], [0.06, 0.07], [0.94, 0.07], [1, 0]],
      roll:  [[0, 0], [0.06, 0.06], [0.94, 0.06], [1, 0]],
    },
  },
};

// idles: subtle low-amplitude fidgets, weighted-random after IDLE_AFTER s without
// input (see step()); same format, w = pick weight
const DRUM_BASE = { yaw: 0, mcp: -0.1, pip: 1.1 };
const DRUM_STROKE = [[0, 0], [0.3, -0.15], [0.55, 0.4], [0.7, 0.4], [1, 0]];
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
