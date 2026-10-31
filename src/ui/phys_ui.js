// ui/phys_ui.js — live physiology overlays: blood-pressure gauge + arterial waveform, breathing / stairs test,
// sleep-snore night scene (pharynx cross-section, polysomnography strip, optional synthesised sound).
// Creates its own DOM + injected CSS inside #viewer at build time (no edits to template.html).
// Exports build(ctx, hooks) / update(f, t, phys) / show(panel) / hide();  panel = 'bp' | 'breath' | 'sleep'.
// Every number shown is an estimate (range), phrased non-diagnostically; see sim/physiology.js for the formulas.
import { $, clamp, lerp, smooth, gauss } from '../core/ctx.js';
import { palette } from '../core/style.js';
import * as sim from '../sim/physiology.js';

// (panel colours merged into core/style.js palette)

/* ---------- helpers ---------- */
const css = (h) => '#' + h.toString(16).padStart(6, '0');
const rgba = (h, a) => `rgba(${(h >> 16) & 255},${(h >> 8) & 255},${h & 255},${a})`;
const AR = (s) => String(s).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);
const R = (r, unit = '') => `${AR(r[0])}–${AR(r[1])}${unit}`;
const pct5 = (x) => { const v = Math.round(x * 20) * 5; return [Math.max(0, v - 5), Math.min(100, v + 5)]; };
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const CAT = ['ok', 'warn', 'bad'];
const BP_TIER = ['مؤشراتك تقع في نطاق يرتبط عادةً بضغط طبيعي 👍', 'مؤشراتك تقع في نطاق يرتبط عادةً بضغط أعلى من المثالي (طبيعي-مرتفع)', 'مؤشراتك تقع في نطاق يرتبط عادةً بارتفاع الضغط — يستحق قياساً حقيقياً عند الطبيب'];
const SLEEP_TIER = ['مؤشراتك تقع في نطاق يرتبط عادةً بنوم هادئ أو شخير خفيف', 'مؤشراتك تقع في نطاق يرتبط عادةً بشخير متكرر مع توقفات قصيرة أحياناً', 'مؤشراتك تقع في نطاق يرتبط عادةً بشخير عالٍ وتوقفات متكررة في النفَس أثناء النوم'];
const GAPS = ['نادرة أو معدومة', 'أحياناً (تقديرياً)', 'متكررة (تقديرياً)'];
const SNORE = ['خفيف', 'متوسط', 'عالٍ'];

const STYLE = `
#physRoot{position:absolute;inset:0;pointer-events:none;z-index:3;direction:rtl;--ptop:52px;--pbot:128px}
#physNight{position:absolute;inset:0;opacity:0;transition:opacity 1.4s;pointer-events:none;
  background:radial-gradient(120% 95% at 50% 115%,rgba(27,42,85,0) 0%,rgba(8,12,28,.5) 55%,rgba(3,5,14,.82) 100%)}
#physNight .moon{position:absolute;top:var(--ptop);right:16px;width:44px;height:44px;border-radius:50%;
  background:radial-gradient(circle at 38% 38%,#fff8dc 0%,#dfe5f8 55%,#aab9ea 100%);
  box-shadow:0 0 36px 10px rgba(170,185,235,.28),inset -13px -8px 0 2px rgba(10,16,38,.95)}
#physNight .clock{position:absolute;top:calc(var(--ptop) + 6px);right:70px;font-weight:800;font-size:22px;color:#e4eaff;letter-spacing:1px;text-shadow:0 2px 12px #000;direction:ltr}
#physNight .clock small{display:block;font-size:11px;font-weight:700;color:#aab6d8;letter-spacing:0;text-align:right;direction:rtl}
#physNight .zz{position:absolute;top:calc(var(--ptop) + 44px);right:30px;font-weight:800;color:#c7d2fe;font-size:14px;opacity:0;animation:physZz 3.2s ease-out infinite;direction:ltr}
#physNight .zz.b{animation-delay:1.1s;right:46px}#physNight .zz.c{animation-delay:2.2s;right:22px}
@keyframes physZz{0%{opacity:0;transform:translateY(0) scale(.7)}20%{opacity:.9}100%{opacity:0;transform:translateY(-34px) scale(1.2)}}
#physNight .stars{position:absolute;top:0;left:0;width:2px;height:2px;border-radius:50%;background:#fff;opacity:.8;
  box-shadow:60px 70px 0 0 #fff,140px 50px 0 0 #dfe6ff,220px 120px 0 0 #fff,310px 60px 0 0 #cfd8ff,420px 90px 0 0 #fff,520px 140px 0 0 #dfe6ff,640px 70px 0 0 #fff,720px 110px 0 0 #fff,90px 160px 0 0 #cfd8ff,380px 170px 0 0 #fff,560px 40px 0 0 #fff,800px 150px 0 0 #dfe6ff}
.phys-panel{position:absolute;top:var(--ptop);left:10px;width:372px;max-width:calc(100% - 20px);bottom:var(--pbot);overflow:auto;overscroll-behavior:contain;
  background:var(--panel);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);border:1px solid var(--line);border-radius:18px;padding:12px 14px 14px;
  pointer-events:auto;display:none;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.18) transparent;box-shadow:0 20px 50px -20px #000}
.phys-panel.show{display:block}
#physRoot.split .phys-panel{top:auto;width:300px;max-height:45%}
.phys-strip{display:flex;gap:6px;margin:6px 0 2px;align-items:stretch}
.phys-strip .phys-canvas{flex:1 1 0;min-width:0;width:auto}
.phys-stack{flex:none;width:88px;display:flex;flex-direction:column;gap:3px}
.phys-stack .phys-kv{flex:1;padding:2px 3px 2px;display:flex;flex-direction:column;justify-content:center;min-height:0}
.phys-stack .phys-kv b{font-size:12.5px;line-height:1.2}
.phys-stack .phys-kv span{font-size:9px;line-height:1.2;white-space:nowrap}
@media(max-width:640px){.phys-panel{right:10px;left:10px;width:auto;max-width:none;top:auto;bottom:var(--pbot);max-height:min(55%,calc(100% - var(--ptop) - var(--pbot)))}}
.phys-panel h3{margin:0 24px 2px 0;font-size:16px;font-weight:800;line-height:1.45}
.phys-hint{font-size:11.5px;color:var(--muted);margin-bottom:6px;line-height:1.5}
.phys-x{position:absolute;top:8px;left:10px;border:0;background:transparent;color:var(--muted);font-size:18px;cursor:pointer;font-weight:800;font-family:inherit}
.phys-live{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:8px 0}
.phys-kv{background:rgba(255,255,255,.05);border:1px solid var(--line);border-radius:12px;padding:6px 6px 5px;text-align:center;min-width:0}
.phys-kv b{display:block;font-size:17px;line-height:1.3;white-space:nowrap}
.phys-kv span{font-size:10.5px;color:var(--muted);line-height:1.35;display:block}
.phys-kv.ok b{color:#86efac}.phys-kv.warn b{color:#fdba74}.phys-kv.bad b{color:#fca5a5}
.phys-canvas{width:100%;display:block;border-radius:12px;background:rgba(6,10,22,.62);border:1px solid var(--line)}
.phys-cmp{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:8px 0}
.phys-col{background:rgba(255,255,255,.04);border-radius:12px;padding:7px 10px;border:1px solid var(--line)}
.phys-col.after{border-color:rgba(52,211,153,.45);background:rgba(52,211,153,.06)}
.phys-col h4{margin:0 0 4px;font-size:13px;font-weight:800}
.phys-col div{font-size:12px;display:flex;justify-content:space-between;gap:6px;line-height:1.6}
.phys-col div span{color:var(--muted)}
.phys-col div b{font-weight:700;white-space:nowrap}
.phys-col.after div b{color:#a7f3d0}
.phys-p{font-size:12.5px;color:#d7deea;margin:6px 0 0;line-height:1.65}
.phys-ref{font-size:10.5px;color:var(--muted);margin-top:6px;line-height:1.5;direction:rtl}
.phys-h4{margin:10px 0 4px;font-size:13.5px;font-weight:800}
.phys-row{display:flex;align-items:center;gap:8px;font-size:12px;margin:3px 0}
.phys-row span{flex:none;width:112px;color:var(--muted)}
.phys-bar{flex:1;height:8px;border-radius:99px;background:rgba(255,255,255,.12);overflow:hidden}
.phys-bar i{display:block;height:100%;border-radius:99px;background:var(--accent);width:0;transition:width .25s}
.phys-bar.warn i{background:linear-gradient(90deg,var(--warn),var(--bad))}
.phys-bar.fat i{background:var(--fat)}
.phys-btns{display:flex;gap:6px;margin:6px 0}
.phys-btn{flex:1;border:1px solid var(--line);background:rgba(255,255,255,.06);color:var(--ink);font:inherit;font-size:12.5px;font-weight:700;padding:7px 6px;border-radius:10px;cursor:pointer}
.phys-btn.on{border-color:rgba(52,211,153,.6);background:rgba(52,211,153,.14);color:#a7f3d0}
.phys-btn.small{flex:none;padding:5px 10px;font-size:12px}
.phys-status{font-size:12.5px;font-weight:700;margin:4px 0;min-height:20px;color:#fde68a}
.phys-tier{font-size:12.5px;border-radius:12px;padding:7px 10px;border-right:4px solid;background:rgba(255,255,255,.05);margin:6px 0;line-height:1.55}
.phys-tier.ok{border-color:var(--ok)}.phys-tier.warn{border-color:var(--warn)}.phys-tier.bad{border-color:var(--bad)}
.phys-rowx{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:6px 0;font-size:12.5px}
.phys-rowx b{color:#fca5a5}
.phys-delta{font-size:13px;font-weight:800;color:#a7f3d0;margin:2px 0 4px}
`;

