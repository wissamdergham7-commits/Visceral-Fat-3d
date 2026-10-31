// tests/verify.mjs — full verification matrix for the integrated build.
//   node tests/verify.mjs <html> <outdir> [--mobile]
// 5 angles × 3 fat levels, every mode (split / section / tour / physiology panels), console log, triangle counts.
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PKG || '/opt/node-tools/node_modules/playwright');
import fs from 'fs';
import path from 'path';

const [,, html = 'visceral-fat-3d.html', outDir = 'shots/verify', ...flags] = process.argv;
const mobile = flags.includes('--mobile');
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 900, height: 820 }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
const t0 = Date.now();
await page.goto('file://' + path.resolve(html));
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
console.log(`ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
await page.screenshot({ path: path.join(outDir, '00_intro.png') });
await page.fill('#iw', '93.5'); await page.fill('#ih', '170'); await page.fill('#iwaist', '104');
await page.click('[data-c="snore"]');
await page.click('#go'); await page.waitForTimeout(800);
await page.screenshot({ path: path.join(outDir, '01_tour_start.png') });
await page.evaluate(() => { document.getElementById('tourX').click(); const r = document.getElementById('rot'); if (r.classList.contains('on')) r.click(); });
const box = await page.locator('#viewer').boundingBox();
const stats = [];
const shot = async (name, full = false, wait = 1600) => {
  await page.evaluate(() => window.__snap && window.__snap());
  await page.waitForTimeout(wait);
  const info = await page.evaluate((() => { const c = window.__ctx, cam = c.camera; let tris = 0, meshes = 0;
    c.scene.traverse((o) => { if (!o.isMesh || !o.visible) return; for (let p = o.parent; p; p = p.parent) if (!p.visible) return;
      if (!(o.layers.mask & cam.layers.mask)) return; const g = o.geometry; const n = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
      tris += n * (o.isInstancedMesh ? o.count : 1); meshes++; }); return { tris: Math.round(tris), calls: meshes }; }));  // geometry actually submitted for the camera's layers
  await page.screenshot({ path: path.join(outDir, name + '.png'), clip: full ? undefined : box, animations: 'disabled', timeout: 180000 });
  stats.push({ name, ...info }); process.stdout.write(`${name} (${info.tris} tris / ${info.calls} calls)\n`);
};
const setLoss = (v) => page.evaluate((v) => window.__setLoss(v), v);
const view = (v) => page.evaluate((v) => window.__view(v), v);
const mode = (m) => page.evaluate((m) => window.__mode(m), m);

if (!mobile) {
  for (const l of [-10, 0, 20]) {
    await setLoss(l);
    for (const v of ['front', 'side', 'heart', 'liver', 'belly']) { await view(v); await shot(`${v}_loss${l}`); }
  }
  await setLoss(0);
  await view('full'); await shot('full_body');
  await view('bp'); await shot('view_bp'); await view('breath'); await shot('view_breath'); await view('snore'); await shot('view_snore');
  await mode('split'); await shot('mode_split', false, 2500); await mode('normal');
  await mode('section'); await shot('mode_section', false, 2500); await mode('normal');
  await page.evaluate(() => window.__focus('heart')); await shot('card_heart', true);
  await page.evaluate(() => document.getElementById('ocardX').click());
  for (const p of ['bp', 'breath', 'sleep']) {
    if (await page.evaluate(() => !!(window.__physUI && window.__physUI.show))) {
      await view(p === 'sleep' ? 'snore' : p);
      await page.evaluate((p) => window.__physUI.show(p), p); await shot(`phys_${p}`, true, p === 'sleep' ? 9000 : 4000);
      if (p === 'sleep') await shot('phys_sleep_later', true, 9000);
      await setLoss(20); await shot(`phys_${p}_after`, true, 3500); await setLoss(0);
      await page.evaluate(() => window.__physUI.hide()); await page.waitForTimeout(800);
    }
  }
  await page.click('[data-mode="tour"]'); await page.waitForTimeout(2000); await shot('tour_station1', true, 1500);
  await page.click('#tourSkip'); await page.waitForTimeout(1500); await page.screenshot({ path: path.join(outDir, 'end_screen.png') });
} else {
  await view('front'); await shot('m_front', true);
  await setLoss(-10); await shot('m_front_maxfat', true);
  await page.evaluate(() => window.scrollTo(0, 900)); await page.waitForTimeout(500); await page.screenshot({ path: path.join(outDir, 'm_panel.png') });
  await page.evaluate(() => window.scrollTo(0, 0));
  if (await page.evaluate(() => !!(window.__physUI && window.__physUI.show))) {
    for (const p of ['bp', 'breath', 'sleep']) { await page.evaluate((p) => window.__physUI.show(p), p); await shot(`m_phys_${p}`, true, 5000); await page.evaluate(() => window.__physUI.hide()); }
  }
}
fs.writeFileSync(path.join(outDir, 'console.txt'), logs.join('\n'));
fs.writeFileSync(path.join(outDir, 'stats.json'), JSON.stringify(stats, null, 1));
console.log(`console errors/warnings: ${logs.length}` + (logs.length ? '\n' + logs.slice(0, 30).join('\n') : ''));
console.log('max triangles:', Math.max(...stats.map((s) => s.tris)), 'max calls:', Math.max(...stats.map((s) => s.calls)));
await browser.close();
