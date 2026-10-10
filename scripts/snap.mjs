// scripts/snap.mjs — headless screenshot tool: load the page, position the camera
// at named views around the hand's body, screenshot each. Reuses probe.mjs's launch
// pattern. Usage: node scripts/snap.mjs [--views a,b] [--run "<js>"] [--wait ms]
//                 [--out DIR] [--label NAME]
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const url = process.env.URL || 'http://localhost:8741/index.html';
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function parseArgs(argv) {
  const opts = { views: 'side,tq', run: null, wait: null, out: null, label: 'snap' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--views') opts.views = argv[++i];
    else if (a === '--run') opts.run = argv[++i];
    else if (a === '--wait') opts.wait = +argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--label') opts.label = argv[++i];
    else { console.error(`unknown arg: ${a}`); process.exit(1); }
  }
  if (opts.wait == null) opts.wait = opts.run ? 3000 : 1500;
  if (opts.out == null) opts.out = new URL('../.debug', import.meta.url).pathname;
  return opts;
}

const VIEW_FNS = {
  side:  (B, d) => ({ x: B.x, z: B.z + d }),
  front: (B, d) => ({ x: B.x + d, z: B.z }),
  tq:    (B, d) => ({ x: B.x + d * 0.7, z: B.z + d * 0.7, yExtra: 1.2 }),
  top:   (B, d) => ({ x: B.x + 0.01, z: B.z, top: true }),
  live:  null,                        // don't touch the camera — the app's own view
};

function viewPosition(view, B, standH, d) {
  const fn = VIEW_FNS[view];
  if (!fn) return null;
  const { x, z, yExtra = 0, top = false } = fn(B, d);
  const y = top ? d : standH * 0.8 + yExtra;
  return { camX: x, camY: y, camZ: z, tgtX: B.x, tgtY: standH * 0.6, tgtZ: B.z };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const views = opts.views.split(',').map(s => s.trim()).filter(Boolean);
  for (const v of views) {
    if (!(v in VIEW_FNS)) {
      console.error(`unknown view "${v}" — valid views: ${Object.keys(VIEW_FNS).join(', ')}`);
      process.exit(1);
    }
  }

  mkdirSync(opts.out, { recursive: true });

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

    if (opts.run) {
      await page.evaluate(opts.run);
    }
    await new Promise(r => setTimeout(r, opts.wait));

    await page.waitForFunction('window.__hand && window.__hand.state.ready', { timeout: 15000 });

    const saved = [];
    for (const view of views) {
      const B = await page.evaluate(() => ({ ...window.__hand.rig.mount.position }));
      const standH = await page.evaluate(() => window.__hand.calib.standH);
      const pos = viewPosition(view, B, standH, 3.5);

      // Re-apply the camera pose for several frames right before the shot ('live'
      // skips this and shoots the app's own fixed diorama camera).
      if (pos) {
        for (let i = 0; i < 10; i++) {
          await page.evaluate((p) => {
            const { camera, controls } = window.__hand;
            camera.position.set(p.camX, p.camY, p.camZ);
            controls.target.set(p.tgtX, p.tgtY, p.tgtZ);
            controls.update();
          }, pos);
          await new Promise(r => setTimeout(r, 16));
        }
      }
      await new Promise(r => setTimeout(r, 150));

      const filePath = `${opts.out}/${opts.label}-${view}.png`;
      await page.screenshot({ path: filePath });
      saved.push(filePath);
    }

    for (const p of saved) console.log(p);

    if (opts.run) {
      const bodyPos = await page.evaluate(() => ({ ...window.__hand.rig.mount.position }));
      console.log(`body position: ${JSON.stringify(bodyPos)}`);
    }

    if (errs.length) console.error('page console errors:', errs.slice(0, 5).join('\n'));
  } catch (e) {
    console.error('snap.mjs failed:', e && (e.stack || e.message) || String(e));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

await main();
