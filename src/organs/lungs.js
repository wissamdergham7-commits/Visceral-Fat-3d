// organs/lungs.js — two lungs with fissure grooves + the diaphragm. Breathing amplitude comes from phys.
import { THREE, P, smooth, gauss, noise3, deform, add, lerp } from '../core/ctx.js';
import { palette, OrganMat } from '../core/style.js';
import { heartPos } from './heart.js';

let C, lungs = [], lungMat, diaphragm, lastT = 0;

export function build(ctx) {
  C = ctx;
  lungMat = OrganMat(palette.lung, { roughness: 0.6, transparent: true, opacity: 0.5, depthWrite: false, sheen: 1, sheenColor: new THREE.Color(palette.lungSheen), clearcoat: 0.25, emissiveIntensity: 0.04 });
  for (const s of [-1, 1]) {                              // s=-1 : patient's right lung (screen left)
    const centre = P(s * 1.55, 1.9, -0.1);
    const g = deform(new THREE.SphereGeometry(1, 80, 60), (v) => {
      v.x *= 1.2; v.y *= 1.9; v.z *= 1.35;
      const inner = -s * v.x;                               // flatten the mediastinal face
      if (inner > 0.25) v.x = -s * (0.25 + (inner - 0.25) * 0.3);
      if (v.y < -1.15) { const r2 = v.x * v.x + v.z * v.z; v.y = Math.max(v.y, -1.6 + 0.3 * r2); }  // concave base
      const apex = smooth(0.8, 1.9, v.y); v.x *= 1 - 0.42 * apex; v.z *= 1 - 0.42 * apex;
      if (v.z < 0) v.z *= 1.12;
      const oblique = gauss(v.y - (0.15 - 0.85 * v.z), 0, 0.09); v.multiplyScalar(1 - 0.05 * oblique);   // oblique fissure
      if (s < 0) { const horiz = gauss(v.y, 0.38, 0.07) * smooth(-0.1, 0.5, v.z); v.multiplyScalar(1 - 0.045 * horiz); } // horizontal fissure (right)
      const w = v.clone().add(centre), d = w.distanceTo(heartPos), keep = s > 0 ? 1.62 : 1.35;   // cardiac notch
      if (d < keep) { w.sub(heartPos).setLength(keep).add(heartPos); v.copy(w.sub(centre)); }
      v.multiplyScalar(1 + 0.018 * noise3(v.x * 3, v.y * 3, v.z * 3));
    });
    const m = add(g, lungMat, ctx.groups.lungs, 'lungs');
    m.position.copy(centre); m.renderOrder = 5; lungs.push(m);
  }
  /* diaphragm dome */
  const dg = new THREE.SphereGeometry(1, 64, 20, 0, Math.PI * 2, 0, 1.05);
  deform(dg, (v) => { v.x *= 2.85; v.z *= 1.95; v.y = v.y * 0.95 - 0.12 * Math.exp(-((v.x - 0.3) ** 2 + (v.z - 0.3) ** 2) / 0.8); });
  diaphragm = add(dg, OrganMat(palette.diaphragm, { transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false, roughness: 0.6 }));
  diaphragm.position.set(0, -0.65, -0.05); diaphragm.renderOrder = 4;
  ctx.anchors.lungs = lungs; ctx.anchors.diaphragm = diaphragm;
}

export function update(f, t, phys) {
  const c = phys.breath;                                   // 0 = end expiration, 1 = end inspiration
  lungs.forEach((m) => m.scale.set(1 + 0.025 * c, 1 + 0.045 * c, 1 + 0.035 * c));
  diaphragm.position.y = -0.65 - 0.14 * c;
  C.groups.abdomen.position.y = -0.06 * c;                 // viscera pushed down by the descending diaphragm
  const dt = Math.min(Math.max(t - lastT, 0), 0.4); lastT = t;
  lungMat.opacity = lerp(lungMat.opacity, C.state.opTarget.lung, 1 - Math.exp(-dt * 3.2));
}
