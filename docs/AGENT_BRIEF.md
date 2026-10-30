# Visceral Fat 3D — Agent Brief (Phase 2)

You are upgrading ONE organ module of an Arabic (RTL) single-file WebGL page that shows a translucent human
torso with beating heart, breathing lungs and visceral fat that melts as the visitor lowers the weight slider.
The page sells a nutrition-coaching programme: it must be visually stunning, anatomically credible and honest.

## Project layout (read these first, in this order)
```
docs/AGENT_BRIEF.md     this file
src/core/style.js       THE style contract: palette, OrganMat(), fresnelMat(), fatMat(), textures, GLOSS presets
src/core/ctx.js         scene/camera/renderer/state/anchors + helpers: P, clamp, lerp, smooth, gauss, noise3, rnd, setSeed, deform, vtube, add, LAYER
src/core/registry.js    organs register { build(ctx), update(f, t, phys) }
src/main.js             build order + render loop (read-only for you)
src/sim/physiology.js   live physiology snapshot `phys` (fields listed below)
src/organs/*.js         one file per organ — you own exactly the file(s) named in your task
src/ui/*.js             UI (read-only for you unless your task names a UI file)
build.py                python3 build.py --out <path>   -> single offline HTML
tests/snap.mjs          fast screenshots (see "How to test")
```

## Hard contracts — breaking any of these breaks the page
1. **Module interface**: your file exports exactly `build(ctx)` and `update(f, t, phys)` (plus any pure helper
   exports you need). `build` creates meshes and adds them to `ctx.groups.<group>`; `update` runs every frame.
   - `f`  : live visceral-fat fraction 0..1 of state **A** (after weight loss, follows the slider; eased).
   - `t`  : seconds since start.  `phys`: physiology snapshot (below).
2. **Layers (before/after split view)**: `ctx.LAYER.STATIC = 0` (always visible), `ctx.LAYER.A = 1` (AFTER, left half),
   `ctx.LAYER.B = 2` (BEFORE/today, right half). **Anything whose look depends on fat must exist twice**:
   an A copy on layer 1 driven by `f`, and a B copy on layer 2 driven by `ctx.state.fB`. Relay the B copy only when
   `ctx.state.bVersion` changes (compare with a cached value). Static geometry stays on layer 0.
   Pattern (see organs/liver.js and organs/fat.js):
   ```js
   let lastA = -1, lastB = -1;
   export function update(f, t, phys) {
     if (Math.abs(f - lastA) > 1e-4) { relayA(f); lastA = f; }
     if (C.state.bVersion !== lastB) { relayB(C.state.fB); lastB = C.state.bVersion; }
   }
   ```
3. **Style**: every colour comes from `palette` and every material from `OrganMat / fresnelMat / fatMat` in
   `core/style.js` (a `THREE.ShaderMaterial` is allowed only for effects that need a shader: flow, vibration,
   pulsing). If you need a colour that is not in the palette, do NOT edit style.js — add a clearly marked block at
   the top of your file:
   ```js
   // STYLE-REQUEST (to be merged into core/style.js palette by the integrator)
   const LOCAL = { valveLeaflet: 0xF3E6DC };
   ```
   Keep the family look: wet, slightly glossy organs, soft sheen, no neon, no pure black, no flat shading.
4. **Picking**: pass a `key` to `add(geo, mat, parent, key)` so clicks open the organ card. Valid keys:
   `heart epifat lungs liver stomach si colon kidney omentum spleen aorta` (new keys are fine; tell the integrator
   so a card can be written). The skin uses key `skin` (ignored by picking).
5. **Anchors**: other organs depend on what you publish on `ctx.anchors`. Keep these names and semantics:
   - heart → `heartPos` (Vector3), `heartSurf(theta, phi, scale)` (point on the OUTER heart surface, heart-local
     coords; the fat module places epicardial lobules with it), `heartG`, `ventG` (fat is parented to ventG),
     `atriaG`
   - digestive → `colonCurve`, `siCurve` (CatmullRomCurve3; mesenteric fat is placed along them)
   - kidneys → `kidneyPos` ([Vector3, Vector3], perirenal fat)
   - vessels → `aortaCurve`
   - body → `torsoRadii(y, W, Wz, inset)` (cross-section drawing)
   - lungs → `lungs` ([Mesh, Mesh]), `diaphragm` (Mesh)
   - airway (new) → `pharynxPos` (Vector3, centre of the oropharynx), `neckTop` (y of chin), `headTop` (y)
6. **Never touch** files you do not own. Do not edit `template.html`, `main.js`, `style.js`, `ctx.js`.
   Any DOM/CSS you need (physiology agent only) is created from your own JS module at build time.
