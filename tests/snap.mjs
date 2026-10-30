// tests/snap.mjs — fast, scriptable screenshots for one build.
//   node tests/snap.mjs <html> <outdir> --steps '<json array>' [--size 600x560]
// step = { name, loss?: -10..20, view?: 'front'|'side'|'heart'|'liver'|'belly',
//          cam?: [px,py,pz,tx,ty,tz], js?: 'any JS evaluated in page', wait?: ms, full?: true }
// The page object is reachable as window.__ctx (scene, camera, state, anchors, groups, renderer).
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PKG || '/opt/node-tools/node_modules/playwright');
import fs from 'fs';
import path from 'path';

const argv = process.argv.slice(2);
const html = argv[0], outDir = argv[1];
const stepsArg = argv[argv.indexOf('--steps') + 1];
const sizeArg = argv.includes('--size') ? argv[argv.indexOf('--size') + 1] : '900x820';   // e.g. --size 600x560 for faster iteration
const [VW, VH] = sizeArg.split('x').map(Number);
const steps = JSON.parse(stepsArg || '[{"name":"front"}]');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
await page.goto('file://' + path.resolve(html));
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
await page.fill('#iw', '93.5'); await page.fill('#ih', '170'); await page.fill('#iwaist', '104');
await page.click('#go'); await page.waitForTimeout(700);
await page.evaluate(() => { document.getElementById('tourX').click(); const r = document.getElementById('rot'); if (r.classList.contains('on')) r.click(); });
const box = await page.locator('#viewer').boundingBox();
for (const s of steps) {
  if (s.loss !== undefined) await page.evaluate((v) => window.__setLoss(v), s.loss);
  if (s.view) await page.evaluate((v) => window.__view(v), s.view);
  if (s.cam) await page.evaluate((c) => window.__cam(...c), s.cam);
  if (s.js) await page.evaluate(s.js);
  await page.evaluate(() => window.__snap && window.__snap());
  await page.waitForTimeout(s.wait ?? 1500);
  const info = await page.evaluate(() => { const i = window.__ctx.renderer.info.render; return `${i.triangles} tris, ${i.calls} calls`; });
  await page.screenshot({ path: path.join(outDir, s.name + '.png'), clip: s.full ? undefined : box, animations: 'disabled', timeout: 150000 });
  console.log(`${s.name}: ${info}`);
}
fs.writeFileSync(path.join(outDir, 'console.txt'), logs.join('\n'));
console.log(`console errors/warnings: ${logs.length}` + (logs.length ? '\n' + logs.slice(0, 15).join('\n') : ''));
await browser.close();
