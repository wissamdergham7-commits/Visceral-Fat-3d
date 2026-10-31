// sim/physiology.js — physiological simulation engine (phase 2, physiology agent).
//
// Inputs : ctx.state.profile { sex, age, w, h, waist, bmi, pct, kgLoss, w2, waist2, bmi2, fToday, fAfter }
//          (ctx.state.profileVersion bumps on change), the live fat fraction f of state A, ctx.state.sleep, time.
// Output : step(f, t, dt) -> phys (one shared object, consumed by every organ and by ui/phys_ui.js).
// Pure   : estimate(profileLike) -> ranges for one body (today vs after comparisons), airwayFrom(score),
//          arterialWave(ph, sbp, dbp, k).
//
// Every number is an educational ESTIMATE shown as a range in the UI, never a diagnosis. All relations below are
// conservative simplifications of published population / intervention data:
//
//  BLOOD PRESSURE (mmHg) — ONE adiposity term (BMI, capped) plus a small waist residual. BMI and waist describe the
//  same adiposity and the published slopes are univariate, so they are not both applied in full (no double counting):
//   SBP0 = 115 (men) / 110 (women) + 0.5 * (age - 20) + 0.9 * clamp(BMI - 22, -3, 14) + 0.08 * clamp(waist - ref, 0, 35)
//   DBP0 =  74 (men) /  71 (women) + 0.30 * (min(age,55) - 20) - 0.15 * max(0, age - 60) + 0.55 * clamp(BMI - 22, -3, 14) + 0.05 * clamp(waist - ref, 0, 35)
//     ref waist = 94 cm men / 80 cm women (IDF action levels)
//     · age slopes: SBP rises ~0.5 mmHg/yr through adult life, DBP rises ~0.3/yr until ~55 then falls
//       (Franklin SS et al. Circulation 1997;96:308, Framingham age trends)
//     · BMI: ~1 mmHg SBP / ~0.6 DBP per BMI unit (INTERSALT, Dyer AR et al. J Hum Hypertens 1994; Linderman GC et al.
//       JAMA Netw Open 2018). The cross-sectional relation flattens above BMI ~35, hence the cap at 14 units (BMI 36).
//     · waist residual: 0.08 / 0.05 mmHg per cm above the reference, capped at 35 cm. The Olivetti Heart Study
//       (Siani A et al. Am J Hypertens 2002;15:780) reports ~0.25 mmHg/cm univariately; most of that is shared with BMI,
//       so only a fraction is added on top of the BMI term.
//     · net effect: BMI +10 with waist +28 cm adds ≈ +11 / +7.5 mmHg (INTERSALT / NHANES order of magnitude);
//       results are clamped to 95-175 / 58-105 and DBP ≤ SBP - 25.
//   Weight loss (interventional, applied on top of today's baseline, never recomputed from the smaller body):
//     dSBP = -1.05 mmHg/kg, dDBP = -0.92 mmHg/kg (Neter JE et al. Hypertension 2003;42:878, meta-analysis of 25 RCTs),
//     capped at -18 / -14 mmHg (large losses show diminishing returns), +12 / +10 for weight gain.
//   Display: 5 mmHg buckets («135-140»), category colours after ESC/ESH 2018 (optimal <120/80, normal <130/85, high-normal <140/90).
//   Arterial waveform: Windkessel-like shape — steep upstroke, rounded peak, dicrotic notch, exponential diastolic run-off;
//     stiffer arteries (age, pressure) -> faster upstroke, earlier notch, shorter run-off, damped dicrotic wave
//     (Nichols WW, O'Rourke MF, McDonald's Blood Flow in Arteries, 6th ed.).
//  HEART RATE (bpm)
//   HRrest = 62 (men) / 66 (women) + 0.45 * clamp(BMI - 22, 0, 20) + 0.12 * max(0, waist - 85)
//     (resting HR is a few bpm higher with obesity; e.g. Framingham / NHANES associations, ~0.5-1 bpm per BMI unit)
//   Sleep: -10 % (nocturnal dip). Obstructive apnoea: cyclical brady- then tachycardia at the arousal
//     (Guilleminault C et al. Lancet 1984;1:126) — modelled as -6 bpm during the event, +24 bpm at arousal decaying over ~6 s.
//   While a stairs test runs, the resting baseline is the TEST body's (today / after), blended in over ~1.2 s; a restart
//   (replay, or switching today -> after mid-run) keeps the current HR / breathing excess and lets it re-converge, no jump.
//  BREATHING
//   ERV fraction = exp(-0.0755 * max(0, BMI - 20))  (ERV ≈ 47 % of normal at BMI 30; FRC ≈ 75 %)
//     (Jones RL, Nzekwu MM. Chest 2006;130:827 — lung volumes fall exponentially with BMI)
//   central = smoothstep(0.45, 0.65, waist / height)   (waist-to-height ratio as central-obesity marker)
//   diaphragmTravel = clamp(0.60 + 0.25 * ERVfrac + 0.15 * (1 - central), 0.55, 1)
//     ERV is a volume, not excursion: ultrasound shows only ~15-25 % less diaphragm excursion in central obesity with a
//     near-normal tidal volume, so the ERV curve is used as a damped driver (≈ 0.75 at BMI 30-32, ≈ 0.65 at BMI 40).
//   tidalDepth(rest) = 0.60 + 0.40 * diaphragmTravel ; breathRate(rest) = 12 + 8 * (1 - diaphragmTravel)
//     (rapid-shallow pattern and higher work of breathing in obesity: Salome CM et al. J Appl Physiol 2010;108:206;
//      Babb TG et al. Am J Respir Crit Care Med 2008;178:116 — dyspnoea on exertion with central adiposity)
//   Stairs test (two flights ≈ 30 steps, time-compressed x3: 18 sim-s = 6 real s climb): load = clamp((BMI - 21) / 15, 0, 1)
//     peak HR = rest + 45 + 35 * load ; peak RR = 18 + 14 * load + 4 * (1 - diaphragmTravel)
//     recovery time constant tau = 22 + 40 * load s ; time to settle (within 10 bpm) = tau * ln(dHR / 10)
//     (slower heart-rate recovery with obesity, improved by weight loss: Brinkworth GD et al. Am Heart J 2006;152:693)
//  SLEEP / UPPER AIRWAY
//   neck (cm) = 37 (men) / 34 (women) + 0.5 * (BMI - 25)  ±1.5 — guide estimate only
//     (Ben-Noun L et al. Obes Res 2001;9:470: NC 37/34 cm ≈ BMI 25, 39.5/36.5 cm ≈ BMI 30)
//   risk score s (0..1) = [0.3·male + 0.25·smooth(40,60,age) + 0.3·smooth(26,39,BMI) + 0.3·smooth(36,44,neck) + 0.2·smooth(85,118,waist)] / 1.35
//     (the components of STOP-Bang: Chung F et al. Anesthesiology 2008;108:812 — male, age > 50, BMI > 35, neck > 40 cm;
//      male:female ≈ 2-3:1, Young T et al. N Engl J Med 1993;328:1230). The smoothstep windows are deliberately wide so
//      that the score (and the event rate below) does not swing more with a 10 % weight change than the literature supports.
//   tiers: s < 0.35 low · 0.35-0.6 moderate · > 0.6 high (wording: «indicators fall in a range usually linked to…»)
//   event rate (guide, never displayed as AHI) = 40 * s^1.3 /h when s ≥ 0.3, else no full obstructions;
//     the scene is time-compressed: interval = clamp(600 / rate, 18, 90) s, event length = 10 + 10 * s s (10-20 s, AASM ≥ 10 s);
//     the first obstruction comes 5.5 s after falling asleep (shortest length) so a 24 s scene shows closure, desaturation
//     and the arousal; later ones follow the interval (×0.75-1.25).
//     weight effect: for the default body a 10 % loss lowers the modelled rate by ≈ 40 % — between the population estimate
//     (10 % loss ↔ −26 %, Peppard PE et al. JAMA 2000;284:3015) and intervention results with larger losses (−50 to −70 %
//     for 15-20 % loss, Greenburg DL et al. Am J Med 2009;122:535 meta-analysis); a 12 % loss drops the default body below
//     the moderate tier, a 20 % loss below the event threshold.
//   SpO2: awake 97 - 1.0 * s ; during an obstruction it falls after ~3 s to a nadir 97 - (5 + 9 * s) (≥ 82 %) over the event,
//     recovers with tau ≈ 4 s after the arousal (typical 3-10 % dips per event; AASM scoring manual, Berry RB et al. 2012)
//   airwayPatency awake = 1 - 0.18 * s ; asleep = 1 - 0.55 * s (loss of pharyngeal dilator tone), minus 0.1 * s on inspiration
//     (inspiratory negative pressure narrows the collapsible segment), 0.03 while obstructed, +0.25 at the arousal gasp.
//   snoreIntensity = snoreLevel(s) * smooth(0.95, 0.5, patency) * inspiratory flow (flutter of soft palate / pharyngeal walls).
//   The fat that narrows the pharynx sits laterally (parapharyngeal fat pads, lateral wall thickening: Schwab RJ et al.
//     Am J Respir Crit Care Med 1995;152:1673) and in the tongue base (Kim AM et al. Sleep 2014;37:1639); the UI draws it so.
//  LIVE INTERPOLATION
//   body-level inputs (BP, HR, diaphragm, neck, risk score s, fat fractions) are interpolated between today and after
//   with the eased fat fraction u (snapped to 0 / 1 within 0.5 %, because main.js stops easing f within 8e-4 of its
//   target). Airway outputs (event rate, interval, event length, SpO2 targets, patency, snore level) are DERIVED from
//   the interpolated score with airwayFrom(), never interpolated themselves (interval = 0 encodes «no events»).
import { clamp, lerp, smooth, gauss } from '../core/ctx.js';

