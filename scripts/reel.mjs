// scripts/reel.mjs — a video of the real page (not ?dev), filmed on the gate's virtual
// clock: every frame is exact, however slow the machine. A cue list drives it with real
// pointer and key events, so the reel shows what a visitor's input does.
// Usage: node scripts/reel.mjs [--cues file.mjs] [--out file.mp4] [--fps 24] [--w 1280] [--h 720]
// A cue file default-exports [[seconds, action], ...]. action = { click: [x, y] } |
//   { move: [x, y] } | { key: 'Space' } | { type: 'text' } | { run: 'js; h = window.__hand' } | { end: true }.
// x, y are 0..1 of the window. Needs ffmpeg on the PATH.
import { mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const base = process.env.URL || 'http://localhost:8741/index.html';
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const o = { cues: '', out: new URL('../.debug/reel.mp4', import.meta.url).pathname, fps: 24, w: 1280, h: 720 };
for (let i = 2; i < process.argv.length; i += 2) {
  const k = process.argv[i].replace(/^--/, '');
  if (!(k in o)) { console.error(`reel: unknown option --${k} — have: ${Object.keys(o).map(x => '--' + x).join(' ')}`); process.exit(2); }
  o[k] = typeof o[k] === 'number' ? +process.argv[i + 1] : process.argv[i + 1];
}
const CUES = o.cues ? (await import(new URL(o.cues, `file://${process.cwd()}/`))).default
  : [[1, { click: [0.36, 0.55] }], [5, { key: 'Digit1' }], [9, { end: true }]];
const SUB = 5, TMP = `${o.out}.frames/`;                     // sim frames per filmed frame (24 fps × 5 = 120 Hz)
rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: chrome, headless: 'new', protocolTimeout: 900000,
  args: ['--no-first-run', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: o.w, height: o.h });
  page.on('pageerror', e => { console.error('PAGE ERROR:', String(e)); process.exitCode = 1; });
  await page.evaluateOnNewDocument(() => {
    let vnow = 0, id = 0; const q = new Map();
    performance.now = () => vnow;
    window.requestAnimationFrame = (cb) => { q.set(++id, cb); return id; };
    window.cancelAnimationFrame = (i) => q.delete(i);
    window.__vframe = (dtMs) => { vnow += dtMs; const cbs = [...q.values()]; q.clear(); for (const cb of cbs) cb(vnow); };
  });
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction('window.__hand && window.__hand.state.ready', { timeout: 30000, polling: 100 });
  await page.evaluate(() => {
    // draw only the frame that is filmed, and show the pointer (a screenshot has none)
    const h = window.__hand, draw = h.renderer.render.bind(h.renderer);
    h.renderer.render = (...a) => { if (window.__film) draw(...a); };
    const c = document.createElement('div');
    c.style.cssText = 'position:fixed;z-index:99;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;border:2px solid #fff;background:#0006;pointer-events:none;left:-99px';
    document.body.append(c);
    addEventListener('pointermove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
    addEventListener('pointerdown', () => { c.style.background = '#fffc'; setTimeout(() => { c.style.background = '#0006'; }, 0); }, true);
  });
  const px = ([x, y]) => [x * o.w, y * o.h];
  let n = 0, next = 0, at = [0.5 * o.w, 0.5 * o.h];
  film: for (;; n++) {
    for (; next < CUES.length && CUES[next][0] <= n / o.fps; next++) {
      const a = CUES[next][1];
      if (a.end) break film;
      if (a.move || a.click) {                               // glide there over a few sim frames, as a hand on a mouse does
        const to = px(a.move ?? a.click);
        for (let k = 1; k <= 6; k++) await page.mouse.move(at[0] + (to[0] - at[0]) * k / 6, at[1] + (to[1] - at[1]) * k / 6);
        at = to;
        if (a.click) await page.mouse.click(...to);
      } else if (a.key) await page.keyboard.press(a.key);
      else if (a.type) { await page.focus('#talkText'); await page.keyboard.type(a.type); await page.keyboard.press('Enter'); }
      else if (a.run) await page.evaluate(`(() => { const h = window.__hand; ${a.run} })()`);
    }
    await page.evaluate((sub) => {
      for (let i = 0; i < sub; i++) { window.__film = i === sub - 1; window.__vframe(1000 / 120); }
    }, SUB);
    await page.screenshot({ path: `${TMP}${String(n).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 92 });
    if (n % (o.fps * 5) === 0) console.error(`reel: ${(n / o.fps).toFixed(0)} s filmed`);
    if (n > o.fps * 300) throw new Error('reel: no {end:true} cue within 300 s — add one to the cue list');
  }
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', String(o.fps), '-i', `${TMP}%05d.jpg`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', o.out]);
  rmSync(TMP, { recursive: true, force: true });
  console.log(`${o.out}  (${n} frames, ${(n / o.fps).toFixed(1)} s)`);
} finally { await browser.close(); }
