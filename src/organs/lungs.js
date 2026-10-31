// organs/lungs.js — five lung lobes (right upper / middle / lower, left upper+lingula / lower) separated by real
// fissure gaps, glossy pleura with an apex→base colour gradient and lobular surface texture, a two-domed diaphragm
// (central tendon + striated muscular periphery) that CONTRACTS AND FLATTENS on inspiration, and a close-up
// bronchial tree (lobar / segmental / subsegmental bronchi with pulmonary artery + vein branches).
//
// Breathing: phase = phys.breath (0 = end-expiration), chest expansion amplitude = phys.tidalDepth, diaphragm
// excursion = phys.diaphragmTravel. Visceral fat (f) pushes the RESTING diaphragm up (apex +0.35 units at f = 1)
// and the lung bases rise with it, so the lower lobes are visibly squeezed in an obese body.
//
// LAYERS: lungs + diaphragm are shared animated objects on LAYER.STATIC (0). Their fat dependence (resting dome
// height, excursion) is driven by state A (f, the slider). There is no static fat-dependent geometry in this module,
// hence no A/B copies: in the split view both halves show the A-driven lungs/diaphragm (documented limitation).
//
// Anchors published: lungs ([5 lobe meshes]), lungLobes ({RU,RM,RL,LU,LL}), diaphragm (Mesh), diaphragmY(x, z)
// (live height of the diaphragm surface), hilum ([right, left] fissure-convergence / scaling pivot points).
// Anchors consumed: heartPos / heartSurf / heartG / atriaG (heart.js) for the cardiac impression and notch.
// Picking keys: 'lungs' (lobes + bronchial tree), 'diaphragm' (card exists in ui/cards.js).
import { THREE, P, clamp, lerp, smooth, noise3, rnd, setSeed, vtube, add } from '../core/ctx.js';
import { palette, OrganMat, makeTex } from '../core/style.js';
import { heartPos, heartSurf } from './heart.js';

// (centralTendon colour merged into core/style.js palette)

/* ---------- tunables ---------- */
const H0 = 1.0, DH = 0.35, TRAVEL = 0.32;   // dome height: lean resting, + rise with fat, − inspiratory descent (× diaphragmTravel)
const H_REF = H0;                            // lobes are sculpted at this dome height; the vertex shader lifts the bases by (H − H_REF)·w
const BASE_GAP = 0.05, FISSURE_GAP = 0.055;  // lung base above the diaphragm; gap between lobes
const RIM_X = 2.45, RIM_ZF = 1.55;           // diaphragm rim (costal margin) ellipse
const THORAX = P(0, 1.85, 0), DETAIL_DIST = 14.5;
const LUNG_TOP = 3.62, LUNG_BOT = -0.4;
const OBL_A = 1.52, OBL_B = 0.88;            // oblique fissure: y = OBL_A − OBL_B·z (posterior-superior → anterior-inferior)
const HOR_Y = 1.93, HOR_SLOPE = 0.1;         // horizontal fissure (right): y = HOR_Y − HOR_SLOPE·(lat − 1.45)
const PIVOT_Z = (OBL_A - HOR_Y) / OBL_B;     // where both fissures meet (≈ −0.47): the hilum / scaling pivot