/* ---------- module state ---------- */
let C, hooks, root, night, clockEl, tourbar, nightK = 0, current = null, lastText = -1, audio = null, soundOn = false, lastProfile = -1, lastArousal = 0, lastNow = 0, lastF = 0.5, lastT = 0, lastSplit = false, lastTour = false;
let frame = 0;
const panels = {}, chips = {}, q = {};     // q[panel][key] -> element
const traces = {};                         // sweep traces per canvas
const scenes = {};                         // pharynx scenes (particles)

/* =================================================================== build ======== */
export function build(ctx, h) {
  C = ctx; hooks = h || {};
  const style = document.createElement('style'); style.id = 'physStyle'; style.textContent = STYLE; document.head.appendChild(style);
  root = el('<div id="physRoot"></div>');
  night = el('<div id="physNight"><i class="stars"></i><div class="moon"></div><div class="clock"><span data-k="clock">23:40</span><small>مشهد ليلي مُسرَّع</small></div><span class="zz">z</span><span class="zz b">z</span><span class="zz c">Z</span></div>');
  night.style.display = 'none';                       // hidden until the night scene starts (show('sleep') or ctx.state.sleep)
  clockEl = night.querySelector('[data-k=clock]');
  tourbar = $('tourbar');
  root.appendChild(night);
  panels.bp = el(`<div class="phys-panel" data-panel="bp"><button class="phys-x" aria-label="إغلاق">✕</button>
    <h3>🩺 الضغط الشرياني</h3>
    <div class="phys-hint">موجة الضغط داخل شرايينك كما تقدّرها مؤشراتك (العمر، الوزن، محيط الخصر) · تقدير توعوي، ليس تشخيصاً</div>
    <canvas class="phys-canvas" data-c="bpwave"></canvas>
    <div class="phys-live">
      <div class="phys-kv" data-k="sbp"><b>—</b><span>الانقباضي<br>الرقم العالي</span></div>
      <div class="phys-kv" data-k="dbp"><b>—</b><span>الانبساطي<br>الرقم الواطي</span></div>
      <div class="phys-kv" data-k="hr"><b>—</b><span>النبض/د<br>في المشهد</span></div>
    </div>
    <div class="phys-tier" data-k="tier"></div>
    <div class="phys-cmp">
      <div class="phys-col"><h4>اليوم</h4><div><span>الانقباضي</span><b data-k="t_sbp"></b></div><div><span>الانبساطي</span><b data-k="t_dbp"></b></div><div><span>النبض بالراحة</span><b data-k="t_hr"></b></div></div>
      <div class="phys-col after"><h4 data-k="afterT">بعد النزول</h4><div><span>الانقباضي</span><b data-k="a_sbp"></b></div><div><span>الانبساطي</span><b data-k="a_dbp"></b></div><div><span>النبض بالراحة</span><b data-k="a_hr"></b></div></div>
    </div>
    <div class="phys-delta" data-k="delta"></div>
    <p class="phys-p">الدهون المخفية بتفرز مواد بتضيّق الشرايين الصغيرة، وبتخلّي الكلية تحبس ملح وماء أكتر، وبتقسّي جدار الشريان مع الوقت — فبترتفع الموجة وبتصير أحدّ (لاحظ الصعود السريع والقمة الحادّة). كل كيلو بينزل من الدهون بيخفّف الرقم العالي حوالي ١ ملم زئبق.</p>
    <div class="phys-ref">المراجع: Neter et al. 2003 (−١٫٠٥ / −٠٫٩٢ ملم زئبق لكل كغ) · Franklin 1997 (العمر) · INTERSALT 1994 (مؤشر الكتلة) · Siani 2002 (محيط الخصر) · تصنيف ESC/ESH 2018. الشريط يعرض نطاقاً تقريبياً لا قياساً.</div>
  </div>`);
  panels.breath = el(`<div class="phys-panel" data-panel="breath"><button class="phys-x" aria-label="إغلاق">✕</button>
    <h3>🫁 النفَس والحجاب الحاجز</h3>
    <div class="phys-hint">كيف بتأثر دهون البطن على كل نفَس، وشو بيصير لما تطلع طابقين · تقدير توعوي، ليس تشخيصاً</div>
    <div class="phys-live">
      <div class="phys-kv" data-k="rr"><b>—</b><span>نفَس/د<br>في المشهد</span></div>
      <div class="phys-kv" data-k="dia"><b>—</b><span>مدى حركة الحجاب<br>(تقديري)</span></div>
      <div class="phys-kv" data-k="hr"><b>—</b><span>النبض/د<br>في المشهد</span></div>
    </div>
    <div class="phys-row"><span>مدى الحجاب الحاجز</span><div class="phys-bar"><i data-k="diaBar"></i></div></div>
    <div class="phys-row"><span>عمق النفَس</span><div class="phys-bar"><i data-k="tidalBar"></i></div></div>
    <div class="phys-row"><span>الجهد / اللهاث</span><div class="phys-bar warn"><i data-k="effBar"></i></div></div>
    <h4 class="phys-h4">🪜 اختبار الدرج: طابقان بخطوة عادية</h4>
    <canvas class="phys-canvas" data-c="stairs"></canvas>
    <div class="phys-btns"><button class="phys-btn" data-k="runToday">▶ جرّب بجسمك اليوم</button><button class="phys-btn" data-k="runAfter">▶ جرّب بعد النزول</button></div>
    <div class="phys-status" data-k="status">اضغط لتشوف نبضك ونفَسك وأنت تطلع طابقين (الزمن مُسرَّع ×٣)</div>
    <div class="phys-cmp">
      <div class="phys-col"><h4>اليوم</h4><div><span>نفَس/د عالدرج</span><b data-k="t_rr"></b></div><div><span>النبض عالدرج</span><b data-k="t_hr"></b></div><div><span>وقت الهدوء</span><b data-k="t_rec"></b></div><div><span>مدى الحجاب</span><b data-k="t_dia"></b></div></div>
      <div class="phys-col after"><h4 data-k="afterT">بعد النزول</h4><div><span>نفَس/د عالدرج</span><b data-k="a_rr"></b></div><div><span>النبض عالدرج</span><b data-k="a_hr"></b></div><div><span>وقت الهدوء</span><b data-k="a_rec"></b></div><div><span>مدى الحجاب</span><b data-k="a_dia"></b></div></div>
    </div>
    <p class="phys-p">كل ما كبر الكرش، بيدفع الحجاب الحاجز لفوق وبيمنعه ينزل بحرية، فالجزء السفلي من الرئتين ما بيتمدد: بتاخد أنفاس أقصر وأسرع، والقلب بيضطر يعوّض بنبض أعلى — هيك بتلهث على الدرج وبتحتاج وقت أطول لترتاح.</p>
    <div class="phys-ref">المراجع: Jones & Nzekwu 2006 (الحجم الاحتياطي الزفيري بينزل أُسّياً مع مؤشر الكتلة) · Salome 2010 · Babb 2008 (ضيق النفَس مع الجهد) · Brinkworth 2006 (تعافي النبض بيتحسّن مع نزول الوزن).</div>
  </div>`);
  panels.sleep = el(`<div class="phys-panel" data-panel="sleep"><button class="phys-x" aria-label="إغلاق">✕</button>
    <h3>😴 النوم والشخير</h3>
    <div class="phys-hint">ليش بتشخر وليش بيوقف نفَسك · مشهد توعوي، ليس تشخيصاً</div>
    <canvas class="phys-canvas" data-c="pharynx"></canvas>
    <div class="phys-strip">
      <canvas class="phys-canvas" data-c="strip"></canvas>
      <div class="phys-stack">
        <div class="phys-kv" data-k="airway"><b>—</b><span>مجرى الهواء</span></div>
        <div class="phys-kv" data-k="spo2"><b>—</b><span>أوكسجين الدم بالمشهد</span></div>
        <div class="phys-kv" data-k="hr"><b>—</b><span>النبض/د بالمشهد</span></div>
      </div>
    </div>
    <div class="phys-rowx"><span data-k="events">توقفات في المشهد: ٠</span><button class="phys-btn small" data-k="sound">🔇 الصوت مطفأ</button></div>
    <div class="phys-tier" data-k="tier"></div>
    <div class="phys-cmp">
      <div class="phys-col"><h4>اليوم</h4><div><span>محيط الرقبة*</span><b data-k="t_neck"></b></div><div><span>اتساع المجرى</span><b data-k="t_pat"></b></div><div><span>الشخير</span><b data-k="t_snore"></b></div><div><span>التوقفات</span><b data-k="t_gaps"></b></div></div>
      <div class="phys-col after"><h4 data-k="afterT">بعد النزول</h4><div><span>محيط الرقبة*</span><b data-k="a_neck"></b></div><div><span>اتساع المجرى</span><b data-k="a_pat"></b></div><div><span>الشخير</span><b data-k="a_snore"></b></div><div><span>التوقفات</span><b data-k="a_gaps"></b></div></div>
    </div>
    <canvas class="phys-canvas" data-c="cmp"></canvas>
    <p class="phys-p">بالنوم بترتخي عضلات الحلق، والدهون حوالين البلعوم (من الجانبين) وفي قاعدة اللسان بتضيّق الممر: الهوا بيمرّ بممر ضيق فبيهتز سقف الحلق اللين (هذا الشخير)، وأحياناً بينسدّ الممر كلياً فبيوقف النفَس لثوانٍ، بينزل الأوكسجين بالدم، وبيصحى الدماغ لحظة ليفتح الممر — مرات كتير بالليلة من دون ما تنتبه. مع نزول الوزن بيتوسّع الممر وبتقلّ الاهتزازات والتوقفات.</p>
    <div class="phys-ref">* محيط الرقبة تقدير إرشادي من الوزن والطول والجنس (Ben-Noun 2001). المراجع: عناصر STOP-Bang (Chung 2008) · Peppard 2000 (نزول ١٠٪ من الوزن ↔ توقفات أقل بنحو ربع) · Young 1993 · Schwab 1995 (الدهون الجانبية حول البلعوم) · دليل AASM 2012 لتعريف التوقف (≥ ١٠ ثوانٍ).</div>
  </div>`);
  for (const k of Object.keys(panels)) {
    root.appendChild(panels[k]);
    q[k] = {};
    panels[k].querySelectorAll('[data-k]').forEach((n) => (q[k][n.dataset.k] = n));
    panels[k].querySelector('.phys-x').onclick = hide;
    panels[k].querySelectorAll('canvas[data-c]').forEach((c) => { const tr = makeTrace(c); traces[c.dataset.c] = tr; });
  }
  traces.bpwave.cssH = 104; traces.stairs.cssH = 160; traces.pharynx.cssH = 168; traces.strip.cssH = 105; traces.cmp.cssH = 150;
  ctx.viewer.appendChild(root);

  /* chips in the existing bar */
  const bar = ctx.viewer.querySelector('.chips');
  if (bar) {
    bar.appendChild(el('<span class="sep"></span>'));
    for (const [k, label] of [['bp', '🩺 الضغط'], ['breath', '🫁 النفَس'], ['sleep', '😴 النوم']]) {
      chips[k] = el(`<button class="chip mode" data-phys="${k}">${label}</button>`);
      chips[k].onclick = () => (current === k ? hide() : show(k));
      bar.appendChild(chips[k]);
    }
  }
  /* buttons */
  q.breath.runToday.onclick = () => runStairs('today');
  q.breath.runAfter.onclick = () => runStairs('after');
  q.sleep.sound.onclick = toggleSound;

  scenes.live = makeScene(); scenes.today = makeScene(); scenes.after = makeScene();
  const ro = new ResizeObserver(layout); ro.observe(ctx.viewer); if (bar) ro.observe(bar);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);
  layout();
  /* test hook: advance the simulation + overlays deterministically (sub-steps of 50 ms). It reads ctx.state.fCur and
     eases it toward fTgt exactly like main.js (stops within 8e-4), so it exercises the real code path after __setLoss(). */
  const advance = (sec) => {
    const st = C.state, n = Math.ceil(sec / 0.05), k = 1 - Math.exp(-0.05 * 3.2);
    for (let i = 0; i < n; i++) {
      if (st.fCur < 0) st.fCur = st.fTgt;
      if (Math.abs(st.fCur - st.fTgt) > 8e-4) st.fCur = lerp(st.fCur, st.fTgt, k);
      lastT += 0.05; update(st.fCur, lastT, sim.step(st.fCur, lastT, 0.05));
    }
  };
  window.__physUI = { show, hide, sim, advance, traces };          // traces: canvas sweeps (tests may enlarge cssH for zoomed captures)
}

