// organs/vessels.js — great vessels.
//  Arteries : aorta (root, arch, descending, abdominal, common/external/internal iliacs), brachiocephalic ->
//             right subclavian + right common carotid, left common carotid, left subclavian (carotids bifurcate in
//             the neck), coeliac trunk (hepatic / splenic / left gastric), superior mesenteric + jejunal branches,
//             renal arteries, inferior mesenteric. Pulmonary trunk IN FRONT of the ascending aorta -> right/left
//             pulmonary arteries under the arch.
//  Veins    : SVC with both brachiocephalic veins, internal jugulars, subclavian veins; IVC with hepatic vein
//             entry, renal veins and common iliac veins; four pulmonary veins into the left atrium.
//  Look     : every vessel = opaque blood core + glossy fresnel-translucent wall. Arterial walls carry a travelling
//             radial pulse wave (vertex shader, phase = phys.heartPhase, amplitude/sharpness from the pulse pressure,
//             stiffer/paler wall at high systolic pressure). Veins do not pulse. Blood cells stream inside the
//             vessels (red/pink in arteries, blue-purple in veins), speed follows phys.ventricularPulse, arterial
//             cells + core desaturate toward palette.bloodDeoxy when phys.spo2 falls below ~92.
// Publishes anchors.aortaCurve (root -> bifurcation), anchors.ivcCurve, anchors.laPos / raPos (atrial centres).
import { THREE, P, clamp, lerp, rnd, setSeed, vtube, add } from '../core/ctx.js';
import { palette, OrganMat } from '../core/style.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const CORE = 0.62;                                  // blood core radius / wall radius
const UP = new THREE.Vector3(0.42, 0.3, 0.85).normalize(), Y_AXIS = new THREE.Vector3(0, 1, 0);
const KEY = { art: 'aorta', pulm: 'heart', vein: 'vein', pv: 'heart' };

let C, dummy, aortaCurve, ivcCurve;
let specs = [], paths = [], cellsArt, cellsVein, cells = [];
let pulseU, pulmU, detailMats = [], detailMeshes = [], wallArt, coreArt, wallPulm, allMats = [];
let lastT = 0, detOp = 0, lastDesat = -1, lastStiff = -1;
const DETAIL_CENTRE = P(0, -0.5, 0.2);
const cAorta = new THREE.Color(palette.aorta), cStiff = new THREE.Color(palette.aortaWallStiff);
const cCoreOxy = new THREE.Color(palette.bloodOxy).multiplyScalar(0.62), cCoreDeoxy = new THREE.Color(palette.bloodDeoxy).multiplyScalar(0.75);
const cCellOxy = new THREE.Color(palette.bloodCell), cCellDeoxy = new THREE.Color(palette.bloodCellDeoxy);

/* ---------- materials ---------- */
const PULSE_GLSL = `
attribute float aDist; attribute float aRad;
uniform float uPhase, uAmp, uWidth, uVel;
float pulseFn(float x) { x = fract(x); return exp(-pow((x - 0.2) / uWidth, 2.0)) + 0.32 * exp(-pow((x - 0.4) / (uWidth * 1.6), 2.0)); }`;

/** wet vessel material. wall: fresnel-translucent (shows the blood core + cells), otherwise opaque core.
 *  U: shared pulse uniforms (uAmp = 0 for veins). */
function vesselMat(color, U, wall, opts = {}) {
  const m = OrganMat(color, Object.assign(wall
    ? { roughness: 0.3, clearcoat: 0.9, clearcoatRoughness: 0.2, bumpScale: 0.3, transparent: true, depthWrite: false, side: THREE.FrontSide }
    : { roughness: 0.55, clearcoat: 0.25, sheen: 0.2, bumpScale: 0.15, emissiveIntensity: 0.14 }, opts));
  const A = { uAlphaMin: { value: wall ? 0.5 : 1 }, uAlphaPow: { value: 1.7 } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, A);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>' + PULSE_GLSL)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normal * (aRad * uAmp * pulseFn(uPhase - aDist / uVel));');
    if (wall) sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uAlphaMin, uAlphaPow;')
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\n{ float fr = 1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))); gl_FragColor.a *= uAlphaMin + (1.0 - uAlphaMin) * pow(fr, uAlphaPow); }');
  };
  m.customProgramCacheKey = () => wall ? 'vessel-wall' : 'vessel-core';
  m.userData.A = A; allMats.push(m);
  return m;
}

