// organs/airway.js — upper + lower airway, neck and head. The stage of the snoring / sleep-apnoea simulation.
//
// Neck + head shell: one parametric surface (profile rows × angle columns, like the torso) continuing the torso
// from y = 5.4 (radii 0.92 / 0.88, centre z −0.05) up to the top of the head (y 10.52). Skin + subcutaneous fat
// use the torso's fresnel look (mats.skin / mats.subcutFat, renderOrder 10 / 9). Both are fat-dependent
// (thick neck, double chin, jowls, nape roll, fat-layer thickness) and therefore exist twice: A (layer 1, live f)
// and B (layer 2, ctx.state.fB).
//
// Inside, in anatomical order: nasal cavity → nasopharynx → soft palate + uvula → oropharynx (behind the tongue
// base, squeezed by parapharyngeal fat pads) → epiglottis → larynx (thyroid cartilage, cricoid, hyoid, vocal
// folds) → trachea with 18 C-shaped cartilage rings (InstancedMesh, open posteriorly) → carina (0, 3.1, 0) →
// right main bronchus (short, steep, ≈ 40° from vertical; upper-lobe bronchus leaves at the hilum, bronchus
// intermedius → middle + lower lobes) / left main bronchus (longer, flatter, ≈ 65°; upper lobe incl. lingula +
// lower lobe) → segmental → sub-segmental bronchi (one merged mesh) inside the lungs.
//
// Pharynx lumen: a parametric tube whose cross-section at the velo-/oropharyngeal level narrows:
//   awake  : open = 1 − 0.7·f (f = 0 wide oval, f = 1 narrow slit), tongue base + soft palate move back, the
//            parapharyngeal fat pads grow and press the lateral walls in (A/B copies)
//   asleep : open ×= phys.airwayPatency (0..1); phys.apneaEvent → 0 (closed); soft palate + uvula (one continuous
//            free edge, swinging antero-posteriorly) and the tongue base flutter with phys.snoreIntensity
//            (vertex shader on OrganMat, world amplitude ≤ 0.06 units — sizes are baked into the geometry)
//
// Anchors published: pharynxPos (Vector3, oropharynx lumen centre), neckTop (y of the chin), headTop (y),
// airwayGroup. Picking key: "airway" for every airway part. Skin / fat shells go to ctx.groups.skin ("skin" chip).
// Test hook: window.__airwaySim = { sleep, patency, snore, apnea } overrides the phys fields (debug only).
import { THREE, P, clamp, lerp, smooth, gauss, noise3, rnd, setSeed, deform, vtube, add, LAYER } from '../core/ctx.js';
import { palette, OrganMat, fatMat, fatColors, mats } from '../core/style.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* ------------------------------------------------------------------ constants / anchors */
const NECK_TOP = 7.15, HEAD_TOP = 10.52;
const PHARYNX_POS = P(0, 7.75, -0.22);
const LARYNX_C = P(0, 6.7, 0.33);
const DETAIL_DIST = 9.5;

