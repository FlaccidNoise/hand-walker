// scripts/calib-gate.mjs — BIT-EXACT calibration gate (§2, §6). Loads the page
// headless, dumps window.__hand.calib (minus wall-clock fields), and diffs it against
// test/calibration.snapshot.json. Any refactor must hold this snapshot; re-baseline
// only deliberately with --update.
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync } from 'node:fs';

const url = process.env.URL || 'http://localhost:8741/index.html';
const snapPath = new URL('../test/calibration.snapshot.json', import.meta.url);
const update = process.argv.includes('--update');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const browser = await puppeteer.launch({
  executablePath: chrome, headless: 'new',
  args: ['--no-first-run', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage();
  page.on('pageerror', e => { console.error('PAGE ERROR:', String(e)); process.exitCode = 1; });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction('window.__hand && window.__hand.calib', { timeout: 20000 });
  const calib = await page.evaluate(() => {
    const { calibMs, ...rest } = window.__hand.calib;   // calibMs is wall clock — excluded
    return { ...rest, walkPitch: window.__hand.C.TUNE.walkPitch };
  });
  const dump = JSON.stringify(calib, null, 1);
  if (update) {
    writeFileSync(snapPath, dump);
    console.log(`calib-gate: snapshot UPDATED (standH=${calib.standH}, walkPitch=${calib.walkPitch})`);
  } else {
    let want;
    try { want = readFileSync(snapPath, 'utf8'); }
    catch { console.error('calib-gate: no snapshot. Run `node scripts/calib-gate.mjs --update` to baseline.'); process.exit(1); }
    if (dump === want) {
      console.log(`calib-gate: BIT-EXACT ✓ (standH=${calib.standH}, strideMax=${calib.strideMax}, walkPitch=${calib.walkPitch})`);
    } else {
      const a = JSON.parse(want), b = calib;
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        const sa = JSON.stringify(a[k]), sb = JSON.stringify(b[k]);
        if (sa !== sb) console.error(`calib-gate: MISMATCH ${k}:\n  snapshot: ${sa?.slice(0, 200)}\n  current:  ${sb?.slice(0, 200)}`);
      }
      console.error('calib-gate: FAILED — calibration outputs drifted. If deliberate, re-baseline with --update.');
      process.exit(1);
    }
  }
} finally { await browser.close(); }
