// organs/lungs.js — five lung lobes (right upper / middle / lower, left upper+lingula / lower) separated by real
// fissure gaps, glossy pleura with an apex→base colour gradient, lobular surface texture and a fresnel rim (lobe
// outlines read even at high opacity), a two-domed diaphragm (central tendon + striated muscular periphery) that
// CONTRACTS AND FLATTENS on inspiration and RESTS ON THE REAL ORGANS BELOW IT, and close-up lobar pulmonary arteries
// and veins (the bronchial tree itself is built by organs/airway.js — this module no longer duplicates it).
//
// Diaphragm = designed two-dome field  D(x, z) = base(rim datum) + H · W(domes − pericardial depression)
//   lifted onto the abdominal organs:   F = D + softplus(U(x, z) + abdomen.y + gap − D) · rimFade
//   kept under the heart:               F = F − softplus(F − (Hc(x, z) − gap))
// U (abdominal organ top, abdomen-local) and Hc (heart + epicardial fat bottom) are height maps sampled from the
// neighbours' real meshes at the first frame (they are built after the lungs) and re-sampled when f changes, so the
// right dome sits on the liver convexity, the left dome over the stomach / spleen, and nothing pokes through.
//
// Breathing: shape = phys.breath / phys.tidalDepth (0 = end-expiration), chest expansion = tidalDepth (low-passed),
// dome descent = TRAVEL · diaphragmTravel · tidalDepth · shape. The abdominal viscera (ctx.groups.abdomen) follow the
// dome (BOB × its descent) and are pushed up by visceral fat (RISE_ABD · (f − F_REF)): the fat-laden abdomen lifts
// the liver and the domes resting on it, so the lower lobes are visibly squeezed and move less in an obese body.
// The lung bases follow the diaphragm everywhere through a small lift texture sampled in the vertex shader
// (lung base target − sculpt floor, per (x, z) cell, updated per frame); vertex-texture-less devices keep static bases.
//
// LAYERS: lobes and diaphragm exist twice — A (layer 1, slider f, live physiology) and B (layer 2, ctx.state.fB,
// "today" breathing amplitude / excursion from phys.today). The lobe geometry is shared (the lift lives in the
// material), the B diaphragm is relaid only in the split view. The abdomen group is shared, so the B half uses the
// A position of the viscera (documented limitation). Pulmonary vessels are static (layer 0).
//
// Anchors published: lungs ([5 A lobe meshes]), lungLobes ({RU,RM,RL,LU,LL} A), lungsB ([5 B lobe meshes]),
// diaphragm (A Mesh), diaphragmB (B Mesh), diaphragmY(x, z) (live height of the A diaphragm surface, organ fit
// included), hilum ([right, left] fissure-convergence / scaling pivot points).
// Anchors consumed: heartPos / heartSurf / heartG / atriaG (heart.js) for the cardiac impression and notch; at the
// first frame every mesh under groups.abdomen (organ floor) and groups.heart + key 'epifat' (ceiling).
// Picking keys: 'lungs' (lobes + pulmonary vessels), 'diaphragm' (card exists in ui/cards.js).
// Performance: ~48k triangles of lobes + 5.5k diaphragm per drawn layer + ~6k vessels (close-up only).
// ctx.state.perf: 2 = everything; 1 = vessels only when close (default); 0 = no vessels, no B relay.
import { THREE, P, clamp, lerp, smooth, noise3, rnd, setSeed, vtube, add, LAYER } from '../core/ctx.js';
import { palette, OrganMat, makeTex } from '../core/style.js';
import { heartPos, heartSurf } from './heart.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* ---------- tunables ---------- */
const H0 = 0.42, DH = 0.28;                  // designed dome height at rest: lean + rise with fat (× W ≤ 1)
const TRAVEL = 0.4;                          // inspiratory dome descent at diaphragmTravel = tidalDepth = 1 (≈ 2.3 cm)
const BOB = 0.85;                            // the viscera follow the dome (the liver is attached to it)
const RISE_ABD = 0.2, F_REF = 0.6;           // fat pushes the viscera up: abdomen.y += RISE_ABD · (f − F_REF)
const H_REF = H0 + DH * F_REF;               // lobes are sculpted against the designed dome at this height
const BASE_GAP = 0.05, GAP_U = 0.04, GAP_H = 0.07, FLOOR_MIN = -0.2, SP_E = 0.08;
const RIM_X = 2.45, RIM_ZF = 1.55;           // diaphragm rim (costal margin) ellipse
const THORAX = P(0, 1.85, 0), DETAIL_DIST = 14.5;
const LUNG_TOP = 3.62, LUNG_BOT = -0.4;
const OBL_A = 1.52, OBL_B = 0.88;            // oblique fissure: y = OBL_A − OBL_B·z (posterior-superior → anterior-inferior)
const HOR_Y = 1.93, HOR_SLOPE = 0.1;         // horizontal fissure (right): y = HOR_Y − HOR_SLOPE·(lat − 1.45)
const PIVOT_Z = (OBL_A - HOR_Y) / OBL_B;     // where both fissures meet (≈ −0.47): the hilum / scaling pivot
/** smooth max(0, e) (hyperbolic softplus): 0 far below, e far above, SP_E/2 at 0 */
const sp = (e) => 0.5 * (e + Math.sqrt(e * e + SP_E * SP_E));

