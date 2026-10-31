// organs/fat.js — visceral fat, built twice (state A on layer 1, state B on layer 2):
//   epicardial : lobules sitting ON the heart surface (heartSurf + its normal), AV / interventricular grooves first;
//                the lobules on the anterior lid shrink away with the heart's cut-away (the AV groove ring stays)
//   omentum    : three stacked, rippled translucent sheets hanging from the greater curvature of the stomach in front
//                of the transverse colon, lobules packed between the layers, gastro-epiploic arcade + descending
//                vessels (re-laid on the sheet, never rebuilt); lobules are squeezed between the colon and the wall
//   mesentery  : fan membrane from the posterior root to the small-bowel loops (deflected behind the loops),
//                radiating vessels + arcades, fat along the vessels first, then everywhere; omental appendices on the colon
//   perirenal  : lobules on the kidney surface in the kidney's own frame, fitted at build time to stay inside the
//                0.5 x 0.86 x 0.4 capsule; the camera-facing half shrinks away with the kidney's coronal cut-away
// Lobules are InstancedMesh pairs (coarse 24-tri / detail 64-tri geometry sharing ONE instance buffer); the detail set
// switches with hysteresis and the vessel twigs fade with camera distance; ctx.state.perf 0 keeps coarse lobules only.
// Everything is a continuous function of f: lobules grow from zero scale, sheets lengthen / thicken / ripple, vessels
// thicken — nothing pops or rebuilds. Per-frame cost: every e-independent term of the membranes is precomputed per
// vertex at build; the relay only does a few multiplies + one table-based wall lookup per vertex, grid normals, and
// samples the laid anterior sheet bilinearly for lobules and vessel rings.
// Consumes anchors: heartSurf, ventG, heartPos, colonCurve, siCurve, kidneyPos, wallSampler (body) and, when present,
// heartCut (0..1), colonRadius(u), kidneyCutWindow — each with a local fallback (see build / update).
import { THREE, P, clamp, lerp, smooth, noise3, rnd, setSeed, add, LAYER } from '../core/ctx.js';
import { palette, OrganMat, fatColors, GLOSS } from '../core/style.js';
import { wallSampler } from './body.js';

// (soft lobule finish merged into core/style.js as GLOSS.fatSoft — no STYLE-REQUEST outstanding)

const N = { epi: 760, om: 900, mes: 900, pr: 360 };          // lobule instances per state (<= 2920 total)
const OM = { cols: 60, rows: 44 }, OMD = { cols: 30, rows: 22 }, MES = { cols: 40, rows: 28 };   // anterior / deep omentum sheets, mesentery
const NEAR_IN = 15, NEAR_OUT = 17, TWIG_FAR = 18, TWIG_NEAR = 14;   // LOD hysteresis + twig fade (camera distance to the trunk)
const TRUNK = P(0, -0.6, 0.6);
const CAPSULE = [0.5, 0.86, 0.4], KIDNEY = [0.43, 0.78, 0.31];      // task capsule / cortex half-extents (kidney-local)
const KIDNEY_CLOSE = 7.6;                                            // organs/kidneys.js opens its coronal cut below this distance
const SI_R = 0.17;                                                   // small-bowel tube radius (maximum, incl. peristaltic bulge)
/* heart cut-away plane (heart-local, identical to organs/heart.js): the anterior lid is p·HCUT_N > HCUT_D */
const HCUT_N = P(0, 0.315, 1).normalize(), HCUT_D = 0.153, HEART_POS = P(0.38, 1.5, 0.55);

let C, dummy, lobMat, twigMat, geoLo, geoHi;
const epi = [], om = [], mes = [], pr = [], kid = [];
let setA, setB, lastA = -1, lastKeyA = '', lastB = -1, near = null, lastNear = null, lastT = 0, hcut = 0, lastHcut = -1, lastPerf = -1;
const detail = [], coarse = [], twigs = [], deepSheets = [];
const _v = new THREE.Vector3(), _m = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _t = new THREE.Vector3(), _n1 = new THREE.Vector3(), _n2 = new THREE.Vector3(), _d = new THREE.Vector3();
const Y_AXIS = new THREE.Vector3(0, 1, 0), qA = new THREE.Quaternion(), qS = new THREE.Quaternion();
const byThr = (arr) => arr.sort((a, b) => a.thr - b.thr);
/** polynomial smooth minimum (continuous wall clamp) */
const smin = (a, b, k) => { const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1); return lerp(b, a, h) - k * h * (1 - h); };
const smax = (a, b, k) => -smin(-a, -b, k);
/** align the lobule's short axis (local Y) with n, then spin it around n */
function orient(n, spin) { qA.setFromUnitVectors(Y_AXIS, n); qS.setFromAxisAngle(Y_AXIS, spin); dummy.quaternion.copy(qA).multiply(qS); }

/* ---------- lobule geometry + instanced pairs (coarse / detail share the instance buffer) ---------- */
function lobuleGeo(ws, hs) {
  const g = new THREE.SphereGeometry(1, ws, hs);
  g.scale(1, 0.82, 0.92);
  const pos = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); v.multiplyScalar(1 + 0.07 * noise3(v.x * 2.3, v.y * 2.3, v.z * 2.3)); pos.setXYZ(i, v.x, v.y, v.z); }
  g.computeVertexNormals();
  return g;
}
function makePair(count, parent, layer, key) {
  const lo = new THREE.InstancedMesh(geoLo, lobMat, count), hi = new THREE.InstancedMesh(geoHi, lobMat, count);
  lo.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) { c.copy(fatColors[rnd() < 0.8 ? Math.floor(rnd() * 3) : 3 + Math.floor(rnd() * 2)]).multiplyScalar(0.92 + 0.14 * rnd()); lo.setColorAt(i, c); }
  hi.instanceMatrix = lo.instanceMatrix; hi.instanceColor = lo.instanceColor;
  for (const m of [lo, hi]) { m.count = 0; m.frustumCulled = false; m.layers.set(layer); if (key) m.userData.key = key; parent.add(m); }
  coarse.push(lo); detail.push(hi);
  return { lo, hi };
}
/** place instances whose threshold is below the fat level; each one eases in from zero scale over a 0.07 window */
function layInst(pair, list, e, place) {
  let n = 0; const lim = e * 1.05 + 0.07;
  for (const p of list) {
    if (p.thr > lim) break;
    const a = clamp((e * 1.05 - p.thr) / 0.07 + 1, 0, 1);
    if (a <= 0.01) continue;
    place(p, Math.pow(a, 0.6)); dummy.updateMatrix(); pair.lo.setMatrixAt(n++, dummy.matrix);
  }
  pair.lo.count = pair.hi.count = n; pair.lo.instanceMatrix.needsUpdate = true;
}

