// organs/liver.js — liver (states A/B with fatty-liver vertex colours), falciform ligament, gallbladder.
import { THREE, P, clamp, smooth, gauss, noise3, deform, vtube, add, LAYER } from '../core/ctx.js';
import { palette, OrganMat, liverVeinTex } from '../core/style.js';

const liverPos = P(-0.55, -0.3, 0.25);
function liverShape(v) {
  v.x *= 2.2; v.y *= 1.18; v.z *= 1.5;
  const t = (v.x + 2.2) / 4.4;                                       // 0 = patient's right edge … 1 = left tip
  v.y *= 1 - 0.62 * smooth(0.32, 1, t); v.z *= 1 - 0.3 * smooth(0.45, 1, t);
  if (v.y < 0) v.y *= 0.42;
  v.y -= 0.18 * smooth(0, 1.4, v.z) * (v.y < 0 ? 1 : 0.3);
  const fis = gauss(t, 0.63, 0.035) * smooth(0.1, 1.1, v.z);          // falciform groove
  v.y -= 0.14 * fis * (v.y > 0 ? 1 : 0.4); v.z *= 1 - 0.04 * fis;
  v.multiplyScalar(1 + 0.012 * noise3(v.x * 4, v.y * 4, v.z * 4));
}

let C, geoA, geoB, noise, lastA = -1, lastB = -1;
const cHealthy = new THREE.Color(palette.liverHealthy), cFatty = new THREE.Color(palette.liverFatty), cSpots = new THREE.Color(palette.liverSpots);

/** paint fatty-liver colours: f' = f^1.35 -> pale, blotchy */
function paint(geo, f) {
  const col = geo.attributes.color, c = new THREE.Color();
  for (let i = 0; i < noise.length; i++) {
    const n = noise[i];
    c.copy(cHealthy).lerp(cFatty, clamp(f * 0.85 + n * 0.25 * f, 0, 1));
    if (n > 0.35) c.lerp(cSpots, clamp((n - 0.35) * 2.2 * f, 0, 0.8));
    c.multiplyScalar(0.92 + 0.12 * n);
    col.setXYZ(i, c.r, c.g, c.b);
  }
  col.needsUpdate = true;
}

export function build(ctx) {
  C = ctx;
  const ab = ctx.groups.abdomen;
  geoA = deform(new THREE.SphereGeometry(1, 110, 80), liverShape);
  const pos = geoA.attributes.position; noise = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++)
    noise[i] = noise3(pos.getX(i) * 6.3, pos.getY(i) * 6.3, pos.getZ(i) * 6.3) * 0.5 + 0.5 * noise3(pos.getX(i) * 15, pos.getY(i) * 15, pos.getZ(i) * 15);
  geoA.setAttribute('color', new THREE.BufferAttribute(new Float32Array(noise.length * 3), 3));
  geoB = geoA.clone(); geoB.setAttribute('color', new THREE.BufferAttribute(new Float32Array(noise.length * 3), 3));
  const mat = OrganMat(0xffffff, { vertexColors: true, roughness: 0.32, clearcoat: 0.9, clearcoatRoughness: 0.18, map: liverVeinTex, sheenColor: new THREE.Color(palette.liverSheen), emissiveIntensity: 0 });
  const A = add(geoA, mat, ab, 'liver'); A.position.copy(liverPos); A.rotation.z = 0.07; A.layers.set(LAYER.A);
  const B = add(geoB, mat, ab); B.position.copy(liverPos); B.rotation.z = 0.07; B.layers.set(LAYER.B);

  /* falciform ligament */
  const lig = add(vtube([P(0.55, 0.72, -0.5), P(0.56, 0.62, 0.2), P(0.55, 0.3, 0.9), P(0.53, -0.05, 1.28)], () => 0.06, 40, 8),
    OrganMat(palette.ligament, { transparent: true, opacity: 0.85, roughness: 0.5, sheen: 0 }), ab, 'liver');
  lig.scale.set(0.35, 1, 1); lig.position.copy(liverPos); lig.rotation.z = 0.07;
  /* gallbladder */
  const gb = new THREE.SphereGeometry(1, 32, 24); gb.scale(0.22, 0.42, 0.22);
  const gbm = add(gb, OrganMat(palette.gallbladder, { clearcoat: 0.95, roughness: 0.22 }), ab, 'liver');
  gbm.position.set(-0.78, -0.78, 1.05); gbm.rotation.x = 0.7;
  ctx.anchors.liverPos = liverPos;
}

export function update(f, t, phys) {
  if (Math.abs(f - lastA) > 1e-4) { paint(geoA, Math.pow(f, 1.35)); lastA = f; }
  if (C.state.bVersion !== lastB) { paint(geoB, Math.pow(C.state.fB, 1.35)); lastB = C.state.bVersion; }
}
