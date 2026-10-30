# Visceral Fat 3D — تقرير الترقية التشريحية والفيزيولوجية

> يُستكمل هذا التقرير في نهاية المرحلة الثالثة (الدمج). القسم الأول نهائي.

## ١) المرحلة الأولى — إعادة البناء المعماري

المستودع كان فارغاً، والمصدر الوحيد المتاح كان ملف `visceral-fat-3d.html` المبنيّ والمُصغّر (minified).
جرى تفكيكه وإعادة بنائه كمشروع مصدري مقسّم، يعطي الصفحة نفسها بالضبط (تمت مقارنة اللقطات):

```
src/core/ctx.js        المشهد، الكاميرا، الإضاءة، المُصيّر، الـ composer، الحالة state، الأدوات (deform, vtube, add, noise3, clamp, lerp, smooth, gauss, P, rnd)
src/core/style.js      عقد الأسلوب الوحيد: اللوحة اللونية، OrganMat، fresnelMat، fatMat، النسج الإجرائية، الإضاءة، معايير اللمعان
src/core/registry.js   سجل الأعضاء: كل عضو يسجّل { key, build(ctx), update(f, t, phys), layers }
src/organs/body.js     الجلد + الدهون تحت الجلد (نسختان A/B) + الهيكل العظمي
src/organs/heart.js  lungs.js  airway.js  liver.js  digestive.js  kidneys.js  vessels.js  fat.js
src/sim/physiology.js  محرك المحاكاة الفيزيولوجية (كائن phys حيّ كل إطار)
src/ui/panel.js views.js labels.js cards.js section.js tour.js phys_ui.js
src/main.js            نقطة الدخول: يركّب كل شيء ويدير حلقة الرسم
build.py               esbuild (three@0.160 + addons) → ملف HTML واحد يعمل دون إنترنت (+ dist/index.html للنشر)
tests/snap.mjs verify.mjs shots.mjs   لقطات Playwright (swiftshader)
```

العقود المحفوظة: نظام الطبقات (١ = بعد، ٢ = قبل)، `state.fCur` و`applyBody(f)`، `window.__ready`، أوضاع
`normal/split/section/tour` عبر `setMode()`، `localClippingEnabled` + `clipPlane` + لوحة المقطع ثنائية الأبعاد،
شاشة SPIN، الجولة، قبل/بعد، المقطع، الأسماء، البطاقات، الشريط، شاشة النتيجة، زر الاشتراك، رسالة الواتساب،
وسطر الإسناد Z-Anatomy و BodyParts3D (DBCLS) — CC BY-SA 4.0 (أُضيف إلى أسفل الصفحة لأنه لم يكن موجوداً في الملف المُسلَّم).

## ٢) المرحلة الثانية — ما تحسّن في كل عضو
_(يُملأ بعد الدمج)_

## ٣) المحاكاة الفيزيولوجية — المعادلات والمراجع
_(يُملأ بعد الدمج)_

## ٤) الجولة والواجهة
_(يُملأ بعد الدمج)_

## ٥) الأداء والتحقق
_(يُملأ بعد الدمج)_

## ٦) النشر
_(يُملأ بعد الدمج)_