/* ---------- geometry ---------- */
/** register a vessel. kind: art | pulm | vein | pv. opts: detail (fine branch, wall only, fades in when close),
 *  parent (spec whose pulse distance this branch continues), flow (name of a cell path to create), group */
function vessel(kind, pts, rFn, segs, radial, opts = {}) {
  const s = Object.assign({ kind, pts, rFn, segs, radial, detail: false, parent: null, dist0: 0 }, opts);
  specs.push(s); return s;
}
function attach(geo, segs, radial, rFn, dist0, len) {
  const n = (segs + 1) * (radial + 1), d = new Float32Array(n), r = new Float32Array(n);
  for (let i = 0; i <= segs; i++) { const u = i / segs, rr = rFn(u); for (let j = 0; j <= radial; j++) { d[i * (radial + 1) + j] = dist0 + u * len; r[i * (radial + 1) + j] = rr; } }
  geo.setAttribute('aDist', new THREE.BufferAttribute(d, 1)); geo.setAttribute('aRad', new THREE.BufferAttribute(r, 1));
  return geo;
}
/** pulse-distance of point p along spec (parent's own dist0 + arc length to the closest curve point) */
function distAt(spec, p) {
  let best = 0, bd = 1e9; const q = new THREE.Vector3();
  for (let i = 0; i <= 40; i++) { spec.curve.getPointAt(i / 40, q); const d = q.distanceTo(p); if (d < bd) { bd = d; best = i / 40; } }
  return spec.dist0 + best * spec.len;
}
function buildSpec(s) {
  s.wall = vtube(s.pts, s.rFn, s.segs, s.radial);
  s.curve = s.wall.userData.curve; s.len = s.curve.getLength();
  if (s.parent) s.dist0 = distAt(s.parent, s.pts[0]);
  attach(s.wall, s.segs, s.radial, s.rFn, s.dist0, s.len);
  if (!s.detail) {
    const segs = Math.max(8, Math.round(s.segs * 0.6)), radial = Math.max(8, s.radial - 6);
    s.core = attach(vtube(s.pts, (u) => s.rFn(u) * CORE, segs, radial), segs, radial, (u) => s.rFn(u) * CORE, s.dist0, s.len);
  }
}
function merged(list, pick) {
  const geos = list.map(pick).filter(Boolean);
  return geos.length ? mergeGeometries(geos, false) : null;
}
/** one wall mesh (+ one core mesh) per material family */
function family(list, wallM, coreM, parent, key, order = 1) {
  const w = merged(list, (s) => s.wall), c = merged(list, (s) => s.core);
  const out = [];
  if (c) { const m = add(c, coreM, parent, key); out.push(m); }
  if (w) { const m = add(w, wallM, parent, key); m.renderOrder = order; out.push(m); }
  return out;
}

/* ---------- blood cells ---------- */
/* kind = flow pattern ('art' pulsatile / 'vein' steady); blood = cell colour ('oxy' / 'deoxy'). They differ in the
 * pulmonary circuit: pulmonary arteries pulse but carry oxygen-poor blood, pulmonary veins are steady but oxygen-rich. */