/* ---------- deformable grid sheets ---------- */
function makeSheet(cols, rows, mat, parent, layer, key, order, sphere) {
  const geo = new THREE.PlaneGeometry(1, 1, cols, rows);
  geo.attributes.position.setUsage(THREE.DynamicDrawUsage); geo.attributes.normal.setUsage(THREE.DynamicDrawUsage);
  geo.boundingSphere = sphere.clone();                                   // conservative, never recomputed
  const mesh = add(geo, mat, parent, key); mesh.renderOrder = order; mesh.layers.set(layer); mesh.frustumCulled = false;
  return { geo, mesh, cols, rows, pos: geo.attributes.position.array, nor: geo.attributes.normal.array, st: null };
}
/** grid normals n = cross(d/dv, d/du) (faces +z for a sheet whose u runs +x and v runs down) */
function gridNormals(sh) {
  const { cols, rows, pos, nor } = sh, W = cols + 1;
  for (let r = 0; r <= rows; r++) {
    const r0 = Math.max(0, r - 1) * W, r1 = Math.min(rows, r + 1) * W;
    for (let c = 0; c <= cols; c++) {
      const a = (r * W + Math.min(cols, c + 1)) * 3, b = (r * W + Math.max(0, c - 1)) * 3, dn = (r1 + c) * 3, up = (r0 + c) * 3;
      const ux = pos[a] - pos[b], uy = pos[a + 1] - pos[b + 1], uz = pos[a + 2] - pos[b + 2];
      const vx = pos[dn] - pos[up], vy = pos[dn + 1] - pos[up + 1], vz = pos[dn + 2] - pos[up + 2];
      let nx = vy * uz - vz * uy, ny = vz * ux - vx * uz, nz = vx * uy - vy * ux;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      const i = (r * W + c) * 3; nor[i] = nx / l; nor[i + 1] = ny / l; nor[i + 2] = nz / l;
    }
  }
  sh.geo.attributes.position.needsUpdate = true; sh.geo.attributes.normal.needsUpdate = true;
}
/** bilinear sample of a laid sheet: position and (anterior-facing) normal at (u, v) */
function sampleGrid(sh, u, v, outP, outN) {
  const { cols, rows, pos, nor } = sh, W = cols + 1;
  const fu = clamp(u, 0, 1) * cols, fv = clamp(v, 0, 1) * rows;
  const c = Math.min(cols - 1, fu | 0), r = Math.min(rows - 1, fv | 0), du = fu - c, dv = fv - r;
  const i00 = (r * W + c) * 3, i10 = i00 + 3, i01 = i00 + W * 3, i11 = i01 + 3;
  const w00 = (1 - du) * (1 - dv), w10 = du * (1 - dv), w01 = (1 - du) * dv, w11 = du * dv;
  outP.set(pos[i00] * w00 + pos[i10] * w10 + pos[i01] * w01 + pos[i11] * w11,
    pos[i00 + 1] * w00 + pos[i10 + 1] * w10 + pos[i01 + 1] * w01 + pos[i11 + 1] * w11,
    pos[i00 + 2] * w00 + pos[i10 + 2] * w10 + pos[i01 + 2] * w01 + pos[i11 + 2] * w11);
  if (outN) {
    outN.set(nor[i00] * w00 + nor[i10] * w10 + nor[i01] * w01 + nor[i11] * w11,
      nor[i00 + 1] * w00 + nor[i10 + 1] * w10 + nor[i01 + 1] * w01 + nor[i11 + 1] * w11,
      nor[i00 + 2] * w00 + nor[i10 + 2] * w10 + nor[i01 + 2] * w01 + nor[i11 + 2] * w11).normalize();
    if (outN.z < 0) outN.negate();
  }
  return outP;
}

/* ---------- vessel strands: fixed topology tubes whose rings are re-laid on a carrier sheet ---------- */
function makeStrands(spec, radial, mat, parent, layer, key, sphere) {
  let verts = 0; for (const s of spec) verts += (s.n + 1) * (radial + 1);
  const geo = new THREE.BufferGeometry();
  const pos = new THREE.BufferAttribute(new Float32Array(verts * 3), 3), nor = new THREE.BufferAttribute(new Float32Array(verts * 3), 3);
  pos.setUsage(THREE.DynamicDrawUsage); nor.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', pos); geo.setAttribute('normal', nor);
  const idx = []; let base = 0;
  for (const s of spec) {
    for (let i = 0; i < s.n; i++) for (let j = 0; j < radial; j++) {
      const a = base + i * (radial + 1) + j, b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    base += (s.n + 1) * (radial + 1);
    s.P = Array.from({ length: s.n + 1 }, () => new THREE.Vector3()); s.N = Array.from({ length: s.n + 1 }, () => new THREE.Vector3());
  }
  geo.setIndex(idx); geo.boundingSphere = sphere.clone();
  const mesh = add(geo, mat, parent, key); mesh.layers.set(layer); mesh.frustumCulled = false;
  return { geo, mesh, spec, radial };
}
/** rings on the carrier sheet `sh` at the strand's (a, b) parameters; rScale thickens, lift raises them over the lobules */
function layStrands(S, sh, rScale, lift) {
  const pos = S.geo.attributes.position.array, nor = S.geo.attributes.normal.array, R = S.radial;
  let k = 0;
  for (const s of S.spec) {
    const n = s.n;
    for (let i = 0; i <= n; i++) sampleGrid(sh, s.pts[i].a, s.pts[i].b, s.P[i], s.N[i]);
    for (let i = 0; i <= n; i++) {
      const r = lerp(s.r0, s.r1, i / n) * rScale, p = s.P[i];
      p.addScaledVector(s.N[i], r * 0.55 + 0.008 + lift);                   // half embedded in the membrane (+ lift)
      _t.subVectors(s.P[Math.min(n, i + 1)], s.P[Math.max(0, i - 1)]).normalize();
      _n1.copy(s.N[i]).addScaledVector(_t, -s.N[i].dot(_t)).normalize(); _n2.crossVectors(_t, _n1);
      for (let j = 0; j <= R; j++) {
        const a = j / R * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        _d.copy(_n1).multiplyScalar(ca).addScaledVector(_n2, sa);
        pos[k] = p.x + _d.x * r; pos[k + 1] = p.y + _d.y * r; pos[k + 2] = p.z + _d.z * r; nor[k] = _d.x; nor[k + 1] = _d.y; nor[k + 2] = _d.z; k += 3;
      }
    }
  }
  S.geo.attributes.position.needsUpdate = true; S.geo.attributes.normal.needsUpdate = true;
}

/* ---------- colon as an obstacle: per-u radius + front-surface lookup ---------- */
/** the colon as an obstacle / carrier: radius(u) = tube radius along the curve (anchors.colonRadius(u) when the digestive
 *  module publishes it, else the colon mesh's own sweep surface — geometry.userData.surf — max over the circumference
 *  incl. haustra, else 0.4) and surf(u, th, out) = point on the colon wall (the mesh surface when available, else the
 *  curve frame t x UP, t x n — the same frame digestive.js sweeps with — at radius(u)) */
const COLON_UP = new THREE.Vector3(0.3, 1, 0.2).normalize();
function colonObstacle(colonCurve) {
  let best = null;
  C.groups.abdomen.traverse((o) => {
    if (!o.isMesh || o.userData.key !== 'colon' || !o.geometry.userData.surf) return;
    if (!best || o.geometry.userData.curve === colonCurve || (best.geometry.userData.curve !== colonCurve && o.geometry.attributes.position.count > best.geometry.attributes.position.count)) best = o;
  });
  const msurf = best && best.geometry.userData.surf;
  let radius = typeof C.anchors.colonRadius === 'function' ? C.anchors.colonRadius : null;
  if (!radius && msurf) {
    const tab = new Float32Array(121), p = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i <= 120; i++) {
      const u = i / 120; colonCurve.getPointAt(u, c); let r = 0;
      for (let j = 0; j < 16; j++) r = Math.max(r, msurf(u, j / 16 * Math.PI * 2, 1, p).distanceTo(c));
      tab[i] = r;
    }
    radius = (u) => { const t = clamp(u, 0, 1) * 120, i = Math.min(119, t | 0); return tab[i] + (tab[i + 1] - tab[i]) * (t - i); };
  }
  if (!radius) radius = () => 0.4;
  const c = new THREE.Vector3(), tg = new THREE.Vector3(), n = new THREE.Vector3(), b = new THREE.Vector3();
  const surf = msurf ? (u, th, out) => msurf(u, th, 1, out) : (u, th, out) => {
    colonCurve.getPointAt(u, c); colonCurve.getTangentAt(u, tg); n.crossVectors(tg, COLON_UP).normalize(); b.crossVectors(tg, n).normalize();
    return out.copy(c).addScaledVector(n, Math.cos(th) * radius(u)).addScaledVector(b, Math.sin(th) * radius(u));
  };
  return { radius, surf };
}
/* front surface of the colon tube as a continuous (x, y) lookup (falls away at slope 2 outside the footprint), built once
 * from colonCurve + its radius: the apron and its lobules drape in FRONT of the transverse colon instead of cutting through it */
