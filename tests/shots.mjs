// tests/shots.mjs — Playwright screenshot harness.
//   node tests/shots.mjs <html> <outdir> [--quick]
// Renders a set of (view × fat level × mode) screenshots, dumps console errors to <outdir>/console.txt.
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PKG || '/opt/node-tools/node_modules/playwright');
import fs from 'fs';
import path from 'path';

const [,, htmlPath = 'visceral-fat-3d.html', outDir = 'shots', ...flags] = process.argv;
const quick = flags.includes('--quick');
fs.mkdirSync(outDir, { recursive: true });
const url = 'file://' + path.resolve(htmlPath) + '?quality=' + (process.env.QUALITY || 'high');

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 900, height: 820 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
await page.goto(url);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });

// enter through the intro form like a visitor would
await page.fill('#iw', '93.5'); await page.fill('#ih', '170'); await page.fill('#iwaist', '104');
await page.click('#go');
await page.waitForTimeout(900);
// stop the tour so shots are deterministic; disable autorotate
await page.evaluate(() => { document.getElementById('tourX').click(); const r = document.getElementById('rot'); if (r.classList.contains('on')) r.click(); });

const settle = async (ms = 1800) => page.waitForTimeout(ms);
const box = await page.locator('#viewer').boundingBox();
const shot = async (name) => { await page.screenshot({ path: path.join(outDir, name + '.png'), clip: box, animations: 'disabled', timeout: 150000 }); process.stdout.write(name + ' '); };
const setLoss = async (v) => page.evaluate((v) => { const s = document.getElementById('loss'); s.value = v; s.dispatchEvent(new Event('input')); }, v);
const view = async (v) => page.click(`[data-view="${v}"]`);

const views = quick ? ['front', 'heart'] : ['front', 'side', 'heart', 'liver', 'belly'];
const losses = quick ? [0] : [-10, 0, 20];   // -10 = max fat, 0 = today, 20 = max loss
for (const l of losses) {
  await setLoss(l); await settle(2200);
  for (const v of views) { await view(v); await settle(1700); await shot(`${v}_loss${l}`); }
}
await setLoss(0);
await page.evaluate(() => window.__mode('split')); await settle(2200); await shot('mode_split');
await page.evaluate(() => window.__mode('section')); await settle(2200); await shot('mode_section');
await page.evaluate(() => window.__mode('normal')); await settle(500);
await page.evaluate(() => window.__focus('heart')); await settle(1800); await shot('card_heart');
await page.evaluate(() => document.getElementById('ocardX').click());
// tour: start and capture the first and last station
await page.click('[data-mode="tour"]'); await settle(2500); await shot('tour_1');
await page.click('#tourSkip'); await settle(1500); await page.screenshot({ path: path.join(outDir, 'end_screen.png') }); process.stdout.write('end_screen ');
console.log('');
fs.writeFileSync(path.join(outDir, 'console.txt'), logs.join('\n'));
console.log(`console errors/warnings: ${logs.length}`);
if (logs.length) console.log(logs.slice(0, 20).join('\n'));
await browser.close();
