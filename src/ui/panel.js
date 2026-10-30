// ui/panel.js — measurements panel, slider, intro form, CTA / WhatsApp links, text effects. Owns calc().
import { $, clamp } from '../core/ctx.js';

export const CMAP = {
  belly: { view: 'belly', pain: 'الكرش والمظهر', gain: 'خصر أنحف وثياب تعود لتناسبك بثقة' },
  breath: { view: 'breath', pain: 'النفَس القصير والتعب', gain: 'تصعد الدرج بلا لهاث وبطاقة أعلى طوال اليوم' },
  snore: { view: 'snore', pain: 'الشخير والنوم المتقطع', gain: 'نوم أعمق بلا شخير واستيقاظ نشيط' },
  health: { view: 'liver', pain: 'التحاليل والصحة', gain: 'تحاليل أنظف: سكر وضغط ودهون أقل' },
};
export const PAYOFF = {
  belly: 'بنطالك القديم يعود ليناسبك، وبطنك يصغر أمام المرآة',
  breath: 'تصعد طابقين متتاليين دون أن تلهث',
  snore: 'نوم عميق هادئ، واستيقاظ خفيف بلا تعب',
  health: 'تحاليلك تعود إلى معدلاتها الطبيعية واحدة تلو الأخرى',
};
/** derived metrics shared with the tour and the end screen */
export const M = {};
let C;
const row = (html, cls) => `<div class="r ${cls}">${html}</div>`;

/** visceral-fat index 1..30 from waist/height ratio */
export function vfatIndex(waist, height, sex) {
  let v = (waist / height - 0.4) * 90;
  if (sex === 'f') v *= 0.85;
  return clamp(v, 1, 30);
}
/** body-shape parameters for a given waist (cm) and BMI */
export function bodyParams(waist, bmi, height, sex) {
  const f = clamp((vfatIndex(waist, height, sex) - 6) / 17, 0, 1);
  return { f, W: clamp(2.55 * waist / 90, 2.1, 3.9), Wz: clamp(1.75 * Math.pow(waist / 90, 1.15), 1.4, 2.9), d: clamp(0.06 + (bmi - 20) * 0.03, 0.05, 0.55), bulge: 0.05 + 0.32 * f };
}

export function setCTA() {
  let url = window.LANDING_URL || '#';
  const num = (window.WHATSAPP_NUMBER || '').replace(/\D/g, '');
  if (num) {
    const msg = 'مرحباً 👋 وصلت من صفحة "ماذا يحدث داخل جسمك".' +
      (M.w ? ` وزني ${M.w} كغ ومحيط خصري ${M.waist} سم، وأكثر ما يزعجني ${CMAP[C.state.complaint].pain}.` : '') +
      ' أرغب بالبدء في البرنامج مع أخصائية التغذية.';
    url = 'https://wa.me/' + num + '?text=' + encodeURIComponent(msg);
  }
  document.querySelectorAll('.ctaLink').forEach((a) => (a.href = url));
}

