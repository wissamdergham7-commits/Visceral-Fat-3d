// ui/views.js — camera views, display modes (normal / split / section / tour), toggles, resize, split rendering.
import { $, P, clamp } from '../core/ctx.js';

export const VIEWS = {
  front: [P(0, 0.2, 20), P(0, -0.1, 0)], side: [P(18.5, 0.6, 2.5), P(0, -0.2, 0)],
  heart: [P(2.6, 3, 10.8), P(0.35, 1.55, 0.5)], liver: [P(-5, 2.3, 11.6), P(-0.6, 0, 0.4)],
  belly: [P(0.9, -0.5, 14.6), P(0, -2.2, 0.7)], section: [P(0.25, 10.5, 5.2), P(0, -2.4, 0.2)],
};
const VIEW_OPACITY = { front: [0.6, 0.5], side: [0.6, 0.5], heart: [0.1, 0.12], liver: [0.18, 0.35], belly: [0.3, 0.5], section: [0.25, 0.2] };

let C, camAnim = null, hooks;

/** fly the camera to a named view (or to [pos, target]) */
export function goView(name) {
  const cam = C.camera, ctl = C.controls;
  if (VIEW_OPACITY[name]) [C.state.opTarget.bone, C.state.opTarget.lung] = VIEW_OPACITY[name];
  const [p, t] = VIEWS[name];
  camAnim = { t: 0, p0: cam.position.clone(), p1: p, t0: ctl.target.clone(), t1: t };
  ctl.autoRotate = false; $('rot').classList.remove('on');
}
/** fly to an arbitrary point, keeping the current viewing direction, at distance dist */
export function flyTo(point, dist = 11.5) {
  const cam = C.camera, ctl = C.controls;
  const dir = cam.position.clone().sub(point).normalize();
  camAnim = { t: 0, p0: cam.position.clone(), p1: point.clone().add(dir.multiplyScalar(dist)), t0: ctl.target.clone(), t1: point.clone() };
  ctl.autoRotate = false; $('rot').classList.remove('on');
}

export function setMode(mode) {
  const st = C.state;
  if (st.mode === mode) mode = 'normal';
  st.mode = mode;
  hooks.hideCard();
  document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  hooks.setSection(mode === 'section');
  $('splitLabels').style.display = mode === 'split' ? '' : 'none';
  if (mode === 'split') {
    if (+$('loss').value == 0) { $('loss').value = 10; hooks.calc(); }
    C.controls.autoRotate = false; $('rot').classList.remove('on'); goView('front');
  }
  if (mode === 'section') { hooks.drawSection(); goView('section'); }
  if (mode === 'normal') goView('front');
  resize();
}

export function resize() {
  const v = C.viewer, cam = C.camera, w = v.clientWidth, h = v.clientHeight;
  C.renderer.setSize(w, h, false); C.composer.setSize(w, h);
  if (C.state.mode === 'split') {
    cam.clearViewOffset(); cam.aspect = w / 2 / h;
    cam.fov = clamp(2 * Math.atan(3.8 / (cam.aspect * 19)) * 180 / Math.PI, 30, 78);
  } else {
    cam.aspect = w / h; cam.fov = w / h < 0.75 ? 44 : 34;
    const hud = document.querySelector('.hud').offsetHeight + 10;
    cam.setViewOffset(w, h, 0, (hud - 44) / 2, w, h);
  }
  cam.updateProjectionMatrix();
}

/** per-frame: camera flight + render (split = two scissored passes with different layer masks) */
export function frame(dtClamped) {
  const cam = C.camera, ctl = C.controls, r = C.renderer;
  if (camAnim) {
    camAnim.t = Math.min(1, camAnim.t + dtClamped / 1.3);
    const k = camAnim.t < 0.5 ? 4 * camAnim.t ** 3 : 1 - (-2 * camAnim.t + 2) ** 3 / 2;
    cam.position.lerpVectors(camAnim.p0, camAnim.p1, k); ctl.target.lerpVectors(camAnim.t0, camAnim.t1, k);
    if (camAnim.t >= 1) camAnim = null;
  }
  ctl.update();
  if (C.state.mode === 'split') {
    const w = r.domElement.width / r.getPixelRatio(), h = r.domElement.height / r.getPixelRatio();
    r.setScissorTest(true);
    cam.layers.mask = 0b101; r.setViewport(w / 2, 0, w / 2, h); r.setScissor(w / 2, 0, w / 2, h); r.render(C.scene, cam);   // right: B (today)
    cam.layers.mask = 0b011; r.setViewport(0, 0, w / 2, h); r.setScissor(0, 0, w / 2, h); r.render(C.scene, cam);           // left: A (after)
    r.setScissorTest(false); r.setViewport(0, 0, w, h);
  } else {
    cam.layers.mask = 0b011;
    if (C.bloom.enabled) C.composer.render(); else r.render(C.scene, cam);
  }
}

export function build(ctx, h) {
  C = ctx; hooks = h;
  ctx.state.opTarget = { bone: 0.6, lung: 0.5 };
  document.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => {
    document.querySelectorAll('[data-view]').forEach((x) => x.classList.remove('on')); b.classList.add('on');
    hooks.hideCard(); goView(b.dataset.view);
  }));
  $('rot').onclick = () => { ctx.controls.autoRotate = !ctx.controls.autoRotate; $('rot').classList.toggle('on', ctx.controls.autoRotate); };
  const toggles = { tSkin: ctx.groups.skin, tLung: ctx.groups.lungs, tBone: ctx.groups.bones };
  Object.entries(toggles).forEach(([id, g]) => ($(id).onclick = () => { const on = !$(id).classList.contains('on'); $(id).classList.toggle('on', on); g.visible = on; }));
  $('tLab').onclick = () => { ctx.state.showLabels = !ctx.state.showLabels; $('tLab').classList.toggle('on', ctx.state.showLabels); };
  document.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => {
    if (b.dataset.mode === 'tour') hooks.startTour(); else { hooks.stopTour(); setMode(b.dataset.mode); }
  }));
  window.__mode = setMode;
  /* test hooks: jump the camera / slider / fat level without animation */
  window.__view = (name) => { goView(name); if (camAnim) { ctx.camera.position.copy(camAnim.p1); ctx.controls.target.copy(camAnim.t1); camAnim = null; } };
  window.__cam = (px, py, pz, tx, ty, tz) => { camAnim = null; ctx.camera.position.set(px, py, pz); ctx.controls.target.set(tx, ty, tz); ctx.controls.update(); };
  window.__setLoss = (v) => { $('loss').value = v; $('loss').dispatchEvent(new Event('input')); };
  window.__snap = () => { const st = ctx.state; st.fCur = st.fTgt; Object.assign(st.body, st.bodyTgt); };
  new ResizeObserver(resize).observe(ctx.viewer);
  resize();
}