/* ---------- private deterministic PRNG (does not disturb the shared organ seed) ---------- */
let seed = 7777;
const prnd = () => (seed = (seed * 16807) % 2147483647, (seed - 1) / 2147483646);

/* ---------- the shared snapshot ---------- */
const phys = {
  hr: 64, sbp: 120, dbp: 78, pulsePressure: 42, breathRate: 13, tidalDepth: 1, diaphragmTravel: 1,
  airwayPatency: 1, snoreIntensity: 0, apneaEvent: false, apneaProgress: 0, arousal: 0, effort: 0, spo2: 97, sleep: false,
  heartPhase: 0, atrialPulse: 0, ventricularPulse: 0, breathPhase: 0, breath: 0, flow: 0, dt: 0,
  stiffness: 0.3, nightK: 0, eventCount: 0, longestEvent: 0, nightClock: 0, u: 0, neck: 38, osa: 0, tier: 0,
  stairs: null, today: null, after: null, live: null, simT: 0,
};
let C = null;
let heartPhase = 0, breathPhase = 0, simT = 0;
let cache = { version: -1, today: null, after: null };

/* ---------- helpers ---------- */
const bucket5 = (x) => { const lo = 5 * Math.round((x - 2.5) / 5); return [lo, lo + 5]; };
const around = (x, pct, step = 1) => [Math.round(x * (1 - pct) / step) * step, Math.round(x * (1 + pct) / step) * step];

