// src/gestures.js — gesture pose-track definitions + sampler (buddy vocabulary).
// A gesture: { dur, body?: {pitch,roll,height: Track}, splay?: {fingers,track},
//   digits?: { finger: { base:{yaw,mcp,pip}, yaw?/mcp?/pip?: Track, win?:[u0,u1] } } }.
// Track = [[u, value], ...], u in 0..1 of dur — smoothstep between keys, clamped at
// the ends. Digit tracks add to base; u is re-normalized to the win window, and the
// digit re-plants via a real swing when the window closes (main.js aloft-exit path).
//
// Authoring rules (refuted approaches — do not rediscover):
// - NO body heading track, ever: ±0.25 rad heading with world-pinned feet drives
//   stance err past the 0.05 rescue threshold → every digit re-swings (traced).
//   Head-shake motion comes from a digit (see 'no').
// - Digit base poses stay part-curled (pip ≥ ~0.5): near-straight bases at
//   RATE_CARRY 7 sweep a long lever arc and visibly snap (measured 0.107u/frame).

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
};
