// core/registry.js — organ registry. Each organ module exports build(ctx) and update(f, t, phys).
// main.js builds everything in registration order and calls update() every frame.
const organs = [];

export function register(key, mod, opts = {}) {
  organs.push({ key, build: mod.build, update: mod.update, bbox: opts.bbox || null, layers: opts.layers || [0] });
}
export function buildAll(ctx) {
  for (const o of organs) {
    try { o.build && o.build(ctx); }
    catch (e) { console.error(`[organ:${o.key}] build failed`, e); }
  }
}
export function updateAll(f, t, phys) {
  for (const o of organs) {
    try { o.update && o.update(f, t, phys); }
    catch (e) { if (!o._err) { o._err = true; console.error(`[organ:${o.key}] update failed`, e); } }
  }
}
export const list = () => organs.map((o) => o.key);