/* ------------------------------------------------------------------ neck + head shell */
const ROWS = 108, COLS = 84, Y0 = 5.4, Y1 = HEAD_TOP;
/** [y, halfWidthX, frontDepth, backDepth, centreZ] — must start exactly where torsoProfile ends. */
const PROF = [
  [5.4, 0.92, 0.88, 0.88, -0.05], [5.85, 0.86, 0.84, 0.84, -0.02], [6.35, 0.80, 0.81, 0.80, 0.02],
  [6.85, 0.80, 0.84, 0.79, 0.05], [7.2, 0.86, 0.98, 0.81, 0.06], [7.55, 0.95, 1.14, 0.87, 0.08],
  [7.95, 1.03, 1.22, 0.97, 0.10], [8.45, 1.08, 1.17, 1.09, 0.10], [8.95, 1.10, 1.10, 1.17, 0.10],
  [9.4, 1.08, 1.05, 1.18, 0.10], [9.85, 0.99, 0.93, 1.07, 0.10], [10.15, 0.82, 0.74, 0.87, 0.10],
  [10.4, 0.48, 0.42, 0.5, 0.10], [10.52, 0.0, 0.0, 0.0, 0.10],
];
/* Catmull-Rom sample of column col of a profile table at height y (same as body.js) */
function sample(tab, y, col) {
  const n = tab.length;
  if (y <= tab[0][0]) return tab[0][col];
  if (y >= tab[n - 1][0]) return tab[n - 1][col];
  let s = 0; while (tab[s + 1][0] < y) s++;
  const r = tab[Math.max(0, s - 1)], o = tab[s], a = tab[s + 1], l = tab[Math.min(n - 1, s + 2)];
  const c = a[0] - o[0], h = (y - o[0]) / c;
  const m0 = (a[col] - r[col]) / (a[0] - r[0]) * c, m1 = (l[col] - o[col]) / (l[0] - o[0]) * c;
  const h2 = h * h, h3 = h2 * h;
  return (2 * h3 - 3 * h2 + 1) * o[col] + (h3 - 2 * h2 + h) * m0 + (-2 * h3 + 3 * h2) * a[col] + (h3 - h2) * m1;
}
/** fat-independent surface features (radial offset) at height y and angle a (0 = front, ±π = back) */
function baseFeature(y, a) {
  const aa = Math.abs(a);
  let d = 0;
  d += 0.30 * gauss(a, 0, 0.17) * gauss(y, 8.62, 0.2);                  // nose tip
  d += 0.15 * gauss(a, 0, 0.12) * gauss(y, 8.95, 0.32);                 // nose ridge
  d += 0.10 * gauss(aa, 0.22, 0.1) * gauss(y, 8.5, 0.13);               // nostril wings
  d += 0.08 * gauss(a, 0, 0.42) * gauss(y, 8.12, 0.08);                 // upper lip
  d += 0.07 * gauss(a, 0, 0.36) * gauss(y, 7.92, 0.08);                 // lower lip
  d -= 0.045 * gauss(a, 0, 0.45) * gauss(y, 8.02, 0.035);               // mouth line
  d += 0.11 * gauss(a, 0, 0.42) * gauss(y, 7.45, 0.2);                  // chin
  d -= 0.06 * gauss(a, 0, 0.55) * gauss(y, 7.1, 0.09);                  // submental crease
  d += 0.07 * gauss(aa, 0.35, 0.35) * gauss(y, 9.3, 0.12);              // brow
  d -= 0.09 * gauss(aa, 0.42, 0.2) * gauss(y, 9.12, 0.14);              // eye sockets
  d += 0.05 * gauss(aa, 0.78, 0.3) * gauss(y, 8.78, 0.25);              // cheekbones
  const jawW = smooth(6.3, 6.9, y);                                     // jaw terms fade out down the neck: dr(5.4, a) = 0
  d -= 0.2 * gauss(aa, 0.7, 0.45) * smooth(8.4, 7.3, y) * jawW;        // jaw taper → narrower chin
  d -= 0.05 * gauss(aa, 1.25, 0.35) * smooth(8.0, 7.2, y) * jawW;      // below the jaw angle
  d += 0.12 * gauss(aa, 1.6, 0.17) * gauss(y, 8.95, 0.3);               // ears
  d -= 0.04 * gauss(aa, 1.1, 0.3) * gauss(y, 9.45, 0.3);                // temples
  d += 0.07 * gauss(a, 0, 0.3) * gauss(y, 6.78, 0.17);                  // laryngeal prominence
  d += 0.04 * gauss(aa, 2.4, 0.5) * gauss(y, 6.2, 0.5) * smooth(5.4, 5.9, y);   // trapezius slope (0 at the seam)
  return d;
}
/** coefficient of f in the radial offset (thick neck, double chin, jowls, nape roll, softened crease) */
function fatFeature(y, a) {
  const aa = Math.abs(a), ramp = smooth(5.4, 6.6, y);
  return ramp * (0.14 * smooth(7.9, 7.0, y)
    + 0.32 * gauss(a, 0, 0.75) * gauss(y, 7.02, 0.3)
    + 0.12 * gauss(aa, 0.85, 0.5) * gauss(y, 8.2, 0.5)
    + 0.12 * gauss(aa, Math.PI, 0.6) * gauss(y, 6.3, 0.45)
    + 0.048 * gauss(a, 0, 0.55) * gauss(y, 7.1, 0.09));
}
/** depth of the subcutaneous-fat shell under the skin: continuous with the torso's d at y = 5.4 */
const insetAt = (y, f, dBody) => lerp(lerp(dBody, 0.06 + 0.26 * f, smooth(5.4, 6.3, y)), 0.17 + 0.1 * f, smooth(7.0, 7.9, y));

