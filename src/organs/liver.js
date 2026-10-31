// organs/liver.js — liver with four lobes (right / left / caudate / quadrate) sculpted on one silhouette: falciform
// fissure + fissures for the ligamentum teres and venosum, porta hepatis, gallbladder fossa and the IVC groove
// (visceral surface "H"). Falciform ligament sheet with the round ligament, gallbladder + cystic duct, and the
// intrahepatic trees: portal vein, hepatic veins converging to the IVC, hepatic artery and bile ducts. When the
// camera comes close AND is aimed at the liver, the capsule eases to a fresnel-rim translucency (silhouette and relief
// stay, the centre opens onto the glowing trees); from below it stays nearly opaque so the visceral "H" reads.
// ctx.state.perf: 0 = opaque capsule, no trees; 1 = main trees only; 2 = + fine twigs (all only in close-up).
// States A/B: fatty-liver vertex colours (paint), enlargement (mostly downward / forward, like real hepatomegaly)
// and a greasy gloss — each state has its own OrganMat and its own deformed copy of the geometry.
//
// FIT: every vertex of a state (lobes, gallbladder, ligaments, trees) goes through one smooth, monotone field
// (scale about the bare area -> torso wall / rib cage -> push-out from the stomach, duodenum, colon and the right
// kidney's Gerota capsule (which thickens with fat) -> soft ceiling under the diaphragm's resting dome). Monotone
// soft-min / soft-plus steps never fold the surface and keep the interior trees inside the deformed capsule.
// The neighbours build after the liver, so their reference geometry is copied below (world coordinates).
import { THREE, P, clamp, lerp, smooth, gauss, noise3, rnd, setSeed, deform, vtube, add, LAYER } from '../core/ctx.js';
import { palette, OrganMat, liverVeinTex } from '../core/style.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const liverPos = P(-0.55, -0.3, 0.25);
const ROT_Z = 0.07, CR = Math.cos(ROT_Z), SR = Math.sin(ROT_Z);
const PIVOT = P(0.05, 0.75, -0.6);                // enlargement pivot: bare area under the diaphragm, next to the IVC
const GROW = P(0.06, 0.15, 0.1);                   // enlargement at f = 1 per axis (ribs limit the lateral growth)
const X_FAL = 0.55;                                // liver-space x of the falciform ligament / left sagittal fissure
const GB_FUNDUS = P(-0.42, -0.6, 1.0), GB_NECK = P(-0.16, -0.36, 0.0);
const toW = (x, y, z, o) => o.set(x * CR - y * SR + liverPos.x, x * SR + y * CR + liverPos.y, z + liverPos.z);
const toL = (w, o) => { const x = w.x - liverPos.x, y = w.y - liverPos.y; return o.set(x * CR + y * SR, -x * SR + y * CR, w.z - liverPos.z); };
const wl = (x, y, z) => toL(P(x, y, z), P());      // world -> liver space

/* ---------- neighbours (world coords, copied from digestive.js / kidneys.js / vessels.js) ---------- */
const tabS = (t, u) => {
  if (u <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) if (u <= t[i][0]) return lerp(t[i - 1][1], t[i][1], smooth(t[i - 1][0], t[i][0], u));
  return t[t.length - 1][1];
};
/** a tube neighbour as a sampled centre line with radii (signed distance = distance to the polyline − radius) */
function chain(pts, rFn, n, u0 = 0, u1 = 1) {
  const c = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5), S = [], R = [];
  for (let i = 0; i <= n; i++) { const u = lerp(u0, u1, i / n); S.push(c.getPointAt(u)); R.push(rFn(u)); }
  const box = new THREE.Box3().setFromPoints(S).expandByScalar(Math.max(...R) + 0.45);
  return { S, R, box };
}
const STOMACH_RT = [[0.1, 0.4], [0.3, 0.45], [0.5, 0.45], [0.65, 0.42], [0.8, 0.35], [0.9, 0.28], [0.955, 0.2], [0.975, 0.23], [1, 0.19]];
const COLON_RT = [[0, 0.4], [0.07, 0.4], [0.14, 0.36], [0.6, 0.36], [0.75, 0.33], [0.86, 0.3], [0.93, 0.3], [1, 0.26]];
let OBST;                                           // built in build(): stomach, duodenum, colon (static)
const KID = { m: new THREE.Matrix4(), inv: new THREE.Matrix4(), rot: new THREE.Matrix4() };   // right kidney frame
const KR = [0.42, 0.78, 0.3];
/* inferior vena cava (vessels.js) : the posterior groove is carved along it; hepatic veins drain at HV0 */
const IVC = [P(-0.38, -1.2, -0.85), P(-0.4, -0.2, -0.6), P(-0.4, 0.45, -0.25), P(-0.38, 1.0, 0.3)];
const HV0 = P(-0.4, 0.15, -0.5);
/* extrahepatic vessels owned by neighbours: the liver's hilum connects to their ends */
const PORTAL_END = P(-0.72, -0.62, -0.25), PORTAL_IN = P(-0.6, -0.86, -0.32);   // digestive.js portal vein (last points)
const ARTERY_END = P(-0.6, -0.6, -0.15), ARTERY_IN = P(-0.32, -0.7, -0.39);     // vessels.js common hepatic artery
const CBD_END = P(-0.84, -1.42, -0.04);                                         // posteromedial wall of the duodenum (D2)