/** ESC/ESH 2018 colour category: 0 optimal/normal, 1 high-normal, 2 raised */
function bpCategory(sbp, dbp) { return sbp >= 140 || dbp >= 90 ? 2 : sbp >= 130 || dbp >= 85 ? 1 : 0; }

/**
 * PURE: airway / sleep outputs derived from the risk score s (0..1). Used by estimate() for each body and by step()
 * on the live (interpolated) score, so that interval = 0 («no events») is never produced by interpolation.
 */
export function airwayFrom(osa) {
  osa = clamp(osa, 0, 1);
  const tier = osa < 0.35 ? 0 : osa < 0.6 ? 1 : 2;
  const eventRate = osa >= 0.3 ? 40 * Math.pow(osa, 1.3) : 0;
  const interval = eventRate > 0 ? clamp(600 / eventRate, 18, 90) : 0;
  return {
    tier, eventRate, interval, eventDur: 10 + 10 * osa,
    spo2Nadir: 97 - clamp(5 + 9 * osa, 4, 14), spo2Awake: 97 - 1.0 * osa,
    snoreLevel: smooth(0.12, 0.8, osa), patencyAwake: 1 - 0.18 * osa, patencySleep: 1 - 0.55 * osa,
  };
}

/**
 * PURE: estimate the physiological ranges of one body.
 * profileLike = { sex:'m'|'f', age, w (kg today), h (cm), waist (cm today), kgLoss (kg to lose, negative = gain) }
 * The body "after" = (w - kgLoss, waist - 0.9 kgLoss) — the same rule panel.js uses.
 */
