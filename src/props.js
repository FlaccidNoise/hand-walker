// src/props.js — the things in Thing's room. One registry, two ways to interact:
//   USED    the hand walks to the prop's anchor, faces it, and does `plan`
//   SENSED  the prop watches the hand every sim step and fires itself
// Props READ hand state and never write it, so the gait, calibration and QA cannot
// be disturbed by a prop. All sound is synthesised (no asset files).
import * as THREE from 'three';
import * as C from './tuning.js';

// ---- pure prop logic (unit-tested in test/props.test.mjs) ----

// ball: rolls, slows, bounces off the room, takes an impulse from the hand's body.
// Returns true when it bounces off a wall hard enough to be worth a look (WALL_LOUD u/s)
const BODY_R = 0.6, ROLL_DECEL = 0.55, WALL_REST = 0.6, WALL_LOUD = 0.4;
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
  let hit = 0;
  if (Math.abs(b.x) > lim) { hit = Math.abs(b.vx); b.x = Math.sign(b.x) * lim; b.vx = -b.vx * WALL_REST; }
  if (Math.abs(b.z) > lim) { hit = Math.max(hit, Math.abs(b.vz)); b.z = Math.sign(b.z) * lim; b.vz = -b.vz * WALL_REST; }
  return hit > WALL_LOUD && d >= contact;                     // (a ball the hand is pressing into the wall is not a bounce)
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

// floor piano: a strip of keys laid along z. Which key is under a point, or -1.
export const PIANO = { x0: -4.7, x1: -3.5, z0: -1.6, keyW: 0.4,
  notes: [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25] };   // C major pentatonic: any run is a tune
export function pianoKey(p, x, z) {
  if (x < p.x0 || x > p.x1) return -1;
  const i = Math.floor((z - p.z0) / p.keyW);
  return i >= 0 && i < p.notes.length ? i : -1;
}