/* ---------- diaphragm height field: y = base(rim datum) + H · W(domes − pericardial depression) ---------- */
function rimZ(th) { const s = Math.abs(Math.sin(th)); return Math.cos(th) >= 0 ? RIM_ZF : lerp(1.12, 1.65, smooth(0, 0.6, s)); }
/** costal margin height: xiphoid 0.78 → Λ down to the lateral costal margin −0.75 → posterior attachments −0.9 */
function rimY(th) { const c = Math.cos(th); return c >= 0 ? lerp(-0.75, 0.78, Math.pow(c, 1.5)) : lerp(-0.75, -0.9, c * c); }
/** one dome (s = −1 right, +1 left): broad summit, steep sides (zone of apposition), 1 at the apex → 0 at its reach */
function domeB(x, z, s) {
  const dx = x - s * 1.35, dz = z + 0.1, lat = s * dx;
  const a = lerp(1.6, 1.3, smooth(-0.25, 0.25, lat)), b = lerp(1.45, 1.7, smooth(-0.25, 0.25, dz));
  const d2 = (dx / a) ** 2 + (dz / b) ** 2;
  return d2 >= 1 ? 0 : Math.pow(1 - Math.pow(d2, 1.5), 0.6);
}
/** polar coordinates of (x, z) inside the rim ellipse: th (0 = anterior), r (1 = rim) */
function polar(x, z) { const th = Math.atan2(x, z); return [th, Math.sqrt((x / RIM_X) ** 2 + (z / rimZ(th)) ** 2)]; }
/** both domes (right higher) smoothly joined, forced to 0 at the rim */
function domesB(x, z, r) {
  const bR = domeB(x, z, -1), bL = 0.85 * domeB(x, z, 1);
  return Math.pow(bR ** 6 + bL ** 6, 1 / 6) * (1 - Math.pow(Math.min(r, 1), 18));
}
/** pericardial depression: an ellipse along the heart's long axis (base postero-superior-right → apex antero-inferior-left) */
function dipF(x, z) {
  const u = ((x - 0.8) + (z - 0.7)) * 0.7071, w = ((z - 0.7) - (x - 0.8)) * 0.7071;
  return Math.exp(-(u * u) - (w / 0.55) ** 2) + 0.45 * Math.exp(-(((x + 0.3) / 0.45) ** 2) - ((z - 0.35) / 0.4) ** 2);   // + right atrium / IVC
}
/** W: the part of the height that scales with the dome height H, 0..1 */
const domeW = (x, z, r) => Math.max(0, domesB(x, z, r) - 0.55 * dipF(x, z));
const baseY = (th, r) => lerp(0.1, rimY(th), smooth(0.5, 1, Math.min(r, 1)));
function diaY(x, z, H) { const [th, r] = polar(x, z); return baseY(th, r) + H * domeW(x, z, r); }
/** reference lung-base floor (dome height H_REF); the lung never follows the diaphragm down into the costophrenic recess */
const floorY = (x, z) => Math.max(diaY(x, z, H_REF) + BASE_GAP, -0.2);

/* ---------- lung envelope: profile table (y, lateral centre, lateral radius, z centre, z radius) ---------- */
const PROF = [
  [-0.40, 1.45, 0.62, -0.16, 1.15], [0.10, 1.48, 0.84, -0.13, 1.30], [0.60, 1.50, 0.96, -0.11, 1.36],
  [1.10, 1.50, 0.97, -0.11, 1.34], [1.55, 1.45, 0.95, -0.12, 1.27], [1.95, 1.36, 0.88, -0.13, 1.15],
  [2.35, 1.22, 0.76, -0.14, 1.00], [2.75, 1.10, 0.62, -0.16, 0.80], [3.10, 1.02, 0.50, -0.18, 0.58],
  [3.40, 0.98, 0.38, -0.22, 0.42], [3.62, 0.95, 0.20, -0.25, 0.20],
];
function prof(y, col) {                       // Catmull-Rom sample of a profile column at height y
  const n = PROF.length;
  if (y <= PROF[0][0]) return PROF[0][col];
  if (y >= PROF[n - 1][0]) return PROF[n - 1][col];
  let s = 0; while (PROF[s + 1][0] < y) s++;
  const r = PROF[Math.max(0, s - 1)], o = PROF[s], a = PROF[s + 1], l = PROF[Math.min(n - 1, s + 2)];
  const c = a[0] - o[0], h = (y - o[0]) / c;
  const m0 = (a[col] - r[col]) / (a[0] - r[0]) * c, m1 = (l[col] - o[col]) / (l[0] - o[0]) * c;
  const h2 = h * h, h3 = h2 * h;
  return (2 * h3 - 3 * h2 + 1) * o[col] + (h3 - 2 * h2 + h) * m0 + (-2 * h3 + 3 * h2) * a[col] + (h3 - h2) * m1;
}

