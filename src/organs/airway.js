// organs/airway.js — upper/lower airway. Currently: trachea with cartilage ripple + two main bronchi.
import { P, vtube, add } from '../core/ctx.js';
import { palette, OrganMat } from '../core/style.js';

export function build(ctx) {
  const mat = OrganMat(palette.trachea, { roughness: 0.5, transparent: true, opacity: 0.9 });
  const g = ctx.groups.airway;
  add(vtube([P(0, 5, 0.55), P(0, 4, 0.3), P(0, 3.1, 0)], (u) => 0.2 * (1 + 0.08 * Math.sin(u * 120)), 120, 14), mat, g);
  add(vtube([P(0, 3.1, 0), P(-0.6, 2.75, -0.1), P(-1.2, 2.3, -0.2)], (u) => 0.14 * (1 - 0.3 * u), 40, 10), mat, g);
  add(vtube([P(0, 3.1, 0), P(0.7, 2.8, -0.12), P(1.3, 2.35, -0.25)], (u) => 0.13 * (1 - 0.3 * u), 40, 10), mat, g);
}
export function update(f, t, phys) {}
