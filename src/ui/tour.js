// ui/tour.js — the guided SPIN tour (5 stations) and the end / result screen.
import { $ } from '../core/ctx.js';
import { M, CMAP, PAYOFF, calc, animateSlider, cancelSliderAnim } from './panel.js';
import { goView, setMode } from './views.js';
import { hideCard } from './cards.js';

let C, tour = null, hooks = {};

/** the SPIN tour: intro → the visitor's complaint → three physiology stations → 5-year warning → the other path.
 *  Station order adapts to the chosen complaint (CMAP). Each station: { view, text, slider, phys, dur } */
function steps() {
  const st = C.state, c = CMAP[st.complaint], lv = Math.round(M.lv);
  const bpTxt = M.bpT ? `مع نزول ${M.kgT} كغ ينخفض الرقم الأعلى بنحو ${Math.max(5, M.bpT - 4)}–${M.bpT + 2} نقاط تقريباً.` : '';
  const cause = {
    belly: `هذا سبب "${c.pain}" الذي أخبرتنا عنه: الثرب — مئزر شحمي يتدلى من معدتك ويغطي أمعاءك. هو ما يصنع الكرش الصلب، وهو أنشط الدهون في إفراز مواد ترفع السكر والضغط.`,
    breath: `هذا سبب "${c.pain}": دهون البطن تضغط على الحجاب الحاجز تحت رئتيك فلا تأخذان مداهما — لذلك تلهث من أقل مجهود. وقلبك يعمل من وراء طبقة دهون مع كل نبضة.`,
    snore: `هذا سبب "${c.pain}": الدهون حول البطن والرقبة تضيّق مجرى التنفس أثناء النوم — فتشخر وتستيقظ مرهقاً مهما نمت، وقلبك يدفع الثمن ليلاً.`,
    health: 'وهذا ما يظهر في تحاليلك: كبدك يخزّن الدهون — أترى لونه الفاتح المبقّع؟ هذا ما يرفع إنزيمات الكبد والسكر والدهون في الدم.',
  }[st.complaint];
  const S = {
    intro: { view: 'front', dur: 8000, slider: 0, text: `${st.sex === 'm' ? 'رجل' : 'امرأة'}${M.age ? '، ' + M.age + ' سنة' : ''}، ${M.w} كغ، محيط الخصر ${M.waist} سم. هذا جسمك من الداخل. الحبيبات الصفراء دهون خفية: لديك ${lv} من 30${lv >= 15 ? ' — فوق حد الأمان' : lv >= 10 ? ' — وقد بدأت ترتفع' : ''}.` },
    cause: { view: c.view, dur: 8000, slider: null, text: cause },
    heart: { view: 'heart', dur: 7500, slider: null, text: 'وقلبك؟ ملفوف بدهون تسير في أخاديد شرايينه نفسها — يعمل أثقل مما يجب مع كل نبضة، 24 ساعة في اليوم. اقترب أكثر وسترى الصمامات تفتح وتغلق والدم يتحرك داخل الحجرات.' },
    bp: { view: 'bp', dur: 11000, slider: null, phys: 'bp', text: `🩺 ضغط الدم: كل كيلو زائد حول الخصر يرفع الضغط قليلاً، فتنبض الشرايين أقوى وتقسو جدرانها — راقب موجة النبض الحية. ${bpTxt} (تقدير توعوي، ليس تشخيصاً)` },
    breath: { view: 'breath', dur: 12000, slider: null, phys: 'breath', text: '🫁 النفَس: دهون البطن تدفع الحجاب الحاجز إلى الأعلى فلا تمتلئ الرئتان بالكامل — لذلك تلهث على الدرج. شاهد اختبار الدرج: كم نفَساً تحتاج اليوم… وكم ستحتاج بعد النزول.' },
    snore: { view: 'snore', dur: 14000, slider: null, phys: 'sleep', text: '😴 الشخير: في الليل يرتخي الحلق، والدهون حول الرقبة والبطن تضيّق مجرى التنفس فيهتز النسيج ويصدر الشخير، وأحياناً ينغلق المجرى لثوانٍ ويهبط الأكسجين. مؤشراتك تقع في نطاق يرتبط عادةً بهذا. مع النزول يتّسع المجرى ويهدأ النوم. (تقدير توعوي، ليس تشخيصاً)' },
    warn: { view: 'front', dur: 10500, slider: -7, text: `⚠️ وماذا لو بقي كل شيء كما هو؟ هذا هو المسار الشائع خلال 5 سنوات: محيط خصرك ${M.waist} ← ${M.waist5} سم، ودهونك الخفية ${lv} ← ${M.lv5} من 30 — منطقة خطر السكري والضغط. وكلفتها ليست صحية فقط: أدوية وتحاليل مدى الحياة.` },
    path: { view: 'front', dur: 10000, slider: 'split', text: `وهذا هو الطريق الآخر — نزول ${M.kgT} كغ خلال ${M.mLo}–${M.mHi} أشهر: ${c.gain}، دهون قلبك أقل بنسبة ${M.fatDropT}%، وضغطك أدنى بنحو ${M.bpT} نقاط. أنت من يختار الطريق.` },
  };
  const order = {
    belly: ['intro', 'cause', 'heart', 'bp', 'breath', 'snore', 'warn', 'path'],
    breath: ['intro', 'cause', 'breath', 'heart', 'bp', 'snore', 'warn', 'path'],
    snore: ['intro', 'cause', 'snore', 'breath', 'heart', 'bp', 'warn', 'path'],
    health: ['intro', 'cause', 'bp', 'heart', 'breath', 'snore', 'warn', 'path'],
  }[st.complaint] || ['intro', 'cause', 'heart', 'bp', 'breath', 'snore', 'warn', 'path'];
  return order.map((k) => S[k]);
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
  const list = steps(), prev = list[tour.i];
  if (prev && prev.phys && hooks.physHide) hooks.physHide();
  tour.i++;
  if (tour.i >= list.length) { stopTour(); showEnd(); return; }
  const { view, text, slider, phys, dur } = list[tour.i];
  if (slider === 'split') { cancelSliderAnim(); $('loss').value = 12; calc(); setMode('split'); C.state.mode = 'tour'; tour.split = true; }
  else {
    if (C.state.mode !== 'tour') C.state.mode = 'tour';
    if (slider !== null && slider !== undefined) animateSlider(slider);
    goView(view);
    if (phys && hooks.physShow) setTimeout(() => { if (tour) hooks.physShow(phys); }, 900);
  }
  const tt = $('tourtext'); tt.style.opacity = 0;
  setTimeout(() => { tt.textContent = text; tt.style.opacity = 1; }, 300);
  $('tourdots').innerHTML = list.map((_, k) => `<i class="${k === tour.i ? 'on' : ''}"></i>`).join('');
  $('tourbar').classList.toggle('warn', slider === -7);
  tour.timer = setTimeout(next, dur || 8000);
}
export function stopTour() {
  if (!tour) return;
  const wasSplit = !!tour.split;
  clearTimeout(tour.timer); cancelSliderAnim(); tour = null;
  if (hooks.physHide) hooks.physHide();
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

export function build(ctx, h) {
  C = ctx; hooks = h || {};
  $('tourSkip').onclick = () => { stopTour(); $('loss').value = 12; calc(); if (ctx.state.mode !== 'split') setMode('split'); showEnd(); };
  $('tourX').onclick = stopTour;
  const closeEnd = () => { $('endscreen').classList.remove('show'); if (ctx.state.mode === 'split') setMode('normal'); };
  $('endX').onclick = closeEnd; $('exploreBtn').onclick = closeEnd;
  $('replay').onclick = () => { $('endscreen').classList.remove('show'); startTour(); };
}