/* ---------- shape ---------- */
/** base silhouette: sculpted unit sphere (patient's right = −x, anterior = +z, up = +y), liver space */
export function liverShape(v) {
  v.x *= v.x < 0 ? 1.8 : 1.95; v.y *= 1.2; v.z *= 1.38;
  const t = (v.x + 1.8) / 3.75;                                        // 0 = patient's right edge … 1 = left tip
  v.y *= (1 - 0.6 * smooth(0.22, 0.8, t)) * (1 - 0.3 * smooth(0.78, 1, t));   // dome on the right, wedge to the left
  if (v.z < 0) v.z *= 1 - 0.28 * gauss(v.x, 0.25, 0.55);              // posterior face flattens over the spine / IVC
  v.z *= 1 - 0.45 * smooth(0.5, 1, t);                                 // the left lobe thins toward its tip
  v.z += 0.2 * smooth(0.62, 1, t);                                     // … and drapes forward over the stomach
  if (v.y < 0) v.y *= 0.42 * (1 - 0.35 * smooth(0.35, 0.9, t));         // inferior border rises obliquely to the left
  v.y -= 0.18 * smooth(0, 1.4, v.z) * (v.y < 0 ? 1 : 0.3);           // sharp antero-inferior border
  const fis = gauss(t, (X_FAL + 1.8) / 3.75, 0.045) * smooth(0.1, 1.1, v.z);   // falciform groove (anterior surface)
  v.y -= 0.14 * fis * (v.y > 0 ? 1 : 0.4); v.z *= 1 - 0.08 * fis;
  v.multiplyScalar(1 + 0.012 * noise3(v.x * 4, v.y * 4, v.z * 4));
}

let dark, lift;                                   // per-vertex fissure darkening / lobe highlight 0..1 (paint())
/** second pass: carve the lobe boundaries (visceral "H") along the vertex normals of the base silhouette */
function carve(geo) {
  const pos = geo.attributes.position, nrm = geo.attributes.normal, p = new THREE.Vector3(), n = new THREE.Vector3(), w = new THREE.Vector3();
  const ivc = new THREE.CatmullRomCurve3(IVC), ivcPts = []; for (let i = 0; i <= 40; i++) ivcPts.push(ivc.getPointAt(i / 40));
  dark = new Float32Array(pos.count); lift = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i); n.fromBufferAttribute(nrm, i);
    const under = smooth(-0.1, -0.5, n.y), back = smooth(-0.1, -0.6, n.z), front = clamp(smooth(0.1, 0.6, n.z) + smooth(0.3, 0.8, n.y), 0, 1);
    let d = 0, k = 0;
    /* left sagittal fissure: falciform (anterior/superior), lig. teres (visceral, notch -> porta), lig. venosum (porta -> IVC) */
    const fal = gauss(p.x, X_FAL, 0.07);
    d += 0.12 * fal * front * smooth(-0.3, 0.1, p.z); k += 0.8 * fal * front * smooth(-0.3, 0.1, p.z);
    const teres = gauss(p.x, X_FAL, 0.075) * under * smooth(-0.55, -0.3, p.z);
    d += 0.2 * teres; k += teres;
    const venos = gauss(p.x, X_FAL + 0.04, 0.075) * Math.max(back, under) * smooth(-0.15, -0.55, p.z) * smooth(0.8, 0.2, p.y);
    d += 0.18 * venos; k += venos;
    /* porta hepatis: deep transverse fissure between the sagittal fissures */
    const por = gauss(p.z, -0.4, 0.17) * under * smooth(-0.42, -0.2, p.x) * smooth(X_FAL + 0.05, X_FAL - 0.12, p.x);
    d += 0.3 * por; k += 1.1 * por;
    /* gallbladder fossa (right sagittal line, anterior part) along the gallbladder axis */
    const gx = GB_NECK.x + (GB_FUNDUS.x - GB_NECK.x) * clamp((p.z - GB_NECK.z) / (GB_FUNDUS.z - GB_NECK.z), 0, 1);
    const fos = gauss(p.x, gx, 0.17) * under * smooth(-0.2, 0.05, p.z) * smooth(1.25, 1.0, p.z);
    d += 0.12 * fos; k += 0.6 * fos;
    /* lobes stand proud: caudate (between the IVC groove and the lig. venosum), quadrate (between fossa and lig. teres) */
    const cau = gauss(p.x, 0.36, 0.13) * Math.max(back, under) * smooth(-0.6, -0.75, p.z) * smooth(0.7, 0.3, p.y);
    const qua = gauss(p.x, 0.2, 0.17) * under * smooth(-0.15, 0.05, p.z) * smooth(0.95, 0.7, p.z);
    d -= 0.12 * cau + 0.1 * qua; lift[i] = clamp(cau + qua, 0, 1);
    /* renal (and colic) impressions read as shallow dark hollows on the right lobe's underside */
    k += 0.25 * under * smooth(-0.6, -1.2, p.x);
    p.addScaledVector(n, -d);
    /* IVC groove: the posterior surface is pulled forward to the vein's axis, so the vein lies half-embedded */
    toW(p.x, p.y, p.z, w);
    if (n.z < 0 && w.y > -1.3 && w.y < 1.2) {
      let j = 1; while (j < ivcPts.length - 1 && ivcPts[j].y < w.y) j++;                  // vein axis at this height (interpolated)
      const a = _a.copy(ivcPts[j - 1]).lerp(ivcPts[j], clamp((w.y - ivcPts[j - 1].y) / (ivcPts[j].y - ivcPts[j - 1].y), 0, 1));
      const g = gauss(w.x - a.x, 0, 0.3) * smooth(-0.05, -0.45, n.z) * smooth(-1.3, -0.95, w.y) * smooth(1.2, 0.9, w.y);
      if (w.z < a.z + 0.02) { p.z += Math.min(a.z + 0.02 - w.z, 0.4) * g; k += 0.9 * g; }
    }
    dark[i] = clamp(k, 0, 1);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/* ---------- inside test of the carved base lobes (column intervals along y), used to grow the trees ---------- */
