// organs/body.js — torso shell (skin 110x80 + subcutaneous fat volume and fascia shells 72x56, states A/B) and the skeleton.
// Publishes ctx.anchors.torsoRadii(y, W, Wz, inset) for the cross-section drawing,
// ctx.anchors.innerWallZ(y, x, body) (anterior z of the inner fascia shell, exact) and
// ctx.anchors.wallSampler(body) (fast table-based (y, x) -> z of the same shell for per-frame use).
import { THREE, P, clamp, lerp, smooth, deform, vtube, add, LAYER } from '../core/ctx.js';
import { palette, mats } from '../core/style.js';

const ROWS = 110, COLS = 80, Y0 = -4.9, Y1 = 5.4;      // skin grid
const ROWS_I = 72, COLS_I = 56;                            // inner shells (fat volume / fascia): same parametrisation, cheaper

/** [y, halfWidthX, halfDepthZ] control rows of the torso. W/Wz = belly radii. */
export function torsoProfile(W, Wz) {
  return [[-4.9, 2.95, 1.9], [-4.1, 3.2, 2.05], [-3.2, 3.05, 2], [-2, W, Wz],
    [-0.8, lerp(W, 2.9, 0.6), lerp(Wz, 1.95, 0.6)], [0.4, 2.9, 1.95], [1.8, 3, 2], [3, 3.35, 1.85],
    [3.75, 3.6, 1.55], [4.15, 2.5, 1.2], [4.45, 1, 0.92], [5.4, 0.92, 0.88]];
}
/* the profile table is memoised on (W, Wz): callers sample it thousands of times per frame */
let _pW = NaN, _pWz = NaN, _pTab = null;
function profileFor(W, Wz) {
  if (W !== _pW || Wz !== _pWz) { _pTab = torsoProfile(W, Wz); _pW = W; _pWz = Wz; }
  return _pTab;
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
  const p = profileFor(W, Wz);
  return [Math.max(0.3, sample(p, y, 1) - inset), Math.max(0.3, sample(p, y, 2) - inset)];
}

/** anterior belly protrusion factor at height y (multiplies the front half-depth). Equals `bulge` at y = -2
 *  (cross-section contract). Above bulge ≈ 0.2 a lower-abdomen panniculus develops: the apex sags, a second
 *  lobe appears over the groin and a crease folds under it. The crease is shallow enough that the factor
 *  never goes negative (purely additive overhang). */
export function bellyBulge(y, bulge) {
  const ov = smooth(0.18, 0.36, bulge);
  const shape = (yy) => {
    const yc = -2 - 0.3 * ov, w = yy > yc ? 1.5 + 0.25 * ov : 1.25;
    return Math.exp(-(((yy - yc) / w) ** 2)) + ov * (0.62 * Math.exp(-(((yy + 3.2) / 0.5) ** 2)) - 0.26 * Math.exp(-(((yy + 3.9) / 0.26) ** 2)));
  };
  return bulge * Math.max(0, shape(y)) / shape(-2);
}
/** z of the inner fascia shell (inset by body.d) at height y and lateral position x, anterior side (exact). */
export function innerWallZ(y, x, b) {
  const [rx, rz] = torsoRadii(y, b.W, b.Wz, b.d);
  const cz = Math.sqrt(Math.max(0, 1 - (x / rx) ** 2));
  return rz * cz * (1 + bellyBulge(y, b.bulge) * Math.pow(cz, 1.6)) - 0.05;
}
/** Fast sampler of innerWallZ for one body: a per-row table of (rx, rz, bellyBulge) over y0..y1 is built once
 *  (3 profile samples per row), then wall(y, x) costs a lerp, a sqrt and a pow. Error vs innerWallZ < 0.01. */
export function wallSampler(b, y0 = -4.9, y1 = 1.4, rows = 84) {
  const prof = profileFor(b.W, b.Wz), rx = new Float32Array(rows + 1), rz = new Float32Array(rows + 1), bb = new Float32Array(rows + 1);
  for (let i = 0; i <= rows; i++) {
    const y = lerp(y0, y1, i / rows);
    rx[i] = Math.max(0.3, sample(prof, y, 1) - b.d); rz[i] = Math.max(0.3, sample(prof, y, 2) - b.d); bb[i] = bellyBulge(y, b.bulge);
  }
  const k = rows / (y1 - y0);
  return (y, x) => {
    const t = clamp((y - y0) * k, 0, rows), i = t | 0, j = i < rows ? i + 1 : i, h = t - i;
    const RX = rx[i] + (rx[j] - rx[i]) * h, RZ = rz[i] + (rz[j] - rz[i]) * h, B = bb[i] + (bb[j] - bb[i]) * h;
    const q = x / RX, cz = q * q >= 1 ? 0 : Math.sqrt(1 - q * q);
    return RZ * cz * (1 + B * Math.pow(cz, 1.6)) - 0.05;
  };
}

