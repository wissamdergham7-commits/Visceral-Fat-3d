// organs/digestive.js — digestive system.
//  * stomach: J-shaped (fundus under the left dome, body, antrum, pylorus) with greater / lesser curvature, incisura
//    angularis, pyloric ring, oesophageal stub at the cardia, gastric vessels on both curvatures; internal rugae
//    (longitudinal folds) become visible through the anterior wall when the camera comes close (eased, no popping)
//  * duodenal C-loop hugging the pancreatic head; pancreas head / neck / body / tail with a lobulated surface
//    (vertex colours palette.pancreasHead → pancreas → pancreasTail); splenic vein + artery, portal vein, SMV stub
//  * spleen with a notched anterior border and hilum vessels
//  * colon: caecum + appendix, ascending (patient right = -x), hepatic flexure, transverse (sagging), splenic flexure
//    (higher, posterolateral to the stomach), descending, sigmoid, rectum; irregular haustra between three taeniae
//  * small intestine: random lattice-packed loops (no self-intersection by construction), travelling peristalsis
//    waves in the vertex shader (phase = f(uv.x, time))
// Publishes anchors.colonCurve / anchors.siCurve (CatmullRomCurve3, consumed by organs/fat.js) + stomachPos,
// duodenumCurve, pancreasCurve. Everything here is static (layer 0): nothing in this module depends on fat.
import { THREE, P, clamp, lerp, smooth, gauss, noise3, rnd, setSeed, deform, vtube, add } from '../core/ctx.js';
import { palette, OrganMat, gutVeinTex } from '../core/style.js';

// (oesophagus colour merged into core/style.js palette)

const TAU = Math.PI * 2;
let C, siShader = null, wallMat = null, detailG = null, detailMats = [], stomachPos = null, kEase = 0, lastT = 0, siInfo = null;

/* ---------- small helpers ---------- */
function put(geo, mat, parent, key) { const m = add(geo, mat, parent, key); m.userData.mod = 'digestive'; return m; }
/** smooth table lookup: t = [[u, value], ...] (u ascending), smoothstep between rows */
function tabS(t, u) {
  if (u <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) if (u <= t[i][0]) return lerp(t[i - 1][1], t[i][1], smooth(t[i - 1][0], t[i][0], u));
  return t[t.length - 1][1];
}
/** rounded closed ends: radius factor for a tube capped over the first a and last b of u */
const capped = (u, a, b) => u < a ? Math.sqrt(Math.max(0, 1 - ((a - u) / a) ** 2)) : u > 1 - b ? Math.sqrt(Math.max(0, 1 - ((u - 1 + b) / b) ** 2)) : 1;

/** Sweep a closed cross-section along a Catmull-Rom curve. rFn(u, th) = radius at arc-length u, angle th.
 *  Frames come from a fixed `up` vector (n = t × up, b = t × n) so attachments computed with geo.userData.surf()
 *  land exactly on the mesh. uv.x = u (used by shaders), optional colFn(u, th, Color) writes vertex colours. */
function sweep(pts, rFn, segs, radial, up, opts = {}) {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', opts.tension ?? 0.5);
  const n = (segs + 1) * (radial + 1);
  const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = opts.colFn ? new Float32Array(n * 3) : null;
  const c = new THREE.Vector3(), t = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(), v = new THREE.Vector3(), cc = new THREE.Color();
  const frame = (u) => { curve.getPointAt(u, c); curve.getTangentAt(u, t); N.crossVectors(t, up).normalize(); B.crossVectors(t, N).normalize(); };
  for (let i = 0; i <= segs; i++) {
    const u = i / segs; frame(u);
    for (let j = 0; j <= radial; j++) {
      const th = j / radial * TAU, r = rFn(u, th), k = i * (radial + 1) + j;
      v.copy(c).addScaledVector(N, Math.cos(th) * r).addScaledVector(B, Math.sin(th) * r);
      pos[k * 3] = v.x; pos[k * 3 + 1] = v.y; pos[k * 3 + 2] = v.z; uv[k * 2] = u; uv[k * 2 + 1] = j / radial;
      if (col) { opts.colFn(u, th, cc); col[k * 3] = cc.r; col[k * 3 + 1] = cc.g; col[k * 3 + 2] = cc.b; }
    }
  }
  const idx = [];
  for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) { const a = i * (radial + 1) + j, b = a + radial + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx); geo.computeVertexNormals();
  geo.userData.curve = curve;
  geo.userData.surf = (u, th, k = 1, out = new THREE.Vector3()) => {
    frame(u); const r = rFn(u, th) * k;
    return out.copy(c).addScaledVector(N, Math.cos(th) * r).addScaledVector(B, Math.sin(th) * r);
  };
  return geo;
}
const UPZ = new THREE.Vector3(0, 0, 1);
const UPC = new THREE.Vector3(0.3, 1, 0.2).normalize();      // same reference as organs/fat.js uses along the colon

