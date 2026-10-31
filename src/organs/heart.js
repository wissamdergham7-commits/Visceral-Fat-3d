// organs/heart.js — heart: sculpted ventricular mass split into an anterior "lid" (fresnel cut-away when the camera
// is close) and a posterior body; chambers with real wall thickness (planar cut face with LV / RV holes, septum tint,
// endocardial bowls, papillary muscles, chordae, moderator band); four animated valves (mitral, tricuspid, aortic,
// pulmonary); instanced blood particles (deoxygenated RA->RV->pulmonary trunk, oxygenated LA->LV->aorta) timed to the
// cardiac cycle; hollow atria with both auricles; coronary tree with finer branches. Everything beats from `phys`.
import { THREE, P, clamp, lerp, smooth, noise3, rnd, setSeed, deform, vtube, add } from '../core/ctx.js';
import { palette, OrganMat, heartVeinTex } from '../core/style.js';

export const heartPos = P(0.38, 1.5, 0.55);
const SCALE = new THREE.Vector3(1, 1.12, 0.92);

/** sculpt a unit sphere into the ventricular mass */
export function heartShape(v) {
  const y = v.y, w = 0.6 + 0.4 * smooth(-1, 0.55, y);
  v.x *= w; v.z *= w;
  if (y < 0) v.y = y * 1.28;
  const tip = smooth(-0.35, -1, y);
  v.x *= 1 - 0.38 * tip; v.z *= 1 - 0.38 * tip;
  const sulcus = Math.exp(-((v.x - 0.08 + v.y * 0.22) ** 2) / 6e-3) * smooth(-0.1, 0.4, v.z) * smooth(0.65, -0.2, v.y);
  v.z -= 0.055 * sulcus;
  const groove = Math.exp(-((y - 0.42) ** 2) / 7e-3);
  v.x *= 1 - 0.05 * groove; v.z *= 1 - 0.05 * groove;
  v.multiply(SCALE);
  if (v.y > 0.47) v.y = 0.47 + (v.y - 0.47) * 0.45;
  return v;
}
/** point on the OUTER heart surface at spherical angles (theta around y, phi from the top), scaled by s (fat uses it) */
export function heartSurf(th, ph, s = 1) {
  const v = P(Math.sin(ph) * Math.sin(th), Math.cos(ph), Math.sin(ph) * Math.cos(th));
  return heartShape(v).multiplyScalar(s);
}

/* ---------- cut-away plane (heart-local). Removed region = p·CUT_N > CUT_D : the anterior wall, tilting back toward the base
 * so the AV valves, the outflow tracts and both ventricular cavities are exposed (a "4-chamber + LVOT" section). ---------- */
const CUT_N = P(0, 0.315, 1).normalize(), CUT_D = 0.153;
const CUT_E1 = P(1, 0, 0), CUT_E2 = new THREE.Vector3().crossVectors(CUT_N, CUT_E1).normalize();
const to2D = (p) => new THREE.Vector2(p.dot(CUT_E1), p.dot(CUT_E2));
const to3D = (x, y, out) => out.copy(CUT_N).multiplyScalar(CUT_D).addScaledVector(CUT_E1, x).addScaledVector(CUT_E2, y);

/* ---------- chambers (heart-local, inside the ventricular mass). LV: thick wall, posterior-left; RV: thin-walled crescent
 * wrapping the LV anteriorly and to the right, kept off the LV by the septum rule. ---------- */
const LV = { c: P(0.26, -0.40, 0.02), r: P(0.37, 0.75, 0.40) };
const RV = { c: P(-0.32, -0.22, 0.20), r: P(0.40, 0.52, 0.26) };
const SEPTUM = 1.30;                                   // RV may not come closer than this (LV-normalised radius) to the LV centre
function lvShape(v) {
  const y = v.y, k = 1 + 0.035 * noise3(v.x * 7 + 1, v.y * 7, v.z * 7) * (0.4 + 0.6 * smooth(0.6, -0.4, y));
  v.multiplyScalar(k);
  const taper = 1 - 0.42 * smooth(-0.25, -1, y);
  v.x *= taper; v.z *= taper;
  return v.multiply(LV.r).add(LV.c);
}
function rvShape(v) {
  const y = v.y, k = 1 + 0.03 * noise3(v.x * 8 + 2, v.y * 8, v.z * 8 + 1);
  v.multiplyScalar(k);
  const taper = 1 - 0.35 * smooth(-0.3, -1, y);
  v.x *= taper; v.z *= taper;
  v.multiply(RV.r).add(RV.c);
  const q = v.clone().sub(LV.c).divide(LV.r), d = q.length();
  if (d < SEPTUM) v.copy(q.multiplyScalar(SEPTUM / d).multiply(LV.r).add(LV.c));
  return v;
}

