// organs/liver.js — liver with four lobes (right / left / caudate / quadrate) sculpted on the existing silhouette:
// falciform fissure + fissure for ligamentum teres and venosum, porta hepatis, gallbladder fossa and the IVC groove
// (visceral surface "H"). Falciform ligament sheet with the round ligament, gallbladder + cystic duct, and the
// intrahepatic trees: portal vein, hepatic veins converging to the IVC, hepatic artery and bile ducts. When the
// camera comes close the capsule eases to a translucent look so the trees read through (no popping).
// States A/B: fatty-liver vertex colours (paint), ~15 % enlargement (scaled about the bare area, so the organ grows
// downward / forward like real hepatomegaly) and a greasy gloss — each state has its own OrganMat driven in update().
import { THREE, P, clamp, lerp, smooth, gauss, noise3, rnd, setSeed, deform, vtube, add, LAYER } from '../core/ctx.js';
import { palette, OrganMat, liverVeinTex } from '../core/style.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const liverPos = P(-0.55, -0.3, 0.25);
const ROT_Z = 0.07;
const PIVOT = P(0.1, 0.95, -0.5);               // scale pivot: bare area under the diaphragm (hepatomegaly grows down / forward)
const IVC_X = 0.14;                               // liver-space x of the inferior vena cava (world x ≈ −0.4)
const IVC_TOP = P(0.14, 0.62, -0.5);              // where the hepatic veins meet the IVC (inside the dome)
const PORTA = P(0.2, -0.42, -0.33);               // porta hepatis: portal vein / hepatic artery / bile duct enter here
const GB_FUNDUS = P(-0.36, -0.58, 1.2), GB_NECK = P(-0.12, -0.4, 0.02);
/* stomach fundus / body as spheres in liver space: the left lobe is kept in front of them (gastric impression) */
const STOMACH = [[1.35, 0.45, -0.45, 0.62], [1.95, 0.2, -0.15, 0.68], [2.2, -0.35, 0.2, 0.7]];
const smax = (a, b, k) => Math.log(Math.exp(k * a) + Math.exp(k * b)) / k;

/* ---------- shape ---------- */
/** base silhouette: sculpted unit sphere (patient's right = −x, anterior = +z, up = +y) */
export function liverShape(v) {
  v.x *= 2.2; v.y *= 1.18; v.z *= 1.5;
  const t = (v.x + 2.2) / 4.4;                                        // 0 = patient's right edge … 1 = left tip
  v.y *= 1 - 0.62 * smooth(0.32, 1, t); v.z *= 1 - 0.3 * smooth(0.45, 1, t);
  if (v.y < 0) v.y *= 0.42;
  v.y -= 0.18 * smooth(0, 1.4, v.z) * (v.y < 0 ? 1 : 0.3);           // sharp antero-inferior border
  const fis = gauss(t, 0.63, 0.045) * smooth(0.1, 1.1, v.z);          // falciform groove (anterior surface)
  v.y -= 0.14 * fis * (v.y > 0 ? 1 : 0.4); v.z *= 1 - 0.08 * fis;
  /* gastric impression: the posterior face of the left lobe wraps in front of the stomach instead of through it */
  const w = smooth(0.55, 1.05, v.x);
  if (w > 0) for (const [cx, cy, cz, r] of STOMACH) {
    const dx = v.x - cx, dy = v.y - cy, q = r * r - dx * dx - dy * dy;
    if (q > 0) v.z = lerp(v.z, smax(v.z, cz + Math.sqrt(q) + 0.05, 14), w);
  }
  v.multiplyScalar(1 + 0.012 * noise3(v.x * 4, v.y * 4, v.z * 4));
}