const CL = { x0: -2.4, x1: 2.4, nx: 48, y0: -4.5, y1: -0.9, ny: 36 };
let colonLUT = null;
function buildColonLUT(cp) {
  const g = colonLUT = new Float32Array((CL.nx + 1) * (CL.ny + 1)), n = cp.x.length;
  for (let j = 0; j <= CL.ny; j++) for (let i = 0; i <= CL.nx; i++) {
    const x = lerp(CL.x0, CL.x1, i / CL.nx), y = lerp(CL.y0, CL.y1, j / CL.ny); let zf = -9;
    for (let k = 0; k < n; k++) {
      const R = cp.r[k] + 0.015, d2 = (x - cp.x[k]) ** 2 + (y - cp.y[k]) ** 2;
      zf = Math.max(zf, d2 < R * R ? cp.z[k] + Math.sqrt(R * R - d2) : cp.z[k] - 2 * (Math.sqrt(d2) - R));
    }
    g[j * (CL.nx + 1) + i] = zf;
  }
}
function colonFront(x, y) {
  const fx = clamp((x - CL.x0) / (CL.x1 - CL.x0) * CL.nx, 0, CL.nx - 1e-3), fy = clamp((y - CL.y0) / (CL.y1 - CL.y0) * CL.ny, 0, CL.ny - 1e-3);
  const i = fx | 0, j = fy | 0, du = fx - i, dv = fy - j, W = CL.nx + 1, a = j * W + i;
  return (colonLUT[a] * (1 - du) + colonLUT[a + 1] * du) * (1 - dv) + (colonLUT[a + W] * (1 - du) + colonLUT[a + W + 1] * du) * dv;
}
/** keep a lobule of scale sc in the gap between the colon front and the inner abdominal wall at (x, y): returns the
 *  (possibly reduced) scale and writes the clamped z into v. Continuous in f and in the body parameters. */
function squeeze(v, sc, wall) {
  const cf = colonFront(v.x, v.y), wz = wall(v.y, v.x) - 0.05, room = wz - cf;
  if (room < sc) sc = Math.max(1e-4, room * 0.9);                       // not enough room: shrink to fit (vanishes when none)
  const zc = cf + 0.3 * sc; if (v.z < zc) v.z = zc;                       // in front of the colon
  const zw = wz - sc * 0.7; if (v.z > zw) v.z = zw;                       // never through the abdominal wall
  return sc;
}
/** mesentery lobules sit behind the loops, so they are never pushed: one that would reach the abdominal wall
 *  shrinks instead (continuous in the body parameters) */
function wallShrink(v, sc, wall) {
  const zw = wall(v.y, v.x) - 0.05;
  return v.z + sc * 0.7 > zw ? Math.max(1e-4, Math.min(sc, (zw - v.z) / 0.7)) : sc;
}

/* ---------- greater omentum carrier (u across patient right -> left, v down the apron, k = layer 0 deep … 2 anterior) ----------
 * Static per-vertex terms (everything that does not depend on e or the body) are precomputed; the dynamic part
 * (apron length, layer gap, ripple amplitude, drape, wall clamp) costs a few multiplies + one wall lookup. */
