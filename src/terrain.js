// src/terrain.js — groundY(x,z): the ONE place the floor shape is expressed. (HANDOFF §3, §7)
// Procedural low-poly bump field + discrete step obstacles.
//
// The §7 slope trap still binds: walkable slopes (~4°) are invisible AS GEOMETRY.
// The dodge here is lighting, not amplitude — the mesh is flat-shaded low-poly, so
// every facet gets its own normal and even gentle slopes read through shading.
// Slope budget: AMP 0.12 at WAVELEN 6 → worst facet ~3.4°, inside the walkable scan.
//
// groundY plane-interpolates over the SAME grid triangulation scene.js renders
// (same cell size, same diagonal) — feet stand exactly on the visible facets.
// Deterministic (hash noise, no Math.random): calib stays bit-exact, traces replay.
//
// flatMask zeroes the field over the spawn disc and the +x QA corridor: qa.js
// scenarios (origin spawn; runFast sweeps +x ~11u; spam random-walks ~±2u) must
// keep measuring on flat ground or the gate baseline silently shifts.
import { ROOM } from './tuning.js';

export const CELL = 1.5;              // grid cell (u) — also the mesh facet size
export const EXTENT = 30;             // mesh spans ±EXTENT in x and z
// two octaves at a shared ~3.5-5° worst-slope budget: one long octave alone left
// multi-unit flat stretches (sampled: only 0.04 of relief across 12u) — shorter
// wavelengths buy relief FREQUENCY, which is what facets can actually show
const OCTAVES = [ { amp: 0.09, wavelen: 4.5 }, { amp: 0.018, wavelen: 2.25 } ];

// h=0.15 hard-stalls the walker at the leading edge (scanned); 0.12 is the safe
// ceiling. Sits inside the flat spawn disc so it rests on level ground.
export const OBSTACLES = [
  { x0: -0.4, x1: 0.4, z0: 2.0, z1: 2.8, h: 0.12 },
];

function hash2(i, j) {                // deterministic lattice hash → [0,1)
  let n = (i * 374761393 + j * 668265263) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x, z, wavelen, salt) {  // smoothstep-interpolated value noise, ~[0,1]
  const gx = x / wavelen, gz = z / wavelen;
  const i = Math.floor(gx) + salt, j = Math.floor(gz) - salt;
  const fx = gx - Math.floor(gx), fz = gz - Math.floor(gz);
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash2(i, j), b = hash2(i + 1, j), c = hash2(i, j + 1), d = hash2(i + 1, j + 1);
  return (a + (b - a) * sx) * (1 - sz) + (c + (d - c) * sx) * sz;
}

// 0 over the room square (±5.5 + walls), the spawn disc, and the +x QA corridor
// (|z|<2.2, -1<x<16+margin), ramping to 1 over ~3u beyond them
function flatMask(x, z) {
  const dRoom = Math.max(Math.abs(x), Math.abs(z)) - (ROOM.wall + 0.5);
  const dDisc = Math.hypot(x, z) - 5;
  const dCorr = Math.max(Math.abs(z) - 2.2, -x - 1, x - 17);
  const d = Math.min(dRoom, dDisc, dCorr);
  if (d <= 0) return 0;
  if (d >= 3) return 1;
  const t = d / 3;
  return t * t * (3 - 2 * t);
}

// grid-vertex height — the mesh samples exactly this at cell corners
export function vertexH(i, j) {
  const x = i * CELL, z = j * CELL;
  let h = 0, o = 0;
  for (const oc of OCTAVES) h += (vnoise(x, z, oc.wavelen, 1000 * o++) - 0.5) * 2 * oc.amp;
  return h * flatMask(x, z);
}

export function groundY(x, z) {
  // plane-interpolate within the cell's triangle (diagonal (0,0)→(1,1), matching
  // the mesh split in scene.js)
  const gi = Math.floor(x / CELL), gj = Math.floor(z / CELL);
  const fx = x / CELL - gi, fz = z / CELL - gj;
  const h00 = vertexH(gi, gj), h11 = vertexH(gi + 1, gj + 1);
  let h = fx >= fz
    ? h00 + (vertexH(gi + 1, gj) - h00) * (fx - fz) + (h11 - h00) * fz
    : h00 + (h11 - h00) * fx + (vertexH(gi, gj + 1) - h00) * (fz - fx);
  for (const o of OBSTACLES)
    if (x >= o.x0 && x <= o.x1 && z >= o.z0 && z <= o.z1 && o.h > h) h = o.h;
  return h;
}