/* keep panels between the chips bar and the HUD (or the tour bar while the tour runs: measured, not a fixed offset) */
function layout() {
  const bar = C.viewer.querySelector('.chips'), hud = C.viewer.querySelector('.hud');
  const top = bar ? bar.offsetTop + bar.offsetHeight + 8 : 52;
  let bot = hud ? hud.offsetHeight + 20 : 128;
  if (tourbar && tourbar.classList.contains('show')) {
    const vr = C.viewer.getBoundingClientRect();
    const tbTop = tourbar.offsetParent === C.viewer ? tourbar.offsetTop : tourbar.getBoundingClientRect().top - vr.top;
    if (tbTop > 0) bot = Math.max(bot, Math.round(vr.height - tbTop) + 8);
  }
  root.style.setProperty('--ptop', top + 'px'); root.style.setProperty('--pbot', bot + 'px');
  if (current) fitAll(current);
}

/* =================================================================== show / hide == */
export function show(panel) {
  if (!panels[panel]) return;
  if (current && current !== panel) { panels[current].classList.remove('show'); chips[current] && chips[current].classList.remove('on'); }
  current = panel;
  panels[panel].classList.add('show'); chips[panel] && chips[panel].classList.add('on');
  hooks.hideCard && hooks.hideCard();
  layout(); fitAll(panel);
  lastText = -1; lastProfile = -1;
  if (panel === 'sleep') { C.state.sleep = true; sim.setSleep(true); }      // the overlay follows ctx.state.sleep in update()
  else endSleepScene();
  if (panel !== 'breath') sim.stopStairs();
}
export function hide() {
  if (current) { panels[current].classList.remove('show'); chips[current] && chips[current].classList.remove('on'); }
  current = null;
  endSleepScene();
  sim.stopStairs();
}
function endSleepScene() {
  C.state.sleep = false; sim.setSleep(false);
  if (soundOn) toggleSound(false);
}
function fitAll(panel) {
  panels[panel].querySelectorAll('canvas[data-c]').forEach((c) => fitCanvas(traces[c.dataset.c]));
}

/* =================================================================== update ======= */
export function update(f, t, phys) {
  lastF = f; lastT = t;
  const now = performance.now(), dtWall = clamp((now - lastNow) / 1000, 0, 0.5); lastNow = now;
  /* panel docking follows the page mode (split view keeps both bodies visible) and the tour bar */
  const split = C.state.mode === 'split', tourOn = !!(tourbar && tourbar.classList.contains('show'));
  if (split !== lastSplit) { lastSplit = split; root.classList.toggle('split', split); layout(); }
  if (tourOn !== lastTour) { lastTour = tourOn; layout(); setTimeout(layout, 400); }   // again after the bar's slide-in transition
  /* night lighting + overlay (eased on wall-clock time), driven by ctx.state.sleep — set by show('sleep') or by the
     integrator / tour directly — and still running while fading out after hide(); display:none whenever fully day */
  const target = C.state.sleep ? 1 : 0;
  if (target === 1 && night.style.display === 'none') { night.style.display = ''; void night.offsetWidth; }   // reflow so the opacity transition runs
  if (Math.abs(nightK - target) > 1e-3) {
    nightK = lerp(nightK, target, 1 - Math.exp(-dtWall * 1.6));
    if (Math.abs(nightK - target) < 1e-3) nightK = target;
    C.setNight(nightK);
    night.style.opacity = nightK.toFixed(3);
    if (nightK === 0) night.style.display = 'none';
  }
  frame++;
  if (nightK > 0 && (frame & 7) === 0) {                                      // compressed night clock (also without the panel)
    const m = Math.floor(phys.nightClock / 60) % 24, s = Math.floor(phys.nightClock % 60);
    clockEl.textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }
  if (audio && soundOn) driveAudio(phys);
  if (!current) return;
  const dt = phys.dt || 0.016, perf = C.state.perf ?? 2;
  if (current === 'bp') drawBP(traces.bpwave, phys, dt);
  if (current === 'breath') drawStairs(traces.stairs, phys, t);
  if (current === 'sleep') {
    /* ctx.state.perf: 2 = every frame, 1 = compare section at 1/4 rate, 0 = pharynx at half rate + compare at 1/8 */
    const skipPh = perf === 0 && (frame & 1), every = perf >= 2 ? 2 : perf === 1 ? 4 : 8;
    if (!skipPh) drawPharynxLive(traces.pharynx, phys, t, dt * (perf === 0 ? 2 : 1));
    drawStrip(traces.strip, phys, dt);
    if (frame % every === 0) drawCompare(traces.cmp, phys, t, dt * every);
  }
  if (t - lastText > 0.25) { lastText = t; texts(phys); }
}

