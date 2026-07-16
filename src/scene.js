// src/scene.js — renderer/scene/camera/controls/lightRig/ground + rebuildGround (HANDOFF §3)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OBSTACLES } from './terrain.js';

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
  key.position.set(3, 6, 2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const s = 3;
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

// ground: a flat plane + a grid + a box mesh per terrain.js OBSTACLES entry (the
// mesh must exist or a physically-traversable step is an invisible one — same
// "invisible gym" trap as the refuted slope approach, §7).
export function rebuildGround() {
  const group = new THREE.Group();
  const size = 60, seg = 1;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: 0x202836, roughness: 0.95, metalness: 0.0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  group.add(mesh);
  const grid = new THREE.GridHelper(size, Math.round(size), 0x3a4458, 0x222838);
  grid.position.y = 0.0005;
  group.add(grid);
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
