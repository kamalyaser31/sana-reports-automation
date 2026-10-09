# حالة المشروع (Project State) — sana-reports-automation

**الإصدار:** `5.2.1`  
**تاريخ التحديث:** `2026-10-10`  
**المستودع:** `https://github.com/kamalyaser31/sana-reports-automation` (خاص - Private)  
**الحالة:** أُضيفت المعلمة «سمية حمدي» (T008) إلى سجل المعلمين في Code.js.

---

## 1. بنية المشروع المعمارية

- **`Code.js`**: المحرك الرئيس لمعالجة نماذج Google Forms، وتوليد ملفات Markdown، وتحديث جداول Google Sheets، وإرسال تنبيهات Telegram والبريد، وتصدير ملفات PDF.
- **`Config.local.js`**: ملف الأسرار والمفاتيح الحساسة المحلي (مُتجاهَل في Git ويُرفع عبر `clasp`).
- **`Config.local.example.js`**: نموذج إرشادي للمفاتيح الحساسة مُدرج في المستودع.
- **`Diagnostics.js`**: دوال التشخيص اليدوي وفحص الربط والصلاحيات (`authorizeAndTest` وغيرها).
- **`Test.js`**: منظومة اختبارات متكاملة تشمل إطار عمل مصغّر، و12 جناح اختبار وحدة (111 فحصاً دقيقاً)، و5 اختبارات تكاملية شاملة.
- **`appsscript.json`**: إعدادات بيئة V8 ونطاقات OAuth الصريحة.
- **`ROADMAP_INTEGRATION.md`**: وثيقة وخارطة طريق الترقية المستقبلية لاستقبال التقارير مباشرة عبر HTTP POST (`doPost`) دون وسيط استمارة جوجل.

---

## 2. القرارات والضوابط المعتمدة

1. **إدارة الأسرار:** الاعتماد على `Config.local.js` أولاً مع الإبقاء على `Script Properties` كخيار احتياطي.
2. **عزل الأعطال:** فشل Google Sheets أو إشعار Telegram لا يُعطّل حفظ ملف Markdown التوثيقي الأصلي في Google Drive، وتُسجّل الأخطاء في ملف شهري بـ Drive.
3. **نقاء الدوال ومبدأ CQS:** عدم تعديل كائنات المدخلات داخل الدوال الفرعية (مثل `saveMarkdownFile`).
4. **جودة الشفرة والـ ES6+:** استخدام `const`/`let` حصراً، وتجريد الدوال الوسيطة (`_resolveTeacher`, `_parseDuration`, `_resolveSessionAndDate`, `_formatSubmissionDate`).
5. **منظومة الاختبارات:** تشغيل `runAllUnitTests` للاختبار السريع المستقل عن Drive، و`runAllTests` للاختبار التكاملي الكامل.
