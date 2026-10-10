// scripts/probe.mjs — headless Chrome helper: load the page, run an async JS expression,
// print the JSON result. Reused by the QA gate. Usage: node scripts/probe.mjs "<expr>"
import puppeteer from 'puppeteer-core';
const url = process.env.URL || 'http://localhost:8741/index.html';
const expr = process.argv[2] || '({ok:true})';
const settleMs = +(process.env.SETTLE_MS || 2500);
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
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
  await new Promise(r => setTimeout(r, settleMs));
  const result = await page.evaluate(expr);
  console.log(JSON.stringify({ result, consoleErrors: errs.slice(0, 5) }, null, 2));
} finally { await browser.close(); }