/* ---------- text / numbers (4 Hz) ---------- */
function texts(phys) {
  const L = phys.live, T = phys.today, A = phys.after, P = C.state.profile || {};
  const kv = (n, v, cls) => { if (!n) return; n.firstElementChild.textContent = v; if (cls !== undefined) n.className = 'phys-kv ' + cls; };
  const afterT = P.kgLoss > 0 ? `بعد نزول ${AR(Math.round(P.kgLoss * 10) / 10)} كغ` : P.kgLoss < 0 ? `بعد زيادة ${AR(Math.round(-P.kgLoss * 10) / 10)} كغ` : 'بعد (حرّك الشريط)';
  const sbpR = bucket5(phys.sbp), dbpR = bucket5(phys.dbp), cat = phys.sbp >= 140 || phys.dbp >= 90 ? 2 : phys.sbp >= 130 || phys.dbp >= 85 ? 1 : 0;
  if (current === 'bp') {
    const Q = q.bp;
    kv(Q.sbp, R(sbpR), CAT[cat]); kv(Q.dbp, R(dbpR), CAT[cat]); kv(Q.hr, R(pm(phys.hr, 2)), '');
    Q.tier.textContent = BP_TIER[cat]; Q.tier.className = 'phys-tier ' + CAT[cat];
    if (lastProfile !== C.state.profileVersion) {
      Q.afterT.textContent = afterT;
      Q.t_sbp.textContent = R(T.sbpR); Q.t_dbp.textContent = R(T.dbpR); Q.t_hr.textContent = R(T.hrR);
      Q.a_sbp.textContent = R(A.sbpR); Q.a_dbp.textContent = R(A.dbpR); Q.a_hr.textContent = R(A.hrR);
      const d = T.sbp - A.sbp;
      Q.delta.textContent = d > 0.5 ? `الفرق المتوقع بالرقم العالي: −${AR(Math.max(1, Math.round(d) - 2))} إلى −${AR(Math.round(d) + 2)} ملم زئبق (≈ ١ ملم لكل كغ)` : d < -0.5 ? `لو زاد الوزن: +${AR(Math.max(1, Math.round(-d) - 2))} إلى +${AR(Math.round(-d) + 2)} ملم زئبق` : 'حرّك الشريط لتشوف كيف بيتغيّر الضغط مع نزول الوزن';
    }
  }
  if (current === 'breath') {
    const Q = q.breath, S = phys.stairs;
    kv(Q.rr, R(pm(phys.breathRate, 1)), phys.breathRate > 24 ? 'bad' : phys.breathRate > 17 ? 'warn' : 'ok');
    kv(Q.dia, R(pct5(phys.diaphragmTravel), '٪'), phys.diaphragmTravel < 0.68 ? 'bad' : phys.diaphragmTravel < 0.85 ? 'warn' : 'ok');
    kv(Q.hr, R(pm(phys.hr, 2)), phys.hr > 120 ? 'bad' : phys.hr > 95 ? 'warn' : '');
    Q.diaBar.style.width = Math.round(phys.diaphragmTravel * 100) + '%';
    Q.tidalBar.style.width = Math.round(phys.tidalDepth * 100) + '%';
    Q.effBar.style.width = Math.round(phys.effort * 100) + '%';
    Q.runToday.classList.toggle('on', S.on && S.body === 'today'); Q.runAfter.classList.toggle('on', S.on && S.body === 'after');
    if (S.on) {
      const who = S.body === 'after' ? 'بعد النزول' : 'بجسمك اليوم';
      if (S.phase === 'climb') Q.status.textContent = `${who}: عم تطلع… النبض ≈ ${AR(Math.round(phys.hr))} · النفَس ≈ ${AR(Math.round(phys.breathRate))}/د`;
      else if (S.phase === 'recover') Q.status.textContent = `${who}: وصلت فوق. عم ترتاح… النبض ≈ ${AR(Math.round(phys.hr))} (مرّ ${AR(Math.round(S.simT - S.climb))} ث)`;
      else if (S.result) Q.status.textContent = `${who}: رجع النبض يهدا خلال ≈ ${R([Math.round(S.result.recoverT * 0.9 / 5) * 5, Math.round(S.result.recoverT * 1.1 / 5) * 5], ' ث')} · ذروة النفَس ≈ ${AR(Math.round(S.result.peakRR))}/د`;
    }
    if (lastProfile !== C.state.profileVersion) {
      Q.afterT.textContent = afterT;
      Q.t_rr.textContent = R(T.peakRRR); Q.t_hr.textContent = R(T.peakHrR); Q.t_rec.textContent = R(T.recoverR, ' ث'); Q.t_dia.textContent = R(pct5(T.diaphragmTravel), '٪');
      Q.a_rr.textContent = R(A.peakRRR); Q.a_hr.textContent = R(A.peakHrR); Q.a_rec.textContent = R(A.recoverR, ' ث'); Q.a_dia.textContent = R(pct5(A.diaphragmTravel), '٪');
    }
  }
  if (current === 'sleep') {
    const Q = q.sleep, p = phys.airwayPatency;
    const state = phys.apneaEvent ? ['مغلق ⛔', 'bad'] : phys.arousal > 0.5 ? ['انفتح 😮', 'warn'] : phys.snoreIntensity > 0.12 ? ['ضيّق يهتز', 'warn'] : p < 0.7 ? ['ضيّق', 'warn'] : ['مفتوح', 'ok'];
    kv(Q.airway, state[0], state[1]);
    kv(Q.spo2, R(pm(phys.spo2, 1), '٪'), phys.spo2 < 90 ? 'bad' : phys.spo2 < 94 ? 'warn' : 'ok');
    kv(Q.hr, R(pm(phys.hr, 2)), phys.arousal > 0.5 ? 'warn' : '');
    Q.events.innerHTML = `توقفات في المشهد: <b>${AR(phys.eventCount)}</b>` + (phys.longestEvent ? ` · أطول توقف ≈ ${AR(Math.round(phys.longestEvent))} ث` : '');
    Q.tier.textContent = SLEEP_TIER[phys.tier] + ` · محيط الرقبة التقديري ≈ ${R([Math.round(phys.neck - 1.5), Math.round(phys.neck + 1.5)], ' سم')}`;
    Q.tier.className = 'phys-tier ' + CAT[phys.tier];
    if (lastProfile !== C.state.profileVersion) {
      Q.afterT.textContent = afterT;
      const lvl = (x) => (x < 0.3 ? 0 : x < 0.6 ? 1 : 2);
      Q.t_neck.textContent = R(T.neckR, ' سم'); Q.a_neck.textContent = R(A.neckR, ' سم');
      Q.t_pat.textContent = R(pct5(T.patencySleep), '٪'); Q.a_pat.textContent = R(pct5(A.patencySleep), '٪');
      Q.t_snore.textContent = SNORE[lvl(T.snoreLevel)]; Q.a_snore.textContent = SNORE[lvl(A.snoreLevel)];
      Q.t_gaps.textContent = GAPS[T.tier]; Q.a_gaps.textContent = GAPS[A.tier];
    }
  }
  lastProfile = C.state.profileVersion;
}
const bucket5 = (x) => { const lo = 5 * Math.round((x - 2.5) / 5); return [lo, lo + 5]; };
const pm = (x, d) => { const r = Math.round(x); return [r - d, r + d]; };      // scene value shown as a ± range

/* =================================================================== canvases ===== */
function makeTrace(c) { return { c, g: c.getContext('2d'), x: 0, w: 0, h: 0, dpr: 1, cssH: 100, buf: null }; }
function fitCanvas(tr) {
  const w = Math.max(120, Math.round(tr.c.clientWidth || (tr.c.parentElement && tr.c.parentElement.clientWidth - 28) || 300));
  const dpr = (C.state.perf ?? 2) >= 2 ? Math.min(2, window.devicePixelRatio || 1) : 1;   // slow devices: 1x canvases
  if (tr.w !== w || tr.h !== tr.cssH || tr.dpr !== dpr) {
    tr.c.width = Math.round(w * dpr); tr.c.height = Math.round(tr.cssH * dpr); tr.c.style.height = tr.cssH + 'px';
    tr.w = w; tr.h = tr.cssH; tr.dpr = dpr; tr.buf = null; tr.x = 0;
  }
}
function begin(tr) { const g = tr.g; g.setTransform(tr.dpr, 0, 0, tr.dpr, 0, 0); g.clearRect(0, 0, tr.w, tr.h); g.font = '11px Cairo, system-ui, sans-serif'; g.direction = 'rtl'; return g; }
/** advance a sweep by dt and return the list of newly written columns [from, to) (wrapping) */
function sweep(tr, dt, seconds) {
  const speed = tr.w / seconds, x0 = Math.floor(tr.x); tr.x = (tr.x + dt * speed) % tr.w;
  const n = Math.min(tr.w, Math.floor(tr.x) - x0 + (tr.x < x0 ? tr.w : 0));
  return { x0, n, speed };
}

