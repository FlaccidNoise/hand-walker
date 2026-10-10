// src/props.js — the things in Thing's room. One registry, two ways to interact:
//   USED    the hand walks to the prop's anchor, faces it, and does `plan`
//   SENSED  the prop watches the hand every sim step and fires itself
// Props READ hand state and never write it, so the gait, calibration and QA cannot
// be disturbed by a prop. All sound is synthesised (no asset files).
import * as THREE from 'three';
import * as C from './tuning.js';

// ---- pure prop logic (unit-tested in test/props.test.mjs) ----

// ball: rolls, slows, bounces off the room, takes an impulse from the hand's body
const BODY_R = 0.6, ROLL_DECEL = 0.55, WALL_REST = 0.6;
export function stepBall(b, dt, hand) {
  const dx = b.x - hand.x, dz = b.z - hand.z, d = Math.hypot(dx, dz), contact = b.r + BODY_R;
  if (d < contact && d > 1e-6 && hand.y < 2.2) {            // (a jumping hand clears it)
    const nx = dx / d, nz = dz / d, vn = hand.vx * nx + hand.vz * nz;
    b.x = hand.x + nx * contact; b.z = hand.z + nz * contact;
    if (vn > 0.02) { b.vx = nx * vn * 1.35; b.vz = nz * vn * 1.35; }
    else if (Math.hypot(b.vx, b.vz) < 0.05) { b.vx = nx * 0.25; b.vz = nz * 0.25; }
  }
  const s = Math.hypot(b.vx, b.vz);
  if (s > 0) { const k = Math.max(0, s - ROLL_DECEL * dt) / s; b.vx *= k; b.vz *= k; }
  b.x += b.vx * dt; b.z += b.vz * dt;
  const lim = C.ROOM.wall - 0.1 - b.r;
  if (Math.abs(b.x) > lim) { b.x = Math.sign(b.x) * lim; b.vx = -b.vx * WALL_REST; }
  if (Math.abs(b.z) > lim) { b.z = Math.sign(b.z) * lim; b.vz = -b.vz * WALL_REST; }
}

// bell: rings when the hand LANDS on or beside it (a jump). One ring per landing.
export function bellRings(bell, hand, landed) {
  return landed && Math.hypot(hand.x - bell.x, hand.z - bell.z) < bell.r;
}

// wall switch: flips when a jumping hand's wrist passes its height beneath it. `armed`
// re-arms on the ground, so one jump is one flip.
export function switchFlips(sw, hand) {
  const near = Math.hypot(hand.x - sw.x, hand.z - sw.z) < sw.r;
  if (!hand.airborne) { sw.armed = true; return false; }
  if (sw.armed && near && hand.y > sw.reachY) { sw.armed = false; return true; }
  return false;
}

// ---- sound: WebAudio, lazy context, never throws into the sim ----
let actx = null;
function tone(parts, dur, gain = 0.2) {
  try {
    actx ??= new AudioContext();
    if (actx.state === 'suspended') actx.resume();
    const t = actx.currentTime, g = actx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    g.connect(actx.destination);
    for (const [f, a, type = 'sine'] of parts) {
      const o = actx.createOscillator(), og = actx.createGain();
      o.type = type; o.frequency.value = f; og.gain.value = a;
      o.connect(og); og.connect(g); o.start(t); o.stop(t + dur + 0.05);
    }
  } catch (e) { console.warn('[props] audio unavailable:', e?.message || e); }
}
export const SOUNDS = {
  ding: () => tone([[1567, 1], [2349, 0.4]], 1.1, 0.22),     // small brass bell
  click: () => tone([[180, 1, 'square'], [2400, 0.5, 'square']], 0.05, 0.12),
  snap: () => tone([[2900, 1, 'triangle'], [1300, 0.6, 'square']], 0.035, 0.2),
  knock: () => tone([[140, 1], [90, 0.8]], 0.09, 0.35),
};

