// organs/kidneys.js — kidneys + adrenal glands. Publishes anchors.kidneyPos.
import { THREE, deform, add } from '../core/ctx.js';
import { palette, OrganMat } from '../core/style.js';

export function build(ctx) {
  const ab = ctx.groups.abdomen, kidneyPos = [];
  for (const s of [-1, 1]) {                       // s=-1 right kidney (lower, under the liver)
    const g = deform(new THREE.SphereGeometry(1, 40, 30), (v) => {
      v.x *= 0.4; v.y *= 0.74; v.z *= 0.3;
      const inner = -s * v.x;                      // hilum notch on the medial side
      if (inner > 0.18) v.x = -s * (0.18 + (inner - 0.18) * 0.3) * (1 - 0.6 * Math.exp(-v.y * v.y / 0.1));
    });
    const k = add(g, OrganMat(palette.kidney, { clearcoat: 0.8 }), ab, 'kidney');
    k.position.set(s * 1.22, s > 0 ? -1.35 : -1.6, -1.12); k.rotation.z = -s * 0.15;
    kidneyPos.push(k.position.clone());
    add(new THREE.ConeGeometry(0.2, 0.3, 16), OrganMat(palette.adrenal), ab).position.set(s * 1.15, (s > 0 ? -1.35 : -1.6) + 0.78, -1.1);
  }
  ctx.anchors.kidneyPos = kidneyPos;
}
export function update(f, t, phys) {}
