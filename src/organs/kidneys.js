// organs/kidneys.js — kidneys with a translucent cortex that opens (eased, no popping) on a coronal section
// when the camera is close or the kidney card is open: medulla with 8 renal pyramids, minor/major calyces,
// renal pelvis; ureters down to the bladder region; adrenal caps (right pyramidal, left semilunar);
// perirenal (Gerota) fat capsule whose thickness grows with the fat level (A/B copies).
// Publishes anchors.kidneyPos ([Vector3, Vector3], kidney centres, index 0 = patient's right),
// anchors.renalHilum ([Vector3, Vector3], world points where the renal vessels meet the kidney),
// anchors.ureterCurve ([CatmullRomCurve3, CatmullRomCurve3]).
import { THREE, P, clamp, lerp, smooth, gauss, noise3, rnd, setSeed, deform, vtube, add, LAYER } from '../core/ctx.js';
import { palette, OrganMat } from '../core/style.js';

const KR = [0.42, 0.78, 0.3];                      // kidney half-extents (x, y, z) in kidney-local space
const POS = { '-1': P(-1.22, -1.6, -1.12), 1: P(1.22, -1.35, -1.12) };   // right kidney lower (liver above it)
const N_PYR = 8;
const CLOSE_DIST = 7.6;                            // camera distance (world) below which the cortex opens

let C, kidneys = [], capA = [], capB = [], lastA = -1, lastB = -1, lastT = 0;
const tmp = new THREE.Vector3(), Y_AXIS = new THREE.Vector3(0, 1, 0);

/** bean shape; s = side (-1 right, +1 left), notch = hilum depth factor. v comes in on the unit sphere. */
function beanShape(v, s, notch = 1) {
  const x0 = v.x, y0 = v.y;
  v.x *= KR[0]; v.y *= KR[1]; v.z *= KR[2];
  const medial = -s * x0;                                       // 0..1 toward the hilum side
  const hil = gauss(y0, -0.06, 0.42) * smooth(0.2, 1, medial);  // concavity centred slightly below mid-height
  v.x += s * 0.22 * notch * hil;
  v.z *= 1 - 0.06 * notch * hil;
  if (v.z > 0) v.z *= 0.93;                                    // anterior face a little flatter
  const pole = smooth(0.55, 1, Math.abs(y0)) * notch;
  v.x *= 1 - 0.08 * pole; v.z *= 1 - 0.1 * pole;                // rounder poles
  v.multiplyScalar(1 + 0.012 * notch * noise3(v.x * 5, v.y * 5, v.z * 5));
}

/** cortex material: wet organ look + a coronal cut-away driven by uCut: the half of the cortex that faces the
 *  camera (uSide = +1 anterior, -1 posterior, eased) fades out and reveals the section plate. */
function cortexMat() {
  const U = { uCut: { value: 0 }, uSide: { value: 1 } };
  const m = OrganMat(palette.renalCortex, { roughness: 0.3, clearcoat: 0.92, clearcoatRoughness: 0.18, transparent: true, side: THREE.FrontSide, bumpScale: 0.45 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vLz;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLz = position.z;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uCut, uSide; varying float vLz;')
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.a *= mix(1.0, 0.06 + 0.94 * smoothstep(0.08, -0.06, vLz * uSide), uCut);');
  };
  m.customProgramCacheKey = () => 'kidney-cortex';
  m.userData.U = U;
  return m;
}

/** perirenal fat capsule: glassy yellow shell, rim brighter than the centre so the kidney stays readable inside */
function capsuleMat() {
  const m = OrganMat(palette.renalCapsuleFat, { transparent: true, opacity: 0.3, depthWrite: false, side: THREE.FrontSide, roughness: 0.38, clearcoat: 0.7, clearcoatRoughness: 0.25, sheen: 1, sheenColor: new THREE.Color(palette.fatSheen), emissiveIntensity: 0.1, bumpScale: 0.2 });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\n{ float fr = 1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))); gl_FragColor.a *= 0.42 + 0.58 * pow(fr, 1.4); }');
  };
  m.customProgramCacheKey = () => 'kidney-capsule';
  return m;
}