// ---- the room's props ----
export function makeProps({ scene, lights }) {
  const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...o });
  const add = (mesh, x, y, z) => { mesh.position.set(x, y, z); mesh.castShadow = true; scene.add(mesh); return mesh; };
  const W = C.ROOM.wall;

  // light switch on the north wall, right of the doorway, at jump height
  const plate = add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.5, 0.05), mat(0xd8d2c0)), 2.4, 1.95, -W + 0.03);
  const toggle = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.2, 0.09), mat(0xf4efe2));
  toggle.position.z = 0.05; plate.add(toggle);
  const lamp = new THREE.PointLight(0xffb070, 0, 9, 1.6);    // the night light: Thing stays visible
  lamp.position.set(-3.8, 1.6, -3.8); scene.add(lamp);
  const bright = { hemi: lights.hemi.intensity, key: lights.key.intensity, amb: lights.amb.intensity, env: scene.environmentIntensity };
  const sw = { x: 2.4, z: -C.ROOM.half, r: 0.9, reachY: 1.9, armed: true };

  // desk bell, front left
  const bellG = new THREE.Group();
  const brass = mat(0xb8975a, { metalness: 0.75, roughness: 0.3 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.07, 28), mat(0x4a4038));
  base.position.y = 0.035;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.24, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), brass);
  dome.position.y = 0.07;
  bellG.add(base, dome); bellG.position.set(-3.2, 0, 3.2); scene.add(bellG);
  base.castShadow = dome.castShadow = true;

  // ball
  const ball = { x: 2.6, z: 1.6, r: 0.32, vx: 0, vz: 0 };
  const ballM = add(new THREE.Mesh(new THREE.SphereGeometry(ball.r, 28, 20), mat(0xa8503c, { roughness: 0.5 })), ball.x, ball.r, ball.z);

  // rug: the nap spot (no physics)
  const rug = new THREE.Mesh(new THREE.CircleGeometry(1.0, 40), mat(0x6f4a5a, { roughness: 0.95 }));
  rug.rotation.x = -Math.PI / 2; rug.position.set(-3.5, 0.008, -3.5); rug.receiveShadow = true; scene.add(rug);

  const state = { lights: true, level: 1, ringT: -1 };
  const axis = new THREE.Vector3();
  // `plan`: what the hand does once it stands at `anchor` facing `facing` (world heading, rad)
  const P = {
    switch: { label: 'light switch', mesh: plate, anchor: { x: 2.4, z: -4.55 }, facing: Math.PI / 2,
      plan: () => [{ do: 'jump' }, { do: 'wait', s: 0.5 }, { do: 'gesture', name: state.lights ? 'thumbsUp' : 'thinking' }] },
    bell: { label: 'bell', mesh: bellG, anchor: { x: -3.2, z: 3.2 }, plan: () => [{ do: 'jump' }] },
    ball: { label: 'ball', mesh: ballM, get anchor() { return { x: ball.x, z: ball.z }; }, speed: C.SPEED.scuttle, plan: () => [] },
    rug: { label: 'rug', mesh: rug, anchor: { x: -3.5, z: -3.5 }, plan: () => [{ do: 'gesture', name: 'sleep' }] },
  };
  const fire = {
    switch() { state.lights = !state.lights; toggle.rotation.x = state.lights ? 0 : 0.5; SOUNDS.click(); },
    bell() { state.ringT = 0; SOUNDS.ding(); },
  };

  return {
    ids: Object.keys(P), get: (id) => P[id], state, fire: (id) => fire[id] && fire[id](),
    // sensed props + animation. hand = { x, y, z, vx, vz, airborne }
    update(dt, hand, landed) {
      if (switchFlips(sw, hand)) fire.switch();
      if (bellRings({ x: -3.2, z: 3.2, r: 0.9 }, hand, landed)) fire.bell();
      stepBall(ball, dt, hand);
      ballM.position.set(ball.x, ball.r, ball.z);
      const s = Math.hypot(ball.vx, ball.vz);
      if (s > 1e-4) { axis.set(ball.vz / s, 0, -ball.vx / s); ballM.rotateOnWorldAxis(axis, s * dt / ball.r); }
      if (state.ringT >= 0) {
        state.ringT += dt;
        dome.scale.y = 1 - 0.35 * Math.sin(state.ringT * 26) * Math.exp(-state.ringT * 4);
        if (state.ringT > 1) { state.ringT = -1; dome.scale.y = 1; }
      }
      // lights ease between bright and a dim room lit by the night light
      state.level += ((state.lights ? 1 : 0) - state.level) * (1 - Math.exp(-dt / 0.12));
      const k = 0.12 + 0.88 * state.level;
      lights.hemi.intensity = bright.hemi * k; lights.key.intensity = bright.key * k;
      lights.amb.intensity = bright.amb * k; scene.environmentIntensity = bright.env * k;
      lamp.intensity = 14 * (1 - state.level);
    },
    // which prop is under this ray (for clicks), or null
    pick(raycaster) {
      let best = null, bd = Infinity;
      for (const [id, p] of Object.entries(P)) {
        const h = raycaster.intersectObject(p.mesh, true)[0];
        if (h && h.distance < bd) { bd = h.distance; best = id; }
      }
      return best;
    },
    // for the LLM prompt: what is here and what state it is in
    describe: () => `Things in the room (use them with {"do":"use","target":ID}): switch = the light switch, you jump to flip it (lights are ${state.lights ? 'ON' : 'OFF'}); bell = a desk bell, you jump on it to ring it; ball = a ball, you run into it to kick it; rug = your nap rug.`,
  };
}
