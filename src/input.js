// src/input.js — pointer and keys. Everything here ends in brain.command(): the same
// plan executor voice and idle behaviors use, so every input gets the same turn
// policy, arrival and stop.
//   click floor      walk there (near = strut, far = scuttle, double-click = sprint)
//   hold and drag    the hand follows the pointer; release = stop
//   click a prop     go and use it (light switch, bell, ball, rug, piano)
//   drag the ball    throw it: it rolls the way and as fast as it was dragged, and the hand goes after it
//   click the hand   poke it: it giggles, then jumps, then loses patience
//   rub the hand     pet it (no press needed with a mouse): it forgets the pokes
//   hold the hand    0.5 s: a high five. Let go while the palm is up and the slap lands
//   drag off the hand  fling it: it sprints the way it was pulled, further for a longer pull
//   two fingers      pinch: the view comes closer (the wheel does the same, src/scene.js)
//   rest the cursor  the hand turns and points at it, and comes over if it stays
//   hover            a brass ring and a label on the thing a click would use
//   leave            the mouse goes off the page: the hand goes to that side and knocks.
//                    The tab comes back after a while: it is at the glass, waving
//   WASD / arrows    walk, camera-relative (hold Shift to scuttle); release = stop
//   Q / E            pivot 45° left / right        Space  jump
//   1-9, 0           emotes
import * as THREE from 'three';
import * as C from './tuning.js';

// what a touch on the hand itself does, as plans: re-point the gesture names here
const HAND = {
  pet: [{ do: 'gesture', name: 'crouch' }, { do: 'gesture', name: 'yes' }],   // rubbed: it settles under the pointer and nods
  highFive: [{ do: 'gesture', name: 'highFive' }],                             // held: palm up
  slap: [{ do: 'gesture', name: 'laugh' }],                                    // let go while the palm is up
  thrown: [{ do: 'gesture', name: 'startle' }],                                // the ball flies off: a start, then after it
};
const FAR = 2.5;                    // u — clicks further than this scuttle
const DOUBLE_CLICK = 350;           // ms
const CARROT = 1.5;                 // u — keys aim a walk target this far ahead
const KEY_REFRESH = 0.1;            // s between carrot updates while a direction is held
export const EMOTE_KEYS = ['wave', 'yes', 'shake', 'idk', 'laugh', 'bow', 'thumbsUp', 'peace', 'snap', 'doubleSnap'];   // quick ones: the long perch `no` is in the palette
const POKE_R = 0.6;                 // u — a click this close to the hand's middle is a poke
const NOTICE_AFTER = 1.6;           // s the cursor rests on the floor before the hand looks
const COME_AFTER = 5;               // s more before it walks over
const REST_PX = 12;                 // px the mouse may drift and still count as resting
const TOUCH = matchMedia('(pointer: coarse)').matches;
const PROP_PAD = TOUCH ? 22 : 8;    // px — a press this near a thing's middle counts as on it
const HAND_PAD = TOUCH ? 26 : 0;    // px — and this near the palm is a poke, however small the hand is drawn
const SLOP = TOUCH ? 10 : 6;        // px a held pointer travels before it counts as moved
const TAP_WAIT = 0.15;              // s a finger on the floor waits before it walks: it may be the first of a pinch
const ZOOM_NEAR = 0.5;              // the nearest a pinch brings the view (scene.js ZOOM_MIN, the wheel's limit)
const HOLD = 0.5;                   // s a still press on the hand before the high five
const RUB_TURNS = 3, RUB_FOR = 1.2; // a pet: the pointer turns back on itself this often over the hand, inside this many s
const PET_REST = 2.5;               // s before the next pet counts
const FLING_OUT = 1.5;              // hand-zone radii a press must be dragged off the palm to become a fling
const FLING_GAIN = 1.6;             // the hand runs this many times the length of the pull
const THROW_T = 0.25;               // s — the shortest drag a throw's speed is worked out over
const CHASE_AT = 1.5, CHASE_WAIT = 2; // the hand goes after a thrown ball once it rolls slower than this (u/s), or after this many s
const GONE_AFTER = 2.5;             // s the mouse is off the page before the hand goes looking
const AWAY = 20;                    // s a hidden tab counts as time away
const VERB = { switch: 'flip', bell: 'ring', ball: 'kick', rug: 'nap', piano: 'play', box: 'go home' };
const DIRS = { KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };

export function initInput({ renderer, camera, view, controls, scene, rig, brain, props, ui }) {
  const cv = renderer.domElement, tip = document.getElementById('tip'), cap = document.getElementById('caption');
  const body = rig.mount.position, half = C.ROOM.half;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), hit = new THREE.Vector3();
  const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.13, 0.18, 32),
    new THREE.MeshBasicMaterial({ color: 0xe8c98a, transparent: true, opacity: 0, depthWrite: false }));
  marker.rotation.x = -Math.PI / 2;
  // the ring around a thing the pointer is on, or one just pressed. Sized from the
  // thing's world bounds and drawn here: no prop's own materials are touched.
  const halo = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(new THREE.Path().absarc(0, 0, 1, 0, Math.PI * 2).getPoints(72)),
    new THREE.LineBasicMaterial({ color: 0xe8c98a, transparent: true, opacity: 0, depthTest: false }));   // a hairline, the same width at any size
  // the pull: a line on the floor from the hand, or the ball, to the pointer that drags it
  const pull = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color: 0xe8c98a, depthTest: false }));
  halo.renderOrder = pull.renderOrder = 2; pull.visible = false; pull.frustumCulled = false;
  scene.add(marker, halo, pull);
  let markerT = 1, lastClick = -1e9, rect = cv.getBoundingClientRect();
  const aim = (e) => {
    rect = cv.getBoundingClientRect();
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  };
  const palm = new THREE.Vector3(), box = new THREE.Box3(), size = new THREE.Vector3(), mid = new THREE.Vector3(), v = new THREE.Vector3(), side = new THREE.Vector3();
  const clamp = (a) => THREE.MathUtils.clamp(a, -half, half);
  // where a world point is on the page, and px from the pointer to it, through the live camera
  const scr = (p) => { v.copy(p).project(camera); return [rect.left + (v.x + 1) / 2 * rect.width, rect.top + (1 - v.y) / 2 * rect.height]; };
  const px = (e, p) => { const [x, y] = scr(p); return Math.hypot(x - e.clientX, y - e.clientY); };
  // the floor under a pointer (in `hit`), or null where it points over the walls
  const ground = (e) => { aim(e); return ray.ray.intersectPlane(floor, hit); };
  // how far a pointer is from the palm, in hand-zone radii (1 = the edge a poke counts to)
  function off(e) {
    rig.digits.middle.mcp.getWorldPosition(palm).add(body).multiplyScalar(0.5);
    const [x, y] = scr(palm), [rx, ry] = scr(side.setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(POKE_R).add(palm));
    return Math.hypot(e.clientX - x, e.clientY - y) / Math.max(Math.hypot(rx - x, ry - y), HAND_PAD, 1);
  }
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
  // lay the ring on the floor around the thing, wide enough to clear its corners. A flat
  // plate on a wall (under half as deep as it is wide and tall) gets its ring on the wall.
  function ring(id) {
    box.setFromObject(props.get(id).mesh, true); box.getSize(size); box.getCenter(mid);   // precise: a rolling ball keeps its size
    const k = (s) => s * 0.72 + 0.1;
    halo.rotation.set(0, 0, 0);
    if (size.z < 0.5 * Math.min(size.x, size.y)) { halo.scale.set(k(size.x), k(size.y), 1); halo.position.set(mid.x, mid.y, box.max.z + 0.02); }
    else if (size.x < 0.5 * Math.min(size.y, size.z)) { halo.rotation.y = Math.PI / 2; halo.scale.set(k(size.z), k(size.y), 1); halo.position.set(box.max.x + 0.02, mid.y, mid.z); }
    else { halo.rotation.x = -Math.PI / 2; halo.scale.set(k(size.x), k(size.z), 1); halo.position.set(mid.x, box.min.y + 0.02, mid.z); }
  }
  // the resting cursor: where it is on the floor, how long it has been still, what the hand has done about it
  const cur = { on: false, x: 0, z: 0, px: 0, py: 0, still: 0, stage: 0 };
  let hover = null, flash = null, flashT = 0;                 // thing under the mouse · thing just pressed, and its fade
  let mouse = null;                                           // where the mouse is. The camera moves under a still
  function look() {                                           // mouse, so what it is over is read again every frame
    aim(mouse);
    hover = lead || press || pinch ? null : under(mouse);
    cv.style.cursor = hover ? 'pointer' : '';
    cur.on = !!ray.ray.intersectPlane(floor, hit) && Math.abs(hit.x) <= half && Math.abs(hit.z) <= half;
    if (cur.on) { cur.x = hit.x; cur.z = hit.z; }
  }
  // pointers down on the canvas. One is a press, read below. Two are a pinch.
  const down = new Map();                                     // id → { x, y }
  let lead = null;                                            // a press on the floor or a prop: { id, on, x0, y0, x, y, t, moved, went, tx, tz }
  let press = null;                                           // a press on the hand or the ball: { id, on, x0, y0, x, y, t, moved, far, five, petted }
  let pinch = null;                                           // { d, zoom } as the second finger landed
  let chase = null;                                           // a thrown ball the hand watches, then goes after: { plan, t, n, x, z, bx, bz, going }
  let clock = 0;                                              // s, for the rub and its rest

  // what a press on a prop or the floor asks for: use it, or walk there
  function go(l) {
    l.went = true;
    if (l.on) {
      if (brain.command([{ do: 'use', target: l.on }], { source: 'click' })) { ui.did('prop'); flash = l.on; flashT = 1; l.ours = true; }
      return;
    }
    if (!ground({ clientX: l.x0, clientY: l.y0 })) return;
    const x = clamp(hit.x), z = clamp(hit.z);
    const now = performance.now(), d = Math.hypot(x - body.x, z - body.z);
    const speed = now - lastClick < DOUBLE_CLICK ? C.SPEED.sprint : d > FAR ? C.SPEED.scuttle : C.SPEED.strut;
    lastClick = now;
    if (!brain.command([{ do: 'walkTo', x, z, speed }], { source: 'click' })) return;
    marker.position.set(x, 0.01, z); markerT = 0;
    ui.did('floor');
    l.tx = x; l.tz = z; l.ours = true;
  }
  // a rub is the pointer turning back on itself over the hand. Enough turns is a pet:
  // the hand settles into it, and the pokes are forgiven.
  const rub = { x: 0, y: 0, dx: 0, dy: 0, turns: [] };
  let petAt = -1e9;
  function rubbed(x, y) {
    const dx = x - rub.x, dy = y - rub.y;
    if (Math.hypot(dx, dy) < 5) return false;
    if (dx * rub.dx + dy * rub.dy < 0) rub.turns.push(clock);
    rub.x = x; rub.y = y; rub.dx = dx; rub.dy = dy;
    while (rub.turns.length && clock - rub.turns[0] > RUB_FOR) rub.turns.shift();
    if (rub.turns.length < RUB_TURNS || clock - petAt < PET_REST) return false;
    rub.turns.length = 0; petAt = clock;
    brain.soothe();
    brain.command(HAND.pet, { source: 'click', tag: 'enjoying that' });
    return true;
  }
  // a press on the hand or the ball ends: what was it?
  function release(p) {
    const at = { clientX: p.x, clientY: p.y };
    if (p.on === 'ball') {                                    // dragged: thrown the way and as fast as the drag. Not dragged: a plain use.
      const b = props.get('ball').anchor;
      if (p.moved && ground(at)) {
        const t = Math.max(p.t, THROW_T);
        props.kick((hit.x - b.x) / t, (hit.z - b.z) / t);
        if (brain.command(HAND.thrown, { source: 'click' })) chase = { plan: brain.st.plan, t: 0, n: 0, x: b.x, z: b.z, bx: b.x, bz: b.z, going: false };
      } else if (brain.command([{ do: 'use', target: 'ball' }], { source: 'click' })) { ui.did('prop'); flash = 'ball'; flashT = 1; }
    } else if (p.petted) return;
    else if (p.far) {                                         // flung: it sprints the way it was pulled, further for a longer pull
      if (!ground(at)) return;
      const x = clamp(body.x + (hit.x - body.x) * FLING_GAIN), z = clamp(body.z + (hit.z - body.z) * FLING_GAIN);
      if (brain.command([{ do: 'walkTo', x, z, speed: C.SPEED.sprint }], { source: 'click' })) { marker.position.set(x, 0.01, z); markerT = 0; }
    } else if (p.five) {                                      // let go while the high five is up: the slap lands
      const a = brain.st.plan[brain.st.i];
      if (a && a.started && a.name === HAND.highFive.at(-1).name) brain.command(HAND.slap, { source: 'click' });
    } else if (brain.poke()) ui.did('hand');
  }

  cv.addEventListener('pointermove', (e) => {
    if (controls.enabled) return;
    const d = down.get(e.pointerId);
    if (d) { d.x = e.clientX; d.y = e.clientY; }
    if (pinch) {                                              // fingers apart: closer
      const [a, b] = [...down.values()];
      if (b) view.zoom = THREE.MathUtils.clamp(pinch.zoom * pinch.d / (Math.hypot(a.x - b.x, a.y - b.y) || 1), ZOOM_NEAR, 1);
      return;
    }
    const grip = lead && e.pointerId === lead.id ? lead : press && e.pointerId === press.id ? press : null;
    if (grip) {
      grip.x = e.clientX; grip.y = e.clientY;
      if (Math.hypot(e.clientX - grip.x0, e.clientY - grip.y0) > SLOP) grip.moved = true;
    }
    if (grip && grip === press && press.on === 'hand' && !press.far) {
      if (off(e) > FLING_OUT) press.far = true;               // dragged off the hand: a fling is being drawn
      else if (rubbed(e.clientX, e.clientY)) press.petted = true;
    }
    if (e.pointerType !== 'mouse') return;
    mouse = { clientX: e.clientX, clientY: e.clientY };
    if (Math.hypot(e.clientX - cur.px, e.clientY - cur.py) > REST_PX) { cur.px = e.clientX; cur.py = e.clientY; cur.still = 0; cur.stage = 0; }
    look();
    if (hover === 'hand' && !e.buttons && (brain.idle || brain.st.tag)) rubbed(e.clientX, e.clientY);   // a mouse pets without a press
    else if (!press) rub.turns.length = 0;
  });
  cv.addEventListener('pointerleave', () => { mouse = null; cur.on = false; hover = null; });

  cv.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || controls.enabled) return;         // debug orbit owns the pointer
    down.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (down.size > 1) {                                      // a second finger: a pinch, and what the first began is taken back
      if (lead && lead.ours) brain.cancel();
      lead = press = null;
      const [a, b] = [...down.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: view.zoom };
      return;
    }
    pinch = null;
    aim(e);
    cur.still = 0; cur.stage = 2;                             // a click is an answer: stop noticing until the cursor moves
    const on = under(e), grip = { id: e.pointerId, on, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t: 0 };
    cv.setPointerCapture(e.pointerId);                        // a drag that leaves the canvas still ends here
    if (on === 'hand' || on === 'ball') { press = grip; rub.turns.length = 0; return; }   // read when it ends, or as it is held
    lead = grip;                                              // a prop: use it. The floor: walk, and held and dragged the hand follows (see update)
    if (e.pointerType !== 'touch') go(lead);                  // a finger waits a moment: it may be the first of a pinch
  });
  const lift = (e) => {
    down.delete(e.pointerId);
    if (pinch) { if (!down.size) pinch = null; return; }
    if (lead && e.pointerId === lead.id) {
      if (!lead.went) { if (e.type === 'pointerup') go(lead); }       // a tap
      else if (lead.moved && !lead.on) brain.cancel();        // led by the pointer: release = stop. A plain click walks on.
      lead = null;
    } else if (press && e.pointerId === press.id) {
      if (e.type === 'pointerup') release(press);
      press = null;
    }
  };
  cv.addEventListener('pointerup', lift);
  cv.addEventListener('pointercancel', lift);
  addEventListener('blur', () => { down.clear(); pinch = lead = press = null; });   // a lift the page never saw must not leave a finger down

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
    if (!cur.on || cur.stage > 1 || !brain.idle || !rig.mount.visible || hover === 'hand') { if (!brain.idle) cur.still = 0; return; }   // (on the hand: that is its own business)
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

  // it notices you leaving. Both are `auto` commands: any real input replaces them.
  let goneT = -1, exit = null, hiddenAt = 0;
  document.documentElement.addEventListener('mouseleave', (e) => { exit = { clientX: e.clientX, clientY: e.clientY }; goneT = 0; mouse = null; cur.on = false; hover = null; });
  document.documentElement.addEventListener('mouseenter', () => { goneT = -1; });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (hiddenAt && Date.now() - hiddenAt > AWAY * 1000 && brain.idle)
      brain.command([{ do: 'routine', name: 'knock' }], { source: 'auto', tag: 'glad you are back' });
  });
  function seek() {                                           // to the edge of the room nearest where the mouse went, and knock
    aim(exit);
    if (!ray.ray.intersectPlane(floor, hit)) hit.copy(ray.ray.direction).setY(0).normalize().multiplyScalar(30);   // it left over the walls
    const x = THREE.MathUtils.clamp(hit.x, -half + 0.3, half - 0.3), z = THREE.MathUtils.clamp(hit.z, -half + 0.3, half - 0.3);
    brain.command([{ do: 'walkTo', x, z, speed: C.SPEED.scuttle }, { do: 'face', heading: Math.atan2(-(hit.z - z), hit.x - x) },
      { do: 'gesture', name: 'knock' }], { source: 'auto', tag: 'wondering where you went' });
  }

  const fwd = new THREE.Vector3();
  let leadT = 0;
  function update(dt, shift) {
    if (markerT < 1) {                                        // click marker fades out
      markerT = Math.min(markerT + dt / 0.9, 1);
      marker.material.opacity = 0.7 * (1 - markerT);
      marker.scale.setScalar(1 + 0.5 * markerT);
    }
    if (mouse && !controls.enabled) look();
    // ring and label: steady on the thing under the mouse, a short flash on a thing just pressed
    flashT = Math.max(0, flashT - dt / 0.6);
    const lit = hover && hover !== 'hand' ? hover : flashT > 0 ? flash : null, p = lit && props.get(lit);
    halo.material.opacity = !p ? 0 : lit === hover ? 0.85 : flashT;
    if (p) ring(lit);
    tip.hidden = !p || lit !== hover;
    if (!tip.hidden) {
      const text = VERB[lit] ? `${p.label} · click to ${VERB[lit]}` : p.label;
      if (tip.textContent !== text) tip.textContent = text;
      // above the thing, or under it where the caption already stands above
      const [x, y] = scr(v.set(mid.x, box.max.y, mid.z)), c = cap.hidden ? null : cap.getBoundingClientRect();
      const below = c && y - 14 > c.top - 4 && y - 14 - tip.offsetHeight < c.bottom + 4 && Math.abs(x - (c.left + c.right) / 2) < (c.width + tip.offsetWidth) / 2 + 4;
      tip.style.transform = below ? `translate(${Math.round(x)}px, ${Math.round(scr(v.set(mid.x, box.min.y, mid.z))[1] + 14)}px) translate(-50%, 0)`
        : `translate(${Math.round(x)}px, ${Math.round(y - 14)}px) translate(-50%, -100%)`;
    }
    clock += dt;
    // a finger acts once it has moved or waited long enough not to be the first of a pinch
    if (lead && !lead.went && (lead.moved || (lead.t += dt) > TAP_WAIT)) go(lead);
    // a held pointer on the floor that moved leads the hand: a fresh walk target under it, like a held key
    if (lead && lead.moved && !lead.on && (leadT += dt) >= KEY_REFRESH) {
      leadT = 0;
      if (ground({ clientX: lead.x, clientY: lead.y })) {
        const x = clamp(hit.x), z = clamp(hit.z);
        if (Math.hypot(x - lead.tx, z - lead.tz) > 0.15) {
          lead.tx = x; lead.tz = z;
          brain.command([{ do: 'walkTo', x, z, speed: Math.hypot(x - body.x, z - body.z) > FAR ? C.SPEED.scuttle : C.SPEED.strut }], { source: 'click' });
        }
      }
    }
    // a still press on the hand, held: the high five goes up
    if (press && (press.t += dt) >= HOLD && press.on === 'hand' && !press.moved && !press.five) {
      press.five = true;
      brain.command(HAND.highFive, { source: 'click' });
    }
    // the pull line: from the hand while a fling is drawn, from the ball while it is dragged
    const from = !press ? null : press.on === 'ball' ? press.moved && props.get('ball').anchor : press.far && !press.petted && body;
    pull.visible = !!from && !!ground({ clientX: press.x, clientY: press.y });
    if (pull.visible) {
      pull.geometry.attributes.position.setXYZ(0, from.x, 0.04, from.z).setXYZ(1, hit.x, 0.04, hit.z).needsUpdate = true;
    }
    // a thrown ball: the hand watches it go (a target that sweeps past stalls its turn), sets
    // off once the ball has slowed, and the errand follows the ball until the hand is there
    if (chase) {
      const b = props.get('ball').anchor, a = brain.st.plan[brain.st.i];
      const speed = Math.hypot(b.x - chase.bx, b.z - chase.bz) / dt, after = () => {
        chase.n = 0; chase.x = b.x; chase.z = b.z;
        if (brain.command([{ do: 'use', target: 'ball' }], { source: 'click' })) { chase.going = true; flash = 'ball'; flashT = 1; }
      };
      chase.bx = b.x; chase.bz = b.z; chase.t += dt;
      if (!chase.going) {
        if (brain.st.plan !== chase.plan) chase = null;        // something else was asked for meanwhile
        else if (speed < CHASE_AT || chase.t > CHASE_WAIT) after();
      } else if (!a || a.for !== 'ball' || Math.hypot(b.x - body.x, b.z - body.z) < 1.2 || chase.t > 12) chase = null;
      else if ((chase.n += dt) > 0.6 && Math.hypot(b.x - chase.x, b.z - chase.z) > 0.4) after();
    }
    notice(dt);
    if (goneT >= 0 && (goneT += dt) > GONE_AFTER && (brain.idle || goneT > 4 * GONE_AFTER)) { goneT = -1; if (brain.idle && rig.mount.visible) seek(); }   // once it is free, within reason
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