/* ============================== stomach + oesophagus ============================== */
function buildStomach(ab) {
  /* central axis: fundus apex (cap) -> fundus -> body (greater curvature lateral, +x) -> antrum -> pylorus (-x, under the liver) */
  const axis = [P(1.56, 0.2, -0.34), P(1.65, -0.12, -0.26), P(1.8, -0.56, -0.05), P(1.8, -0.95, 0.2), P(1.42, -1.18, 0.42), P(0.85, -1.3, 0.6), P(0.25, -1.2, 0.7), P(-0.32, -1.0, 0.68)];
  const RT = [[0.1, 0.4], [0.3, 0.45], [0.5, 0.45], [0.65, 0.42], [0.8, 0.35], [0.9, 0.28], [0.955, 0.2], [0.975, 0.23], [1, 0.19]];
  const base = (u) => u < 0.1 ? 0.4 * Math.sqrt(Math.max(0, 1 - ((0.1 - u) / 0.1) ** 2)) : tabS(RT, u);
  /* th = 0 : lesser curvature (inner side of the J), th = PI : greater curvature, th = PI/2 posterior, 3PI/2 anterior */
  const rFn = (u, th) => {
    const ct = Math.cos(th), st = Math.sin(th);
    let r = base(u) * (1 + 0.13 * (0.5 - 0.5 * ct)) * (1 - 0.12 * st * st);
    r *= 1 - 0.2 * gauss(u, 0.66, 0.06) * Math.max(0, ct) ** 3;                 // incisura angularis
    r *= 1 - 0.1 * gauss(u, 0.945, 0.018);                                        // pyloric sphincter ring
    r *= 1 + 0.008 * Math.sin(th * 13 + u * 9) * smooth(0.12, 0.4, u);            // faint relief of the folds beneath the serosa
    return r;
  };
  const geo = sweep(axis, rFn, 220, 40, UPZ);
  wallMat = OrganMat(palette.stomach, { map: gutVeinTex, sheenColor: new THREE.Color(palette.stomachSheen), roughness: 0.3, clearcoat: 0.9, clearcoatRoughness: 0.18, transparent: true, opacity: 1 });
  put(geo, wallMat, ab, 'stomach');
  const surf = geo.userData.surf;
  stomachPos = surf(0.5, 0, 0).clone();

  /* rugae: inner mucosal tube with ~13 wavy longitudinal folds, seen through the wall when close (detail group) */
  const ridge = (u, th) => Math.pow(0.5 + 0.5 * Math.cos(th * 13 + 1.6 * Math.sin(u * 8 + th * 0.5) + 0.5 * Math.sin(u * 25)), 1.4);
  const rugae = sweep(axis, (u, th) => rFn(u, th) * (0.73 + 0.14 * ridge(u, th)), 150, 96, UPZ, { colFn: (u, th, c) => c.setScalar(0.55 + 0.5 * ridge(u, th)) });
  put(rugae, OrganMat(palette.rugae, { vertexColors: true, roughness: 0.38, clearcoat: 0.8, clearcoatRoughness: 0.2, sheenColor: new THREE.Color(palette.stomachInner), emissiveIntensity: 0.05 }), detailG, 'stomach');

  /* oesophageal stub entering at the cardia (medial-posterior wall, just below the fundus) */
  const card = surf(0.2, 0.55, 0.9).clone();
  const oes = [card, card.clone().add(P(-0.2, 0.06, -0.14)), P(0.72, -0.02, -0.55), P(0.45, 0.28, -0.66), P(0.28, 0.6, -0.72)];
  put(vtube(oes, (u) => 0.15 * (u < 0.15 ? lerp(1.35, 1, u / 0.15) : capped(u, 0, 0.1)), 60, 14), OrganMat(palette.oesophagus, { roughness: 0.4, map: gutVeinTex }), ab, 'stomach');

  /* vessels: gastroepiploic along the greater curvature, left gastric along the lesser curvature */
  const vesselA = OrganMat(palette.omentumVessel, { roughness: 0.3, clearcoat: 0.9, bumpScale: 0.2 });
  const arteryMat = OrganMat(palette.aorta, { roughness: 0.3, clearcoat: 0.9, bumpScale: 0.2 });
  { const pts = []; for (let i = 0; i <= 40; i++) { const u = lerp(0.13, 0.96, i / 40); pts.push(surf(u, Math.PI + 0.22 * Math.sin(u * 11), 1.0).clone()); }
    put(vtube(pts, (u) => 0.036 * (1 - 0.3 * u), 120, 7, 0.3), vesselA, ab, 'stomach'); }
  { const pts = []; for (let i = 0; i <= 36; i++) { const u = lerp(0.22, 0.95, i / 36); pts.push(surf(u, 0.12 * Math.sin(u * 7), 1.0).clone()); }
    put(vtube(pts, (u) => 0.03 * (1 - 0.3 * u), 110, 7, 0.3), arteryMat, ab, 'stomach'); }
  /* small branches running around the body from both curvatures (detail group, faded in with the rugae) */
  const branchMat = OrganMat(palette.omentumVessel, { roughness: 0.3, clearcoat: 0.9, transparent: true, opacity: 0, bumpScale: 0.2 });
  detailMats.push(branchMat);
  for (let i = 0; i < 7; i++) {
    const u0 = 0.2 + 0.105 * i;
    for (const s of [-1, 1]) {
      const pts = []; for (let k = 0; k <= 10; k++) { const th = Math.PI + s * 1.15 * k / 10; pts.push(surf(u0 + 0.025 * Math.sin(th * 3 + i), th, 1.0).clone()); }
      put(vtube(pts, (u) => 0.02 * (1 - 0.5 * u), 20, 6, 0.3), branchMat, detailG, 'stomach');
    }
  }
  return geo;
}

