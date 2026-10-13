// src/scene.js — renderer/scene/camera/controls/lightRig/ground + rebuildGround (HANDOFF §3)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OBSTACLES, CELL, EXTENT, vertexH } from './terrain.js';
import { ROOM } from './tuning.js';
import { PAINT, paintStats } from './paint.js';

// ?dev is the gates' and film.mjs's view: QA walks the bump field outside the room, so
// that field, its wire and the wide shadow frustum stay. The shipped page shows the room
// alone, a model on a dark table.
const DEV = new URLSearchParams(location.search).has('dev');

// the fixed view, as eye (camera − target), target and fov. Two rigs, blended by window
// shape: a wide window takes the long lens, a phone held upright looks down from higher
// so the room fills it (its side corners are cropped). Both stand at azimuth 39.6°, so
// the brain's screen directions hold at every shape.
const CAM_WIDE = { fov: 36, eye: [9.95, 6.31, 11.99], target: [0, 0.3, 0.3] };    // aspect ≥ 1.6
const CAM_TALL = { fov: 50, eye: [12.96, 17.06, 15.73], target: [0.9, 0, 1.0] };  // aspect ≤ 0.46. The switch and the bell keep a thumb's width from the screen edge
const FOLLOW = 0.3, FOLLOW_TALL = 0.35;    // share of the hand's position the view's target takes (wide, + upright phone)
const CLOSE_K = 0.72, CLOSE_HOLD = 0.9;    // dolly while a gesture plays · s it stays in after one ends
const ZOOM_MIN = 0.5;                      // nearest wheel dolly, as a share of the home distance

const std = (color, roughness, o) => new THREE.MeshStandardMaterial({ color, roughness, ...o });

export function buildScene(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.userData.paint = paintStats;    // ms spent painting textures (props.js adds its own)
  scene.background = PAINT.sky();
  scene.fog = new THREE.Fog(0x0b0908, 22, 48);               // swallows the table's edge, not the room

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.25;    // full IBL floods shadows and greys the wood

  // fixed diorama camera: we look INTO Thing's room; orbit is a debug-only tool
  // (backtick re-enables it — see main.js)
  const camera = new THREE.PerspectiveCamera(CAM_WIDE.fov, container.clientWidth / container.clientHeight, 0.01, 200);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.minDistance = 0.4;
  controls.maxDistance = 30;
  controls.enabled = false;

  // --- light rig: one warm key (the sconce's light, props.js) against cool moonlight.
  // props.js owns the levels from here on: it eases them when the switch flips. ---
  const hemi = new THREE.HemisphereLight(0x9aa3b8, 0x2a1a10, 0.3);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffd9ae, 2.5);
  key.position.set(8, 4.6, 3);               // low (~28°): long finger shadows across the boards
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  const s = DEV ? 18 : 9;                    // the room alone, or the gates' whole bump field
  key.shadow.camera.left = -s; key.shadow.camera.right = s;
  key.shadow.camera.top = s; key.shadow.camera.bottom = -s;
  key.shadow.camera.near = 0.5; key.shadow.camera.far = 25;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.03;              // the hand shadows itself: no acne on its coarse skin
  scene.add(key);
  const amb = new THREE.AmbientLight(0x2a2030, 0.32);
  scene.add(amb);
  const rim = new THREE.DirectionalLight(0x7f9cff, 0.4);     // moon, from behind the back corner
  rim.position.set(-5, 6, -9);
  scene.add(rim);

  const ground = rebuildGround();
  scene.add(ground.group);

  // `view` is the fixed view for this window shape and camHome the camera position it
  // gives. Both are live: frame() rewrites them on resize, so a follow or a dolly can
  // offset them each frame without touching frame().
  const view = { eye: new THREE.Vector3(), target: new THREE.Vector3(), fov: CAM_WIDE.fov };
  const camHome = new THREE.Vector3(), _v = new THREE.Vector3();
  const frame = () => {
    const p = THREE.MathUtils.clamp((1.6 - camera.aspect) / 1.14, 0, 1);
    view.eye.fromArray(CAM_WIDE.eye).lerp(_v.fromArray(CAM_TALL.eye), p);
    view.target.fromArray(CAM_WIDE.target).lerp(_v.fromArray(CAM_TALL.target), p);
    view.fov = THREE.MathUtils.lerp(CAM_WIDE.fov, CAM_TALL.fov, p); view.tall = p;
    camHome.copy(view.target).add(view.eye);
    const d = view.eye.length();
    scene.fog.near = d + 6; scene.fog.far = d + 32;          // the fog keeps its place behind the room
    camera.fov = view.fov; camera.updateProjectionMatrix();
    if (controls.enabled) return;                            // the debug orbit keeps its own view
    camera.position.copy(camHome); controls.target.copy(view.target); camera.lookAt(view.target);
  };
  frame();
  controls.update();

  // follow and push-in. The view only TRANSLATES (its target slides toward the hand)
  // and DOLLIES along its own line of sight: azimuth and elevation never change, so the
  // brain's screen directions hold. `close` = a gesture is playing: lean in on the hand.
  // The wheel dollies too. view.hold = a tool has placed the camera itself (snap, film).
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const off = new THREE.Vector3(), want = new THREE.Vector3();
  let dolly = 1, closeT = 0;
  view.zoom = 1; view.shake = 0; view.hold = false;
  renderer.domElement.addEventListener('wheel', (e) => {
    if (controls.enabled) return;                            // the debug orbit owns the wheel
    e.preventDefault();
    view.zoom = THREE.MathUtils.clamp(view.zoom * Math.exp(e.deltaY * 0.0012), ZOOM_MIN, 1);
  }, { passive: false });
  const aim = (dt, hand, close, time) => {
    if (controls.enabled || view.hold) return;
    closeT = close ? CLOSE_HOLD : Math.max(0, closeT - dt);  // stay in through a run of gestures
    const calm = still.matches;
    const k = view.zoom * (closeT > 0 && !calm ? CLOSE_K : 1);
    const u = THREE.MathUtils.clamp((1 - k) / (1 - ZOOM_MIN), 0, 1);     // 0 = the whole room, 1 = on the hand
    // the nearer the lens, the more of the hand's position the target takes
    const w = calm && u === 0 ? 0 : THREE.MathUtils.lerp(FOLLOW + FOLLOW_TALL * view.tall, 0.92, u);
    want.set(hand.x * w - view.target.x * u, 0.45 * u, hand.z * w - view.target.z * u);   // fully in, the hand is the centre
    const a = 1 - Math.exp(-dt / (k < dolly ? 0.4 : 0.7));   // in quicker than out
    off.lerp(want, 1 - Math.exp(-dt / 0.5)); dolly += (k - dolly) * a;
    view.shake = calm ? 0 : Math.max(0, view.shake - dt / 0.22);         // a knock rattles the glass
    camera.position.copy(view.target).add(off).addScaledVector(view.eye, dolly);
    camera.position.x += 0.05 * view.shake * Math.sin(time * 95);
    camera.position.y += 0.04 * view.shake * Math.sin(time * 71);
    camera.lookAt(want.copy(view.target).add(off));
  };
  const onResize = () => {
    const w = container.clientWidth, h = container.clientHeight;
    camera.aspect = w / h;
    renderer.setSize(w, h);
    frame();
  };
  window.addEventListener('resize', onResize);

  return { renderer, scene, camera, camHome, view, aim, controls, ground, pmrem, lights: { hemi, key, amb, rim }, dispose: () => { window.removeEventListener('resize', onResize); renderer.dispose(); } };
}