let groove;                                       // per-vertex fissure weight 0..1 (ambient darkening in paint())
/** second pass: carve the lobe boundaries along the vertex normals of the base silhouette */
function carve(geo) {
  const pos = geo.attributes.position, nrm = geo.attributes.normal, p = new THREE.Vector3(), n = new THREE.Vector3();
  groove = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i); n.fromBufferAttribute(nrm, i);
    const under = smooth(-0.1, -0.55, n.y), back = smooth(-0.15, -0.65, n.z), front = smooth(0.1, 0.6, n.z) + smooth(0.3, 0.8, n.y);
    let d = 0;
    /* falciform fissure on the anterior / superior surface (already grooved in liverShape): sharpen + darken */
    d += 0.14 * gauss(p.x, 0.57, 0.1) * clamp(front, 0, 1) * smooth(-0.3, 0.1, p.z);
    /* fissure for ligamentum teres: visceral face, continues the falciform groove back to the porta */
    d += 0.14 * gauss(p.x, 0.57, 0.13) * under * smooth(-0.5, -0.25, p.z);
    /* fissure for ligamentum venosum: posterior face, from the porta up toward the IVC */
    d += 0.13 * gauss(p.x, 0.62, 0.14) * back * smooth(0.85, 0.35, p.y) * smooth(-0.1, -0.4, p.z);
    /* porta hepatis (transverse fissure) */
    d += 0.17 * gauss(p.z, -0.35, 0.14) * under * smooth(-0.55, -0.25, p.x) * smooth(0.85, 0.6, p.x);
    /* gallbladder fossa, right of the quadrate lobe, along the gallbladder axis */
    const gx = GB_NECK.x + (GB_FUNDUS.x - GB_NECK.x) * clamp((p.z - GB_NECK.z) / (GB_FUNDUS.z - GB_NECK.z), 0, 1);
    d += 0.09 * gauss(p.x, gx, 0.18) * under * smooth(-0.3, -0.05, p.z) * smooth(1.35, 1.1, p.z);
    /* IVC groove on the posterior face: deep, the vein lies half-embedded in it */
    d += 0.34 * gauss(p.x, IVC_X, 0.2) * back * smooth(0.7, 0.25, p.y);
    /* lobes stand proud: caudate (between IVC and lig. venosum), quadrate (between fossa and lig. teres) */
    d -= 0.07 * gauss(p.x, 0.4, 0.1) * Math.max(back, under) * smooth(-0.15, -0.45, p.z) * smooth(0.8, 0.4, p.y);
    d -= 0.03 * gauss(p.x, 0.14, 0.2) * under * smooth(-0.3, -0.1, p.z) * smooth(1.2, 0.9, p.z);
    groove[i] = clamp(d / 0.07, 0, 1);
    p.addScaledVector(n, -d);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/* ---------- colours ---------- */
let C, noise, root, A, B, lastA = -1, lastB = -1;
const cHealthy = new THREE.Color(palette.liverHealthy), cFatty = new THREE.Color(palette.liverFatty), cSpots = new THREE.Color(palette.liverSpots);
const cSheen = new THREE.Color(palette.liverSheen), cFattySheen = new THREE.Color(palette.liverFattySheen);
const cHV = new THREE.Color(palette.hepaticVein), cPV = new THREE.Color(palette.portalVein), cDeoxy = new THREE.Color(palette.bloodDeoxy);

/** paint fatty-liver colours: e = f^1.35 -> pale, blotchy; fissures are darkened */
export function paint(geo, e) {
  const col = geo.attributes.color, c = new THREE.Color();
  for (let i = 0; i < noise.length; i++) {
    const n = noise[i];
    c.copy(cHealthy).lerp(cFatty, clamp(e * 0.85 + n * 0.25 * e, 0, 1));
    if (n > 0.35) c.lerp(cSpots, clamp((n - 0.35) * 2.2 * e, 0, 0.8));
    c.multiplyScalar((0.92 + 0.12 * n) * (1 - 0.55 * groove[i]));
    col.setXYZ(i, c.r, c.g, c.b);
  }
  col.needsUpdate = true;
}
/** healthy liver: deep red, moderate clearcoat. fatty liver: greasy — clearcoat up, roughness down, pale sheen */
function gloss(mat, e) {
  mat.roughness = lerp(0.36, 0.14, e); mat.clearcoat = lerp(0.72, 1, e); mat.clearcoatRoughness = lerp(0.28, 0.08, e);
  mat.sheen = lerp(0.45, 0.95, e); mat.sheenRoughness = lerp(0.55, 0.3, e);
  mat.sheenColor.copy(cSheen).lerp(cFattySheen, e);
}
/* always in the transparent pass (one shader variant, no recompile when fading) but drawn first (renderOrder −5) with
 * depth write, which behaves exactly like an opaque organ at opacity 1 and lets the opaque trees show through when faded */