const OMS = 9;   // floats per vertex: v, x, top, zTop, rip, yA, yB, cobble, lateralDrape
function omStatic(u, v, k, S, j) {
  const x0 = lerp(-2.05, 2.05, u);
  S[j] = v;
  S[j + 1] = x0 * (1 - 0.2 * v * v - 0.05 * v);                                   // rounded free edge
  S[j + 2] = -1.68 + 0.5 * Math.min(((x0 - 1) / 1.1) ** 2, 0.55);                  // greater curvature (lowest at x ~ 1), colon front at the sides
  S[j + 3] = 1.3 + 0.38 * (1 - smooth(0.8, 2.0, Math.abs(x0 - 0.1)));              // in front of the transverse colon, back at the flanks
  S[j + 4] = 0.55 * Math.sin(u * 13 + v * 4 + k * 1.7) + 0.3 * Math.sin(u * 29 - v * 8 + k * 0.8) + 0.25 * Math.sin(v * 15 + u * 6 + k * 2.3);
  S[j + 5] = 0.6 * Math.sin(u * 21 + k * 1.1) * v;
  S[j + 6] = 0.04 * Math.sin(u * 9 + v * 3) * v;
  S[j + 7] = k >= 1.5 ? (0.55 * noise3(u * 29, v * 21, 1.3) + 0.45 * noise3(u * 70, v * 50, 2.1)) * smooth(1.5, 2, k) : 0;   // cobbled fatty apron
  S[j + 8] = 0.06 * Math.sin(Math.PI * u);
}
/** dynamic part: e = effective fat, xs = lateral fit to a narrow body, wall(y, x) = inner fascia z */
function omDyn(S, j, e, k, xs, wall, out) {
  const v = S[j], x = S[j + 1] * xs, amp = (0.02 + 0.22 * e) * (0.35 + 0.65 * v);
  const y = S[j + 2] - v * (0.95 + 1.85 * e) + amp * S[j + 5] + S[j + 6];        // apron length: thin veil … down to the pelvis
  const bl = smooth(-2.2, -2.9, y);                                             // drapes onto the bowel below the transverse colon
  let z = S[j + 3] + (1.12 + 0.55 * e - S[j + 3]) * bl + S[j + 8] + (k - 1) * (0.05 + 0.1 * e) * smooth(-1.9, -2.6, y) + amp * S[j + 4] + (0.04 + 0.12 * e) * S[j + 7];
  z = smax(z, colonFront(x, y) + 0.02, 0.05);                                   // in front of the colon (layers fuse over it)
  out.set(x, y, smin(z, wall(y, x) - 0.04 - 0.1 * e, 0.06));                    // never through the abdominal wall (wins)
  return out;
}
const lateralFit = (b) => clamp((b.W - b.d - 0.3) / 2.05, 0.6, 1);
function precomputeOm(sh, k) {
  const S = sh.st = new Float32Array((sh.cols + 1) * (sh.rows + 1) * OMS);
  for (let r = 0; r <= sh.rows; r++) for (let c = 0; c <= sh.cols; c++) omStatic(c / sh.cols, r / sh.rows, k, S, (r * (sh.cols + 1) + c) * OMS);
}
function layOm(sh, k, e, xs, wall) {
  const S = sh.st, pos = sh.pos, n = (sh.cols + 1) * (sh.rows + 1);
  for (let i = 0, j = 0; i < n; i++, j += OMS) { omDyn(S, j, e, k, xs, wall, _v); pos[i * 3] = _v.x; pos[i * 3 + 1] = _v.y; pos[i * 3 + 2] = _v.z; }
  gridNormals(sh);
}
/** anchor for other modules: point on the omentum apron (direct evaluation; body defaults to state A) */
let wsKey = '', ws = null;
function wallFor(b) { const key = `${b.W}|${b.Wz}|${b.d}|${b.bulge}`; if (key !== wsKey) { ws = wallSampler(b); wsKey = key; } return ws; }
const _S = new Float32Array(OMS);
function omentumSurf(u, v, e, k, out, body) {
  const b = body || C.state.body;
  omStatic(u, v, k, _S, 0);
  return omDyn(_S, 0, e, k, lateralFit(b), wallFor(b), out || new THREE.Vector3());
}

/* ---------- mesentery carrier: s along the root (duodenojejunal flexure -> caecum), t from the root (0) to the rim (1) ---------- */
const MSS = 4;   // floats per vertex: x, y, z0 (incl. deflection behind the bowel), ruffle*t
function mesBase(s, t, out) {
  const rx0 = lerp(0.4, -1.3, s), ry0 = lerp(-1.5, -3.3, s);                       // root on the posterior wall
  const th = lerp(1.1, -2.55, s), rimX = -0.35 + 1.95 * Math.cos(th), rimY = -2.65 + 1.2 * Math.sin(th);
  return out.set(lerp(rx0, rimX, t), lerp(ry0, rimY, t), lerp(-0.92, 0.5 + 0.25 * Math.sin(th), Math.pow(t, 0.8)));
}
/* ruffles are strongest mid-fan and vanish at the root and at the rim (the rim threads between the loops) */
const mesRuffle = (s, t) => 4 * t * (1 - t) * (Math.sin(s * 26 + t * 3) + 0.5 * Math.sin(s * 47 - t * 6));
/** per-vertex statics incl. a deflection field that keeps the membrane behind the small-bowel loops: each vertex is
 *  pushed back until it clears the loops (margin incl. its ruffle); where no clear depth exists within reach it takes
 *  the depth of largest clearance. Every vertex keeps at least its own push after the dilate / smooth passes. */
function precomputeMes(sh, bowel, cp) {
  const W = sh.cols + 1, H = sh.rows + 1, S = sh.st = new Float32Array(W * H * MSS), dz = new Float32Array(W * H), dz0 = new Float32Array(W * H), p = new THREE.Vector3();
  const nc = cp.x.length;
  const clearance = (q) => {                                                       // signed room: distance to the nearest tube surface
    let m = 9; for (const b of bowel) m = Math.min(m, q.distanceTo(b) - SI_R);
    for (let k = 0; k < nc; k++) m = Math.min(m, Math.sqrt((q.x - cp.x[k]) ** 2 + (q.y - cp.y[k]) ** 2 + (q.z - cp.z[k]) ** 2) - cp.r[k] - 0.02);
    return m;
  };
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const s = c / sh.cols, t = r / sh.rows, i = r * W + c; mesBase(s, t, p);
    S[i * MSS] = p.x; S[i * MSS + 1] = p.y; S[i * MSS + 2] = p.z; S[i * MSS + 3] = mesRuffle(s, t);
    const margin = 0.03 + 0.195 * 4 * t * (1 - t);                                    // + room for the ruffle (amplitude <= 0.195 mid-fan)
    let d = 0, best = 0, bestM = -9;
    for (; d > -1.1; d -= 0.03) { const m = clearance(_v.set(p.x, p.y, p.z + d)); if (m > bestM) { bestM = m; best = d; } if (m >= margin) break; }
    dz[i] = dz0[i] = d > -1.1 ? d : best;
  }
  const tmp = new Float32Array(W * H);
  for (let pass = 0; pass < 3; pass++) {                                            // dilate (keep the push), smooth, smooth
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      let acc = 0, n = 0, mn = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const rr = r + dr, cc = c + dc; if (rr < 0 || cc < 0 || rr >= H || cc >= W) continue; const v = dz[rr * W + cc]; acc += v; n++; mn = Math.min(mn, v); }
      tmp[r * W + c] = Math.min(pass === 0 ? mn : acc / n, dz0[r * W + c]);
    }
    dz.set(tmp);
  }
  for (let i = 0; i < W * H; i++) S[i * MSS + 2] += dz[i];
}
/** direct evaluation (build-time checks): bilinear statics + ruffle at fat level e */
function mesPoint(sh, s, t, e, out) {
  const { cols, rows, st: S } = sh, W = cols + 1, fu = clamp(s, 0, 1) * cols, fv = clamp(t, 0, 1) * rows;
  const c = Math.min(cols - 1, fu | 0), r = Math.min(rows - 1, fv | 0), du = fu - c, dv = fv - r;
  const i00 = (r * W + c) * MSS, i10 = i00 + MSS, i01 = i00 + W * MSS, i11 = i01 + MSS, w00 = (1 - du) * (1 - dv), w10 = du * (1 - dv), w01 = (1 - du) * dv, w11 = du * dv;
  const g = (o) => S[i00 + o] * w00 + S[i10 + o] * w10 + S[i01 + o] * w01 + S[i11 + o] * w11;
  return out.set(g(0), g(1), g(2) + (0.03 + 0.1 * e) * g(3));
}
function layMes(sh, e) {
  const S = sh.st, pos = sh.pos, n = (sh.cols + 1) * (sh.rows + 1), amp = 0.03 + 0.1 * e;
  for (let i = 0, j = 0; i < n; i++, j += MSS) { pos[i * 3] = S[j]; pos[i * 3 + 1] = S[j + 1]; pos[i * 3 + 2] = S[j + 2] + amp * S[j + 3]; }
  gridNormals(sh);
}