/* ---------- designed diaphragm field: y = base(rim datum) + H · W(domes − pericardial depression) ---------- */
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
const domeW = (x, z, r) => Math.max(0, domesB(x, z, r) - 0.55 * dipF(x, z));
const baseY = (th, r) => lerp(0.1, rimY(th), smooth(0.5, 1, Math.min(r, 1)));
/** organ influence fades out in the last 3.5 % of the radius: the costal attachment stays where it is */
const rimK = (r) => 1 - smooth(0.965, 1.0, r);
function designed(x, z, H) { const [th, r] = polar(x, z); return baseY(th, r) + H * domeW(x, z, r); }
/** lung-base target above a diaphragm height F: never deeper than FLOOR_MIN (costophrenic recess stays air-free) */
const baseOf = (F) => FLOOR_MIN + sp(F + BASE_GAP - FLOOR_MIN);
/** sculpt floor of the lobes (designed dome at H_REF, no organs): the lift texture is relative to this */
const floorRef = (x, z) => baseOf(designed(x, z, H_REF));
/** the full diaphragm height from its parts (d = designed, u = organ floor abdomen-local, hc = heart ceiling) */
function fitF(d, rk, u, hc, abdY) {
  const F = d + sp(u + abdY + GAP_U - d) * rk;
  return F - sp(F - (hc - GAP_H));
}

/* ---------- organ height maps on a regular (x, z) grid (also the lift texture) ---------- */
const GX0 = -2.75, GZ0 = -2.05, GD = 0.1, GNX = 56, GNZ = 42, GN = GNX * GNZ;
const U_EMPTY = -3, HC_EMPTY = 6;
const LIFT_MIN = -0.8, LIFT_RANGE = 2.0;
function gridAt(arr, x, z) {                  // bilinear sample at a world (x, z)
  const fx = clamp((x - GX0) / GD, 0, GNX - 1.001), fz = clamp((z - GZ0) / GD, 0, GNZ - 1.001);
  const i = Math.floor(fx), j = Math.floor(fz), a = fx - i, b = fz - j, k = j * GNX + i;
  return lerp(lerp(arr[k], arr[k + 1], a), lerp(arr[k + GNX], arr[k + GNX + 1], a), b);
}
const _v = new THREE.Vector3(), _m4 = new THREE.Matrix4(), _s = new THREE.Vector3(), _q = new THREE.Quaternion(), _c = new THREE.Vector3();
function binPut(arr, x, z, y, isMax, r) {
  const i0 = Math.max(0, Math.round((x - r - GX0) / GD)), i1 = Math.min(GNX - 1, Math.round((x + r - GX0) / GD));
  const j0 = Math.max(0, Math.round((z - r - GZ0) / GD)), j1 = Math.min(GNZ - 1, Math.round((z + r - GZ0) / GD));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = j * GNX + i; arr[k] = isMax ? Math.max(arr[k], y) : Math.min(arr[k], y); }
}
/** raw per-cell max (floor) / min (ceiling) height of the given meshes; yOff = abdomen.y at scan time for the floor */
function scan(arr, meshes, isMax, yOff) {
  for (const o of meshes) {
    o.updateWorldMatrix(true, false);
    const g = o.geometry;
    if (o.isInstancedMesh) {
      if (!g.boundingSphere) g.computeBoundingSphere();
      const bs = g.boundingSphere;
      for (let k = 0; k < o.count; k++) {
        o.getMatrixAt(k, _m4); _m4.premultiply(o.matrixWorld); _m4.decompose(_c, _q, _s);
        const r = bs.radius * Math.max(_s.x, _s.y, _s.z); if (r < 1e-3) continue;          // parked / hidden instance
        _v.copy(bs.center).applyMatrix4(_m4);
        binPut(arr, _v.x, _v.z, (isMax ? _v.y + 0.85 * r : _v.y - 0.85 * r) - yOff, isMax, 0.6 * r);
      }
    } else {
      const pos = g.attributes.position, step = Math.max(1, Math.floor(pos.count / 12000));
      for (let k = 0; k < pos.count; k += step) { _v.fromBufferAttribute(pos, k).applyMatrix4(o.matrixWorld); binPut(arr, _v.x, _v.z, _v.y - yOff, isMax, 0); }
    }
  }
}
/** conservative smoothing: dilate (floor) / erode (ceiling) one cell, 3×3 blur, never past the raw organ surface */
function finish(raw, isMax) {
  const ext = isMax ? Math.max : Math.min, d = new Float32Array(GN), out = new Float32Array(GN);
  for (let j = 0; j < GNZ; j++) for (let i = 0; i < GNX; i++) {
    let m = raw[j * GNX + i];
    for (let b = Math.max(0, j - 1); b <= Math.min(GNZ - 1, j + 1); b++) for (let a = Math.max(0, i - 1); a <= Math.min(GNX - 1, i + 1); a++) m = ext(m, raw[b * GNX + a]);
    d[j * GNX + i] = m;
  }
  for (let j = 0; j < GNZ; j++) for (let i = 0; i < GNX; i++) {
    let s = 0, n = 0;
    for (let b = Math.max(0, j - 1); b <= Math.min(GNZ - 1, j + 1); b++) for (let a = Math.max(0, i - 1); a <= Math.min(GNX - 1, i + 1); a++) { s += d[b * GNX + a]; n++; }
    out[j * GNX + i] = ext(s / n, raw[j * GNX + i]);
  }
  return out;
}

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
/** anterior arc of the small first rib (body.js wire, e = 0.58): it dips to y ≈ 2.25 in front of the lung apex, so the
 *  rib-cage ellipse alone lets the expanding apex graze it; a keep-out with room for the inspiratory expansion */
