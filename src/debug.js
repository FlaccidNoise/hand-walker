// src/debug.js — DebugDraw: 3D line/point/arrow overlay. (HANDOFF §3)
import * as THREE from 'three';

export class DebugDraw {
  constructor(scene) {
    this.scene = scene;
    this.lineMat = new THREE.LineBasicMaterial({ color: 0x8fe0ff, transparent: true, opacity: 0.8, depthTest: false });
    this.ptMat = new THREE.PointsMaterial({ color: 0xffd060, size: 0.035, sizeAttenuation: true, depthTest: false, transparent: true });
    this.root = new THREE.Group();
    this.root.renderOrder = 999;
    scene.add(this.root);
  }
  clear() {
    for (let i = this.root.children.length - 1; i >= 0; i--) {
      const c = this.root.children[i];
      c.geometry?.dispose(); this.root.remove(c);
    }
  }
  line(a, b, color = 0x8fe0ff) {
    const g = new THREE.BufferGeometry().setFromPoints([a.clone(), b.clone()]);
    const m = this.lineMat.clone(); m.color.setHex(color);
    const l = new THREE.Line(g, m); l.renderOrder = 999; this.root.add(l);
  }
  arrow(origin, dir, len = 0.05, color = 0x8fe0ff) {
    const end = origin.clone().add(dir.clone().normalize().multiplyScalar(len));
    this.line(origin, end, color);
  }
  point(p, color = 0xffd060) {
    const g = new THREE.BufferGeometry().setFromPoints([p.clone()]);
    const pts = new THREE.Points(g, this.ptMat); pts.renderOrder = 999; this.root.add(pts);
  }
  set visible(v) { this.root.visible = v; }
  get visible() { return this.root.visible; }
}