// ---- sound: WebAudio, lazy context, never throws into the sim ----
// `on` is set by the page on the first key or pointer press: browsers refuse audio
// before that, and the headless gates never set it, so they stay silent and fast.
export const audio = { on: false, muted: false };
let actx = null, noise = null;
// call from a key or pointer handler: Safari starts a context only inside one.
// Returns true once the context runs, so the page can stop listening.
export function unlockAudio() {
  audio.on = true;
  try {
    actx ??= new AudioContext();
    if (actx.state === 'suspended') actx.resume();
    return actx.state === 'running';
  } catch (e) { console.warn('[props] audio unavailable:', e?.message || e); return true; }
}
const ctx = () => {
  if (!audio.on || audio.muted) return null;
  actx ??= new AudioContext();
  if (actx.state === 'suspended') actx.resume();
  return actx;
};
// decaying tone. `hold` s at full level first (a beep); `sweep` multiplies the pitch over dur (a drum)
function tone(parts, dur, gain = 0.2, { hold = 0, sweep = 1 } = {}) {
  try {
    const a = ctx();
    if (!a) return;
    const t = a.currentTime, g = a.createGain();
    g.gain.setValueAtTime(gain, t + hold);
    g.gain.exponentialRampToValueAtTime(0.001, t + hold + dur);
    g.connect(a.destination);
    for (const [f, amp, type = 'sine'] of parts) {
      const o = a.createOscillator(), og = a.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t); og.gain.value = amp;
      if (sweep !== 1) o.frequency.exponentialRampToValueAtTime(f * sweep, t + hold + dur);
      o.connect(og); og.connect(g); o.start(t); o.stop(t + hold + dur + 0.05);
    }
  } catch (e) { console.warn('[props] audio unavailable:', e?.message || e); }
}
// a short band of noise: a fingertip on the floor, a hi-hat
function tick(freq, dur, gain) {
  try {
    const a = ctx();
    if (!a) return;
    if (!noise) {
      noise = a.createBuffer(1, a.sampleRate * 0.2, a.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t = a.currentTime, src = a.createBufferSource(), bp = a.createBiquadFilter(), g = a.createGain();
    src.buffer = noise; bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 1.2;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(bp); bp.connect(g); g.connect(a.destination); src.start(t); src.stop(t + dur + 0.02);
  } catch (e) { console.warn('[props] audio unavailable:', e?.message || e); }
}
const STEP_HZ = { thumb: 700, index: 1500, middle: 1300, ring: 1600, pinky: 1900 };
const BASS = [65.4, 65.4, 87.3, 98];                         // C C F G under the dance
const beat = (i) => () => { tone([[150, 1]], 0.16, 0.5, { sweep: 0.3 }); tone([[BASS[i], 1, 'triangle']], 0.3, 0.22); };
export const SOUNDS = {
  ding: () => tone([[1567, 1], [2349, 0.4]], 1.1, 0.22),     // small brass bell
  click: () => tone([[180, 1, 'square'], [2400, 0.5, 'square']], 0.05, 0.12),
  snap: () => tone([[2900, 1, 'triangle'], [1300, 0.6, 'square']], 0.035, 0.2),
  knock: () => tone([[140, 1], [90, 0.8]], 0.09, 0.35),
  dit: () => tone([[660, 1]], 0.03, 0.14, { hold: 0.1 }),    // Morse: a dot is one unit of wall time
  dah: () => tone([[660, 1]], 0.03, 0.14, { hold: 0.4 }),
  hat: () => tick(7000, 0.04, 0.12),
  tick: () => tick(1500, 0.03, 0.1),                          // a fingertip rapped on the floor
  beat0: beat(0), beat1: beat(1), beat2: beat(2), beat3: beat(3),
  note: (hz) => tone([[hz, 1], [hz * 2, 0.25], [hz * 3, 0.08]], 1.2, 0.2),
  step: (f, speed) => tick(STEP_HZ[f] ?? 1400, 0.03, 0.05 + 0.05 * Math.min(speed / 2, 1)),
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

  // floor piano along the west wall: a fingertip landing on a key plays it (`footfall`)
  const pianoG = new THREE.Group(), keys = [];
  for (let i = 0; i < PIANO.notes.length; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(PIANO.x1 - PIANO.x0, 0.02, PIANO.keyW - 0.04),
      mat(0xe6dfcc, { roughness: 0.35, emissive: 0xffc070, emissiveIntensity: 0 }));
    m.position.set((PIANO.x0 + PIANO.x1) / 2, 0.003, PIANO.z0 + (i + 0.5) * PIANO.keyW);
    m.receiveShadow = true; pianoG.add(m); keys.push({ m, glow: 0 });
  }
  scene.add(pianoG);
  const zLo = PIANO.z0 - 0.5, zHi = PIANO.z0 + PIANO.notes.length * PIANO.keyW + 0.5, xMid = (PIANO.x0 + PIANO.x1) / 2;
  let handZ = 0;                                              // the piano is played from the nearer end

  const state = { lights: true, level: 1, ringT: -1 };
  const axis = new THREE.Vector3();
  // `plan`: what the hand does once it stands at `anchor` facing `facing` (world heading, rad)
  const P = {
    switch: { label: 'light switch', mesh: plate, anchor: { x: 2.4, z: -4.55 }, facing: Math.PI / 2,
      plan: () => [{ do: 'jump' }] },                         // what it makes of the result is a reaction (onEvent)
    bell: { label: 'bell', mesh: bellG, anchor: { x: -3.2, z: 3.2 }, plan: () => [{ do: 'jump' }] },
    ball: { label: 'ball', mesh: ballM, get anchor() { return { x: ball.x, z: ball.z }; }, speed: C.SPEED.scuttle, plan: () => [] },
    rug: { label: 'rug', mesh: rug, anchor: { x: -3.5, z: -3.5 }, plan: () => [{ do: 'gesture', name: 'sleep' }] },
    // walk the length of the keys and back: the gait is the tune
    piano: { label: 'floor piano', mesh: pianoG,
      get anchor() { return { x: xMid, z: handZ < (zLo + zHi) / 2 ? zLo : zHi }; },
      plan() {
        const a = this.anchor.z === zLo ? zLo : zHi, b = a === zLo ? zHi : zLo;
        return [{ do: 'walkTo', x: xMid, z: b, speed: C.SPEED.strut }, { do: 'walkTo', x: xMid, z: a, speed: C.SPEED.scuttle }, { do: 'gesture', name: 'bow' }];
      } },
  };
  // things that happen in the room are told to whoever listens (the brain: the hand reacts).
  // Events go out, hand state never comes in
  let onEvent = null;
  const fire = {
    switch() { state.lights = !state.lights; toggle.rotation.x = state.lights ? 0 : 0.5; SOUNDS.click(); onEvent?.(state.lights ? 'lightsOn' : 'lightsOff'); },
    bell() { state.ringT = 0; SOUNDS.ding(); onEvent?.('bell'); },
  };

  return {
    ids: Object.keys(P), get: (id) => P[id], state, fire: (id) => fire[id] && fire[id](),
    set onEvent(f) { onEvent = f; },
    // sensed props + animation. hand = { x, y, z, vx, vz, airborne }
    // a fingertip came down at (x, z): a piano key plays its note, the bare floor ticks
    footfall(f, x, z, speed) {
      const i = pianoKey(PIANO, x, z);
      if (i < 0) return SOUNDS.step(f, speed);
      keys[i].glow = 1; SOUNDS.note(PIANO.notes[i]);
    },
    update(dt, hand, landed) {
      handZ = hand.z;
      for (const k of keys) if (k.glow > 0) {
        k.glow = Math.max(0, k.glow - dt / 0.5);
        k.m.material.emissiveIntensity = 0.9 * k.glow; k.m.position.y = 0.003 - 0.008 * k.glow;
      }
      if (switchFlips(sw, hand)) fire.switch();
      if (bellRings({ x: -3.2, z: 3.2, r: 0.9 }, hand, landed)) fire.bell();
      if (stepBall(ball, dt, hand)) onEvent?.('wall', { x: ball.x, z: ball.z });
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
    describe: () => `Things in the room (use them with {"do":"use","target":ID}): switch = the light switch, you jump to flip it (lights are ${state.lights ? 'ON' : 'OFF'}); bell = a desk bell, you jump on it to ring it; ball = a ball, you run into it to kick it; rug = your nap rug; piano = a floor piano, you walk along the keys to play it.`,
  };
}