7. **Performance budget** (mobile target ≥ 30 fps): keep your module within the triangle budget in your task,
   prefer `InstancedMesh` for repeated things, keep segment counts sane (sphere ≤ 96×72, tubes ≤ 300 segs),
   no per-frame geometry rebuilds except tiny buffers (≤ 5k verts) or when `f` actually changes.
8. **Determinism**: call `setSeed(<your constant>)` before using `rnd()` so layouts are stable.
9. **Text**: any user-facing text must be Arabic (Levantine-friendly, like the existing UI), non-diagnostic
   («مؤشراتك تقع في نطاق يرتبط عادةً بـ…» never «عندك مرض…»), and ranges rather than exact numbers for estimates.

## Coordinate system & scale
- 1 unit ≈ 5.8 cm. Torso: y = −4.9 (hips) … +5.4 (neck stump, radius ≈ 0.9 at x, 0.88 at z). Belly front is +z.
- Patient's RIGHT = −x (appears on the viewer's left when looking from the front). Anterior = +z. Up = +y.
- Camera default: position (0, 0.2, 20), target (0, −0.1, 0), fov 34. Close-up views exist for heart/liver/belly.
- Key positions: heart centre (0.38, 1.5, 0.55) rotated (−0.38, 0, 0.58); liver (−0.55, −0.3, 0.25);
  diaphragm dome apex ≈ y −0.65 … −0.8; kidneys (±1.22, −1.35/−1.6, −1.12); spine at z ≈ −1.42; sternum z ≈ 1.74;
  aorta runs from the heart up to the arch at y ≈ 3.35 and down at z ≈ −1.1; trachea from y 5 down to the carina
  at (0, 3.1, 0).
- Fat fraction f: 0 = lean, 1 = maximal visceral fat. Today's state is typically f ≈ 0.5–0.9.

## Physiology snapshot `phys` (from src/sim/physiology.js) — consume, never mutate
```
hr               heart rate, bpm              heartPhase       0..1 position in the cardiac cycle
atrialPulse      0..1 atrial contraction      ventricularPulse 0..1 ventricular contraction (systole)
sbp, dbp         systolic / diastolic mmHg    pulsePressure    sbp − dbp
breathRate       breaths/min                  breathPhase      0..1 ; breath = 0..1 (0 = end-expiration)
tidalDepth       0..1 relative tidal volume   diaphragmTravel  0..1 relative diaphragm excursion
airwayPatency    0..1 (1 = wide open)         snoreIntensity   0..1
apneaEvent       bool                         spo2             % (≈ 97 awake, falls during apnea)
effort           0..1 breathing effort        sleep            bool — the night/snore scene is on
```
All of these exist today (some are still constant placeholders until the physiology agent finishes). Code against
the fields, with safe fallbacks (`phys.spo2 ?? 97`).
Inputs for the simulation live in `ctx.state.profile = { sex, age, w, h, waist, bmi, pct, kgLoss, w2, waist2, bmi2,
fToday, fAfter }` (today vs after the slider's loss; `ctx.state.profileVersion` bumps on every change) and
`ctx.state.sleep` (bool, night scene). `ctx.setNight(k)` (0..1) dims the lighting for the sleep scene.

## How to test (mandatory — look at your screenshots, really look)
```
ln -s /home/user/Visceral-Fat-3d/node_modules node_modules      # once, inside your worktree
python3 build.py --out /tmp/out.html
node tests/snap.mjs /tmp/out.html /tmp/shots --steps '[
  {"name":"front","view":"front"},
  {"name":"close","cam":[2.6,3,10.8, 0.35,1.55,0.5]},
  {"name":"maxfat","loss":-10,"view":"front"},
  {"name":"lean","loss":20,"view":"front"}]'
```
Then open the PNGs with the Read tool. `snap.mjs` prints triangles/draw calls and console errors; both must be
clean. Camera steps: `view` = front|side|heart|liver|belly, or `cam` = [px,py,pz, tx,ty,tz]. `loss` = slider
value (−10 = maximum fat, 0 = today, 20 = maximum loss). `js` runs arbitrary JS (`window.__ctx` is the context,
`window.__mode('split'|'section'|'normal')`). Software rendering is slow (seconds per frame): keep waits ≥ 1500 ms. Add `--size 600x560` while iterating
(faster); take the final three deliverable screenshots at the default size.
Iterate until the result is convincing, not merely working.

## Deliverable (structured)
Commit your file(s) in your worktree (`git add <your files> && git commit -m "..."`) and report: files changed,
the worktree path and commit hash, the screenshot paths (normal / close-up / maximum fat), 2–3 lines on what
changed, STYLE-REQUEST colours, anchors you publish/consume, triangle count, and anything the integrator must do
(new card keys, camera suggestions, tour copy).