function firstRib(s) {
  return { pts: [1.4, 1.8, 2.2, 2.6, 2.89].map((a) => P(s * 1.479 * Math.sin(a), 3.38 + 0.28 * Math.cos(a) - 0.95 * a / Math.PI, -1.08 * Math.cos(a) - 0.05)), r: 0.09 };
}
const CAPS_L = [
  { pts: [P(0.28, 2, 0.42), P(0.2, 2.8, 0.42), P(0.35, 3.35, 0.15), P(0.72, 3.3, -0.5), P(0.72, 2.8, -1), P(0.5, 1.5, -1.12), P(0.32, -0.6, -1.12)], r: 0.4 },  // aorta
  { pts: [P(0.66, 3.32, -0.3), P(1.3, 3.75, -0.25), P(2.3, 3.8, -0.1)], r: 0.17 },   // left subclavian artery (grooves the apex)
  { pts: [P(0.95, 3.3, 0.2), P(0.1, 2.98, 0.35)], r: 0.2 },                           // left brachiocephalic vein
  { pts: [P(0.14, 1.85, 1.02), P(0.25, 2.25, 0.78), P(0.42, 2.5, 0.4)], r: 0.3 },     // pulmonary trunk
  TRACHEA, firstRib(1),
];
const CAPS_R = [
  { pts: [P(-0.37, 2.7, 0.42), P(-0.38, 2.2, 0.55), P(-0.37, 1.85, 0.62)], r: 0.3 },  // superior vena cava
  { pts: [P(-0.36, 1.35, 0.42), P(-0.4, 0.4, -0.3)], r: 0.3 },                         // inferior vena cava
  { pts: [P(-1.25, 3.35, 0.15), P(-0.6, 3, 0.32), P(-0.37, 2.72, 0.42)], r: 0.2 },    // right brachiocephalic vein
  { pts: [P(0.22, 3.3, 0.25), P(-0.15, 3.9, 0.35), P(-0.42, 4.6, 0.4)], r: 0.22 },    // brachiocephalic artery
  { pts: [P(0.28, 2, 0.42), P(0.2, 2.8, 0.42), P(0.35, 3.35, 0.15)], r: 0.38 },       // ascending aorta
  TRACHEA, firstRib(-1),
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
    const keep = (heartR[heartR.bin(Math.atan2(_l.x, _l.z), Math.acos(clamp(_l.y / r, -1, 1)))] || 1.3) * 1.04 + 0.33;   // + epicardial fat at f = 1
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
const floorClamp = (v) => { const fy = floorRef(v.x, v.z); if (v.y < fy) v.y = fy; };

/* ---------- fissures: signed distances (positive = above) and per-lobe half-space clamps ---------- */
const NO = Math.sqrt(1 + OBL_B * OBL_B);
const dObl = (v) => (v.y - (OBL_A - OBL_B * v.z)) / NO;
const dHor = (v, s) => (v.y - (HOR_Y - HOR_SLOPE * (s * v.x - 1.45))) / Math.sqrt(1 + HOR_SLOPE * HOR_SLOPE);
/** move v to the required side of the oblique (sign so) / horizontal (sign sh, right lung only) fissures; returns true if moved */
function fissureClamp(v, s, so, sh) {
  let moved = false;
  const g = 0.0275;                                         // half the fissure gap (0.055)
  if (so) { const d = dObl(v); if (so * d < g) { const k = g * so - d; v.y += k / NO; v.z += k * OBL_B / NO; moved = true; } }
  if (sh) { const d = dHor(v, s); if (sh * d < g) { const k = g * sh - d, nn = Math.sqrt(1 + HOR_SLOPE * HOR_SLOPE); v.y += k / nn; v.x += s * k * HOR_SLOPE / nn; moved = true; } }
  return moved;
}

/* ---------- lobe geometry ---------- */
const LOBES = [
  { key: 'RU', s: -1, so: +1, sh: +1, amp: 0.04 }, { key: 'RM', s: -1, so: +1, sh: -1, amp: 0.035 }, { key: 'RL', s: -1, so: -1, sh: 0, amp: 0.022 },
  { key: 'LU', s: +1, so: +1, sh: 0, amp: 0.04 }, { key: 'LL', s: +1, so: -1, sh: 0, amp: 0.022 },
];
const cApex = new THREE.Color(palette.lungApex), cBase = new THREE.Color(palette.lungBase), cFis = new THREE.Color(palette.fissure);
function lobeGeo(L, pivot) {
  const geo = new THREE.SphereGeometry(1, 80, 60);
  const pos = geo.attributes.position, n = pos.count, v = new THREE.Vector3();
  const col = new Float32Array(n * 3), aXZ = new Float32Array(n * 2), aW = new Float32Array(n), c = new THREE.Color();
  const hilum = P(L.s * 0.62, 2.2, -0.25);
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i);
    sculpt(v, L.s);
    /* alternate envelope / floor / fissure projection until all hold; the envelope has the LAST word (the fissure
       planes and the floor cut through the heart's keep-out volume, so "outside the heart" must win over "on the plane") */
    let onFis = false;
    for (let k = 0; k < 10; k++) { envelope(v, L.s); floorClamp(v); if (!fissureClamp(v, L.s, L.so, L.sh)) break; onFis = true; }
    envelope(v, L.s); floorClamp(v);                       // the heart push may not take the base under the diaphragm
    /* colours: lighter apex → darker base, lobular mottling, darker fissure faces and hilum */
    c.copy(cBase).lerp(cApex, smooth(0.6, 3.9, v.y)).multiplyScalar(0.88 + 0.08 * noise3(v.x * 6, v.y * 6, v.z * 6));
    if (onFis) c.lerp(cFis, 0.55);
    c.lerp(cFis, 0.3 * smooth(0.7, 0.15, v.distanceTo(hilum)));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    /* base-follow weight: 1 at the sculpt floor, smoothly 0 at 1.7 above it (same field for every lobe → no drift) */
    aXZ[i * 2] = v.x; aXZ[i * 2 + 1] = v.z;
    aW[i] = smooth(1.7, 0, v.y - floorRef(v.x, v.z));
    pos.setXYZ(i, v.x - pivot.x, v.y - pivot.y, v.z - pivot.z);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aXZ', new THREE.BufferAttribute(aXZ, 2));
  geo.setAttribute('aW', new THREE.BufferAttribute(aW, 1));
  geo.computeVertexNormals(); geo.computeBoundingSphere(); geo.boundingSphere.radius += 0.8;
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

/* ---------- shader patches: base lift (vertex texture) + fresnel rim (fragment) ---------- */
const RIM_FRAG = `
  float lungFres = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 2.4);
  gl_FragColor.rgb += uRim * lungFres;
  gl_FragColor.a = clamp(gl_FragColor.a + uRimA * lungFres, 0.0, 1.0);`;
function patchRim(sh, rimU) {
  Object.assign(sh.uniforms, rimU);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform vec3 uRim; uniform float uRimA;')
    .replace('#include <opaque_fragment>', '#include <opaque_fragment>' + RIM_FRAG);
}
let VT = true;                                              // vertex textures available (WebGL2 / most WebGL1)
function lungMaterial(tex, liftU, kU, rimU) {
  const m = OrganMat(palette.white, {
    vertexColors: true, map: tex, bumpMap: tex, bumpScale: 0.6, roughness: 0.3, clearcoat: 0.9, clearcoatRoughness: 0.18,
    sheen: 0.45, sheenRoughness: 0.4, sheenColor: new THREE.Color(palette.pleura), emissive: new THREE.Color(palette.lung), emissiveIntensity: 0.06,
    transparent: true, opacity: 0.5, depthWrite: false,
  });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, liftU, { uK: kU });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aXZ; attribute float aW; uniform sampler2D uLiftTex; uniform vec4 uGrid; uniform vec2 uLiftR; uniform float uK;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' +
        (VT ? 'float lungLift = uLiftR.x + uLiftR.y * texture2D(uLiftTex, (aXZ - uGrid.xy) * uGrid.zw).r;\n' : 'float lungLift = 0.0;\n') +
        /* the base follows the diaphragm in WORLD units although the lobe mesh is scaled by uK about the hilum */
        'transformed.y += aW * (lungLift - (uK - 1.0) * transformed.y) / uK;');
    patchRim(sh, rimU);
  };
  m.customProgramCacheKey = () => 'lungs-r3-' + (VT ? 'v' : 'n');
  return m;
}

