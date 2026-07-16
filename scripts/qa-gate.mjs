// scripts/qa-gate.mjs — headless QA matrix (§6). Runs __qa.matrix() (10 scenarios,
// ~90 s) in headless Chrome and exits 0 when green (9/10 with spam allow-listed).
// Run A/Bs HERE, headless — a visible window throttles rAF hard enough to lie (§6).
// Usage: node scripts/qa-gate.mjs [scenarioName] [--repeat N]
//   --repeat N (N>1): interleaved repeats (A,B,...,A,B,... — §7 A/B hygiene) of the
//   matrix (or the single named scenario), gated on the per-scenario MEDIAN — the
//   matrix is noise-dominated near the slide criterion run-to-run. N=1 (default)
//   behaves exactly as a single run.
import puppeteer from 'puppeteer-core';

const url = process.env.URL || 'http://localhost:8741/index.html';
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ALLOW_LIST = ['spam'];                                 // mirrors qa.js:152

// mirrors qa.js CRIT (qa.js:14) and its fail logic (qa.js:100-106) — keep in sync by hand.
const CRIT = { slide: 0.5, cross: -0.05, floor: -0.01, tipErrP95: 0.08, swingLo: 0.11, swingHi: 0.20 };
function evalFails(m) {
  const fails = [];
  if (m.slide >= CRIT.slide) fails.push(`slide ${m.slide}`);
  if (m.cross <= CRIT.cross) fails.push(`cross ${m.cross}`);
  if (m.floor < CRIT.floor) fails.push(`floor ${m.floor}`);
  if (m.tipErrP95 >= CRIT.tipErrP95) fails.push(`tipErrP95 ${m.tipErrP95}`);
  if (m.swingMin != null && (m.swingMin < CRIT.swingLo - 0.01 || m.swingMax > CRIT.swingHi + 0.01))
    fails.push(`swingDur ${m.swingMin}-${m.swingMax}`);       // ±0.01: rAF sampling quantum
  if (m.towed) fails.push('towed digit');
  return fails;
}

function parseArgs(argv) {
  let only = null, repeat = 1;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repeat') {
      const v = +argv[++i];
      if (Number.isFinite(v) && v > 0) repeat = v;
    } else only = argv[i];
  }
  return { only, repeat };
}
const { only, repeat } = parseArgs(process.argv.slice(2));

function printRow(r, spread) {
  const m = r.metrics;
  const slideStr = spread ? `${m.slide} [${spread.min}..${spread.max}]` : String(m.slide);
  console.log([
    r.pass ? ' ok ' : 'FAIL', r.name.padEnd(10),
    `slide ${slideStr.padEnd(6)}`, `cross ${String(m.cross).padEnd(7)}`,
    `floor ${String(m.floor).padEnd(7)}`, `errP95 ${String(m.tipErrP95).padEnd(6)}`,
    `swing ${m.swingMin ?? '-'}..${m.swingMax ?? '-'}`, `steps ${m.steps}`,
    r.fails.length ? ' <- ' + r.fails.join(', ') : '',
  ].join(' '));
}

// element at floor(N/2) of the sorted values, nulls excluded (per spec).
const median = (vals) => {
  const s = vals.filter(v => v != null).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

// aggregate N repeat runs of one scenario into median metrics + a slide spread.
function aggregate(name, runs) {
  const metrics = {
    slide: median(runs.map(r => r.metrics.slide)),
    cross: median(runs.map(r => r.metrics.cross)),
    floor: median(runs.map(r => r.metrics.floor)),
    tipErrP95: median(runs.map(r => r.metrics.tipErrP95)),
    swingMin: median(runs.map(r => r.metrics.swingMin)),
    swingMax: median(runs.map(r => r.metrics.swingMax)),
    towed: runs.filter(r => r.metrics.towed).length > runs.length / 2,   // majority vote
    steps: median(runs.map(r => r.metrics.steps)),
    lift: median(runs.map(r => r.metrics.lift)),
  };
  const fails = evalFails(metrics);
  const slideVals = runs.map(r => r.metrics.slide);
  return {
    name, metrics, fails, pass: fails.length === 0,
    spread: { min: Math.min(...slideVals), max: Math.max(...slideVals) },
  };
}

const browser = await puppeteer.launch({
  executablePath: chrome, headless: 'new',
  args: ['--no-first-run', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  page.on('pageerror', e => { console.error('PAGE ERROR:', String(e)); process.exitCode = 1; });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction('window.__hand && window.__hand.state.ready && window.__qa', { timeout: 20000 });

  if (repeat <= 1) {                                          // unchanged single-run behavior
    if (only) {
      const res = await page.evaluate((n) => window.__qa.scenario(n), only);
      console.log(JSON.stringify(res, null, 2));
      process.exit(res.pass ? 0 : 1);
    }
    const t0 = Date.now();
    const res = await page.evaluate(() => window.__qa.matrix());
    for (const r of res.rows) printRow(r);
    console.log(`qa-gate: ${res.passed}/${res.total} pass in ${((Date.now() - t0) / 1000).toFixed(0)}s ` +
      `(spam allow-listed) → ${res.green ? 'GREEN' : 'RED'}`);
    process.exit(res.green ? 0 : 1);
  }

  // --repeat N>1: interleaved runs (A,B,...,A,B,... — never A,A,B,B), gate on medians.
  const names = only ? [only] : await page.evaluate(() => Object.keys(window.__qa.SCENARIOS));
  const runsByName = Object.fromEntries(names.map(n => [n, []]));
  const t0 = Date.now();
  for (let rep = 0; rep < repeat; rep++) {
    for (const name of names) {
      const res = await page.evaluate((n) => window.__qa.scenario(n), name);
      runsByName[name].push(res);
    }
  }
  const aggregated = names.map(name => aggregate(name, runsByName[name]));
  for (const r of aggregated) printRow(r, r.spread);

  if (only) process.exit(aggregated[0].pass ? 0 : 1);

  const required = aggregated.filter(r => !ALLOW_LIST.includes(r.name));
  const passed = aggregated.filter(r => r.pass).length;
  const green = required.every(r => r.pass);
  console.log(`qa-gate: ${passed}/${aggregated.length} median-pass over ${repeat} repeats in ` +
    `${((Date.now() - t0) / 1000).toFixed(0)}s (spam allow-listed) → ${green ? 'GREEN' : 'RED'}`);
  process.exit(green ? 0 : 1);
} finally { await browser.close(); }