function makePath(kind, pts, rFn, n, blood = kind === 'art' ? 'oxy' : 'deoxy') {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
  const p = { kind, blood, curve, len: curve.getLength(), rFn, n };
  paths.push(p); return p;
}
function cellMat() {
  return new THREE.MeshBasicMaterial({ color: palette.white, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
}
function makeCells(blood, color, parent) {
  const list = cells.filter((c) => c.path.blood === blood);
  const inst = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 7, 5), cellMat(), Math.max(1, list.length));
  for (let i = 0; i < list.length; i++) inst.setColorAt(i, color);
  inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage); inst.frustumCulled = false; inst.renderOrder = 0;
  parent.add(inst); return inst;
}

export function build(ctx) {
  C = ctx; dummy = ctx.dummy; setSeed(5203);
  const V = ctx.groups.vessels, AB = ctx.groups.abdomen, an = ctx.anchors;
  /* atrial centres from the heart module (fallbacks = the heart's default pose) */
  let raPos = P(-0.36, 1.78, 0.68), laPos = P(0.29, 2.14, 0.19);
  if (an.atriaG && an.atriaG.children.length >= 2) {
    an.heartG.updateWorldMatrix(true, true);
    raPos = an.atriaG.children[0].getWorldPosition(new THREE.Vector3()); laPos = an.atriaG.children[1].getWorldPosition(new THREE.Vector3());
  }
  const hil = an.renalHilum || [P(-0.96, -1.7, -1.0), P(0.96, -1.45, -1.0)];     // [right, left]

  /* ================= systemic arteries ================= */
  const aorta = vessel('art', [P(0.3, 1.85, 0.55), P(0.25, 2.3, 0.55), P(0.2, 2.85, 0.5), P(0.35, 3.38, 0.15), P(0.72, 3.3, -0.5), P(0.72, 2.8, -1.0), P(0.5, 1.5, -1.05), P(0.32, -0.6, -0.98), P(0.3, -1.6, -0.95), P(0.2, -2.6, -0.95), P(0.08, -3.4, -0.95)],
    (u) => 0.27 - 0.08 * u, 260, 20);
  for (const s of [-1, 1]) {                                    // common -> external / internal iliac
    const x0 = 0.08, bif = P(x0 + s * 0.78, -4.1, -0.85);
    const ci = vessel('art', [P(x0, -3.4, -0.95), P(x0 + s * 0.42, -3.75, -0.92), bif], () => 0.13, 30, 14, { parent: aorta });
    vessel('art', [bif, P(x0 + s * 1.02, -4.45, -0.55), P(x0 + s * 1.16, -4.6, -0.32)], (u) => 0.11 - 0.015 * u, 30, 12, { parent: ci });
    vessel('art', [bif, P(x0 + s * 0.88, -4.4, -1.02), P(x0 + s * 0.92, -4.55, -1.06)], () => 0.075, 20, 10, { parent: ci });
  }
  /* arch branches */
  const bct = vessel('art', [P(0.22, 3.33, 0.22), P(0.0, 3.65, 0.3), P(-0.35, 3.95, 0.35)], (u) => 0.115 - 0.015 * u, 30, 14, { parent: aorta });
  vessel('art', [P(-0.35, 3.95, 0.35), P(-1.0, 3.98, 0.25), P(-1.9, 3.9, 0.3), P(-2.6, 3.72, 0.6), P(-3.15, 3.42, 0.72)], (u) => 0.085 - 0.015 * u, 50, 12, { parent: bct });
  const rcc = vessel('art', [P(-0.35, 3.95, 0.35), P(-0.45, 4.6, 0.38), P(-0.5, 5.4, 0.4), P(-0.5, 6.2, 0.42)], () => 0.075, 50, 12, { parent: bct });
  const lcc = vessel('art', [P(0.42, 3.38, 0.0), P(0.5, 4.0, 0.15), P(0.55, 4.8, 0.3), P(0.55, 5.5, 0.38), P(0.52, 6.2, 0.42)], () => 0.075, 50, 12, { parent: aorta });
  for (const [s, par] of [[-1, rcc], [1, lcc]]) {               // carotid bifurcation: internal (posterior) / external (anterior)
    const b = P(s * 0.51, 6.2, 0.42);
    vessel('art', [b, P(s * 0.56, 6.6, 0.3), P(s * 0.6, 7.05, 0.22)], () => 0.055, 20, 10, { parent: par });
    vessel('art', [b, P(s * 0.47, 6.6, 0.56), P(s * 0.42, 7.05, 0.62)], () => 0.045, 20, 10, { parent: par });
  }
  vessel('art', [P(0.66, 3.32, -0.3), P(1.2, 3.8, -0.2), P(1.9, 3.92, 0.3), P(2.6, 3.72, 0.6), P(3.15, 3.42, 0.72)], (u) => 0.085 - 0.015 * u, 50, 12, { parent: aorta });
  /* abdominal branches (fine detail) */
  const coel = vessel('art', [P(0.3, -0.68, -0.95), P(0.3, -0.69, -0.72)], () => 0.08, 8, 10, { parent: aorta, detail: true });
  vessel('art', [P(0.3, -0.69, -0.72), P(-0.2, -0.75, -0.5), P(-0.6, -0.6, -0.15)], () => 0.055, 24, 8, { parent: coel, detail: true });              // common hepatic
  vessel('art', [P(0.3, -0.69, -0.72), P(0.9, -0.6, -0.82), P(1.3, -0.45, -0.9), P(1.6, -0.38, -0.86), P(1.95, -0.32, -0.86)], (u) => 0.055 * (1 + 0.1 * Math.sin(u * 40)), 40, 8, { parent: coel, detail: true }); // splenic (tortuous)
  vessel('art', [P(0.3, -0.69, -0.72), P(0.45, -0.35, -0.55), P(0.5, 0.1, -0.42)], () => 0.04, 20, 8, { parent: coel, detail: true });                // left gastric
  const sma = vessel('art', [P(0.3, -1.05, -0.95), P(0.28, -1.4, -0.85), P(0.2, -1.75, -0.4), P(0.05, -2.2, 0.0), P(-0.3, -2.8, 0.25)], (u) => 0.075 - 0.03 * u, 50, 10, { parent: aorta, detail: true });
  vessel('art', [P(0.05, -2.2, 0.0), P(0.5, -2.3, 0.2), P(0.9, -2.5, 0.35)], () => 0.035, 16, 6, { parent: sma, detail: true });
  vessel('art', [P(0.12, -2.0, -0.15), P(0.55, -2.0, 0.05), P(0.95, -2.15, 0.25)], () => 0.032, 16, 6, { parent: sma, detail: true });
  vessel('art', [P(-0.3, -2.8, 0.25), P(-0.7, -2.9, 0.3), P(-1.1, -3.1, 0.35)], () => 0.032, 16, 6, { parent: sma, detail: true });
  vessel('art', [P(0.2, -2.55, -0.93), P(0.5, -2.8, -0.8), P(0.8, -3.2, -0.5), P(1.0, -3.6, -0.2)], () => 0.045, 30, 8, { parent: aorta, detail: true });   // inferior mesenteric
  /* renal arteries (parented to the abdomen group so they breathe with the kidneys) */
  const rra = vessel('art', [P(0.3, -1.3, -0.95), P(-0.1, -1.4, -1.2), P(-0.5, -1.55, -1.2), hil[0].clone()], () => 0.08, 40, 12, { parent: aorta, group: 'renal' });
  const lra = vessel('art', [P(0.3, -1.25, -0.95), P(0.62, -1.32, -1.02), hil[1].clone()], () => 0.08, 24, 12, { parent: aorta, group: 'renal' });

  /* ================= pulmonary arteries (in front of the ascending aorta, bifurcating under the arch) ================= */
  const trunk = vessel('pulm', [P(0.08, 1.85, 1.05), P(0.3, 2.3, 0.95), P(0.62, 2.62, 0.85)], (u) => 0.19 - 0.02 * u, 40, 16);
  const lpa = vessel('pulm', [P(0.62, 2.62, 0.85), P(1.05, 2.6, 0.5), P(1.5, 2.4, 0.08), P(1.95, 2.2, -0.1)], (u) => 0.125 - 0.025 * u, 40, 12, { parent: trunk });
  const rpa = vessel('pulm', [P(0.62, 2.62, 0.85), P(0.7, 2.72, 0.32), P(0.3, 2.7, -0.08), P(-0.3, 2.55, 0.1), P(-0.9, 2.3, 0.15), P(-1.5, 2.08, 0.05)], (u) => 0.13 - 0.03 * u, 60, 12, { parent: trunk });

  /* ================= pulmonary veins -> left atrium ================= */
  const pvL = [], pvR = [];
  pvR.push(vessel('pv', [P(-1.5, 2.0, 0.1), P(-0.6, 2.0, 0.12), laPos.clone().add(P(-0.3, 0.1, -0.18))], () => 0.075, 24, 10));
  pvR.push(vessel('pv', [P(-1.5, 1.6, 0.12), P(-0.6, 1.72, 0.1), laPos.clone().add(P(-0.3, -0.1, -0.18))], () => 0.075, 24, 10));
  pvL.push(vessel('pv', [P(1.8, 2.1, 0.0), P(1.05, 2.1, 0.02), laPos.clone().add(P(0.32, 0.1, -0.18))], () => 0.075, 24, 10));
  pvL.push(vessel('pv', [P(1.8, 1.7, 0.0), P(1.05, 1.8, 0.02), laPos.clone().add(P(0.32, -0.1, -0.18))], () => 0.075, 24, 10));

  /* ================= systemic veins ================= */
  const svcTop = P(-0.37, 3.3, 0.52), raIn = raPos.clone().add(P(0, 0.05, -0.05));
  const svc = vessel('vein', [svcTop, P(-0.38, 2.6, 0.55), P(-0.38, 2.2, 0.6), raIn], () => 0.19, 40, 16);
  const rbcv = vessel('vein', [P(-0.95, 3.85, 0.5), P(-0.6, 3.6, 0.52), svcTop], () => 0.13, 20, 12);
  const lbcv = vessel('vein', [P(0.95, 3.85, 0.5), P(0.4, 3.7, 0.65), P(-0.1, 3.47, 0.6), svcTop], () => 0.13, 40, 12);   // crosses in front of the arch branches
  for (const s of [-1, 1]) {
    vessel('vein', [P(s * 0.82, 7.05, 0.3), P(s * 0.8, 6.0, 0.35), P(s * 0.85, 5.0, 0.4), P(s * 0.95, 3.85, 0.5)], () => 0.09, 50, 10);           // internal jugular
    vessel('vein', [P(s * 3.15, 3.25, 0.85), P(s * 2.4, 3.52, 0.85), P(s * 1.6, 3.7, 0.72), P(s * 0.95, 3.85, 0.5)], () => 0.1, 40, 10);          // subclavian vein
  }
  const ivcBot = P(-0.3, -3.55, -0.92), ivc = vessel('vein', [ivcBot, P(-0.35, -2.4, -0.9), P(-0.38, -1.2, -0.85), P(-0.4, -0.2, -0.6), P(-0.4, 0.45, -0.25), P(-0.38, 1.0, 0.3), raPos.clone().add(P(0.02, -0.3, -0.1))], () => 0.22, 120, 16);
  const ilv = {};
  for (const s of [-1, 1]) {                                    // common iliac veins (posterior to the arteries)
    const x0 = -0.3, side = s > 0 ? 1.15 : 1;
    ilv[s] = vessel('vein', [ivcBot, P(x0 + s * 0.5 * side, -3.9, -1.2), P(x0 + s * 0.95 * side, -4.3, -1.1), P(x0 + s * 1.22 * side, -4.5, -0.85), P(x0 + s * 1.32 * side, -4.62, -0.6)], () => 0.12, 40, 10);
  }
  const hv0 = P(-0.4, 0.15, -0.5);                               // hepatic veins entering the IVC (fine detail)
  vessel('vein', [hv0, P(-1.1, 0.0, -0.2), P(-1.7, -0.3, 0.15)], () => 0.06, 16, 8, { detail: true });
  vessel('vein', [hv0, P(-0.55, -0.1, 0.05), P(-0.7, -0.5, 0.45)], () => 0.06, 16, 8, { detail: true });
  vessel('vein', [hv0, P(0.05, -0.05, -0.05), P(0.45, -0.35, 0.3)], () => 0.055, 16, 8, { detail: true });
  const rrv = vessel('vein', [hil[0].clone().add(P(0, 0.04, 0.11)), P(-0.72, -1.5, -0.72), P(-0.4, -1.42, -0.85)], () => 0.09, 24, 10, { group: 'renal' });
  const lrv = vessel('vein', [hil[1].clone().add(P(0, 0.04, 0.11)), P(0.62, -1.26, -0.66), P(0.12, -1.22, -0.64), P(-0.38, -1.28, -0.8)], () => 0.09, 40, 10, { group: 'renal' });   // crosses in front of the aorta

  /* ---------- build geometry, merge per family ---------- */
  for (const s of specs) buildSpec(s);
  pulseU = { uPhase: { value: 0 }, uAmp: { value: 0.1 }, uWidth: { value: 0.085 }, uVel: { value: 20 } };
  pulmU = { uPhase: { value: 0 }, uAmp: { value: 0.06 }, uWidth: { value: 0.1 }, uVel: { value: 14 } };
  const stillU = { uPhase: { value: 0 }, uAmp: { value: 0 }, uWidth: { value: 0.1 }, uVel: { value: 20 } };
  wallArt = vesselMat(palette.aorta, pulseU, true); coreArt = vesselMat(cCoreOxy, pulseU, false);
  wallPulm = vesselMat(palette.pulmonaryTrunk, pulmU, true);
  const corePulm = vesselMat(cCoreDeoxy, pulmU, false);
  const wallVein = vesselMat(palette.veinWall, stillU, true), coreVein = vesselMat(cCoreDeoxy, stillU, false);
  const wallPv = vesselMat(palette.pulmVein, stillU, true), corePv = vesselMat(cCoreOxy, stillU, false);
  const wallArtDet = vesselMat(palette.aorta, pulseU, true, { opacity: 0 }), wallVeinDet = vesselMat(palette.veinWall, stillU, true, { opacity: 0 });
  wallArtDet.userData.A.uAlphaMin.value = wallVeinDet.userData.A.uAlphaMin.value = 0.82;
  detailMats = [wallArtDet, wallVeinDet];
  const by = (kind, detail, group) => specs.filter((s) => s.kind === kind && s.detail === detail && (s.group || null) === group);
  family(by('art', false, null), wallArt, coreArt, V, KEY.art);
  family(by('art', false, 'renal'), wallArt, coreArt, AB, KEY.art);
  family(by('pulm', false, null), wallPulm, corePulm, V, KEY.pulm);
  family(by('pv', false, null), wallPv, corePv, V, KEY.pv);
  family(by('vein', false, null), wallVein, coreVein, V, KEY.vein);
  family(by('vein', false, 'renal'), wallVein, coreVein, AB, KEY.vein);
  detailMeshes = [...family(by('art', true, null), wallArtDet, null, V, KEY.art), ...family(by('vein', true, null), wallVeinDet, null, V, KEY.vein)];
  for (const m of detailMeshes) m.visible = false;

  /* ---------- blood cell paths (direction of flow) ---------- */
  const seg = (s, from = 0, to = 1) => { const n = 12, o = []; for (let i = 0; i <= n; i++) o.push(s.curve.getPointAt(lerp(from, to, i / n))); return o; };
  const cat = (...parts) => parts.flat();
  const pick = (s) => s.rFn;
  const leftCI = specs.find((s) => s.parent === aorta && s.pts[0].y === -3.4 && s.pts[2].x > 0), rightCI = specs.find((s) => s.parent === aorta && s.pts[0].y === -3.4 && s.pts[2].x < 0);
  const isExt = (s) => Math.abs(s.pts[2].z + 0.32) < 0.01;   // external iliac ends anteriorly (z −0.32); the internal one posteriorly
  const extL = specs.find((s) => s.parent === leftCI && isExt(s)), extR = specs.find((s) => s.parent === rightCI && isExt(s));
  makePath('art', cat(seg(aorta), seg(leftCI).slice(1), seg(extL).slice(1)), (u) => lerp(0.27, 0.11, u), 44);
  makePath('art', cat(seg(aorta, 0.55, 1), seg(rightCI).slice(1), seg(extR).slice(1)), (u) => lerp(0.2, 0.11, u), 14);
  makePath('art', cat(seg(bct), seg(rcc).slice(1)), () => 0.085, 8);
  makePath('art', seg(lcc), () => 0.075, 7);
  makePath('art', seg(specs.find((s) => s.parent === aorta && s.pts[0].x === 0.66)), () => 0.08, 6);
  makePath('art', seg(specs.find((s) => s.parent === bct && s.pts[2].x < -1)), () => 0.08, 6);
  makePath('art', seg(rra), () => 0.08, 4); makePath('art', seg(lra), () => 0.08, 3);
  makePath('art', cat(seg(trunk), seg(lpa).slice(1)), () => 0.14, 7, 'deoxy');     // pulmonary arteries: oxygen-poor
  makePath('art', cat(seg(trunk), seg(rpa).slice(1)), () => 0.14, 8, 'deoxy');
  makePath('vein', cat(seg(ilv[1], 1, 0), seg(ivc).slice(1)), () => 0.2, 26);
  makePath('vein', cat(seg(ilv[-1], 1, 0), seg(ivc, 0, 0.3).slice(1)), () => 0.15, 6);
  const ijL = specs.find((s) => s.kind === 'vein' && s.pts[0].y === 7.05 && s.pts[0].x > 0), ijR = specs.find((s) => s.kind === 'vein' && s.pts[0].y === 7.05 && s.pts[0].x < 0);
  makePath('vein', cat(seg(ijL), seg(lbcv).slice(1), seg(svc).slice(1)), () => 0.13, 14);
  makePath('vein', cat(seg(ijR), seg(rbcv).slice(1), seg(svc).slice(1)), () => 0.13, 10);
  makePath('vein', seg(rrv), () => 0.09, 3); makePath('vein', seg(lrv), () => 0.09, 4);
  for (const s of [...pvL, ...pvR]) makePath('vein', seg(s), () => 0.075, 4, 'oxy');   // pulmonary veins: oxygen-rich
  for (const p of paths) for (let i = 0; i < p.n; i++)
    cells.push({ path: p, u: rnd(), ang: rnd() * Math.PI * 2, rad: 0.45 + rnd() * 0.35, spd: 0.75 + rnd() * 0.5, spin: (rnd() - 0.5) * 2 });
  cellsArt = makeCells('oxy', cCellOxy, V); cellsVein = makeCells('deoxy', cCellDeoxy, V);   // grouped by blood, not by vessel

  aortaCurve = aorta.curve; ivcCurve = ivc.curve;
  Object.assign(C.anchors, { aortaCurve, ivcCurve, raPos, laPos });
}

