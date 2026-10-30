// ui/phys_ui.js — live physiology overlays (blood-pressure gauge, breathing / stairs test, sleep-snore scene).
// Creates its own DOM + injected CSS at build time (no edits to template.html needed).
// Phase-2 owner: the physiology agent. Keep build(ctx, hooks) / update(f, t, phys) / show(panel) / hide().
let C;
export function build(ctx, hooks) { C = ctx; }
export function update(f, t, phys) {}
export function show(panel) {}
export function hide() {}
