// scripts/qa-gate.mjs — headless QA matrix (§6). Runs __qa.matrix() (10 scenarios,
// ~90 s) in headless Chrome and exits 0 when green (9/10 with spam allow-listed).
// Run A/Bs HERE, headless — a visible window throttles rAF hard enough to lie (§6).
// Usage: node scripts/qa-gate.mjs [scenarioName]
import puppeteer from 'puppeteer-core';

const url = process.env.URL || 'http://localhost:8741/index.html';
const only = process.argv[2];
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

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

  if (only) {
    const res = await page.evaluate((n) => window.__qa.scenario(n), only);
    console.log(JSON.stringify(res, null, 2));
    process.exit(res.pass ? 0 : 1);
  }

  const t0 = Date.now();
  const res = await page.evaluate(() => window.__qa.matrix());
  for (const r of res.rows) {
    const m = r.metrics;
    console.log([
      r.pass ? ' ok ' : 'FAIL', r.name.padEnd(10),
      `slide ${String(m.slide).padEnd(6)}`, `cross ${String(m.cross).padEnd(7)}`,
      `floor ${String(m.floor).padEnd(7)}`, `errP95 ${String(m.tipErrP95).padEnd(6)}`,
      `swing ${m.swingMin ?? '-'}..${m.swingMax ?? '-'}`, `steps ${m.steps}`,
      r.fails.length ? ' <- ' + r.fails.join(', ') : '',
    ].join(' '));
  }
  console.log(`qa-gate: ${res.passed}/${res.total} pass in ${((Date.now() - t0) / 1000).toFixed(0)}s ` +
    `(spam allow-listed) → ${res.green ? 'GREEN' : 'RED'}`);
  process.exit(res.green ? 0 : 1);
} finally { await browser.close(); }
