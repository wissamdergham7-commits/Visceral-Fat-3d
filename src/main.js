// main.js — entry point: wires core + organs + simulation + UI and runs the render loop.
import { THREE, ctx, $, lerp } from './core/ctx.js';
import * as registry from './core/registry.js';
import * as body from './organs/body.js';
import * as heart from './organs/heart.js';
import * as lungs from './organs/lungs.js';
import * as airway from './organs/airway.js';
import * as liver from './organs/liver.js';
import * as digestive from './organs/digestive.js';
import * as kidneys from './organs/kidneys.js';
import * as vessels from './organs/vessels.js';
import * as fat from './organs/fat.js';
import * as physiology from './sim/physiology.js';
import * as panel from './ui/panel.js';
import * as views from './ui/views.js';
import * as labels from './ui/labels.js';
import * as cards from './ui/cards.js';
import * as section from './ui/section.js';
import * as tour from './ui/tour.js';
import * as physUI from './ui/phys_ui.js';

/* ---- organs (build order matters: fat needs anchors from heart / digestive / kidneys) ---- */
registry.register('body', body, { layers: [1, 2] });
registry.register('heart', heart);
registry.register('lungs', lungs);
registry.register('airway', airway);
registry.register('liver', liver, { layers: [1, 2] });
registry.register('digestive', digestive);
registry.register('kidneys', kidneys);
registry.register('vessels', vessels);
registry.register('fat', fat, { layers: [1, 2] });
registry.buildAll(ctx);
physiology.build(ctx);

/* ---- UI ---- */
const hooks = {
  calc: panel.calc, startTour: tour.startTour, stopTour: tour.stopTour,
  hideCard: cards.hideCard, setSection: section.setSection, drawSection: section.drawSection,
  physShow: (p) => physUI.show && physUI.show(p), physHide: () => physUI.hide && physUI.hide(),
};
section.build(ctx);
views.build(ctx, hooks);
labels.build(ctx);
cards.build(ctx, hooks);
tour.build(ctx, hooks);
panel.build(ctx, hooks);
physUI.build(ctx, hooks);

/* ---- adaptive quality: drop pixel ratio, then bloom, if frames stay slow ---- */
let avgMs = 16;
/* quality start level: phones / small touch screens start at 1 (lower pixel ratio); ?quality=high|mid|low pins it
 * (used by the screenshot tests, whose software renderer would otherwise always degrade to 0) */
const qParam = new URLSearchParams(location.search).get('quality');
const pinned = { high: 2, mid: 1, low: 0 }[qParam];
const touchSmall = window.matchMedia && matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;
function applyQuality(level) {
  const st = ctx.state, dpr = window.devicePixelRatio || 1;
  st.perf = level;
  ctx.renderer.setPixelRatio(level === 2 ? Math.min(dpr, 2) : level === 1 ? Math.min(dpr, touchSmall ? 1.5 : 1.3) : 1);
  ctx.bloom.enabled = level > 0;
}
if (pinned !== undefined) applyQuality(pinned); else if (touchSmall) applyQuality(1);
function perfCheck(dt) {
  if (pinned !== undefined) return;
  avgMs = avgMs * 0.97 + dt * 1000 * 0.03;
  const st = ctx.state;
  if (avgMs > 42 && st.perf > 0) {
    applyQuality(st.perf - 1);
    avgMs = 20;
  }
}

/** the single update point for the fat level: every organ relays itself from f inside update() */
export function applyBody(f) { ctx.state.fCur = f; }

const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const raw = clock.getDelta(), dt = Math.min(raw, 0.05), dtEase = Math.min(raw, 0.4), t = clock.elapsedTime;
  perfCheck(dt);
  const st = ctx.state, k = 1 - Math.exp(-dtEase * 3.2);
  /* ease fat level + torso parameters of state A toward their targets */
  if (st.fCur < 0) { st.fCur = st.fTgt; Object.assign(st.body, st.bodyTgt); }
  if (Math.abs(st.fCur - st.fTgt) > 8e-4) applyBody(lerp(st.fCur, st.fTgt, k));
  for (const key of ['W', 'Wz', 'd', 'bulge']) if (Math.abs(st.body[key] - st.bodyTgt[key]) > 8e-4) st.body[key] = lerp(st.body[key], st.bodyTgt[key], k);

  const phys = physiology.step(st.fCur, t, dt);
  registry.updateAll(st.fCur, t, phys);
  physUI.update(st.fCur, t, phys);
  section.update();
  views.frame(dtEase);
  labels.update();
}

panel.calc();
ctx.state.fCur = -1;
requestAnimationFrame(loop);
$('loading').remove();
window.__ctx = ctx;
window.__ready = true;
/* shader warm-up: compile every material (incl. the "before" layer used only by the split view) shortly after the first
 * frames, so opening قبل / بعد does not stall on shader compilation */
setTimeout(() => {
  try {
    const cam = ctx.camera.clone(); cam.layers.enableAll();
    const r = ctx.renderer.compileAsync ? ctx.renderer.compileAsync(ctx.scene, cam) : ctx.renderer.compile(ctx.scene, cam);
    if (r && r.catch) r.catch(() => {});
  } catch (e) { /* warm-up is best effort */ }
}, 1500);