/* ---------- strand layouts (sheet parameter space: a = across, b = down) ---------- */
const OM_TRUNKS = [0.1, 0.26, 0.42, 0.58, 0.74, 0.9];
const omTrunkU = (k, t) => OM_TRUNKS[k] + 0.05 * Math.sin(t * 4.5 + k * 1.3) + 0.03 * Math.sin(t * 11 + k);
function omentumStrands() {
  const main = [], twig = [];
  main.push({ n: 30, r0: 0.021, r1: 0.021, pts: Array.from({ length: 31 }, (_, i) => { const u = lerp(0.04, 0.96, i / 30); return { a: u, b: 0.035 + 0.015 * Math.sin(u * 17) }; }) });
  OM_TRUNKS.forEach((u0, k) => {
    main.push({ n: 24, r0: 0.018, r1: 0.008, pts: Array.from({ length: 25 }, (_, i) => { const t = i / 24; return { a: omTrunkU(k, t), b: 0.04 + 0.9 * t }; }) });
    for (let j = 0; j < 3; j++) {
      const t0 = 0.2 + 0.26 * j, side = (j + k) % 2 ? 1 : -1;
      twig.push({ n: 8, r0: 0.009, r1: 0.0035, pts: Array.from({ length: 9 }, (_, i) => { const q = i / 8; return { a: omTrunkU(k, t0) + side * (0.07 + 0.04 * j) * q + 0.02 * Math.sin(q * 7 + j), b: 0.04 + 0.9 * (t0 + 0.15 * q) }; }) });
    }
  });
  return { main, twig };
}
const MES_BRANCH = [0.07, 0.213, 0.357, 0.5, 0.643, 0.787, 0.93];
const mesBranchS = (k, t) => MES_BRANCH[k] + 0.025 * Math.sin(t * 5 + k * 1.7);
function mesenteryStrands() {
  const main = [], twig = [];
  MES_BRANCH.forEach((s0, k) => {
    main.push({ n: 22, r0: 0.021, r1: 0.009, pts: Array.from({ length: 23 }, (_, i) => { const t = lerp(0.02, 0.92, i / 22); return { a: mesBranchS(k, t), b: t }; }) });
    if (k < MES_BRANCH.length - 1) main.push({ n: 10, r0: 0.01, r1: 0.01, pts: Array.from({ length: 11 }, (_, i) => { const q = i / 10; return { a: lerp(mesBranchS(k, 0.78), mesBranchS(k + 1, 0.78), q), b: 0.78 + 0.08 * Math.sin(Math.PI * q) }; }) });
    for (const t0 of [0.3, 0.55]) {
      const side = k % 2 ? 1 : -1;
      twig.push({ n: 6, r0: 0.008, r1: 0.0035, pts: Array.from({ length: 7 }, (_, i) => { const q = i / 6; return { a: mesBranchS(k, t0) + side * 0.045 * q, b: t0 + 0.16 * q + 0.02 * Math.sin(q * 9) }; }) });
    }
  });
  return { main, twig };
}

/* ---------- state relay ---------- */
/** epicardial: on the surface, flattened along the normal, one third embedded; the anterior-lid lobules shrink with the
 *  heart's cut-away (hcut) so the opened chambers stay visible, the AV groove ring stays */
function layEpi(set, f) {
  const e = Math.pow(f, 1.35), grow = 0.5 + 0.6 * f;
  layInst(set.epi, epi, e, (p, a) => {
    const sc = Math.max(1e-4, p.s * grow * a * (1 - hcut * p.lid));
    dummy.position.copy(p.p).addScaledVector(p.n, sc * 0.27);
    dummy.quaternion.copy(p.q); dummy.scale.set(sc, sc * 0.5, sc);
  });
}
/** perirenal: on the kidney surface, fitted inside the capsule; the half facing the camera shrinks away while the
 *  kidney's coronal cut-away is open (kid[].cut / side mirror organs/kidneys.js) */
function layPr(set, f) {
  const e = Math.pow(f, 1.35);
  layInst(set.pr, pr, e, (p, a) => {
    const K = kid[p.ki], w = K.cut * smooth(-0.04, 0.1, p.zL * K.side);
    const sc = Math.max(1e-4, p.s * (0.55 + 0.75 * f) * a * (1 - w));
    dummy.position.copy(p.p).addScaledVector(p.n, sc * 0.15);
    dummy.quaternion.copy(p.q); dummy.scale.set(sc, sc * 0.75, sc);
  });
}
function layFat(set, f, body) {
  const e = Math.pow(f, 1.35), grow = 0.5 + 0.6 * f, wall = wallSampler(body), xs = lateralFit(body);
  layEpi(set, f);
  /* omentum sheets (anterior 60x44, deep 30x22) + vessels + lobules */
  set.om.forEach((sh, k) => { layOm(sh, k, e, xs, wall); sh.mesh.material.opacity = [0.12, 0.14, 0.2][k] + [0.25, 0.3, 0.7][k] * e; });
  const ant = set.om[2], vScale = 0.7 + 0.55 * e, gap = 0.05 + 0.1 * e;
  layStrands(set.omV, ant, vScale, 0.03 * e);                                     // lifted over the lobule layer as fat grows
  layStrands(set.omT, ant, vScale, 0.03 * e);
  layInst(set.omf, om, e, (p, a) => {
    sampleGrid(ant, p.u, p.v, _v, _m); _v.z += (p.k - 2) * gap * smooth(-1.9, -2.6, _v.y) + p.zj * 0.04;
    const sc = squeeze(_v, p.s * grow * a, wall);
    dummy.position.copy(_v); orient(_m, p.spin); dummy.scale.set(sc, sc * 0.62, sc);
  });
  /* mesentery sheet + vessels + lobules */
  layMes(set.mes, e);
  set.mes.mesh.material.opacity = 0.14 + 0.3 * e;
  layStrands(set.mesV, set.mes, vScale, 0.015 * e);
  layStrands(set.mesT, set.mes, vScale, 0.015 * e);
  layInst(set.mesf, mes, e, (p, a) => {
    let sc = p.sz * grow * a;
    if (p.onColon) { _v.copy(p.p); dummy.quaternion.copy(p.q); }
    else { sampleGrid(set.mes, p.s, p.t, _v, _m); _v.addScaledVector(_m, p.side * (0.03 + sc * 0.55 + 0.06 * e * p.j)); orient(_m, p.spin); }
    sc = wallShrink(_v, sc, wall);
    dummy.position.copy(_v); dummy.scale.set(sc, sc * 0.8, sc);
  });
  layPr(set, f);
}

