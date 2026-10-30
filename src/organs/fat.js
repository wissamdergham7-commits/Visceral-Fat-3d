// organs/fat.js — visceral fat: epicardial (on the heart), greater omentum (plate + lobules + vessels),
// mesenteric (around colon & small bowel), perirenal (kidney capsules). All instanced, built twice (A/B).
import { THREE, P, clamp, lerp, smooth, rnd, setSeed, vtube, add, LAYER } from '../core/ctx.js';
import { palette, OrganMat, fatMat, fatColors } from '../core/style.js';

let C, dummy, lobuleGeo, lobuleMat;
let epi = [], om = [], mes = [], pr = [];          // particle lists sorted by threshold
let setA, setB, lastA = -1, lastB = -1;
let omVessels = [], lastOmVesselF = -1;

const byThr = (arr) => arr.sort((a, b) => a.thr - b.thr);

function makeInst(count, parent, layer, key) {
  const m = new THREE.InstancedMesh(lobuleGeo, lobuleMat, count);
  m.count = 0; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < count; i++) m.setColorAt(i, fatColors[i % fatColors.length]);
  parent.add(m); m.frustumCulled = false; m.layers.set(layer);
  if (key) m.userData.key = key;
  return m;
}
/** omentum apron surface: u across (patient left→right), v down, e = effective fat */
function omentumSurf(u, v, e, out) {
  const x = lerp(-1.95, 1.95, u), drop = 0.25 + 2.4 * e;
  const y = -1.32 + 0.42 * smooth(-0.2, 1.9, x) - v * drop;
  const z = 1.48 + 0.22 * Math.sin(Math.PI * u) + e * 0.42 * Math.sin(Math.PI * v) * Math.sin(Math.PI * u) + 0.06 * Math.sin(u * 23 + v * 5) * v;
  return out.set(x, y, z);
}
function makeOmentumPlate(layer) {
  const geo = new THREE.PlaneGeometry(1, 1, 44, 34);
  const mesh = add(geo, OrganMat(palette.omentumPlate, { transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false, roughness: 0.5, sheen: 0.8, sheenColor: new THREE.Color(palette.omentumSheen) }), C.groups.abdomen, 'omentum');
  mesh.renderOrder = 6; mesh.layers.set(layer);
  return { geo, mesh };
}
/** place instances whose threshold is below the fat level, with a soft fade-in */
function layInst(inst, list, e, place) {
  let n = 0; const lim = e * 1.05 + 0.07;
  for (const p of list) {
    if (p.thr > lim) break;
    const a = clamp((e * 1.05 - p.thr) / 0.07 + 1, 0, 1);
    if (a <= 0.02) continue;
    place(p, Math.pow(a, 0.6)); dummy.updateMatrix(); inst.setMatrixAt(n++, dummy.matrix);
  }
  inst.count = n; inst.instanceMatrix.needsUpdate = true;
}
function layFat(set, f) {
  const e = Math.pow(f, 1.35), grow = 0.42 + 0.88 * f, v = new THREE.Vector3();
  layInst(set.epi, epi, e, (p, a) => {
    dummy.position.copy(p.p).addScaledVector(p.n, p.s * grow * 0.35);
    dummy.rotation.set(p.rot, p.rot * 1.3, 0); dummy.scale.setScalar(p.s * grow * 1.15 * a);
  });
  const pos = set.om.geo.attributes.position;
  for (let r = 0; r <= 34; r++) for (let c = 0; c <= 44; c++) { omentumSurf(c / 44, r / 34, e, v); pos.setXYZ(r * 45 + c, v.x, v.y, v.z); }
  pos.needsUpdate = true; set.om.geo.computeVertexNormals(); set.om.geo.computeBoundingSphere();
  set.om.mesh.material.opacity = 0.18 + 0.5 * e;
  layInst(set.omf, om, e, (p, a) => {
    omentumSurf(p.u, p.v, e, v); v.z += 0.04 + p.j * 0.08 * (0.4 + e);
    dummy.position.copy(v); dummy.rotation.set(p.rot, p.rot * 0.7, p.rot * 1.9); dummy.scale.setScalar(p.s * grow * a);
  });
  layInst(set.mes, mes, e, (p, a) => { dummy.position.copy(p.p); dummy.rotation.set(p.rot, p.rot, 0); dummy.scale.setScalar(p.s * grow * a); });
  layInst(set.pr, pr, e, (p, a) => { dummy.position.copy(p.p); dummy.rotation.set(p.rot, 0, p.rot); dummy.scale.setScalar(p.s * grow * a); });
}
/** small vessels running down the omentum (state A only; rebuilt when f moves by > 0.03) */
function omentumVessels(e) {
  if (Math.abs(e - lastOmVesselF) < 0.03) return;
  lastOmVesselF = e;
  omVessels.forEach((m) => { m.geometry.dispose(); C.groups.abdomen.remove(m); }); omVessels.length = 0;
  if (e < 0.08) return;
  const v = new THREE.Vector3();
  for (let k = 0; k < 4; k++) {
    const u0 = 0.18 + 0.2 * k, pts = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14 * 0.92;
      omentumSurf(clamp(u0 + 0.13 * Math.sin(t * 5 + k * 2) + 0.05 * Math.sin(t * 11), 0.02, 0.98), t, e, v);
      pts.push(v.clone().setZ(v.z + 0.05));
    }
    const m = add(vtube(pts, (u) => 0.017 * (1 - 0.4 * u), 60, 6), OrganMat(palette.omentumVessel, { roughness: 0.3, clearcoat: 0.9 }), C.groups.abdomen, 'omentum');
    m.layers.set(LAYER.A); omVessels.push(m);
  }
}

