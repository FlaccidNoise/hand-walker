// src/terrain.js — groundY(x,z): the ONE place the floor shape is expressed. (HANDOFF §3, §7)
// Continuous slopes are a documented trap (§7: walkable ~4° and visible ~8° don't
// overlap) — scope is discrete step obstacles instead, per the spec's own conclusion.
// Height is the max of any box the point falls in, so overlapping boxes/cliff edges
// resolve upward and a foot never falls through a step's interior.

// h=0.15 hard-stalls the walker at the leading edge (scanned via probe.mjs); 0.12
// keeps a safety margin below that cliff while still testing per-foot height
// variance (0.05-0.14 all measured numerically identical to flat ground — small
// steps are silently absorbed by per-leg IK reach, no body-height response).
// Placed off the z=0 lane, NOT ahead on it: qa.js's forward scenarios (steadyW,
// runFast, trot, jumpRun, pulse, gaitShift) all command pure +x from a fresh
// reset() and can cover 10+ units — an obstacle on that lane would silently
// contaminate their flat-ground baseline. Only a lateral ("right") command reaches
// this one, which none of those scenarios issue.
export const OBSTACLES = [
  { x0: -0.4, x1: 0.4, z0: 2.0, z1: 2.8, h: 0.12 },
];

export function groundY(x, z) {
  let h = 0;
  for (const o of OBSTACLES)
    if (x >= o.x0 && x <= o.x1 && z >= o.z0 && z <= o.z1 && o.h > h) h = o.h;
  return h;
}
