// src/props.js — the things in Thing's room. One registry, two ways to interact:
//   USED    the hand walks to the prop's anchor, faces it, and does `plan`
//   SENSED  the prop watches the hand every sim step and fires itself
// Props READ hand state and never write it, so the gait, calibration and QA cannot
// be disturbed by a prop. All sound is synthesised (no asset files).
import * as THREE from 'three';
import * as C from './tuning.js';
import { PAINT } from './paint.js';

// ---- pure prop logic (unit-tested in test/props.test.mjs) ----

// ball: rolls, slows, bounces off the room, takes an impulse from the hand's body.
// Returns true when it bounces off a wall hard enough to be worth a look (WALL_LOUD u/s)
const BODY_R = 0.6, ROLL_DECEL = 0.55, WALL_REST = 0.6, WALL_LOUD = 0.4;
// the floor dishes up toward the walls: the wrist stops at ROOM.half, 1.85 u short of them,
// and a ball at rest by a wall was out of the hand's reach for good (measured: stranded
// 1.40 u from the nearest spot the hand can stand, contact is 0.92). COVE beats ROLL_DECEL,
// so the ball always comes back to within reach
const COVE = 0.9;
export function stepBall(b, dt, hand, blocks = []) {
  const dx = b.x - hand.x, dz = b.z - hand.z, d = Math.hypot(dx, dz), contact = b.r + BODY_R;
  if (d < contact && d > 1e-6 && hand.y < 2.2) {            // (a jumping hand clears it)
    const nx = dx / d, nz = dz / d, vn = hand.vx * nx + hand.vz * nz;
    b.x = hand.x + nx * contact; b.z = hand.z + nz * contact;
    if (vn > 0.02) { b.vx = nx * vn * 1.35; b.vz = nz * vn * 1.35; }
    else if (Math.hypot(b.vx, b.vz) < 0.05) { b.vx = nx * 0.25; b.vz = nz * 0.25; }
  }
  const reach = C.ROOM.half + contact - 0.25;
  if (Math.abs(b.x) > reach) b.vx -= Math.sign(b.x) * COVE * dt;
  if (Math.abs(b.z) > reach) b.vz -= Math.sign(b.z) * COVE * dt;
  const s = Math.hypot(b.vx, b.vz);
  if (s > 0) { const k = Math.max(0, s - ROLL_DECEL * dt) / s; b.vx *= k; b.vz *= k; }
  b.x += b.vx * dt; b.z += b.vz * dt;
  for (const k of blocks) {                                   // a solid thing on the floor: out by the near side, and back
    const px = Math.min(b.x - (k.x0 - b.r), k.x1 + b.r - b.x), pz = Math.min(b.z - (k.z0 - b.r), k.z1 + b.r - b.z);
    if (px <= 0 || pz <= 0) continue;
    if (px < pz) { const out = b.x < (k.x0 + k.x1) / 2 ? -1 : 1; b.x += out * px; b.vx = out * Math.abs(b.vx) * WALL_REST; }
    else { const out = b.z < (k.z0 + k.z1) / 2 ? -1 : 1; b.z += out * pz; b.vz = out * Math.abs(b.vz) * WALL_REST; }
  }
  const lim = C.ROOM.wall - 0.1 - b.r;
  let hit = 0;
  if (Math.abs(b.x) > lim) { hit = Math.abs(b.vx); b.x = Math.sign(b.x) * lim; b.vx = -b.vx * WALL_REST; }
  if (Math.abs(b.z) > lim) { hit = Math.max(hit, Math.abs(b.vz)); b.z = Math.sign(b.z) * lim; b.vz = -b.vz * WALL_REST; }
  return hit > WALL_LOUD && d >= contact;                     // (a ball the hand is pressing into the wall is not a bounce)
}

