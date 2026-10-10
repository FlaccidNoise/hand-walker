// scripts/qa-gate.mjs — headless QA matrix (§6) on a VIRTUAL CLOCK: performance.now
// and requestAnimationFrame are replaced before any page script runs, so the page's
// real loop integrates exactly 1/hz per frame. Results are bit-reproducible and do not
// depend on machine load or on the headless frame rate.
// Usage: node scripts/qa-gate.mjs [scenarioName] [--hz N] [--save metrics.json]   (hz default 120)
// Exit 0 when every scenario outside qa.js KNOWN_RED passes.
import { writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const base = process.env.URL || 'http://localhost:8741/index.html';
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let only = null, hz = 120, save = null;
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--hz') hz = +process.argv[++i];
  else if (process.argv[i] === '--save') save = process.argv[++i];
  else only = process.argv[i];
}
if (!(hz > 0)) { console.error('qa-gate: --hz needs a positive number, like --hz 60'); process.exit(2); }

function printRow(r, known) {
  const m = r.metrics;
  console.log([
    r.pass ? ' ok ' : known ? 'red ' : 'FAIL', r.name.padEnd(10),
    `slide ${String(m.slide).padEnd(6)}`, `cross ${String(m.cross).padEnd(7)}`,
    `floor ${String(m.floor).padEnd(7)}`, `errP95 ${String(m.tipErrP95).padEnd(6)}`,
    `swing ${m.swingMin ?? '-'}..${m.swingMax ?? '-'}`, `steps ${m.steps}`,
    r.fails.length ? ' <- ' + r.fails.join(', ') + (known ? `  (known: ${known})` : '') : '',
  ].join(' '));
  const c = m.clear, fx = (v) => v == null ? '-' : v;
  console.log(`       look  clear t/i/m/r/p ${['thumb', 'index', 'middle', 'ring', 'pinky'].map(f => fx(c[f])).join('/')}` +
    `  aloft ${fx(m.aloftClear)}  planted>=${fx(m.plantedMin)}  step ${fx(m.stepLen.middle)}  falls/u ${fx(m.footfallsPerU)}` +
    `  slide/u ${fx(m.slidePerU)}  touchdown ${m.touchdown}  bob ${m.bodyBob}  settle ${fx(m.stopSettle)}`);
}

const browser = await puppeteer.launch({
  executablePath: chrome, headless: 'new', protocolTimeout: 600000,
  args: ['--no-first-run', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 360 });
  page.on('pageerror', e => { console.error('PAGE ERROR:', String(e)); process.exitCode = 1; });
  await page.evaluateOnNewDocument((hz) => {
    let vnow = 0, id = 0; const q = new Map();
    performance.now = () => vnow;
    window.requestAnimationFrame = (cb) => { q.set(++id, cb); return id; };
    window.cancelAnimationFrame = (i) => q.delete(i);
    window.__vframe = (dtMs) => { vnow += dtMs; const cbs = [...q.values()]; q.clear(); for (const cb of cbs) cb(vnow); };
    window.__vhz = hz;
  }, hz);
  await page.goto(base + (base.includes('?') ? '&' : '?') + 'dev', { waitUntil: 'load' });
  // polling by interval: the default rAF polling is the clock we just replaced
  await page.waitForFunction('window.__hand && window.__hand.state.ready && window.__qa', { timeout: 30000, polling: 100 });

  const { names, known } = await page.evaluate(() => ({ names: Object.keys(window.__qa.SCENARIOS), known: window.__qa.KNOWN_RED }));
  if (only && !names.includes(only)) { console.error(`qa-gate: unknown scenario "${only}" — have: ${names.join(', ')}`); process.exit(2); }
  const t0 = Date.now(), rows = [];
  for (const name of only ? [only] : names) {
    const r = await page.evaluate((n) => window.__qa.scenario(n), name);
    rows.push(r); printRow(r, known[name]);
    if (only) console.log(JSON.stringify(r.metrics));
  }
  if (save) writeFileSync(save, JSON.stringify(Object.fromEntries(rows.map(r => [r.name, r.metrics])), null, 1) + '\n');
  const bad = rows.filter(r => !r.pass && !known[r.name]);
  const healed = rows.filter(r => r.pass && known[r.name]);
  for (const r of healed) console.log(`note: ${r.name} passes now — remove it from KNOWN_RED in qa.js`);
  console.log(`qa-gate @${hz}Hz: ${rows.filter(r => r.pass).length}/${rows.length} pass, ` +
    `${rows.filter(r => !r.pass && known[r.name]).length} known red, ${bad.length} unexpected in ` +
    `${((Date.now() - t0) / 1000).toFixed(0)}s → ${bad.length ? 'RED' : 'GREEN'}`);
  process.exit(bad.length ? 1 : 0);
} finally { await browser.close(); }
