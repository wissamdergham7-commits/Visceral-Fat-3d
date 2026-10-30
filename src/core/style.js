// core/style.js — THE single style contract. Palette, materials, procedural textures, light & render params.
// Rule: no organ module may define a raw colour or a material outside this file's helpers.
import * as THREE from 'three';

/* ---------- palette (hex) ---------- */
export const palette = {
  // body shell
  skin: 0xF3C4A8, subcutFat: 0xFFC23D, bone: 0xE9DCC4, cartilage: 0xCFDBE0,
  // heart
  heart: 0xA8202F, atrium: 0x8E2531, coronaryArtery: 0xD8343F, coronaryVein: 0x3D5FA8,
  // great vessels
  aorta: 0xC3283A, pulmArtery: 0x4A5FB0, vein: 0x3E63B3, pulmVein: 0x8C2F3F, bloodCell: 0xFFB3BD,
  // respiratory
  trachea: 0xEADBD0, lung: 0xE78F98, lungSheen: 0xFFC8CF, diaphragm: 0xB4544A,
  // liver family
  liverHealthy: 0x6B1F19, liverFatty: 0xC98C4E, liverSpots: 0xF0CF8A, liverSheen: 0xFFC9A8,
  ligament: 0xE8E2D6, gallbladder: 0x6C8D2C,
  // digestive
  stomach: 0xE3907C, stomachSheen: 0xFFC4B4, duodenum: 0xE8AB96, pancreas: 0xE6BD8C, spleen: 0x6A2141,
  colon: 0xC8836A, colonSheen: 0xFFC8B0, taenia: 0xDAA78C, appendix: 0xD99A82,
  smallBowel: 0xEAA597, smallBowelSheen: 0xFFD2C8,
  // urinary
  kidney: 0x8C2F2A, adrenal: 0xD9A03E,
  // fat
  fatLobules: [0xF6C443, 0xF9D264, 0xEFB431, 0xFBDC7A, 0xE9A92A],
  fatSheen: 0xFFF2A8, fatEmissive: 0x5A3A00, omentumPlate: 0xF1CF7F, omentumSheen: 0xFFF2B8, omentumVessel: 0xB23040,
  // generic tissue vessels
  tissueVein: 0x7a1020, liverVeinTex: 0x4a1410, gutVeinTex: 0x8a2a20,
  // heart interior (visible on zoom / cut-away)
  endocardium: 0xC46A74, myocardium: 0x9E2C38, septum: 0x8A2430, valveLeaflet: 0xF3E6DC, valveAnnulus: 0xD9B9AA,
  chordae: 0xEDE3DA, papillary: 0xB03A46,
  // blood: oxygen-rich -> oxygen-poor (sleep / apnea desaturation)
  bloodOxy: 0xE0303C, bloodDeoxy: 0x6A2F8C, bloodCellDeoxy: 0xB89CFF,
  // airway family
  pharynxMucosa: 0xE8A1A3, tongue: 0xD9777E, uvula: 0xE39599, epiglottis: 0xE7B6A6, larynx: 0xE2D4C8,
  trachealRing: 0xEFE6DC, bronchusWall: 0xE6CFC4, neckFat: 0xF7CF5A, headSkin: 0xF3C4A8, cartilageRing: 0xD8E0E3,
  // lungs
  lungApex: 0xF2A3AB, lungBase: 0xD67A86, pleura: 0xFFE2E6, fissure: 0xC06470,
  // liver interior
  portalVein: 0x5B4A9E, hepaticVein: 0x4C63B0, hepaticArtery: 0xC4343F, bileDuct: 0x7FA33A, liverFattySheen: 0xFFE6B0,
  // digestive details
  rugae: 0xD88470, stomachInner: 0xE2A28F, pancreasHead: 0xE4C08E, pancreasTail: 0xDDB27A, splenicVein: 0x5B4A9E,
  // kidney interior
  renalCortex: 0x9C3A33, renalMedulla: 0x7A2A26, renalPyramid: 0x8C3630, renalPelvis: 0xEADFCC, ureter: 0xE8D8C4, renalCapsuleFat: 0xF6CC58,
  // vessels
  aortaWallStiff: 0xA8202A, veinWall: 0x3E63B3, pulmonaryTrunk: 0x4A5FB0,
  // sleep scene accents (UI + 3D)
  nightTint: 0x1B2A55, soundWave: 0x7FD1FF, apneaFlag: 0xFF5A6E, spo2Ok: 0x34D399, spo2Low: 0x60A5FA,
  // UI tones used inside 3D (section drawing)
  sectionSkin: '#d99c70', sectionSkinEdge: '#8a5a3a', sectionFat: '#f2b61f', sectionMuscle: '#9c4634',
  sectionCavity: '#cfa07c', sectionFatA: '#f0b01c', sectionFatB: '#f6c742', sectionFatEdge: '#c98f10',
};

/* ---------- lights & render ---------- */
export const LIGHTS = {
  hemiSky: 0xFFF4EA, hemiGround: 0x141D33, hemi: 0.5,
  nightSky: 0x6F86C8, nightKey: 0x8FA8FF,
  dir: [
    { color: 0xFFF0E2, intensity: 2.5, pos: [5, 8, 10] },
    { color: 0x8FC2FF, intensity: 1.7, pos: [-8, 4, -9] },
    { color: 0xFFD2BF, intensity: 0.7, pos: [-7, -3, 7] },
  ],
};
export const RENDER = { exposure: 1.1, bloomStrength: 0.24, bloomRadius: 0.6, bloomThreshold: 0.86 };