/* ---------- torso grid: 3 shells per state (skin 110x80 / fat volume 72x56 / fascia 72x56), each with grid normals ---------- */
function trig(cols) {
  const COS = new Float32Array(cols + 1), SIN = new Float32Array(cols + 1), CZP = new Float32Array(cols + 1);   // per-column trig
  for (let c = 0; c <= cols; c++) { const a = c / cols * Math.PI * 2; COS[c] = Math.cos(a); SIN[c] = Math.sin(a); CZP[c] = Math.pow(Math.max(0, COS[c]), 1.6); }
  return { COS, SIN, CZP };
}
const TRIG = { [COLS]: trig(COLS), [COLS_I]: trig(COLS_I) };
const SPHERE = new THREE.Sphere(P(0, 0.25, 0), 7.5);     // conservative bounds (never recomputed)

function makeTorsoGeo(rows, cols) {
  const g = new THREE.BufferGeometry(), n = (rows + 1) * (cols + 1);
  const pos = new THREE.BufferAttribute(new Float32Array(n * 3), 3), nor = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
  pos.setUsage(THREE.DynamicDrawUsage); nor.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', pos); g.setAttribute('normal', nor);
  const idx = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const a = r * (cols + 1) + c, b = a + cols + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  g.setIndex(idx);
  g.boundingSphere = SPHERE.clone();
  return { geo: g, rows, cols, pos: pos.array, nor: nor.array };
}
/** lay one shell (inset from the profile) and its grid normals (closed around the circumference) */
function layShell(S, prof, inset, bulge) {
  const { rows, cols, pos, nor } = S, { COS, SIN, CZP } = TRIG[cols], W1 = cols + 1;
  for (let r = 0; r <= rows; r++) {
    const y = lerp(Y0, Y1, r / rows), rx = Math.max(0.3, sample(prof, y, 1) - inset), rz = Math.max(0.3, sample(prof, y, 2) - inset), u = bellyBulge(y, bulge);
    for (let c = 0; c <= cols; c++) {
      const i = (r * W1 + c) * 3;
      pos[i] = rx * SIN[c]; pos[i + 1] = y; pos[i + 2] = rz * COS[c] * (1 + u * CZP[c]) - 0.05;
    }
  }
  for (let r = 0; r <= rows; r++) {
    const r0 = Math.max(0, r - 1) * W1, r1 = Math.min(rows, r + 1) * W1;
    for (let c = 0; c <= cols; c++) {
      const c0 = c === 0 ? cols - 1 : c - 1, c1 = c === cols ? 1 : c + 1;                 // closed around
      const a = (r * W1 + c1) * 3, b = (r * W1 + c0) * 3, dn = (r1 + c) * 3, up = (r0 + c) * 3;
      const cx = pos[a] - pos[b], cy = pos[a + 1] - pos[b + 1], cz = pos[a + 2] - pos[b + 2];
      const rxv = pos[dn] - pos[up], ryv = pos[dn + 1] - pos[up + 1], rzv = pos[dn + 2] - pos[up + 2];
      let nx = cy * rzv - cz * ryv, ny = cz * rxv - cx * rzv, nz = cx * ryv - cy * rxv;       // cross(dC, dR) -> outward
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      const i = (r * W1 + c) * 3; nor[i] = nx / l; nor[i + 1] = ny / l; nor[i + 2] = nz / l;
    }
  }
  S.geo.attributes.position.needsUpdate = true; S.geo.attributes.normal.needsUpdate = true;
}
/** lay one state's three shells (insets 0, d/2, d) */
function layState(S, W, Wz, bulge, d) {
  const prof = profileFor(W, Wz);
  layShell(S.skin, prof, 0, bulge); layShell(S.vol, prof, d * 0.5, bulge); layShell(S.fas, prof, d, bulge);
  S.volMat.uniforms.d.value = d;
}

/** Subcutaneous fat volume: a thickness-tinted, marbled translucent shell placed in the middle of the fat
 *  layer. Opacity is rim-weighted (fresnel): nearly clear face-on so the organs behind it are not washed out in
 *  close-ups, growing with thickness d and nearly opaque at grazing angles so the layer reads as a real yellow
 *  band under the skin at the silhouette. Needs a shader (thickness + marbling). */