let occ;
function buildOcc(geo) {
  const G = { x0: -2.1, x1: 2.1, z0: -1.6, z1: 1.9, nx: 84, nz: 70 };
  G.dx = (G.x1 - G.x0) / G.nx; G.dz = (G.z1 - G.z0) / G.nz;
  const cols = Array.from({ length: G.nx * G.nz }, () => []);
  const pos = geo.attributes.position, idx = geo.index, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < idx.count; t += 3) {
    a.fromBufferAttribute(pos, idx.getX(t)); b.fromBufferAttribute(pos, idx.getX(t + 1)); c.fromBufferAttribute(pos, idx.getX(t + 2));
    const i0 = Math.max(0, Math.ceil((Math.min(a.x, b.x, c.x) - G.x0) / G.dx - 0.5)), i1 = Math.min(G.nx - 1, Math.floor((Math.max(a.x, b.x, c.x) - G.x0) / G.dx - 0.5));
    const j0 = Math.max(0, Math.ceil((Math.min(a.z, b.z, c.z) - G.z0) / G.dz - 0.5)), j1 = Math.min(G.nz - 1, Math.floor((Math.max(a.z, b.z, c.z) - G.z0) / G.dz - 0.5));
    const d = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z); if (Math.abs(d) < 1e-12) continue;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const px = G.x0 + (i + 0.5) * G.dx + 1.3e-6, pz = G.z0 + (j + 0.5) * G.dz + 2.1e-6;
      const w0 = ((b.z - c.z) * (px - c.x) + (c.x - b.x) * (pz - c.z)) / d, w1 = ((c.z - a.z) * (px - c.x) + (a.x - c.x) * (pz - c.z)) / d;
      if (w0 < 0 || w1 < 0 || w0 + w1 > 1) continue;
      cols[i * G.nz + j].push(w0 * a.y + w1 * b.y + (1 - w0 - w1) * c.y);
    }
  }
  for (const L of cols) L.sort((p, q) => p - q);
  G.cols = cols;
  occ = G;
}
/** depth of p inside the base lobes along y (≥ m above / below the surfaces), also checked at ±m around */
function insideBy(p, m) {
  const G = occ;
  for (const [ox, oz] of [[0, 0], [m, 0], [-m, 0], [0, m], [0, -m]]) {
    const i = Math.round((p.x + ox - G.x0) / G.dx - 0.5), j = Math.round((p.z + oz - G.z0) / G.dz - 0.5);
    if (i < 0 || j < 0 || i >= G.nx || j >= G.nz) return false;
    const L = G.cols[i * G.nz + j]; let ok = false;
    for (let k = 0; k + 1 < L.length; k += 2) if (p.y > L[k] + m && p.y < L[k + 1] - m) { ok = true; break; }
    if (!ok) return false;
  }
  return true;
}
/** move p up/down inside its column (used for tree roots) */
function seat(p, m) {
  for (let s = 0; s < 40; s++) { if (insideBy(p, m)) return p; p.y += 0.02; }
  return p;
}

