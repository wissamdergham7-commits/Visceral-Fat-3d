// ui/tour.js — the guided SPIN tour (5 stations) and the end / result screen.
import { $ } from '../core/ctx.js';
import { M, CMAP, PAYOFF, calc, animateSlider, cancelSliderAnim } from './panel.js';
import { goView, setMode } from './views.js';
import { hideCard } from './cards.js';

let C, tour = null;

function steps() {
  const st = C.state, c = CMAP[st.complaint], lv = Math.round(M.lv);
  const cause = {
    belly: `هذا سبب "${c.pain}" الذي أخبرتنا عنه: الثرب — مئزر شحمي يتدلى من معدتك ويغطي أمعاءك. هو ما يصنع الكرش الصلب، وهو أنشط الدهون في إفراز مواد ترفع السكر والضغط.`,
    breath: `هذا سبب "${c.pain}": دهون البطن تضغط على الحجاب الحاجز تحت رئتيك فلا تأخذان مداهما — لذلك تلهث من أقل مجهود. وقلبك يعمل من وراء طبقة دهون مع كل نبضة.`,
    snore: `هذا سبب "${c.pain}": الدهون حول البطن والرقبة تضيّق مجرى التنفس أثناء النوم — فتشخر وتستيقظ مرهقاً مهما نمت، وقلبك يدفع الثمن ليلاً.`,
    health: 'وهذا ما يظهر في تحاليلك: كبدك يخزّن الدهون — أترى لونه الفاتح المبقّع؟ هذا ما يرفع إنزيمات الكبد والسكر والدهون في الدم.',
  }[st.complaint];
  return [
    ['front', `${st.sex === 'm' ? 'رجل' : 'امرأة'}${M.age ? '، ' + M.age + ' سنة' : ''}، ${M.w} كغ، محيط الخصر ${M.waist} سم. هذا جسمك من الداخل. الحبيبات الصفراء دهون خفية: لديك ${lv} من 30${lv >= 15 ? ' — فوق حد الأمان' : lv >= 10 ? ' — وقد بدأت ترتفع' : ''}.`, 0],
    [c.view, cause, null],
    ['heart', 'وقلبك؟ ملفوف بدهون تسير في أخاديد شرايينه نفسها — يعمل أثقل مما يجب مع كل نبضة، 24 ساعة في اليوم.', null],
    ['front', `⚠️ وماذا لو بقي كل شيء كما هو؟ هذا هو المسار الشائع خلال 5 سنوات: محيط خصرك ${M.waist} ← ${M.waist5} سم، ودهونك الخفية ${lv} ← ${M.lv5} من 30 — منطقة خطر السكري والضغط. وكلفتها ليست صحية فقط: أدوية وتحاليل مدى الحياة.`, -7],
    ['front', `وهذا هو الطريق الآخر — نزول ${M.kgT} كغ خلال ${M.mLo}–${M.mHi} أشهر: ${c.gain}، دهون قلبك أقل بنسبة ${M.fatDropT}%، وضغطك أدنى بنحو ${M.bpT} نقاط. أنت من يختار الطريق.`, 'split'],
  ];
}

export function startTour() {
  stopTour();
  const st = C.state;
  if (st.mode !== 'normal') setMode('normal');
  st.mode = 'tour';
  $('loss').value = 0; calc(); hideCard();
  document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === 'tour'));
  tour = { i: -1, t: 0 };
  $('tourbar').classList.add('show');
  next();
}
function next() {
  if (!tour) return;
  tour.i++;
  const list = steps();
  if (tour.i >= list.length) { stopTour(); showEnd(); return; }
  const [view, text, slider] = list[tour.i];
  if (slider === 'split') { cancelSliderAnim(); $('loss').value = 12; calc(); setMode('split'); C.state.mode = 'tour'; tour.split = true; }
  else { if (C.state.mode !== 'tour') C.state.mode = 'tour'; if (slider !== null) animateSlider(slider); goView(view); }
  const tt = $('tourtext'); tt.style.opacity = 0;
  setTimeout(() => { tt.textContent = text; tt.style.opacity = 1; }, 300);
  $('tourdots').innerHTML = list.map((_, k) => `<i class="${k === tour.i ? 'on' : ''}"></i>`).join('');
  $('tourbar').classList.toggle('warn', slider === -7);
  tour.timer = setTimeout(next, [8000, 8000, 7500, 10500, 10000][tour.i] || 8000);
}
export function stopTour() {
  if (!tour) return;
  const wasSplit = !!tour.split;
  clearTimeout(tour.timer); cancelSliderAnim(); tour = null;
  $('tourbar').classList.remove('show'); $('tourbar').classList.remove('warn');
  if (C.state.mode === 'tour') {
    C.state.mode = wasSplit ? 'split' : 'normal';
    document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', wasSplit && b.dataset.mode === 'split'));
  }
  if (+$('loss').value < 0) { $('loss').value = 0; calc(); }
}
export function showEnd() {
  const c = CMAP[C.state.complaint];
  $('payLine').textContent = `تخيّل: ${PAYOFF[C.state.complaint]} — خلال ${M.mLo} أشهر فقط.`;
  $('endKg').textContent = M.kgT + ' كغ'; $('endWaist').textContent = `${M.waist} ← ${M.waistT} سم`;
  $('endM').textContent = `${M.mLo}–${M.mHi} أشهر`; $('endHeart').textContent = '−' + M.fatDropT + '%';
  $('gains').innerHTML = [['⭐', c.gain], ['❤️', `قلب أخف: دهونه أقل بنسبة ${M.fatDropT}%`], ['🩺', `ضغط أدنى بنحو ${M.bpT} نقاط، وخطر سكري أقل بالنصف تقريباً`]].map((g) => `<div>${g[0]} ${g[1]}</div>`).join('');
  $('endscreen').classList.add('show'); $('ctabar').classList.add('show');
}

export function build(ctx) {
  C = ctx;
  $('tourSkip').onclick = () => { stopTour(); $('loss').value = 12; calc(); if (ctx.state.mode !== 'split') setMode('split'); showEnd(); };
  $('tourX').onclick = stopTour;
  const closeEnd = () => { $('endscreen').classList.remove('show'); if (ctx.state.mode === 'split') setMode('normal'); };
  $('endX').onclick = closeEnd; $('exploreBtn').onclick = closeEnd;
  $('replay').onclick = () => { $('endscreen').classList.remove('show'); startTour(); };
}