/* ---------- diaphragm mesh (polar grid heightfield, relaid every frame from the fitted field) ---------- */
const DR = 34, DS = 80, DCOUNT = (DR + 1) * DS;
let diaX, diaZ, diaBase, diaW, diaRk, diaCol, diaUv, diaIdx;
function diaphragmData() {
  diaX = new Float32Array(DCOUNT); diaZ = new Float32Array(DCOUNT); diaBase = new Float32Array(DCOUNT); diaW = new Float32Array(DCOUNT); diaRk = new Float32Array(DCOUNT);
  const col = new Float32Array(DCOUNT * 3), uv = new Float32Array(DCOUNT * 2);
  const cMus = new THREE.Color(palette.diaphragm), cTen = new THREE.Color(palette.centralTendon), c = new THREE.Color();
  for (let i = 0; i <= DR; i++) {
    const r = Math.pow(i / DR, 0.85);
    for (let j = 0; j < DS; j++) {
      const th = j / DS * Math.PI * 2, k = i * DS + j;
      /* place by TRUE angle so polar(x, z) returns exactly (th, r) */
      const rho = 1 / Math.sqrt((Math.sin(th) / RIM_X) ** 2 + (Math.cos(th) / rimZ(th)) ** 2);
      const x = rho * r * Math.sin(th), z = rho * r * Math.cos(th);
      diaX[k] = x; diaZ[k] = z; uv[k * 2] = r; uv[k * 2 + 1] = th / Math.PI / 2;
      diaBase[k] = baseY(th, r); diaW[k] = domeW(x, z, r); diaRk[k] = rimK(r);
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
  diaCol = new THREE.BufferAttribute(col, 3); diaUv = new THREE.BufferAttribute(uv, 2); diaIdx = idx;
}
function diaphragmGeo() {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(DCOUNT * 3);
  for (let k = 0; k < DCOUNT; k++) { pos[k * 3] = diaX[k]; pos[k * 3 + 1] = diaBase[k] + H_REF * diaW[k]; pos[k * 3 + 2] = diaZ[k]; }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', diaCol); g.setAttribute('uv', diaUv);
  g.setIndex(diaIdx); g.computeVertexNormals(); g.computeBoundingSphere(); g.boundingSphere.radius += 0.6;
  return g;
}

/* ---------- pulmonary arteries + veins inside the lobes (close-up detail; bronchi come from organs/airway.js) ---------- */
function clampInside(p, s) {
  const y = clamp(p.y, 0.6, 3.3), lat = clamp(s * p.x, 0.75, prof(y, 1) + prof(y, 2) - 0.18);
  p.set(s * lat, y, clamp(p.z, prof(y, 3) - prof(y, 4) + 0.18, prof(y, 3) + prof(y, 4) - 0.18));
  heartKeep(p);
  return p;
}
function buildVessels(group, artMat, veinMat) {
  setSeed(7072);
  const arts = [], veins = [];
  const tube = (list, pts, r0, r1, segs, rad) => list.push(vtube(pts, (u) => lerp(r0, r1, u), segs, rad, 0.5));
  const twigs = (list, s, from, dir, r) => {
    for (let k = 0; k < 3; k++) {
      const q = dir.clone().add(P((rnd() - 0.5) * 1.3, (rnd() - 0.5) * 1.3, (rnd() - 0.5) * 1.3)).normalize();
      const p1 = clampInside(from.clone().addScaledVector(q, 0.28 + 0.12 * rnd()), s);
      const p2 = clampInside(p1.clone().addScaledVector(q, 0.24 + 0.1 * rnd()).add(P((rnd() - 0.5) * 0.14, (rnd() - 0.5) * 0.14, (rnd() - 0.5) * 0.14)), s);
      tube(list, [from, p1, p2], r, r * 0.45, 10, 5);
    }
  };
  /* arteries continue the vessels.js pulmonary arteries (RPA ends (−1.5, 2.08, 0.05), LPA (1.95, 2.2, −0.1)) alongside
     the airway.js lobar bronchi: right truncus anterior (upper lobe) + interlobar artery (middle, lower); left upper,
     lingular and lower-lobe arteries after the LPA has arched over the left main bronchus */
  const A = [
    [-1, P(-0.9, 2.3, 0.15), P(-1.12, 2.78, 0.04), P(-1.36, 3.15, -0.06)],
    [-1, P(-1.5, 2.08, 0.05), P(-1.62, 1.85, 0.3), P(-1.72, 1.62, 0.58)],
    [-1, P(-1.5, 2.08, 0.05), P(-1.56, 1.55, -0.28), P(-1.62, 1.0, -0.42)],
    [1, P(1.6, 2.35, 0.02), P(1.56, 2.82, -0.02), P(1.46, 3.18, -0.1)],
    [1, P(1.85, 2.24, -0.05), P(1.98, 1.98, 0.2), P(2.05, 1.72, 0.4)],
    [1, P(1.95, 2.2, -0.1), P(1.86, 1.6, -0.48), P(1.76, 1.02, -0.62)],
  ];
  /* veins run intersegmentally to the four pulmonary veins of vessels.js (starts ±1.5/1.8, y 2.0 / 1.6–1.7) */
  const V = [
    [-1, P(-1.5, 2.0, 0.1), P(-1.72, 2.4, 0.4), P(-1.82, 2.85, 0.32)],
    [-1, P(-1.5, 2.0, 0.1), P(-1.76, 1.82, 0.52), P(-1.9, 1.58, 0.68)],
    [-1, P(-1.5, 1.6, 0.12), P(-1.75, 1.2, -0.05), P(-1.88, 0.8, -0.2)],
    [1, P(1.8, 2.1, 0.0), P(2.0, 2.45, 0.3), P(1.95, 2.85, 0.24)],
    [1, P(1.8, 1.7, 0.0), P(2.05, 1.25, -0.15), P(2.05, 0.85, -0.3)],
  ];
  for (const [s, a, b, c] of A) { clampInside(b, s); clampInside(c, s); tube(arts, [a, b, c], 0.062, 0.04, 20, 7); twigs(arts, s, c, c.clone().sub(b).normalize(), 0.034); }
  for (const [s, a, b, c] of V) { clampInside(b, s); clampInside(c, s); tube(veins, [a, b, c], 0.058, 0.036, 20, 7); twigs(veins, s, c, c.clone().sub(b).normalize(), 0.03); }
  const ma = add(mergeGeometries(arts), artMat, group, 'lungs'), mv = add(mergeGeometries(veins), veinMat, group, 'lungs');
  ma.renderOrder = mv.renderOrder = -1;
}

/* ---------- module state ---------- */
let C, diaMat, artMat, veinMat, detail, lungMats = [], rimU, liftUA, liftUB, texA, texB;
const lobesA = [], lobesB = [], lobeByKey = {};
const S = { A: null, B: null };                 // per-state diaphragm mesh + fitted maps
let fitted = false, fitAf = -9, fitBV = -1, floorLists = null, rawStatic = null, ceilStatic = null;
let lastT = -1, lagT = -1, lagD = -1, abdY = 0, curHA = H_REF;

function makeLiftTex() {
  const data = new Uint8Array(GN * 4);
  const z = Math.round(-LIFT_MIN / LIFT_RANGE * 255);
  for (let k = 0; k < GN; k++) { data[k * 4] = z; data[k * 4 + 3] = 255; }
  const t = new THREE.DataTexture(data, GNX, GNZ, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.magFilter = t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}
/** precomputed per-texel parts of the field: designed base / W / rim fade + the lung sculpt floor */
let gBase, gW, gRk, gRef;
function gridStatic() {
  gBase = new Float32Array(GN); gW = new Float32Array(GN); gRk = new Float32Array(GN); gRef = new Float32Array(GN);
  for (let j = 0; j < GNZ; j++) for (let i = 0; i < GNX; i++) {
    const k = j * GNX + i, x = GX0 + i * GD, z = GZ0 + j * GD, [th, r] = polar(x, z);
    gBase[k] = baseY(th, r); gW[k] = domeW(x, z, r); gRk[k] = rimK(r); gRef[k] = floorRef(x, z);
  }
}

/** collect the meshes that form the floor (abdominal organs) and the ceiling (heart + epicardial fat) */
function collect() {
  const ab = C.groups.abdomen, hg = C.groups.heart;
  const L = { floor: { 1: [], 2: [], 4: [] }, ceil: { 1: [], 2: [], 4: [] } };
  const layerOf = (o) => (o.layers.mask & 2 ? 2 : o.layers.mask & 4 ? 4 : o.layers.mask & 1 ? 1 : 0);
  ab.traverse((o) => {
    if (!o.isMesh || o === ab) return;
    const g = o.geometry; if (!g || !g.attributes.position || g.userData.curve) return;   // tubes (oesophagus, vessels) pass through the diaphragm
    if (!o.isInstancedMesh && g.attributes.position.count < 300) return;
    const l = layerOf(o); if (l) L.floor[l].push(o);
  });
  const ceil = (o) => { if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return; const l = layerOf(o); if (l) L.ceil[l].push(o); };
  hg.traverse((o) => { if (o.isInstancedMesh && o.userData.key !== 'epifat') return; ceil(o); });   // blood particles stay inside
  C.scene.traverse((o) => { if (o.userData.key === 'epifat' && !L.ceil[layerOf(o)]?.includes(o)) ceil(o); });
  return L;
}
/** (re)build the fitted maps of state 'A' or 'B' and resample them at the diaphragm vertices */
function refit(which) {
  const st = S[which], lay = which === 'A' ? 2 : 4, yOff = C.groups.abdomen.position.y;
  if (!rawStatic) {
    rawStatic = new Float32Array(GN).fill(U_EMPTY); scan(rawStatic, floorLists.floor[1], true, yOff);
    ceilStatic = new Float32Array(GN).fill(HC_EMPTY); scan(ceilStatic, floorLists.ceil[1], false, 0);
  }
  const u = rawStatic.slice(), h = ceilStatic.slice();
  scan(u, floorLists.floor[lay], true, yOff); scan(h, floorLists.ceil[lay], false, 0);
  st.U = finish(u, true); st.Hc = finish(h, false);
  for (let k = 0; k < DCOUNT; k++) { st.u[k] = gridAt(st.U, diaX[k], diaZ[k]); st.hc[k] = gridAt(st.Hc, diaX[k], diaZ[k]); }
  st.dirty = true;
}
/** lay one state's diaphragm + lift texture for dome height H and viscera offset aY */
function lay(which, H, aY) {
  const st = S[which];
  const pos = st.mesh.geometry.attributes.position.array;
  for (let k = 0; k < DCOUNT; k++) pos[k * 3 + 1] = fitF(diaBase[k] + H * diaW[k], diaRk[k], st.u[k], st.hc[k], aY);
  const g = st.mesh.geometry; g.attributes.position.needsUpdate = true; g.computeVertexNormals();
  if (!st.U) return;
  const d = st.tex.image.data, inv = 255 / LIFT_RANGE;
  for (let k = 0; k < GN; k++) {
    const F = fitF(gBase[k] + H * gW[k], gRk[k], st.U[k], st.Hc[k], aY);
    d[k * 4] = clamp(Math.round((baseOf(F) - gRef[k] - LIFT_MIN) * inv), 0, 255);
  }
  st.tex.needsUpdate = true;
}

export function build(ctx) {
  C = ctx;
  heartG = ctx.anchors.heartG; heartG.updateWorldMatrix(true, false); buildHeartTable();
  ATRIA = ctx.anchors.atriaG.children.map((m) => ({ p: m.position.clone(), r: Math.max(m.scale.x, m.scale.y, m.scale.z) + 0.2 }));
  const G = ctx.groups.lungs;
  const caps = ctx.renderer.capabilities; VT = !!caps && caps.maxVertexTextures > 0;
  gridStatic(); diaphragmData();

  /* pleura: glossy, translucent, vertex-coloured, lobular texture; one material per lobe and state (the hilum scale
     compensation is per lobe), one shared program; the A / B lift textures carry the diaphragm under the bases */
  const tex = lobuleTex();
  texA = makeLiftTex(); texB = makeLiftTex();
  const grid = new THREE.Vector4(GX0 - GD / 2, GZ0 - GD / 2, 1 / (GNX * GD), 1 / (GNZ * GD)), range = new THREE.Vector2(LIFT_MIN, LIFT_RANGE);
  liftUA = { uLiftTex: { value: texA }, uGrid: { value: grid }, uLiftR: { value: range } };
  liftUB = { uLiftTex: { value: texB }, uGrid: { value: grid }, uLiftR: { value: range } };
  rimU = { uRim: { value: new THREE.Color(palette.pleura).multiplyScalar(0.2) }, uRimA: { value: 0.3 } };
  for (const L of LOBES) {
    const pivot = P(L.s * 1.45, HOR_Y, PIVOT_Z), geo = lobeGeo(L, pivot);
    for (const [list, liftU, layer] of [[lobesA, liftUA, LAYER.A], [lobesB, liftUB, LAYER.B]]) {
      const kU = { value: 1 }, mat = lungMaterial(tex, liftU, kU, rimU); lungMats.push(mat);
      const m = add(geo, mat, G, 'lungs');
      m.position.copy(pivot); m.name = 'lung_' + L.key + (layer === LAYER.B ? '_B' : ''); m.userData.lobe = L.key; m.layers.set(layer);
      list.push({ mesh: m, amp: L.amp, kU });
    }
    lobeByKey[L.key] = lobesA[lobesA.length - 1].mesh;
  }

  /* diaphragm: A + B copies (shared colour / uv / index), fresnel rim so the dome profile reads from the front */
  diaMat = OrganMat(palette.white, { vertexColors: true, roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.28, sheen: 0.5, sheenColor: new THREE.Color(palette.lungSheen),
    emissive: new THREE.Color(palette.diaphragm), emissiveIntensity: 0.08, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, bumpScale: 0.3 });
  const diaRimU = { uRim: { value: new THREE.Color(palette.lungSheen).multiplyScalar(0.25) }, uRimA: { value: 0.35 } };
  diaMat.onBeforeCompile = (sh) => patchRim(sh, diaRimU);
  diaMat.customProgramCacheKey = () => 'dia-rim-r3';
  diaMat.userData.rimU = diaRimU;
  for (const [which, layer, tx] of [['A', LAYER.A, texA], ['B', LAYER.B, texB]]) {
    const mesh = add(diaphragmGeo(), diaMat, G, 'diaphragm');
    mesh.name = 'diaphragm' + (which === 'B' ? '_B' : ''); mesh.layers.set(layer);
    S[which] = { mesh, tex: tx, U: null, Hc: null, u: new Float32Array(DCOUNT).fill(U_EMPTY), hc: new Float32Array(DCOUNT).fill(HC_EMPTY), dirty: true, H: NaN, aY: NaN };
  }

  /* close-up detail: lobar / segmental pulmonary arteries + veins */
  detail = new THREE.Group(); detail.name = 'lungDetail'; G.add(detail);
  artMat = OrganMat(palette.pulmArtery, { roughness: 0.32, clearcoat: 0.85, transparent: true, opacity: 0.85, depthWrite: false, bumpScale: 0.2 });
  veinMat = OrganMat(palette.pulmVein, { roughness: 0.34, clearcoat: 0.8, transparent: true, opacity: 0.85, depthWrite: false, bumpScale: 0.2 });
  buildVessels(detail, artMat, veinMat);

  Object.assign(ctx.anchors, {
    lungs: lobesA.map((l) => l.mesh), lungLobes: lobeByKey, lungsB: lobesB.map((l) => l.mesh),
    diaphragm: S.A.mesh, diaphragmB: S.B.mesh,
    diaphragmY: (x, z) => { const st = S.A; return fitF(designed(x, z, curHA), rimK(polar(x, z)[1]), st.U ? gridAt(st.U, x, z) : U_EMPTY, st.Hc ? gridAt(st.Hc, x, z) : HC_EMPTY, abdY); },
    hilum: [P(-1.45, HOR_Y, PIVOT_Z), P(1.45, HOR_Y, PIVOT_Z)],
    /* exact (un-quantised) vertical shift of the A lung base at (x, z) relative to its sculpt floor (tests / probes) */
    lungLiftAt: (x, z) => baseOf(ctx.anchors.diaphragmY(x, z)) - floorRef(x, z),
  });
}

export function update(f, t, phys) {
  const st = C.state, perf = st.perf ?? 2, split = st.mode === 'split';
  const dt = lastT < 0 ? 0 : clamp(t - lastT, 0, 0.4); lastT = t;
  const fA = clamp(f, 0, 1);

  /* organ fit: at the first frame every neighbour exists; refit A when f has moved (liver / fat change shape) */
  if (!fitted) { floorLists = collect(); fitted = true; }
  if (Math.abs(fA - fitAf) > 0.02) { refit("A"); fitAf = fA; }
  if (split && st.bVersion !== fitBV) { refit('B'); fitBV = st.bVersion; }

  /* breathing: phase shape from breath / tidal; amplitude and excursion are low-passed (no jump when the physiology
     changes tidal depth or rate abruptly, e.g. at an apnoea or when the stairs test starts) */
  const T = clamp(phys.tidalDepth ?? 1, 0.05, 1), D = clamp(phys.diaphragmTravel ?? 1, 0, 1);
  const shape = clamp((phys.breath ?? 0) / T, 0, 1);
  if (lagT < 0) { lagT = T; lagD = D; }
  const kl = 1 - Math.exp(-dt / 0.45); lagT += (T - lagT) * kl; lagD += (D - lagD) * kl;
  const travelA = TRAVEL * lagD * lagT * shape;
  curHA = H0 + DH * fA - travelA;
  /* viscera: pushed up by visceral fat, follow the dome down on inspiration */
  abdY = RISE_ABD * (fA - F_REF) - BOB * travelA;
  C.groups.abdomen.position.y = abdY;

  /* chest expansion: lobes scale about the hilum (fissure planes stay invariant); the shader keeps the bases on the dome */
  const A = lagT * shape;
  for (const L of lobesA) { const k = 1 + L.amp * A; L.mesh.scale.set(1 + 0.85 * (k - 1), k, k); L.kU.value = k; }
  const SA = S.A;
  if (SA.dirty || Math.abs(curHA - SA.H) > 2e-4 || Math.abs(abdY - SA.aY) > 2e-4) { lay('A', curHA, abdY); SA.H = curHA; SA.aY = abdY; SA.dirty = false; }

  /* state B ("today", right half of the split view): today's tidal depth / excursion, same phase */
  if (split) {
    const today = phys.today, live = phys.live;
    const TB = clamp(lagT + ((today?.tidalRest ?? 0) - (live?.tidalRest ?? 0)), 0.1, 1), DB = clamp(today?.diaphragmTravel ?? lagD, 0, 1);
    const HB = H0 + DH * clamp(st.fB, 0, 1) - TRAVEL * DB * TB * shape, SB = S.B;
    for (const L of lobesB) { const k = 1 + L.amp * TB * shape; L.mesh.scale.set(1 + 0.85 * (k - 1), k, k); L.kU.value = k; }
    if (SB.dirty || Math.abs(HB - SB.H) > 2e-4 || Math.abs(abdY - SB.aY) > 2e-4) { lay('B', HB, abdY); SB.H = HB; SB.aY = abdY; SB.dirty = false; }
  }

  /* opacity easing toward the view's target; rim follows; vessels only when close */
  const k = 1 - Math.exp(-dt * 3.2), target = st.opTarget ? st.opTarget.lung : 0.5;
  const op = lerp(lungMats[0].opacity, target, dt > 0 ? k : 1);
  for (const m of lungMats) m.opacity = op;
  rimU.uRimA.value = 0.5 * op; rimU.uRim.value.set(palette.pleura).multiplyScalar(0.3 * op);
  diaMat.opacity = clamp(op * 0.9, 0.08, 0.68);
  diaMat.userData.rimU.uRimA.value = 0.45 * diaMat.opacity;
  const dop = clamp(op * 1.6, 0.1, 0.9);
  artMat.opacity = veinMat.opacity = dop;
  detail.visible = perf > 0 && C.camera.position.distanceTo(THORAX) < DETAIL_DIST;
}