/* ============================== duodenum + pancreas + portal system ============================== */
function buildDuodenumPancreas(ab) {
  /* duodenum: pylorus -> D1 (superior) -> D2 (descending, anterior to the right kidney) -> D3 (horizontal, under the
     pancreatic head, anterior to aorta / IVC) -> D4 (ascending) -> duodenojejunal flexure */
  const dpts = [P(-0.32, -1.0, 0.68), P(-0.72, -1.02, 0.52), P(-0.98, -1.18, 0.25), P(-1.04, -1.55, 0.08), P(-0.92, -1.92, -0.02), P(-0.45, -2.08, -0.1), P(0.1, -2.0, -0.18), P(0.45, -1.78, -0.18), P(0.52, -1.5, -0.1)];
  const duo = sweep(dpts, (u) => 0.2 * (1 + 0.025 * Math.sin(u * 60)) * (1 - 0.08 * gauss(u, 0.0, 0.02)), 130, 18, UPZ);
  put(duo, OrganMat(palette.duodenum, { map: gutVeinTex, sheenColor: new THREE.Color(palette.smallBowelSheen) }), ab, 'si');

  /* pancreas: uncinate / head (inside the C-loop) -> neck (in front of the portal confluence) -> body (across the aorta
     and the left kidney, behind the stomach) -> tail (to the splenic hilum). Flattened antero-posteriorly, lobulated. */
  const paxis = [P(-0.62, -1.8, -0.08), P(-0.55, -1.5, -0.2), P(-0.18, -1.4, -0.36), P(0.4, -1.25, -0.5), P(1.0, -1.05, -0.62), P(1.5, -0.78, -0.65), P(1.8, -0.5, -0.58)];
  const PT = [[0, 0.3], [0.12, 0.36], [0.26, 0.34], [0.36, 0.24], [0.5, 0.27], [0.7, 0.24], [0.88, 0.18], [1, 0.12]];
  const lob = (u, th) => clamp(0.5 + 0.5 * (0.7 * noise3(u * 26, th * 1.4, 1.3) + 0.5 * noise3(u * 55, th * 2.6, 4.1)), 0, 1);
  const prFn = (u, th) => {
    const a = tabS(PT, u), b = a * 0.58, ct = Math.cos(th), st = Math.sin(th);
    return (1 / Math.sqrt((ct / a) ** 2 + (st / b) ** 2)) * (1 + 0.07 * lob(u, th)) * capped(u, 0.08, 0.06);
  };
  const cHead = new THREE.Color(palette.pancreasHead), cBody = new THREE.Color(palette.pancreas), cTail = new THREE.Color(palette.pancreasTail);
  const pan = sweep(paxis, prFn, 170, 26, UPZ, { colFn: (u, th, c) => c.copy(cHead).lerp(cBody, smooth(0.2, 0.42, u)).lerp(cTail, smooth(0.62, 0.95, u)).multiplyScalar(0.88 + 0.16 * lob(u, th)) });
  put(pan, OrganMat(palette.white, { vertexColors: true, roughness: 0.52, clearcoat: 0.45, clearcoatRoughness: 0.3, sheen: 0.4, emissiveIntensity: 0.03, bumpScale: 0.35 }), ab, 'pancreas');

  /* portal venous system (purple) + splenic artery (red) along the upper border of the pancreas */
  const veinMat = OrganMat(palette.splenicVein, { roughness: 0.3, clearcoat: 0.9, bumpScale: 0.2 });
  const portalMat = OrganMat(palette.portalVein, { roughness: 0.3, clearcoat: 0.9, bumpScale: 0.2 });
  const arteryMat = OrganMat(palette.aorta, { roughness: 0.3, clearcoat: 0.9, bumpScale: 0.2 });
  const conf = P(0.02, -1.35, -0.68);
  put(vtube([P(1.85, -0.33, -0.54), P(1.6, -0.62, -0.72), P(1.1, -0.95, -0.8), P(0.5, -1.18, -0.76), conf], (u) => 0.055 + 0.025 * u, 90, 10), veinMat, ab, 'spleen');          // splenic vein
  put(vtube([P(0.18, -2.1, 0.18), P(0.15, -1.88, 0.12), P(0.1, -1.68, -0.25), P(0.05, -1.5, -0.58), conf], () => 0.07, 70, 10), portalMat, ab, 'si');                            // superior mesenteric vein
  put(vtube([conf, P(-0.3, -1.2, -0.5), P(-0.55, -0.95, -0.35), P(-0.72, -0.62, -0.25)], (u) => 0.09 - 0.01 * u, 60, 12), portalMat, ab, 'liver');                                // portal vein -> liver
  { const pts = [P(0.25, -1.05, -0.75)]; for (let i = 1; i <= 7; i++) { const u = i / 7; pts.push(P(lerp(0.25, 1.82, u), lerp(-1.05, -0.28, u) + 0.06 * Math.sin(i * 2.7), lerp(-0.76, -0.55, u) - 0.05 * Math.sin(i * 2.2))); }
    put(vtube(pts, () => 0.045, 90, 8, 0.3), arteryMat, ab, 'spleen'); }                                                                                                        // splenic artery (tortuous)
  return { duo, pan };
}

