// src/scene.js — renderer/scene/camera/controls/lightRig/ground + rebuildGround (HANDOFF §3)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OBSTACLES, CELL, EXTENT, vertexH } from './terrain.js';

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
  scene.background = new THREE.Color(0x0c1018);
  scene.fog = new THREE.Fog(0x0c1018, 8, 40);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;    // full IBL floods shadows + facet shading flat —
                                        // terrain relief at walkable slopes needs the contrast

  const camera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 0.01, 200);
  camera.position.set(2.2, 1.6, 3.0);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.5, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.minDistance = 0.4;
  controls.maxDistance = 30;
  controls.update();

  // --- light rig ---
  const hemi = new THREE.HemisphereLight(0xbcd4ff, 0x2a2018, 0.55);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff2d8, 2.0);
  key.position.set(8, 4, 2);                 // grazing elevation (~26°): long shadows are
  key.castShadow = true;                     // the strongest relief cue walkable slopes get
  key.shadow.mapSize.set(4096, 4096);
  const s = 18;                              // cover the bump field, not just the spawn disc
  key.shadow.camera.left = -s; key.shadow.camera.right = s;
  key.shadow.camera.top = s; key.shadow.camera.bottom = -s;
  key.shadow.camera.near = 0.5; key.shadow.camera.far = 25;
  key.shadow.bias = -0.0004;
  scene.add(key);
  scene.add(new THREE.AmbientLight(0x404858, 0.4));

  const ground = rebuildGround();
  scene.add(ground.group);

  const onResize = () => {
    const w = container.clientWidth, h = container.clientHeight;
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  };
  window.addEventListener('resize', onResize);

  return { renderer, scene, camera, controls, ground, pmrem, dispose: () => { window.removeEventListener('resize', onResize); renderer.dispose(); } };
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
  const stepMat = new THREE.MeshStandardMaterial({ color: 0x384258, roughness: 0.9, metalness: 0.0 });
  for (const o of OBSTACLES) {
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(o.x1 - o.x0, o.h, o.z1 - o.z0), stepMat);
    box.position.set((o.x0 + o.x1) / 2, o.h / 2, (o.z0 + o.z1) / 2);
    box.castShadow = true; box.receiveShadow = true;
    group.add(box);
  }
  return { group, mesh };
}