export function estimate(p = {}) {
  const sex = p.sex === 'f' ? 'f' : 'm', male = sex === 'm';
  const age = clamp(+p.age || 40, 18, 90), h = clamp(+p.h || 170, 120, 220);
  const w0 = clamp(+p.w || 80, 30, 250), waist0 = clamp(+p.waist || 95, 50, 200), kg = +p.kgLoss || 0;
  const hm = h / 100, bmi0 = w0 / (hm * hm);
  const w = Math.max(30, w0 - kg), waist = Math.max(55, waist0 - 0.9 * kg), bmi = w / (hm * hm);
  const waistRef = male ? 94 : 80;

  /* blood pressure: cross-sectional baseline of TODAY's body (one capped adiposity term + small waist residual)
     + interventional per-kg effect */
  const adip = clamp(bmi0 - 22, -3, 14), waistX = clamp(waist0 - waistRef, 0, 35);
  let sbp = (male ? 115 : 110) + 0.5 * (age - 20) + 0.9 * adip + 0.08 * waistX;
  let dbp = (male ? 74 : 71) + 0.30 * (Math.min(age, 55) - 20) - 0.15 * Math.max(0, age - 60) + 0.55 * adip + 0.05 * waistX;
  sbp -= clamp(1.05 * kg, -12, 18); dbp -= clamp(0.92 * kg, -10, 14);
  sbp = clamp(sbp, 95, 175); dbp = clamp(dbp, 58, 105); if (dbp > sbp - 25) dbp = sbp - 25;
  const stiff = clamp(0.6 * (age - 30) / 50 + 0.4 * smooth(110, 150, sbp), 0.05, 1);

  /* heart rate */
  const hrRest = (male ? 62 : 66) + 0.45 * clamp(bmi - 22, 0, 20) + 0.12 * Math.max(0, waist - 85);

  /* breathing */
  const ervFrac = Math.exp(-0.0755 * Math.max(0, bmi - 20)), frcFrac = Math.exp(-0.029 * Math.max(0, bmi - 20));
  const central = smooth(0.45, 0.65, waist / h);
  const diaphragmTravel = clamp(0.6 + 0.25 * ervFrac + 0.15 * (1 - central), 0.55, 1);
  const tidalRest = 0.6 + 0.4 * diaphragmTravel, rrRest = 12 + 8 * (1 - diaphragmTravel);
  const load = clamp((bmi - 21) / 15, 0, 1);
  const peakHrD = 45 + 35 * load, peakHr = hrRest + peakHrD, peakRR = 18 + 14 * load + 4 * (1 - diaphragmTravel);
  const recoverTau = 22 + 40 * load, recoverT = recoverTau * Math.log(peakHrD / 10), effortPeak = 0.45 + 0.55 * load;

  /* sleep / upper airway */
  const neck = clamp((male ? 37 : 34) + 0.5 * (bmi - 25), 30, 52);
  const osa = clamp((0.3 * male + 0.25 * smooth(40, 60, age) + 0.3 * smooth(26, 39, bmi) + 0.3 * smooth(36, 44, neck) + 0.2 * smooth(85, 118, waist)) / 1.35, 0, 1);
  const air = airwayFrom(osa);
  const fatNeck = clamp((neck - 34) / 12, 0, 1), tongueFat = clamp((bmi - 22) / 16, 0, 1);

  return {
    sex, age, h, w, waist, bmi, kgLoss: kg,
    sbp, dbp, pp: sbp - dbp, sbpR: bucket5(sbp), dbpR: bucket5(dbp), bpCat: bpCategory(sbp, dbp), stiff,
    hrRest, hrR: around(hrRest, 0.05),
    ervFrac, frcFrac, central, diaphragmTravel, tidalRest, rrRest, rrR: around(rrRest, 0.08),
    load, peakHr, peakHrR: around(peakHr, 0.06), peakRR, peakRRR: around(peakRR, 0.1), recoverTau, recoverT, recoverR: around(recoverT, 0.15, 5), effortPeak,
    neck, neckR: [Math.round(neck - 1.5), Math.round(neck + 1.5)], osa, ...air, fatNeck, tongueFat,
  };
}