/* ---------- keep-outs: mediastinal vessels (world polylines, radius) and the rib cage (body.js parameters) ---------- */
const TRACHEA = { pts: [P(0, 5, 0.55), P(0, 4, 0.3), P(0, 3.1, 0)], r: 0.3 };
const CAPS_L = [
  { pts: [P(0.28, 2, 0.42), P(0.2, 2.8, 0.42), P(0.35, 3.35, 0.15), P(0.72, 3.3, -0.5), P(0.72, 2.8, -1), P(0.5, 1.5, -1.12), P(0.32, -0.6, -1.12)], r: 0.4 },  // aorta
  { pts: [P(0.66, 3.32, -0.3), P(1.3, 3.75, -0.25), P(2.3, 3.8, -0.1)], r: 0.17 },   // left subclavian artery (grooves the apex)
  { pts: [P(0.95, 3.3, 0.2), P(0.1, 2.98, 0.35)], r: 0.2 },                           // left brachiocephalic vein
  { pts: [P(0.14, 1.85, 1.02), P(0.25, 2.25, 0.78), P(0.42, 2.5, 0.4)], r: 0.3 },     // pulmonary trunk
  TRACHEA,
];
const CAPS_R = [
  { pts: [P(-0.37, 2.7, 0.42), P(-0.38, 2.2, 0.55), P(-0.37, 1.85, 0.62)], r: 0.3 },  // superior vena cava
  { pts: [P(-0.36, 1.35, 0.42), P(-0.4, 0.4, -0.3)], r: 0.3 },                         // inferior vena cava
  { pts: [P(-1.25, 3.35, 0.15), P(-0.6, 3, 0.32), P(-0.37, 2.72, 0.42)], r: 0.2 },    // right brachiocephalic vein
  { pts: [P(0.22, 3.3, 0.25), P(-0.15, 3.9, 0.35), P(-0.42, 4.6, 0.4)], r: 0.22 },    // brachiocephalic artery
  { pts: [P(0.28, 2, 0.42), P(0.2, 2.8, 0.42), P(0.35, 3.35, 0.15)], r: 0.38 },       // ascending aorta
  TRACHEA,
];
const RIBS = Array.from({ length: 10 }, (_, i) => ({ Y: 3.38 - i * 0.43, e: i === 0 ? 0.58 : i === 1 ? 0.78 : i === 2 ? 0.9 : 1, span: i < 7 ? Math.PI * 0.92 : Math.PI * (0.9 - (i - 6) * 0.11) }));

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _l = new THREE.Vector3();
function capsuleKeep(v, pts, R) {
  for (let i = 0; i + 1 < pts.length; i++) {
    _a.subVectors(pts[i + 1], pts[i]); _b.subVectors(v, pts[i]);
    const t = clamp(_b.dot(_a) / _a.lengthSq(), 0, 1);
    _a.multiplyScalar(t).add(pts[i]);                       // closest point on the segment
    const d = v.distanceTo(_a);
    if (d < R) { if (d < 1e-5) v.y += R; else v.sub(_a).multiplyScalar(R / d).add(_a); }
  }
}
let heartG, ATRIA = [];
/* radial extent of the heart surface per direction (heartShape is not a radial map, so sample it and bin by direction) */
const HR_TH = 96, HR_PH = 48; let heartR = null;
function buildHeartTable() {
  heartR = new Float32Array(HR_TH * HR_PH);
  const bin = (th, ph) => (((Math.round(th / (Math.PI * 2) * HR_TH) % HR_TH) + HR_TH) % HR_TH) * HR_PH + clamp(Math.round(ph / Math.PI * (HR_PH - 1)), 0, HR_PH - 1);
  for (let i = 0; i < 288; i++) for (let j = 0; j <= 144; j++) {
    const q = heartSurf(i / 288 * Math.PI * 2, j / 144 * Math.PI, 1), r = q.length(); if (r < 1e-6) continue;
    const k = bin(Math.atan2(q.x, q.z), Math.acos(clamp(q.y / r, -1, 1)));
    heartR[k] = Math.max(heartR[k], r);
  }
  for (let pass = 0; pass < 2; pass++) {                    // dilate (3×3 max) to fill empty bins conservatively
    const src = heartR.slice();
    for (let a = 0; a < HR_TH; a++) for (let b = 0; b < HR_PH; b++) {
      let m = src[a * HR_PH + b];
      for (let da = -1; da <= 1; da++) for (let db = -1; db <= 1; db++) m = Math.max(m, src[((a + da + HR_TH) % HR_TH) * HR_PH + clamp(b + db, 0, HR_PH - 1)]);
      heartR[a * HR_PH + b] = m;
    }
  }
  heartR.bin = bin;
}
/** cardiac impression / notch: keep the vertex outside the heart surface (+ coronaries, epicardial fat) and the atria.
 *  A push that would point downward is turned sideways: the heart rests on the diaphragm, the lung wraps around it. */