/* ============================== spleen ============================== */
function buildSpleen(ab) {
  const g = deform(new THREE.SphereGeometry(1, 56, 42), (v) => {
    /* notched anterior border: the edge in the local (-x, +z) direction faces anteriorly after the y-rotation */
    const phi = Math.atan2(v.z, -v.x), e = gauss(phi, Math.PI / 4, 0.42) * smooth(-0.1, 0.25, v.y);
    const notch = 0.17 * e * (gauss(v.y, 0.28, 0.07) + 0.8 * gauss(v.y, 0.56, 0.065));
    v.multiplyScalar(1 - notch);
    v.x *= 0.45; v.y *= 0.88; v.z *= 0.3; v.x += 0.12 * v.y * v.y;
    if (v.x < -0.2) v.x += 0.06 * gauss(v.z, 0.02, 0.09) * smooth(-0.2, -0.4, v.x) * (1 - smooth(0.45, 0.7, Math.abs(v.y)));   // hilum groove (medial face)
    v.multiplyScalar(1 + 0.01 * noise3(v.x * 9, v.y * 9, v.z * 9));
  });
  const m = put(g, OrganMat(palette.spleen, { clearcoat: 0.75, roughness: 0.3 }), ab, 'spleen');
  m.position.set(2.2, -0.3, -0.78); m.rotation.y = 0.6;
  /* hilum: short vein branches entering the medial face (local -x) */
  const W = (lx, ly, lz) => P(2.2 + lx * Math.cos(0.6) + lz * Math.sin(0.6), -0.3 + ly, -0.78 - lx * Math.sin(0.6) + lz * Math.cos(0.6));
  const veinMat = OrganMat(palette.splenicVein, { roughness: 0.3, clearcoat: 0.9, bumpScale: 0.2 });
  for (const [ly, lz] of [[-0.28, 0.0], [0.0, 0.03], [0.3, -0.02]]) put(vtube([W(-0.6, -0.03 + ly * 0.2, 0.08), W(-0.46, ly * 0.6, lz + 0.04), W(-0.36, ly, lz)], (u) => 0.038 * (1 - 0.25 * u), 24, 8), veinMat, ab, 'spleen');
}

