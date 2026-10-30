// organs/heart.js — heart (ventricular mass + 4 atrial lobes) and coronary vessels. Pulses from phys.
import { THREE, P, smooth, noise3, deform, vtube, add } from '../core/ctx.js';
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
/** point on the heart surface at spherical angles (theta around y, phi from the top), scaled by s */
export function heartSurf(th, ph, s = 1) {
  const v = P(Math.sin(ph) * Math.sin(th), Math.cos(ph), Math.sin(ph) * Math.cos(th));
  return heartShape(v).multiplyScalar(s);
}

let heartG, ventG, atriaG;

export function build(ctx) {
  heartG = new THREE.Group(); heartG.position.copy(heartPos); heartG.rotation.set(-0.38, 0, 0.58);
  ctx.groups.heart.add(heartG);
  ventG = new THREE.Group(); atriaG = new THREE.Group(); heartG.add(ventG, atriaG);

  const heartMat = OrganMat(palette.heart, { roughness: 0.3, clearcoat: 0.95, clearcoatRoughness: 0.18, map: heartVeinTex, emissiveIntensity: 0.1 });
  add(deform(new THREE.SphereGeometry(1, 96, 72), heartShape), heartMat, ventG, 'heart');

  const atriumMat = OrganMat(palette.atrium, { roughness: 0.36, clearcoat: 0.8, map: heartVeinTex });
  const atrium = (x, y, z, sx, sy, sz, rz = 0) => {
    const g = deform(new THREE.SphereGeometry(1, 40, 30), (v) => v.multiplyScalar(1 + 0.03 * noise3(v.x * 5, v.y * 5, v.z * 5)));
    const m = add(g, atriumMat, atriaG, 'heart');
    m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.z = rz; return m;
  };
  atrium(-0.5, 0.58, 0.22, 0.48, 0.4, 0.45);        // right atrium
  atrium(0.33, 0.66, -0.1, 0.52, 0.44, 0.5);        // left atrium
  atrium(-0.62, 0.42, 0.5, 0.24, 0.16, 0.2, 0.5);   // right auricle
  atrium(0.5, 0.46, 0.38, 0.27, 0.15, 0.2, -0.4);   // left auricle

  /* coronary arteries (LAD, RCA, circumflex, diagonal, marginal) + great cardiac vein */
  const artMat = OrganMat(palette.coronaryArtery, { roughness: 0.28, clearcoat: 0.9, bumpScale: 0.2 });
  const veinMat = OrganMat(palette.coronaryVein, { roughness: 0.3, clearcoat: 0.8, bumpScale: 0.2 });
  const lad = [], rca = [], cx = [], gcv = [], diag = [], marg = [];
  for (let i = 0; i <= 16; i++) { const a = 0.55 + 2.35 * i / 16; lad.push(heartSurf(0.1 - a * 0.06, a, 1.03)); }
  for (let i = 0; i <= 16; i++) { const a = -0.1 - 2.3 * i / 16; rca.push(heartSurf(a, 1.14 + 0.15 * i / 16, 1.035)); }
  for (let i = 0; i <= 14; i++) { const a = 0.15 + 2 * i / 14; cx.push(heartSurf(a, 1.12, 1.035)); }
  for (let i = 0; i <= 14; i++) { const a = 0.7 + 2.1 * i / 14; gcv.push(heartSurf(0.22 - a * 0.05, a, 1.045)); }
  for (let i = 0; i <= 10; i++) { const a = 1 + 1.6 * i / 10; diag.push(heartSurf(0.5 + a * 0.1, a, 1.03)); }
  for (let i = 0; i <= 10; i++) { const a = 1.25 + 1.5 * i / 10; marg.push(heartSurf(-0.8 - a * 0.12, a, 1.03)); }
  add(vtube(lad, (u) => 0.045 * (1 - 0.5 * u), 60, 8), artMat, ventG);
  add(vtube(rca, (u) => 0.045 * (1 - 0.4 * u), 60, 8), artMat, ventG);
  add(vtube(cx, (u) => 0.04 * (1 - 0.4 * u), 60, 8), artMat, ventG);
  add(vtube(diag, (u) => 0.026 * (1 - 0.5 * u), 40, 6), artMat, ventG);
  add(vtube(marg, (u) => 0.024 * (1 - 0.5 * u), 40, 6), artMat, ventG);
  add(vtube(gcv, () => 0.032, 60, 8), veinMat, ventG);

  Object.assign(ctx.anchors, { heartPos, heartSurf, heartG, ventG, atriaG });
}

export function update(f, t, phys) {
  const a = phys.atrialPulse, l = phys.ventricularPulse;
  atriaG.scale.setScalar(1 - 0.08 * a + 0.03 * l);
  ventG.scale.set(1 - 0.055 * l, 1 - 0.04 * l + 0.02 * a, 1 - 0.055 * l);
  ventG.rotation.y = 0.045 * l;               // ventricular twist
}
