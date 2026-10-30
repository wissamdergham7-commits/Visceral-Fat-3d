// organs/digestive.js — stomach, duodenum, pancreas, spleen, colon (haustra + taeniae + appendix),
// small intestine with a peristalsis vertex shader. Publishes anchors.colonCurve / anchors.siCurve.
import { THREE, P, lerp, rnd, setSeed, deform, vtube, add } from '../core/ctx.js';
import { palette, OrganMat, gutVeinTex } from '../core/style.js';

let siShader = null;

export function build(ctx) {
  const ab = ctx.groups.abdomen;
  /* stomach: oesophageal end -> fundus/body -> antrum/pylorus */
  add(vtube([P(0.35, 0.7, -0.35), P(0.8, 0.15, -0.2), P(1.4, -0.1, 0.1), P(1.65, -0.65, 0.45), P(1.25, -1.12, 0.85), P(0.45, -1.05, 0.95), P(-0.25, -0.72, 0.75)],
    (u) => u < 0.12 ? lerp(0.17, 0.6, u / 0.12) : u < 0.55 ? 0.66 + 0.08 * Math.sin(u * 6) : lerp(0.62, 0.2, (u - 0.55) / 0.45), 160, 28),
    OrganMat(palette.stomach, { map: gutVeinTex, sheenColor: new THREE.Color(palette.stomachSheen) }), ab, 'stomach');
  /* duodenal C-loop */
  add(vtube([P(-0.25, -0.72, 0.75), P(-0.85, -0.9, 0.42), P(-0.98, -1.5, 0.1), P(-0.42, -1.78, -0.02), P(0.42, -1.55, -0.12)], () => 0.19, 80, 14),
    OrganMat(palette.duodenum, { map: gutVeinTex }), ab, 'si');
  /* pancreas: head (in the C-loop) -> body -> tail to the spleen */
  add(vtube([P(-0.7, -1.32, -0.25), P(0.2, -1.05, -0.48), P(1.2, -0.78, -0.62), P(1.95, -0.5, -0.72)], (u) => (0.3 - 0.16 * u) * (1 + 0.1 * Math.sin(u * 70)), 90, 14),
    OrganMat(palette.pancreas, { roughness: 0.55 }), ab);
  /* spleen */
  { const g = deform(new THREE.SphereGeometry(1, 40, 30), (v) => { v.x *= 0.45; v.y *= 0.88; v.z *= 0.3; v.x += 0.12 * v.y * v.y; });
    const m = add(g, OrganMat(palette.spleen, { clearcoat: 0.7 }), ab, 'spleen'); m.position.set(2.2, -0.3, -0.78); m.rotation.y = 0.6; }

  /* colon: caecum -> ascending (patient right = -x) -> transverse -> descending -> sigmoid -> rectum */
  const colonGeo = vtube([P(-1.85, -3.2, 0.45), P(-2, -2.4, 0.6), P(-1.95, -1.5, 0.72), P(-0.9, -1.72, 1.15), P(0.5, -1.8, 1.15), P(1.9, -1.15, 0.6), P(2.08, -2.2, 0.45), P(1.95, -3.2, 0.42), P(1, -3.6, 0.72), P(0.2, -3.45, 0.3), P(0, -4, -0.6)],
    (u) => 0.37 * (1 + 0.14 * Math.sin(u * Math.PI * 2 * 34)) * (u > 0.85 ? lerp(1, 0.75, (u - 0.85) / 0.15) : 1), 520, 22);
  add(colonGeo, OrganMat(palette.colon, { map: gutVeinTex, sheenColor: new THREE.Color(palette.colonSheen) }), ab, 'colon');
  const colonCurve = colonGeo.userData.curve;
  { // three taeniae coli
    const up = new THREE.Vector3(0.3, 1, 0.2).normalize(), p = new THREE.Vector3(), tg = new THREE.Vector3(), n = new THREE.Vector3(), b = new THREE.Vector3();
    for (const ang of [0.5, 2.6, 4.6]) {
      const pts = [];
      for (let i = 0; i <= 90; i++) {
        const u = i / 90 * 0.84;
        colonCurve.getPointAt(u, p); colonCurve.getTangentAt(u, tg); n.crossVectors(tg, up).normalize(); b.crossVectors(tg, n).normalize();
        pts.push(p.clone().add(n.clone().multiplyScalar(Math.cos(ang) * 0.36)).add(b.clone().multiplyScalar(Math.sin(ang) * 0.36)));
      }
      add(vtube(pts, () => 0.045, 180, 6, 0.3), OrganMat(palette.taenia, { roughness: 0.45 }), ab, 'colon');
    }
  }
  add(vtube([P(-1.85, -3.3, 0.45), P(-1.65, -3.75, 0.55), P(-1.4, -3.85, 0.4)], () => 0.06, 20, 8), OrganMat(palette.appendix), ab, 'colon');

  /* small intestine: 15 back-and-forth loops in 3 depth planes, jittered */
  setSeed(2001);
  const pts = [P(0.42, -1.55, -0.12), P(0.9, -1.95, 0.2)];
  { let dir = 1; const depth = [0.82, 0.38, -0.06];
    for (let e = 0; e < 3; e++) for (let n = 0; n < 5; n++) {
      const y = -2.05 - n * 0.33 - (e % 2 ? 0.16 : 0);
      for (let r = 0; r <= 8; r++) {
        const o = r / 8, x = dir > 0 ? -1.3 + 2.6 * o : 1.3 - 2.6 * o;
        pts.push(P(x * (1 - 0.12 * Math.abs(n - 2) / 2) + (rnd() - 0.5) * 0.14,
          y + 0.1 * Math.sin(o * Math.PI * 3 + n + e) + (rnd() - 0.5) * 0.1,
          depth[e] + 0.12 * Math.cos(o * Math.PI * 4 + n) + (rnd() - 0.5) * 0.1));
      }
      dir *= -1;
    }
    pts.push(P(-1.5, -3.25, 0.3), P(-1.8, -3.15, 0.42)); }
  const siMat = OrganMat(palette.smallBowel, { roughness: 0.36, clearcoat: 0.75, map: gutVeinTex, sheenColor: new THREE.Color(palette.smallBowelSheen) });
  siMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = { value: 0 }; siShader = sh;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normal * 0.016 * sin(position.x*7.0 + position.y*5.0 + uTime*2.2);');
  };
  const siGeo = vtube(pts, () => 0.155, 1500, 12, 0.5);
  add(siGeo, siMat, ab, 'si');
  Object.assign(ctx.anchors, { colonCurve, siCurve: siGeo.userData.curve });
}

export function update(f, t, phys) {
  if (siShader) siShader.uniforms.uTime.value = t;
}