/* ---------- A) arterial pressure sweep ---------- */
function drawBP(tr, phys, dt) {
  if (tr.w === 0) fitCanvas(tr);
  const w = tr.w, h = tr.h;
  if (!tr.buf) {                                                   // pre-fill with the recent history so the panel opens full
    tr.buf = new Float32Array(w); tr.x = 0; const sp = w / 4.2;
    for (let i = 0; i < w; i++) tr.buf[i] = sim.arterialPressure(phys.heartPhase - ((w - i) / sp) * phys.hr / 60);
  }
  const { x0, n, speed } = sweep(tr, dt, 4.2);
  for (let i = 1; i <= n; i++) { const col = (x0 + i) % w, back = (n - i) / speed; tr.buf[col] = sim.arterialPressure(phys.heartPhase - back * phys.hr / 60); }
  const g = begin(tr), lo = 45, hi = 180, Y = (p) => h - 6 - (p - lo) / (hi - lo) * (h - 14);
  /* grid */
  g.strokeStyle = rgba(palette.traceGrid, 0.55); g.lineWidth = 1; g.setLineDash([3, 4]);
  for (const p of [80, 120, 140, 160]) { g.beginPath(); g.moveTo(0, Y(p)); g.lineTo(w, Y(p)); g.stroke(); }
  g.setLineDash([]); g.fillStyle = 'rgba(154,168,191,.85)'; g.textAlign = 'right'; g.font = '10px Cairo, system-ui, sans-serif';
  for (const p of [80, 120, 140, 160]) g.fillText(AR(p), w - 4, Y(p) - 2);
  /* trace */
  const head = Math.floor(tr.x), gap = 14, col = palette.bloodOxy;
  g.beginPath(); let open = false;
  for (let k = 0; k < w; k++) {
    const i = (head + gap + 1 + k) % w, v = tr.buf[i];
    const inGap = ((i - head + w) % w) <= gap;
    if (isNaN(v) || inGap || i === 0 && k > 0) { open = false; continue; }
    if (!open) { g.moveTo(i, Y(v)); open = true; } else g.lineTo(i, Y(v));
  }
  g.strokeStyle = css(col); g.lineWidth = 2; g.shadowColor = rgba(col, 0.9); g.shadowBlur = 8; g.lineJoin = 'round'; g.stroke(); g.shadowBlur = 0;
  /* head dot */
  const hv = tr.buf[head]; if (!isNaN(hv)) { g.fillStyle = '#fff'; g.beginPath(); g.arc(head, Y(hv), 2.5, 0, 7); g.fill(); }
  g.fillStyle = 'rgba(154,168,191,.9)'; g.textAlign = 'left'; g.font = '10.5px Cairo, system-ui, sans-serif'; g.direction = 'ltr';
  g.fillText('mmHg', 6, 12);
  g.direction = 'rtl'; g.textAlign = 'right'; g.fillStyle = 'rgba(238,242,248,.85)';
  g.fillText(phys.stiffness > 0.55 ? 'شرايين أقسى: صعود حاد وقمة أعلى' : 'موجة شريانية: صعود، قمة، ثلمة ثم انحدار', w - 4, h - 8);
}

/* ---------- B) stairs test ---------- */
function drawStairs(tr, phys, t) {
  if (tr.w === 0) fitCanvas(tr);
  const g = begin(tr), w = tr.w, h = tr.h, S = phys.stairs, E = (S.on && S.E) || phys.today;
  const load = E.load, running = S.on && S.phase !== 'idle';
  /* staircase: 12 steps rising from right-bottom to left-top (RTL reading direction) across 62 % of the width, so the
     numbers column at the top-right sits above the low steps and never collides with the figure at the top */
  const sx = w - 10, sy = h - 12, nSteps = 12, stepW = (w * 0.62 - 10) / nSteps, stepH = (h - 70) / nSteps;
  g.fillStyle = 'rgba(255,255,255,.06)'; g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(sx, sy);
  for (let i = 0; i < nSteps; i++) { g.lineTo(sx - i * stepW, sy - (i + 1) * stepH); g.lineTo(sx - (i + 1) * stepW, sy - (i + 1) * stepH); }
  g.lineTo(sx - nSteps * stepW, sy); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = 'rgba(154,168,191,.8)'; g.textAlign = 'left'; g.direction = 'rtl';
  g.fillText('الطابق ٢', sx - nSteps * stepW - 2, sy - nSteps * stepH - 6);
  /* figure position along the climb (faces left = climbing direction) */
  const prog = !S.on ? 0 : S.phase === 'climb' ? clamp(S.simT / S.climb, 0, 1) : 1;
  const idx = prog * nSteps, fx = sx - idx * stepW - stepW * 0.5, fy = sy - Math.ceil(idx) * stepH;
  const cad = S.phase === 'climb' ? Math.sin(S.steps * Math.PI) : 0, br = phys.breath, bob = running ? 1.5 * br : 0.6 * br;
  const belly = 3 + 7 * load, ink = css(palette.figureInk);
  g.save(); g.translate(fx, fy - bob); g.scale(-1.45, 1.45);
  g.strokeStyle = ink; g.lineWidth = 2; g.lineCap = 'round';
  /* legs */
  g.beginPath(); g.moveTo(0, -14); g.lineTo(-4 + 5 * cad, -2 + Math.abs(cad) * 2); g.moveTo(0, -14); g.lineTo(4 - 5 * cad, -1); g.stroke();
  /* torso + belly */
  g.beginPath(); g.moveTo(0, -14); g.lineTo(2, -30); g.stroke();
  g.fillStyle = rgba(palette.subcutFat, 0.85); g.beginPath(); g.ellipse(3 + belly * 0.3, -21, belly, belly * 0.9, 0, 0, 7); g.fill();
  /* arms */
  const lean = S.phase === 'recover' && phys.effort > 0.3 ? 1 : 0;      // hands on knees while recovering
  g.beginPath(); g.moveTo(2, -28); g.lineTo(-5 - 3 * cad, -18 + 10 * lean); g.moveTo(2, -28); g.lineTo(7 + 3 * cad, -18 + 10 * lean); g.stroke();
  /* head */
  g.fillStyle = ink; g.beginPath(); g.arc(3 + 4 * lean, -36 + 4 * lean, 5, 0, 7); g.fill();
  /* breath puffs */
  if (running || phys.effort > 0.05) {
    const puff = Math.max(0, phys.flow);
    g.strokeStyle = rgba(palette.soundWave, 0.25 + 0.5 * puff); g.lineWidth = 1.2;
    for (let k = 0; k < 3; k++) { g.beginPath(); g.arc(12 + k * 5 + 3 * puff, -36, 2 + k * 1.6 + 2 * puff, -1.1, 1.1); g.stroke(); }
  }
  g.restore();
  /* heart + numbers (right column, RTL) */
  const vp = phys.ventricularPulse, hx = w - 20, hy = 22;
  g.fillStyle = css(palette.heart); g.save(); g.translate(hx, hy); g.scale(1 + 0.2 * vp, 1 + 0.2 * vp);
  g.beginPath(); g.moveTo(0, 6); g.bezierCurveTo(-9, -2, -5, -11, 0, -5); g.bezierCurveTo(5, -11, 9, -2, 0, 6); g.fill(); g.restore();
  g.fillStyle = '#eef2f8'; g.textAlign = 'right'; g.font = '800 15px Cairo, system-ui, sans-serif';
  g.fillText('≈ ' + AR(Math.round(phys.hr)) + ' نبضة/د', w - 36, hy + 5);
  g.font = '700 12.5px Cairo, system-ui, sans-serif'; g.fillStyle = css(palette.soundWave);
  g.fillText('🫁 ≈ ' + AR(Math.round(phys.breathRate)) + ' نفَس/د', w - 12, hy + 28);
  g.fillStyle = phys.effort > 0.6 ? '#fca5a5' : phys.effort > 0.3 ? '#fdba74' : '#86efac';
  g.fillText('الجهد ' + AR(Math.round(phys.effort * 100)) + '٪', w - 12, hy + 48);
  if (S.on) {
    g.fillStyle = 'rgba(154,168,191,.95)'; g.font = '700 12px Cairo, system-ui, sans-serif';
    g.fillText('⏱ ' + AR(Math.round(S.simT)) + ' ث (مُسرَّع)', w - 12, hy + 68);
    if (S.phase === 'done' && S.result) { g.fillStyle = '#a7f3d0'; g.fillText('✓ هدأ النبض', w - 12, hy + 88); }
  } else { g.fillStyle = 'rgba(154,168,191,.95)'; g.font = '700 12px Cairo, system-ui, sans-serif'; g.fillText('بالراحة', w - 12, hy + 68); }
}
function runStairs(body) { sim.startStairs(body); lastText = -1; }

/* ---------- C) pharynx sagittal section ----------
 * unit space 200 x 220: x 0 = face (anterior), 200 = back of the neck; y 0 = nose level, 220 = lower neck.
 * S = { patency 0..1, fatNeck 0..1, tongueFat 0..1, snore 0..1, apnea 0..1, flow -1..1, vib (s), labels, scene } */
