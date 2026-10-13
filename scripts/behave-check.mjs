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
      // (`out` runs straight after `home`, with no reset between: it has a box to come out of)
      ...h.brain.routines.map(name => ({ name: `routine ${name}`, keep: name === 'out', start: () => h.brain.command([{ do: 'routine', name }], { source: 'click' }) })),
      ...[0, 1, 2, 3, 4].map(i => ({ name: `poke ${i + 1}`, keep: i > 0, start: () => h.brain.poke() })),
      // rock, paper, scissors: thrown alone, and with a pick typed during the count-in
      { name: 'rps', start: () => h.brain.command([{ do: 'rps' }], { source: 'click' }) },
      { name: 'rps, then a pick', start: () => { const ok = h.brain.command([{ do: 'rps' }], { source: 'click' }); pump(1.2); h.brain.ask('paper'); return ok && h.brain.st.i >= 0 && h.brain.rps.you === 'paper'; } },
      // the box, interrupted: going home and coming out, cut into at nine points by a typed
      // "come out", a click on the floor and an emote key. Whatever happens, the hand and
      // the box must agree at the end (boxAgrees, checked after EVERY plan here)
      ...[['walking in', 'home', () => h.brain.st.plan[h.brain.st.i]?.do === 'walkTo' && h.props.get('box').solid.z1 > h.rig.mount.position.z],
        ['nestle 0.5 s', 'home', () => gT('nestle') >= 0.5], ['nestle 1.4 s', 'home', () => gT('nestle') >= 1.4], ['nestle 2.2 s', 'home', () => gT('nestle') >= 2.2],
        ['turning', 'out', () => h.brain.st.plan[h.brain.st.i]?.do !== 'gesture' && h.brain.st.plan[h.brain.st.i]?.t > 0.05],
        ['emerge 0.5 s', 'out', () => gT('emerge') >= 0.5], ['emerge 1.6 s', 'out', () => gT('emerge') >= 1.6], ['emerge 2.4 s', 'out', () => gT('emerge') >= 2.4],
        ['walking out', 'out', () => h.rig.mount.visible && !h.sim.s.gesture && h.sim.s.speed > 0.3]]
        .flatMap(([when, what, pred]) => [['come out', () => h.brain.ask('come out')], ['a floor click', () => h.brain.command([{ do: 'walkTo', x: 0, z: 0, speed: 0.8 }], { source: 'click' })],
          ['a key', () => h.brain.command([{ do: 'gesture', name: 'yes' }], { source: 'key' })]].map(([by, cut]) => ({ name: `box ${what}, ${when}: ${by}`, start: () => {
            home();
            if (what === 'out') { until(() => h.brain.st.i < 0 && !h.sim.s.gesture, 40); h.brain.command([{ do: 'routine', name: 'out' }], { source: 'click' }); }
            if (!until(pred, 40)) return false;
            cut();
            return true;
          } }))),
      // a key or a poke that lands mid-walk: the walk must stop, not carry the hand out of the room
      ...[['key', () => h.brain.command([{ do: 'gesture', name: 'wave' }], { source: 'key' })], ['poke', () => h.brain.poke()], ['jump', () => h.brain.command([{ do: 'jump' }], { source: 'key' })]]
        .map(([n, then]) => ({ name: `walk, then ${n}`, start: () => { h.brain.command([{ do: 'walkTo', x: -3, z: 2, speed: 1.8 }], { source: 'click' }); pump(1.2); return then(); } }))];
    const gT = (name) => h.sim.s.gesture && h.sim.s.gesture.name === name ? h.sim.s.gesture.t : -1;
    const home = () => h.brain.command([{ do: 'routine', name: 'home' }], { source: 'click' });
    const until = (pred, limit) => { for (let t = 0; t < limit; t += 0.05) { if (pred()) return true; pump(0.05); } return false; };
    // the hand and its box agree: hidden means shut in, visible means not inside (or in the
    // way of) a box that is not open, and the box is never left ajar
    const boxAgrees = () => {
      const bx = h.props.state.box, k = h.props.get('box').solid, B = h.rig.mount.position, vis = h.rig.mount.visible;
      const open = bx.lidT === 1 && bx.flapT === 1, shut = bx.lidT === 0 && bx.flapT === 0;
      const inside = B.x > k.x0 && B.x < k.x1 && B.z > k.z0 && B.z < k.z1, onFlap = B.x > k.x0 && B.x < k.x1 && B.z >= k.z1 && B.z < k.z1 + k.h + 0.33;
      return !open && !shut ? 'the box is left ajar' : !vis ? (inside && shut ? null : 'the hand is hidden but not shut in its box')
        : inside && !open ? 'the hand stands, visible, inside a shut box' : onFlap && shut ? 'the front of the box shut on the hand' : null;
    };
    for (const p of plans) {
      if (!p.keep) { h.reset(); pump(1); }
      const t0 = h.sim.s.time;
      let err = p.start() ? null : `did not start: ${h.brain.st.error}`;
      while (!err && h.brain.st.i >= 0 && h.sim.s.time - t0 < LIMIT) { pump(0.25); err = h.brain.st.error; }
      if (!err && h.brain.st.i >= 0) err = `still running after ${LIMIT} s (${h.brain.st.detail})`;
      if (!err) { until(() => !h.sim.s.gesture, 8); pump(0.3); err = boxAgrees(); }
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
