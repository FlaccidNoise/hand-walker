// src/input.js — pointer and keys. Everything here ends in brain.command(): the same
// plan executor voice and idle behaviors use, so every input gets the same turn
// policy, arrival and stop.
//   click floor      walk there (near = strut, far = scuttle, double-click = sprint)
//   hold and drag    the hand follows the pointer; release = stop
//   click a prop     go and use it (light switch, bell, ball, rug, piano)
//   click the hand   poke it: it giggles, then jumps, then loses patience
//   rest the cursor  the hand turns and points at it, and comes over if it stays
//   hover            a brass ring and a label on the thing a click would use
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
const TOUCH = matchMedia('(pointer: coarse)').matches;
const PROP_PAD = TOUCH ? 22 : 8;    // px — a press this near a thing's middle counts as on it
const HAND_PAD = TOUCH ? 26 : 0;    // px — and this near the palm is a poke, however small the hand is drawn
const LEAD_MOVE = 6;                // px a held pointer travels before the hand follows it
const VERB = { switch: 'flip', bell: 'ring', ball: 'kick', rug: 'nap', piano: 'play' };
const DIRS = { KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };

export function initInput({ renderer, camera, controls, scene, rig, brain, props, ui }) {
  const cv = renderer.domElement, tip = document.getElementById('tip');
  const body = rig.mount.position, half = C.ROOM.half;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), hit = new THREE.Vector3();
  const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.13, 0.18, 32),
    new THREE.MeshBasicMaterial({ color: 0xe8c98a, transparent: true, opacity: 0, depthWrite: false }));
  marker.rotation.x = -Math.PI / 2;
  // the ring around a thing the pointer is on, or one just pressed. Sized from the
  // thing's world bounds and drawn here: no prop's own materials are touched.
  const halo = new THREE.Mesh(new THREE.RingGeometry(0.95, 1, 64),
    new THREE.MeshBasicMaterial({ color: 0xc9a35a, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  scene.add(marker, halo);
  let markerT = 1, lastClick = -1e9, rect = cv.getBoundingClientRect();
  const aim = (e) => {
    rect = cv.getBoundingClientRect();
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  };
  const palm = new THREE.Vector3(), box = new THREE.Box3(), size = new THREE.Vector3(), mid = new THREE.Vector3(), v = new THREE.Vector3();
  // px from the pointer to a world point, through the live camera
  const px = (e, p) => { v.copy(p).project(camera); return Math.hypot(rect.left + (v.x + 1) / 2 * rect.width - e.clientX, rect.top + (1 - v.y) / 2 * rect.height - e.clientY); };
  // what a press here would act on: 'hand', a prop id, or null for the floor. Call after aim(e).
  function under(e) {
    rig.digits.middle.mcp.getWorldPosition(palm).add(body).multiplyScalar(0.5);   // wrist and middle knuckle bracket the palm
    if (ray.ray.distanceToPoint(palm) < POKE_R || px(e, palm) < HAND_PAD) return 'hand';
    let best = props.pick(ray), bd = PROP_PAD;
    if (!best) for (const id of props.ids) {                 // a small or far thing: near its middle is close enough
      const d = px(e, box.setFromObject(props.get(id).mesh).getCenter(mid));
      if (d < bd) { bd = d; best = id; }
    }
    return best;
  }
  // lay the ring flat on the thing's thinnest side, wide enough to clear its corners
  function ring(id) {
    box.setFromObject(props.get(id).mesh); box.getSize(size); box.getCenter(mid);
    const k = (s) => s * 0.72 + 0.1;
    halo.rotation.set(0, 0, 0);
    if (size.y <= size.x && size.y <= size.z) { halo.rotation.x = -Math.PI / 2; halo.scale.set(k(size.x), k(size.z), 1); halo.position.set(mid.x, box.min.y + 0.02, mid.z); }
    else if (size.z <= size.x) { halo.scale.set(k(size.x), k(size.y), 1); halo.position.set(mid.x, mid.y, box.max.z + 0.02); }
    else { halo.rotation.y = Math.PI / 2; halo.scale.set(k(size.z), k(size.y), 1); halo.position.set(box.max.x + 0.02, mid.y, mid.z); }
  }
  // the resting cursor: where it is on the floor, how long it has been still, what the hand has done about it
  const cur = { on: false, x: 0, z: 0, still: 0, stage: 0 };
  let hover = null, flash = null, flashT = 0;                 // thing under the mouse · thing just pressed, and its fade
  let lead = null;                                            // a held pointer: { id, x, y, moved, tx, tz }
  cv.addEventListener('pointermove', (e) => {
    if (controls.enabled) return;
    if (lead && e.pointerId === lead.id) {
      if (Math.hypot(e.clientX - lead.x0, e.clientY - lead.y0) > LEAD_MOVE) lead.moved = true;
      lead.x = e.clientX; lead.y = e.clientY;
    }
    if (e.pointerType !== 'mouse') return;
    aim(e);
    hover = lead ? null : under(e);
    cv.style.cursor = hover ? 'pointer' : '';
    if (!ray.ray.intersectPlane(floor, hit) || Math.abs(hit.x) > half || Math.abs(hit.z) > half) { cur.on = false; return; }
    if (!cur.on || Math.hypot(hit.x - cur.x, hit.z - cur.z) > 0.25) { cur.x = hit.x; cur.z = hit.z; cur.still = 0; cur.stage = 0; }
    cur.on = true;
  });
  cv.addEventListener('pointerleave', () => { cur.on = false; hover = null; });

  cv.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || controls.enabled) return;         // debug orbit owns the pointer
    aim(e);
    cur.still = 0; cur.stage = 2;                             // a click is an answer: stop noticing until the cursor moves
    const on = under(e);
    if (on === 'hand') { if (brain.poke()) ui.did('hand'); return; }
    if (on) {                                                 // a click on a prop uses it
      if (brain.command([{ do: 'use', target: on }], { source: 'click' })) { ui.did('prop'); flash = on; flashT = 1; }
      return;
    }
    if (!ray.ray.intersectPlane(floor, hit)) return;
    const x = THREE.MathUtils.clamp(hit.x, -half, half), z = THREE.MathUtils.clamp(hit.z, -half, half);
    const now = performance.now(), d = Math.hypot(x - body.x, z - body.z);
    const speed = now - lastClick < DOUBLE_CLICK ? C.SPEED.sprint : d > FAR ? C.SPEED.scuttle : C.SPEED.strut;
    lastClick = now;
    if (brain.command([{ do: 'walkTo', x, z, speed }], { source: 'click' })) {
      marker.position.set(x, 0.01, z); markerT = 0;
      ui.did('floor');
      cv.setPointerCapture(e.pointerId);                      // held and dragged, the hand follows (see update)
      lead = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: false, tx: x, tz: z };
    }
  });
  const drop = (e) => {
    if (!lead || e.pointerId !== lead.id) return;
    if (lead.moved) brain.cancel();                           // led by the pointer: release = stop. A plain click walks on.
    lead = null;
  };
  cv.addEventListener('pointerup', drop);
  cv.addEventListener('pointercancel', drop);

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
  let leadT = 0;
  function update(dt, shift) {
    if (markerT < 1) {                                        // click marker fades out
      markerT = Math.min(markerT + dt / 0.9, 1);
      marker.material.opacity = 0.7 * (1 - markerT);
      marker.scale.setScalar(1 + 0.5 * markerT);
    }
    // ring and label: steady on the thing under the mouse, a short flash on a thing just pressed
    flashT = Math.max(0, flashT - dt / 0.6);
    const lit = hover && hover !== 'hand' ? hover : flashT > 0 ? flash : null, p = lit && props.get(lit);
    halo.material.opacity = !p ? 0 : lit === hover ? 0.85 : flashT;
    if (p) ring(lit);
    tip.hidden = !p || lit !== hover;
    if (!tip.hidden) {
      const text = VERB[lit] ? `${p.label} · click to ${VERB[lit]}` : p.label;
      if (tip.textContent !== text) tip.textContent = text;
      v.set(mid.x, box.max.y, mid.z).project(camera);
      tip.style.transform = `translate(${Math.round(rect.left + (v.x + 1) / 2 * rect.width)}px, ${Math.round(rect.top + (1 - v.y) / 2 * rect.height - 14)}px) translate(-50%, -100%)`;
    }
    // a held pointer that moved leads the hand: a fresh walk target under it, like a held key
    if (lead && lead.moved && (leadT += dt) >= KEY_REFRESH) {
      leadT = 0;
      aim({ clientX: lead.x, clientY: lead.y });
      if (ray.ray.intersectPlane(floor, hit)) {
        const x = THREE.MathUtils.clamp(hit.x, -half, half), z = THREE.MathUtils.clamp(hit.z, -half, half);
        if (Math.hypot(x - lead.tx, z - lead.tz) > 0.15) {
          lead.tx = x; lead.tz = z;
          brain.command([{ do: 'walkTo', x, z, speed: Math.hypot(x - body.x, z - body.z) > FAR ? C.SPEED.scuttle : C.SPEED.strut }], { source: 'click' });
        }
      }
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
