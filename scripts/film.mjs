// scripts/film.mjs — fixed-step filmstrip: run a scripted move on the gate's virtual
// clock and tile N frames into one contact sheet in .debug/. Numbers and pixels catch
// different bugs — look at the sheet.
// Usage: node scripts/film.mjs --run "<js using h = window.__hand>" [--view side|sideL|rear|rearQ|front|top|live]
//          [--warm ms] [--frames N] [--every ms] [--dist u] [--cols N] [--label NAME]
// Views are relative to the hand's heading; sideL is the pinky side. `live` is the app camera.
import { mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const base = process.env.URL || 'http://localhost:8741/index.html';
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const o = { run: '', view: 'sideL', warm: 3000, frames: 8, every: 75, dist: 2.6, cols: 4, label: 'film' };
for (let i = 2; i < process.argv.length; i += 2) {
  const k = process.argv[i].replace(/^--/, '');
  if (!(k in o)) { console.error(`film: unknown option --${k} — have: ${Object.keys(o).map(x => '--' + x).join(' ')}`); process.exit(2); }
  o[k] = typeof o[k] === 'number' ? +process.argv[i + 1] : process.argv[i + 1];
}
const HZ = 120, OUT = new URL('../.debug/', import.meta.url).pathname, TMP = `${OUT}film-${o.label}/`;
rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: chrome, headless: 'new', protocolTimeout: 600000,
  args: ['--no-first-run', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 400 });
  page.on('pageerror', e => { console.error('PAGE ERROR:', String(e)); process.exitCode = 1; });
  await page.evaluateOnNewDocument(() => {
    let vnow = 0, id = 0; const q = new Map();
    performance.now = () => vnow;
    window.requestAnimationFrame = (cb) => { q.set(++id, cb); return id; };
    window.cancelAnimationFrame = (i) => q.delete(i);
    window.__vframe = (dtMs) => { vnow += dtMs; const cbs = [...q.values()]; q.clear(); for (const cb of cbs) cb(vnow); };
  });
  await page.goto(base + (base.includes('?') ? '&' : '?') + 'dev', { waitUntil: 'load' });
  await page.waitForFunction('window.__hand && window.__hand.state.ready', { timeout: 30000, polling: 100 });
  const pump = (ms) => page.evaluate((ms, hz) => {
    for (let i = 0, n = Math.round(ms * hz / 1000); i < n; i++) window.__vframe(1000 / hz);
  }, ms, HZ);
  await page.evaluate(() => {
    for (const id of ['hud', 'help', 'dock', 'vig', 'grain', 'title', 'top', 'caption', 'tip', 'pal', 'card']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
    window.__hand.reset();
  });
  await pump(1500);
  if (o.run) await page.evaluate(`(() => { const h = window.__hand; ${o.run} })()`);
  await pump(o.warm);
  for (let k = 0; k < o.frames; k++) {
    if (k) await pump(o.every);
    await page.evaluate((view, dist) => {
      const h = window.__hand;
      if (view !== 'live') {
        h.view.hold = true;                                  // the app's follow camera stands down
        const B = h.rig.mount.position, a = h.sim.s.heading, sH = h.calib.standH;
        const fx = Math.cos(a), fz = -Math.sin(a), lx = Math.sin(a), lz = Math.cos(a);   // forward, +z-local
        const V = { side: [0, 0.45, 1], sideL: [0, 0.45, -1], front: [1, 0.5, 0], rear: [-1, 0.8, 0],
          rearQ: [-0.75, 0.9, -0.65], top: [0.01, 1.4, 0] }[view];
        if (!V) throw new Error(`film: unknown view "${view}" — have side, sideL, front, rear, rearQ, top, live`);
        h.camera.position.set(B.x + (fx * V[0] + lx * V[2]) * dist, V[1] * dist * 0.5 + 0.1, B.z + (fz * V[0] + lz * V[2]) * dist);
        if (view === 'top') h.camera.position.y = dist * 1.4;
        h.camera.lookAt(B.x + fx * 0.6, sH * 0.5, B.z + fz * 0.6);
      }
      window.__vframe(0);                                    // render with no sim step
    }, o.view, o.dist);
    await page.screenshot({ path: `${TMP}${String(k).padStart(2, '0')}.png` });
  }
  const sheet = `${OUT}film-${o.label}.png`;
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', `${TMP}%02d.png`,
    '-vf', `tile=${o.cols}x${Math.ceil(o.frames / o.cols)}`, '-frames:v', '1', sheet]);
  console.log(sheet);
} finally { await browser.close(); }