const rowY = [], rowRx = [], rowRzF = [], rowRzB = [], rowCz = [], colSin = [], colCos = [];
let baseDr, fatDr;
function precomputeShell() {
  for (let c = 0; c <= COLS; c++) { const a = c / COLS * Math.PI * 2; colSin.push(Math.sin(a)); colCos.push(Math.cos(a)); }
  baseDr = new Float32Array((ROWS + 1) * (COLS + 1)); fatDr = new Float32Array((ROWS + 1) * (COLS + 1));
  for (let r = 0; r <= ROWS; r++) {
    const y = lerp(Y0, Y1, r / ROWS);
    rowY.push(y); rowRx.push(sample(PROF, y, 1)); rowRzF.push(sample(PROF, y, 2)); rowRzB.push(sample(PROF, y, 3)); rowCz.push(sample(PROF, y, 4));
    for (let c = 0; c <= COLS; c++) {
      let a = c / COLS * Math.PI * 2; if (a > Math.PI) a -= Math.PI * 2;
      const k = r * (COLS + 1) + c;
      baseDr[k] = baseFeature(y, a); fatDr[k] = fatFeature(y, a);
    }
  }
}
function gridGeo(rows, cols) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((rows + 1) * (cols + 1) * 3), 3));
  const idx = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const a = r * (cols + 1) + c, b = a + cols + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  g.setIndex(idx);
  return g;
}
function layShell(geo, f, dBody, isFat) {
  const pos = geo.attributes.position;
  for (let r = 0; r <= ROWS; r++) {
    const y = rowY[r], inset = isFat ? insetAt(y, f, dBody) : 0, rx = rowRx[r], cz = rowCz[r];
    for (let c = 0; c <= COLS; c++) {
      const k = r * (COLS + 1) + c, dr = baseDr[k] + f * fatDr[k], rz = colCos[c] >= 0 ? rowRzF[r] : rowRzB[r];
      pos.setXYZ(k, Math.max(0, rx + dr - inset) * colSin[c], y, cz + Math.max(0, rz + dr - inset) * colCos[c]);
    }
  }
  pos.needsUpdate = true; geo.computeVertexNormals(); geo.computeBoundingSphere();
}

/* ------------------------------------------------------------------ flutter (snore) vertex shader */
const flutterU = { uAmp: { value: 0 }, uT: { value: 0 } };
/** OrganMat whose vertices flutter: w = clamp(dot(position, axis) + bias, 0, 1) masks the moving part; the
 *  displacement runs along `dir` (object space, e.g. antero-posterior swing) or along the normal when dir is null.
 *  Meshes using it must carry their size in the geometry (scale ≈ 1) so uAmp is in world units. */
