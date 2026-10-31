// ui/labels.js — floating organ name labels projected from 3D anchor points.
import { $, P } from '../core/ctx.js';
import * as THREE from 'three';

let C, items = [];
export function build(ctx) {
  C = ctx;
  const st = ctx.state, root = $('labels');
  const defs = [
    ['القلب', () => P(0.95, 1.2, 1.35)], ['الدهون حول القلب', () => P(-0.35, 2.35, 1.3)], ['الرئة', () => P(-2.1, 2.9, 0.6)],
    ['الكبد', () => P(-1.7, -0.25, 1.25)], ['المعدة', () => P(1.9, -0.5, 0.9)],
    ['الشحم فوق الأمعاء', () => P(0.2, -1.6 - 1.2 * st.fCur, 2 + 0.3 * st.fCur)], ['الأمعاء', () => P(-1, -3.3, 1.2)],
    ['الكلية', () => P(1.3, -1.4, -1.5)], ['الدهون تحت الجلد', () => P(st.body.W - st.body.d * 0.5, -2, 0.9)],
  ];
  if (ctx.anchors.pharynxPos) defs.push(['مجرى التنفس', () => ctx.anchors.pharynxPos.clone().add(P(0.9, 0.2, 0.6))]);
  items = defs.map(([txt, fn]) => {
    const d = document.createElement('div'); d.className = 'lb'; d.innerHTML = `<i></i>${txt}`; root.appendChild(d);
    return { d, fn };
  });
}
export function update() {
  const st = C.state, root = $('labels');
  const show = st.showLabels && st.mode === 'normal' && !st.focusKey;
  root.style.display = show ? '' : 'none';
  if (!show) return;
  const w = C.viewer.clientWidth, h = C.viewer.clientHeight, v = new THREE.Vector3(), dir = new THREE.Vector3();
  C.camera.getWorldDirection(dir);
  items.forEach((it) => {
    v.copy(it.fn());
    const toCam = v.clone().sub(C.camera.position).normalize();
    v.project(C.camera);
    const vis = v.z < 1 && toCam.dot(dir) > 0;
    it.d.style.display = vis ? '' : 'none';
    it.d.style.left = (v.x + 1) / 2 * w + 'px'; it.d.style.top = (1 - v.y) / 2 * h + 'px';
  });
}
