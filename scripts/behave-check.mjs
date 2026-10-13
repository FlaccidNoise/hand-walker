// scripts/behave-check.mjs — every idle behaviour and routine, start to finish, on the
// gate's virtual clock with a seeded Math.random. None may end in a brain error or
// run past its limit. These plans run unattended on the live page: an error there is
// red text nobody asked for.
// Usage: node scripts/behave-check.mjs        (needs the dev server, like the gates)
import puppeteer from 'puppeteer-core';

const base = process.env.URL || 'http://localhost:8741/index.html';
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LIMIT = 90;                                           // s sim per plan
const browser = await puppeteer.launch({
  executablePath: chrome, headless: 'new', protocolTimeout: 600000,
  args: ['--no-first-run', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
let bad = 0;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 400 });
  page.on('pageerror', e => { console.error('PAGE ERROR:', String(e)); bad++; });
  await page.evaluateOnNewDocument(() => {
    let vnow = 0, id = 0, seed = 7; const q = new Map();
    performance.now = () => vnow;
    Math.random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    window.requestAnimationFrame = (cb) => { q.set(++id, cb); return id; };
    window.cancelAnimationFrame = (i) => q.delete(i);
    window.__vframe = (dtMs) => { vnow += dtMs; const cbs = [...q.values()]; q.clear(); for (const cb of cbs) cb(vnow); };
  });
  await page.goto(base + (base.includes('?') ? '&' : '?') + 'dev', { waitUntil: 'load' });
  await page.waitForFunction('window.__hand && window.__hand.state.ready', { timeout: 30000, polling: 100 });
  const rows = await page.evaluate((LIMIT) => {
    const h = window.__hand, out = [], pump = (s) => { for (let i = 0, n = Math.round(s * 120 / h.C.TIME_SCALE); i < n; i++) window.__vframe(1000 / 120); };
    const plans = [...h.brain.behaviors.map(name => ({ name, start: () => h.brain.behave(name) })),
      ...h.brain.routines.map(name => ({ name: `routine ${name}`, start: () => h.brain.command([{ do: 'routine', name }], { source: 'click' }) })),
      ...[0, 1, 2, 3, 4].map(i => ({ name: `poke ${i + 1}`, keep: i > 0, start: () => h.brain.poke() })),
      // a key or a poke that lands mid-walk: the walk must stop, not carry the hand out of the room
      ...[['key', () => h.brain.command([{ do: 'gesture', name: 'wave' }], { source: 'key' })], ['poke', () => h.brain.poke()], ['jump', () => h.brain.command([{ do: 'jump' }], { source: 'key' })]]
        .map(([n, then]) => ({ name: `walk, then ${n}`, start: () => { h.brain.command([{ do: 'walkTo', x: -3, z: 2, speed: 1.8 }], { source: 'click' }); pump(1.2); return then(); } }))];
    let said = null;                                         // a brain error arrives through onsay
    const page = h.brain.st.onsay;
    h.brain.st.onsay = (t, k) => { if (k === 'error') said = t; if (page) page(t, k); };
    for (const p of plans) {
      if (!p.keep) { h.reset(); pump(1); }
      const t0 = h.sim.s.time;
      said = null;
      let err = p.start() ? null : `did not start: ${said}`;
      while (!err && h.brain.st.i >= 0 && h.sim.s.time - t0 < LIMIT) { pump(0.25); err = said; }
      if (!err) err = said;
      if (!err && h.brain.st.i >= 0) err = `still running after ${LIMIT} s (${h.brain.st.detail})`;
      const B = h.rig.mount.position, out0 = Math.max(Math.abs(B.x), Math.abs(B.z)) - h.C.ROOM.half;
      if (!err && out0 > 0.3) err = `ended ${out0.toFixed(1)} u outside the room`;
      out.push({ name: p.name, s: +(h.sim.s.time - t0).toFixed(1), err });
    }
    return out;
  }, LIMIT);
  for (const r of rows) { console.log(`${r.err ? 'FAIL' : ' ok '} ${r.name.padEnd(24)} ${String(r.s).padStart(5)} s${r.err ? '  <- ' + r.err : ''}`); if (r.err) bad++; }
  console.log(`behave-check: ${rows.length - rows.filter(r => r.err).length}/${rows.length} plans finish clean → ${bad ? 'RED' : 'GREEN'}`);
} finally { await browser.close(); }
process.exit(bad ? 1 : 0);
