// organs/body.js — torso shell (skin + subcutaneous fat, states A/B) and the skeleton.
// Publishes ctx.anchors.torsoRadii(y, W, Wz, inset) for the cross-section drawing.
import { THREE, P, lerp, deform, vtube, add, LAYER } from '../core/ctx.js';
import { mats } from '../core/style.js';

const ROWS = 110, COLS = 80, Y0 = -4.9, Y1 = 5.4;

/** [y, halfWidthX, halfDepthZ] control rows of the torso. W/Wz = belly radii. */
export function torsoProfile(W, Wz) {
  return [[-4.9, 2.95, 1.9], [-4.1, 3.2, 2.05], [-3.2, 3.05, 2], [-2, W, Wz],
    [-0.8, lerp(W, 2.9, 0.6), lerp(Wz, 1.95, 0.6)], [0.4, 2.9, 1.95], [1.8, 3, 2], [3, 3.35, 1.85],
    [3.75, 3.6, 1.55], [4.15, 2.5, 1.2], [4.45, 1, 0.92], [5.4, 0.92, 0.88]];
}
/* Catmull-Rom sample of column `col` of a profile table at height y */
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
export function torsoRadii(y, W, Wz, inset) {
  const p = torsoProfile(W, Wz);
  return [Math.max(0.3, sample(p, y, 1) - inset), Math.max(0.3, sample(p, y, 2) - inset)];
}

function makeTorsoGeo() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((ROWS + 1) * (COLS + 1) * 3), 3));
  const idx = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const a = r * (COLS + 1) + c, b = a + COLS + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  g.setIndex(idx);
  return g;
}
function layTorso(geo, W, Wz, bulge, inset) {
  const prof = torsoProfile(W, Wz), pos = geo.attributes.position;
  for (let r = 0; r <= ROWS; r++) {
    const y = lerp(Y0, Y1, r / ROWS);
    const rx = Math.max(0.3, sample(prof, y, 1) - inset), rz = Math.max(0.3, sample(prof, y, 2) - inset);
    const u = bulge * Math.exp(-(((y + 2) / 1.45) ** 2));
    for (let c = 0; c <= COLS; c++) {
      const a = c / COLS * Math.PI * 2, cz = Math.cos(a), sx = Math.sin(a);
      pos.setXYZ(r * (COLS + 1) + c, rx * sx, y, rz * cz * (1 + u * Math.max(0, cz) ** 1.6) - 0.05);
    }
  }
  pos.needsUpdate = true; geo.computeVertexNormals(); geo.computeBoundingSphere();
}

let C, geoA, geoAfat, geoB, geoBfat, boneMat, cartMat, lastA = null, lastB = -1, lastT = 0;

export function build(ctx) {
  C = ctx;
  const { groups } = ctx;
  geoA = makeTorsoGeo(); geoAfat = makeTorsoGeo(); geoB = makeTorsoGeo(); geoBfat = makeTorsoGeo();
  const skinMat = mats.skin(), fatMat = mats.subcutFat();
  const sA = add(geoA, skinMat, groups.skin, 'skin'); sA.renderOrder = 10; sA.layers.set(LAYER.A);
  const fA = add(geoAfat, fatMat, groups.skin, 'skin'); fA.renderOrder = 9; fA.layers.set(LAYER.A);
  const sB = add(geoB, skinMat, groups.skin); sB.renderOrder = 10; sB.layers.set(LAYER.B);
  const fB = add(geoBfat, fatMat, groups.skin); fB.renderOrder = 9; fB.layers.set(LAYER.B);
  ctx.anchors.torsoRadii = torsoRadii;

  /* ---- skeleton ---- */
  boneMat = mats.bone(); cartMat = mats.cartilage();
  for (let i = 0; i < 10; i++) {                       // 10 rib pairs
    const y = 3.38 - i * 0.43, e = i === 0 ? 0.58 : i === 1 ? 0.78 : i === 2 ? 0.9 : 1;
    const span = i < 7 ? Math.PI * 0.92 : Math.PI * (0.9 - (i - 6) * 0.11);
    for (const s of [-1, 1]) {
      const pts = [];
      for (let k = 0; k <= 18; k++) {
        const a = 0.1 + (span - 0.1) * k / 18;
        pts.push(P(s * 2.55 * e * Math.sin(a), y + 0.28 * Math.cos(a) - 0.95 * (a / Math.PI), -1.68 * (e * 0.85 + 0.15) * Math.cos(a) - 0.05));
      }
      add(vtube(pts, (u) => 0.07 * (1 - 0.25 * u), 60, 8), boneMat, groups.bones);
      if (i < 7) {                                       // costal cartilage to the sternum
        const o = pts[pts.length - 1];
        add(vtube([o, P(s * 0.38, lerp(o.y, 3 - i * 0.3, 0.6), 1.66), P(s * 0.2, 3.05 - i * 0.33, 1.72)], () => 0.055, 20, 6), cartMat, groups.bones);
      }
    }
  }
  { const g = new THREE.CapsuleGeometry(0.17, 2.5, 6, 16); g.scale(1, 1, 0.3);   // sternum
    add(g, boneMat, groups.bones).position.set(0, 2.05, 1.74); }
  for (let y = -4.3; y <= 4.4; y += 0.34) {                                        // spine
    add(new THREE.CylinderGeometry(0.3, 0.32, 0.24, 18), boneMat, groups.bones).position.set(0, y, -1.42);
    const sp = add(new THREE.BoxGeometry(0.12, 0.16, 0.45), boneMat, groups.bones);
    sp.position.set(0, y - 0.05, -1.75); sp.rotation.x = -0.3;
  }
  for (const s of [-1, 1]) {                                                        // clavicles + pelvis
    add(vtube([P(s * 0.3, 3.62, 1.55), P(s * 1.4, 3.92, 1.25), P(s * 2.9, 3.98, 0.35)], () => 0.085, 30, 10), boneMat, groups.bones);
    const g = new THREE.SphereGeometry(1, 32, 24);
    deform(g, (v) => { v.x *= 1.05; v.y *= 0.95; v.z *= 0.28; if (v.y < -0.3) v.x *= 0.7; });
    const m = add(g, boneMat, groups.bones);
    m.position.set(s * 2, -4, -0.45); m.rotation.y = s * 0.75;
  }
}

export function update(f, t, phys) {
  const st = C.state, b = st.body;
  const key = `${b.W.toFixed(4)}|${b.Wz.toFixed(4)}|${b.d.toFixed(4)}|${b.bulge.toFixed(4)}`;
  if (key !== lastA) {                       // state A follows the eased live parameters
    layTorso(geoA, b.W, b.Wz, b.bulge, 0);
    layTorso(geoAfat, b.W, b.Wz, b.bulge, b.d);
    lastA = key;
  }
  if (st.bVersion !== lastB) {               // state B = today
    const q = st.bodyB;
    layTorso(geoB, q.W, q.Wz, q.bulge, 0);
    layTorso(geoBfat, q.W, q.Wz, q.bulge, q.d);
    lastB = st.bVersion;
  }
  const dt = Math.min(Math.max(t - lastT, 0), 0.4); lastT = t;
  const s = 1 - Math.exp(-dt * 3.2);
  boneMat.opacity = lerp(boneMat.opacity, st.opTarget.bone, s);
  cartMat.opacity = boneMat.opacity * 0.75;
}