function makeScene() {
  const parts = []; for (let i = 0; i < 16; i++) parts.push({ s: i / 16, j: (i * 37 % 11) / 11 - 0.5 });
  return { parts, vib: 0 };
}
function pharynxGeom(S) {
  /* posterior wall: only a slight thickening with neck fat — the retropharyngeal space stays thin even in obesity.
     The narrowing comes from the front (tongue base, soft palate bulk) and from the sides (parapharyngeal fat pads,
     shown in the axial inset), Schwab 1995 / Kim 2014 */
  const wallX = 156 - 3 * S.fatNeck + S.snore * 1.2 * Math.sin(S.vib * 41 + 1);
  const bulk = 0.6 * S.tongueFat + 0.4 * S.fatNeck;
  const palate = (y) => {                                      // posterior edge of the soft palate / uvula, y 64..108
    const u = (y - 64) / 44;
    let x = 122 + 14 * u + 9 * bulk * u;
    x += S.snore * 3.6 * u * Math.sin(S.vib * 43 + u * 2.2);     // flutter (free end moves most)
    const cp = 0.3 + 0.7 * gauss(y, 104, 22);
    return x + (wallX - x) * (1 - S.patency) * cp;
  };
  const tongue = (y) => {                                      // posterior edge of the tongue base, y 96..152
    const u = (y - 96) / 56;
    let x = 112 + 18 * Math.sin(Math.PI * u) + 14 * bulk * gauss(y, 126, 20);
    const cp = 0.25 + 0.75 * gauss(y, 124, 24);
    return x + (wallX - x) * (1 - S.patency) * cp;
  };
  const ant = (y) => {                                         // anterior boundary of the lumen
    let x = y < 64 ? 122 : y <= 108 ? palate(y) : 118;
    if (y >= 96 && y <= 152) x = Math.max(x, tongue(y));
    if (y > 152) x = y < 186 ? 118 - (y - 152) / 34 * 6 : 112 - Math.min(2, (y - 186) / 10);
    return Math.min(x, wallX - 0.6);
  };
  return { wallX, palate, tongue, ant };
}
function drawPharynx(g, S, sc) {
  const G = pharynxGeom(S), wallX = G.wallX, fat = S.fatNeck;
  const skin = css(palette.headSkin), mucosa = css(palette.pharynxMucosa), lumen = css(palette.airwayLumen);
  /* head / neck silhouette */
  const sub = 46 + 12 * fat, subY = 152 + 16 * fat;              // submental (double-chin) sag
  const head = new Path2D();
  head.moveTo(44, 0); head.quadraticCurveTo(30, 30, 12, 58); head.quadraticCurveTo(24, 66, 30, 72);
  head.quadraticCurveTo(24, 84, 28, 92); head.quadraticCurveTo(34, 100, 28, 110); head.quadraticCurveTo(34, 124, 34, 136);
  head.quadraticCurveTo(38, 150, sub, subY); head.quadraticCurveTo(62, subY + 10, 66, 182); head.lineTo(68, 220);
  head.lineTo(196, 220); head.quadraticCurveTo(200, 110, 196, 0); head.closePath();
  g.fillStyle = skin; g.fill(head);
  g.save(); g.clip(head);
  /* deep tissue tint + subcutaneous fat */
  g.fillStyle = rgba(palette.pharynxDeep, 0.45); g.fillRect(60, 0, 140, 220);
  g.fillStyle = rgba(palette.tongue, 0.35); g.fillRect(28, 80, 80, 90);
  g.strokeStyle = rgba(palette.neckFat, 0.9); g.lineCap = 'round';
  g.lineWidth = 5 + 8 * fat; g.beginPath(); g.moveTo(198 - g.lineWidth / 2, 0); g.quadraticCurveTo(202 - g.lineWidth / 2, 110, 198 - g.lineWidth / 2, 220); g.stroke();
  g.lineWidth = 4 + 16 * fat; g.beginPath(); g.moveTo(34, 140); g.quadraticCurveTo(40, 150 + 4 * fat, sub - 2, subY - 2); g.quadraticCurveTo(58, subY + 6, 64, 184); g.stroke();
  /* prevertebral muscle + a THIN retropharyngeal fat strip (this space stays thin in obesity; the fat that narrows
     the pharynx sits laterally — parapharyngeal fat pads — and in the tongue base: see the axial inset) */
  g.fillStyle = css(palette.pharynxDeep); rr(g, wallX + 5, 10, 11, 210, 4); g.fill();
  g.fillStyle = rgba(palette.neckFat, 0.9); rr(g, wallX + 16, 24, 1.5 + 2 * fat, 186, 1.5); g.fill();
  /* cervical spine */
  g.fillStyle = css(palette.bone);
  for (let i = 0; i < 6; i++) { const y = 18 + i * 34; rr(g, 170, y, 18, 26, 5); g.fill(); g.fillStyle = rgba(palette.cartilage, 0.8); rr(g, 171, y + 26, 16, 7, 2); g.fill(); g.fillStyle = css(palette.bone); }
  /* lumen: nasal cavity + pharynx + larynx/trachea */
  g.fillStyle = lumen; g.beginPath();
  g.moveTo(22, 58); g.quadraticCurveTo(50, 22, 100, 16); g.lineTo(122, 14);
  for (let y = 14; y <= 220; y += 2) g.lineTo(wallX + 2 * Math.sin(y / 60), y);
  g.lineTo(G.ant(220), 220);
  for (let y = 220; y >= 62; y -= 2) g.lineTo(G.ant(y), y);
  g.lineTo(44, 62); g.quadraticCurveTo(36, 62, 22, 58); g.closePath(); g.fill();
  /* turbinates (superior / middle / inferior conchae on the lateral nasal wall) */
  for (const [cx, cy, rx, ry, rot] of [[74, 26, 11, 3.2, -0.25], [78, 37, 16, 4.2, -0.12], [80, 50, 22, 5, -0.05]]) {
    g.fillStyle = rgba(palette.pharynxMucosa, 0.95); g.beginPath(); g.ellipse(cx, cy, rx, ry, rot, 0, 7); g.fill();
    g.fillStyle = rgba(palette.white, 0.18); g.beginPath(); g.ellipse(cx - 2, cy - 1.2, rx * 0.7, ry * 0.4, rot, 0, 7); g.fill();
  }
  /* posterior wall mucosa */
  g.strokeStyle = mucosa; g.lineWidth = 6; g.beginPath();
  for (let y = 12; y <= 222; y += 2) { const x = wallX + 2 * Math.sin(y / 60) + 3; y === 12 ? g.moveTo(x, y) : g.lineTo(x, y); }
  g.stroke();
  /* hard palate (bone) + mouth */
  g.fillStyle = css(palette.bone); rr(g, 38, 61, 84, 8, 3); g.fill();
  g.fillStyle = rgba(palette.pharynxMucosa, 0.9); rr(g, 40, 69, 80, 3, 1); g.fill();
  /* tongue */
  g.fillStyle = css(palette.tongue); g.beginPath();
  g.moveTo(40, 98); g.quadraticCurveTo(60, 74, 96, 80); g.quadraticCurveTo(112, 84, 116, 96);
  for (let y = 96; y <= 152; y += 2) g.lineTo(G.tongue(y), y);
  g.quadraticCurveTo(100, 160, 70, 156); g.quadraticCurveTo(48, 150, 42, 128); g.closePath(); g.fill();
  const tg = g.createLinearGradient(40, 80, 120, 150); tg.addColorStop(0, 'rgba(255,255,255,.22)'); tg.addColorStop(1, 'rgba(0,0,0,.18)');
  g.fillStyle = tg; g.fill();
  if (S.tongueFat > 0.25) {                                      // intramuscular tongue fat (Kim 2014)
    g.fillStyle = rgba(palette.neckFat, 0.35 + 0.4 * S.tongueFat);
    for (let i = 0; i < 9; i++) { const a = i * 2.4, r = 10 + 8 * (i % 3); g.beginPath(); g.ellipse(84 + Math.cos(a) * r, 118 + Math.sin(a) * r * 0.6, 3.5 + 2 * S.tongueFat, 2.2, a, 0, 7); g.fill(); }
  }
  /* soft palate + uvula */
  g.fillStyle = mucosa; g.beginPath(); g.moveTo(118, 62);
  for (let y = 64; y <= 108; y += 2) g.lineTo(G.palate(y), y);
  const ux = G.palate(108); g.arc(ux - 5, 110, 5.5, -0.2, Math.PI + 0.2);
  for (let y = 106; y >= 66; y -= 2) g.lineTo(G.palate(y) - 10 - 3 * S.tongueFat, y);
  g.lineTo(118, 70); g.closePath(); g.fill();
  g.fillStyle = css(palette.uvula); g.beginPath(); g.arc(ux - 5, 111, 4.6, 0, 7); g.fill();
  /* teeth, mandible, hyoid, epiglottis, larynx, trachea rings */
  g.fillStyle = '#f7f3ea'; rr(g, 32, 82, 5, 10, 2); g.fill(); rr(g, 34, 100, 5, 10, 2); g.fill();
  g.fillStyle = css(palette.bone); rr(g, 36, 116, 16, 26, 6); g.fill(); rr(g, 86, 160, 14, 5, 2); g.fill();
  g.fillStyle = css(palette.epiglottis); g.beginPath(); g.moveTo(108, 166); g.quadraticCurveTo(124, 150, G.ant(140) - 2, 136); g.quadraticCurveTo(128, 150, 114, 168); g.closePath(); g.fill();
  g.fillStyle = css(palette.larynx); g.beginPath(); g.moveTo(104, 164); g.lineTo(100, 190); g.lineTo(110, 192); g.lineTo(111, 168); g.closePath(); g.fill();
  g.fillStyle = rgba(palette.pharynxMucosa, 0.95); rr(g, 111, 176, (wallX - 111) * 0.55, 3, 1); g.fill();   // vocal fold
  g.fillStyle = css(palette.trachealRing); for (const y of [198, 207, 216]) { rr(g, 106, y, 6, 5, 2); g.fill(); }
  /* mucosa lining of the anterior boundary */
  g.strokeStyle = rgba(palette.pharynxMucosa, 0.75); g.lineWidth = 1.6; g.beginPath();
  for (let y = 112; y <= 220; y += 2) { const x = G.ant(y); y === 112 ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke();
  /* airflow particles */
  const sc_ = sc, speed = 0.16;
  for (const p of sc_.parts) {
    p.s = ((p.s + S.flow * speed * S.dt) % 1 + 1) % 1;
    let x, y;
    if (p.s < 0.28) { const u = p.s / 0.28; x = 24 + u * 96; y = 56 - 36 * Math.sin(Math.PI * u) * 0.9 - 2 + 6 * p.j; }
    else { const u = (p.s - 0.28) / 0.72; y = 16 + u * 202; const a = G.ant(y), ww = Math.max(0.5, wallX - a); x = a + ww * (0.5 + 0.7 * p.j); }
    const alpha = (0.18 + 0.6 * Math.abs(S.flow)) * (0.3 + 0.7 * S.patency);
    g.fillStyle = rgba(palette.soundWave, alpha); g.beginPath(); g.arc(x, y, 1.6, 0, 7); g.fill();
  }
  /* snore arcs from the uvula */
  if (S.snore > 0.03) {
    g.lineWidth = 1.4;
    for (let k = 0; k < 3; k++) { const r = 8 + k * 7 + 4 * ((S.vib * 2) % 1); g.strokeStyle = rgba(palette.soundWave, S.snore * (0.75 - k * 0.2)); g.beginPath(); g.arc(ux + 2, 112, r, -1.9, 0.3); g.stroke(); }
  }
  /* obstruction glow (retropalatal / retroglossal contact) */
  if (S.apnea > 0.05) {
    const pulse = 0.75 + 0.25 * Math.sin(S.vib * 6);
    g.strokeStyle = rgba(palette.apneaFlag, 0.85 * S.apnea * pulse); g.lineWidth = 3.5; g.shadowColor = rgba(palette.apneaFlag, 0.95); g.shadowBlur = 14; g.lineCap = 'round';
    g.beginPath(); g.moveTo(G.ant(92), 92); for (let y = 94; y <= 144; y += 2) g.lineTo(G.ant(y) + 1, y); g.stroke();
    g.lineWidth = 1.5; g.beginPath(); g.moveTo(wallX + 1, 92); g.lineTo(wallX + 1, 144); g.stroke(); g.shadowBlur = 0;
    g.fillStyle = rgba(palette.apneaFlag, 0.95 * S.apnea); g.font = '800 11px Cairo, system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('انسداد', wallX - 14, 160);
  }
  g.restore();
  /* skin outline */
  g.strokeStyle = palette.sectionSkinEdge; g.lineWidth = 1.2; g.stroke(head);
}
function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); }

