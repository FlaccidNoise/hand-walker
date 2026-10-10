// src/input.js — pointer and keys. Everything here ends in brain.command(): the same
// plan executor voice and idle behaviors use, so every input gets the same turn
// policy, arrival and stop.
//   click floor      walk there (near = strut, far = scuttle, double-click = sprint)
//   WASD / arrows    walk, camera-relative (hold Shift to scuttle); release = stop
//   Q / E            pivot 45° left / right        Space  jump
//   1-9, 0           emotes
import * as THREE from 'three';
import * as C from './tuning.js';

const FAR = 2.5;                    // u — clicks further than this scuttle
const DOUBLE_CLICK = 350;           // ms
const CARROT = 1.5;                 // u — keys aim a walk target this far ahead
const KEY_REFRESH = 0.1;            // s between carrot updates while a direction is held
export const EMOTE_KEYS = ['wave', 'yes', 'no', 'idk', 'laugh', 'bow', 'point', 'beckon', 'thumbsUp', 'thinking'];
const DIRS = { KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };

export function initInput({ renderer, camera, controls, scene, rig, brain }) {
  const body = rig.mount.position, half = C.ROOM.half;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), hit = new THREE.Vector3();
  const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.13, 0.18, 32),
    new THREE.MeshBasicMaterial({ color: 0xbfd4ff, transparent: true, opacity: 0, depthWrite: false }));
  marker.rotation.x = -Math.PI / 2;
  scene.add(marker);
  let markerT = 1, lastClick = -1e9;

  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || controls.enabled) return;         // debug orbit owns the pointer
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
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
  let keyT = 0, driving = false;
  const typing = (e) => e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
  addEventListener('keydown', (e) => {
    if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (DIRS[e.code]) { e.preventDefault(); held.add(e.code); keyT = KEY_REFRESH; return; }
    if (e.repeat) return;
    if (e.code === 'Space') { e.preventDefault(); brain.command([{ do: 'jump' }], { source: 'key' }); }
    else if (e.code === 'KeyQ') brain.command([{ do: 'turn', deg: 45 }], { source: 'key' });
    else if (e.code === 'KeyE') brain.command([{ do: 'turn', deg: -45 }], { source: 'key' });
    else if (/^Digit\d$/.test(e.code)) {
      const name = EMOTE_KEYS[(+e.code.slice(5) + 9) % 10];   // 1..9 then 0
      brain.command([{ do: 'gesture', name }], { source: 'key' });
    }
  });
  addEventListener('keyup', (e) => held.delete(e.code));
  addEventListener('blur', () => held.clear());

  const fwd = new THREE.Vector3();
  function update(dt, shift) {
    if (markerT < 1) {                                        // click marker fades out
      markerT = Math.min(markerT + dt / 0.9, 1);
      marker.material.opacity = 0.7 * (1 - markerT);
      marker.scale.setScalar(1 + 0.5 * markerT);
    }
    let dx = 0, dz = 0;
    for (const k of held) { dx += DIRS[k][0]; dz += DIRS[k][1]; }
    if (!dx && !dz) {
      if (driving) { driving = false; brain.cancel(); }       // release = stop
      return;
    }
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
