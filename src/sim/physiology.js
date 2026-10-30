// sim/physiology.js — physiological simulation engine.
// Input: ctx.state (sex, age, weight, height, waist, fat fraction). Output: a live snapshot every frame
// consumed by every organ and by the UI. Phase 1: faithful port of the previous behaviour (heart period
// shortens with fat, 4.6 s breathing cycle) exposed through the physiology interface.
import { gauss } from '../core/ctx.js';

const phys = {
  hr: 60, sbp: 120, dbp: 80, pulsePressure: 40, breathRate: 13, tidalDepth: 1, diaphragmTravel: 1,
  airwayPatency: 1, snoreIntensity: 0, apneaEvent: false, effort: 0,
  heartPhase: 0, atrialPulse: 0, ventricularPulse: 0, breathPhase: 0, breath: 0, dt: 0,
};
let heartPhase = 0;

export function build(ctx) { phys.ctx = ctx; }

/** advance the simulation by dt seconds at absolute time t for fat fraction f; returns the snapshot */
export function step(f, t, dt) {
  const period = 1 - 0.22 * f;                          // seconds per beat
  phys.hr = 60 / period;
  heartPhase = (heartPhase + dt / period) % 1;
  phys.heartPhase = heartPhase;
  phys.atrialPulse = gauss(heartPhase, 0.05, 0.045);
  phys.ventricularPulse = gauss(heartPhase, 0.23, 0.05) + 0.45 * gauss(heartPhase, 0.36, 0.05);
  const bp = (t * Math.PI * 2) / 4.6;                   // breathing: 4.6 s cycle
  phys.breathPhase = (t / 4.6) % 1;
  phys.breath = 0.5 - 0.5 * Math.cos(bp);
  phys.breathRate = 60 / 4.6;
  phys.dt = dt;
  return phys;
}
export const snapshot = () => phys;
export function update(f, t, phys) {}