function heartKeep(v) {
  for (let it = 0; it < 6; it++) {
    heartG.worldToLocal(_l.copy(v));
    const r = _l.length(); if (r < 1e-6 || r > 2.3) return;
    const keep = (heartR[heartR.bin(Math.atan2(_l.x, _l.z), Math.acos(clamp(_l.y / r, -1, 1)))] || 1.3) * 1.04 + 0.3;
    let moved = false;
    if (r < keep) {
      heartG.localToWorld(_a.copy(_l).setLength(keep));
      if (_a.y < v.y - 0.03) { _b.set(v.x - heartPos.x, 0, v.z - heartPos.z); if (_b.lengthSq() < 1e-6) _b.set(1, 0, 0); v.addScaledVector(_b.normalize(), (keep - r) * 0.8 + 0.02); }
      else v.copy(_a);
      moved = true;
    } else {
      for (const a of ATRIA) { const d = _l.distanceTo(a.p); if (d < a.r) { _l.sub(a.p).setLength(a.r).add(a.p); moved = true; } }
      if (moved) v.copy(heartG.localToWorld(_l));
    }
    if (!moved) return;
  }
}
/** keep the vertex inside the rib cage: the inner ellipse interpolated between the rib wires above/below it */
const RHO = 0.85;                                           // leaves room for the rib tube (0.07) + chest expansion (≤ 0.05)
function ribClamp(v, s) {
  const lat = s * v.x, zz = v.z + 0.05;
  let above = null, below = null;
  for (const R of RIBS) {
    const X = 2.55 * R.e, Z = 1.68 * (0.85 * R.e + 0.15);
    const a = Math.atan2(Math.max(0, lat) / X, -zz / Z);
    if (a > R.span) continue;
    const w = R.Y + 0.28 * Math.cos(a) - 0.95 * a / Math.PI;
    if (w >= v.y) above = { w, e: R.e, a }; else { below = { w, e: R.e, a }; break; }
  }
  let e = 1;
  if (above && below) e = lerp(above.e, below.e, (above.w - v.y) / Math.max(1e-3, above.w - below.w));
  else if (!above && below) {                              // above the 1st rib wire: tight at the wire, looser well above its anterior part
    const relax = lerp(below.e, 0.92, smooth(1.2, 2.3, below.a));
    e = lerp(below.e, relax, smooth(0.05, 0.45, v.y - below.w));
  }
  const X = 2.55 * e, Z = 1.68 * (0.85 * e + 0.15), rho = Math.sqrt((lat / X) ** 2 + (zz / Z) ** 2);
  if (rho > RHO) { const k = (RHO + (rho - RHO) * 0.2) / rho; v.x = s * lat * k; v.z = zz * k - 0.05; }
}
function envelope(v, s) {
  const lat = s * v.x;
  if (lat < 0.6) v.x = s * (0.6 - (0.6 - lat) * 0.12);     // flattened mediastinal face
  heartKeep(v);
  for (const c of (s < 0 ? CAPS_R : CAPS_L)) capsuleKeep(v, c.pts, c.r + 0.04);
  ribClamp(v, s);
}
/** unit-sphere vertex → whole-lung envelope in world coordinates */
function sculpt(v, s) {
  const y = lerp(LUNG_BOT, LUNG_TOP, (v.y + 1) / 2), hr = Math.sqrt(Math.max(0, 1 - v.y * v.y));
  const dx = hr > 1e-6 ? v.x / hr : 0, dz = hr > 1e-6 ? v.z / hr : 0;
  const g = v.y > 0.5 ? Math.sqrt(Math.max(0, 1 - ((v.y - 0.5) / 0.5) ** 2)) : v.y < -0.7 ? Math.sqrt(Math.max(0, 1 - ((v.y + 0.7) / 0.3) ** 2)) : 1;
  v.set(s * (prof(y, 1) + prof(y, 2) * g * dx), y, prof(y, 3) + prof(y, 4) * g * dz);
  const n = 0.014 * noise3(v.x * 3.3, v.y * 3.3, v.z * 3.3) + 0.006 * noise3(v.x * 9, v.y * 9, v.z * 9);
  v.x += (v.x - s * 1.4) * n; v.z += (v.z + 0.1) * n;
}
const floorClamp = (v) => { const fy = floorY(v.x, v.z); if (v.y < fy) v.y = fy; };

