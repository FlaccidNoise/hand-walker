// src/paint.js — the room's surfaces, painted once at startup onto canvases (no image
// files). Seeded noise, so the room is the same on every load. `paintStats.ms` is the
// total time spent here.
import * as THREE from 'three';

export const paintStats = { ms: 0 };

function rng(seed) {                  // mulberry32
  return () => {
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function tex(w, h, draw) {
  const t0 = performance.now(), c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  paintStats.ms += performance.now() - t0;
  return t;
}
const grad = (g, x0, y0, x1, y1, stops) => {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  stops.forEach(([at, colour]) => gr.addColorStop(at, colour));
  return gr;
};
const disc = (g, x, y, r, colour) => { g.fillStyle = colour; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); };

export const PAINT = {
  // behind everything: near-black, a little warmer toward the table
  sky: () => tex(4, 256, g => { g.fillStyle = grad(g, 0, 0, 0, 256, [[0, '#060505'], [0.55, '#0d0a09'], [1, '#17100c']]); g.fillRect(0, 0, 4, 256); }),

  // oak boards along x: 16 rows to a tile, laid twice across the room
  floor: () => {
    const t = tex(1024, 1024, g => {
      const r = rng(7), N = 16, ph = 1024 / N;
      for (let i = 0; i < N; i++) {
        for (let x = -r() * 400; x < 1024;) {
          const len = 380 + r() * 300;
          g.fillStyle = `hsl(${22 + r() * 6},${38 + r() * 10}%,${20 + r() * 9}%)`; g.fillRect(x, i * ph, len, ph);
          for (let k = 0; k < 46; k++) {                       // grain
            g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,200,150'},${0.03 + r() * 0.05})`;
            g.fillRect(x + r() * len, i * ph + r() * ph, 60 + r() * 200, 1);
          }
          g.fillStyle = 'rgba(8,4,2,0.85)'; g.fillRect(x + len - 2, i * ph, 2, ph);
          x += len;
        }
        g.fillStyle = 'rgba(8,4,2,0.9)'; g.fillRect(0, i * ph, 1024, 2);
        g.fillStyle = 'rgba(255,210,160,0.06)'; g.fillRect(0, i * ph + 2, 1024, 1);
      }
    });
    t.repeat.set(2, 2);
    return t;
  },

  // one wall tile, 1.2 u wide and the full 2.4 u tall: baseboard, panelled wainscot,
  // chair rail, striped paper, cornice. Tiles along the wall, never up it.
  wall: () => {
    const t = tex(512, 1024, g => {
      const r = rng(3), Y = (u) => 1024 - u / 2.4 * 1024;
      g.fillStyle = '#1f3a33'; g.fillRect(0, 0, 512, 1024);
      for (let i = 0; i < 4; i++) {
        g.fillStyle = '#19302a'; g.fillRect(i * 128, 0, 64, 1024);
        g.fillStyle = 'rgba(190,150,80,0.35)'; g.fillRect(i * 128 + 63, 0, 2, 1024); g.fillRect(i * 128 - 1, 0, 2, 1024);
      }
      g.fillStyle = 'rgba(200,165,95,0.33)';                  // a lozenge on each light stripe, half-drop
      for (let row = 0; row < 9; row++) for (let col = 0; col < 4; col++) {
        const cx = col * 128 + 96, cy = 60 + row * 76 + (col % 2 ? 38 : 0), s = 13;
        g.beginPath(); g.moveTo(cx, cy - s);
        g.quadraticCurveTo(cx + 3, cy - 3, cx + s * 0.7, cy); g.quadraticCurveTo(cx + 3, cy + 3, cx, cy + s);
        g.quadraticCurveTo(cx - 3, cy + 3, cx - s * 0.7, cy); g.quadraticCurveTo(cx - 3, cy - 3, cx, cy - s); g.fill();
      }
      for (let k = 0; k < 500; k++) { g.fillStyle = `rgba(0,0,0,${r() * 0.07})`; g.fillRect(r() * 512, r() * 1024, 2 + r() * 20, 2 + r() * 30); }
      g.fillStyle = '#1a100b'; g.fillRect(0, 0, 512, Y(2.28));                                   // cornice
      g.fillStyle = 'rgba(190,150,80,0.5)'; g.fillRect(0, Y(2.28) - 3, 512, 3);
      g.fillStyle = '#2a1a11'; g.fillRect(0, Y(0.86), 512, 1024);                                // wainscot
      g.fillStyle = '#4a2f1d'; g.fillRect(0, Y(0.86), 512, 10);                                  // chair rail
      g.fillStyle = '#120a06'; g.fillRect(0, Y(0.86) + 10, 512, 6);
      for (let i = 0; i < 2; i++) {                                                              // two sunk panels
        const x0 = i * 256 + 26, y0 = Y(0.72), w = 204, h = Y(0.24) - y0;
        g.fillStyle = '#211309'; g.fillRect(x0, y0, w, h);
        g.fillStyle = '#0e0704'; g.fillRect(x0, y0, w, 5); g.fillRect(x0, y0, 5, h);
        g.fillStyle = '#4a2f1d'; g.fillRect(x0, y0 + h - 4, w, 4); g.fillRect(x0 + w - 4, y0, 4, h);
      }
      g.fillStyle = '#170d08'; g.fillRect(0, Y(0.16), 512, 1024);                                // baseboard
      g.fillStyle = '#4a2f1d'; g.fillRect(0, Y(0.16), 512, 4);
    });
    t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  },

  // the hall floor seen through the doorway: dark boards with a moonlit window lying on them
  hall: () => tex(256, 512, g => {
    g.fillStyle = '#120c09'; g.fillRect(0, 0, 256, 512);
    g.transform(1, 0, -0.35, 1, 120, 0);
    g.fillStyle = grad(g, 0, 60, 0, 420, [[0, 'rgba(120,160,255,0)'], [0.25, 'rgba(120,160,255,0.75)'], [1, 'rgba(120,160,255,0.55)']]);
    g.fillRect(60, 60, 120, 400);
    g.fillStyle = '#120c09'; g.fillRect(116, 60, 8, 400); g.fillRect(60, 250, 120, 8);
  }),

  // moonlight coming in at the door: bright at the sill, gone a few steps in
  moon: () => tex(8, 256, g => { g.fillStyle = grad(g, 0, 0, 0, 256, [[0, 'rgba(110,150,255,0.55)'], [1, 'rgba(110,150,255,0)']]); g.fillRect(0, 0, 8, 256); }),

  book: () => tex(256, 256, g => {
    g.fillStyle = '#4a1616'; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = g.fillStyle = '#b08d4a'; g.textAlign = 'center';
    g.lineWidth = 4; g.strokeRect(18, 18, 220, 220); g.lineWidth = 1.5; g.strokeRect(28, 28, 200, 200);
    g.font = 'bold 30px Georgia,serif'; g.fillText('MEMOIRS', 128, 120);
    g.font = 'italic 18px Georgia,serif'; g.fillText('of a left hand', 128, 150);
  }),

  // a band round the ball: without it a rolling ball looks like a sliding one
  ball: () => tex(256, 128, g => {
    g.fillStyle = '#8f2a22'; g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#1d2f4a'; g.fillRect(0, 46, 256, 36);
    g.fillStyle = '#d9cfb4'; g.fillRect(0, 50, 256, 28);
  }),

  rug: () => tex(512, 512, g => {
    const c = 256;
    [[256, '#c9b891'], [244, '#3a0f14'], [228, '#b08d4a'], [222, '#5a1820'], [150, '#1d2f4a'], [142, '#5a1820']].forEach(([r, colour]) => disc(g, c, c, r, colour));
    for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; disc(g, c + Math.cos(a) * 186, c + Math.sin(a) * 186, 9, '#b08d4a'); }
    g.fillStyle = '#c9b891'; g.beginPath();
    for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2, r = i % 2 ? 40 : 96; g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r); }
    g.fill();
    disc(g, c, c, 26, '#5a1820');
  }),

  // a dim ancestor: head and shoulders against a glow of the given hue
  portrait: (hue) => tex(128, 160, g => {
    g.fillStyle = '#1a1512'; g.fillRect(0, 0, 128, 160);
    const gr = g.createRadialGradient(64, 70, 5, 64, 80, 80);
    gr.addColorStop(0, `hsl(${hue},25%,26%)`); gr.addColorStop(1, '#0c0a09');
    g.fillStyle = gr; g.fillRect(8, 8, 112, 144);
    g.fillStyle = '#0a0807'; g.beginPath(); g.ellipse(64, 62, 20, 25, 0, 0, 7); g.fill();
    g.beginPath(); g.moveTo(22, 152); g.quadraticCurveTo(64, 70, 106, 152); g.fill();
  }),

  glow: () => tex(128, 128, g => {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,190,110,0.9)'); gr.addColorStop(0.3, 'rgba(255,150,60,0.3)'); gr.addColorStop(1, 'rgba(255,120,40,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  }),
};