export function build(ctx) {
  C = ctx; dummy = ctx.dummy;
  const ab = ctx.groups.abdomen;
  const { heartSurf, ventG, colonCurve, siCurve, kidneyPos } = ctx.anchors;
  geoLo = lobuleGeo(6, 3); geoHi = lobuleGeo(8, 5);                                 // 24 / 64 triangles
  lobMat = OrganMat(palette.white, Object.assign({ sheenColor: new THREE.Color(palette.fatSheen), emissive: new THREE.Color(palette.fatEmissive), emissiveIntensity: 0.12, bumpScale: 0.25 }, GLOSS.fatSoft));
  const sheetMat = () => OrganMat(palette.omentumPlate, { transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false, roughness: 0.5, sheen: 0.8, sheenColor: new THREE.Color(palette.omentumSheen), emissiveIntensity: 0.05 });
  const vesselMat = OrganMat(palette.omentumVessel, { roughness: 0.28, clearcoat: 0.9, bumpScale: 0.1, emissiveIntensity: 0.3, sheen: 0.3 });
  twigMat = OrganMat(palette.omentumVessel, { roughness: 0.28, clearcoat: 0.9, bumpScale: 0.1, emissiveIntensity: 0.3, sheen: 0.3, transparent: true, opacity: 1 });
  const abSphere = new THREE.Sphere(P(0, -2.8, 0.6), 4.2);
  setSeed(3001);

  /* ---- epicardial: grooves first (lowest thresholds), then the RV free wall, then the LV and apex ---- */
  const LAD = (ph) => 0.1 - ph * 0.06, PIV = Math.PI + 0.2, AV = 1.12;
  for (let i = 0; i < N.epi; i++) {
    const r = rnd(), q = Math.pow(rnd(), 1.3), side = rnd() < 0.5 ? -1 : 1;
    let th, ph, thr, s, grp;
    if (r < 0.36) {            // atrioventricular groove ring (spreads mostly downward over the ventricles)
      grp = 0; th = rnd() * Math.PI * 2; ph = AV + (side < 0 ? -(0.04 + 0.12 * q) : 0.05 + 0.38 * q) + (rnd() - 0.5) * 0.04;
      thr = 0.02 + 0.32 * q + 0.1 * rnd(); s = 0.07 + 0.045 * rnd() + 0.03 * (1 - q);
    } else if (r < 0.6) {      // interventricular grooves (anterior LAD line 70 %, posterior 30 %)
      grp = 1; ph = 0.65 + rnd() * 2.2; const ant = rnd() < 0.7;
      th = (ant ? LAD(ph) : PIV) + side * (0.06 + 0.42 * q) / Math.max(Math.sin(ph), 0.35);
      thr = 0.06 + 0.36 * q + 0.1 * rnd(); s = 0.065 + 0.04 * rnd() + 0.025 * (1 - q);
    } else if (r < 0.84) {     // right-ventricular free wall (between the LAD and the RCA): the thick pad
      grp = 2; ph = 1.3 + rnd() * 1.3; th = -0.25 - rnd() * 1.5; thr = 0.3 + 0.45 * rnd(); s = 0.055 + 0.05 * rnd();
    } else {                   // left-ventricular lateral wall and apex
      grp = 3; ph = 1.4 + rnd() * 1.6; th = 0.45 + rnd() * 1.7; thr = 0.5 + 0.5 * rnd(); s = 0.05 + 0.045 * rnd();
    }
    epi.push({ grp, th, ph: clamp(ph, 0.5, 3.0), thr: clamp(thr, 0.01, 1), s, spin: rnd() * 6.3 });
  }
  byThr(epi).forEach((p) => {
    p.p = heartSurf(p.th, p.ph, 1);
    _a.copy(heartSurf(p.th + 2e-3, p.ph, 1)).sub(p.p); _b.copy(heartSurf(p.th, p.ph + 2e-3, 1)).sub(p.p);
    p.n = new THREE.Vector3().crossVectors(_a, _b).normalize(); if (p.n.dot(p.p) < 0) p.n.negate();
    orient(p.n, p.spin); p.q = dummy.quaternion.clone();
    /* weight of the heart cut-away on this lobule: 1 on the anterior lid, 0 behind the cut plane and on the AV groove ring */
    const ring = p.grp === 0 ? 1 - smooth(0.05, 0.22, Math.abs(p.ph - AV)) : 0;
    p.lid = smooth(HCUT_D - 0.05, HCUT_D + 0.12, p.p.dot(HCUT_N)) * (1 - ring);
  });
  const epiA = makePair(epi.length, ventG, LAYER.A, 'epifat'), epiB = makePair(epi.length, ventG, LAYER.B, 'epifat');

  /* ---- colon obstacle data: curve samples with the local tube radius ---- */
  const colonObs = colonObstacle(colonCurve), colonR = colonObs.radius;
  const cpts = colonCurve.getSpacedPoints(600), cp = { x: new Float32Array(601), y: new Float32Array(601), z: new Float32Array(601), r: new Float32Array(601) };
  cpts.forEach((q, i) => { cp.x[i] = q.x; cp.y[i] = q.y; cp.z[i] = q.z; cp.r[i] = colonR(i / 600); });
  buildColonLUT(cp);

  /* ---- omentum: lobules along the arcade and the descending vessels first, packed between the layers; kept off the
   *      vessel lines (the vessels run in the grooves between lobules); only anterior lobules over the colon zone ---- */
  for (let i = 0; i < N.om; i++) {
    let u = 0.03 + 0.94 * rnd(); const v = rnd(), t = clamp((v - 0.04) / 0.9, 0, 1);
    let prox = 1, nearest = -1;
    OM_TRUNKS.forEach((_, k) => { const d = Math.abs(u - omTrunkU(k, t)); if (d / 0.07 < prox) { prox = d / 0.07; nearest = k; } });
    if (v < 0.1) prox = Math.min(prox, v / 0.1);
    if (nearest >= 0 && v > 0.08) { const tu = omTrunkU(nearest, t), d = u - tu; if (Math.abs(d) < 0.03) u = tu + Math.sign(d || 1) * (0.03 + 0.025 * rnd()); }
    const k = v < 0.25 || rnd() < 0.72 ? 1.8 + rnd() * 0.4 : rnd() * 1.6;
    const s = 0.06 + 0.1 * Math.pow(rnd(), 1.6);                                     // wide size range: big lobes break the texture
    om.push({ u, v, k, thr: clamp(0.02 + 0.42 * v + 0.3 * prox + 0.3 * rnd() - 0.08 + 1.2 * (s - 0.06), 0.01, 1), s, spin: rnd() * 6.3, zj: rnd() - 0.5 });
  }
  byThr(om);
  const omA = [], omB = [];
  for (let k = 0; k < 3; k++) {
    const g = k === 2 ? OM : OMD;
    omA.push(makeSheet(g.cols, g.rows, sheetMat(), ab, LAYER.A, 'omentum', 6 + k, abSphere)); omB.push(makeSheet(g.cols, g.rows, sheetMat(), ab, LAYER.B, 'omentum', 6 + k, abSphere));
    precomputeOm(omA[k], k); precomputeOm(omB[k], k);
    if (k < 2) deepSheets.push(omA[k].mesh, omB[k].mesh);
  }
  const os = omentumStrands(), os2 = omentumStrands();
  const omVA = makeStrands(os.main, 6, vesselMat, ab, LAYER.A, 'omentum', abSphere), omVB = makeStrands(os2.main, 6, vesselMat, ab, LAYER.B, 'omentum', abSphere);
  const omTA = makeStrands(os.twig, 5, twigMat, ab, LAYER.A, 'omentum', abSphere), omTB = makeStrands(os2.twig, 5, twigMat, ab, LAYER.B, 'omentum', abSphere);
  twigs.push(omTA.mesh, omTB.mesh);
  const omfA = makePair(om.length, ab, LAYER.A, 'omentum'), omfB = makePair(om.length, ab, LAYER.B, 'omentum');

  /* ---- mesentery: fan membrane deflected behind the loops; lobules near the vessels / root first, rejected when they
   *      would sit inside a small-bowel or colon tube at any fat level; omental appendices on the colon ---- */
  const bowel = siCurve.getSpacedPoints(700), nc = cp.x.length;
  const clearOfBowel = (p, r) => {
    const R2 = (SI_R + r) ** 2; for (const q of bowel) if (p.distanceToSquared(q) < R2) return false;
    for (let k = 0; k < nc; k++) { const rr = cp.r[k] + r; if ((p.x - cp.x[k]) ** 2 + (p.y - cp.y[k]) ** 2 + (p.z - cp.z[k]) ** 2 < rr * rr) return false; }
    return true;
  };
  const mesMatA = sheetMat(), mesMatB = sheetMat();
  const mesA = makeSheet(MES.cols, MES.rows, mesMatA, ab, LAYER.A, 'mesentery', 5, abSphere), mesB = makeSheet(MES.cols, MES.rows, mesMatB, ab, LAYER.B, 'mesentery', 5, abSphere);
  precomputeMes(mesA, bowel, cp); mesB.st = mesA.st;
  { const p = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), q0 = new THREE.Vector3(), q1 = new THREE.Vector3();
    for (let i = 0; i < N.mes; i++) {
      if (rnd() < 0.2) {
        /* omental appendix ON the colon wall (surface point from the colon mesh, outward normal from the curve) */
        const u = 0.02 + 0.82 * rnd(), a = rnd() * Math.PI * 2, sz = 0.065 + 0.06 * rnd();
        colonObs.surf(u, a, p); colonCurve.getPointAt(u, c); n.subVectors(p, c).normalize();
        if (n.z < -0.3 && rnd() < 0.7) { i--; continue; }         // mostly on the anterior face of the colon
        const nn = n.clone(), spin = rnd() * 6.3; orient(nn, spin);
        mes.push({ onColon: true, p: p.clone().addScaledVector(nn, -0.02), n: nn, q: dummy.quaternion.clone(), thr: 0.25 + 0.75 * rnd(), sz, spin });
      } else {
        let s, t, side, j, sz, ok = false, tries = 0;
        while (!ok && tries++ < 16) {
          s = 0.03 + 0.94 * rnd(); t = 0.06 + 0.9 * rnd(); side = rnd() < 0.5 ? -1 : 1; j = rnd(); sz = 0.065 + 0.08 * rnd();
          /* the lobule centre at both fat extremes (normal offset included) must clear the bowel tubes */
          mesPoint(mesA, s, t, 0.1, q0); mesPoint(mesA, s + 2e-3, t, 0.1, _a).sub(q0); mesPoint(mesA, s, t + 2e-3, 0.1, _b).sub(q0);
          n.crossVectors(_a, _b).normalize(); if (n.z < 0) n.negate();
          const scMax = sz * 1.1;
          q0.addScaledVector(n, side * (0.03 + scMax * 0.55 * 0.4)); mesPoint(mesA, s, t, 1, q1).addScaledVector(n, side * (0.03 + scMax * 0.55 + 0.06 * j));
          ok = clearOfBowel(q0, 0.4 * scMax) && clearOfBowel(q1, 0.5 * scMax);
        }
        if (!ok) continue;
        let prox = 1; for (const k of MES_BRANCH) prox = Math.min(prox, Math.abs(s - k) / 0.06);
        prox = Math.min(prox, Math.abs(t - 0.78) / 0.05);
        mes.push({ onColon: false, s, t, side, j, thr: clamp(0.02 + 0.45 * prox + 0.2 * clamp(t / 0.35, 0, 1) + 0.33 * rnd(), 0.01, 1), sz, spin: rnd() * 6.3 });
      }
    } }
  byThr(mes);
  const ms = mesenteryStrands(), ms2 = mesenteryStrands();
  const mesVA = makeStrands(ms.main, 6, vesselMat, ab, LAYER.A, 'mesentery', abSphere), mesVB = makeStrands(ms2.main, 6, vesselMat, ab, LAYER.B, 'mesentery', abSphere);
  const mesTA = makeStrands(ms.twig, 5, twigMat, ab, LAYER.A, 'mesentery', abSphere), mesTB = makeStrands(ms2.twig, 5, twigMat, ab, LAYER.B, 'mesentery', abSphere);
  twigs.push(mesTA.mesh, mesTB.mesh);
  const mesfA = makePair(mes.length, ab, LAYER.A, 'mesentery'), mesfB = makePair(mes.length, ab, LAYER.B, 'mesentery');

  /* ---- perirenal: in each kidney's own frame (the kidney group's rotation, identity if not found) on the cortex
   *      ellipsoid (anterior face flatter, like the cortex), posterior face and poles first, lighter over the hilum;
   *      every lobule is shrunk at build until all its vertices (coarse + detail geometry, maximum scale) lie inside
   *      the 0.5 x 0.86 x 0.4 capsule ---- */
  { const M = new THREE.Matrix4(), vv = new THREE.Vector3(), sc3 = new THREE.Vector3();
    kidneyPos.forEach((kp, ki) => {
      const g = ab.children.find((o) => o.isGroup && o.position.distanceTo(kp) < 1e-4);
      const q = g ? g.quaternion.clone() : new THREE.Quaternion();
      const K = { pos: kp.clone(), q, inv: q.clone().invert(), cut: 0, side: 1 }; kid.push(K);
      const sgn = ki === 0 ? -1 : 1;                                               // -1 = patient's right kidney
      for (let i = 0; i < N.pr / 2; i++) {
        const dir = P(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
        const rk = 1 / Math.sqrt((dir.x / KIDNEY[0]) ** 2 + (dir.y / KIDNEY[1]) ** 2 + (dir.z / KIDNEY[2]) ** 2);
        const pl = dir.clone().multiplyScalar(rk); if (pl.z > 0) pl.z *= 0.93;
        const nl = P(dir.x / KIDNEY[0] ** 2, dir.y / KIDNEY[1] ** 2, dir.z / KIDNEY[2] ** 2).normalize();
        const p = pl.clone().applyQuaternion(q).add(kp), n = nl.clone().applyQuaternion(q);
        const post = dir.z < 0 ? 0 : 1, pole = 1 - Math.abs(dir.y), hilum = smooth(0.3, 0.8, -sgn * dir.x) * (1 - smooth(0.4, 0.8, Math.abs(dir.y)));
        const spin = rnd() * 6.3; orient(n, spin);
        const lob = { ki, zL: pl.z, p, n, q: dummy.quaternion.clone(), thr: clamp(0.06 + 0.3 * post + 0.25 * pole * rnd() + 0.3 * hilum + 0.45 * rnd(), 0.01, 1), s: 0.05 + 0.03 * rnd(), spin };
        for (let it = 0; it < 12; it++) {                                           // fit: max normalised capsule radius of all vertices <= 0.98
          const sc = lob.s * 1.3; let mx = 0;
          M.compose(_v.copy(p).addScaledVector(n, sc * 0.15), lob.q, sc3.set(sc, sc * 0.75, sc));
          for (const gg of [geoLo, geoHi]) { const pos = gg.attributes.position; for (let k = 0; k < pos.count; k++) { vv.fromBufferAttribute(pos, k).applyMatrix4(M).sub(kp).applyQuaternion(K.inv); mx = Math.max(mx, Math.sqrt((vv.x / CAPSULE[0]) ** 2 + (vv.y / CAPSULE[1]) ** 2 + (vv.z / CAPSULE[2]) ** 2)); } }
          if (mx <= 0.98) break;
          lob.s *= 0.98 / mx;
        }
        if (lob.s < 0.025) continue;                                                // no room here (hilum notch): skip
        pr.push(lob);
      }
    }); }
  byThr(pr);
  const prA = makePair(pr.length, ab, LAYER.A, 'kidney'), prB = makePair(pr.length, ab, LAYER.B, 'kidney');

  setA = { epi: epiA, om: omA, omV: omVA, omT: omTA, omf: omfA, mes: mesA, mesV: mesVA, mesT: mesTA, mesf: mesfA, pr: prA };
  setB = { epi: epiB, om: omB, omV: omVB, omT: omTB, omf: omfB, mes: mesB, mesV: mesVB, mesT: mesTB, mesf: mesfB, pr: prB };
  ctx.anchors.omentumSurf = omentumSurf;
}