function flutterMat(color, opts, axis, bias, dir = null) {
  const m = OrganMat(color, opts);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uAmp = flutterU.uAmp; sh.uniforms.uT = flutterU.uT;
    sh.uniforms.uMaskAxis = { value: axis }; sh.uniforms.uMaskBias = { value: bias };
    sh.uniforms.uDir = { value: dir ? dir.clone().normalize() : P(0, 0, 1) }; sh.uniforms.uDirW = { value: dir ? 1 : 0 };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uAmp, uT, uMaskBias, uDirW; uniform vec3 uMaskAxis, uDir;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        { float w = clamp(dot(position, uMaskAxis) + uMaskBias, 0.0, 1.0);
          float ph = uT * 45.0 + position.y * 16.0 + position.x * 7.0;
          vec3 fd = mix(normal, uDir, uDirW);
          transformed += fd * (uAmp * w * (sin(ph) * (0.7 + 0.3 * sin(uT * 31.0 + position.z * 9.0)))); }`);
  };
  m.customProgramCacheKey = () => 'airwayFlutter';
  return m;
}

/* ------------------------------------------------------------------ pharynx lumen (parametric tube) */
const PR = 48, PC = 24;
const PH_CURVE = new THREE.CatmullRomCurve3([P(0, 9.1, -0.1), P(0, 8.85, -0.24), P(0, 8.5, -0.25), P(0, 8.15, -0.235),
  P(0, 7.95, -0.23), P(0, 7.55, -0.21), P(0, 7.2, -0.08), P(0, 6.98, 0.1)], false, 'catmullrom', 0.5);
const _c = new THREE.Vector3(), _T = new THREE.Vector3(), _N = new THREE.Vector3(), _X = new THREE.Vector3(1, 0, 0);
/** lay the lumen; open = 1 wide, 0 fully collapsed (posterior wall stays, anterior + lateral walls move in) */
function layPharynx(geo, open) {
  const pos = geo.attributes.position;
  for (let i = 0; i <= PR; i++) {
    const u = i / PR; PH_CURVE.getPointAt(u, _c); PH_CURVE.getTangentAt(u, _T); _N.crossVectors(_T, _X).normalize();
    const y = _c.y, naso = smooth(8.2, 8.7, y), lar = smooth(7.35, 6.95, y);
    const rx0 = lerp(lerp(0.27, 0.23, lar), 0.3, naso), rz0 = lerp(lerp(0.17, 0.15, lar), 0.22, naso);
    const w = smooth(6.95, 7.4, y) * smooth(8.75, 8.3, y), sq = w * (1 - open);   // collapsible segment
    const roof = Math.sqrt(smooth(0, 0.18, u));                                      // domed nasopharynx roof (≈ 0.4 units)
    const rx = rx0 * (1 - 0.74 * sq) * roof, rz = rz0 * (1 - 0.96 * sq) * roof, back = rz0 - rz;
    for (let j = 0; j <= PC; j++) {
      const th = j / PC * Math.PI * 2, k = i * (PC + 1) + j, n = rz * Math.sin(th) - back, x = rx * Math.cos(th);
      pos.setXYZ(k, _c.x + x, _c.y + _N.y * n, _c.z + _N.z * n);
    }
  }
  pos.needsUpdate = true; geo.computeVertexNormals(); geo.computeBoundingSphere();
}

/* ------------------------------------------------------------------ soft tissue shapes */
function tongueShape(v) {
  const back = clamp(-v.z, 0, 1), tip = clamp(v.z, 0, 1);          // unit sphere: −z = tongue base
  v.x *= 0.40 * (1 - 0.3 * back * back);
  v.y *= 0.22 * (1 - 0.4 * tip * tip) * (v.y > 0 ? 1 + 0.35 * (1 - back) * (1 - tip) : 0.8);
  v.z *= 0.58;
  v.y -= 0.40 * back * back; v.z -= 0.04 * back * back;             // base curls down toward the epiglottis
  if (v.y > 0) v.y -= 0.025 * gauss(v.x, 0, 0.05) * (1 - back);      // median sulcus
  v.multiplyScalar(1 + 0.012 * noise3(v.x * 9, v.y * 9, v.z * 9));
}
function epiglottisShape(v) {
  const base = clamp(-v.y, 0, 1);
  v.x *= 0.17 * (1 - 0.45 * base * base); v.y *= 0.3; v.z = v.z * 0.03 + 0.07 * v.y * v.y;
}
function thyroidShape(v) {                                           // open cylinder band → two shield-shaped laminae meeting in a V
  const side = Math.abs(v.x), tilt = 1 - 0.18 * (0.5 - v.y);                 // laminae converge a little toward the cricoid
  const yTop = 0.5 - 0.22 * side * side, yBot = -0.5 + 0.16 * side * side;   // edges curve: shield outline
  v.y = yBot + (v.y + 0.5) * (yTop - yBot);
  v.x *= 0.42 * tilt; v.z *= 0.3 * tilt * (1 + 0.6 * (1 - side) * (1 - side)); v.y *= 0.36;
  if (v.y > 0) v.y -= 0.12 * gauss(v.x, 0, 0.07) * smooth(0.05, 0.18, v.y);   // superior thyroid notch
}

/* ------------------------------------------------------------------ bronchial tree */
const LUNG_C = [P(-1.55, 1.9, -0.1), P(1.55, 1.9, -0.1)], HEART_C = P(0.38, 1.5, 0.55);
function confine(p, s) {
  const c = LUNG_C[s < 0 ? 0 : 1], dx = (p.x - c.x) / 1.1, dy = (p.y - c.y) / 1.72, dz = (p.z - c.z) / 1.22;
  const d = dx * dx + dy * dy + dz * dz;
  if (d > 0.78) { const k = Math.sqrt(0.78 / d); p.set(c.x + dx * 1.1 * k, c.y + dy * 1.72 * k, c.z + dz * 1.22 * k); }
  const med = 1.0 + 0.2 * smooth(2.8, 3.4, p.y);                      // mediastinal face of the lungs (lungs.js flattening)
  if (s < 0 && p.x > -med) p.x = -med;
  if (s > 0 && p.x < med) p.x = med;
  const keep = s < 0 ? 1.45 : 1.72;                                    // cardiac notch (lungs keep 1.35 / 1.62 from the heart)
  if (p.distanceTo(HEART_C) < keep) p.sub(HEART_C).setLength(keep).add(HEART_C);
  return p;
}
function cone(dir, az, el) {
  const up = Math.abs(dir.y) > 0.9 ? P(1, 0, 0) : P(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(dir, up).normalize(), v = new THREE.Vector3().crossVectors(dir, u);
  return dir.clone().multiplyScalar(Math.cos(el)).addScaledVector(u, Math.cos(az) * Math.sin(el)).addScaledVector(v, Math.sin(az) * Math.sin(el)).normalize();
}
function grow(geos, from, dir, len, r, level, s) {
  const n = level === 1 ? 3 : 2;
  for (let k = 0; k < n; k++) {
    const d = cone(dir, k / n * Math.PI * 2 + rnd() * 1.3, 0.5 + rnd() * 0.4);
    const to = confine(from.clone().addScaledVector(d, len * (0.85 + 0.3 * rnd())), s);
    const mid = from.clone().lerp(to, 0.5).addScaledVector(cone(d, rnd() * 6.28, 1.57), 0.05 * rnd());
    geos.push(vtube([from, mid, to], (u) => r * (1 - 0.25 * u), 8, level < 3 ? 8 : 6));
    if (level < 3) grow(geos, to, to.clone().sub(from).normalize(), len * 0.7, r * 0.66, level + 1, s);
  }
}
/** carina → main bronchi → lobar (3 right / 2 left) → segmental → sub-segmental, one merged geometry */
function bronchialTree() {
  const geos = [];
  const tube = (pts, r0, r1, segs = 16, rad = 9) => geos.push(vtube(pts, (u) => lerp(r0, r1, u), segs, rad));
  const branch = (pts, r0, r1, len, level, s) => { tube(pts, r0, r1); grow(geos, pts[2], pts[2].clone().sub(pts[1]).normalize(), len, r1 * 0.66, level, s); };
  /* RIGHT (−x): short, steep main bronchus (first segment ≈ 37°, carina→hilum ≈ 47° from vertical). The upper-lobe
     bronchus leaves at the hilum; the bronchus intermedius continues down to the middle and lower lobes. */
  const rHil = P(-0.85, 2.28, -0.2), rInt = P(-1.1, 1.82, -0.2);
  tube([P(0, 3.1, 0), P(-0.34, 2.64, -0.08), rHil], 0.145, 0.125, 24, 12);
  branch([P(-0.8, 2.36, -0.19), P(-1.1, 2.82, -0.26), P(-1.4, 3.28, -0.3)], 0.08, 0.066, 0.5, 1, -1);     // upper lobe
  tube([rHil, P(-1.0, 2.05, -0.22), rInt], 0.11, 0.1);                                                        // bronchus intermedius
  branch([rInt, P(-1.3, 1.66, 0.14), P(-1.5, 1.5, 0.44)], 0.065, 0.054, 0.45, 1, -1);                        // middle lobe
  branch([rInt, P(-1.25, 1.45, -0.42), P(-1.4, 0.95, -0.55)], 0.085, 0.07, 0.5, 1, -1);                      // lower lobe
  /* LEFT (+x): longer, flatter main bronchus (first segment ≈ 73°, carina→hilum ≈ 66°), two lobar bronchi. */
  const lHil = P(1.1, 2.6, -0.3), lUp = P(1.4, 2.82, -0.2);
  tube([P(0, 3.1, 0), P(0.55, 2.93, -0.15), lHil], 0.135, 0.115, 24, 12);
  tube([lHil, P(1.25, 2.72, -0.25), lUp], 0.085, 0.078);                                                     // upper lobe trunk
  grow(geos, lUp, P(0.45, 1, 0.1).normalize(), 0.5, 0.052, 1, 1);                                            //   apico-posterior / anterior segments
  branch([lUp, P(1.62, 2.5, -0.06), P(1.9, 2.08, 0.0)], 0.055, 0.046, 0.4, 2, 1);                            //   lingula (antero-inferior)
  branch([lHil, P(1.3, 2.15, -0.45), P(1.55, 1.35, -0.75)], 0.09, 0.075, 0.5, 1, 1);                         // lower lobe
  return mergeGeometries(geos);
}

/* ------------------------------------------------------------------ module state */
let C, G, dummy;
let shells = {}, pharynx = {}, pads = {}, soft = {};
let detail, folds = [], padPts = [];
let lastA = null, lastB = -1, lastT = 0;
const live = { open: 1, amp: 0 };
let padBlobMat;

function makeShellSet(layer, skinMat, fatShellMat) {
  const skin = add(gridGeo(ROWS, COLS), skinMat, C.groups.skin, 'skin'); skin.renderOrder = 10; skin.layers.set(layer);
  const fat = add(gridGeo(ROWS, COLS), fatShellMat, C.groups.skin, 'skin'); fat.renderOrder = 9; fat.layers.set(layer);
  skin.userData.mod = fat.userData.mod = 'airway';
  skin.frustumCulled = fat.frustumCulled = false;
  return { skin, fat };
}
function makeSoftSet(layer, tongueMat, velumMat, uvulaMat) {
  const tongue = add(deform(new THREE.SphereGeometry(1, 44, 30), tongueShape), tongueMat, G, 'airway');
  tongue.layers.set(layer);
  const velum = new THREE.Group(); velum.position.set(0, 8.4, 0.1); G.add(velum);
  /* soft palate: wide flat band (x × 2.6) starting inside the hard palate, thinning to a free edge (r ≈ 0.008 at u = 1) */
  const pal = vtube([P(0, 0, 0.16), P(0, -0.01, 0.0), P(0, -0.06, -0.08), P(0, -0.18, -0.14), P(0, -0.28, -0.17)],
    (u) => lerp(0.035, 0.07, smooth(0, 0.3, u)) * lerp(1, 0.72, u) * (1 - 0.85 * smooth(0.6, 1, u)), 24, 12);
  deform(pal, (v) => { v.x *= 2.6; });
  const palate = add(pal, velumMat, velum, 'airway'); palate.layers.set(layer);
  /* uvula: hangs from the middle of the free edge — size baked into the geometry (no mesh scale) so the flutter
     amplitude is in world units; same mask + swing direction as the palate, so the two stay attached */
  const uv = vtube([P(0, -0.25, -0.165), P(0, -0.31, -0.18), P(0, -0.4, -0.19), P(0, -0.49, -0.19)],
    (u) => (0.03 + 0.022 * smooth(0, 0.45, u)) * (u > 0.6 ? Math.sqrt(Math.max(0, 1 - ((u - 0.6) / 0.4) ** 2)) : 1), 18, 12);
  const uvula = add(uv, uvulaMat, velum, 'airway'); uvula.layers.set(layer);
  return { tongue, velum };
}
function makePadSet(layer, lobuleGeo, lobMat) {
  const inst = new THREE.InstancedMesh(lobuleGeo, lobMat, padPts.length);
  inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < padPts.length; i++) inst.setColorAt(i, fatColors[i % fatColors.length]);
  inst.frustumCulled = false; inst.layers.set(layer); inst.userData.key = 'airway'; G.add(inst);
  const blobs = [-1, 1].map(() => {
    const b = add(new THREE.SphereGeometry(1, 24, 16), padBlobMat, G, 'airway'); b.renderOrder = 2; b.layers.set(layer); return b;
  });
  return { inst, blobs };
}

/* ------------------------------------------------------------------ relays (fat-dependent state) */
function layPads(set, f) {
  const e = Math.pow(f, 1.2), R = 0.05 + 0.2 * e;
  const rxL = 0.27 * (1 - 0.74 * 0.7 * f), cx = rxL + R * 0.95, cy = 7.62, cz = -0.3;
  set.blobs.forEach((b, i) => { const s = i ? 1 : -1; b.position.set(s * cx, cy, cz); b.scale.set(R, R * 1.5, R * 1.1); });
  let n = 0;
  for (const p of padPts) {
    const rad = (0.03 + 0.075 * e) * p.r, lat = Math.max(cx + p.d.x * R, rxL + 0.01 + rad * 1.12);   // never through the lumen wall
    dummy.position.set(p.s * lat, cy + p.d.y * R * 1.5, cz + p.d.z * R * 1.1);
    dummy.rotation.set(p.rot, p.rot * 0.7, 0); dummy.scale.setScalar(rad); dummy.updateMatrix();
    set.inst.setMatrixAt(n++, dummy.matrix);
  }
  set.inst.count = n; set.inst.instanceMatrix.needsUpdate = true;
}
function laySoft(set, f) {
  set.tongue.userData.f = f; set.velum.userData.f = f;
  set.tongue.scale.set(1 + 0.08 * f, 1 + 0.12 * f, 1 + 0.05 * f);
  set.velum.scale.set(1 + 0.12 * f, 1 + 0.15 * f, 1 + 0.15 * f);
}
function relay(side, f, dBody) {
  layShell(shells[side].skin.geometry, f, dBody, false);
  layShell(shells[side].fat.geometry, f, dBody, true);
  layPads(pads[side], f); laySoft(soft[side], f);
  pharynx[side].f = f;
}
/** per-frame placement of tongue / velum (fat push-back + night collapse) */
function placeSoft(set, open) {
  const f = set.tongue.userData.f || 0, fall = 1 - open;
  set.tongue.position.set(0, 8.02, 0.56 - 0.12 * f - 0.1 * fall);
  set.velum.position.set(0, 8.4, 0.1 - 0.12 * f - 0.06 * fall);
}

/* ================================================================== build */
export function build(ctx) {
  C = ctx; G = ctx.groups.airway; dummy = ctx.dummy;
  setSeed(4242);
  precomputeShell();

  /* ---- neck + head shells (A / B) ---- */
  const skinMat = mats.skin(), fatShellMat = mats.subcutFat();
  shells.A = makeShellSet(LAYER.A, skinMat, fatShellMat);
  shells.B = makeShellSet(LAYER.B, skinMat, fatShellMat);

  /* ---- materials (all from the style contract) ---- */
  const mucosaMat = OrganMat(palette.pharynxMucosa, { transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false, roughness: 0.28, clearcoat: 0.9, emissiveIntensity: 0.1 });
  const nasalMat = OrganMat(palette.pharynxMucosa, { transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false, roughness: 0.3 });
  const larynxMat = OrganMat(palette.larynx, { transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false, roughness: 0.35, emissiveIntensity: 0.03 });
  const tracheaMat = OrganMat(palette.trachea, { transparent: true, opacity: 0.62, side: THREE.DoubleSide, depthWrite: false, roughness: 0.38, emissiveIntensity: 0.1 });
  const ringMat = OrganMat(palette.trachealRing, { roughness: 0.45, clearcoat: 0.6, bumpScale: 0.25, transparent: true, opacity: 0.8, emissiveIntensity: 0.03 });
  const cartMat = OrganMat(palette.cartilageRing, { transparent: true, opacity: 0.32, depthWrite: false, roughness: 0.4, clearcoat: 0.5, side: THREE.DoubleSide, emissiveIntensity: 0.02 });
  const bronchusMat = OrganMat(palette.bronchusWall, { roughness: 0.42, clearcoat: 0.7, bumpScale: 0.3 });
  const plateMat = OrganMat(palette.pharynxMucosa, { roughness: 0.4, side: THREE.DoubleSide, emissiveIntensity: 0.05 });
  const epiMat = OrganMat(palette.epiglottis, { roughness: 0.38, clearcoat: 0.5, emissiveIntensity: 0.04, side: THREE.DoubleSide });
  const foldMat = OrganMat(palette.trachealRing, { roughness: 0.3, clearcoat: 0.9 });
  const tongueMat = flutterMat(palette.tongue, { roughness: 0.28, clearcoat: 0.95, clearcoatRoughness: 0.15, bumpScale: 0.9 }, P(0, 0, -3), 0);
  const velumMat = flutterMat(palette.pharynxMucosa, { roughness: 0.3, clearcoat: 0.9, side: THREE.DoubleSide }, P(0, -4, 0), 0, P(0, 0, 1));
  const uvulaMat = flutterMat(palette.uvula, { roughness: 0.3, clearcoat: 0.9 }, P(0, -4, 0), 0, P(0, 0, 1));
  padBlobMat = OrganMat(palette.neckFat, { transparent: true, opacity: 0.62, depthWrite: false, roughness: 0.35, sheen: 1, sheenColor: new THREE.Color(palette.fatSheen), emissiveIntensity: 0.1 });

  /* ---- static upper airway (layer 0) ---- */
  const nasal = vtube([P(0, 8.47, 1.35), P(0, 8.55, 0.95), P(0, 8.7, 0.4), P(0, 8.86, -0.12)], (u) => 0.045 + 0.08 * u, 24, 12);  // floor stays above the hard palate
  deform(nasal, (v) => { v.x *= 0.6; });
  const nasalMesh = add(mergeGeometries([nasal.clone().translate(0.14, 0, 0), nasal.clone().translate(-0.14, 0, 0)]), nasalMat, G, 'airway');
  nasalMesh.renderOrder = 3;
  const plateGeo = new THREE.BoxGeometry(0.56, 0.035, 0.9, 8, 1, 6);                                 // hard palate (slightly arched)
  deform(plateGeo, (v) => { v.y += 0.05 * (1 - (v.x / 0.28) ** 2); });
  const plate = add(plateGeo, plateMat, G, 'airway'); plate.position.set(0, 8.39, 0.55);
  const epi = add(deform(new THREE.SphereGeometry(1, 20, 14), epiglottisShape), epiMat, G, 'airway');  // epiglottis
  epi.position.set(0, 7.22, 0.22); epi.rotation.x = -0.5;

  /* ---- larynx ---- */
  const larynx = add(vtube([P(0, 7.02, 0.1), P(0, 6.82, 0.24), P(0, 6.6, 0.32), P(0, 6.3, 0.33)],
    (u) => 0.21 - 0.075 * gauss(u, 0.55, 0.16) - 0.02 * u, 40, 18), larynxMat, G, 'airway');
  larynx.renderOrder = 3;
  const thy = add(deform(new THREE.CylinderGeometry(1, 1, 1, 36, 8, true, -0.42 * Math.PI, 0.84 * Math.PI), thyroidShape), cartMat, G, 'airway');  // thyroid cartilage: two laminae, open behind
  thy.position.set(0, 6.76, 0.36); thy.renderOrder = 4;
  const cric = add(new THREE.TorusGeometry(0.22, 0.045, 8, 28).rotateX(Math.PI / 2), ringMat, G, 'airway');       // cricoid ring
  cric.position.set(0, 6.3, 0.33);

  /* ---- fine details: only when the camera is close ---- */
  detail = new THREE.Group(); G.add(detail);
  const hy = []; for (let k = 0; k <= 14; k++) { const a = -2 + 4 * k / 14; hy.push(P(0.36 * Math.sin(a), 7.12, 0.2 + 0.32 * Math.cos(a))); }
  add(vtube(hy, () => 0.022, 30, 8), ringMat, detail, 'airway');                                                  // hyoid bone
  for (const s of [-1, 1]) {                                                                                      // vocal folds
    const m = add(new THREE.SphereGeometry(1, 14, 10), foldMat, detail, 'airway');
    m.scale.set(0.05, 0.016, 0.16); m.position.set(s * 0.07, 6.6, 0.32); m.userData.s = s; folds.push(m);
  }

  /* ---- trachea: membrane + instanced C-rings (open posteriorly) ---- */
  const trPts = [P(0, 3.1, 0), P(-0.07, 3.6, 0.0), P(-0.03, 4.2, 0.06), P(0, 4.8, 0.14), P(0, 5.4, 0.22), P(0, 5.85, 0.3), P(0, 6.3, 0.33)];
  const trGeo = vtube(trPts, (u) => 0.17 + 0.02 * u, 80, 16);
  const trachea = add(trGeo, tracheaMat, G, 'airway'); trachea.renderOrder = 3;
  const trCurve = trGeo.userData.curve;
  const N_RINGS = 18, ringGeo = new THREE.TorusGeometry(0.2, 0.022, 7, 22, Math.PI * 1.5).rotateX(Math.PI / 2).rotateY(Math.PI / 4).scale(1, 1.35, 1);
  const rings = new THREE.InstancedMesh(ringGeo, ringMat, N_RINGS);
  const q = new THREE.Quaternion(), up = P(0, 1, 0), tan = new THREE.Vector3();
  for (let i = 0; i < N_RINGS; i++) {
    const u = 0.04 + 0.93 * i / (N_RINGS - 1);
    trCurve.getPointAt(u, dummy.position); trCurve.getTangentAt(u, tan); q.setFromUnitVectors(up, tan);
    dummy.quaternion.copy(q); dummy.scale.setScalar(1 + 0.1 * u); dummy.updateMatrix(); rings.setMatrixAt(i, dummy.matrix);
  }
  rings.userData.key = 'airway'; G.add(rings);
  dummy.quaternion.identity();

  /* ---- bronchial tree (merged) ---- */
  add(bronchialTree(), bronchusMat, G, 'airway');

  /* ---- fat-dependent interior (A / B): pharynx lumen, tongue, soft palate + uvula, parapharyngeal fat pads ---- */
  const lobuleGeo = new THREE.SphereGeometry(1, 9, 7);
  deform(lobuleGeo, (v) => v.multiplyScalar(1 + 0.12 * noise3(v.x * 4, v.y * 4, v.z * 4)));
  const lobMat = fatMat();
  for (let i = 0; i < 26; i++) {                                                 // lobule cloud per side (mirrored); d.x = lateral
    const th = rnd() * 6.283, ph = Math.acos(2 * rnd() - 1), rr = Math.pow(rnd(), 0.5);
    const d = P(Math.sin(ph) * Math.cos(th) * rr, Math.cos(ph) * rr, Math.sin(ph) * Math.sin(th) * rr);
    if (d.x < -0.3) d.x = -d.x;                                                   // lateral hemisphere only
    padPts.push({ s: -1, d, r: 0.7 + rnd() * 0.6, rot: rnd() * 6.28 }, { s: 1, d: d.clone(), r: 0.7 + rnd() * 0.6, rot: rnd() * 6.28 });
  }
  for (const side of ['A', 'B']) {
    const layer = side === 'A' ? LAYER.A : LAYER.B;
    const geo = gridGeo(PR, PC);
    const m = add(geo, mucosaMat, G, 'airway'); m.renderOrder = 3; m.layers.set(layer); m.frustumCulled = false;
    pharynx[side] = { geo, open: -1, f: 0 };
    soft[side] = makeSoftSet(layer, tongueMat, velumMat, uvulaMat);
    pads[side] = makePadSet(layer, lobuleGeo, lobMat);
  }
  G.traverse((o) => { if (o.isMesh) o.userData.mod = 'airway'; });

  /* ---- anchors ---- */
  ctx.anchors.pharynxPos = PHARYNX_POS.clone();
  ctx.anchors.neckTop = NECK_TOP;
  ctx.anchors.headTop = HEAD_TOP;
  ctx.anchors.airwayGroup = G;
  ctx.anchors.larynxPos = LARYNX_C.clone();
}

/* ================================================================== update */
export function update(f, t, phys) {
  const st = C.state;
  const keyA = f.toFixed(4) + '|' + st.body.d.toFixed(4);
  if (keyA !== lastA) { relay('A', f, st.body.d); lastA = keyA; }
  if (st.bVersion !== lastB) { relay('B', st.fB, st.bodyB.d); lastB = st.bVersion; }

  /* night scene: patency / apnoea / snore (phys fields, with safe fallbacks + debug override) */
  const dbg = (typeof window !== 'undefined' && window.__airwaySim) || null;
  const sleep = !!(dbg?.sleep ?? phys.sleep ?? st.sleep);
  const patency = clamp(dbg?.patency ?? phys.airwayPatency ?? 1, 0, 1);
  const snore = clamp(dbg?.snore ?? phys.snoreIntensity ?? 0, 0, 1);
  const apnea = !!(dbg?.apnea ?? phys.apneaEvent);
  const dt = clamp(t - lastT, 0, 0.4); lastT = t;
  const k = 1 - Math.exp(-dt * 7);
  live.open = lerp(live.open, sleep ? (apnea ? 0 : patency) : 1, k);
  live.amp = lerp(live.amp, sleep && !apnea ? 0.06 * snore : 0, k);
  flutterU.uAmp.value = live.amp; flutterU.uT.value = t;

  for (const side of ['A', 'B']) {
    const ph = pharynx[side], open = (1 - 0.7 * ph.f) * live.open;
    if (Math.abs(open - ph.open) > 0.003) { layPharynx(ph.geo, open); ph.open = open; }
    placeSoft(soft[side], live.open);
  }
  const br = phys.breath ?? 0;
  folds.forEach((m) => { m.position.x = m.userData.s * (0.058 + 0.04 * br); });    // half-width 0.05 → glottis never closes
  detail.visible = C.camera.position.distanceTo(LARYNX_C) < DETAIL_DIST;
}
