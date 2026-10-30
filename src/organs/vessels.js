// organs/vessels.js — aorta (arch + branches), pulmonary trunk, caval veins, pulmonary veins, moving blood cells.
import { THREE, P, vtube, add } from '../core/ctx.js';
import { palette, OrganMat } from '../core/style.js';

const N_CELLS = 46;
let cells, aortaCurve, dummy;

export function build(ctx) {
  const V = ctx.groups.vessels; dummy = ctx.dummy;
  const aortaMat = OrganMat(palette.aorta, { roughness: 0.3, clearcoat: 0.9, bumpScale: 0.3 });
  const pulmMat = OrganMat(palette.pulmArtery, { roughness: 0.32, clearcoat: 0.85, bumpScale: 0.3 });
  const veinMat = OrganMat(palette.vein, { roughness: 0.32, clearcoat: 0.8, bumpScale: 0.3 });
  /* aorta: ascending -> arch -> descending thoracic -> abdominal */
  const aorta = vtube([P(0.28, 2, 0.42), P(0.2, 2.8, 0.42), P(0.35, 3.35, 0.15), P(0.72, 3.3, -0.5), P(0.72, 2.8, -1), P(0.5, 1.5, -1.12), P(0.32, -0.6, -1.12), P(0.2, -2.6, -1.08), P(0.05, -3.4, -1)], (u) => 0.27 - 0.07 * u, 260, 20);
  add(aorta, aortaMat, V, 'aorta'); aortaCurve = aorta.userData.curve;
  add(vtube([P(0.22, 3.3, 0.25), P(-0.15, 3.9, 0.35), P(-0.42, 4.6, 0.4)], (u) => 0.115 - 0.02 * u, 40, 10), aortaMat, V);   // brachiocephalic
  add(vtube([P(0.42, 3.38, 0), P(0.5, 4, 0.1), P(0.55, 4.7, 0.15)], () => 0.08, 40, 10), aortaMat, V);                        // left common carotid
  add(vtube([P(0.66, 3.32, -0.3), P(1.3, 3.75, -0.25), P(2.3, 3.8, -0.1)], () => 0.085, 40, 10), aortaMat, V);                 // left subclavian
  /* pulmonary trunk + branches */
  add(vtube([P(0.14, 1.85, 1.02), P(0.25, 2.25, 0.78), P(0.42, 2.5, 0.4)], (u) => 0.19 - 0.02 * u, 50, 14), pulmMat, V, 'heart');
  add(vtube([P(0.42, 2.5, 0.4), P(1, 2.45, 0.1), P(1.5, 2.3, -0.1)], () => 0.115, 40, 10), pulmMat, V);
  add(vtube([P(0.42, 2.5, 0.4), P(-0.2, 2.42, 0.15), P(-0.85, 2.3, 0)], () => 0.115, 40, 10), pulmMat, V);
  /* superior vena cava + brachiocephalic veins, inferior vena cava */
  add(vtube([P(-0.37, 2.7, 0.42), P(-0.38, 2.2, 0.55), P(-0.37, 1.85, 0.62)], () => 0.19, 40, 14), veinMat, V);
  add(vtube([P(-1.25, 3.35, 0.15), P(-0.6, 3, 0.32), P(-0.37, 2.72, 0.42)], () => 0.12, 40, 10), veinMat, V);
  add(vtube([P(0.95, 3.3, 0.2), P(0.1, 2.98, 0.35), P(-0.33, 2.74, 0.42)], () => 0.11, 40, 10), veinMat, V);
  add(vtube([P(-0.36, 1.35, 0.42), P(-0.4, 0.4, -0.3), P(-0.38, -0.8, -0.9), P(-0.35, -2.4, -0.95), P(-0.3, -3.4, -0.9)], () => 0.22, 90, 16), veinMat, V);
  /* pulmonary veins into the left atrium */
  add(vtube([P(1.5, 2, 0), P(0.95, 2.05, 0.05), P(0.6, 2.05, 0.08)], () => 0.07, 24, 8), OrganMat(palette.pulmVein), V);
  add(vtube([P(-0.75, 2, -0.05), P(-0.1, 2.05, 0.02), P(0.25, 2.06, 0.05)], () => 0.07, 24, 8), OrganMat(palette.pulmVein), V);
  /* blood cells streaming down the aorta */
  cells = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 10, 8),
    new THREE.MeshBasicMaterial({ color: palette.bloodCell, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }), N_CELLS);
  V.add(cells);
  ctx.anchors.aortaCurve = aortaCurve;
}

export function update(f, t, phys) {
  const l = phys.ventricularPulse;
  for (let i = 0; i < N_CELLS; i++) {
    const u = (t * 0.1 + 0.012 * Math.sin(t * 2) + i / N_CELLS + 0.02 * l) % 1;
    aortaCurve.getPointAt(u, dummy.position);
    dummy.scale.setScalar(0.7 + 0.8 * l); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
    cells.setMatrixAt(i, dummy.matrix);
  }
  cells.instanceMatrix.needsUpdate = true;
}