/* ---------- per frame ---------- */
const pos = new THREE.Vector3(), tg = new THREE.Vector3(), nrm = new THREE.Vector3(), bin = new THREE.Vector3();
export function update(f, t, phys) {
  const dt = clamp(t - lastT, 0, 0.1); lastT = t;
  const vp = phys.ventricularPulse ?? 0, br = phys.breath ?? 0, sbp = phys.sbp ?? 120, pp = phys.pulsePressure ?? ((phys.sbp ?? 120) - (phys.dbp ?? 80));
  /* pulse wave: phase from the heart, amplitude/sharpness from the pulse pressure, speed + stiffness from the systolic pressure */
  const stiff = clamp((sbp - 115) / 55, 0, 1), ppn = clamp(pp / 40, 0.4, 2.2);
  pulseU.uPhase.value = pulmU.uPhase.value = (phys.heartPhase ?? 0) - 0.05;
  pulseU.uAmp.value = clamp(0.04 + 0.07 * ppn, 0.05, 0.2) * (1 + 0.25 * stiff);
  pulseU.uWidth.value = 0.09 - 0.035 * stiff; pulseU.uVel.value = 18 + 10 * stiff;
  pulmU.uAmp.value = 0.04 + 0.03 * vp;
  if (Math.abs(stiff - lastStiff) > 0.005) {                   // stiffer wall: paler/harder tone, glossier, less compliant look
    for (const m of [wallArt, detailMats[0]]) {
      m.color.copy(cAorta).lerp(cStiff, stiff); m.emissive.copy(m.color); m.emissiveIntensity = 0.07 + 0.06 * stiff;
      m.roughness = 0.3 - 0.13 * stiff; m.clearcoatRoughness = 0.2 - 0.1 * stiff; m.clearcoat = 0.9 + 0.1 * stiff;
    }
    lastStiff = stiff;
  }
  /* desaturation (sleep apnoea): arterial blood drifts toward the venous colour below SpO2 ~92 */
  const desat = clamp((92 - (phys.spo2 ?? 97)) / 9, 0, 1);
  if (Math.abs(desat - lastDesat) > 0.01) {
    coreArt.color.copy(cCoreOxy).lerp(cCoreDeoxy, desat); coreArt.emissive.copy(coreArt.color);
    const c = cCellOxy.clone().lerp(cCellDeoxy, desat * 0.9);
    for (let i = 0; i < cellsArt.count; i++) cellsArt.setColorAt(i, c);
    cellsArt.instanceColor.needsUpdate = true; lastDesat = desat;
  }
  /* fine branches fade in when the camera comes close */
  const det = C.camera.position.distanceTo(DETAIL_CENTRE) < 15.5 ? 1 : 0;
  detOp = Math.abs(detOp - det) < 1e-3 ? det : lerp(detOp, det, 1 - Math.exp(-dt * 3));
  for (const m of detailMats) m.opacity = detOp;
  for (const m of detailMeshes) m.visible = detOp > 0.02;
  /* blood cells: arterial flow is pulsatile (follows ventricular ejection), venous flow steady with a breathing swing */
  const vA = 1.3 * (0.25 + 1.6 * vp) * dt, vV = 0.6 * (0.8 + 0.35 * br) * dt;
  let ia = 0, iv = 0;
  for (const c of cells) {
    const p = c.path, art = p.kind === 'art';
    c.u += (art ? vA : vV) * c.spd / p.len; if (c.u >= 1) c.u -= 1;
    p.curve.getPointAt(c.u, pos); p.curve.getTangentAt(c.u, tg);
    nrm.crossVectors(tg, UP).normalize(); bin.crossVectors(tg, nrm);
    const r = p.rFn(c.u), a = c.ang + t * 0.5 * c.spin, s = clamp(r * 0.3, 0.016, 0.05);
    pos.addScaledVector(nrm, Math.cos(a) * c.rad * r).addScaledVector(bin, Math.sin(a) * c.rad * r);
    dummy.position.copy(pos); dummy.quaternion.setFromUnitVectors(Y_AXIS, tg);
    dummy.scale.set(s, s * (art ? 1.3 + 0.9 * vp : 1.4), s); dummy.updateMatrix();
    if (p.blood === 'oxy') cellsArt.setMatrixAt(ia++, dummy.matrix); else cellsVein.setMatrixAt(iv++, dummy.matrix);
  }
  cellsArt.instanceMatrix.needsUpdate = cellsVein.instanceMatrix.needsUpdate = true;
}