/* ---------- arterial pressure waveform (pure) ----------
 * ph: 0..1 cardiac phase (0 = atrial kick, ventricular ejection starts at 0.17 like the heart module's pulse).
 * k : arterial stiffness 0..1. Returns mmHg between dbp (end-diastole) and sbp (peak). */
function waveShape(ph, k) {
  const t0 = 0.17, up = lerp(0.075, 0.045, k), tPeak = t0 + up, tN = lerp(0.47, 0.42, k), tau = lerp(0.5, 0.3, k), nl = lerp(0.62, 0.7, k);
  const dia = (x) => nl * Math.exp(-(x - tN) / tau);
  const base = dia(1 + t0);
  let s;
  if (ph < t0) s = dia(ph + 1);
  else if (ph < tPeak) { const x = (ph - t0) / up; s = base + (1 - base) * (1 - Math.pow(1 - x, 2.4)); }
  else if (ph < tN) { const x = (ph - tPeak) / (tN - tPeak); s = 1 - (1 - nl) * Math.pow(x, lerp(1.6, 1.15, k)); }
  else s = dia(ph);
  s += (-0.085 * gauss(ph, tN, 0.012) + 0.06 * gauss(ph, tN + 0.06, 0.035)) * (1 - 0.45 * k);
  return clamp((s - base) / (1 - base), -0.05, 1);
}
export function arterialWave(ph, sbp, dbp, k = 0.3) {
  const p = ((ph % 1) + 1) % 1;
  return dbp + (sbp - dbp) * waveShape(p, clamp(k, 0, 1));
}
/** live pressure at a phase (uses the current snapshot) */
export const arterialPressure = (ph) => arterialWave(ph, phys.sbp, phys.dbp, phys.stiffness);

/* ---------- breathing shape: inspiration 42 % of the cycle, expiration 58 % ---------- */
const INSP = 0.42;
const breathShape = (ph) => (ph < INSP ? 0.5 - 0.5 * Math.cos(Math.PI * ph / INSP) : 0.5 + 0.5 * Math.cos(Math.PI * (ph - INSP) / (1 - INSP)));
const flowShape = (ph) => (ph < INSP ? Math.sin(Math.PI * ph / INSP) : -0.72 * Math.sin(Math.PI * (ph - INSP) / (1 - INSP)));

/* ---------- scenario state ---------- */
const sleep = { on: false, depth: 0, nextAt: 0, first: true, ev: null, arousalT: -99, count: 0, longest: 0, clock: 0, spo2: 97, hrEv: 0 };
const RATE = 3, CLIMB = 18;                         // stairs: time compression and climb length (sim seconds)
const stairs = { on: false, body: 'today', phase: 'idle', simT: 0, hrD: 0, rrD: 0, effort: 0, steps: 0, result: null, E: null, peakHr: 0, peakRR: 0, climb: CLIMB, rate: RATE, base: null };
const FIRST_EVENT_AT = 5.5;                         // s after the scene starts (sleep depth reaches 0.85 at ~3 s)