/* ---------- fissures: signed distances (positive = above) and per-lobe half-space clamps ---------- */
const NO = Math.sqrt(1 + OBL_B * OBL_B);
const dObl = (v) => (v.y - (OBL_A - OBL_B * v.z)) / NO;
const dHor = (v, s) => (v.y - (HOR_Y - HOR_SLOPE * (s * v.x - 1.45))) / Math.sqrt(1 + HOR_SLOPE * HOR_SLOPE);
/** move v to the required side of the oblique (sign so) / horizontal (sign sh, right lung only) fissures; returns true if moved */
function fissureClamp(v, s, so, sh) {
  let moved = false;
  const g = FISSURE_GAP / 2;
  if (so) { const d = dObl(v); if (so * d < g) { const k = g * so - d; v.y += k / NO; v.z += k * OBL_B / NO; moved = true; } }
  if (sh) { const d = dHor(v, s); if (sh * d < g) { const k = g * sh - d, nn = Math.sqrt(1 + HOR_SLOPE * HOR_SLOPE); v.y += k / nn; v.x += s * k * HOR_SLOPE / nn; moved = true; } }
  return moved;
}

/* ---------- lobe geometry ---------- */
const LOBES = [
  { key: 'RU', s: -1, so: +1, sh: +1, amp: 0.04 }, { key: 'RM', s: -1, so: +1, sh: -1, amp: 0.035 }, { key: 'RL', s: -1, so: -1, sh: 0, amp: 0.025 },
  { key: 'LU', s: +1, so: +1, sh: 0, amp: 0.04 }, { key: 'LL', s: +1, so: -1, sh: 0, amp: 0.025 },
];
const cApex = new THREE.Color(palette.lungApex), cBase = new THREE.Color(palette.lungBase), cFis = new THREE.Color(palette.fissure);
function lobeGeo(L, pivot) {
  const geo = new THREE.SphereGeometry(1, 80, 60);
  const pos = geo.attributes.position, n = pos.count, v = new THREE.Vector3();
  const col = new Float32Array(n * 3), aBase = new Float32Array(n), c = new THREE.Color();
  const hilum = P(L.s * 0.62, 2.2, -0.25);
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i);
    sculpt(v, L.s);
    /* alternate envelope / floor / fissure projection until all hold; the envelope has the LAST word (the fissure
       planes and the floor cut through the heart's keep-out volume, so "outside the heart" must win over "on the plane") */
    let onFis = false;
    for (let k = 0; k < 10; k++) { envelope(v, L.s); floorClamp(v); if (!fissureClamp(v, L.s, L.so, L.sh)) break; onFis = true; }
    envelope(v, L.s);
    /* colours: lighter apex → darker base, lobular mottling, darker fissure faces and hilum */
    c.copy(cBase).lerp(cApex, smooth(0.6, 3.9, v.y)).multiplyScalar(0.9 + 0.07 * noise3(v.x * 6, v.y * 6, v.z * 6));
    if (onFis) c.lerp(cFis, 0.5);
    c.lerp(cFis, 0.3 * smooth(0.7, 0.15, v.distanceTo(hilum)));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    /* base-lift weight: dome field × fade with height above the diaphragm (same field for every lobe → no drift) */
    const [, r] = polar(v.x, v.z);
    aBase[i] = domeW(v.x, v.z, r) * clamp(1 - (v.y - floorY(v.x, v.z)) / 1.5, 0, 1);
    pos.setXYZ(i, v.x - pivot.x, v.y - pivot.y, v.z - pivot.z);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aBase', new THREE.BufferAttribute(aBase, 1));
  geo.computeVertexNormals(); geo.computeBoundingSphere(); geo.boundingSphere.radius += 0.5;
  return geo;
}