/** coronal section plate: a flattened bean with vertex colours (cortex band, medulla, sinus fat) */
function sectionPlate(s) {
  const g = new THREE.SphereGeometry(1, 48, 36), pos = g.attributes.position, v = new THREE.Vector3();
  const col = new Float32Array(pos.count * 3), c = new THREE.Color();
  const cCor = new THREE.Color(palette.renalCortex), cMed = new THREE.Color(palette.renalMedulla), cSin = new THREE.Color(palette.renalCapsuleFat), cPel = new THREE.Color(palette.renalPelvis);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const x0 = v.x, y0 = v.y, rr = Math.hypot(x0, y0);
    beanShape(v, s, 0.9); v.z *= 0.07;
    pos.setXYZ(i, v.x, v.y, v.z);
    const n = 0.5 + 0.5 * noise3(x0 * 7 + s, y0 * 7, 3);
    c.copy(cCor).lerp(cMed, 0.5 * smooth(0.78, 0.45, rr));                  // cortex band -> renal columns darken toward the sinus
    const sinus = smooth(0.42, 0.18, rr) * smooth(-0.05, 0.3, -s * x0);    // renal sinus (medial, central)
    c.lerp(cSin.clone().lerp(cPel, 0.35), sinus * 0.9);
    c.multiplyScalar(0.92 + 0.16 * n);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** adrenal gland: right = flattened pyramid, left = semilunar cap. Local to the kidney group. */
function adrenal(s, parent) {
  const g = deform(new THREE.SphereGeometry(1, 36, 26), (v) => {
    const x0 = v.x, y0 = v.y;
    if (s < 0) { v.x *= 0.25 * (1 - 0.62 * smooth(-0.35, 1, y0)); v.y *= 0.21; v.z *= 0.085; }
    else { v.x *= 0.31; v.y *= 0.16; v.z *= 0.085; v.y -= 0.11 * x0 * x0; v.x *= 1 - 0.15 * smooth(0.2, 1, y0); }
    v.multiplyScalar(1 + 0.03 * noise3(x0 * 9, y0 * 9, v.z * 40));
  });
  const m = add(g, OrganMat(palette.adrenal, { roughness: 0.5, clearcoat: 0.45, bumpScale: 1 }), parent, 'kidney');
  m.position.set(-s * 0.14, KR[1] - 0.02, 0.09); m.rotation.set(-0.35, 0, s * 0.45);
  return m;
}

/** pyramids, calyces and pelvis for one kidney (kidney-local coords, lying on the z = 0 section plate) */
function interior(s, inner, pyrInst, calInst, iBase) {
  const S = P(-s * 0.1, -0.03, 0), dummy = C.dummy, pelMat = OrganMat(palette.renalPelvis, { roughness: 0.38, clearcoat: 0.75, bumpScale: 0.25 });
  const papillae = [];
  for (let i = 0; i < N_PYR; i++) {
    const a = lerp(-1.3, 1.3, i / (N_PYR - 1)) + 0.05 * Math.sin(i * 3.1), d = P(s * Math.cos(a), Math.sin(a), 0);
    const base = S.clone().add(P(d.x * 0.31, d.y * 0.62, 0)), apex = S.clone().add(P(d.x * 0.09, d.y * 0.18, 0));
    const h = base.distanceTo(apex) * 1.08, r = 0.125 + 0.03 * Math.abs(Math.sin(a));
    dummy.position.lerpVectors(base, apex, 0.5).setZ(0.015);
    dummy.quaternion.setFromUnitVectors(Y_AXIS, apex.clone().sub(base).normalize());
    dummy.scale.set(r, h, r * 0.55); dummy.updateMatrix(); pyrInst.setMatrixAt(iBase + i, dummy.matrix);
    /* minor calyx: a cream cup around the papilla pointing to the pelvis */
    const cup = apex.clone().lerp(S, 0.22);
    dummy.position.lerpVectors(apex, cup, 0.5).setZ(0.02);
    dummy.quaternion.setFromUnitVectors(Y_AXIS, cup.clone().sub(apex).normalize());
    dummy.scale.set(0.05, apex.distanceTo(cup) * 1.1, 0.035); dummy.updateMatrix(); calInst.setMatrixAt(iBase + i, dummy.matrix);
    papillae.push(cup);
  }
  /* three major calyces (upper / middle / lower) joining the pelvis, each fed by its minor calyces */
  const groups = [[0, 1, 2], [3, 4], [5, 6, 7]];
  const pelvisC = S.clone().add(P(-s * 0.06, -0.02, 0.01));
  for (const gi of groups) {
    const mid = gi.reduce((acc, i) => acc.add(papillae[i]), new THREE.Vector3()).multiplyScalar(1 / gi.length);
    const tip = mid.clone().lerp(pelvisC, 0.35).setZ(0.02);
    add(vtube([pelvisC, tip], (u) => 0.055 - 0.02 * u, 8, 8), pelMat, inner, 'kidney');
    for (const i of gi) add(vtube([tip, papillae[i].clone().setZ(0.02)], () => 0.024, 8, 6), pelMat, inner, 'kidney');
  }
  /* renal pelvis: flattened funnel leaving the hilum medially and a little posteriorly */
  const exit = P(-s * 0.3, -0.1, -0.03), out = P(-s * 0.42, -0.16, -0.05);
  const pel = add(vtube([S.clone().add(P(s * 0.06, 0.03, 0.01)), pelvisC, exit, out], (u) => u < 0.5 ? 0.095 - 0.02 * u : lerp(0.085, 0.045, (u - 0.5) * 2), 24, 12), pelMat, inner, 'kidney');
  pel.scale.set(1, 1, 0.7);
  return out;
}

function capsuleMesh(geo, layer, parent, kg) {
  const m = add(geo, capsuleMat(), parent, 'kidney');
  m.position.copy(kg.position); m.rotation.copy(kg.rotation); m.layers.set(layer); m.renderOrder = 2;
  return m;
}
function layCapsule(list, f) {
  const e = clamp(f, 0, 1), th = 0.05 + 0.38 * e;            // Gerota's capsule thickens with the fat level
  for (const m of list) {
    m.scale.set((KR[0] + th) / KR[0], (KR[1] + th * 0.95) / KR[1], (KR[2] + th * 1.2) / KR[2]);
    m.material.opacity = 0.16 + 0.4 * e;
  }
}

export function build(ctx) {
  C = ctx; setSeed(4101);
  const ab = ctx.groups.abdomen, kidneyPos = [], renalHilum = [], ureterCurve = [];
  const pyrGeo = new THREE.ConeGeometry(1, 1, 14, 1), calGeo = new THREE.ConeGeometry(1, 1, 10, 1);
  const pyrMat = OrganMat(palette.renalPyramid, { roughness: 0.5, clearcoat: 0.45, bumpScale: 1.4, sheen: 0.2, sheenColor: new THREE.Color(palette.renalPelvis), emissive: new THREE.Color(palette.renalMedulla), emissiveIntensity: 0.12, color: new THREE.Color(palette.renalPyramid).multiplyScalar(0.8) });
  const calMat = OrganMat(palette.renalPelvis, { roughness: 0.38, clearcoat: 0.75 });
  for (const s of [-1, 1]) {                         // s = -1 : patient's right kidney (index 0)
    const kg = new THREE.Group(); kg.position.copy(POS[s]); kg.rotation.set(0, s * 0.35, s * 0.17); ab.add(kg);
    kidneyPos.push(kg.position.clone());
    const cMat = cortexMat();
    const cortex = add(deform(new THREE.SphereGeometry(1, 56, 42), (v) => beanShape(v, s)), cMat, kg, 'kidney');
    cortex.renderOrder = 1;
    /* interior: only visible while the cut-away is open */
    const inner = new THREE.Group(); kg.add(inner);
    add(sectionPlate(s), OrganMat(palette.white, { vertexColors: true, roughness: 0.42, clearcoat: 0.55, clearcoatRoughness: 0.3, bumpScale: 0.5, side: THREE.DoubleSide, sheen: 0.15, sheenColor: new THREE.Color(palette.renalCortex), emissive: new THREE.Color(palette.renalMedulla), emissiveIntensity: 0.1 }), inner, 'kidney');
    const pyrInst = new THREE.InstancedMesh(pyrGeo, pyrMat, N_PYR), calInst = new THREE.InstancedMesh(calGeo, calMat, N_PYR);
    pyrInst.userData.key = calInst.userData.key = 'kidney'; inner.add(pyrInst, calInst);
    const pelvisOut = interior(s, inner, pyrInst, calInst, 0);
    pyrInst.instanceMatrix.needsUpdate = calInst.instanceMatrix.needsUpdate = true;
    adrenal(s, kg);
    kg.updateMatrixWorld(true);
    renalHilum.push(kg.localToWorld(P(-s * 0.33, -0.06, 0.04)));
    /* ureter: from the pelvis, down the posterior abdominal wall (behind the bowel), over the pelvic brim, forward to the bladder */
    const u0 = kg.localToWorld(pelvisOut.clone());
    const uGeo = vtube([u0, P(s * 0.95, POS[s].y - 0.55, -1.02), P(s * 0.9, -2.4, -1.05), P(s * 0.88, -3.1, -1.0), P(s * 1.05, -3.65, -0.85), P(s * 0.95, -4.1, -0.35), P(s * 0.38, -4.25, 0.3)], (u) => 0.04 - 0.008 * u, 110, 10);
    add(uGeo, OrganMat(palette.ureter, { roughness: 0.42, clearcoat: 0.7, bumpScale: 0.3 }), ab, 'kidney');
    ureterCurve.push(uGeo.userData.curve);
    /* perirenal fat capsule (Gerota): A copy follows the slider, B copy is "today" */
    const capGeo = deform(new THREE.SphereGeometry(1, 40, 30), (v) => beanShape(v, s, 0.45));
    capA.push(capsuleMesh(capGeo, LAYER.A, ab, kg)); capB.push(capsuleMesh(capGeo, LAYER.B, ab, kg));
    kidneys.push({ g: kg, cortex, U: cMat.userData.U, inner, cut: 0, side: 1, s });
  }
  Object.assign(ctx.anchors, { kidneyPos, renalHilum, ureterCurve });
  layCapsule(capA, ctx.state.fTgt); layCapsule(capB, ctx.state.fB);
}

export function update(f, t, phys) {
  const dt = clamp(t - lastT, 0, 0.4); lastT = t;
  const k = 1 - Math.exp(-dt * 3.2);
  if (Math.abs(f - lastA) > 1e-4) { layCapsule(capA, f); lastA = f; }
  if (C.state.bVersion !== lastB) { layCapsule(capB, C.state.fB); lastB = C.state.bVersion; }
  /* coronal cut-away eases open when the camera is close to a kidney or the kidney card is open */
  const focus = C.state.focusKey === 'kidney';
  for (const K of kidneys) {
    K.g.getWorldPosition(tmp);
    const target = (focus || C.camera.position.distanceTo(tmp) < CLOSE_DIST) ? 1 : 0;
    K.cut = Math.abs(K.cut - target) < 1e-3 ? target : lerp(K.cut, target, k);
    K.g.worldToLocal(tmp.copy(C.camera.position));            // which face of the kidney looks at the camera
    K.side = lerp(K.side, tmp.z >= 0 ? 1 : -1, k);
    K.U.uCut.value = K.cut; K.U.uSide.value = K.side;
    K.cortex.material.depthWrite = K.cut < 0.03;
    K.inner.visible = K.cut > 0.02;
  }
}
