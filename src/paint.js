// src/paint.js — the room's surfaces and the hand's skin, painted once at startup onto
// canvases (no image files). Seeded noise, so the room is the same on every load. `paintStats.ms` is the
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

// ---- the hand's skin ----
// One canvas in the GLB's own UV layout: colour in the left half, roughness in the right
// (rig.js reads the right half in the skin shader, so the hand costs one texture).
// rig.js finds WHERE things are on the skin: a mark is [kind, patch, size in mm, count],
// and a patch is the UV at a spot plus the UV step per metre across and along the digit.
const SKIN = 1024, SKIN_U = [0.02, 0.46];       // half size (px) · u offset and scale in a half: a gutter, so mips do not bleed
const TONE = '#d9b29a', ROUGH = 0.6;
const grey = (r) => { const v = Math.round(255 * r ** (1 / 2.2)); return `rgb(${v},${v},${v})`; };   // the texture is read as sRGB
const blob = (g, x, y, r, rgb, a) => {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, `rgba(${rgb},${a})`); gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r);
};
const stroke = (g, colour, w, path) => { g.strokeStyle = colour; g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); path(); g.stroke(); };
// transverse skin folds: n arcs across a digit of half-width r, bowed away from the joint.
// `oval` shortens the outer ones, so a knuckle's wrinkles sit in an ellipse
const folds = (g, r, n, gap, bow, colour, w, oval = 0) => {
  for (let k = 0; k < n; k++) {
    const y = (k - (n - 1) / 2) * gap, h = r * Math.sqrt(1 - oval * (2 * k / (n - 1 || 1) - 1) ** 2);
    stroke(g, colour, w, () => { g.moveTo(-h, y); g.quadraticCurveTo(0, y + bow * (y || gap * 0.3), h, y); });
  }
};
// each kind paints in millimetres, x across the digit and y toward its tip. `lit` is
// false on the roughness pass: there a kind paints greys, or nothing
const MARK = {
  nail(g, s, n, lit) {
    const w = 0.44 * s, L = 0.5 * s, p = new Path2D();
    p.roundRect(-w / 2, -L / 2, w, L, [w * 0.32, w * 0.32, w * 0.5, w * 0.5]);
    if (!lit) { g.fillStyle = grey(0.26); g.fill(p); return; }
    blob(g, 0, L / 2, w * 0.9, '212,124,108', 0.4);                       // the fingertip past the nail
    g.strokeStyle = 'rgba(128,84,70,0.4)'; g.lineWidth = 0.7; g.stroke(p);                      // nail fold
    g.fillStyle = grad(g, 0, -L / 2, 0, L / 2, [[0, '#dcaa9e'], [0.8, '#e8c1b3']]); g.fill(p);  // plate
    g.save(); g.clip(p);
    g.fillStyle = 'rgba(247,232,224,0.5)'; g.beginPath(); g.ellipse(0, -L / 2, w * 0.3, L * 0.2, 0, 0, 7); g.fill();    // lunula
    g.fillStyle = '#f0e6d8'; g.beginPath(); g.ellipse(0, L / 2 - w * 0.62, w * 0.7, w * 0.5, 0, 0, 7); g.rect(-w, -L, 2 * w, 3 * L); g.fill('evenodd');   // free edge
    g.fillStyle = 'rgba(255,255,255,0.14)'; g.beginPath(); g.ellipse(-w * 0.17, 0, w * 0.07, L * 0.36, 0, 0, 7); g.fill();
    g.restore();
  },
  knuckle(g, r, n, lit) {                                    // back of an MCP
    if (!lit) return blob(g, 0, 0, 1.6 * r, '226,226,226', 0.7);
    blob(g, 0, 0, 2.1 * r, '198,112,100', 0.3);
    folds(g, 0.75 * r, 4, 1.5, 0.6, 'rgba(160,112,96,0.2)', 0.4, 0.6);
  },
  joint(g, r, n, lit) {                                      // back of a finger joint: wrinkles on a blush
    if (!lit) return blob(g, 0, 0, 1.3 * r, '226,226,226', 0.7);
    blob(g, 0, 0, 1.5 * r, '196,108,96', n > 2 ? 0.36 : 0.24);
    folds(g, 0.8 * r, n + 2, 1.05, 0.6, 'rgba(150,104,88,0.3)', 0.32, 0.7);
  },
  crease(g, r, n, lit) {                                     // palm side of a joint
    if (!lit) return;
    folds(g, 0.95 * r, n, 1.5, 0.12, 'rgba(196,138,122,0.25)', 1.5);
    folds(g, 0.95 * r, n, 1.5, 0.12, 'rgba(150,100,86,0.42)', 0.45);
  },
  pad(g, r, n, lit) {
    if (!lit) return blob(g, 0, 0, 1.2 * r, '190,190,190', 0.6);
    blob(g, 0, 0, 1.35 * r, '216,126,110', 0.36);
  },
  flush(g, r, n, lit) { if (lit) blob(g, 0, 0, r, '208,124,110', 0.22); },   // the heel and ball of the palm
  cap(g, r, n, lit) {                                        // the healed face of the stump
    g.fillStyle = lit ? '#be9082' : grey(0.75); g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
    if (!lit) return;
    blob(g, 0, 0, r * 0.8, '128,72,66', 0.22);
    for (let k = 0; k < 11; k++) stroke(g, 'rgba(120,70,64,0.16)', 0.6, () => { g.moveTo(Math.cos(k * 0.571) * r * 0.12, Math.sin(k * 0.571) * r * 0.12); g.lineTo(Math.cos(k * 0.571 + 0.2) * r * 0.75, Math.sin(k * 0.571 + 0.2) * r * 0.75); });
  },
};
const CREASE = [['rgba(198,140,124,0.22)', 6], ['rgba(156,106,92,0.4)', 1.6]];   // a palm line: a soft valley, then the line

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

  skin: (marks, lines) => {
    const t = tex(2 * SKIN, SKIN, g => {
      const r = rng(11);
      for (const lit of [true, false]) {
        const X = (u) => ((lit ? 0 : 0.5) + SKIN_U[0] + SKIN_U[1] * u) * 2 * SKIN;
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.fillStyle = lit ? TONE : grey(ROUGH); g.fillRect(lit ? 0 : SKIN, 0, SKIN, SKIN);
        if (lit) for (let k = 0; k < 60; k++) blob(g, r() * SKIN, r() * SKIN, 30 + r() * 80, k % 2 ? '198,120,104' : '238,218,202', 0.07);   // mottle
        if (lit) for (const pts of lines) for (const [colour, w] of CREASE) stroke(g, colour, w, () => {
          g.moveTo(X(pts[0].x), pts[0].y * SKIN);
          for (let i = 1; i < pts.length - 1; i++) g.quadraticCurveTo(X(pts[i].x), pts[i].y * SKIN,
            X((pts[i].x + pts[i + 1].x) / 2), (pts[i].y + pts[i + 1].y) / 2 * SKIN);
          g.lineTo(X(pts.at(-1).x), pts.at(-1).y * SKIN);
        });
        for (const [kind, [ax, ay, bx, by, u, v], size, n] of marks) {
          const k = SKIN_U[1] * 2 * SKIN / 1000;
          g.setTransform(ax * k, ay * SKIN / 1000, bx * k, by * SKIN / 1000, X(u), v * SKIN);
          MARK[kind](g, size, n, lit);
        }
      }
    });
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.flipY = false;                 // glTF UVs
    t.offset.set(SKIN_U[0], 0); t.repeat.set(SKIN_U[1], 1);
    return t;
  },

  // Thing's box. A walnut panel, w by h units: figured grain inside dark cross-banding
  // and a line of brass stringing, drawn to scale so the border is as wide on every face
  casket: (w, h) => tex(Math.round(w * 180), Math.round(h * 180), g => {
    const W = g.canvas.width, H = g.canvas.height, r = rng(Math.round(w * 97 + h * 31));
    g.fillStyle = '#2e1c11'; g.fillRect(0, 0, W, H);
    for (let k = 0; k < 240; k++) {                          // the figure: long wavering streaks
      const y = r() * H, a = 2 + r() * 9, f = 0.008 + r() * 0.02, p = r() * 7;
      g.strokeStyle = `rgba(${r() < 0.55 ? '10,5,2' : '128,80,46'},${0.05 + r() * 0.1})`; g.lineWidth = 0.6 + r() * 2.2;
      g.beginPath();
      for (let x = 0; x <= W; x += 12) g.lineTo(x, y + a * Math.sin(x * f + p));
      g.stroke();
    }
    for (const [inset, width, colour] of [[10, 20, 'rgba(14,8,5,0.72)'], [24, 2.5, 'rgba(190,152,82,0.85)'], [31, 1, 'rgba(190,152,82,0.4)']]) {
      g.strokeStyle = colour; g.lineWidth = width; g.strokeRect(inset, inset, W - 2 * inset, H - 2 * inset);
    }
  }),

  // its lining: oxblood velvet, button-tufted, darker into the corners
  lining: () => tex(256, 256, g => {
    const r = rng(5);
    g.fillStyle = '#5c1620'; g.fillRect(0, 0, 256, 256);
    for (let k = 0; k < 400; k++) { g.fillStyle = `rgba(${r() < 0.5 ? '20,2,6' : '150,60,66'},${0.03 + r() * 0.05})`; g.fillRect(r() * 256, r() * 256, 2 + r() * 14, 1 + r() * 2); }
    g.strokeStyle = 'rgba(22,3,7,0.34)'; g.lineWidth = 2.5; g.beginPath();
    for (let k = -4; k <= 8; k++) { g.moveTo(k * 64, 0); g.lineTo(k * 64 + 256, 256); g.moveTo(k * 64, 0); g.lineTo(k * 64 - 256, 256); }
    g.stroke();
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 8; j++) {
      const x = i * 64 + (j % 2 ? 32 : 0), y = j * 32;
      disc(g, x, y, 5.5, 'rgba(20,2,6,0.45)'); disc(g, x, y, 2.6, 'rgba(196,160,96,0.8)');
    }
    g.strokeStyle = 'rgba(10,1,4,0.38)'; g.lineWidth = 30; g.strokeRect(0, 0, 256, 256);
  }),

  // the brass plate on its lid. Pale: it tints a brass material
  plate: () => tex(256, 148, g => {
    g.fillStyle = '#f2ead6'; g.fillRect(0, 0, 256, 148);
    g.strokeStyle = g.fillStyle = '#4a3618'; g.textAlign = 'center';
    g.lineWidth = 3; g.strokeRect(9, 9, 238, 130); g.lineWidth = 1; g.strokeRect(16, 16, 224, 116);
    g.font = 'bold 76px Georgia,serif'; g.fillText('T', 128, 92);
    g.font = 'italic 17px Georgia,serif'; g.fillText('do not disturb', 128, 120);
    for (const x of [22, 234]) for (const y of [22, 126]) disc(g, x, y, 3, '#4a3618');   // four pins
  }),

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