/* ---------- lobular (secondary lobule) surface texture: greyscale Voronoi, used as map + bump ---------- */
function lobuleTex() {
  setSeed(7071);
  const N = 56, cells = Array.from({ length: N }, () => [rnd(), rnd(), 0.9 + 0.1 * rnd()]);
  const t = makeTex(256, (g, s) => {
    const img = g.createImageData(s, s), d = img.data;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      let d1 = 9, d2 = 9, c1 = 0; const px = x / s, py = y / s;
      for (let k = 0; k < N; k++) {
        let dx = Math.abs(px - cells[k][0]); dx = Math.min(dx, 1 - dx); let dy = Math.abs(py - cells[k][1]); dy = Math.min(dy, 1 - dy);
        const dd = dx * dx + dy * dy; if (dd < d1) { d2 = d1; d1 = dd; c1 = k; } else if (dd < d2) d2 = dd;
      }
      const edge = Math.sqrt(d2) - Math.sqrt(d1);
      const val = Math.round(255 * cells[c1][2] * (0.62 + 0.38 * smooth(0, 0.045, edge)));
      const o = (y * s + x) * 4; d[o] = d[o + 1] = d[o + 2] = val; d[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, 1);
  t.repeat.set(5, 3);
  return t;
}

/* ---------- diaphragm mesh (polar grid heightfield, deformed every frame) ---------- */
const DR = 34, DS = 80;
let diaGeo, diaBase, diaW, diaCount;
function buildDiaphragm() {
  diaCount = (DR + 1) * DS;
  const pos = new Float32Array(diaCount * 3), col = new Float32Array(diaCount * 3), uv = new Float32Array(diaCount * 2);
  diaBase = new Float32Array(diaCount); diaW = new Float32Array(diaCount);
  const cMus = new THREE.Color(palette.diaphragm), cTen = new THREE.Color(palette.centralTendon), c = new THREE.Color();
  for (let i = 0; i <= DR; i++) {
    const r = Math.pow(i / DR, 0.85);
    for (let j = 0; j < DS; j++) {
      const th = j / DS * Math.PI * 2, k = i * DS + j;
      /* place by TRUE angle so polar(x, z) returns exactly (th, r): the mesh is then precisely diaY(x, z) */
      const rho = 1 / Math.sqrt((Math.sin(th) / RIM_X) ** 2 + (Math.cos(th) / rimZ(th)) ** 2);
      const x = rho * r * Math.sin(th), z = rho * r * Math.cos(th);
      pos[k * 3] = x; pos[k * 3 + 2] = z; uv[k * 2] = r; uv[k * 2 + 1] = th / Math.PI / 2;
      diaBase[k] = baseY(th, r); diaW[k] = domeW(x, z, r);
      /* central tendon: dome summits + the central strip + the pericardial area; muscle: radial striations */
      const B = domesB(x, z, r);
      const tendon = 0.72 * Math.max(smooth(0.72, 0.9, B), smooth(0.5, 0.25, Math.abs(x)) * smooth(-1.05, -0.7, z) * smooth(1, 0.8, r), smooth(0.4, 0.8, dipF(x, z)));
      const stripe = 0.5 + 0.5 * Math.sin(th * 20 + r * 3);
      c.copy(cMus).multiplyScalar(0.9 + 0.14 * stripe * (1 - tendon) + 0.03 * noise3(x * 5, z * 5, 1)).lerp(cTen, tendon);
      col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
    }
  }
  const idx = [];
  for (let i = 0; i < DR; i++) for (let j = 0; j < DS; j++) {
    const a = i * DS + j, b = i * DS + (j + 1) % DS, cc = a + DS, d = b + DS;
    if (i > 0) idx.push(a, cc, b); idx.push(b, cc, d);
  }
  diaGeo = new THREE.BufferGeometry();
  diaGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  diaGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  diaGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  diaGeo.setIndex(idx);
  layDiaphragm(H0);
}
function layDiaphragm(H) {
  const pos = diaGeo.attributes.position;
  for (let k = 0; k < diaCount; k++) pos.array[k * 3 + 1] = diaBase[k] + H * diaW[k];
  pos.needsUpdate = true; diaGeo.computeVertexNormals(); diaGeo.computeBoundingSphere();
}

/* ---------- bronchial tree + pulmonary vessels (close-up detail) ---------- */
function clampInside(p, s) {
  const y = clamp(p.y, 0.35, 3.3), lat = clamp(s * p.x, 0.7, prof(y, 1) + prof(y, 2) - 0.15);
  p.set(s * lat, y, clamp(p.z, prof(y, 3) - prof(y, 4) + 0.15, prof(y, 3) + prof(y, 4) - 0.15));
  return p;
}
function buildTree(s, group, bronMat, artMat, veinMat) {
  const E = s < 0 ? P(-1.2, 2.3, -0.2) : P(1.3, 2.35, -0.25);             // main bronchus end (airway.js)
  const A = s < 0 ? P(-0.85, 2.3, 0) : P(1.5, 2.3, -0.1);                 // pulmonary artery branch end (vessels.js)
  const V = s < 0 ? P(-0.75, 2, -0.05) : P(1.5, 2, 0);                    // pulmonary vein start (vessels.js)
  const lobar = [
    { mid: P(s * 1.3, 2.75, -0.3), to: P(s * 1.28, 3.15, -0.35), r: 0.085, dirs: [P(0, 1, 0.1), P(s * 0.5, 0.6, 0.7), P(s * 0.4, 0.5, -0.8)] },
    { mid: P(s * 1.5, 1.95, 0.35), to: P(s * 1.72, 1.55, 0.78), r: s < 0 ? 0.075 : 0.06, dirs: [P(s * 0.7, -0.3, 0.6), P(s * 0.2, -0.5, 0.8), P(s * 0.9, 0.1, 0.3)] },
    { mid: P(s * 1.5, 1.65, -0.5), to: P(s * 1.72, 1.0, -0.75), r: 0.09, dirs: [P(s * 0.9, -0.3, 0.2), P(s * 0.3, -0.5, -0.8), P(s * 0.6, -0.7, 0.5)] },
  ];
  const tube = (pts, r0, r1, segs, rad, mat) => { const m = add(vtube(pts, (u) => lerp(r0, r1, u), segs, rad, 0.5), mat, group, 'lungs'); m.frustumCulled = false; return m; };
  for (const L of lobar) {
    tube([E, L.mid, L.to], L.r, L.r * 0.65, 24, 10, bronMat);
    tube([A, L.mid.clone().add(P(0, 0.13, -0.1)), L.to.clone().add(P(0, 0.12, -0.1))], 0.065, 0.04, 20, 8, artMat);
    L.dirs.forEach((d, i) => {
      const dir = d.clone().normalize();
      const p1 = clampInside(L.to.clone().add(dir.clone().multiplyScalar(0.3 + 0.08 * rnd())), s);
      const p2 = clampInside(p1.clone().add(dir.clone().multiplyScalar(0.4 + 0.15 * rnd())).add(P((rnd() - 0.5) * 0.2, (rnd() - 0.5) * 0.2, (rnd() - 0.5) * 0.2)), s);
      tube([L.to, p1, p2], 0.05, 0.03, 16, 8, bronMat);
      for (let k = 0; k < 2; k++) {
        const q = dir.clone().add(P((rnd() - 0.5) * 1.4, (rnd() - 0.5) * 1.4, (rnd() - 0.5) * 1.4)).normalize();
        const p3 = clampInside(p2.clone().add(q.multiplyScalar(0.3 + 0.12 * rnd())), s);
        tube([p2, p3], 0.03, 0.015, 10, 6, bronMat);
      }
    });
  }
  tube([V, P(s * 1.25, 2.1, 0.25), lobar[0].to.clone().add(P(0, -0.15, 0.15))], 0.05, 0.03, 20, 8, veinMat);
  tube([V, P(s * 1.3, 1.75, 0.05), lobar[2].to.clone().add(P(0, 0.15, 0.2))], 0.055, 0.03, 20, 8, veinMat);
}

/* ---------- module state ---------- */
let C, lungMat, diaMat, bronMat, artMat, veinMat, diaphragm, detail, lungShader = null;
const lobes = [], lobeByKey = {};
let lastT = 0, lastH = -1, curH = H0;

export function build(ctx) {
  C = ctx;
  heartG = ctx.anchors.heartG; heartG.updateWorldMatrix(true, false); buildHeartTable();
  ATRIA = ctx.anchors.atriaG.children.map((m) => ({ p: m.position.clone(), r: Math.max(m.scale.x, m.scale.y, m.scale.z) + 0.2 }));
  const G = ctx.groups.lungs;

  /* pleura: glossy, translucent, vertex-coloured, lobular texture; bases lifted by the diaphragm in the vertex shader */
  const tex = lobuleTex();
  lungMat = OrganMat(palette.white, {
    vertexColors: true, map: tex, bumpMap: tex, bumpScale: 0.6, roughness: 0.3, clearcoat: 0.9, clearcoatRoughness: 0.18,
    sheen: 0.35, sheenRoughness: 0.45, sheenColor: new THREE.Color(palette.pleura), emissive: new THREE.Color(palette.lung), emissiveIntensity: 0.03,
    transparent: true, opacity: 0.5, depthWrite: false,
  });
  lungMat.onBeforeCompile = (sh) => {
    sh.uniforms.uLift = { value: curH - H_REF }; lungShader = sh;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aBase; uniform float uLift;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y += aBase * uLift;');
  };
  lungMat.customProgramCacheKey = () => 'lungLift';
  for (const L of LOBES) {
    const pivot = P(L.s * 1.45, HOR_Y, PIVOT_Z);
    const m = add(lobeGeo(L, pivot), lungMat, G, 'lungs');
    m.position.copy(pivot); m.name = 'lung_' + L.key; m.userData.lobe = L.key;
    lobes.push({ mesh: m, amp: L.amp }); lobeByKey[L.key] = m;
  }

  /* diaphragm */
  buildDiaphragm();
  diaMat = OrganMat(palette.white, { vertexColors: true, roughness: 0.42, clearcoat: 0.55, clearcoatRoughness: 0.3, sheen: 0.4, sheenColor: new THREE.Color(palette.lungSheen),
    emissive: new THREE.Color(palette.diaphragm), emissiveIntensity: 0.05, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, bumpScale: 0.3 });
  diaphragm = add(diaGeo, diaMat, G, 'diaphragm'); diaphragm.name = 'diaphragm'; diaphragm.frustumCulled = false;

  /* close-up detail: bronchial tree + pulmonary vessels */
  detail = new THREE.Group(); detail.name = 'lungDetail'; G.add(detail); detail.renderOrder = -1;
  bronMat = OrganMat(palette.bronchusWall, { roughness: 0.45, clearcoat: 0.5, sheen: 0.3, transparent: true, opacity: 0.85, depthWrite: false, bumpScale: 0.2 });
  artMat = OrganMat(palette.pulmArtery, { roughness: 0.32, clearcoat: 0.85, transparent: true, opacity: 0.85, depthWrite: false, bumpScale: 0.2 });
  veinMat = OrganMat(palette.pulmVein, { roughness: 0.34, clearcoat: 0.8, transparent: true, opacity: 0.85, depthWrite: false, bumpScale: 0.2 });
  setSeed(7072);
  buildTree(-1, detail, bronMat, artMat, veinMat); buildTree(1, detail, bronMat, artMat, veinMat);
  detail.traverse((m) => { if (m.isMesh) m.renderOrder = -1; });

  Object.assign(ctx.anchors, {
    lungs: lobes.map((l) => l.mesh), lungLobes: lobeByKey, diaphragm,
    diaphragmY: (x, z) => diaY(x, z, curH), hilum: [P(-1.45, HOR_Y, PIVOT_Z), P(1.45, HOR_Y, PIVOT_Z)],
  });
}

export function update(f, t, phys) {
  const c = clamp(phys.breath ?? 0, 0, 1), T = clamp(phys.tidalDepth ?? 1, 0, 1), D = clamp(phys.diaphragmTravel ?? 1, 0, 1);
  /* dome height: lean rest + rise with visceral fat − inspiratory descent (× excursion) */
  curH = H0 + DH * clamp(f, 0, 1) - TRAVEL * D * c;
  /* chest expansion: lobes scale about the hilum (fissure planes stay invariant), amplitude from tidal depth */
  const A = (0.35 + 0.65 * T) * c;
  for (const L of lobes) { const k = 1 + L.amp * A; L.mesh.scale.set(1 + 0.85 * (k - 1), k, k); }
  if (lungShader) lungShader.uniforms.uLift.value = curH - H_REF;
  /* diaphragm contracts and flattens; the viscera follow its actual travel */
  if (Math.abs(curH - lastH) > 2e-4) { layDiaphragm(curH); lastH = curH; }
  C.groups.abdomen.position.y = -0.75 * TRAVEL * D * c;
  /* opacity easing toward the view's target; detail only when close */
  const dt = Math.min(Math.max(t - lastT, 0), 0.4); lastT = t;
  const k = 1 - Math.exp(-dt * 3.2), target = C.state.opTarget ? C.state.opTarget.lung : 0.5;
  lungMat.opacity = lerp(lungMat.opacity, target, k);
  diaMat.opacity = clamp(lungMat.opacity * 1.0, 0.08, 0.55);
  const dop = clamp(lungMat.opacity * 1.7, 0.1, 0.9);
  bronMat.opacity = artMat.opacity = veinMat.opacity = dop;
  detail.visible = C.camera.position.distanceTo(THORAX) < DETAIL_DIST;
}