/** start / stop the night scene (also followed automatically from ctx.state.sleep).
 *  Only the event / arousal state is reset here; sleep.depth eases down in step() with the same 1.6 s constant it
 *  eases up with, so hr / rr / tidal / airwayPatency glide back while the night lighting fades (no 3D pop). */
export function setSleep(on) {
  if (sleep.on === !!on) return;
  sleep.on = !!on; seed = 7777;
  Object.assign(sleep, { nextAt: simT + FIRST_EVENT_AT, first: true, ev: null, arousalT: -99, count: 0, longest: 0, clock: 23 * 60 + 40, hrEv: 0 });
  phys.apneaEvent = false; phys.apneaProgress = 0;
}
/** stairs test with the 'today' or 'after' body; replayable. A restart while a run is active keeps the current
 *  HR / breathing excess (hrD, rrD, effort) so the pulse re-converges instead of jumping back to rest. */
export function startStairs(body = 'today') {
  Object.assign(stairs, { on: true, body: body === 'after' ? 'after' : 'today', phase: 'climb', simT: 0, steps: 0, result: null, peakHr: 0, peakRR: 0 });
}
export function stopStairs() { Object.assign(stairs, { on: false, phase: 'idle' }); }   // hrD / rrD / effort decay in step()

export function build(ctx) { C = ctx; phys.ctx = ctx; }

/** today / after estimates, recomputed only when the profile changes */
function estimates() {
  const st = C && C.state, p = st && st.profile;
  const v = st ? (st.profileVersion || 0) : 0;
  if (cache.version !== v || !cache.today) {
    const base = p || { sex: 'm', age: 40, w: 80, h: 170, waist: 95, kgLoss: 0 };
    cache = { version: v, today: estimate({ ...base, kgLoss: 0 }), after: estimate({ ...base, kgLoss: base.kgLoss || 0 }) };
  }
  return cache;
}

/* body-level fields interpolated between today and after with the eased fat fraction; the airway outputs are
   derived from the interpolated score afterwards (see airwayFrom) */
const LIVE = ['sbp', 'dbp', 'stiff', 'hrRest', 'diaphragmTravel', 'tidalRest', 'rrRest', 'neck', 'osa', 'fatNeck', 'tongueFat', 'bmi', 'waist', 'w'];
const live = {};