/** recompute everything from the inputs: results rows, targets for state A (slider) and B (today) */
export function calc() {
  const st = C.state;
  const w = +$('w').value, h = +$('h').value, waist = +$('waist').value;
  if (!(w > 0 && h > 100 && waist > 0)) return;
  const bmi = w / (h / 100) ** 2, whr = waist / h, lv = vfatIndex(waist, h, st.sex), limit = st.sex === 'm' ? 102 : 88;
  $('res').innerHTML =
    row(`<b>وزنك بالنسبة لطولك: ${bmi.toFixed(1)}</b><span>${bmi < 18.5 ? 'أقل من الطبيعي' : bmi < 25 ? 'طبيعي 👍' : bmi < 30 ? 'أعلى من الطبيعي شوي' : 'أعلى من الطبيعي بشكل واضح'}</span>`, bmi < 18.5 ? 'warn' : bmi < 25 ? 'ok' : bmi < 30 ? 'warn' : 'bad') +
    row(`<b>خصرك ${whr < 0.5 ? 'أقل من' : 'أكتر من'} نص طولك</b><span>${whr < 0.5 ? 'مؤشر منيح 👍' : 'يعني في دهون زيادة بالبطن'} · نص طولك = ${Math.round(h / 2)} سم</span>`, whr < 0.5 ? 'ok' : whr < 0.6 ? 'warn' : 'bad') +
    row(`<b>الدهون المخفية: ${Math.round(lv)} من 30 تقريباً</b><span>${lv < 10 ? 'طبيعية' : lv < 15 ? 'مرتفعة، وصار وقت تنتبه' : 'مرتفعة كتير، وخطر عالقلب والكبد'}${waist >= limit ? ` · خصرك فوق حد الخطر (${limit} سم)` : ''}</span>`, lv < 10 ? 'ok' : lv < 15 ? 'warn' : 'bad');
  /* state B = today */
  const today = bodyParams(waist, bmi, h, st.sex);
  st.fB = today.f; Object.assign(st.bodyB, { W: today.W, Wz: today.Wz, d: today.d, bulge: today.bulge }); st.bVersion++;

  /* state A = after the slider's loss */
  const pct = +$('loss').value, kg = w * pct / 100, w2 = w - kg, waist2 = Math.max(55, waist - 0.9 * kg);
  const lv2 = vfatIndex(waist2, h, st.sex), bmi2 = w2 / (h / 100) ** 2;
  st.kgLoss = kg;
  $('loss').style.setProperty('--p', pct / 20 * 100 + '%');
  $('lossKg').textContent = Math.round(kg * 10) / 10 + ' كيلو';
  $('lossTxt').textContent = pct ? `${pct}% من وزنك · الوزن ${w.toFixed(1)} ← ${w2.toFixed(1)} · الخصر تقريباً ${Math.round(waist)} ← ${Math.round(waist2)} سم` : 'حرّك الشريط وراقب الدهون الصفرا كيف بتدوب';
  const after = bodyParams(waist2, bmi2, h, st.sex);
  st.fTgt = after.f; Object.assign(st.bodyTgt, { W: after.W, Wz: after.Wz, d: after.d, bulge: after.bulge });
  /* profile consumed by sim/physiology.js: today (w, waist) and after the slider's loss (w2, waist2) */
  st.profile = { sex: st.sex, age: +($('iage') && $('iage').value || 0) || 40, w, h, waist, bmi, pct, kgLoss: kg, w2, waist2, bmi2, fToday: today.f, fAfter: after.f };
  st.profileVersion = (st.profileVersion || 0) + 1;
  if (pct < 0) {
    $('lossKg').textContent = '+' + Math.round(-kg * 10) / 10 + ' كيلو';
    $('lossTxt').textContent = `لو بقي كل شيء كما هو، خلال 5 سنوات تقريباً: الوزن ${w.toFixed(1)} ← ${w2.toFixed(1)} · الخصر ${Math.round(waist)} ← ${Math.round(waist2)} سم`;
  }
  /* headline metrics for tour / end screen */
  { const kgT = Math.round(w * 0.12), waistT = Math.round(Math.max(55, waist - 0.9 * kgT)), lvT = vfatIndex(waistT, h, st.sex);
    const waist5 = Math.round(waist + 0.9 * w * 0.07), lv5 = Math.round(vfatIndex(waist5, h, st.sex));
    Object.assign(M, { w, h, waist, lv, bmi, age: +($('iage') && $('iage').value || 0) || null, sex: st.sex, kgT, waistT, lvT, waist5, lv5,
      fatDropT: Math.round((1 - lvT / lv) * 100), bpT: Math.min(18, kgT), mLo: Math.max(2, Math.round(kgT / 3.2)), mHi: Math.max(3, Math.round(kgT / 2)) });
    setCTA(); }
  const sev = lv2 >= 15 ? 1 : lv2 >= 10 ? 0.5 : 0;
  $('status').textContent = sev > 0.6 ? 'القلب ملفوف بدهون سميكة، والكبد صار دهني، والشحم مغطّي الأمعاء' : sev > 0.35 ? 'في دهون متوسطة حول القلب، وبلشت تتجمع بالكبد' : 'الدهون حول الأعضاء قليلة وبالحد الطبيعي';
  $('status').className = 'status ' + (sev > 0.6 ? 'bad' : sev > 0.35 ? 'warn' : 'ok');
  const drop = Math.round((1 - lv2 / lv) * 100), bpDrop = Math.min(20, kg);
  const eff = [
    ['❤️', 'القلب', pct ? `الدهون حوالين القلب خفّت تقريباً ${drop}%، فصار القلب يشتغل براحة أكتر.` : 'حرّك الشريط لتشوف الفرق.'],
    ['🩺', 'الضغط', pct ? `الرقم العالي للضغط ممكن ينزل حوالي ${bpDrop.toFixed(0)} ملم، يعني متل ما ينزل من 14 لـ ${(14 - bpDrop / 10).toFixed(1)}.` : 'كل كيلو بينزل بيخفف الضغط شوي.'],
    ['🟤', 'الكبد', pct >= 10 ? 'دهون الكبد بتنزل كتير، والتهابه بيخف، وممكن يتراجع التليّف.' : pct >= 7 ? 'التهاب الكبد الدهني بيبلش يتحسن.' : pct >= 5 ? 'دهون الكبد بتنزل بشكل واضح.' : pct >= 3 ? 'الكبد بيبلش يتخلص من الدهون شوي شوي.' : 'بيبلش التحسن من أول 3% تقريباً.'],
    ['🩸', 'السكر والدهون بالدم', pct >= 5 ? 'السكر والدهون الثلاثية بيتحسنوا، والجسم بيستجيب للإنسولين أحسن.' : pct >= 3 ? 'بيبلشوا يتحسنوا.' : 'بيبلش التحسن من 3%.'],
  ];
  $('effects').innerHTML = eff.map((e) => `<div class="eff"><span class="ic">${e[0]}</span><div><b>${e[1]}</b><p>${e[2]}</p></div></div>`).join('');
  $('splitAfterL').textContent = pct ? `بعد نزول ${Math.round(kg * 10) / 10} كيلو` : 'بعد';
}