/* axial (cross) section at the level of the oropharynx, anterior = up: shows WHERE the fat sits — the parapharyngeal
 * fat pads thicken the lateral walls and narrow the lumen side-to-side (Schwab RJ et al. AJRCCM 1995;152:1673), the
 * tongue base bulges from the front; the lumen also flattens front-to-back as patency falls. */
function drawAxial(g, cx, cy, r, S) {
  const fat = S.fatNeck, pat = S.patency;
  g.save(); g.translate(cx, cy);
  g.fillStyle = css(palette.headSkin); g.beginPath(); g.ellipse(0, 0, r, r * 0.92, 0, 0, 7); g.fill();
  const sub = 2.5 + 5 * fat;                                                   // subcutaneous ring
  g.strokeStyle = rgba(palette.neckFat, 0.9); g.lineWidth = sub; g.beginPath(); g.ellipse(0, 0, r - sub / 2 - 1, r * 0.92 - sub / 2 - 1, 0, 0, 7); g.stroke();
  g.fillStyle = rgba(palette.pharynxDeep, 0.55); g.beginPath(); g.ellipse(0, 0, r * 0.74 - sub * 0.5, r * 0.68 - sub * 0.5, 0, 0, 7); g.fill();
  g.fillStyle = css(palette.bone); g.beginPath(); g.ellipse(0, r * 0.5, r * 0.2, r * 0.13, 0, 0, 7); g.fill();            // vertebral body (posterior)
  const bulge = 0.6 * S.tongueFat + 0.4 * fat;
  g.fillStyle = css(palette.tongue); g.beginPath(); g.ellipse(0, -r * 0.3 + r * 0.06 * bulge, r * 0.38, r * (0.2 + 0.08 * bulge), 0, 0, 7); g.fill();   // tongue base (anterior)
  const ly = r * 0.1, rx = r * (0.34 - 0.15 * fat) * (0.55 + 0.45 * pat), ry = r * 0.16 * (0.12 + 0.88 * pat);
  const padR = r * (0.08 + 0.18 * fat);                                        // parapharyngeal fat pads flanking the lumen
  g.fillStyle = rgba(palette.neckFat, 0.95);
  for (const sgn of [-1, 1]) { g.beginPath(); g.ellipse(sgn * (rx + padR * 0.8 + 2.5), ly, padR, r * 0.21, 0, 0, 7); g.fill(); }
  g.strokeStyle = css(palette.pharynxMucosa); g.lineWidth = 3; g.fillStyle = css(palette.airwayLumen);
  g.beginPath(); g.ellipse(0, ly, Math.max(1, rx), Math.max(0.8, ry), 0, 0, 7); g.fill(); g.stroke();
  if (S.snore > 0.03) { g.strokeStyle = rgba(palette.soundWave, 0.7 * S.snore); g.lineWidth = 1; g.beginPath(); g.ellipse(0, ly, rx + 4 + 1.5 * Math.sin(S.vib * 40), ry + 4, 0, 0, 7); g.stroke(); }
  if (S.apnea > 0.05) { g.strokeStyle = rgba(palette.apneaFlag, 0.9 * S.apnea); g.lineWidth = 2; g.shadowColor = rgba(palette.apneaFlag, 0.9); g.shadowBlur = 8; g.beginPath(); g.moveTo(-rx, ly); g.lineTo(rx, ly); g.stroke(); g.shadowBlur = 0; }
  g.restore();
}

function drawPharynxLive(tr, phys, t, dt) {
  if (tr.w === 0) fitCanvas(tr);
  const g = begin(tr), w = tr.w, h = tr.h, L = phys.live, sc = scenes.live;
  sc.vib += dt;
  const S = { patency: phys.airwayPatency, fatNeck: L.fatNeck, tongueFat: L.tongueFat, snore: phys.snoreIntensity, apnea: phys.apneaEvent ? 1 : 0, flow: phys.flow, vib: sc.vib, dt };
  const s = Math.min((h - 8) / 220, (w - 104) / 200), ox = 4, oy = 4;
  g.save(); g.translate(ox, oy); g.scale(s, s); drawPharynx(g, S, sc); g.restore();
  /* right column (RTL): axial inset — WHERE the fat sits (lateral parapharyngeal pads + tongue base) — then labels with
     leaders, then the state banner; sized to fit the 184 px canvas (labels that do not fit are dropped, least important last) */
  const G = pharynxGeom(S), lx = w - 6;
  const colL = ox + 206 * s, colW = w - colL, ir = clamp(Math.min(colW / 2 - 8, 26), 20, 26), icx = w - 6 - ir, icy = 15 + ir;
  g.textAlign = 'right'; g.fillStyle = 'rgba(154,168,191,.9)'; g.font = '700 9.5px Cairo, system-ui, sans-serif'; g.fillText('مقطع عرضي عند الحلق', lx, 11);
  drawAxial(g, icx, icy, ir, S);
  const cap = 'دهون حوالين البلعوم (من الجانبين)', cy2 = icy + ir + 12;
  g.font = '700 10px Cairo, system-ui, sans-serif';
  const tw = g.measureText(cap).width + 8; g.fillStyle = 'rgba(6,10,22,.72)'; rr(g, w - tw - 2, cy2 - 10, tw, 14, 4); g.fill();
  g.fillStyle = css(palette.neckFat); g.fillText(cap, lx, cy2);
  const items = [
    ['سقف الحلق اللين واللهاة', G.palate(96) - 6, 96], ['مجرى الهواء', (G.ant(120) + G.wallX) / 2, 120], ['قاعدة اللسان', G.tongue(130) - 14, 130],
    ['الحنجرة والقصبة', 108, 200], ['العمود الفقري', 179, 160],
  ], ty0 = cy2 + 19, dy = 18.5;
  g.font = '700 10.5px Cairo, system-ui, sans-serif';
  items.forEach(([txt, ux, uy], i) => {
    const px = ox + ux * s, py = oy + uy * s, ty = ty0 + i * dy;
    if (ty > h - 22) return;
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(px, py); g.lineTo(colL, ty - 4); g.lineTo(lx - 2, ty - 4); g.stroke();
    g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.arc(px, py, 2, 0, 7); g.fill();
    g.fillStyle = '#eef2f8'; g.fillText(txt, lx, ty);
  });
  /* state banner */
  const banner = phys.apneaEvent ? [`انسداد كامل — توقّف النفَس · ${AR(Math.round(phys.apneaProgress * 100))}٪`, palette.apneaFlag] : phys.arousal > 0.5 ? ['استيقاظ قصير: شهقة والمجرى بينفتح', palette.arousalFlag] : phys.snoreIntensity > 0.12 ? ['ممر ضيق → اهتزاز = شخير', palette.soundWave] : phys.sleepDepth > 0.6 ? ['نائم: العضلات مرتخية والممر أضيق', palette.spo2Ok] : ['عم ينام…', 0x9aa8bf];
  g.font = '800 12px Cairo, system-ui, sans-serif'; g.fillStyle = css(banner[1]); g.fillText(banner[0], lx, h - 8);
}