/* valves (centre, normal = flow direction toward the atrium for AV / toward the artery for semilunar, annulus radius) */
const MV = { c: P(0.33, 0.30, -0.16), n: P(0.05, 1, -0.02).normalize(), R: 0.25 };
const TV = { c: P(-0.44, 0.27, 0.16), n: P(-0.2, 0.9, -0.1).normalize(), R: 0.29 };
const AO = { c: P(0.13, 0.39, 0.05), n: P(0.34, 0.665, 0.296).normalize(), R: 0.17 };     // just below the aorta's root (vessels.js starts at local (0.20, 0.48, 0.07))
const PV = { c: P(-0.16, 0.22, 0.574), n: P(0.344, 0.324, -0.074).normalize(), R: 0.16 };  // just below the pulmonary trunk's start (-0.12, 0.26, 0.57)

/* ---------- geometry helpers ---------- */
/** chain plane-intersection segments (flat list of point pairs) into closed loops */
function chainLoops(pts) {
  const key = (p) => `${Math.round(p.x * 4000)},${Math.round(p.y * 4000)},${Math.round(p.z * 4000)}`;
  const adj = new Map(), nseg = pts.length / 2;
  for (let i = 0; i < nseg; i++) for (const p of [pts[2 * i], pts[2 * i + 1]]) { const k = key(p); if (!adj.has(k)) adj.set(k, []); adj.get(k).push(i); }
  const used = new Uint8Array(nseg), loops = [];
  for (let i = 0; i < nseg; i++) {
    if (used[i]) continue;
    const loop = [pts[2 * i]]; let q = pts[2 * i + 1]; used[i] = 1;
    for (let guard = 0; guard < nseg; guard++) {
      const k = key(q); if (k === key(loop[0])) break;
      loop.push(q);
      const next = (adj.get(k) || []).find((j) => !used[j]);
      if (next === undefined) break;
      used[next] = 1; const a = pts[2 * next], b = pts[2 * next + 1]; q = key(a) === k ? b : a;
    }
    if (loop.length > 8) loops.push(loop);
  }
  return loops.sort((a, b) => b.length - a.length);
}
/** split a (deformed) geometry by the plane p·n = d: { above, below, loops } — shared, exact cut edge, no gaps */
function splitByPlane(geo, n, d) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
  const A = [], B = [], segs = [];
  const V = (i) => ({ p: new THREE.Vector3().fromBufferAttribute(pos, i), n: new THREE.Vector3().fromBufferAttribute(nor, i), t: new THREE.Vector2().fromBufferAttribute(uv, i) });
  const mix = (a, b, k) => ({ p: a.p.clone().lerp(b.p, k), n: a.n.clone().lerp(b.n, k).normalize(), t: a.t.clone().lerp(b.t, k) });
  for (let i = 0; i < pos.count; i += 3) {
    const vs = [V(i), V(i + 1), V(i + 2)], s = vs.map((v) => v.p.dot(n) - d), PA = [], PB = [];
    for (let k = 0; k < 3; k++) {
      const k2 = (k + 1) % 3;
      (s[k] > 0 ? PA : PB).push(vs[k]);
      if ((s[k] > 0) !== (s[k2] > 0)) { const m = mix(vs[k], vs[k2], s[k] / (s[k] - s[k2])); PA.push(m); PB.push(m); segs.push(m.p); }
    }
    for (let k = 1; k + 1 < PA.length; k++) A.push(PA[0], PA[k], PA[k + 1]);
    for (let k = 1; k + 1 < PB.length; k++) B.push(PB[0], PB[k], PB[k + 1]);
  }
  const toGeo = (list) => {
    const out = new THREE.BufferGeometry(), p = [], nn = [], t = [];
    for (const v of list) { p.push(v.p.x, v.p.y, v.p.z); nn.push(v.n.x, v.n.y, v.n.z); t.push(v.t.x, v.t.y); }
    out.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nn, 3));
    out.setAttribute('uv', new THREE.Float32BufferAttribute(t, 2));
    return out;
  };
  return { above: toGeo(A), below: toGeo(B), loops: chainLoops(segs) };
}
/** OrganMat whose alpha fades with a fresnel term when uCut rises (the cut-away). aMin: alpha at the centre, fres: rim alpha. */
function fadeMat(color, opts, aMin, fres) {
  const m = OrganMat(color, Object.assign({ transparent: true }, opts));
  const cut = { value: 0 };
  m.userData.cut = cut;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uCut = cut;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <clipping_planes_pars_fragment>', '#include <clipping_planes_pars_fragment>\nuniform float uCut;')
      .replace('#include <opaque_fragment>', `
        float cutF = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.2);
        outgoingLight += diffuseColor.rgb * (0.55 * cutF * uCut);
        diffuseColor.a *= mix(1.0, ${aMin.toFixed(3)} + ${fres.toFixed(3)} * cutF, uCut);
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => `fade${aMin}${fres}`;
  return m;
}
/** k leaflet sheets (NU x NV grids) in one geometry; fill(fn) rewrites positions (fn(k, su, sv, out)). */
function makeSheets(count, NU, NV, mat, parent) {
  const nV = (NU + 1) * (NV + 1), pos = new Float32Array(count * nV * 3), uvs = new Float32Array(count * nV * 2), idx = [];
  for (let k = 0; k < count; k++) {
    for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) { const b = (k * nV + j * (NU + 1) + i) * 2; uvs[b] = i / NU; uvs[b + 1] = j / NV; }
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) { const b = k * nV + j * (NU + 1) + i; idx.push(b, b + 1, b + NU + 1, b + 1, b + NU + 2, b + NU + 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2)); g.setIndex(idx);
  const mesh = add(g, mat, parent, 'heart'); mesh.frustumCulled = false;
  const v = new THREE.Vector3();
  return {
    mesh,
    fill(fn) {
      let p = 0;
      for (let k = 0; k < count; k++) for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) { fn(k, i / NU, j / NV, v); pos[p++] = v.x; pos[p++] = v.y; pos[p++] = v.z; }
      g.attributes.position.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingSphere();
    },
  };
}
/** orthonormal frame around n */
function frame(n) {
  const e1 = new THREE.Vector3().crossVectors(n, Math.abs(n.z) < 0.9 ? P(0, 0, 1) : P(1, 0, 0)).normalize();
  return { e1, e2: new THREE.Vector3().crossVectors(n, e1).normalize() };
}

/* ---------- module state ---------- */
let C, heartG, ventG, atriaG, detailG;
const fadeMats = [];
let mitral, tricuspid, aortic, pulmonary;
let chords = [];                                       // { mesh, tip: Vector3, valve, k, su }
let bloodOxy, bloodDeoxy;                              // { inst, mat, parts, curves }
let cutCur = 0, lastT = 0, lastAV = -1;
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), UP = P(0, 1, 0);

/* ---------- valves ---------- */
/** AV valve: leaflets hinge on the annulus, swing down into the ventricle when open (o = 1) */
function avPoint(V, k, su, sv, o, out) {
  const d = V.defs[k], u = lerp(d.a0, d.a1, su), s = (su - 0.5) * 2;
  const phi = lerp(d.phi0, 1.25, o), reach = d.reach * V.R * (1 - 0.22 * s * s), rx = Math.cos(u), ry = Math.sin(u);
  const cp = Math.cos(phi), sp = Math.sin(phi), L = reach * sv;
  out.copy(V.c).addScaledVector(V.e1, V.R * rx).addScaledVector(V.e2, V.R * ry);
  out.addScaledVector(V.e1, -rx * cp * L).addScaledVector(V.e2, -ry * cp * L).addScaledVector(V.n, -sp * L);
  return out.addScaledVector(V.n, -Math.sin(Math.PI * sv) * V.R * (0.10 * (1 - o) + 0.05 * o));
}
/** semilunar valve: three pocket cusps on a U-shaped attachment; meet at the centre when closed, press to the wall when open */
function slPoint(V, k, su, sv, o, out) {
  const d = V.defs[k], u = lerp(d.a0, d.a1, su), s = (su - 0.5) * 2, as = Math.abs(s), rx = Math.cos(u), ry = Math.sin(u), R = V.R;
  const hx = R * rx, hy = R * ry, hn = -R * 0.42 * (1 - s * s);                           // hinge (radial e1,e2 ; along n)
  const tcr = R * (0.06 + 0.94 * as), tcn = R * (0.12 + 0.36 * as);                      // closed free edge
  const tr = lerp(tcr, R * 0.94, o), tn = lerp(tcn, R * 0.52, o);                        // open: against the wall
  const r1 = hx * (1 - sv) + tr * rx * sv, r2 = hy * (1 - sv) + tr * ry * sv, nn = hn * (1 - sv) + tn * sv;
  out.copy(V.c).addScaledVector(V.e1, r1).addScaledVector(V.e2, r2).addScaledVector(V.n, nn);
  const belly = Math.sin(Math.PI * sv) * R;
  return out.addScaledVector(V.n, -0.12 * belly * (1 - o)).addScaledVector(V.e1, rx * 0.04 * belly * o).addScaledVector(V.e2, ry * 0.04 * belly * o);
}
function makeValve(spec, defs, pointFn, mats) {
  const V = Object.assign({ defs, pointFn, last: -1 }, spec, frame(spec.n));
  V.sheets = makeSheets(defs.length, 12, 6, mats.leaflet, detailG);
  const ring = add(new THREE.TorusGeometry(spec.R, 0.021, 8, 44), mats.annulus, detailG, 'heart');
  ring.position.copy(spec.c); ring.quaternion.setFromUnitVectors(P(0, 0, 1), spec.n);
  V.set = (o) => { if (Math.abs(o - V.last) < 0.004) return; V.last = o; V.sheets.fill((k, su, sv, out) => pointFn(V, k, su, sv, o, out)); };
  return V;
}

/* ---------- blood particles ---------- */
function makeBlood(curves, count, color, keyPts) {
  const geo = new THREE.SphereGeometry(1, 7, 5);
  const mat = OrganMat(color, { emissiveIntensity: 0.45, roughness: 0.42, clearcoat: 0.6, bumpMap: null, sheen: 0.2 });
  const inst = new THREE.InstancedMesh(geo, mat, count);
  inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage); inst.frustumCulled = false; inst.userData.key = 'heart';
  detailG.add(inst);
  /* arc-length u of the AV valve and of the semilunar valve on each curve (nearest sample) */
  const marks = curves.map((cv) => {
    const find = (pt) => { let best = 0, bd = 1e9; for (let i = 0; i <= 200; i++) { const d = cv.getPointAt(i / 200).distanceToSquared(pt); if (d < bd) { bd = d; best = i / 200; } } return best; };
    return { uAV: find(keyPts[0]), uSL: find(keyPts[1]) };
  });
  const parts = [];
  for (let i = 0; i < count; i++) parts.push({ cv: i % curves.length, u: rnd(), a: rnd() * Math.PI * 2, k: Math.sqrt(rnd()), s: 0.03 + 0.02 * rnd(), spin: (rnd() - 0.5) * 2 });
  return { inst, mat, parts, curves, marks, base: new THREE.Color(color) };
}
/** chamber radius available to particles along the path (atrium → valve → ventricle → valve → vessel) */
function chamberR(u, m) {
  if (u < m.uAV - 0.05) return 0.16;
  if (u < m.uAV + 0.03) return lerp(0.16, 0.09, (u - m.uAV + 0.05) / 0.08);
  if (u < m.uSL - 0.06) return lerp(0.09, 0.20, smooth(m.uAV + 0.03, m.uAV + 0.15, u)) * (1 - 0.55 * smooth(m.uSL - 0.2, m.uSL - 0.06, u));
  if (u < m.uSL + 0.03) return 0.08;
  return 0.11;
}
function stepBlood(B, dt, atr, avOpen, slOpen, eject) {
  const d = C.dummy;
  for (let i = 0; i < B.parts.length; i++) {
    const p = B.parts[i], cv = B.curves[p.cv], m = B.marks[p.cv];
    let sp;
    if (p.u < m.uAV - 0.06) sp = 0.20 + 0.55 * atr;
    else if (p.u < m.uAV + 0.04) sp = (0.9 + 0.7 * atr) * avOpen;
    else if (p.u < m.uSL - 0.05) sp = 0.3 + 1.7 * eject;
    else if (p.u < m.uSL + 0.04) sp = 1.6 * slOpen;
    else sp = 0.9 + 0.9 * eject;
    p.u += sp * dt; p.a += dt * p.spin * (0.6 + 1.5 * eject);
    if (p.u >= 1) { p.u = rnd() * 0.04; p.a = rnd() * Math.PI * 2; p.k = Math.sqrt(rnd()); }
    cv.getPointAt(p.u, d.position); cv.getTangentAt(p.u, _v);
    _w.crossVectors(_v, UP).normalize(); _v.crossVectors(_w, _v).normalize();     // _w, _v : lateral frame
    const r = chamberR(p.u, m) * p.k;
    d.position.addScaledVector(_w, Math.cos(p.a) * r).addScaledVector(_v, Math.sin(p.a) * r);
    d.rotation.set(0, 0, 0); d.scale.setScalar(p.s * (1 + 0.25 * eject)); d.updateMatrix();
    B.inst.setMatrixAt(i, d.matrix);
  }
  B.inst.instanceMatrix.needsUpdate = true;
}

/* ---------- build ---------- */
export function build(ctx) {
  C = ctx; setSeed(7001);
  heartG = new THREE.Group(); heartG.position.copy(heartPos); heartG.rotation.set(-0.38, 0, 0.58);
  ctx.groups.heart.add(heartG);
  ventG = new THREE.Group(); atriaG = new THREE.Group(); detailG = new THREE.Group(); heartG.add(ventG, atriaG); ventG.add(detailG);

  /* --- ventricular mass: posterior body (solid) + anterior lid (fresnel cut-away) sharing an exact cut edge --- */
  const shellOpts = { roughness: 0.3, clearcoat: 0.95, clearcoatRoughness: 0.18, map: heartVeinTex, emissiveIntensity: 0.1 };
  const heartMat = OrganMat(palette.heart, shellOpts);
  const lidMat = fadeMat(palette.heart, shellOpts, 0.05, 0.6); fadeMats.push(lidMat);
  const shell = splitByPlane(deform(new THREE.SphereGeometry(1, 96, 72), heartShape), CUT_N, CUT_D);
  add(shell.below, heartMat, ventG, 'heart');
  const lid = add(shell.above, lidMat, ventG, 'heart'); lid.renderOrder = -1;

  /* --- atria: RA / LA fade like the lid (hollow inside), both auricles stay solid --- */
  const atriumOpts = { roughness: 0.36, clearcoat: 0.8, map: heartVeinTex };
  const atriumMat = fadeMat(palette.atrium, atriumOpts, 0.07, 0.55); fadeMats.push(atriumMat);
  const auricleMat = OrganMat(palette.atrium, atriumOpts);
  const endoMat = OrganMat(palette.endocardium, { side: THREE.BackSide, roughness: 0.4, clearcoat: 0.75, bumpScale: 1.1, emissiveIntensity: 0.05 });
  const lobe = (x, y, z, sx, sy, sz, rz, mat, parent) => {
    const g = deform(new THREE.SphereGeometry(1, 40, 30), (v) => v.multiplyScalar(1 + 0.03 * noise3(v.x * 5, v.y * 5, v.z * 5)));
    const m = add(g, mat, parent, 'heart'); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.z = rz; return m;
  };
  lobe(-0.5, 0.58, 0.22, 0.48, 0.4, 0.45, 0, atriumMat, atriaG).renderOrder = -1;          // right atrium
  lobe(0.33, 0.66, -0.1, 0.52, 0.44, 0.5, 0, atriumMat, atriaG).renderOrder = -1;          // left atrium
  lobe(-0.62, 0.42, 0.5, 0.24, 0.16, 0.2, 0.5, auricleMat, atriaG);                       // right auricle
  lobe(0.5, 0.46, 0.38, 0.27, 0.15, 0.2, -0.4, auricleMat, atriaG);                       // left auricle
  lobe(-0.5, 0.58, 0.22, 0.40, 0.33, 0.37, 0, endoMat, detailG);                          // RA cavity (seen from inside)
  lobe(0.33, 0.66, -0.1, 0.43, 0.36, 0.41, 0, endoMat, detailG);                          // LA cavity

  /* --- chambers: endocardial bowls below the cut, planar cut face with the two holes (wall thickness + septum) --- */
  const lv = splitByPlane(deform(new THREE.SphereGeometry(1, 56, 40), lvShape), CUT_N, CUT_D);
  const rv = splitByPlane(deform(new THREE.SphereGeometry(1, 56, 40), rvShape), CUT_N, CUT_D);
  /* depth shading: the deeper the cavity wall sits behind the cut, the darker (reads as a hollow) */
  const bowlMat = OrganMat(palette.endocardium, { vertexColors: true, color: new THREE.Color(palette.white), side: THREE.BackSide, roughness: 0.4, clearcoat: 0.75, bumpScale: 1.1, emissiveIntensity: 0.05 });
  const cEndo = new THREE.Color(palette.endocardium);
  const shadeBowl = (geo) => {
    const p = geo.attributes.position, col = new Float32Array(p.count * 3);
    let deep = 0.05; for (let i = 0; i < p.count; i++) deep = Math.max(deep, CUT_D - _v.fromBufferAttribute(p, i).dot(CUT_N));
    for (let i = 0; i < p.count; i++) { _v.fromBufferAttribute(p, i); const k = 0.92 - 0.42 * smooth(0.04, 1, (CUT_D - _v.dot(CUT_N)) / deep); col[i * 3] = cEndo.r * k; col[i * 3 + 1] = cEndo.g * k; col[i * 3 + 2] = cEndo.b * k; }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); return geo;
  };
  add(shadeBowl(lv.below), bowlMat, detailG, 'heart'); add(shadeBowl(rv.below), bowlMat, detailG, 'heart');
  const outer = shell.loops[0].map(to2D), hLV = lv.loops[0].map(to2D), hRV = rv.loops[0].map(to2D);
  const shape = new THREE.Shape(outer); shape.holes.push(new THREE.Path(hLV), new THREE.Path(hRV));
  const face = new THREE.ShapeGeometry(shape, 1), fp = face.attributes.position, fn = face.attributes.normal, fuv = face.attributes.uv;
  const cols = new Float32Array(fp.count * 3), cMyo = new THREE.Color(palette.myocardium), cSep = new THREE.Color(palette.septum), cc = new THREE.Color();
  const dist2D = (x, y, loop) => { let b = 1e9; for (const q of loop) { const d = (q.x - x) ** 2 + (q.y - y) ** 2; if (d < b) b = d; } return Math.sqrt(b); };
  for (let i = 0; i < fp.count; i++) {
    const x = fp.getX(i), y = fp.getY(i);
    to3D(x, y, _v); fp.setXYZ(i, _v.x, _v.y, _v.z); fn.setXYZ(i, CUT_N.x, CUT_N.y, CUT_N.z); fuv.setXY(i, x * 0.5 + 0.5, y * 0.5 + 0.5);
    const dLV = dist2D(x, y, hLV), dRV = dist2D(x, y, hRV);
    const sept = smooth(0.34, 0.12, dLV + dRV), ao = 1 - 0.4 * (1 - smooth(0, 0.07, Math.min(dLV, dRV)));   // soft occlusion inside the rims
    cc.copy(cMyo).lerp(cSep, sept).multiplyScalar(ao); cols[i * 3] = cc.r; cols[i * 3 + 1] = cc.g; cols[i * 3 + 2] = cc.b;
  }
  face.setAttribute('color', new THREE.BufferAttribute(cols, 3)); face.computeBoundingSphere();
  add(face, OrganMat(palette.myocardium, { vertexColors: true, color: new THREE.Color(palette.white), roughness: 0.5, clearcoat: 0.45, clearcoatRoughness: 0.3, bumpScale: 0.9, emissiveIntensity: 0.05 }), detailG, 'heart');

  /* --- papillary muscles, moderator band, chordae --- */
  const papMat = OrganMat(palette.papillary, { roughness: 0.36, clearcoat: 0.8 });
  const chordMat = OrganMat(palette.chordae, { roughness: 0.5, clearcoat: 0.3, sheen: 0.2 });
  const papillary = (shapeFn, dir, target, len) => {
    const base = shapeFn(dir.clone().normalize()), d = target.clone().sub(base).normalize();
    const m = add(new THREE.SphereGeometry(1, 12, 10), papMat, detailG, 'heart');
    m.scale.set(0.065, len * 0.55, 0.065); m.position.copy(base).addScaledVector(d, len * 0.42); m.quaternion.setFromUnitVectors(UP, d);
    return { base, tip: base.clone().addScaledVector(d, len) };
  };
  const papA = papillary(lvShape, P(0.85, -0.25, 0.5), MV.c, 0.36), papB = papillary(lvShape, P(-0.5, -0.3, -0.75), MV.c, 0.34);
  const papC = papillary(rvShape, P(-0.85, -0.2, 0.45), TV.c, 0.28), papD = papillary(rvShape, P(0.55, -0.45, -0.6), TV.c, 0.26);
  const sept0 = rvShape(P(0.8, -0.5, -0.25).normalize());                                 // moderator band: septum -> anterior papillary
  add(vtube([sept0, sept0.clone().lerp(papC.base, 0.5).add(P(0, -0.07, 0.03)), papC.base], () => 0.026, 24, 8), papMat, detailG, 'heart');
  const chord = (pap, valve, k, su) => {
    const m = add(new THREE.CylinderGeometry(0.0055, 0.0055, 1, 5), chordMat, detailG, 'heart'); m.frustumCulled = false;
    chords.push({ mesh: m, tip: pap.tip, valve, k, su });
  };

  /* --- the four valves --- */
  const leafletMat = OrganMat(palette.valveLeaflet, { side: THREE.DoubleSide, roughness: 0.42, clearcoat: 0.7, clearcoatRoughness: 0.25, sheen: 0.4, emissiveIntensity: 0.08, bumpScale: 0.25 });
  const annulusMat = OrganMat(palette.valveAnnulus, { roughness: 0.4, clearcoat: 0.6 });
  const vmats = { leaflet: leafletMat, annulus: annulusMat };
  const tri = (reach, gap = 0.07) => [0, 1, 2].map((k) => ({ a0: k * 2.0944 + gap, a1: (k + 1) * 2.0944 - gap, reach, phi0: 0.12 + 0.06 * k }));
  mitral = makeValve(MV, [{ a0: -1.5708 - 1.05, a1: -1.5708 + 1.05, reach: 1.3, phi0: 0.1 }, { a0: 1.5708 - 1.95, a1: 1.5708 + 1.95, reach: 0.75, phi0: 0.22 }], avPoint, vmats);
  tricuspid = makeValve(TV, tri(0.82), avPoint, vmats);
  aortic = makeValve(AO, tri(1, 0.05), slPoint, vmats);
  pulmonary = makeValve(PV, tri(1, 0.05), slPoint, vmats);
  chord(papA, mitral, 0, 0.25); chord(papA, mitral, 0, 0.45); chord(papA, mitral, 1, 0.8);
  chord(papB, mitral, 0, 0.75); chord(papB, mitral, 1, 0.25); chord(papB, mitral, 1, 0.5);
  chord(papC, tricuspid, 0, 0.5); chord(papC, tricuspid, 1, 0.3); chord(papC, tricuspid, 2, 0.7);
  chord(papD, tricuspid, 1, 0.7); chord(papD, tricuspid, 2, 0.3); chord(papD, tricuspid, 0, 0.8);

  /* --- outflow roots (LVOT -> aortic root, infundibulum -> pulmonary root): ghosted outer wall + endocardial lining --- */
  const rootMat = fadeMat(palette.heart, { roughness: 0.32, clearcoat: 0.9, bumpScale: 0.3 }, 0.06, 0.5); fadeMats.push(rootMat);
  const aoPts = [AO.c.clone().addScaledVector(AO.n, -0.24), AO.c.clone().addScaledVector(AO.n, -0.1), AO.c, AO.c.clone().addScaledVector(AO.n, 0.2)];
  const pvPts = [P(-0.31, 0.04, 0.38), P(-0.25, 0.14, 0.50), PV.c, PV.c.clone().addScaledVector(PV.n, 0.16)];
  for (const [pts, R] of [[aoPts, 0.215], [pvPts, 0.18]]) {
    const o = add(vtube(pts, (u) => R * (1 + 0.1 * smooth(0.5, 0.75, u) * smooth(1, 0.8, u)), 24, 20), rootMat, detailG, 'heart'); o.renderOrder = -1;
    add(vtube(pts, (u) => R * 0.93 * (1 + 0.1 * smooth(0.5, 0.75, u) * smooth(1, 0.8, u)), 24, 20), endoMat, detailG, 'heart');
  }

  /* --- blood: deoxygenated (SVC / IVC -> RA -> tricuspid -> RV -> pulmonary valve -> trunk), oxygenated (PVs -> LA -> mitral -> LV -> aortic valve -> aorta) --- */
  const crv = (pts) => new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.4);
  const rvRun = [P(-0.45, 0.30, 0.18), P(-0.41, 0.05, 0.22), P(-0.35, -0.35, 0.22), P(-0.30, -0.55, 0.26), P(-0.27, -0.2, 0.34), P(-0.30, 0.05, 0.40), P(-0.22, 0.17, 0.50), PV.c.clone(), P(0.0, 0.37, 0.54), P(0.17, 0.52, 0.50)];
  const lvRun = [P(0.30, 0.42, -0.12), MV.c.clone(), P(0.28, 0.05, -0.08), P(0.26, -0.40, -0.02), P(0.25, -0.75, 0.02), P(0.24, -0.3, 0.12), P(0.22, 0.12, 0.10), P(0.20, 0.30, 0.07), AO.c.clone(), P(0.26, 0.58, 0.12), P(0.40, 0.82, 0.22)];
  bloodDeoxy = makeBlood([
    crv([P(-0.46, 0.98, 0.20), P(-0.47, 0.72, 0.21), P(-0.50, 0.50, 0.22), ...rvRun]),
    crv([P(-0.66, 0.02, -0.18), P(-0.62, 0.32, -0.04), P(-0.52, 0.48, 0.14), ...rvRun]),
  ], 110, palette.bloodDeoxy, [TV.c, PV.c]);
  bloodOxy = makeBlood([
    crv([P(0.25, 0.72, -0.48), P(0.28, 0.66, -0.26), P(0.32, 0.62, -0.12), ...lvRun]),
    crv([P(0.78, 0.40, -0.42), P(0.56, 0.45, -0.23), P(0.40, 0.56, -0.14), ...lvRun]),
  ], 110, palette.bloodOxy, [MV.c, AO.c]);

  /* --- coronary tree. Main trunks (LAD, RCA, Cx, diagonal, acute marginal, great cardiac vein) + finer branches:
   * posterior descending, obtuse marginal, septal perforators, middle cardiac vein, small twigs. Vessels that live mostly
   * on the anterior wall ghost together with the lid. --- */
  const artOpts = { roughness: 0.28, clearcoat: 0.9, bumpScale: 0.2 }, veinOpts = { roughness: 0.3, clearcoat: 0.8, bumpScale: 0.2 };
  const artMat = OrganMat(palette.coronaryArtery, artOpts), veinMat = OrganMat(palette.coronaryVein, veinOpts);
  const artGhost = fadeMat(palette.coronaryArtery, artOpts, 0.18, 0.3), veinGhost = fadeMat(palette.coronaryVein, veinOpts, 0.18, 0.3);
  fadeMats.push(artGhost, veinGhost);
  const vessel = (pts, rFn, segs, radial, vein = false) => {
    const anterior = pts.filter((p) => p.dot(CUT_N) > CUT_D - 0.08).length / pts.length > 0.55;
    const m = add(vtube(pts, rFn, segs, radial), vein ? (anterior ? veinGhost : veinMat) : (anterior ? artGhost : artMat), ventG, 'heart');
    if (anterior) m.renderOrder = -1;
    return m;
  };
  const path = (n, thFn, phFn, s = 1.03) => { const pts = []; for (let i = 0; i <= n; i++) { const a = i / n; pts.push(heartSurf(thFn(a), phFn(a), s)); } return pts; };
  vessel(path(16, (a) => 0.1 - (0.55 + 2.35 * a) * 0.06, (a) => 0.55 + 2.35 * a), (u) => 0.045 * (1 - 0.5 * u), 60, 8);                 // LAD
  vessel(path(16, (a) => -0.1 - 2.3 * a, (a) => 1.14 + 0.15 * a, 1.035), (u) => 0.045 * (1 - 0.4 * u), 60, 8);                           // RCA
  vessel(path(14, (a) => 0.15 + 2 * a, () => 1.12, 1.035), (u) => 0.04 * (1 - 0.4 * u), 60, 8);                                         // circumflex
  vessel(path(14, (a) => 0.22 - (0.7 + 2.1 * a) * 0.05, (a) => 0.7 + 2.1 * a, 1.045), () => 0.032, 60, 8, true);                        // great cardiac vein
  vessel(path(10, (a) => 0.5 + (1 + 1.6 * a) * 0.1, (a) => 1 + 1.6 * a), (u) => 0.026 * (1 - 0.5 * u), 40, 6);                           // diagonal
  vessel(path(10, (a) => -0.8 - (1.25 + 1.5 * a) * 0.12, (a) => 1.25 + 1.5 * a), (u) => 0.024 * (1 - 0.5 * u), 40, 6);                   // acute marginal
  vessel(path(12, (a) => -2.4 - 0.62 * smooth(0, 0.3, a) - 0.05 * a, (a) => 1.27 + 1.5 * a, 1.035), (u) => 0.03 * (1 - 0.5 * u), 40, 6); // posterior descending (RCA -> crux -> apex)
  vessel(path(12, (a) => -3.2 - 0.04 * a, (a) => 1.35 + 1.45 * a, 1.04), () => 0.024, 40, 6, true);                                       // middle cardiac vein
  vessel(path(10, (a) => 1.45 + 0.2 * a, (a) => 1.2 + 1.45 * a), (u) => 0.024 * (1 - 0.5 * u), 40, 6);                                   // obtuse marginal (Cx)
  vessel(path(10, (a) => 2.2 - 0.12 * a, (a) => 1.25 + 1.2 * a, 1.035), () => 0.02, 32, 6, true);                                        // posterior vein of the LV
  vessel(path(8, (a) => -1.5 - 0.5 * a, (a) => 1.16 + 0.05 * a, 1.035), () => 0.02, 32, 6, true);                                        // small cardiac vein (right AV groove)
  for (const ph0 of [1.05, 1.45, 1.85]) vessel(path(6, (a) => 0.1 - ph0 * 0.06 - 0.3 * a, (a) => ph0 + 0.08 * a, 1.03), (u) => 0.016 * (1 - 0.6 * u), 20, 5);     // septal perforators (LAD)
  const twig = (th0, ph0, dth, dph, r = 0.014) => vessel(path(6, (a) => th0 + dth * a + 0.06 * Math.sin(a * 7 + th0), (a) => ph0 + dph * a), (u) => r * (1 - 0.55 * u), 20, 5);
  const trunks = [[(a) => 0.1 - (0.55 + 2.35 * a) * 0.06, (a) => 0.55 + 2.35 * a], [(a) => -0.1 - 2.3 * a, (a) => 1.14 + 0.15 * a], [(a) => 0.15 + 2 * a, () => 1.12], [(a) => 0.5 + (1 + 1.6 * a) * 0.1, (a) => 1 + 1.6 * a], [(a) => -2.4 - 0.62 * smooth(0, 0.3, a) - 0.05 * a, (a) => 1.27 + 1.5 * a]];
  for (let i = 0; i < 14; i++) {
    const [thF, phF] = trunks[i % trunks.length], a = 0.25 + 0.6 * rnd(), side = rnd() < 0.5 ? -1 : 1;
    twig(thF(a), phF(a), side * (0.25 + 0.3 * rnd()), 0.2 + 0.3 * rnd(), 0.011 + 0.005 * rnd());
  }

  mitral.set(1); tricuspid.set(1); aortic.set(0); pulmonary.set(0);
  detailG.visible = false;
  Object.assign(ctx.anchors, { heartPos, heartSurf, heartG, ventG, atriaG });
}

/* ---------- per frame ---------- */
/** soft window on the periodic phase: 1 inside [a, b], 0 outside, edge width e */
const win = (ph, a, b, e) => smooth(a - e, a + e, ph) * smooth(b + e, b - e, ph);

export function update(f, t, phys) {
  const a = phys.atrialPulse, l = phys.ventricularPulse, ph = phys.heartPhase ?? 0;
  const dtEase = Math.min(Math.max(t - lastT, 0), 0.4), dt = Math.min(phys.dt || dtEase || 0.016, 0.05); lastT = t;
  atriaG.scale.setScalar(1 - 0.08 * a + 0.03 * l);
  ventG.scale.set(1 - 0.055 * l, 1 - 0.04 * l + 0.02 * a, 1 - 0.055 * l);
  ventG.rotation.y = 0.045 * l;               // ventricular twist

  /* cut-away: open when the camera is near the heart (always when very close, or when the heart is the orbit target) */
  const dist = C.camera.position.distanceTo(heartPos), dTgt = C.controls.target.distanceTo(heartPos);
  const target = Math.max(smooth(9.5, 7.5, dist), smooth(13.5, 11.8, dist) * smooth(1.9, 1.0, dTgt));
  cutCur = Math.abs(cutCur - target) < 0.002 ? target : lerp(cutCur, target, 1 - Math.exp(-dtEase * 9));
  for (const m of fadeMats) { m.userData.cut.value = cutCur; m.depthWrite = cutCur < 0.03; }
  detailG.visible = dist < 16 || cutCur > 0.01;
  if (!detailG.visible) return;

  /* valves follow the cycle phase (phys.heartPhase runs at phys.hr): AV close as the ventricle starts to contract, semilunar open for ejection */
  const avOpen = 1 - win(ph, 0.12, 0.44, 0.03), slOpen = win(ph, 0.17, 0.40, 0.03);
  mitral.set(avOpen); tricuspid.set(avOpen); aortic.set(slOpen); pulmonary.set(slOpen);
  if (Math.abs(avOpen - lastAV) > 0.004) {
    lastAV = avOpen;
    for (const c of chords) {
      avPoint(c.valve, c.k, c.su, 1, avOpen, _v); _w.subVectors(_v, c.tip); const L = _w.length();
      c.mesh.position.copy(c.tip).addScaledVector(_w, 0.5); c.mesh.scale.set(1, L, 1); c.mesh.quaternion.setFromUnitVectors(UP, _w.divideScalar(L));
    }
  }
  /* blood: tint follows saturation; particles advance by chamber according to the phase */
  const spo2 = phys.spo2 ?? 97, desat = clamp((97 - spo2) / 18, 0, 1);
  bloodOxy.mat.color.copy(bloodOxy.base).lerp(bloodDeoxy.base, desat * 0.85); bloodOxy.mat.emissive.copy(bloodOxy.mat.color);
  bloodDeoxy.mat.color.copy(bloodDeoxy.base).multiplyScalar(1 - 0.25 * desat); bloodDeoxy.mat.emissive.copy(bloodDeoxy.mat.color);
  stepBlood(bloodDeoxy, dt, a, avOpen, slOpen, slOpen * (0.4 + 0.6 * l));
  stepBlood(bloodOxy, dt, a, avOpen, slOpen, slOpen * (0.4 + 0.6 * l));
}