/* ============================== colon ============================== */
function buildColon(ab) {
  /* hepatic flexure under the right lobe (y ≈ −1.62); transverse colon sags below the stomach's greater curvature; the
   * splenic flexure sits HIGHER (y ≈ −1.38), posterolateral to the stomach, below the spleen's lower pole and lateral to
   * the left kidney's capsule (clearances checked against those organs' centres and radii) */
  const cpts = [P(-1.9, -3.5, 0.55), P(-1.95, -3.05, 0.6), P(-1.98, -2.55, 0.62), P(-1.97, -2.1, 0.66), P(-1.94, -1.85, 0.68), P(-1.72, -1.62, 0.78),
    P(-1.1, -1.95, 1.0), P(-0.4, -2.18, 1.06), P(0.4, -2.28, 1.06), P(1.1, -2.25, 0.95), P(1.6, -2.15, 0.6), P(2.05, -1.38, -0.35),
    P(2.1, -2.0, -0.15), P(2.02, -2.6, 0.2), P(1.9, -3.2, 0.4), P(1.45, -3.65, 0.68), P(0.85, -3.78, 0.75), P(0.35, -3.55, 0.35), P(0.08, -3.78, -0.15), P(0.02, -4.15, -0.5), P(0, -4.45, -0.65)];
  const curve0 = new THREE.CatmullRomCurve3(cpts, false, 'catmullrom', 0.5), L = curve0.getLength();
  /* irregular sacculations: three rows (between the taeniae), each its own random segmentation along the arc length */
  setSeed(2002);
  const rows = [];
  for (let k = 0; k < 3; k++) {
    const b = [0], amp = []; let s = 0.08 + 0.3 * rnd();
    while (s < L) { b.push(s); amp.push(0.8 + 0.2 * rnd()); s += (0.34 + 0.18 * rnd()) * (s / L > 0.72 ? 0.85 : 1); }
    b.push(L + 1); amp.push(0.9); rows.push({ b, amp, cur: 0 });
  }
  const sac = (u, k) => {
    const R = rows[k], s = u * L; while (R.cur > 0 && R.b[R.cur] > s) R.cur--; while (R.b[R.cur + 1] <= s) R.cur++;
    const f = (s - R.b[R.cur]) / (R.b[R.cur + 1] - R.b[R.cur]);
    return Math.pow(Math.sin(Math.PI * clamp(f, 0, 1)), 0.55) * R.amp[R.cur];
  };
  const TH0 = 0.4, RT = [[0, 0.4], [0.07, 0.4], [0.14, 0.36], [0.6, 0.36], [0.75, 0.33], [0.86, 0.3], [0.93, 0.3], [1, 0.26]];
  const hau = (u) => smooth(0.015, 0.05, u) * (1 - smooth(0.87, 0.95, u));
  const part = (th) => { const phi = ((th - TH0) % TAU + TAU) % TAU; return { k: Math.min(2, Math.floor(phi / (TAU / 3))), w: 0.5 - 0.5 * Math.cos(3 * phi) }; };
  const rFn = (u, th) => {
    const { k, w } = part(th), a = hau(u), sc = sac(u, k) * Math.pow(w, 0.7);
    return tabS(RT, u) * capped(u, 0.035, 0.03) * (1 + a * (0.17 * sc - 0.05 * (1 - w)));
  };
  const colFn = (u, th, c) => { const { k, w } = part(th); c.setScalar(0.82 + 0.18 * clamp(sac(u, k) * w + 0.5 * (1 - w), 0, 1)); };
  const geo = sweep(cpts, rFn, 760, 30, UPC, { colFn });
  put(geo, OrganMat(palette.colon, { vertexColors: true, map: gutVeinTex, sheenColor: new THREE.Color(palette.colonSheen), roughness: 0.3, clearcoat: 0.9, clearcoatRoughness: 0.2 }), ab, 'colon');
  const surf = geo.userData.surf;
  /* three taeniae coli riding the wall between the sacculations, fading out on the rectum */
  const taeniaMat = OrganMat(palette.taenia, { roughness: 0.42, clearcoat: 0.6 });
  for (let k = 0; k < 3; k++) {
    const th = TH0 + k * TAU / 3, pts = [];
    for (let i = 0; i <= 150; i++) { const u = lerp(0.03, 0.9, i / 150); pts.push(surf(u, th, 1.01).clone()); }
    put(vtube(pts, (u) => 0.045 * (1 - smooth(0.9, 1, u) * 0.8), 220, 7, 0.3), taeniaMat, ab, 'colon');
  }
  /* appendix hanging from the postero-medial caecum */
  put(vtube([P(-1.74, -3.62, 0.4), P(-1.6, -3.88, 0.3), P(-1.3, -3.99, 0.4), P(-1.02, -3.9, 0.56)], (u) => (0.085 - 0.02 * u) * capped(u, 0, 0.12), 40, 9), OrganMat(palette.appendix, { roughness: 0.4 }), ab, 'colon');
  return geo.userData.curve;
}

