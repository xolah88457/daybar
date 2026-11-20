// Renders the Daybar ad frame by frame: a stage page (stage.html) holds the live browser build in an
// iframe; app time runs on Playwright's fake clock, so every frame is exactly 1/FPS s apart.
// Usage: node render.js <outDir> [--preview 1.5,9,16]   (needs the static build on 127.0.0.1:4173)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const FPS = 30, DURATION = 48;
const out = path.resolve(process.argv[2] || 'frames');
const previewArg = process.argv.indexOf('--preview');
const preview = previewArg > 0 ? process.argv[previewArg + 1].split(',').map(Number) : null;
const stage = fs.readFileSync(path.join(__dirname, 'stage.html'), 'utf8');

const appCss = `
  * { font-family: 'DejaVu Sans Mono', monospace !important; }
  .demo-banner, .save-notice, .page-footer, .sidebar-bottom .connection, .sidebar-bottom p { display: none !important; }
  * { cursor: none !important; }`;

const inApp = (frame, fn, arg) => frame.evaluate(fn, arg);
const click = (kind, arg) => async (frame) => inApp(frame, ([kind, arg]) => {
  const d = document; let el;
  if (kind === 'chk') el = [...d.querySelectorAll('.check-row')].find((r) => r.textContent.includes(arg))?.querySelector('input');
  if (kind === 'btn') el = [...d.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(arg));
  if (kind === 'nav') el = [...d.querySelectorAll('nav button')].find((b) => b.textContent.includes(arg));
  if (kind === 'toggle') el = d.querySelector('[aria-label^="Switch to"]');
  if (!el) throw new Error(`missing ${kind}:${arg}`);
  el.click();
}, [kind, arg]);

// Must match CLICKS in stage.html.
const actions = [
  [10.75, click('chk', 'Sketch a scene')],
  [11.7, click('chk', 'Take a walk')],
  [16.45, click('btn', '25 min')],
  [27.15, click('nav', 'Deadline Radar')],
  [33.15, click('nav', 'Today')],
  [34.4, click('toggle')],
  [36.6, click('toggle')]
];

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.clock.install({ time: new Date(2026, 10, 20, 15, 40, 0) });
  await page.route('http://127.0.0.1:4173/__stage', (r) => r.fulfill({ contentType: 'text/html', body: stage }));
  await page.goto('http://127.0.0.1:4173/__stage');
  const frame = await (await page.waitForSelector('#app')).contentFrame();
  await frame.waitForSelector('nav button');
  await frame.addStyleTag({ content: appCss });
  await page.evaluate(() => document.fonts.ready);
  await frame.evaluate(() => document.fonts.ready);
  await page.clock.pauseAt(new Date(2026, 10, 20, 15, 40, 30));

  const total = Math.round(DURATION * FPS);
  let next = 0, n = 0;
  const times = preview ?? Array.from({ length: total }, (_, i) => i / FPS);
  let last = 0;
  for (const t of times) {
    // advance app time to t (in whole ms), running due actions on the way
    while (next < actions.length && actions[next][0] <= t) {
      const ms = Math.round(actions[next][0] * 1000) - last;
      if (ms > 0) { await page.clock.runFor(ms); last += ms; }
      await actions[next][1](frame); next++;
    }
    const ms = Math.round(t * 1000) - last;
    if (ms > 0) { await page.clock.runFor(ms); last += ms; }
    await page.evaluate((t) => window.__render(t), t);
    const name = preview ? `p-${t.toFixed(2)}.jpg` : `${String(n).padStart(5, '0')}.jpg`;
    await page.screenshot({ path: path.join(out, name), type: 'jpeg', quality: 93 });
    n++;
    if (!preview && n % 150 === 0) console.log(`${n}/${total}`);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
