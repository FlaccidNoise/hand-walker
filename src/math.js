// src/math.js — pure math helpers, no sim state. (HANDOFF §3)
import * as THREE from 'three';

export const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp01 = (v) => clamp(v, 0, 1);

export function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

// critically-damped angular spring toward target (frame-rate independent-ish via dt)
export function dampAngle(cur, target, lambda, dt) {
  return cur + (target - cur) * (1 - Math.exp(-lambda * dt));
}

// distance & signed angle along a segment (2D in-plane helpers for IK)
export function segDist(p0, p1) { // THREE.Vector2
  return p0.distanceTo(p1);
}
export function segAngle(p0, p1) {
  return Math.atan2(p1.y - p0.y, p1.x - p0.x);
}

// shortest signed angle from a to b
export function angleDiff(a, b) {
  return wrapAngle(b - a);
}

// law-of-cosines 2-bone IK: returns [angle at root (root→mid→tip), angle at mid (mid→tip→reach)]
// given bone lengths l0,l1 and target distance d (clamped to reach).
export function cosIK(l0, l1, d) {
  d = clamp(d, Math.abs(l0 - l1) + 1e-6, l0 + l1 - 1e-6);
  const a0 = Math.acos(clamp((l0 * l0 + d * d - l1 * l1) / (2 * l0 * d), -1, 1));
  const a1 = Math.acos(clamp((l0 * l0 + l1 * l1 - d * d) / (2 * l0 * l1), -1, 1));
  return [a0, a1];
}

export const v2 = (x = 0, y = 0) => new THREE.Vector2(x, y);
export const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