export function update(f, t, phys) {
  const st = C.state, b = st.body, cam = C.camera;
  const dtEase = clamp(t - lastT, 0, 0.4); lastT = t;
  /* heart cut-away: anchors.heartCut when the heart publishes it, else the same rule + easing as organs/heart.js */
  const hc = C.anchors.heartCut;
  if (typeof hc === 'number') hcut = hc;
  else if (hc && typeof hc.value === 'number') hcut = hc.value;
  else {
    const hp = C.anchors.heartPos || HEART_POS, dist = cam.position.distanceTo(hp), dT = C.controls.target.distanceTo(hp);
    const tg = Math.max(smooth(9.5, 7.5, dist), smooth(13.5, 11.8, dist) * smooth(1.9, 1.0, dT));
    hcut = Math.abs(hcut - tg) < 0.002 ? tg : lerp(hcut, tg, 1 - Math.exp(-dtEase * 9));
  }
  /* kidney coronal cut-away: anchors.kidneyCutWindow ([{cut, side}] or [cut, cut]) when published, else the rule of organs/kidneys.js */
  const k3 = 1 - Math.exp(-dtEase * 3.2), kw = C.anchors.kidneyCutWindow; let kChanged = false;
  kid.forEach((K, i) => {
    let cut, side;
    const w = Array.isArray(kw) ? kw[i] : null;
    if (typeof w === 'number') { cut = w; _v.copy(cam.position).sub(K.pos).applyQuaternion(K.inv); side = _v.z >= 0 ? 1 : -1; }
    else if (w && typeof w.cut === 'number') { cut = w.cut; side = typeof w.side === 'number' ? w.side : 1; }
    else {
      const tg = (st.focusKey === 'kidney' || cam.position.distanceTo(K.pos) < KIDNEY_CLOSE) ? 1 : 0;
      cut = Math.abs(K.cut - tg) < 1e-3 ? tg : lerp(K.cut, tg, k3);
      _v.copy(cam.position).sub(K.pos).applyQuaternion(K.inv); side = lerp(K.side, _v.z >= 0 ? 1 : -1, k3);
    }
    if (Math.abs(cut - K.cut) > 1e-3 || (cut > 1e-3 && Math.abs(side - K.side) > 1e-3)) kChanged = true;
    K.cut = cut; K.side = side;
  });

  const keyA = `${b.W.toFixed(3)}|${b.Wz.toFixed(3)}|${b.d.toFixed(3)}|${b.bulge.toFixed(3)}`;
  const fullA = Math.abs(f - lastA) > 1e-4 || keyA !== lastKeyA, fullB = st.bVersion !== lastB;
  if (fullA) { layFat(setA, f, b); lastA = f; lastKeyA = keyA; }
  if (fullB) { layFat(setB, st.fB, st.bodyB); lastB = st.bVersion; }
  if (Math.abs(hcut - lastHcut) > 0.003) { if (!fullA) layEpi(setA, f); if (!fullB) layEpi(setB, st.fB); lastHcut = hcut; }
  if (kChanged) { if (!fullA) layPr(setA, f); if (!fullB) layPr(setB, st.fB); }

  /* LOD honouring ctx.state.perf: 2 = detail lobules within 15 (out at 17) + twigs fading 18 -> 14;
   * 1 = detail only within 11 (out at 13); 0 = coarse lobules only, no twigs, no deep omentum sheets */
  const perf = st.perf ?? 2, nearIn = perf >= 2 ? NEAR_IN : perf === 1 ? 11 : -1, nearOut = nearIn + 2;
  const dist = cam.position.distanceTo(TRUNK);
  if (perf !== lastPerf) { near = null; for (const m of deepSheets) m.visible = perf > 0; lastPerf = perf; }
  if (near === null) near = dist < nearIn; else if (near && dist > nearOut) near = false; else if (!near && dist < nearIn) near = true;
  if (near !== lastNear) { for (const m of detail) m.visible = near; for (const m of coarse) m.visible = !near; lastNear = near; }
  const op = perf > 0 ? smooth(TWIG_FAR, TWIG_NEAR, dist) : 0;
  if (op !== twigMat.opacity) { twigMat.opacity = op; const vis = op > 0.01; for (const m of twigs) m.visible = vis; }
}