export function build(ctx) {
  C = ctx; dummy = ctx.dummy;
  const { heartSurf, ventG, colonCurve, siCurve, kidneyPos } = ctx.anchors;
  lobuleGeo = new THREE.IcosahedronGeometry(1, 2); lobuleGeo.scale(1, 0.82, 0.9);
  lobuleMat = fatMat();
  setSeed(3001);

  /* epicardial: 42% in the AV groove ring, 22% along the interventricular grooves, rest in 16 clusters */
  const clusters = [];
  for (let i = 0; i < 16; i++) clusters.push({ th: rnd() * Math.PI * 2, ph: 0.5 + rnd() * 2.4, t: rnd() });
  for (let i = 0; i < 700; i++) {
    const r = rnd(); let th, ph, thr = rnd();
    if (r < 0.42) { th = rnd() * Math.PI * 2; ph = 1.12 + (rnd() - 0.5) * 0.26; thr *= 0.55; }
    else if (r < 0.64) { ph = 0.55 + rnd() * 2.2; th = (rnd() < 0.7 ? 0.1 - ph * 0.06 : Math.PI + 0.2) + (rnd() - 0.5) * 0.28; thr = thr * 0.7 + 0.05; }
    else { const c = clusters[i % clusters.length]; th = c.th + (rnd() - 0.5) * 0.5; ph = clamp(c.ph + (rnd() - 0.5) * 0.4, 0.4, 3); thr = 0.3 + 0.7 * (c.t * 0.6 + rnd() * 0.4); }
    epi.push({ th, ph, thr, s: 0.07 + rnd() * 0.07, rot: rnd() * 6 });
  }
  byThr(epi).forEach((p) => { p.p = heartSurf(p.th, p.ph, 1); p.n = p.p.clone().normalize(); });
  const epiA = makeInst(epi.length, ventG, LAYER.A, 'epifat'), epiB = makeInst(epi.length, ventG, LAYER.B);

  /* omentum lobules */
  for (let i = 0; i < 1500; i++) om.push({ u: rnd(), v: rnd(), j: rnd(), thr: (rnd() * 0.92 + 0.02) * 0.55 + rnd() * 0.45, s: 0.085 + rnd() * 0.1, rot: rnd() * 6 });
  byThr(om);
  const omA = makeOmentumPlate(LAYER.A), omB = makeOmentumPlate(LAYER.B);
  const omfA = makeInst(om.length, C.groups.abdomen, LAYER.A, 'omentum'), omfB = makeInst(om.length, C.groups.abdomen, LAYER.B);

  /* mesenteric: 30% hugging the colon, 70% around small-bowel loops */
  for (let i = 0; i < 700; i++) {
    const onColon = rnd() < 0.3;
    mes.push({ onColon, u: rnd(), a: rnd() * Math.PI * 2, d: onColon ? 1.08 : 0.24 + rnd() * 0.16, thr: rnd(), s: onColon ? 0.08 + rnd() * 0.07 : 0.07 + rnd() * 0.08, rot: rnd() * 6 });
  }
  byThr(mes);
  { const p = new THREE.Vector3(), tg = new THREE.Vector3(), n = new THREE.Vector3(), b = new THREE.Vector3(), up = new THREE.Vector3(0.3, 1, 0.2).normalize();
    mes.forEach((q) => {
      const cv = q.onColon ? colonCurve : siCurve;
      cv.getPointAt(q.u, p); cv.getTangentAt(q.u, tg); n.crossVectors(tg, up).normalize(); b.crossVectors(tg, n).normalize();
      const d = q.onColon ? 0.37 * q.d : q.d;
      q.p = p.clone().add(n.multiplyScalar(Math.cos(q.a) * d)).add(b.multiplyScalar(Math.sin(q.a) * d));
    }); }
  const mesA = makeInst(mes.length, C.groups.abdomen, LAYER.A, 'omentum'), mesB = makeInst(mes.length, C.groups.abdomen, LAYER.B);

  /* perirenal capsules */
  kidneyPos.forEach((kp) => {
    for (let i = 0; i < 160; i++) {
      const dir = P(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
      pr.push({ p: kp.clone().add(dir.multiply(P(0.5, 0.86, 0.4))), thr: rnd(), s: 0.08 + rnd() * 0.07, rot: rnd() * 6 });
    }
  });
  byThr(pr);
  const prA = makeInst(pr.length, C.groups.abdomen, LAYER.A, 'kidney'), prB = makeInst(pr.length, C.groups.abdomen, LAYER.B);

  setA = { epi: epiA, om: omA, omf: omfA, mes: mesA, pr: prA };
  setB = { epi: epiB, om: omB, omf: omfB, mes: mesB, pr: prB };
}

export function update(f, t, phys) {
  if (Math.abs(f - lastA) > 1e-4) { layFat(setA, f); omentumVessels(Math.pow(f, 1.35)); lastA = f; }
  if (C.state.bVersion !== lastB) { layFat(setB, C.state.fB); lastB = C.state.bVersion; }
}