// ground: low-poly terrain mesh built by sampling terrain.js's vertexH on the SAME
// grid/diagonal groundY interpolates over — feet stand exactly on the facets. Flat
// shading gives each facet its own normal so gentle (walkable) slopes read through
// lighting — the §7 trap is that they're invisible as geometry alone. Faint
// wireframe replaces the old GridHelper (which would clip through bumps). Boxes
// from the same OBSTACLES array (an invisible obstacle is the same trap).
export function rebuildGround() {
  const group = new THREE.Group();
  const n = Math.round(2 * EXTENT / CELL);                 // cells per side
  const pos = new Float32Array(n * n * 2 * 3 * 3);
  const col = new Float32Array(n * n * 2 * 3 * 3);
  // height-tinted vertex colors: at walkable slope budgets (~3°) facet shading alone
  // is too subtle to read — color contrast carries the relief (the §7 lesson again)
  const lo = new THREE.Color(0x10141f), hi = new THREE.Color(0x46588c), _c = new THREE.Color();
  let k = 0;
  const put = (i, j) => {
    const h = vertexH(i, j);
    pos[k] = i * CELL; pos[k + 1] = h; pos[k + 2] = j * CELL;
    const t = Math.min(1, Math.max(0, (h + 0.11) / 0.22));
    _c.copy(lo).lerp(hi, t * t * (3 - 2 * t));   // sharpened midtones: local patches use
    col[k] = _c.r; col[k + 1] = _c.g; col[k + 2] = _c.b;  // a fraction of the full range
    k += 3;
  };
  const i0 = -Math.round(EXTENT / CELL);
  for (let i = i0; i < i0 + n; i++) for (let j = i0; j < i0 + n; j++) {
    put(i, j); put(i + 1, j + 1); put(i + 1, j);           // CCW from above (+y normals)
    put(i, j); put(i, j + 1); put(i + 1, j + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85,
    metalness: 0.0, flatShading: true, polygonOffset: true, polygonOffsetFactor: 1 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  group.add(mesh);
  const wire = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    wireframe: true, color: 0x3a4458, transparent: true, opacity: 0.4 }));
  group.add(wire);
  mesh.visible = wire.visible = DEV;                       // the bump field is QA's ground, not the room's

  const add = (m, x, y, z, cast = true) => {
    m.position.set(x, y, z);
    m.castShadow = cast; m.receiveShadow = true;
    group.add(m);
    return m;
  };
  // the step is a book left on the floor: spine on the -x side, pages on the others
  const cover = std(0x4a1616, 0.55), pages = std(0xc9bb98, 0.9);
  const bookMats = [pages, cover, std(0xffffff, 0.55, { map: PAINT.book() }), cover, pages, pages];
  for (const o of OBSTACLES)
    add(new THREE.Mesh(new THREE.BoxGeometry(o.x1 - o.x0, o.h, o.z1 - o.z0), bookMats),
      (o.x0 + o.x1) / 2, o.h / 2, (o.z0 + o.z1) / 2);

  // Thing's room (diorama): floor tile + two back walls with a doorway, open
  // toward the fixed camera (+x+z). Walls are VISUAL ONLY — no sim collision (QA's
  // +x corridor runs "through" the east wall headlessly); the brain clamps every
  // walk target to the room instead, and that's the only control path there is.
  const R = ROOM.wall, WALL_H = 2.4, T = 0.18;
  // top face at y≈0.002 over the flat ground
  add(new THREE.Mesh(new THREE.BoxGeometry(2 * R, 0.04, 2 * R), std(0xffffff, 0.62, { map: PAINT.floor() })), 0, -0.018, 0, false);
  // paper on the room face only. Every other face shows the dark section cut, so the
  // wall tops read as a model sawn open. UVs come from world position: the stripes run
  // unbroken across the doorway's three pieces.
  const paper = std(0xffffff, 0.9, { map: PAINT.wall() }), cut = std(0x120c09, 0.8), TILE = 1.2;
  const wall = (w, h, d, x, y, z) => {
    const geo = new THREE.BoxGeometry(w, h, d), p = geo.attributes.position, uv = geo.attributes.uv, west = d > w;
    for (let i = 0; i < p.count; i++) uv.setXY(i, (west ? p.getZ(i) + z : p.getX(i) + x) / TILE, (p.getY(i) + y) / WALL_H);
    const mats = Array(6).fill(cut);
    mats[west ? 0 : 4] = paper;                              // BoxGeometry face order: +x -x +y -y +z -z
    add(new THREE.Mesh(geo, mats), x, y, z);
  };
  wall(T, WALL_H, 2 * R + T, -R - T / 2, WALL_H / 2, 0);     // west wall (back-left)
  const DOOR_W = 1.6, DOOR_H = 1.7;                          // doorway in the north wall
  const seg = (R - DOOR_W / 2);
  wall(seg, WALL_H, T, -R + seg / 2, WALL_H / 2, -R - T / 2);
  wall(seg, WALL_H, T, R - seg / 2, WALL_H / 2, -R - T / 2);
  wall(DOOR_W, WALL_H - DOOR_H, T, 0, DOOR_H + (WALL_H - DOOR_H) / 2, -R - T / 2);  // lintel
  const trim = std(0x2a1a11, 0.6), TW = 0.14;                // door frame
  for (const sx of [-1, 1]) add(new THREE.Mesh(new THREE.BoxGeometry(TW, DOOR_H + TW, 0.08), trim), sx * (DOOR_W + TW) / 2, (DOOR_H + TW) / 2, -R + 0.04);
  add(new THREE.Mesh(new THREE.BoxGeometry(DOOR_W + 2 * TW, TW, 0.08), trim), 0, DOOR_H + TW / 2, -R + 0.04);
  // two ancestors on the west wall, above the reach of a standing hand's fingers
  const brass = std(0x8a6a34, 0.4, { metalness: 0.6 });
  for (const [z, y, w, h, hue] of [[2.6, 1.55, 0.7, 0.9, 20], [3.7, 1.5, 0.5, 0.62, 200]]) {
    add(new THREE.Mesh(new THREE.BoxGeometry(0.05, h + 0.12, w + 0.12), brass), -R + 0.025, y, z);
    const pic = add(new THREE.Mesh(new THREE.PlaneGeometry(w, h), std(0xffffff, 0.8, { map: PAINT.portrait(hue) })), -R + 0.065, y, z, false);
    pic.rotation.y = Math.PI / 2; pic.receiveShadow = false;   // its own frame would hatch it
  }
  if (!DEV) {
    // the room is a model on a dark table. The doorway looks down a hall: the camera
    // sees only the hall's floor through it, so that floor is the whole hall.
    add(new THREE.Mesh(new THREE.BoxGeometry(2 * R + 2 * T, 0.5, 2 * R + 2 * T), std(0x120c09, 0.7)), -T / 2, -0.29, -T / 2, false);
    add(new THREE.Mesh(new THREE.CircleGeometry(40, 48), std(0x0c0908, 0.95)), 0, -0.54, 0, false).rotation.x = -Math.PI / 2;
    add(new THREE.Mesh(new THREE.PlaneGeometry(2.4, 3.2), new THREE.MeshBasicMaterial({ map: PAINT.hall(), fog: false })),
      0, 0.001, -R - T - 1.6, false).rotation.x = -Math.PI / 2;
  }
  return { group, mesh };
}