const lobeMat = () => OrganMat(palette.white, { vertexColors: true, map: liverVeinTex, sheenColor: cSheen.clone(), emissiveIntensity: 0, transparent: true, opacity: 1, depthWrite: true });

/* ---------- vascular trees (grown once, geometry shared by the A and B copies) ---------- */
const E = { c: P(-0.15, 0.22, 0.05), r: P(1.95, 0.72, 1.12) };      // "safe" ellipsoid: branches stay inside the lobes
function keepInside(p) {
  const tl = smooth(0.6, 2, p.x), q = p.clone().sub(E.c).divide(E.r);  // the left lobe is thinner
  q.y /= 1 - 0.55 * tl; q.z /= 1 - 0.25 * tl;
  const d = q.length();
  if (d > 0.9) { q.multiplyScalar(0.9 / d); q.y *= 1 - 0.55 * tl; q.z *= 1 - 0.25 * tl; p.copy(q.multiply(E.r).add(E.c)); }
  return p;
}
/** recursive branch grower. lvl 0/1 -> T.main, lvl >= 2 -> T.detail (visible only in close-up) */
function grow(T, p0, dir, len, r, depth, lvl) {
  const pts = [p0.clone()], d = dir.clone().normalize(); let p = p0.clone();
  for (let i = 1; i <= 3; i++) {
    d.add(P(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(0.3)).normalize();
    p = keepInside(p.clone().addScaledVector(d, len / 3)); pts.push(p);
  }
  const store = lvl >= 2 ? T.detail : T.main;
  store.push(vtube(pts, (u) => r * (1 - 0.36 * u), 12, lvl >= 2 ? 6 : 8, 0.5));
  if (depth > 0) {
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
  const N = 28, att = [], free = [], sag = P(0, 0.15, 0.1);
  for (let i = 0; i <= N; i++) {
    const a = lerp(-0.75, 2.35, i / N), u = P(0.259, 0.966 * Math.cos(a), 0.966 * Math.sin(a));
    liverShape(u);
    const n = P(0, u.y - sag.y, u.z - sag.z).normalize(), w = 0.46 * Math.pow(Math.sin(Math.PI * i / N), 0.7);
    att.push(u.clone().addScaledVector(n, -0.22)); free.push(u.clone().addScaledVector(n, w));    // attached edge sits in the carved fissure
  }
  const g = new THREE.BufferGeometry(), pos = [], uv = [], idx = [];
  for (let i = 0; i <= N; i++) { pos.push(att[i].x, att[i].y, att[i].z, free[i].x, free[i].y, free[i].z); uv.push(i / N, 0, i / N, 1); }
  for (let i = 0; i < N; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  g.setIndex(idx); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  /* round ligament: along the free edge from the umbilicus to the notch, then in the fissure on the visceral face */
  const cord = free.slice(19);
  for (let k = 1; k <= 6; k++) { const u = P(0.259, -Math.sqrt(1 - 0.259 * 0.259 - (0.78 - k * 0.14) ** 2), 0.78 - k * 0.14); liverShape(u); u.y -= 0.03; cord.push(u); }
  return { sheet: g, cord: vtube(cord, (u) => 0.034 * (1 - 0.3 * u), 48, 7, 0.4) };
}

/* ---------- gallbladder: pear along its fossa, fundus peeking below the inferior border ---------- */
function gallbladder() {
  const g = deform(new THREE.SphereGeometry(1, 28, 22), (v) => {
    const k = 1 - 0.58 * smooth(-0.2, 1, v.y);
    v.x *= 0.21 * k; v.z *= 0.21 * k; v.y *= 0.62;
    v.multiplyScalar(1 + 0.02 * noise3(v.x * 9, v.y * 9, v.z * 9));
  });
  const m = add(g, OrganMat(palette.gallbladder, { clearcoat: 0.95, roughness: 0.22, clearcoatRoughness: 0.12, emissiveIntensity: 0.1 }), root, 'liver');
  m.position.lerpVectors(GB_FUNDUS, GB_NECK, 0.5);
  m.quaternion.setFromUnitVectors(P(0, 1, 0), GB_NECK.clone().sub(GB_FUNDUS).normalize());
  return m;
}

/* ---------- state copies ---------- */
let portalMat, hvMat, artMat, bileMat, detailMats = [], trees;
function makeState(layer, key) {
  const S = { layer };
  S.g = new THREE.Group(); S.g.position.copy(PIVOT); root.add(S.g);
  const inner = new THREE.Group(); inner.position.copy(PIVOT).negate(); S.g.add(inner);
  /* lobes */
  S.geo = trees.lobes.clone();
  S.geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(noise.length * 3), 3));
  S.mat = lobeMat();
  S.lobes = add(S.geo, S.mat, inner, key); S.lobes.layers.set(layer); S.lobes.renderOrder = -5;
  /* falciform ligament sheet + round ligament */
  const sheet = add(trees.falc.sheet, trees.sheetMat, inner, key); sheet.layers.set(layer);
  const cord = add(trees.falc.cord, trees.cordMat, inner, key); cord.layers.set(layer);
  /* intrahepatic trees */
  for (const [tr, mat] of [[trees.portal, portalMat], [trees.hv, hvMat], [trees.art, artMat], [trees.bile, bileMat]]) {
    add(tr.main, mat, inner, key).layers.set(layer);
  }
  S.detail = new THREE.Group(); inner.add(S.detail); S.detail.visible = false;
  for (const [tr, mat] of [[trees.portal, detailMats[0]], [trees.hv, detailMats[1]], [trees.art, detailMats[2]], [trees.bile, detailMats[3]]]) {
    if (!tr.detail) continue;
    const m = add(tr.detail, mat, S.detail, key); m.layers.set(layer); m.renderOrder = -6;    // drawn before the capsule
  }
  S.g.traverse((o) => o.layers.set(layer));
  return S;
}
function relay(S, f) {
  const e = Math.pow(clamp(f, 0, 1), 1.35);
  paint(S.geo, e); gloss(S.mat, e);
  S.g.scale.setScalar(1 + 0.15 * clamp(f, 0, 1));
}

export function build(ctx) {
  C = ctx;
  const ab = ctx.groups.abdomen;
  root = new THREE.Group(); root.position.copy(liverPos); root.rotation.z = ROT_Z; ab.add(root);

  /* lobes geometry: silhouette, then lobe boundaries carved along the normals; per-vertex blotch noise */
  const lobes = carve(deform(new THREE.SphereGeometry(1, 96, 72), liverShape));
  const pos = lobes.attributes.position; noise = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++)
    noise[i] = noise3(pos.getX(i) * 6.3, pos.getY(i) * 6.3, pos.getZ(i) * 6.3) * 0.5 + 0.5 * noise3(pos.getX(i) * 15, pos.getY(i) * 15, pos.getZ(i) * 15);

  /* vessel materials (shared by A/B); detail twigs fade with the close-up */
  const vm = (c) => OrganMat(c, { roughness: 0.3, clearcoat: 0.9, bumpScale: 0.2, emissiveIntensity: 0.1 });
  portalMat = vm(palette.portalVein); hvMat = vm(palette.hepaticVein); artMat = vm(palette.hepaticArtery); bileMat = vm(palette.bileDuct);
  detailMats = [palette.portalVein, palette.hepaticVein, palette.hepaticArtery, palette.bileDuct].map((c) => OrganMat(c, { roughness: 0.3, clearcoat: 0.9, bumpScale: 0.2, emissiveIntensity: 0.1, transparent: true, opacity: 0, depthWrite: false }));

  setSeed(4201);
  trees = {
    lobes,
    portal: tree([[PORTA, P(-1, 0.3, 0.3), 0.8, 0.075, 3], [PORTA, P(1, 0.35, 0.35), 0.7, 0.065, 3], [PORTA, P(0.35, 0.35, -0.6), 0.35, 0.03, 1]]),
    hv: tree([[IVC_TOP, P(-1, -0.45, 0.35), 0.9, 0.07, 2], [IVC_TOP, P(-0.05, -0.75, 0.75), 0.75, 0.06, 2], [IVC_TOP, P(1, -0.35, 0.5), 0.7, 0.055, 2]]),
    art: tree([[P(0.26, -0.4, -0.28), P(-1, 0.4, 0.4), 0.75, 0.034, 2], [P(0.26, -0.4, -0.28), P(1, 0.45, 0.3), 0.65, 0.03, 2]]),
    bile: tree([[P(0.12, -0.44, -0.3), P(-1, 0.3, 0.45), 0.7, 0.03, 1], [P(0.12, -0.44, -0.3), P(1, 0.35, 0.35), 0.6, 0.028, 1]]),
    falc: falciform(),
    sheetMat: OrganMat(palette.ligament, { transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false, roughness: 0.55, sheen: 0.5, clearcoat: 0.25, emissiveIntensity: 0 }),
    cordMat: OrganMat(palette.ligament, { roughness: 0.45, sheen: 0.3, clearcoat: 0.4 }),
  };
  A = makeState(LAYER.A, 'liver'); B = makeState(LAYER.B, 'liver');

  /* static parts (layer 0): gallbladder + cystic duct, extrahepatic trunks that join the neighbours */
  gallbladder();
  add(vtube([GB_NECK, P(-0.05, -0.5, -0.12), P(0.03, -0.6, -0.23)], () => 0.028, 16, 7), bileMat, root, 'liver');                                        // cystic duct
  add(vtube([P(0.12, -0.36, -0.3), P(0.04, -0.58, -0.24), P(-0.08, -0.82, -0.3), P(-0.3, -1.05, -0.2)], () => 0.034, 28, 8), bileMat, root, 'liver');    // common hepatic -> common bile duct (to the duodenum)
  add(vtube([P(0.38, -1.08, -0.82), P(0.3, -0.8, -0.6), P(0.22, -0.52, -0.38), P(0.2, -0.36, -0.32)], () => 0.09, 28, 10), portalMat, root, 'liver');     // portal vein trunk (from behind the pancreas)
  add(vtube([P(0.88, -0.68, -1.1), P(0.55, -0.62, -0.72), P(0.32, -0.5, -0.42), P(0.26, -0.36, -0.29)], () => 0.038, 28, 8), artMat, root, 'liver');     // hepatic artery (from the coeliac trunk)

  ctx.anchors.liverPos = liverPos;
  ctx.anchors.liverG = root;
  ctx.anchors.portaPos = PORTA.clone().applyAxisAngle(P(0, 0, 1), ROT_Z).add(liverPos);
}

/* ---------- per frame ---------- */
const tmp = new THREE.Vector3();
let near = 0, lastT = -1, lastSat = -1;
export function update(f, t, phys) {
  const dt = lastT < 0 ? 0 : clamp(t - lastT, 0, 0.4); lastT = t;
  if (Math.abs(f - lastA) > 1e-4) { relay(A, f); lastA = f; }
  if (C.state.bVersion !== lastB) { relay(B, C.state.fB); lastB = C.state.bVersion; }

  /* close-up: ease the capsule to a translucent look and let the vessels glow so the trees read through */
  root.getWorldPosition(tmp);
  const want = smooth(16.5, 12, C.camera.position.distanceTo(tmp));
  near = lerp(near, want, 1 - Math.exp(-dt * 3.5));
  const op = 1 - 0.42 * near, glow = 0.1 + 0.65 * near;
  for (const S of [A, B]) { S.mat.opacity = op; S.detail.visible = near > 0.03; }
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