/* ============================== small intestine ============================== */
/** lattice-packed random loop path inside the colon frame: a straight-run-preferring Warnsdorff walk on a 3D lattice
 *  (spacing 0.46 > tube diameter + gap), joined to the ileocaecal cell by a BFS through free cells. Non-adjacent runs
 *  are ≥ 0.46 apart, so the smoothed tube never intersects itself. Deterministic (seeded). */
function siLatticePath(colonCurve, duoCurve) {
  const xs = [-1.22, -0.82, -0.42, -0.02, 0.38, 0.78, 1.18], ys = [-1.9, -2.31, -2.72, -3.13, -3.54], zs = [-0.42, -0.01, 0.4, 0.81];
  const sample = (cv, n) => { const a = []; for (let i = 0; i <= n; i++) a.push(cv.getPointAt(i / n)); return a; };
  const cp = sample(colonCurve, 260), dp = sample(duoCurve, 60);
  const dist = (p, arr) => { let m = 1e9; for (const q of arr) m = Math.min(m, p.distanceToSquared(q)); return Math.sqrt(m); };
  const cells = [], idx = new Map();
  xs.forEach((x, ix) => ys.forEach((y, iy) => zs.forEach((z, iz) => {
    const p = P(x + (iz % 2 ? 0.1 : 0), y + (iz % 2 ? -0.09 : 0), z);
    const ok = (p.x / 2.05) ** 2 + ((p.z + 0.05) / 1.38) ** 2 < 1       // inside the lean torso cavity
      && !(p.y > -2.3 && p.z < 0.3 && p.x < 0.3 && p.x > -0.95)         // pancreatic head sits in the C-loop
      && !(iz === 3 && p.y > -2.6)                                     // in front only below the transverse colon
      && !(p.y < -3.45 && p.z > 0.15 && Math.abs(p.x) < 0.8)           // bladder region
      && dist(p, cp) > 0.6 && dist(p, dp) > 0.42;
    if (ok) { idx.set(`${ix},${iy},${iz}`, cells.length); cells.push({ p, ix, iy, iz, nb: [] }); }
  })));
  for (const c of cells) for (const d of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    const j = idx.get(`${c.ix + d[0]},${c.iy + d[1]},${c.iz + d[2]}`); if (j !== undefined) c.nb.push({ j, d });
  }
  const nearest = (q) => { let b = 0, m = 1e9; cells.forEach((c, i) => { const d = c.p.distanceToSquared(q); if (d < m) { m = d; b = i; } }); return b; };
  const start = nearest(P(0.8, -1.9, 0.0)), target = nearest(P(-1.2, -3.3, 0.4));
  let best = null, longest = null;
  for (let seed = 0; seed < 300; seed++) {
    setSeed(7001 + seed);
    const used = new Uint8Array(cells.length); used[start] = 1; used[target] = 1;
    const path = [start]; let cur = start, dir = null;
    for (;;) {
      const free = cells[cur].nb.filter((n) => !used[n.j]);
      if (!free.length) break;
      let pick = null;
      if (dir && rnd() < 0.7) pick = free.find((n) => n.d[0] === dir[0] && n.d[1] === dir[1] && n.d[2] === dir[2]) || null;
      if (!pick) {
        let bk = 1e9, cands = [];
        for (const n of free) { const k = cells[n.j].nb.filter((m) => !used[m.j]).length || 99; if (k < bk) { bk = k; cands = [n]; } else if (k === bk) cands.push(n); }
        pick = cands[Math.floor(rnd() * cands.length)];
      }
      used[pick.j] = 1; path.push(pick.j); dir = pick.d; cur = pick.j;
    }
    if (!longest || path.length > longest.length) longest = path.concat([target]);
    const prev = new Int32Array(cells.length).fill(-1), queue = [cur]; prev[cur] = cur; let found = false;
    while (queue.length && !found) {
      const a = queue.shift();
      for (const n of cells[a].nb) { if (n.j === target) { prev[target] = a; found = true; break; } if (!used[n.j] && prev[n.j] < 0) { prev[n.j] = a; queue.push(n.j); } }
    }
    if (!found) continue;
    const tail = []; for (let j = target; j !== cur; j = prev[j]) tail.push(j);
    const full = path.concat(tail.reverse());
    if (!best || full.length > best.length) best = full;
  }
  if (!best) best = longest;                       // (never expected: no seed reached the ileocaecal cell)
  siInfo = { cells: cells.length, used: best.length };
  /* organic warp: a small twist per depth layer + low-frequency displacement tapered at the frame edges + jitter.
     Rigid per-layer rotation keeps in-layer distances; the displacement field is gentle (|grad| << 1). */
  setSeed(7777);
  return best.map((i) => {
    const c = cells[i], a = (c.iz - 1.5) * 0.07, ca = Math.cos(a), sa = Math.sin(a), dx = c.p.x, dy = c.p.y + 2.78;
    const p = P(dx * ca - dy * sa, dy * ca + dx * sa - 2.78, c.p.z);
    const tx = 1 - Math.min(1, (Math.abs(p.x) / 1.35) ** 4), ty = clamp((-1.95 - p.y) / 0.4, 0, 1), tz = 1 - Math.min(1, (Math.abs(p.z - 0.25) / 0.78) ** 4);
    return P(p.x + 0.09 * tx * Math.sin(1.7 * p.y + 0.6 * p.z + 0.4) + (rnd() - 0.5) * 0.02,
      p.y + 0.09 * ty * Math.sin(1.4 * p.x + 0.9 * p.z + 2.0) + (rnd() - 0.5) * 0.02,
      p.z + 0.07 * tz * Math.sin(1.2 * p.x + 1.6 * p.y + 1.0) + (rnd() - 0.5) * 0.02);
  });
}
/** variable-radius tube on an existing curve (vtube with a centripetal spline: rounded hairpins, no overshoot) */
function tubeOn(curve, rFn, segs, radial) {
  const geo = new THREE.TubeGeometry(curve, segs, 1, radial, false);
  const pos = geo.attributes.position, v = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const u = i / segs; curve.getPointAt(u, c); const r = rFn(u);
    for (let j = 0; j <= radial; j++) { const k = i * (radial + 1) + j; v.fromBufferAttribute(pos, k); v.sub(c).multiplyScalar(r).add(c); pos.setXYZ(k, v.x, v.y, v.z); }
  }
  geo.computeVertexNormals(); geo.userData.curve = curve;
  return geo;
}
function buildSmallIntestine(ab, colonCurve, duoCurve) {
  const pts = [P(0.52, -1.5, -0.1), P(0.68, -1.72, -0.02), ...siLatticePath(colonCurve, duoCurve), P(-1.48, -3.3, 0.5), P(-1.72, -3.25, 0.56)];
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const siMat = OrganMat(palette.smallBowel, { roughness: 0.34, clearcoat: 0.8, clearcoatRoughness: 0.2, map: gutVeinTex, sheenColor: new THREE.Color(palette.smallBowelSheen) });
  /* travelling peristalsis: three contraction rings move aborally at 0.025 u/s, each pushing a small bulge ahead of it;
     plus a faint stationary segmentation shimmer. uv.x = position along the tube (TubeGeometry). */
  siMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = { value: 0 }; siShader = sh;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float pw = 0.0, pb = 0.0;
        for (int k = 0; k < 3; k++) {
          float w = fract(uTime * 0.025 + float(k) * 0.3333);
          float du = uv.x - w; pw += exp(-du * du * 3600.0);
          float db = du - 0.028; pb += exp(-db * db * 2500.0);
        }
        float seg = 0.5 + 0.5 * sin(uv.x * 420.0 + uTime * 1.3);
        transformed -= normal * (0.05 * pw - 0.014 * pb + 0.007 * seg);`);
  };
  siMat.customProgramCacheKey = () => 'digestivePeristalsis';
  const geo = tubeOn(curve, (u) => lerp(0.165, 0.135, u), 2400, 14);
  put(geo, siMat, ab, 'si');
  return geo.userData.curve;
}

/* ============================== module interface ============================== */
export function build(ctx) {
  C = ctx;
  const ab = ctx.groups.abdomen;
  detailG = new THREE.Group(); detailG.visible = false; ab.add(detailG);
  buildStomach(ab);
  const { duo, pan } = buildDuodenumPancreas(ab);
  buildSpleen(ab);
  const colonCurve = buildColon(ab);
  const siCurve = buildSmallIntestine(ab, colonCurve, duo.userData.curve);
  Object.assign(ctx.anchors, { colonCurve, siCurve, stomachPos, duodenumCurve: duo.userData.curve, pancreasCurve: pan.userData.curve, siInfo });
}

export function update(f, t, phys) {
  if (siShader) siShader.uniforms.uTime.value = t;
  const dt = clamp(t - lastT, 0, 0.4); lastT = t;
  /* close-up on the stomach: the anterior wall turns translucent and the rugae fade in (eased, no popping) */
  const d = C.camera.position.distanceTo(stomachPos);
  const k = 1 - smooth(7.5, 12.5, d);
  kEase += (k - kEase) * (1 - Math.exp(-dt * 3));
  wallMat.opacity = 1 - 0.6 * kEase;
  detailG.visible = kEase > 0.03;
  for (const m of detailMats) m.opacity = kEase;
}