/* ---------- sleep strip: sound / airflow / SpO2 sweep (polysomnography-like) ---------- */
function drawStrip(tr, phys, dt) {
  if (tr.w === 0) fitCanvas(tr);
  const w = tr.w, h = tr.h;
  if (!tr.buf) {
    tr.buf = { snd: new Float32Array(w), flo: new Float32Array(w), sp: new Float32Array(w).fill(phys.spo2), ev: new Uint8Array(w), ar: new Uint8Array(w) }; tr.x = 0;
    const sp = w / 22; for (let i = 0; i < w; i++) { const ph = phys.breathPhase - ((w - i) / sp) * phys.breathRate / 60; tr.buf.flo[i] = phys.tidalDepth * (((ph % 1) + 1) % 1 < 0.42 ? Math.sin(Math.PI * (((ph % 1) + 1) % 1) / 0.42) : -0.72 * Math.sin(Math.PI * ((((ph % 1) + 1) % 1) - 0.42) / 0.58)); }
  }
  const B = tr.buf, { x0, n } = sweep(tr, dt, 22);
  for (let i = 1; i <= n; i++) {
    const col = (x0 + i) % w;
    B.snd[col] = phys.snoreIntensity * (0.55 + 0.45 * Math.random()); B.flo[col] = phys.flow; B.sp[col] = phys.spo2;
    B.ev[col] = phys.apneaEvent ? 1 : 0; B.ar[col] = phys.arousal > 0.92 && lastArousal < 0.92 ? 1 : 0;
  }
  lastArousal = phys.arousal;
  const g = begin(tr), rows = [[4, 25], [35, 29], [71, 28]], head = Math.floor(tr.x), gap = 12;   // sound / airflow / SpO2 in 105 px
  /* apnoea bands (+ a solid flag bar along the top edge so the breathing gap reads at a glance) + arousal ticks */
  for (let i = 0; i < w; i++) {
    if (B.ev[i]) { g.fillStyle = rgba(palette.apneaFlag, 0.25); g.fillRect(i, 2, 1, h - 4); g.fillStyle = rgba(palette.apneaFlag, 0.95); g.fillRect(i, 0, 1, 3.5); }
    if (B.ar[i]) { g.fillStyle = rgba(palette.arousalFlag, 0.8); g.fillRect(i, 2, 1.5, h - 4); }
  }
  const visible = (i) => !isNaN(B.snd[i]) && ((i - head + w) % w) > gap;
  /* sound (symmetric envelope) */
  const [y1, h1] = rows[0]; g.strokeStyle = rgba(palette.soundWave, 0.9); g.lineWidth = 1;
  g.beginPath(); for (let i = 0; i < w; i++) { if (!visible(i)) continue; const a = B.snd[i] * h1 / 2; g.moveTo(i + 0.5, y1 + h1 / 2 - a); g.lineTo(i + 0.5, y1 + h1 / 2 + a + 0.6); } g.stroke();
  /* airflow */
  const [y2, h2] = rows[1]; g.strokeStyle = css(palette.spo2Ok); g.lineWidth = 1.4; g.beginPath(); let open = false;
  for (let i = 0; i < w; i++) { if (!visible(i)) { open = false; continue; } const y = y2 + h2 / 2 - B.flo[i] * h2 / 2.2; if (!open) { g.moveTo(i, y); open = true; } else g.lineTo(i, y); } g.stroke();
  /* SpO2 */
  const [y3, h3] = rows[2], Y3 = (v) => y3 + h3 - (clamp(v, 80, 100) - 80) / 20 * h3;
  g.lineWidth = 1.8; open = false; let prev = null;
  for (let i = 0; i < w; i++) {
    if (!visible(i)) { open = false; prev = null; continue; }
    const v = B.sp[i], y = Y3(v);
    if (prev !== null) { g.strokeStyle = v < 90 ? css(palette.spo2Low) : v < 94 ? '#fdba74' : css(palette.spo2Ok); g.beginPath(); g.moveTo(i - 1, prev); g.lineTo(i, y); g.stroke(); }
    prev = y;
  }
  g.strokeStyle = rgba(palette.traceGrid, 0.6); g.setLineDash([3, 4]); g.lineWidth = 1; g.beginPath(); g.moveTo(0, Y3(90)); g.lineTo(w, Y3(90)); g.stroke(); g.setLineDash([]);
  /* row labels */
  g.font = '700 10.5px Cairo, system-ui, sans-serif'; g.textAlign = 'right';
  const lab = (txt, y, col) => { const tw = g.measureText(txt).width + 8; g.fillStyle = 'rgba(6,10,22,.7)'; rr(g, w - tw - 2, y - 11, tw, 15, 4); g.fill(); g.fillStyle = col; g.fillText(txt, w - 6, y); };
  lab('الصوت (الشخير)', y1 + 10, css(palette.soundWave)); lab('تدفق الهوا', y2 + 10, css(palette.spo2Ok)); lab('أوكسجين الدم ٪', y3 + 8, css(palette.spo2Ok));
  g.fillStyle = 'rgba(154,168,191,.8)'; g.font = '10px Cairo, system-ui, sans-serif'; g.textAlign = 'left'; g.direction = 'ltr'; g.fillText('90', 4, Y3(90) - 2); g.fillText('100', 4, y3 + 8);
}

/* ---------- today vs after mini sections ---------- */
function drawCompare(tr, phys, t, dt) {
  if (tr.w === 0) fitCanvas(tr);
  const g = begin(tr), w = tr.w, h = tr.h, T = phys.today, A = phys.after;
  const s = Math.min((h - 22) / 220, (w / 2 - 10) / 200);
  const one = (E, sc, x0, title, after) => {
    sc.vib += dt;
    const breathe = 0.5 - 0.5 * Math.cos(sc.vib * 2 * Math.PI / 4.4), insp = Math.max(0, Math.sin(sc.vib * 2 * Math.PI / 4.4));
    const S = { patency: clamp(E.patencySleep - 0.1 * E.osa * insp, 0.05, 1), fatNeck: E.fatNeck, tongueFat: E.tongueFat, snore: E.snoreLevel * insp * 0.8, apnea: 0, flow: Math.sin(sc.vib * 2 * Math.PI / 4.4) * 0.8, vib: sc.vib, dt };
    g.save(); g.translate(x0, 20); g.scale(s, s); drawPharynx(g, S, sc); g.restore();
    g.font = '800 12px Cairo, system-ui, sans-serif'; g.textAlign = 'center'; g.fillStyle = after ? '#a7f3d0' : '#eef2f8';
    g.fillText(title, x0 + 100 * s, 14);
    void breathe;
  };
  const P = C.state.profile || {}, pad = (w / 2 - 200 * s) / 2;
  one(T, scenes.today, w / 2 + pad, 'اليوم', false);
  one(A, scenes.after, pad, P.kgLoss > 0 ? `بعد نزول ${AR(Math.round(P.kgLoss))} كغ` : P.kgLoss < 0 ? 'لو زاد الوزن' : 'بعد (حرّك الشريط)', true);
  g.strokeStyle = 'rgba(255,255,255,.18)'; g.beginPath(); g.moveTo(w / 2, 6); g.lineTo(w / 2, h - 6); g.stroke();
}

/* =================================================================== sound (optional, muted by default) == */
function toggleSound(force) {
  const want = typeof force === 'boolean' ? force : !soundOn;
  if (want && !audio) audio = initAudio();
  if (!audio) { q.sleep.sound.textContent = '🔇 الصوت غير متاح'; return; }
  soundOn = want;
  const now = audio.ac.currentTime;
  if (soundOn) { audio.ac.resume && audio.ac.resume(); audio.master.gain.setTargetAtTime(0.8, now, 0.1); }
  else { audio.master.gain.setTargetAtTime(0, now, 0.05); setTimeout(() => audio && !soundOn && audio.ac.suspend && audio.ac.suspend(), 400); }
  q.sleep.sound.textContent = soundOn ? '🔊 الصوت شغّال' : '🔇 الصوت مطفأ';
  q.sleep.sound.classList.toggle('on', soundOn);
}
function initAudio() {
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
  try {
    const ac = new AC(), master = ac.createGain(); master.gain.value = 0; master.connect(ac.destination);
    const len = ac.sampleRate * 2, buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const noise = ac.createBufferSource(); noise.buffer = buf; noise.loop = true;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 170; bp.Q.value = 1.1;
    const flutter = ac.createGain(); flutter.gain.value = 0.5;
    const lfo = ac.createOscillator(); lfo.type = 'sawtooth'; lfo.frequency.value = 36; const lfoG = ac.createGain(); lfoG.gain.value = 0.5; lfo.connect(lfoG); lfoG.connect(flutter.gain);
    const snoreGain = ac.createGain(); snoreGain.gain.value = 0;
    noise.connect(bp); bp.connect(flutter); flutter.connect(snoreGain); snoreGain.connect(master);
    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900; const gaspGain = ac.createGain(); gaspGain.gain.value = 0;
    noise.connect(hp); hp.connect(gaspGain); gaspGain.connect(master);
    noise.start(); lfo.start();
    return { ac, master, snoreGain, gaspGain, lfo, lastAr: 0 };
  } catch (e) { return null; }
}
function driveAudio(phys) {
  const now = audio.ac.currentTime;
  audio.snoreGain.gain.setTargetAtTime(clamp(phys.snoreIntensity, 0, 1) * 0.55, now, 0.04);
  audio.lfo.frequency.setTargetAtTime(28 + 30 * phys.snoreIntensity, now, 0.05);
  if (phys.arousal > 0.92 && audio.lastAr <= 0.92) { audio.gaspGain.gain.setTargetAtTime(0.45, now, 0.01); audio.gaspGain.gain.setTargetAtTime(0, now + 0.12, 0.2); }
  audio.lastAr = phys.arousal;
}
