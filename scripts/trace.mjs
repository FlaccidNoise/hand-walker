// scripts/trace.mjs — headless per-frame gait trace dumper: load the page, sample
// sim state at a fixed rate entirely in-page (no per-sample round trips), write one
// JSON object per line, print a per-leg summary. Reuses probe.mjs's launch pattern.
// Usage: node scripts/trace.mjs [--run "<js>"] [--dur ms] [--hz n] [--label NAME]
import { mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const url = process.env.URL || 'http://localhost:8741/index.html';
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const OUT_DIR = new URL('../.debug', import.meta.url).pathname;

function parseArgs(argv) {
  const opts = { run: null, dur: 6000, hz: 30, label: 'trace' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--run') opts.run = argv[++i];
    else if (a === '--dur') opts.dur = +argv[++i];
    else if (a === '--hz') opts.hz = +argv[++i];
    else if (a === '--label') opts.label = argv[++i];
    else { console.error(`unknown arg: ${a}`); process.exit(1); }
  }
  return opts;
}

// Runs entirely in-page: samples sim state at `hz` for `durMs`, returns the array.
function sampleInPage(durMs, hz) {
  const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
  return new Promise((resolve) => {
    const h = window.__hand;
    const round4 = (n) => Math.round(n * 1e4) / 1e4;
    const vec = (v) => ({ x: round4(v.x), y: round4(v.y), z: round4(v.z) });
    const tmp = new h.THREE.Vector3();
    const samples = [];
    const tick = () => {
      const s = h.sim.s;
      const legs = {};
      for (const name of FINGERS) {
        const leg = h.sim.legs[name];
        const d = h.rig.digits[name];
        legs[name] = {
          mode: leg.mode, err: round4(leg.err),
          tip: vec(d.tip.getWorldPosition(tmp)), foot: vec(leg.foot),
        };
      }
      samples.push({
        t: round4(s.time), body: vec(h.rig.mount.position), heading: round4(s.heading),
        gait: s.gait, f: round4(s.f), speed: round4(s.speed),
        planted: s.planted, airborne: s.airborne, legs,
      });
    };
    const period = 1000 / hz;
    const count = Math.max(1, Math.round(durMs / period));
    let i = 0;
    const id = setInterval(() => {
      tick();
      if (++i >= count) { clearInterval(id); resolve(samples); }
    }, period);
  });
}

// Per-leg stats + overall distance, computed from the written samples.
function summarize(samples) {
  const perLeg = {};
  for (const name of FINGERS) {
    let errSum = 0, errN = 0, errMax = 0, swings = 0, netSlide = 0;
    let runStart = null; // {x,z} of the stance run's first tip sample
    let prevMode = null;
    for (const row of samples) {
      const leg = row.legs[name];
      if (leg.mode === 'stance') {
        errSum += leg.err; errN++;
        if (leg.err > errMax) errMax = leg.err;
        if (runStart == null) runStart = leg.tip;
      } else if (runStart != null) {
        netSlide += Math.hypot(leg.tip.x - runStart.x, leg.tip.z - runStart.z);
        runStart = null;
      }
      if (prevMode === 'stance' && leg.mode === 'swing') swings++;
      prevMode = leg.mode;
    }
    if (runStart != null) { // trace ended mid-stance: close out the open run
      const lastTip = samples[samples.length - 1].legs[name].tip;
      netSlide += Math.hypot(lastTip.x - runStart.x, lastTip.z - runStart.z);
    }
    perLeg[name] = {
      stanceMeanErr: errN ? +(errSum / errN).toFixed(4) : 0,
      stanceMaxErr: +errMax.toFixed(4),
      swings, netSlide: +netSlide.toFixed(4),
    };
  }
  const b0 = samples[0].body, b1 = samples[samples.length - 1].body;
  const distance = +Math.hypot(b1.x - b0.x, b1.z - b0.z).toFixed(4);
  return { perLeg, distance };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  mkdirSync(OUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: chrome, headless: 'new',
    args: ['--no-first-run', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    const errs = [];
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', e => errs.push(String(e)));
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction('window.__hand && window.__hand.state.ready', { timeout: 15000 });

    if (opts.run) await page.evaluate(opts.run);

    const samples = await page.evaluate(sampleInPage, opts.dur, opts.hz);
    if (!samples.length) throw new Error('no samples collected');

    const filePath = `${OUT_DIR}/trace-${opts.label}.jsonl`;
    writeFileSync(filePath, samples.map(s => JSON.stringify(s)).join('\n') + '\n');

    const { perLeg, distance } = summarize(samples);
    console.log(filePath);
    console.log(`lines: ${samples.length}`);
    console.log(JSON.stringify({ perLeg, distance }, null, 2));

    if (errs.length) console.error('page console errors:', errs.slice(0, 5).join('\n'));
  } catch (e) {
    console.error('trace.mjs failed:', e && (e.stack || e.message) || String(e));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

await main();