/* ---------- the fit field: liver space (base) -> liver space (state) ---------- */
const softplus = (x, k) => (x / k > 30 ? x : k * Math.log1p(Math.exp(x / k)));
const softmin = (a, b, k) => b - softplus(b - a, k);
let ceil = null;                                   // diaphragm resting dome sampled at build (lean, end-expiration)
function ceilAt(x, z) {
  const G = ceil;
  if (!G) return x < -1.5 ? 0.2 : 0.75;
  const fx = clamp((x - G.x0) / G.d, 0, G.nx - 1.001), fz = clamp((z - G.z0) / G.d, 0, G.nz - 1.001);
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, Y = G.y, n = G.nz;
  return lerp(lerp(Y[i * n + j], Y[i * n + j + 1], v), lerp(Y[(i + 1) * n + j], Y[(i + 1) * n + j + 1], v), u);
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _w = new THREE.Vector3();
/** signed distance of w to a chain neighbour (sets _c to the closest centre-line point) */
function chainDist(w, O) {
  let best = 1e9, bi = 0, bt = 0;
  const S = O.S;
  for (let i = 0; i + 1 < S.length; i++) {
    _a.subVectors(S[i + 1], S[i]); const L2 = _a.lengthSq();
    const t = clamp(_b.subVectors(w, S[i]).dot(_a) / L2, 0, 1);
    _c.copy(S[i]).addScaledVector(_a, t);
    const d = w.distanceTo(_c) - lerp(O.R[i], O.R[i + 1], t);
    if (d < best) { best = d; bi = i; bt = t; }
  }
  _c.copy(S[bi]).lerp(S[bi + 1], bt);
  return best;
}
/** push w out of a neighbour by a soft margin. Organs the liver lies ON (colon, duodenum, kidney) push straight up:
 *  y' = y + softplus(m − d(y)) is monotone in y (|∂d/∂y| ≤ 1, slope of softplus < 1), so a column of the liver keeps
 *  its order and the thin anterior border cannot fold over itself; the stomach (beside the left lobe) pushes along its
 *  outward normal. Two passes let points deep inside climb all the way out. */
function pushChain(w, O, m, k) {
  if (!O.box.containsPoint(w)) return;
  for (let pass = 0; pass < (O.up ? 2 : 1); pass++) {
    const d = chainDist(w, O);
    if (d > m + 6 * k) return;
    if (O.up) { w.y += softplus(m - d, k); continue; }
    _a.subVectors(w, _c); const l = _a.length(); if (l < 1e-6) return;
    w.addScaledVector(_a, softplus(m - d, k) / l);
  }
}
function pushKidney(w, th, m, k) {
  const rx = KR[0] + th, ry = KR[1] + 0.95 * th, rz = KR[2] + 1.2 * th;
  for (let pass = 0; pass < 2; pass++) {
    _a.copy(w).applyMatrix4(KID.inv);
    const k0 = Math.hypot(_a.x / rx, _a.y / ry, _a.z / rz), k1 = Math.hypot(_a.x / (rx * rx), _a.y / (ry * ry), _a.z / (rz * rz));
    const d = k0 * (k0 - 1) / k1;
    if (d > m + 6 * k) return;
    w.y += softplus(m - d, k);
  }
}
/** state parameters for the field: scale, torso wall radii, Gerota thickness. The wall ellipse is the narrowest inner
 *  torso section over the liver's height (one ellipse for all heights: a height-dependent clamp would shear the thin
 *  anterior border) */
function fieldParams(f, body) {
  const e = clamp(f, 0, 1), F = { sx: 1 + GROW.x * e, sy: 1 + GROW.y * e, sz: 1 + GROW.z * e, th: 0.05 + 0.38 * e, rx: 2.3, rz: 1.6 };
  const tr = C.anchors.torsoRadii, b = body || C.state.body;
  if (tr) for (let y = -1.3; y <= 0.9; y += 0.1) {
    const [rx, rz] = tr(y, b.W, b.Wz, (b.d || 0) + 0.13);
    F.rx = Math.min(F.rx, rx); F.rz = Math.min(F.rz, rz);
  }
  return F;
}
function field(x, y, z, F, out) {
  x = PIVOT.x + F.sx * (x - PIVOT.x); y = PIVOT.y + F.sy * (y - PIVOT.y); z = PIVOT.z + F.sz * (z - PIVOT.z);
  const w = toW(x, y, z, _w);
  /* torso wall / rib cage: radial soft clamp in the horizontal plane */
  const rho = Math.hypot(w.x / F.rx, w.z / F.rz);
  if (rho > 0.8) { const r2 = softmin(rho, 1, 0.035); w.x *= r2 / rho; w.z *= r2 / rho; }
  /* neighbours below / beside: stomach, duodenum, hepatic flexure of the colon, right kidney in its fat capsule */
  for (const O of OBST) pushChain(w, O, O.m, 0.035);
  pushKidney(w, F.th, 0.05, 0.035);
  /* resting diaphragm dome above (gap covers the inspiratory descent relative to the abdomen) */
  w.y = softmin(w.y, ceilAt(w.x, w.z) - 0.08, 0.07);
  return toL(w, out);
}

/* ---------- colours ---------- */
let C, noise, root, A, B, lastA = -1, lastB = -1, lastBodyA = '';
const cHealthy = new THREE.Color(palette.liverHealthy), cFatty = new THREE.Color(palette.liverFatty), cSpots = new THREE.Color(palette.liverSpots);
const cSheen = new THREE.Color(palette.liverSheen), cFattySheen = new THREE.Color(palette.liverFattySheen);
const cLeanSheen = cHealthy.clone().lerp(cSheen, 0.35);
const cHV = new THREE.Color(palette.hepaticVein), cPV = new THREE.Color(palette.portalVein), cDeoxy = new THREE.Color(palette.bloodDeoxy);

/** paint fatty-liver colours: e = f^1.35 -> pale, blotchy; fissures and impressions are darkened */
export function paint(geo, e) {
  const col = geo.attributes.color, c = new THREE.Color();
  for (let i = 0; i < noise.length; i++) {
    const n = noise[i];
    c.copy(cHealthy).lerp(cFatty, clamp(0.92 * smooth(0.1, 0.85, e) + n * 0.25 * e, 0, 1));   // lean stays deep red
    if (n > 0.35) c.lerp(cSpots, clamp((n - 0.35) * 2.2 * e * e, 0, 0.8));
    c.multiplyScalar((0.92 + 0.12 * n) * (1 - 0.72 * dark[i]) * (1 + 0.28 * lift[i]));
    col.setXYZ(i, c.r, c.g, c.b);
  }
  col.needsUpdate = true;
}
/** healthy liver: deep dark red, satin; fatty liver: greasy — clearcoat up, roughness down, pale sheen */
function gloss(mat, e) {
  mat.roughness = lerp(0.42, 0.14, e); mat.clearcoat = lerp(0.55, 1, e); mat.clearcoatRoughness = lerp(0.32, 0.15, e);
  mat.sheen = lerp(0.12, 0.95, e); mat.sheenRoughness = lerp(0.6, 0.3, e);
  mat.sheenColor.copy(cLeanSheen).lerp(cFattySheen, e);
}
/* always in the transparent pass (one shader variant, no recompile when fading) but drawn first (renderOrder −5) with
 * depth write: exactly an opaque organ at opacity 1; when faded the opaque trees inside show through, while translucent
 * shells behind the liver (lungs, ribs, back skin) stay hidden instead of painting over it (tested both: with depth write
 * off the lung bases and the back skin wash the faded liver out completely) */
function lobeMat() {
  const m = OrganMat(palette.white, { vertexColors: true, map: liverVeinTex, sheenColor: cSheen.clone(), emissiveIntensity: 0, transparent: true, opacity: 1, depthWrite: true });
  /* close-up translucency with a fresnel rim: the silhouette and the lobe relief stay readable, the centre opens up
   * onto the vessel trees (uFade 0 = opaque organ, uMin = alpha where the surface faces the camera) */
  const U = m.userData.U = { uFade: { value: 0 }, uMin: { value: 0.4 } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <clipping_planes_pars_fragment>', '#include <clipping_planes_pars_fragment>\nuniform float uFade, uMin;')
      .replace('#include <opaque_fragment>', `
        float rimF = pow(clamp(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0), 1.7);   // clamped: pow(<0) is NaN
        outgoingLight += diffuseColor.rgb * (0.25 * rimF * uFade);
        diffuseColor.a *= mix(1.0, uMin + (1.0 - uMin) * rimF, uFade);
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'liverCapsule';
  return m;
}

/* ---------- vascular trees (grown once in base liver space, deformed per state) ---------- */
/** recursive branch grower. lvl 0/1 -> T.main, lvl >= 2 -> T.detail (visible only in close-up, perf 2) */
function grow(T, p0, dir, len, r, depth, lvl) {
  const pts = [p0.clone()], d = dir.clone().normalize(); let p = p0.clone();
  const jit = lvl === 0 ? 0.12 : 0.3;
  for (let i = 1; i <= 3; i++) {
    d.add(P(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(jit)).normalize();
    let q = p.clone().addScaledVector(d, len / 3);
    if (!insideBy(q, 0.05 + r)) {                   // bend back into the organ: try shorter / steered steps
      let ok = false;
      for (const s of [0.66, 0.4]) {
        const t = p.clone().addScaledVector(d, s * len / 3);
        if (insideBy(t, 0.05 + r)) { q = t; ok = true; break; }
      }
      if (!ok) { if (pts.length < 2) pts.push(p.clone().addScaledVector(d, 0.02)); break; }
    }
    p = q; pts.push(p);
  }
  if (pts.length < 2) return;
  const store = lvl >= 2 ? T.detail : T.main;
  store.push(vtube(pts.length < 3 ? [pts[0], pts[0].clone().lerp(pts[1], 0.5), pts[1]] : pts, (u) => r * (1 - 0.36 * u), 12, lvl >= 2 ? 6 : 8, 0.5));
  if (depth > 0 && pts.length === 4) {
    const end = pts[3], n = rnd() < 0.35 ? 3 : 2;
    const ax = d.clone().cross(P(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5)).normalize();
    for (let k = 0; k < n; k++) {
      const ang = (k - (n - 1) / 2) * (0.75 + rnd() * 0.35) + (rnd() - 0.5) * 0.3;
      grow(T, end, d.clone().applyAxisAngle(ax, ang).applyAxisAngle(d, rnd() * 1.2 - 0.6), len * 0.68, r * 0.64, depth - 1, lvl + 1);
    }
    const s = new THREE.SphereGeometry(r * 0.64, 7, 5); s.translate(end.x, end.y, end.z);   // hides the open tube ends
    (lvl + 1 >= 2 ? T.detail : T.main).push(s);
  }
}
function tree(roots) {
  const T = { main: [], detail: [] };
  for (const [p0, dir, len, r, depth] of roots) grow(T, p0, dir, len, r, depth, 0);
  return { main: mergeGeometries(T.main), detail: T.detail.length ? mergeGeometries(T.detail) : null };
}

/* ---------- falciform ligament: sickle-shaped translucent sheet along the anterior groove + round ligament ---------- */
function falciform() {
  const N = 28, att = [], free = [], sag = P(0, 0.15, 0.1), ux = X_FAL / 1.95;
  for (let i = 0; i <= N; i++) {
    const a = lerp(-0.75, 2.35, i / N), u = P(ux, Math.sqrt(1 - ux * ux) * Math.cos(a), Math.sqrt(1 - ux * ux) * Math.sin(a));
    liverShape(u);
    const n = P(0, u.y - sag.y, u.z - sag.z).normalize(), w = 0.42 * Math.pow(Math.sin(Math.PI * i / N), 0.7);
    att.push(u.clone().addScaledVector(n, -0.2)); free.push(u.clone().addScaledVector(n, w));    // attached edge sits in the carved fissure
  }
  const g = new THREE.BufferGeometry(), pos = [], uv = [], idx = [];
  for (let i = 0; i <= N; i++) { pos.push(att[i].x, att[i].y, att[i].z, free[i].x, free[i].y, free[i].z); uv.push(i / N, 0, i / N, 1); }
  for (let i = 0; i < N; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  g.setIndex(idx); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  /* round ligament: along the free edge from the umbilicus to the notch, then in the fissure on the visceral face */
  const cord = free.slice(19);
  const s = Math.sqrt(1 - ux * ux);
  for (let k = 1; k <= 6; k++) { const zz = (0.78 - k * 0.14) * s, u = P(ux, -Math.sqrt(Math.max(0, 1 - ux * ux - zz * zz)), zz); liverShape(u); u.y -= 0.12; cord.push(u); }
  return { sheet: g, cord: vtube(cord, (u) => 0.034 * (1 - 0.3 * u), 48, 7, 0.4) };
}

/* ---------- gallbladder: pear along its fossa, fundus peeking below the inferior border ---------- */
function gallbladderGeo() {
  const g = deform(new THREE.SphereGeometry(1, 28, 22), (v) => {
    const k = 1 - 0.58 * smooth(-0.2, 1, v.y);
    v.x *= 0.2 * k; v.z *= 0.2 * k; v.y *= 0.56;
    v.multiplyScalar(1 + 0.02 * noise3(v.x * 9, v.y * 9, v.z * 9));
  });
  const q = new THREE.Quaternion().setFromUnitVectors(P(0, 1, 0), GB_NECK.clone().sub(GB_FUNDUS).normalize());
  const c = GB_FUNDUS.clone().lerp(GB_NECK, 0.5); c.y += 0.03;
  g.applyQuaternion(q); g.translate(c.x, c.y, c.z);
  return g;
}

/* ---------- state copies ---------- */
let portalMat, hvMat, artMat, bileMat, gbMat, detailMats = [], base, trunkPts;
/** a deformable mesh of a state: geometry copy + its base positions (shared) */
function part(S, list, geo, mat, parent, opts = {}) {
  const g = opts.share ? geo : geo.clone();
  const m = add(g, mat, parent, 'liver'); m.layers.set(S.layer);
  list.push({ geo: g, base: geo.userData.base || (geo.userData.base = Float32Array.from(geo.attributes.position.array)), normals: !!opts.normals });
  if (opts.order !== undefined) m.renderOrder = opts.order;
  return m;
}
function makeState(layer) {
  const S = { layer, surf: [], trees: [], f: -1, treesDirty: true };
  S.g = new THREE.Group(); root.add(S.g);
  /* lobes */
  S.mat = lobeMat();
  S.lobes = part(S, S.surf, base.lobes, S.mat, S.g, { normals: true, order: -5 });
  S.geo = S.lobes.geometry;
  S.geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(noise.length * 3), 3));
  /* falciform ligament sheet + round ligament, gallbladder */
  part(S, S.surf, base.falc.sheet, base.sheetMat, S.g, { normals: true });
  part(S, S.surf, base.falc.cord, base.cordMat, S.g);
  part(S, S.surf, base.gb, gbMat, S.g, { normals: true });
  /* hilum + intrahepatic trees (visible in close-up only); detail twigs fade in (perf 2) */
  S.tg = new THREE.Group(); S.g.add(S.tg); S.tg.visible = false;
  part(S, S.trees, base.cystic, bileMat, S.tg);
  for (const [tr, mat] of [[base.portal, portalMat], [base.hv, hvMat], [base.art, artMat], [base.bile, bileMat]]) part(S, S.trees, tr.main, mat, S.tg);
  S.detail = new THREE.Group(); S.tg.add(S.detail); S.detail.visible = false;
  for (const [tr, mat] of [[base.portal, detailMats[0]], [base.hv, detailMats[1]], [base.art, detailMats[2]], [base.bile, detailMats[3]]]) {
    if (tr.detail) part(S, S.trees, tr.detail, mat, S.detail, { order: -6 });     // drawn before the capsule
  }
  /* extrahepatic connections to the neighbours' vessels (rebuilt when the state changes): portal vein, artery, bile duct */
  S.conn = [[portalMat, 0.085, 'portal'], [artMat, 0.04, 'art'], [bileMat, 0.034, 'cbd']].map(([mat, r, k]) => {
    const m = add(new THREE.BufferGeometry(), mat, k === 'portal' ? S.g : S.tg, 'liver'); m.layers.set(layer); return { m, r, k };
  });
  S.g.traverse((o) => o.layers.set(layer));
  return S;
}
const _p = new THREE.Vector3();
function deformList(list, F) {
  for (const it of list) {
    const pos = it.geo.attributes.position, a = pos.array, b = it.base;
    for (let i = 0; i < b.length; i += 3) { field(b[i], b[i + 1], b[i + 2], F, _p); a[i] = _p.x; a[i + 1] = _p.y; a[i + 2] = _p.z; }
    pos.needsUpdate = true;
    if (it.normals) it.geo.computeVertexNormals();
    it.geo.computeBoundingSphere();
  }
}
/** extrahepatic segments: static neighbour end (world) -> deformed hilum point (liver space) */
function layConnectors(S, F) {
  const end = (k) => field(trunkPts[k].x, trunkPts[k].y, trunkPts[k].z, F, P());
  const L = {
    portal: [wl(PORTAL_IN.x, PORTAL_IN.y, PORTAL_IN.z), wl(PORTAL_END.x, PORTAL_END.y, PORTAL_END.z), end('portal')],
    art: [wl(ARTERY_IN.x, ARTERY_IN.y, ARTERY_IN.z), wl(ARTERY_END.x, ARTERY_END.y, ARTERY_END.z), end('art')],
    cbd: [end('bile'), end('cbdMid'), wl(CBD_END.x + 0.06, CBD_END.y + 0.25, CBD_END.z - 0.06), wl(CBD_END.x, CBD_END.y, CBD_END.z)],
  };
  for (const c of S.conn) {
    const pts = L[c.k];
    if (c.k !== 'cbd') { const a = pts[1], b = pts[2]; pts.splice(2, 0, a.clone().lerp(b, 0.5).add(P(0, 0.03, 0))); }
    const g = vtube(pts, () => c.r, 16, 8, 0.5);
    c.m.geometry.dispose(); c.m.geometry = g;
  }
}
function relay(S, f, body) {
  const e = Math.pow(clamp(f, 0, 1), 1.35);
  S.F = fieldParams(f, body); S.f = f;
  deformList(S.surf, S.F); layConnectors(S, S.F); S.treesDirty = true;
  paint(S.geo, e); gloss(S.mat, e);
  if (S.tg.visible) relayTrees(S);
}
function relayTrees(S) { deformList(S.trees, S.F); S.treesDirty = false; }

export function build(ctx) {
  C = ctx;
  const ab = ctx.groups.abdomen;
  root = new THREE.Group(); root.position.copy(liverPos); root.rotation.z = ROT_Z; ab.add(root);

  /* neighbours: diaphragm resting dome (lungs.js builds before the liver; at build time the dome is lean + end-expiration) */
  if (ctx.anchors.diaphragmY) {
    const G = { x0: -2.9, z0: -1.9, d: 0.08, nx: 66, nz: 56, y: new Float32Array(66 * 56) };
    for (let i = 0; i < G.nx; i++) for (let j = 0; j < G.nz; j++) G.y[i * G.nz + j] = ctx.anchors.diaphragmY(G.x0 + i * G.d, G.z0 + j * G.d);
    ceil = G;
  }
  OBST = [
    Object.assign(chain([P(1.56, 0.2, -0.34), P(1.65, -0.12, -0.26), P(1.8, -0.56, -0.05), P(1.8, -0.95, 0.2), P(1.42, -1.18, 0.42), P(0.85, -1.3, 0.6), P(0.25, -1.2, 0.7), P(-0.32, -1.0, 0.68)],
      (u) => (u < 0.1 ? 0.4 * Math.sqrt(Math.max(0, 1 - ((0.1 - u) / 0.1) ** 2)) : tabS(STOMACH_RT, u)), 70), { m: 0.06 }),        // stomach
    Object.assign(chain([P(-0.32, -1.0, 0.68), P(-0.72, -1.02, 0.52), P(-0.98, -1.18, 0.25), P(-1.04, -1.55, 0.08), P(-0.92, -1.92, -0.02)], () => 0.205, 30), { m: 0.05, up: true }),   // duodenum
    Object.assign(chain([P(-1.9, -3.5, 0.55), P(-1.95, -3.05, 0.6), P(-1.98, -2.55, 0.62), P(-1.97, -2.05, 0.66), P(-1.92, -1.6, 0.7), P(-1.7, -1.3, 0.8),
      P(-1.1, -1.7, 1.0), P(-0.4, -2.1, 1.06), P(0.4, -2.22, 1.06)], (u) => 1.16 * tabS(COLON_RT, u * 0.4), 50, 0.25, 1), { m: 0.05, up: true }),      // ascending colon, hepatic flexure
  ];
  KID.rot.makeRotationFromEuler(new THREE.Euler(0, -0.35, -0.17));
  KID.m.copy(KID.rot).setPosition(-1.22, -1.6, -1.12); KID.inv.copy(KID.m).invert();

  /* lobes: silhouette, then lobe boundaries carved along the normals; per-vertex blotch noise */
  const lobes = carve(deform(new THREE.SphereGeometry(1, 96, 72), liverShape));
  const pos = lobes.attributes.position; noise = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++)
    noise[i] = noise3(pos.getX(i) * 6.3, pos.getY(i) * 6.3, pos.getZ(i) * 6.3) * 0.5 + 0.5 * noise3(pos.getX(i) * 15, pos.getY(i) * 15, pos.getZ(i) * 15);
  buildOcc(lobes);

  /* vessel materials (shared by A/B); detail twigs fade with the close-up */
  const vm = (c) => OrganMat(c, { roughness: 0.3, clearcoat: 0.9, bumpScale: 0.2, emissiveIntensity: 0.1 });
  portalMat = vm(palette.portalVein); hvMat = vm(palette.hepaticVein); artMat = vm(palette.hepaticArtery); bileMat = vm(palette.bileDuct);
  detailMats = [palette.portalVein, palette.hepaticVein, palette.hepaticArtery, palette.bileDuct].map((c) => OrganMat(c, { roughness: 0.3, clearcoat: 0.9, bumpScale: 0.2, emissiveIntensity: 0.1, transparent: true, opacity: 0, depthWrite: false }));
  gbMat = OrganMat(palette.gallbladder, { clearcoat: 0.95, roughness: 0.22, clearcoatRoughness: 0.12, emissiveIntensity: 0.1 });

  /* tree roots, seated inside the carved lobes: portal vein at the end of digestive.js' portal vein, artery at the end of
   * vessels.js' common hepatic artery, hepatic veins at the IVC (vessels.js HV0), bile ducts just in front of the porta */
  const pRoot = seat(wl(PORTAL_END.x, PORTAL_END.y + 0.05, PORTAL_END.z + 0.05), 0.07);
  const aRoot = seat(wl(ARTERY_END.x, ARTERY_END.y + 0.04, ARTERY_END.z), 0.05);
  const bRoot = seat(wl(-0.52, -0.56, -0.08), 0.05);
  const hRoot = wl(HV0.x, HV0.y, HV0.z);
  trunkPts = { portal: pRoot, art: aRoot, bile: bRoot, cbdMid: P(bRoot.x - 0.14, bRoot.y - 0.3, bRoot.z - 0.02) };
  setSeed(4201);
  const hvDir = (x, y, z) => wl(x, y, z).sub(hRoot);
  base = {
    lobes,
    portal: tree([[pRoot, P(-1, 0.25, 0.3), 0.85, 0.075, 3], [pRoot, P(1, 0.3, 0.45), 0.8, 0.065, 3], [pRoot, P(0.5, 0.4, -0.5), 0.35, 0.03, 1]]),
    hv: tree([[hRoot, hvDir(-1.7, -0.3, 0.15), 0.95, 0.07, 2], [hRoot, hvDir(-0.7, -0.5, 0.45), 0.8, 0.06, 2], [hRoot, hvDir(0.45, -0.35, 0.3), 0.75, 0.055, 2]]),
    art: tree([[aRoot, P(-1, 0.4, 0.4), 0.75, 0.034, 2], [aRoot, P(1, 0.45, 0.35), 0.7, 0.03, 2]]),
    bile: tree([[bRoot, P(-1, 0.3, 0.4), 0.7, 0.03, 1], [bRoot, P(1, 0.35, 0.3), 0.65, 0.028, 1]]),
    falc: falciform(),
    gb: gallbladderGeo(),
    cystic: vtube([GB_NECK.clone().add(P(0.02, 0.02, -0.04)), P(-0.12, -0.42, -0.08), P(-0.06, -0.52, -0.06), trunkPts.cbdMid.clone().lerp(bRoot, 0.4)], () => 0.026, 20, 7),
    sheetMat: OrganMat(palette.ligament, { transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false, roughness: 0.55, sheen: 0.5, clearcoat: 0.25, emissiveIntensity: 0 }),
    cordMat: OrganMat(palette.ligament, { roughness: 0.45, sheen: 0.3, clearcoat: 0.4 }),
  };
  A = makeState(LAYER.A); B = makeState(LAYER.B);
  relay(A, ctx.state.fTgt, ctx.state.body); relay(B, ctx.state.fB, ctx.state.bodyB);

  ctx.anchors.liverPos = liverPos;
  ctx.anchors.liverG = root;
  ctx.anchors.portaPos = toW(pRoot.x, pRoot.y, pRoot.z, P());
}

/* ---------- per frame ---------- */
const tmp = new THREE.Vector3();
let near = 0, lastT = -1, lastSat = -1, prevF = -1;
export function update(f, t, phys) {
  const st = C.state, dt = lastT < 0 ? 0 : clamp(t - lastT, 0, 0.4); lastT = t;
  /* state A: relay while f moves by > 0.006, plus a final exact relay once the slider has settled */
  const b = st.body, bodyKey = `${b.W.toFixed(3)}|${b.Wz.toFixed(3)}|${(b.d || 0).toFixed(3)}`;
  const settled = Math.abs(f - prevF) < 1e-5; prevF = f;
  if (Math.abs(f - lastA) > 0.006 || ((Math.abs(f - lastA) > 1e-4 || bodyKey !== lastBodyA) && settled)) { relay(A, f, b); lastA = f; lastBodyA = bodyKey; }
  if (st.bVersion !== lastB) { relay(B, st.fB, st.bodyB); lastB = st.bVersion; }

  /* close-up: when the camera is near AND aimed at the liver, ease the capsule to a translucent look and let the
   * vessels glow; from below the liver the capsule stays nearly opaque so the visceral relief (the "H") reads */
  const perf = st.perf ?? 2;
  root.getWorldPosition(tmp);
  const aim = smooth(2.0, 1.0, C.controls.target.distanceTo(tmp));
  const want = perf > 0 ? smooth(15, 10.5, C.camera.position.distanceTo(tmp)) * aim : 0;   // half-open in the liver view, fully open when zooming in
  near = Math.abs(near - want) < 1e-3 ? want : lerp(near, want, 1 - Math.exp(-dt * 3.5));
  const below = smooth(-0.2, -0.9, C.camera.position.y - tmp.y), aMin = lerp(0.68, 0.88, below);   // keep the organ solid enough to read behind the skin shells
  const glow = 0.1 + 0.8 * near, showTrees = near > 0.03;
  for (const S of [A, B]) {
    S.mat.userData.U.uFade.value = near; S.mat.userData.U.uMin.value = aMin;
    S.tg.visible = showTrees; S.detail.visible = showTrees && perf > 1;
    if (showTrees && S.treesDirty && S.F) relayTrees(S);
  }
  portalMat.emissiveIntensity = glow; hvMat.emissiveIntensity = glow; bileMat.emissiveIntensity = glow * 0.8;
  artMat.emissiveIntensity = glow * (1 + 0.6 * (phys.ventricularPulse || 0));
  for (const m of detailMats) m.opacity = near;

  /* blood colour follows oxygen saturation (sleep scene / apnea): venous blood turns darker purple */
  const sat = clamp(((phys.spo2 ?? 97) - 85) / 12, 0, 1);
  if (Math.abs(sat - lastSat) > 0.01) {
    lastSat = sat;
    hvMat.color.copy(cHV).lerp(cDeoxy, (1 - sat) * 0.6); portalMat.color.copy(cPV).lerp(cDeoxy, (1 - sat) * 0.4);
    detailMats[0].color.copy(portalMat.color); detailMats[1].color.copy(hvMat.color);
  }
}
