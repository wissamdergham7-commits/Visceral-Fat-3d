// ui/section.js — CT-like axial cross-section: a clipping plane at y = -2 plus a 2D canvas drawn on that plane.
import { $, rnd, setSeed } from '../core/ctx.js';
import * as THREE from 'three';
import { palette } from '../core/style.js';

const Y = -2;
let C, clipPlane, canvas, tex, plane;

function ellipse(g, scale, cx, cy, W, Wz, bulge, inset) {
  const [rx, rz] = C.anchors.torsoRadii(Y, W, Wz, inset);
  g.beginPath();
  for (let i = 0; i <= 96; i++) {
    const a = i / 96 * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    const x = rx * s, z = rz * c * (1 + bulge * Math.max(0, c) ** 1.6) - 0.05;
    i ? g.lineTo(cx + x * scale, cy + z * scale) : g.moveTo(cx + x * scale, cy + z * scale);
  }
  g.closePath();
}

/** redraw the section canvas for the live state A */
export function drawSection() {
  const st = C.state, { W, Wz, bulge, d } = st.body, f = Math.pow(Math.max(0, st.fCur), 1.35);
  const g = canvas.getContext('2d'), w = canvas.width, h = canvas.height, S = 88, cx = w / 2, cy = h / 2;
  g.clearRect(0, 0, w, h);
  g.lineWidth = 3; ellipse(g, S, cx, cy, W, Wz, bulge, 0); g.fillStyle = palette.sectionSkin; g.fill();
  g.lineWidth = 5; g.strokeStyle = palette.sectionSkinEdge; g.stroke();
  g.lineWidth = 3; ellipse(g, S, cx, cy, W, Wz, bulge * 0.96, 0.06); g.fillStyle = palette.sectionFat; g.fill();
  setSeed(777); g.save(); ellipse(g, S, cx, cy, W, Wz, bulge * 0.96, 0.06); g.clip();
  g.strokeStyle = 'rgba(160,110,10,.35)'; g.lineWidth = 1.5;
  for (let i = 0; i < 260; i++) { const a = rnd() * 7, r = 3 + rnd() * 6; g.beginPath(); g.arc(cx + (rnd() - 0.5) * w, cy + (rnd() - 0.5) * h, r, a, a + 4); g.stroke(); }
  g.restore();
  ellipse(g, S, cx, cy, W, Wz, bulge * 0.9, 0.06 + d); g.fillStyle = palette.sectionMuscle; g.fill();
  ellipse(g, S, cx, cy, W, Wz, bulge * 0.88, 0.16 + d); g.fillStyle = palette.sectionCavity; g.fill();
  const [rx, rz] = C.anchors.torsoRadii(Y, W, Wz, 0.16 + d), X = (v) => cx + v * S, Zc = (v) => cy + v * S;
  const disc = (x, z, r, fill, stroke) => { g.beginPath(); g.arc(X(x), Zc(z), r * S, 0, 7); g.fillStyle = fill; g.fill(); if (stroke) { g.strokeStyle = stroke; g.lineWidth = 2; g.stroke(); } };
  disc(0, -rz + 0.42, 0.3, '#ddc9a8', '#a8906e'); g.fillRect(X(-0.06), Zc(-rz + 0.62), 0.12 * S, 0.3 * S);       // vertebra + spinous process
  disc(0.24, -rz + 0.78, 0.13, '#c3283a'); disc(-0.33, -rz + 0.8, 0.14, '#3e63b3');                                // aorta, IVC
  disc(0.62, -rz + 0.55, 0.26, '#9c4a3c'); disc(-0.62, -rz + 0.55, 0.26, '#9c4a3c');                               // psoas
  disc(1.2, -rz + 0.65, 0.33, '#8c2f2a', '#6b201c'); disc(-1.2, -rz + 0.65, 0.33, '#8c2f2a', '#6b201c');           // kidneys
  if (f > 0.1) { g.globalAlpha = Math.min(1, f * 1.4); disc(1.2, -rz + 0.65, 0.45, 'rgba(0,0,0,0)', '#f0bf3f'); disc(-1.2, -rz + 0.65, 0.45, 'rgba(0,0,0,0)', '#f0bf3f'); g.globalAlpha = 1; }
  disc(rx - 0.55, 0.15, 0.3, '#d98c66', '#a05c42'); disc(-rx + 0.55, 0.1, 0.3, '#d98c66', '#a05c42');             // colon
  setSeed(999);
  for (let i = 0; i < 9; i++) disc((rnd() - 0.5) * (rx * 1.1), 0.1 + (rnd() - 0.4) * 0.9, 0.15 + rnd() * 0.05, '#e29176', '#b06a52');   // bowel loops
  setSeed(1234);
  const n = Math.round(70 * f); g.globalAlpha = 0.95;
  for (let i = 0; i < n; i++) disc((rnd() - 0.5) * rx * 1.7, (rnd() - 0.35) * rz * 1.25, 0.1 + rnd() * 0.12 * (0.5 + f), i % 2 ? palette.sectionFatA : palette.sectionFatB, palette.sectionFatEdge);
  if (f > 0.05) { g.globalAlpha = Math.min(1, 0.4 + f); ellipse(g, S, cx, cy, W, Wz, bulge * 0.88, 0.16 + d); g.save(); g.clip(); g.fillStyle = '#eeb525'; g.fillRect(0, Zc(rz * 0.55 - 0.25 * f), w, (0.22 + 0.5 * f) * S); g.restore(); }
  g.globalAlpha = 1; tex.needsUpdate = true;
  plane.scale.set(w / S, h / S, 1);
}

export function setSection(on) {
  C.renderer.clippingPlanes = on ? [clipPlane] : [];
  plane.visible = on;
}

export function build(ctx) {
  C = ctx;
  clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), Y);
  canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 560;
  tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }); mat.toneMapped = false;
  plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  plane.rotation.x = -Math.PI / 2; plane.position.y = Y - 1e-3; plane.visible = false;
  ctx.scene.add(plane);
  ctx.anchors.clipPlane = clipPlane;
}
let lastKey = '';
/** redraw only when the live body changes (same cadence as the previous applyBody hook) */
export function update() {
  if (C.state.mode !== 'section') return;
  const b = C.state.body, key = `${C.state.fCur.toFixed(4)}|${b.W.toFixed(3)}|${b.Wz.toFixed(3)}|${b.d.toFixed(3)}|${b.bulge.toFixed(3)}`;
  if (key !== lastKey) { drawSection(); lastKey = key; }
}
