// ui/cards.js — click-to-explain organ cards (raycast on userData.key) + camera focus.
import { $, P } from '../core/ctx.js';
import * as THREE from 'three';
import { flyTo } from './views.js';

export const CARDS = {
  heart: ['القلب ❤️', 'عضلة بحجم قبضة إيدك، بتضخ حوالي ٥ ليتر دم بالدقيقة. بالرسم بتشوف الأذينتين فوق والبطينين تحت، والشرايين التاجية يلي بتغذيه. الدهون الصفرا يلي لافّيته بتضغط عليه وبتلهب هالشرايين.'],
  epifat: ['الدهون حول القلب ⚠️', 'دهون ملتصقة بالقلب مباشرة بدون أي حاجز، وبتتجمع أول شي بالأخاديد يلي بتمشي فيها الشرايين التاجية. كل ما سمكت، بزيد خطر انسداد الشرايين واضطراب النبض. الخبر المنيح: هي من أول الدهون يلي بتدوب مع نزول الوزن.'],
  lungs: ['الرئتين 🫁', 'بياخدوا الأوكسجين من الهوا. لاحظ الشقوق يلي بتقسم كل رئة لفصوص. الكرش الكبير بيضغط عالحجاب الحاجز تحتهم، فبتحس حالك مقطوع نفس من أقل مجهود.'],
  liver: ['الكبد 🟤', 'أكبر عضو داخلي، مصفاة الجسم، بفصّين يمين ويسار بيفصلهم رباط رفيع، وتحته المرارة الخضرا. لما تزيد الدهون بتتخزن جواته وبيصير "كبد دهني": لونه بيفتح وبيتبقّع متل ما بتشوف. بينزل وزنك ٥٪ بس، بترجع تشوفه عم يغمق ويصحّ.'],
  stomach: ['المعدة 🍽️', 'كيس عضلي بيستقبل الأكل. بيتمدد مع الوجبات الكبيرة فبتحتاج كمية أكبر لتحس بالشبع، وبيرجع يصغر لما تعتاد على وجبات أصغر.'],
  si: ['المعي الدقيق', 'حوالي ٦ أمتار ملفوفين بدقة. هون بينمتص الغذا. الغشا يلي حامله (المساريقا) من أول الأماكن يلي بتتجمع فيها الدهون الحشوية.'],
  colon: ['المعي الغليظ', 'بيحيط بالمعي الدقيق متل البرواز. انتفاخاته المميزة اسمها "الهوسترات"، والأشرطة الطولانية عليه أشرطة عضلية. حواليه كمان بتتجمع دهون حشوية.'],
  kidney: ['الكلية', 'بتصفي الدم وبتعمل البول. محاطة طبيعياً بطبقة دهون بتحميها، بس الزيادة الكبيرة بترفع الضغط وبتجهد الكلية.'],
  omentum: ['الثرب (الشحم) 🟡', 'مريول من الشحم معلق من المعدة وبيغطي الأمعاء. هو السبب الرئيسي بـ"الكرش" القاسي، وهو أنشط نسيج دهني بالجسم بإفراز مواد الالتهاب يلي بترفع السكر والضغط.'],
  spleen: ['الطحال', 'مخزن كريات الدم ومصنع مناعة. موجود يسار المعدة.'],
  airway: ['مجرى التنفس 😴', 'من الأنف والفم إلى الحلق (البلعوم) ثم الحنجرة والرغامى وفروعها بالرئتين. بالليل بيرتخي الحلق، والدهون حول الرقبة والبطن بتضيّق المجرى فبيهتز النسيج الرخو وبيطلع الشخير، وأحياناً بينسدّ لثوانٍ. كل ما نزلت الدهون، كل ما اتّسع المجرى وهدأ النوم.'],
  pancreas: ['البنكرياس', 'غدة مستلقية خلف المعدة، رأسها بحضن الاثني عشر وذيلها عند الطحال. بتفرز الإنسولين. الدهون الحشوية بتخلّي الجسم يستجيب للإنسولين أقل، فبيشتغل البنكرياس أكتر وبيرتفع السكر.'],
  diaphragm: ['الحجاب الحاجز', 'عضلة التنفس الرئيسية، قبّة بين الصدر والبطن. لما تنقبض بتنزل وبتسحب الهوا للرئتين. الكرش الكبير بيدفعها لفوق وبيمنعها تنزل مداها، فبيصير النفَس قصير.'],
  aorta: ['الشريان الأبهر', 'أكبر شريان بالجسم، طالع من القلب وعامل قوس وبعدين نازل قدام العمود الفقري ليوزع الدم على كل الجسم. الدهون الزايدة بترفع الضغط جواته وبتقسي جدرانه.'],
};
const FOCUS = { heart: P(0.4, 1.5, 0.8), liver: P(-0.6, -0.3, 0.8), omentum: P(0, -2.4, 1.6), lungs: P(-1.6, 1.9, 0.5), colon: P(0, -2.6, 1), airway: null, kidney: P(1.3, -1.4, -1.2), stomach: P(1.2, -0.5, 0.6) };

let C, hooks;
export function showCard(key, point) {
  const c = CARDS[key]; if (!c) return;
  C.state.focusKey = key;
  $('ocardT').textContent = c[0]; $('ocardB').textContent = c[1]; $('ocard').classList.add('show');
  flyTo(point ? point.clone() : P(0, 0, 0));
}
export function hideCard() { C.state.focusKey = null; $('ocard').classList.remove('show'); }

export function build(ctx, h) {
  C = ctx; hooks = h;
  const ray = new THREE.Raycaster(); ray.layers.set(0); ray.layers.enable(ctx.LAYER.A);
  let down = null;
  ctx.renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; hooks.stopTour(); });
  ctx.renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 8 || ctx.state.mode === 'split') return;
    const r = ctx.renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), ctx.camera);
    const hits = ray.intersectObjects(ctx.scene.children, true).filter((h) => h.object.userData.key && h.object.userData.key !== 'skin' && h.object.visible);
    if (!hits.length) { hideCard(); return; }
    showCard(hits[0].object.userData.key, hits[0].point);
  });
  $('ocardX').onclick = hideCard;
  window.__focus = (key) => showCard(key, FOCUS[key] || (key === 'airway' && ctx.anchors.pharynxPos) || P(0, 0, 0));
}