/** animate the slider toward target (one step every ~120 ms) */
let sliderRaf = null;
export function animateSlider(target) {
  cancelAnimationFrame(sliderRaf);
  const tick = () => {
    const v = +$('loss').value;
    if (v !== target) { $('loss').value = v + Math.sign(target - v); calc(); sliderRaf = requestAnimationFrame(() => setTimeout(tick, 120)); }
  };
  tick();
}
export const cancelSliderAnim = () => cancelAnimationFrame(sliderRaf);

export function build(ctx, hooks) {
  C = ctx;
  const st = ctx.state;
  document.querySelectorAll('#isex button').forEach((b) => (b.onclick = () => {
    document.querySelectorAll('#isex button').forEach((x) => x.classList.remove('on')); b.classList.add('on');
    st.sex = b.dataset.v; document.querySelectorAll('#sex button').forEach((x) => x.classList.toggle('on', x.dataset.v === st.sex));
  }));
  document.querySelectorAll('#complaint button').forEach((b) => (b.onclick = () => {
    document.querySelectorAll('#complaint button').forEach((x) => x.classList.remove('on')); b.classList.add('on');
    st.complaint = b.dataset.c; setCTA();
  }));
  $('go').onclick = () => {
    const w = +$('iw').value, h = +$('ih').value, waist = +$('iwaist').value;
    if (!(w > 0 && h > 100 && waist > 0)) { $('introErr').textContent = 'تأكد من إدخال الوزن والطول ومحيط الخصر'; return; }
    $('w').value = w; $('h').value = h; $('waist').value = waist; $('loss').value = 0; calc();
    $('intro').classList.add('hide'); $('ctabar').classList.add('show');
    setTimeout(hooks.startTour, 500);
  };
  document.querySelectorAll('#sex button').forEach((b) => (b.onclick = () => {
    document.querySelectorAll('#sex button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); st.sex = b.dataset.v; calc();
  }));
  ['w', 'h', 'waist', 'loss'].forEach((id) => $(id).addEventListener('input', calc));
  setCTA();
}
