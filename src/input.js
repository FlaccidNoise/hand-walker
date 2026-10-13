// src/input.js — pointer and keys. Everything here ends in brain.command(): the same
// plan executor voice and idle behaviors use, so every input gets the same turn
// policy, arrival and stop.
//   click floor      walk there (near = strut, far = scuttle, double-click = sprint)
//   click a prop     go and use it (light switch, bell, ball, rug, piano)
//   click the hand   poke it: it giggles, then jumps, then loses patience
//   rest the cursor  the hand turns and points at it, and comes over if it stays
//   WASD / arrows    walk, camera-relative (hold Shift to scuttle); release = stop
//   Q / E            pivot 45° left / right        Space  jump
//   1-9, 0           emotes
import * as THREE from 'three';
import * as C from './tuning.js';

const FAR = 2.5;                    // u — clicks further than this scuttle
const DOUBLE_CLICK = 350;           // ms
const CARROT = 1.5;                 // u — keys aim a walk target this far ahead
const KEY_REFRESH = 0.1;            // s between carrot updates while a direction is held
export const EMOTE_KEYS = ['wave', 'yes', 'no', 'idk', 'laugh', 'bow', 'thumbsUp', 'peace', 'snap', 'doubleSnap'];
const POKE_R = 0.6;                 // u — a click this close to the hand's middle is a poke
const NOTICE_AFTER = 1.6;           // s the cursor rests on the floor before the hand looks
const COME_AFTER = 5;               // s more before it walks over
const DIRS = { KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };

export function initInput({ renderer, camera, controls, scene, rig, brain, props }) {
  const body = rig.mount.position, half = C.ROOM.half;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), hit = new THREE.Vector3();
  const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.13, 0.18, 32),
    new THREE.MeshBasicMaterial({ color: 0xbfd4ff, transparent: true, opacity: 0, depthWrite: false }));
  marker.rotation.x = -Math.PI / 2;
  scene.add(marker);
  let markerT = 1, lastClick = -1e9;
  const aim = (e) => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  };
  const palm = new THREE.Vector3();
  const onHand = () => {                                      // wrist and middle knuckle bracket the palm
    rig.digits.middle.mcp.getWorldPosition(palm).add(body).multiplyScalar(0.5);
    return ray.ray.distanceToPoint(palm) < POKE_R;
  };
  // the resting cursor: where it is on the floor, how long it has been still, what the hand has done about it
  const cur = { on: false, x: 0, z: 0, still: 0, stage: 0 };
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || controls.enabled) return;
    aim(e);
    if (!ray.ray.intersectPlane(floor, hit) || Math.abs(hit.x) > half || Math.abs(hit.z) > half) { cur.on = false; return; }
    if (!cur.on || Math.hypot(hit.x - cur.x, hit.z - cur.z) > 0.25) { cur.x = hit.x; cur.z = hit.z; cur.still = 0; cur.stage = 0; }
    cur.on = true;
  });
  renderer.domElement.addEventListener('pointerleave', () => { cur.on = false; });

  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || controls.enabled) return;         // debug orbit owns the pointer
    aim(e);
    cur.still = 0; cur.stage = 2;                             // a click is an answer: stop noticing until the cursor moves
    if (onHand()) { brain.poke(); return; }
    const prop = props.pick(ray);                             // a click on a prop uses it
    if (prop) { brain.command([{ do: 'use', target: prop }], { source: 'click' }); return; }
    if (!ray.ray.intersectPlane(floor, hit)) return;
    const x = THREE.MathUtils.clamp(hit.x, -half, half), z = THREE.MathUtils.clamp(hit.z, -half, half);
    const now = performance.now(), d = Math.hypot(x - body.x, z - body.z);
    const speed = now - lastClick < DOUBLE_CLICK ? C.SPEED.sprint : d > FAR ? C.SPEED.scuttle : C.SPEED.strut;
    lastClick = now;
    if (brain.command([{ do: 'walkTo', x, z, speed }], { source: 'click' })) {
      marker.position.set(x, 0.01, z); markerT = 0;
    }
  });

  const held = new Set();
  let keyT = 0, driving = false, acting = null;
  // a key action (jump, turn, emote): a held direction waits for it instead of replacing it
  const act = (plan) => { if (brain.command(plan, { source: 'key' })) acting = brain.st.plan; };
  const typing = (e) => e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
  addEventListener('keydown', (e) => {
    if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (DIRS[e.code]) { e.preventDefault(); held.add(e.code); keyT = KEY_REFRESH; return; }
    if (e.repeat) return;
    if (e.code === 'Space') {
      if (e.target.tagName === 'BUTTON') return;              // Space presses a focused button
      e.preventDefault(); act([{ do: 'jump' }]);
    }
    else if (e.code === 'KeyQ') act([{ do: 'turn', deg: 45 }]);
    else if (e.code === 'KeyE') act([{ do: 'turn', deg: -45 }]);
    else if (/^Digit\d$/.test(e.code)) act([{ do: 'gesture', name: EMOTE_KEYS[(+e.code.slice(5) + 9) % 10] }]);   // 1..9 then 0
  });
  addEventListener('keyup', (e) => held.delete(e.code));
  addEventListener('blur', () => held.clear());

  // cursor awareness: an idle hand looks at a cursor that rests on its floor, and
  // walks over if it stays. Runs as an `auto` command, so any real input replaces it.
  function notice(dt) {
    if (!cur.on || cur.stage > 1 || !brain.idle) { if (!brain.idle) cur.still = 0; return; }
    cur.still += dt;
    const dx = cur.x - body.x, dz = cur.z - body.z, d = Math.hypot(dx, dz);
    if (d < 1) return;                                        // on top of the hand: that is a poke, not a look
    const heading = Math.atan2(-dz, dx);
    if (cur.stage === 0 && cur.still > NOTICE_AFTER) {
      cur.stage = 1; cur.still = 0;
      brain.command([{ do: 'face', heading }, { do: 'gesture', name: 'point' }], { source: 'auto', tag: 'noticing you' });
    } else if (cur.stage === 1 && cur.still > COME_AFTER) {
      cur.stage = 2;
      brain.command([{ do: 'walkTo', x: cur.x - dx / d * 0.9, z: cur.z - dz / d * 0.9, speed: C.SPEED.strut },
        { do: 'gesture', name: 'tap' }], { source: 'auto', tag: 'coming to see' });
    }
  }

  const fwd = new THREE.Vector3();
  function update(dt, shift) {
    if (markerT < 1) {                                        // click marker fades out
      markerT = Math.min(markerT + dt / 0.9, 1);
      marker.material.opacity = 0.7 * (1 - markerT);
      marker.scale.setScalar(1 + 0.5 * markerT);
    }
    notice(dt);
    let dx = 0, dz = 0;
    for (const k of held) { dx += DIRS[k][0]; dz += DIRS[k][1]; }
    if (acting && !(brain.st.plan === acting && brain.st.i >= 0)) acting = null;
    if (!dx && !dz) {
      if (driving) { driving = false; if (!acting) brain.cancel(); }   // release = stop
      return;
    }
    if (acting) return;
    if ((keyT += dt) < KEY_REFRESH) return;
    keyT = 0; driving = true;
    camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();        // screen-up on the floor
    const rx = -fwd.z, rz = fwd.x, l = Math.hypot(dx, dz);            // screen-right
    const wx = (rx * dx + fwd.x * dz) / l, wz = (rz * dx + fwd.z * dz) / l;
    brain.command([{ do: 'walkTo', x: body.x + wx * CARROT, z: body.z + wz * CARROT,
      speed: shift ? C.SPEED.scuttle : C.SPEED.strut }], { source: 'key' });
  }
  let shiftDown = false;
  addEventListener('keydown', (e) => { if (e.key === 'Shift') shiftDown = true; });
  addEventListener('keyup', (e) => { if (e.key === 'Shift') shiftDown = false; });
  return { update: (dt) => update(dt, shiftDown) };
}
