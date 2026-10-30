// core/ctx.js — scene, camera, lights, renderer, composer, shared state and geometry utilities.
// Every organ module receives this ctx object in build(ctx). Nothing here knows about any organ.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { LIGHTS, RENDER } from './style.js';

export { THREE };

/* ---------- tiny math / dom helpers ---------- */
export const $ = (id) => document.getElementById(id);
export const P = (x, y, z) => new THREE.Vector3(x, y, z);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const gauss = (x, c, w) => Math.exp(-(((x - c) / w) ** 2));
export const noise3 = (x, y, z) =>
  (Math.sin(x * 1.7 + y * 3.1) * Math.sin(y * 2.3 + z * 1.3) * Math.sin(z * 2.9 + x * 0.7) +
    0.5 * Math.sin(x * 4.1 - z * 3.7 + y * 2.2)) / 1.5;

/* deterministic PRNG (Park–Miller). Reseed with setSeed() so layouts are stable. */
let seed = 12345;
export const rnd = () => (seed = (seed * 16807) % 2147483647, (seed - 1) / 2147483646);
export const setSeed = (s) => { seed = s; };

/* ---------- geometry helpers ---------- */
/** Displace every vertex of geo in place with fn(v: Vector3). Recomputes normals. */
export function deform(geo, fn) {
  const pos = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i); fn(v); pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Variable-radius tube along a Catmull-Rom curve through pts. rFn(u) gives radius at u∈[0,1]. */
export function vtube(pts, rFn, segs = 200, radial = 24, tension = 0.5) {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', tension);
  const geo = new THREE.TubeGeometry(curve, segs, 1, radial, false);
  const pos = geo.attributes.position, v = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const u = i / segs; curve.getPointAt(u, c); const r = rFn(u);
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, k); v.sub(c).multiplyScalar(r).add(c); pos.setXYZ(k, v.x, v.y, v.z);
    }
  }
  geo.computeVertexNormals();
  geo.userData.curve = curve;
  return geo;
}

/** Create a Mesh, add it to parent (default: scene), tag it with userData.key for picking. */
export function add(geo, mat, parent, key) {
  const m = new THREE.Mesh(geo, mat);
  (parent || ctx.scene).add(m);
  if (key) m.userData.key = key;
  return m;
}

/* ---------- layers contract ----------
 * layer 0 : static organs, visible in both halves of the split view
 * layer 1 : state "A" = AFTER weight loss (live slider value)   -> left half
 * layer 2 : state "B" = BEFORE / today                           -> right half
 */
export const LAYER = { STATIC: 0, A: 1, B: 2 };

/* ---------- renderer / scene ---------- */
const viewer = $('viewer');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
} catch (e) {
  $('loading').textContent = 'جهازك ما بيدعم الرسم ثلاثي الأبعاد (WebGL)';
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = RENDER.exposure;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.localClippingEnabled = true;
viewer.prepend(renderer.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
camera.position.set(0, 0.2, 20);
camera.layers.enable(LAYER.A);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 4;
controls.maxDistance = 30;
controls.target.set(0, -0.1, 0);
controls.autoRotate = true;
controls.autoRotateSpeed = 0.55;

const hemi = new THREE.HemisphereLight(LIGHTS.hemiSky, LIGHTS.hemiGround, LIGHTS.hemi);
scene.add(hemi);
const dirLights = LIGHTS.dir.map((L) => {
  const d = new THREE.DirectionalLight(L.color, L.intensity);
  d.position.set(...L.pos); d.userData.base = { color: d.color.clone(), intensity: L.intensity };
  scene.add(d); return d;
});
/** night (sleep scene) lighting: dim, blue-tinted. k = 0 day … 1 night. */
function setNight(k) {
  const n = Math.max(0, Math.min(1, k));
  hemi.intensity = LIGHTS.hemi * (1 - 0.6 * n);
  hemi.color.set(LIGHTS.hemiSky).lerp(new THREE.Color(LIGHTS.nightSky), n);
  dirLights.forEach((d) => { d.intensity = d.userData.base.intensity * (1 - 0.65 * n); d.color.copy(d.userData.base.color).lerp(new THREE.Color(LIGHTS.nightKey), n); });
  renderer.toneMappingExposure = RENDER.exposure * (1 - 0.35 * n);
}

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), RENDER.bloomStrength, RENDER.bloomRadius, RENDER.bloomThreshold);
composer.addPass(bloom);
composer.addPass(new OutputPass());

/* ---------- display groups (toggled by the chips) ---------- */
const groups = {
  skin: new THREE.Group(), bones: new THREE.Group(), lungs: new THREE.Group(),
  airway: new THREE.Group(), abdomen: new THREE.Group(), vessels: new THREE.Group(), heart: new THREE.Group(),
};
Object.values(groups).forEach((g) => scene.add(g));

/* ---------- shared state ----------
 * fCur  : live visceral-fat fraction 0..1 of state A (follows the slider, eased)
 * fTgt  : slider target for fCur
 * body  : live torso parameters of state A   { W, Wz, d, bulge }
 * bodyB : "today" torso parameters (state B) ; fB its fat fraction ; bVersion bumps whenever B changes
 */
const state = {
  complaint: 'belly', sex: 'm', mode: 'normal',
  fCur: -1, fTgt: 0.5,
  body: { W: 2.6, Wz: 1.8, d: 0.2, bulge: 0.2 },
  bodyTgt: { W: 2.6, Wz: 1.8, d: 0.2, bulge: 0.2 },
  fB: 0.5, bodyB: { W: 2.6, Wz: 1.8, d: 0.2, bulge: 0.2 }, bVersion: 0,
  showLabels: true, focusKey: null, kgLoss: 0,
  perf: 2,                 // 2 = full quality, 1 = reduced DPR, 0 = minimum (bloom off)
};

/* anchors: anatomical reference data organs publish for others (positions, curves, surfaces) */
const anchors = {};

export const ctx = {
  THREE, renderer, scene, camera, controls, composer, bloom, viewer, groups, state, anchors, LAYER,
  $, P, clamp, lerp, smooth, gauss, noise3, rnd, setSeed, deform, vtube, add,
  dummy: new THREE.Object3D(),       // scratch Object3D for instanced matrices
  lights: { hemi, dir: dirLights }, setNight,
};
export default ctx;