// a throw from outside (the pointer): the ball takes that velocity, up to KICK_MAX u/s
export const KICK_MAX = 4;
export function kickBall(b, vx, vz) {
  const s = Math.hypot(vx, vz), k = s > KICK_MAX ? KICK_MAX / s : 1;
  b.vx = vx * k; b.vz = vz * k;
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

// Thing's box, in the corner right of the door: its home. Sized from the hand (mesh
// extents, measured): walking it is 0.6 u wide to one side of the wrist and 0.75 to the
// other and reaches 1.6 ahead; lying on its side it is 0.23 and 0.95 wide, 1.51 long and
// 0.99 high. The wrist cannot pass ROOM.half, so that is the lane it walks in on (BOX_LANE)
// and the box sits 0.2 to the side of it, where the lying hand is centred
const BOX_LANE = C.ROOM.half;
export const BOX = { x: BOX_LANE + 0.2, z: -C.ROOM.half, w: 1.9, d: 2.5, h: 1.25 };
BOX.x0 = BOX.x - BOX.w / 2; BOX.x1 = BOX.x + BOX.w / 2; BOX.z0 = BOX.z - BOX.d / 2; BOX.z1 = BOX.z + BOX.d / 2;
const BOX_BED = BOX.z + 0.5;                                  // where the wrist lies: fingers to the back wall, stump inside the front
export const inBox = (x, z) => x > BOX.x0 && x < BOX.x1 && z > BOX.z0 && z < BOX.z1;

// floor piano: a strip of keys laid along z. Which key is under a point, or -1.
export const PIANO = { x0: -4.5, x1: -3.3, z0: -1.6, keyW: 0.4,
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
  const brass = mat(0xb08d4a, { metalness: 0.75, roughness: 0.3 });

  // light switch on the north wall, right of the doorway, at jump height. The toggle
  // glows in the dark, so the switch can be found again
  const plate = add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.5, 0.05), mat(0x9a7a3e, { metalness: 0.7, roughness: 0.35 })), 2.4, 1.95, -W + 0.03);
  const toggle = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.2, 0.09), mat(0x1a1411, { emissive: 0xffb070, emissiveIntensity: 0 }));
  toggle.position.z = 0.05; plate.add(toggle);
  const sw = { x: 2.4, z: -C.ROOM.half, r: 0.9, reachY: 1.9, armed: true };

  // wall sconce over the rug: the night light (Thing stays visible), and the source the
  // warm key light stands in for. High and short-armed: a hand at the walk clamp clears it
  const sconce = new THREE.Group();
  const turned = (rTop, rBot, h, x, y, m, open = false) => {
    const part = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, 20, 1, open), m);
    part.position.set(x, y, 0); sconce.add(part);
    return part;
  };
  turned(0.11, 0.11, 0.03, 0, 0, brass).rotation.z = Math.PI / 2;        // back plate
  turned(0.018, 0.018, 0.18, 0.09, 0, brass).rotation.z = Math.PI / 2;   // arm
  turned(0.07, 0.04, 0.05, 0.18, 0.02, brass);                           // cup
  const shade = turned(0.09, 0.17, 0.26, 0.18, 0.2, mat(0xd9a25a, { emissive: 0xffa040, side: THREE.DoubleSide, roughness: 0.9 }), true);
  sconce.position.set(-W + 0.02, 1.95, -3.5); scene.add(sconce);
  const lamp = new THREE.PointLight(0xffb070, 0, 9, 1.6);
  lamp.position.set(-W + 0.25, 2.1, -3.5); scene.add(lamp);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: PAINT.glow(), blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.scale.setScalar(1.5); glow.position.copy(lamp.position); scene.add(glow);
  // moonlight through the doorway, laid on the floor as light. A ShadowMaterial turned
  // inside out: it adds light where the key's shadow map says lit, fading from the sill
  // (uv.y), so the hand's shadow runs unbroken through the patch
  const moonG = new THREE.BufferGeometry();
  moonG.setAttribute('position', new THREE.Float32BufferAttribute([-0.8, 0, -W, 0.8, 0, -W, 1.9, 0, 3.4 - W, 0.2, 0, 3.4 - W], 3));
  moonG.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
  moonG.setIndex([0, 2, 1, 0, 3, 2]); moonG.computeVertexNormals();
  const moon = new THREE.Mesh(moonG, new THREE.ShadowMaterial({ color: 0x6e96ff, blending: THREE.AdditiveBlending, depthWrite: false }));
  moon.material.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('void main() {', 'varying float vFade;\nvoid main() {\n\tvFade = uv.y;');
    sh.fragmentShader = sh.fragmentShader.replace('void main() {', 'varying float vFade;\nvoid main() {')
      .replace('1.0 - getShadowMask()', 'getShadowMask() * vFade');
  };
  moon.position.y = 0.012; moon.receiveShadow = true; scene.add(moon);
  // dust in that beam: a few motes on slow sines. Placed by a hash, never Math.random:
  // the gates seed that stream and must find it where they left it
  const MOTES = 48, hash = (i, k) => { const v = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return v - Math.floor(v); };
  const dust = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(MOTES * 3), 3)),
    new THREE.PointsMaterial({ color: 0x9db8ff, size: 0.025, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  dust.frustumCulled = false; scene.add(dust);
  const drift = (t) => {
    const p = dust.geometry.attributes.position;
    for (let i = 0; i < MOTES; i++) {
      const d = 0.2 + 3 * hash(i, 2), top = 1.5 * (1 - d / 3.4);            // the beam slants down and to +x as it leaves the door
      p.setXYZ(i, -0.7 + 1.4 * hash(i, 1) + 0.32 * d + 0.12 * Math.sin(t * 0.21 + 6.28 * hash(i, 4)),
        (0.1 + 0.9 * hash(i, 3)) * top + 0.08 * Math.sin(t * 0.17 + 6.28 * hash(i, 5)), d - W);
    }
    p.needsUpdate = true;
  };
  drift(0);
  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  let clock = 0;
  // what the switch eases between: the room as scene.js lit it, and a night of moon and sconce
  const lit = { hemi: lights.hemi.intensity, key: lights.key.intensity, amb: lights.amb.intensity, rim: lights.rim.intensity,
    env: scene.environmentIntensity, lamp: 0, shade: 0.9, glow: 0.45, moon: 0.19, dust: 0.3, toggle: 0 };
  const dark = { hemi: 0.105, key: 0.8, amb: 0.04, rim: 0.5, env: 0.03, lamp: 14, shade: 2.2, glow: 0.9, moon: 0.44, dust: 0.8, toggle: 1 };
  const keyLit = lights.key.color.clone(), keyDark = new THREE.Color(0x7f9ce0);   // the key turns to moonlight: the hand keeps its shadow

  // desk bell, front left
  const bellG = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.07, 28), mat(0x15100d));
  base.position.y = 0.035;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.24, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), brass);
  dome.position.y = 0.07;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.09, 12), brass);   // the plunger
  stem.position.y = 0.33;
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 10), brass);
  knob.position.y = 0.39;
  bellG.add(base, dome, stem, knob); bellG.position.set(-3.2, 0, 3.2); scene.add(bellG);
  base.castShadow = dome.castShadow = stem.castShadow = knob.castShadow = true;

  // ball: the band shows it rolling
  const ball = { x: 2.6, z: 1.6, r: 0.32, vx: 0, vz: 0 };
  const ballM = add(new THREE.Mesh(new THREE.SphereGeometry(ball.r, 28, 20), mat(0xffffff, { map: PAINT.ball(), roughness: 0.45 })), ball.x, ball.r, ball.z);
  ballM.rotation.set(0.5, 0.3, 0.9);

  // rug: the nap spot (no physics)
  const rug = new THREE.Mesh(new THREE.CircleGeometry(1.0, 40), mat(0xffffff, { map: PAINT.rug(), roughness: 0.98 }));
  rug.rotation.x = -Math.PI / 2; rug.position.set(-3.5, 0.008, -3.5); rug.receiveShadow = true; scene.add(rug);

  // floor piano along the west wall: a fingertip landing on a key plays it (`footfall`).
  // Everything lies flush: fingers reach to the wall here, and would pass through a case
  const pianoG = new THREE.Group(), keys = [];
  for (let i = 0; i < PIANO.notes.length; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(PIANO.x1 - PIANO.x0, 0.02, PIANO.keyW - 0.04),
      mat(0xb9ab8a, { roughness: 0.4, emissive: 0xffc070, emissiveIntensity: 0 }));
    m.position.set((PIANO.x0 + PIANO.x1) / 2, 0.003, PIANO.z0 + (i + 0.5) * PIANO.keyW);
    m.receiveShadow = true; pianoG.add(m); keys.push({ m, glow: 0 });
  }
  const flat = (w, d, x, z, m) => {
    const part = new THREE.Mesh(new THREE.BoxGeometry(w, 0.012, d), m);
    part.position.set(x, 0.006, z); part.receiveShadow = true; pianoG.add(part);
    return part;
  };
  // matt blacks: the camera stands in the moon rim's mirror direction, so polished black turns blue
  const ebony = mat(0x0d0b0a, { roughness: 0.9 }), len = PIANO.notes.length * PIANO.keyW, zMid = PIANO.z0 + len / 2;
  for (const i of [0, 1, 3, 4, 5]) flat(0.62, 0.2, PIANO.x0 + 0.31, PIANO.z0 + (i + 1) * PIANO.keyW, ebony).position.y = 0.02;   // the black keys
  flat(W - 0.01 + PIANO.x0 - 0.05, len + 0.3, (PIANO.x0 - 0.05 - W + 0.01) / 2, zMid, ebony);   // the case, back to the wall
  flat(0.05, len + 0.06, PIANO.x0 - 0.025, zMid, mat(0x6a1418, { roughness: 1 }));                                             // felt
  scene.add(pianoG);
  const zLo = PIANO.z0 - 0.5, zHi = PIANO.z0 + PIANO.notes.length * PIANO.keyW + 0.5, xMid = (PIANO.x0 + PIANO.x1) / 2;
  let handZ = 0;                                              // the piano is played from the nearer end

  // Thing's box: three walls, a front that drops like a drawbridge, a lid hinged on the
  // west side (it stands behind the hand from the viewer's side). Plain walnut and brass.
  // lid and flap run 0 (shut) to 1 (open) toward lidT and flapT
  const boxG = new THREE.Group(), BT = 0.07, walnut = mat(0x2a1a11, { roughness: 0.55 }), walnutLt = mat(0x4a2f1d, { roughness: 0.5 });
  const slab = (w, h, d, x, y, z, m, to = boxG) => {
    const part = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    part.position.set(x, y, z); part.castShadow = part.receiveShadow = true; to.add(part);
    return part;
  };
  slab(BOX.w, BOX.h, BT, 0, BOX.h / 2, -BOX.d / 2, walnut);                    // back
  for (const sx of [-1, 1]) slab(BT, BOX.h, BOX.d, sx * BOX.w / 2, BOX.h / 2, 0, walnut);
  slab(BOX.w, 0.02, BOX.d, 0, 0.012, 0, mat(0x6a1418, { roughness: 1 }));      // felt
  const flapG = new THREE.Group(), lidG = new THREE.Group();
  flapG.position.set(0, 0, BOX.d / 2); lidG.position.set(-BOX.w / 2, BOX.h, 0); boxG.add(flapG, lidG);
  slab(BOX.w, BOX.h, BT, 0, BOX.h / 2, 0, walnutLt, flapG);
  slab(BOX.w + 2 * BT, BT, BOX.d + 2 * BT, BOX.w / 2, BT / 2, 0, walnutLt, lidG);
  slab(0.05, 0.1, 0.5, BOX.w + BT, 0, 0, brass, lidG);                         // the pull
  boxG.position.set(BOX.x, 0, BOX.z); scene.add(boxG);
  const box = { lid: 0, flap: 0, lidT: 0, flapT: 0, rattle: -1, near: false };
  const LID_OPEN = 1.45, LID_CRACK = 0.2;                     // rad · share of it when the lid lifts a crack

  const state = { lights: true, level: 1, ringT: -1 };
  const axis = new THREE.Vector3();
  // `plan`: what the hand does once it stands at `anchor` facing `facing` (world heading, rad)
  const P = {
    switch: { label: 'light switch', mesh: plate, anchor: { x: 2.4, z: -C.ROOM.half }, facing: Math.PI / 2,
      plan: () => [{ do: 'jump' }] },                         // what it makes of the result is a reaction (onEvent)
    bell: { label: 'bell', mesh: bellG, anchor: { x: -3.2, z: 3.2 }, plan: () => [{ do: 'jump' }] },
    ball: { label: 'ball', mesh: ballM, get anchor() { return { x: ball.x, z: ball.z }; }, speed: C.SPEED.scuttle, plan: () => [] },
    // (it lies 1.5 u ahead of its wrist: it stands at the rug's edge and lies along the screen)
    rug: { label: 'rug', mesh: rug, anchor: { x: -3.9, z: -3.06 }, facing: Math.PI / 4, plan: () => [{ do: 'gesture', name: 'sleep' }] },
    // walk the length of the keys and back: the gait is the tune
    piano: { label: 'floor piano', mesh: pianoG,
      get anchor() { return { x: xMid, z: handZ < (zLo + zHi) / 2 ? zLo : zHi }; },
      plan() {
        const a = this.anchor.z === zLo ? zLo : zHi, b = a === zLo ? zHi : zLo;
        return [{ do: 'walkTo', x: xMid, z: b, speed: C.SPEED.strut }, { do: 'walkTo', x: xMid, z: a, speed: C.SPEED.scuttle }, { do: 'gesture', name: 'bow' }];
      } },
    // home. Used from outside: walk in, lie down with its back to the room, and the box
    // shuts on it. `at` = [gesture s, event]: the brain fires them as the gesture plays.
    // `out` is the way back: it turns round unseen (a hand turning in there swept its
    // fingers through the side: filmed), sits up under the lid, and the front drops before
    // it stands. `open` fires as the hand sets off, so the front is down when it arrives
    box: { label: 'box', mesh: boxG, solid: BOX, anchor: { x: BOX_LANE, z: BOX.z1 + 0.75 }, facing: Math.PI / 2, open: 'boxOpen',
      plan: () => [{ do: 'walkTo', x: BOX_LANE, z: BOX_BED, speed: C.SPEED.strut },
        { do: 'gesture', name: 'nestle', at: [[1.1, 'boxShut'], [1.8, 'hide']] }],
      out: () => [{ do: 'turn', deg: 180 },
        { do: 'gesture', name: 'emerge', at: [[0.2, 'boxRattle'], [0.7, 'boxRattle'], [1.2, 'boxCrack'], [1.25, 'show'], [2.0, 'boxLid'], [2.8, 'boxOpen']] },
        { do: 'walkTo', x: BOX_LANE, z: BOX.z1 + 0.95, speed: C.SPEED.strut }, { do: 'gesture', name: 'stretch', fire: 'boxShut' }] },
  };
  // things that happen in the room are told to whoever listens (the brain: the hand reacts).
  // Events go out, hand state never comes in
  let onEvent = null;
  const fire = {
    switch() { state.lights = !state.lights; toggle.rotation.x = state.lights ? 0 : 0.5; SOUNDS.click(); onEvent?.(state.lights ? 'lightsOn' : 'lightsOff'); },
    bell() { state.ringT = 0; SOUNDS.ding(); onEvent?.('bell'); },
    boxOpen() { box.lidT = box.flapT = 1; SOUNDS.click(); },
    boxShut() { if (box.lidT || box.flapT) SOUNDS.knock(); box.lidT = box.flapT = 0; },
    boxCrack() { box.lidT = LID_CRACK; box.rattle = 0; SOUNDS.tick(); },
    boxLid() { box.lidT = 1; SOUNDS.click(); },
    boxRattle() { box.rattle = 0; SOUNDS.tick(); },
  };

  return {
    ids: Object.keys(P), get: (id) => P[id], state, fire: (id) => fire[id] && fire[id](),
    kick: (vx, vz) => kickBall(ball, vx, vz),               // the pointer throws the ball
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
      if (stepBall(ball, dt, hand, [BOX])) onEvent?.('wall', { x: ball.x, z: ball.z });
      // the box: lid and flap ease to their targets, a rattle shakes the lid, and it shuts
      // itself behind a hand that walks away from it open
      const far = Math.hypot(hand.x - BOX.x, hand.z - BOX.z) > 3;
      if (!far) box.near = true; else if (box.near) { box.near = false; fire.boxShut(); }
      const k = 1 - Math.exp(-dt / 0.09);
      box.lid += (box.lidT - box.lid) * k; box.flap += (box.flapT - box.flap) * k;
      if (box.rattle >= 0 && (box.rattle += dt) > 0.45) box.rattle = -1;
      lidG.rotation.z = LID_OPEN * box.lid + (box.rattle >= 0 ? 0.05 * Math.abs(Math.sin(box.rattle * 42)) * Math.exp(-box.rattle * 5) : 0);
      flapG.rotation.x = Math.PI / 2 * box.flap;
      ballM.position.set(ball.x, ball.r, ball.z);
      const s = Math.hypot(ball.vx, ball.vz);
      if (s > 1e-4) { axis.set(ball.vz / s, 0, -ball.vx / s); ballM.rotateOnWorldAxis(axis, s * dt / ball.r); }
      if (state.ringT >= 0) {
        state.ringT += dt;
        dome.scale.y = 1 - 0.35 * Math.sin(state.ringT * 26) * Math.exp(-state.ringT * 4);
        if (state.ringT > 1) { state.ringT = -1; dome.scale.y = 1; }
      }
      // lights ease between the lit room and a night of moonlight and the sconce
      state.level += ((state.lights ? 1 : 0) - state.level) * (1 - Math.exp(-dt / 0.28));   // a filament, not a relay
      const at = (k) => dark[k] + (lit[k] - dark[k]) * state.level;
      lights.hemi.intensity = at('hemi'); lights.key.intensity = at('key'); lights.amb.intensity = at('amb');
      lights.rim.intensity = at('rim'); scene.environmentIntensity = at('env');
      lights.key.color.lerpColors(keyDark, keyLit, state.level);
      if (!calm.matches) drift(clock += dt);
      const f = calm.matches ? 1 : 1 + 0.06 * Math.sin(clock * 9.1) * Math.sin(clock * 2.3);          // the sconce's flame breathes
      lamp.intensity = at('lamp') * f; shade.material.emissiveIntensity = at('shade') * f; glow.material.opacity = at('glow') * f;
      moon.material.opacity = at('moon'); dust.material.opacity = at('dust'); toggle.material.emissiveIntensity = at('toggle');
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
    describe: () => `Things in the room (use them with {"do":"use","target":ID}): switch = the light switch, you jump to flip it (lights are ${state.lights ? 'ON' : 'OFF'}); bell = a desk bell, you jump on it to ring it; ball = a ball, you run into it to kick it; rug = your nap rug; piano = a floor piano, you walk along the keys to play it; box = your box, your home: use it to go in and shut the lid, use it again to come out.`,
  };
}