function subcutVolumeMat() {
  return new THREE.ShaderMaterial({
    clipping: true,
    uniforms: {
      cLight: { value: new THREE.Color(palette.subcutFat) }, cDeep: { value: new THREE.Color(palette.fatLobules[4]) },
      cSepta: { value: new THREE.Color(palette.fatSheen) }, d: { value: 0.2 },
    },
    vertexShader: `#include <common>
      #include <clipping_planes_pars_vertex>
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ vec4 mvPosition = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mvPosition.xyz); vP = position; gl_Position = projectionMatrix*mvPosition;
      #include <clipping_planes_vertex>
      }`,
    fragmentShader: `#include <clipping_planes_pars_fragment>
      uniform vec3 cLight; uniform vec3 cDeep; uniform vec3 cSepta; uniform float d;
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      float hash(vec3 p){ p = fract(p*0.3183099+vec3(0.1,0.2,0.3)); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      float vnoise(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
        return mix(mix(mix(hash(i),hash(i+vec3(1.0,0.0,0.0)),f.x),mix(hash(i+vec3(0.0,1.0,0.0)),hash(i+vec3(1.0,1.0,0.0)),f.x),f.y),
                   mix(mix(hash(i+vec3(0.0,0.0,1.0)),hash(i+vec3(1.0,0.0,1.0)),f.x),mix(hash(i+vec3(0.0,1.0,1.0)),hash(i+vec3(1.0,1.0,1.0)),f.x),f.y),f.z); }
      void main(){
        #include <clipping_planes_fragment>
        float nv = abs(dot(normalize(vN), normalize(vV)));
        float fr = pow(1.0 - nv, 1.8);
        float m = vnoise(vP*2.6) * 0.55 + vnoise(vP*6.5) * 0.3 + vnoise(vP*14.0) * 0.15;   // lobulated marbling
        float septa = smoothstep(0.50, 0.55, m) * (1.0 - smoothstep(0.55, 0.61, m));        // pale fibrous septa
        float th = clamp(d * 1.8, 0.0, 1.0);
        vec3 col = mix(cLight, cDeep, th * 0.65);
        col = mix(col, cSepta, septa * 0.4 + 0.08 * m);
        col *= 0.8 + 0.8 * fr;
        float aFace = (0.01 + 0.05 * d) * (0.65 + 0.7 * m);                                  // nearly clear face-on …
        float aEdge = clamp(0.25 + 1.1 * d, 0.0, 0.8);                                         // … a solid yellow band at the rim
        gl_FragColor = vec4(col, aFace + aEdge * fr);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
}

let C, stA, stB, boneMat, cartMat, lastA = null, lastB = -1, lastT = 0;

/** one state's shells: skin (render order 10) > fat volume (9) > fascia (8), all on `layer` */
function makeState(layer, skinMat, fatMat, groups) {
  const skin = makeTorsoGeo(ROWS, COLS), vol = makeTorsoGeo(ROWS_I, COLS_I), fas = makeTorsoGeo(ROWS_I, COLS_I);
  const volMat = subcutVolumeMat();
  const s = add(skin.geo, skinMat, groups.skin, 'skin'); s.renderOrder = 10; s.layers.set(layer);
  const v = add(vol.geo, volMat, groups.skin, 'skin'); v.renderOrder = 9; v.layers.set(layer);
  const f = add(fas.geo, fatMat, groups.skin, 'skin'); f.renderOrder = 8; f.layers.set(layer);
  return { skin, vol, fas, volMat };
}

export function build(ctx) {
  C = ctx;
  const { groups } = ctx;
  const skinMat = mats.skin(), fatMat = mats.subcutFat();
  stA = makeState(LAYER.A, skinMat, fatMat, groups);
  stB = makeState(LAYER.B, skinMat, fatMat, groups);
  ctx.anchors.torsoRadii = torsoRadii;
  ctx.anchors.innerWallZ = innerWallZ;
  ctx.anchors.wallSampler = wallSampler;
  ctx.anchors.bellyBulge = bellyBulge;

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
  if (key !== lastA) { layState(stA, b.W, b.Wz, b.bulge, b.d); lastA = key; }          // state A follows the eased live parameters
  if (st.bVersion !== lastB) { const q = st.bodyB; layState(stB, q.W, q.Wz, q.bulge, q.d); lastB = st.bVersion; }   // state B = today
  const dt = Math.min(Math.max(t - lastT, 0), 0.4); lastT = t;
  const s = 1 - Math.exp(-dt * 3.2);
  boneMat.opacity = lerp(boneMat.opacity, st.opTarget.bone, s);
  cartMat.opacity = boneMat.opacity * 0.75;
}