/** advance the simulation by dt seconds at absolute time t for fat fraction f; returns the snapshot */
export function step(f, t, dt) {
  dt = clamp(dt || 0, 0, 0.1); simT += dt;
  const { today, after } = estimates();
  const p = (C && C.state.profile) || { fToday: 0.5, fAfter: 0.5 };
  let u = Math.abs(p.fAfter - p.fToday) < 1e-4 ? 1 : clamp((f - p.fToday) / (p.fAfter - p.fToday), 0, 1);
  if (u > 0.995) u = 1; else if (u < 0.005) u = 0;              // main.js stops easing f within 8e-4 of its target
  for (const k of LIVE) live[k] = lerp(today[k], after[k], u);
  Object.assign(live, airwayFrom(live.osa));                     // derived, never interpolated (interval 0 = no events)

  /* ----- sleep scene ----- */
  const wantSleep = !!(C && C.state.sleep);
  if (wantSleep !== sleep.on) setSleep(wantSleep);
  sleep.depth = lerp(sleep.depth, sleep.on ? 1 : 0, 1 - Math.exp(-dt / 1.6));
  const sd = sleep.depth;
  if (sleep.on) sleep.clock += dt * 1.5;                                  // night clock in minutes: 1 s = 1.5 night minutes

  /* ----- stairs test (time-compressed) ----- */
  if (stairs.on) {
    stairs.E = stairs.body === 'after' ? after : today;
    const E = stairs.E, sdt = dt * RATE;
    stairs.simT += sdt;
    if (stairs.phase === 'climb') {
      const ramp = smooth(0, 14, stairs.simT);
      const ka = 1 - Math.exp(-sdt / 6);
      stairs.hrD += ((E.peakHr - E.hrRest) * ramp - stairs.hrD) * ka;
      stairs.rrD += ((E.peakRR - E.rrRest) * ramp - stairs.rrD) * ka;
      stairs.effort += (E.effortPeak * ramp - stairs.effort) * ka;
      stairs.steps += sdt * 1.7;
      if (stairs.simT >= CLIMB) { stairs.phase = 'recover'; stairs.peakHr = E.hrRest + stairs.hrD; stairs.peakRR = E.rrRest + stairs.rrD; }
    } else if (stairs.phase === 'recover') {
      stairs.hrD *= Math.exp(-sdt / E.recoverTau);
      stairs.rrD *= Math.exp(-sdt / (E.recoverTau * 0.8));
      stairs.effort *= Math.exp(-sdt / (E.recoverTau * 0.55));
      if (stairs.hrD < 10) { stairs.phase = 'done'; stairs.result = { recoverT: stairs.simT - CLIMB, peakHr: stairs.peakHr, peakRR: stairs.peakRR, body: stairs.body }; }
    } else {
      stairs.hrD *= Math.exp(-sdt / E.recoverTau); stairs.rrD *= Math.exp(-sdt / 20); stairs.effort *= Math.exp(-sdt / 10);
    }
  } else if (stairs.hrD > 0.01 || stairs.rrD > 0.01 || stairs.effort > 0.001) {
    const sdt = dt * RATE;                                                 // stopped mid-run: settle smoothly (≈ 3 real s), no pop
    stairs.hrD *= Math.exp(-sdt / 8); stairs.rrD *= Math.exp(-sdt / 8); stairs.effort *= Math.exp(-sdt / 5);
  }
  const effort = clamp(stairs.effort, 0, 1);
  /* while a test runs the resting baseline is the TEST body's (today / after), independent of the slider; eased so that
     starting, stopping or switching the body never jumps the pulse */
  const SE = stairs.on ? stairs.E : null;
  const tgt = SE ? [SE.hrRest, SE.rrRest, SE.tidalRest] : [live.hrRest, live.rrRest, live.tidalRest];
  if (!stairs.base) stairs.base = tgt.slice();
  const kb = 1 - Math.exp(-dt / 1.2);
  for (let i = 0; i < 3; i++) stairs.base[i] += (tgt[i] - stairs.base[i]) * kb;
  const [hrBase, rrBase, tidalBase] = stairs.base;

  /* ----- breathing ----- */
  let rr = rrBase + stairs.rrD;
  rr *= 1 - 0.1 * sd;
  let tidal = clamp(tidalBase + 0.5 * effort, 0.3, 1);
  let patency = lerp(live.patencyAwake, live.patencySleep, sd);
  let snore = 0, apnea = false, apneaProgress = 0, spo2Target = live.spo2Awake, hrSleepD = 0, arousal = 0;

  /* obstructive events while asleep */
  if (sleep.on && sd > 0.85 && !sleep.ev && live.interval > 0 && simT >= sleep.nextAt) {
    sleep.ev = { t0: simT, dur: live.eventDur * (sleep.first ? 0.85 : 0.85 + 0.3 * prnd()) }; sleep.first = false;
  }
  if (sleep.ev && !sleep.on) sleep.ev = null;
  if (sleep.ev) {
    const el = simT - sleep.ev.t0, dur = sleep.ev.dur;
    /* arousal: airway reopens, gasp, pulse jumps. Also the way out when weight loss during the scene takes the body
       below the event threshold (interval 0): the obstruction is released by an arousal instead of vanishing silently */
    if (el >= dur || (live.interval === 0 && el >= 2)) {
      sleep.arousalT = simT; sleep.count++; sleep.longest = Math.max(sleep.longest, Math.min(el, dur)); sleep.ev = null;
      sleep.nextAt = simT + live.interval * (0.75 + 0.5 * prnd());
    } else {
      const closing = smooth(0, 1.4, el);
      patency = lerp(patency, 0.03, closing);
      apnea = closing > 0.5; apneaProgress = el / dur;
      tidal = 0.1 + 0.12 * apneaProgress;                                 // effort without airflow
      spo2Target = lerp(live.spo2Awake, live.spo2Nadir, smooth(3, dur + 1.5, el));
      hrSleepD = -6 * closing;
      rr *= 1.08;
    }
  }
  const sinceAr = simT - sleep.arousalT;
  if (sleep.on && sinceAr < 16) {
    arousal = Math.exp(-sinceAr / 6);
    patency = clamp(patency + 0.25 * arousal, 0, 1);
    tidal = clamp(tidal * (1 + 0.35 * arousal), 0, 1);
    hrSleepD += 24 * arousal;
    rr *= 1 + 0.25 * arousal;
  }
  breathPhase = (breathPhase + dt * rr / 60) % 1;
  const inspFlow = Math.max(0, flowShape(breathPhase));
  if (sd > 0.05 && !sleep.ev) patency -= 0.1 * live.osa * inspFlow * sd;  // inspiratory narrowing of the collapsible segment
  patency = clamp(patency, 0.03, 1);
  if (sleep.on && !sleep.ev) {
    snore = live.snoreLevel * smooth(0.95, 0.5, patency) * inspFlow * sd;
    if (sinceAr < 2) snore = Math.max(snore, 0.9 * gauss(sinceAr, 0.45, 0.35)); // the snort at the arousal
  }
  const breath = clamp(tidal * breathShape(breathPhase), 0, 1);
  const flow = (sleep.ev ? 0.08 : 1) * tidal * flowShape(breathPhase);

  /* ----- SpO2 (lagged) ----- */
  const tauO = spo2Target < sleep.spo2 ? 4 : 3.2;
  sleep.spo2 += (spo2Target - sleep.spo2) * (1 - Math.exp(-dt / tauO));

  /* ----- heart ----- */
  const hr = clamp(hrBase * (1 - 0.1 * sd) + stairs.hrD + hrSleepD, 40, 190);
  const period = 60 / hr;
  heartPhase = (heartPhase + dt / period) % 1;

  /* ----- blood pressure (live, follows the slider; exertion adds systolic load) ----- */
  const sbp = live.sbp + 30 * effort + 8 * arousal, dbp = live.dbp + 6 * effort + 3 * arousal;

  /* ----- publish ----- */
  phys.hr = hr; phys.heartPhase = heartPhase;
  phys.atrialPulse = gauss(heartPhase, 0.05, 0.045);
  phys.ventricularPulse = gauss(heartPhase, 0.23, 0.05) + 0.45 * gauss(heartPhase, 0.36, 0.05);
  phys.sbp = sbp; phys.dbp = dbp; phys.pulsePressure = sbp - dbp; phys.stiffness = live.stiff;
  phys.breathRate = rr; phys.breathPhase = breathPhase; phys.breath = breath; phys.flow = flow;
  phys.tidalDepth = tidal; phys.diaphragmTravel = live.diaphragmTravel;
  phys.airwayPatency = patency; phys.snoreIntensity = clamp(snore, 0, 1);
  phys.apneaEvent = apnea; phys.apneaProgress = apneaProgress; phys.arousal = arousal;
  phys.effort = effort; phys.spo2 = sleep.spo2; phys.sleep = sleep.on; phys.sleepDepth = sd;
  phys.eventCount = sleep.count; phys.longestEvent = sleep.longest; phys.nightClock = sleep.clock;
  phys.neck = live.neck; phys.osa = live.osa; phys.tier = live.tier; phys.u = u;
  phys.today = today; phys.after = after; phys.live = live; phys.stairs = stairs; phys.simT = simT; phys.dt = dt;
  return phys;
}
export const snapshot = () => phys;
export function update(f, t, phys) {}