/* ---------- gloss presets (roughness / clearcoat) so organs stay in one visual family ---------- */
export const GLOSS = {
  wetOrgan: { roughness: 0.3, clearcoat: 0.9, clearcoatRoughness: 0.18 },
  organ: { roughness: 0.34, clearcoat: 0.85, clearcoatRoughness: 0.24 },
  matte: { roughness: 0.55, clearcoat: 0.15 },
  vessel: { roughness: 0.3, clearcoat: 0.9, bumpScale: 0.3 },
};

/* ---------- procedural textures ---------- */
let _seed = 12345;
const trnd = () => (_seed = (_seed * 16807) % 2147483647, (_seed - 1) / 2147483646);

export function makeTex(size, draw, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  return t;
}

/** soft speckle bump map shared by all organ materials */
export const bumpTex = makeTex(256, (g, s) => {
  g.fillStyle = '#808080'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 2600; i++) {
    const r = 1 + trnd() * 6, v = (108 + trnd() * 40) | 0;
    g.fillStyle = `rgb(${v},${v},${v})`; g.globalAlpha = 0.25;
    g.beginPath(); g.arc(trnd() * s, trnd() * s, r, 0, 7); g.fill();
  }
}, 3);

/** branching surface-vein texture (white base, coloured wandering strokes) */
export function veinTex(color, width, count) {
  return makeTex(512, (g, s) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, s, s);
    g.strokeStyle = color; g.lineCap = 'round';
    for (let i = 0; i < count; i++) {
      let x = trnd() * s, y = trnd() * s, a = trnd() * 7;
      g.globalAlpha = 0.1 + trnd() * 0.16; g.lineWidth = width * (0.5 + trnd());
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 26; k++) {
        a += (trnd() - 0.5) * 1.1; x += Math.cos(a) * 9; y += Math.sin(a) * 9; g.lineTo(x, y);
        if (trnd() < 0.12) { g.stroke(); g.beginPath(); g.moveTo(x, y); g.lineWidth *= 0.75; }
      }
      g.stroke();
    }
  }, 2);
}
export const heartVeinTex = veinTex('#7a1020', 3.2, 60);
export const liverVeinTex = veinTex('#4a1410', 2.4, 80);
export const gutVeinTex = veinTex('#8a2a20', 2, 70);

/* ---------- materials ---------- */
/** Standard wet-organ physical material. color: hex. opts override anything. */
export function OrganMat(color, opts = {}) {
  const c = new THREE.Color(color);
  return new THREE.MeshPhysicalMaterial(Object.assign({
    color: c, roughness: 0.34, metalness: 0, clearcoat: 0.85, clearcoatRoughness: 0.24,
    sheen: 0.55, sheenRoughness: 0.5, sheenColor: c.clone().lerp(new THREE.Color(0xffffff), 0.5),
    emissive: c.clone(), emissiveIntensity: 0.07, bumpMap: bumpTex, bumpScale: 0.6,
  }, opts));
}

/** Translucent fresnel shell (skin / subcutaneous fat). Respects clipping planes. */
export function fresnelMat(color, a0, a1, pw) {
  return new THREE.ShaderMaterial({
    clipping: true,
    uniforms: { c: { value: new THREE.Color(color) }, a0: { value: a0 }, a1: { value: a1 }, pw: { value: pw } },
    vertexShader: `#include <common>
      #include <clipping_planes_pars_vertex>
      varying vec3 vN; varying vec3 vV;
      void main(){ vec4 mvPosition = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mvPosition.xyz); gl_Position = projectionMatrix*mvPosition;
      #include <clipping_planes_vertex>
      }`,
    fragmentShader: `#include <clipping_planes_pars_fragment>
      uniform vec3 c; uniform float a0,a1,pw; varying vec3 vN; varying vec3 vV;
      void main(){
        #include <clipping_planes_fragment>
        float f = pow(1.0-abs(dot(normalize(vN),normalize(vV))), pw);
        gl_FragColor = vec4(c*(0.55+0.95*f), a0 + a1*f);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
}

/** Fat lobule material (instanced, per-instance colour from palette.fatLobules). */
export function fatMat() {
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.22,
    sheen: 1, sheenColor: new THREE.Color(palette.fatSheen), sheenRoughness: 0.4,
    emissive: new THREE.Color(palette.fatEmissive), emissiveIntensity: 0.12, bumpMap: bumpTex, bumpScale: 0.3,
  });
}
export const fatColors = palette.fatLobules.map((h) => new THREE.Color(h));

/** Ready-made shared materials for body shell & skeleton */
export const mats = {
  skin: () => fresnelMat(palette.skin, 0.025, 0.62, 2.3),
  subcutFat: () => fresnelMat(palette.subcutFat, 0.02, 0.38, 1.7),
  bone: () => OrganMat(palette.bone, { roughness: 0.55, clearcoat: 0.15, sheen: 0, transparent: true, opacity: 0.6, depthWrite: false, emissiveIntensity: 0.03 }),
  cartilage: () => OrganMat(palette.cartilage, { roughness: 0.4, transparent: true, opacity: 0.45, sheen: 0, depthWrite: false, emissiveIntensity: 0.02 }),
};
