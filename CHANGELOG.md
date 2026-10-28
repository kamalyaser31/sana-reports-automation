# Changelog

## [5.23.0] — 2026-10-28
- feat(parents): 2026-10-28 — رسالة Telegram لكل طالب إلى محادثة الإدارة الخاصة (`TELEGRAM_PARENTS_CHAT_ID`)، بزر يفتح WhatsApp وليّ الأمر وفيه قسم الطالب بلا خطوط الفصل، وبالنسخ واللصق إن جاوز الرابط 1937 حرفاً، وقائمة من لا هاتف له (`Parents.js`، و`reportPhones` في `recordStudents`)؛ وهي معطّلة بـ `PARENTS.ENABLED: false` حتى تُطلب.
- fix(stats): 2026-10-28 — «تكلفة ساعة التدريس» في الملف العام تُقسم على ساعات التدريس المعروضة في الصف نفسه، لا على ساعات الراتب التي تزيد عليها بالساعات المكتوبة باليد بلا طلاب؛ ورسائل أولياء الأمور تتوقف مع `CONFIG.TELEGRAM.ENABLED`.

## [5.22.0] — 2026-10-27
- feat(alerts): 2026-10-27 — تغطية أعطال الإرسال كلها:
  - إيميل بديل حين تفشل رسالة Telegram، أو حين يكون Telegram معطّلاً وفي التقرير مشكلة.
  - تنبيه إذا كان المؤقت الليلي متوقفاً.
  - علامتان `SAVED_` و`DONE_` لكل رد.
  - فحص ليلي `checkMissedResponses` يرسل إيميلاً بالردود التي لم تُحفظ أو لم يكتمل تشغيلها.
  - دالة `reprocessMissedResponses` لإعادة معالجة ما لم يُحفظ.
- feat(telegram): 2026-10-27 — سطر «تنبيه» تحت عنوان الرسالة عند فشل الكتابة في شيت المعلم أو سجل الطلاب، أو نقص ترويسة التقرير، أو تاريخ لم يُفهم، أو تقرير لشهر ثابت (`reportProblems`).
- feat(drive): 2026-10-27 — ملف التقرير صار للقارئ: عنوان وسطر للمدة والطلاب والفئة، ونص المعلم، وملاحظات الإدارة، وسطر تتبع في آخره، بلا YAML ولا تكرار؛ والملف الذي حلّ محله تقرير أحدث يبدأ بتنبيه ورابط الجديد (`markSupersededFile`).
- feat(sheets): 2026-10-27 — اسم الحلقة في العمود B من شيت المعلم صار رابطاً لملف التقرير في التقارير الجديدة، وتقرؤه اللوحة (`link` في `reports`)؛ ولا تُربط التقارير القديمة.
- feat(stats): 2026-10-27 — الصف الذي عدد طلابه صفر في شيت المعلم (ساعات تُكتب باليد) يُحسب في الراتب وحده، لا حلقةً ولا ساعاتٍ في الملف العام.
- test: 2026-10-27 — نُقّح Test.js بمعايير test-guard: حُذفت الفحوص المكررة والتافهة (339 ← 280 وحدة)، ومنها اختبارات خمس دوال صغيرة ثابتة (Markdown واسم الملف وescapeHtml وصيغة الساعات وقراءة الحقل)، وثلاثة أجنحة تكاملية تعيد اختبارات الوحدة ببطء (NormalSubmission وEasternArabicDigits وUnknownTeacher)، وصُحّحت تعليقات قديمة.
- 2026-10-27: أُضيفت `runLiveFixChecks` فنجحت 17/17 حياً في مجلد الاختبار (F-04، F-07، F-08)، وحُذف `agy-findings.md`.
- feat(dashboard): 2026-10-27 — حفظ واحد لجدول الطلاب (`saveStudents`) وواحد لقسم الرواتب (`savePay`)، يتحقق كل منهما من الكل قبل كتابة شيء ويُسجَّل صفاً واحداً (U-03، U-02).
- fix: 2026-10-27 — حذف التقرير المحسوب لحلقة أُعيد إرسالها يعيد السابق محسوباً (F-04)؛ وتصحيح الاسم ينقل التكريمات (F-03)؛ وكتابة تبويب الطلاب لا تمسح قبل الكتابة (F-01).
- fix: 2026-10-27 — التقرير الفاشل يظهر Failed في Executions (F-06)، وصفّا الإجمالي والمتوسط يُحذفان أينما كانا (F-07)، ونص الاستمارة الذي يبدأ بـ `=` لا يصير صيغة (F-08)، وعرض الأعمدة يُضبط مرة عند إنشاء الشهر (L6).

## [5.21.0] — 2026-10-25
- feat(honors): 2026-10-25 — تكريمات الإدارة: تُدخل من اللوحة وتُحذف، ويُحسب كل تكريم بمبلغ شهره في مصروف الشهر بدل بند «الهدايا والتكريمات» الثابت، ويُعدّ في الملف العام بلا أسماء (`Honors.js`، S-60).

## [5.20.0] — 2026-10-25
- feat(dashboard): 2026-10-25 — تعديل مدة الحصة وعدد الطلاب في تقرير، وحذف صفه من شيت المعلم، من اللوحة، إلا في الشهر الثابت، مع رفض الصف الذي تغيّر وتسجيل الفعل (S-59).

## [5.19.1] — 2026-10-25
- feat(telegram): 2026-10-25 — رسالة التقرير تذكر إن كان إعادة إرسال يحل محل السابق، أو مكرراً لا يُحسب (S-58).

## [5.19.0] — 2026-10-25
- feat(sheets): 2026-10-25 — التقرير المعاد إرساله يحل محل السابق في شيت المعلم، فيُحسب الأخير وتُوسم الصفوف السابقة «(تقرير مكرر)» (`supersededRows`، S-58).

## [5.18.0] — 2026-10-25
- refactor: 2026-10-25 — حُذف تصدير PDF، والتقرير بلا اسم معلم لا يُحسب، و`authorizeAndTest` لا يكتب في البيانات الحية، وتاريخ صف الشيت بقارئ المسار نفسه (S-57).

## [5.17.0] — 2026-10-25
- fix(sheets): 2026-10-25 — صفّا الإجمالي والمتوسط في شيت المعلم لا يجمعان التقارير المكررة، فيطابقان ساعات المستحقات (S-56).

## [5.16.0] — 2026-10-25
- feat(dashboard): 2026-10-25 — اللوحة تعرض صفوف شيتات المعلمين كاملة مع حالة كل صف (`reports`)، والقارئ يحفظ كل صف بخلاياه ويعلّم المكرر (`teacherSheetReports`، `isCountedReport`)، والمخبوء مقسوم أجزاءً لحدّ الـ 100 كيلوبايت، وأمر `refreshReports` يقرأ الشيتات في الحال (S-55).

## [5.15.0] — 2026-10-25
- refactor(pay): 2026-10-25 — سبتمبر 2026 يحسب حلقات محمد نبيل وأسماء علي وسارة العدل وفاطمة إبراهيم وحدهم لأخطاء في تقارير غيرهم (S-54)، و«سجل الأسعار» صار فيه عمود «الفعل»، وحُذفت `rateTeachers` وتصفية صفوف الأسعار القديمة ودالتا الحفظ المفرد.

## [5.14.0] — 2026-10-25
- refactor(stats): 2026-10-25 — الحلقات والساعات والحضور من شيتات المعلمين وحدها في كل الأشهر، وحُذف «قبل النظام» و«منذ التأسيس» و`legacy_stats.py`، وقائمة معلمين واحدة للأرقام والأسعار، ولا يكتب السجل تبويب «الحلقات» بعد اليوم (S-53).

## [5.13.0] — 2026-10-25
- feat(stats): 2026-10-25 — من أكتوبر 2026 تُقرأ الحلقات وساعاتها وحضورها من شيتات المعلمين من أول الشهر، في الملف العام واللوحة، فيتفق رقم الساعات وتكلفة الساعة والمستحقات، ويبقى الطلاب من السجل، ولا يُعدّ أكتوبر في «منذ التأسيس» مرتين (S-52).

## [5.12.0] — 2026-10-25
- feat(pay): 2026-10-25 — الأسعار تُحفظ كلها بطلب واحد (`saveRates`)، والمصروفات الثابتة كذلك (`saveFixed`)، ويُتحقق من الكل قبل كتابة شيء؛ والوسائط أزواج `n0`، `v0`…

## [5.11.0] — 2026-10-25
- feat(pay): 2026-10-25 — أُلغي S-49: ساعات المستحقات من شيت تقارير كل معلم وحده من أول أكتوبر 2026، بلا المكرر وصفّي الإجمالي والمتوسط، وعليها تُقسم تكلفة الساعة (S-50)؛ ومصروفان ثابتان كل شهر، «الهدايا والتكريمات» و«إدارة الأكاديمية»، في ملف الأسعار خلف كلمة مرور الرواتب (S-51).

## [5.10.0] — 2026-10-25
- feat(pay): 2026-10-25 — مستحقات سبتمبر وأكتوبر قبل التثبيت من ساعات «قبل النظام» بسعر كل معلم، وقائمة الأسعار تضم من لم يُنشأ له تبويب، ومصروف أكتوبر يجمع الجزأين وتُقسم تكلفة ساعته على ساعاتهما (S-49).

## [5.9.0] — 2026-10-25
- feat(pay): 2026-10-25 — كلمة مرور ثانية للرواتب (`PAY_PASSWORD`): لا يرسل الـ API الأسعار ولا المستحقات ولا سجلها إلا لجلسة فتحتها، نصف ساعة أو حتى تُقفل، ولها قفل تخمين مستقل؛ ونُقلت الأسعار وسجلها إلى ملف `أسعار ساعات معلمي سنا` في Drive المالك خارج مجلد الأكاديمية، وحُذف تبويبها الفارغ من السجل الحي (S-47، S-48).

## [5.8.0] — 2026-10-25
- feat(install): 2026-10-25 — يوم التثبيت: شُغّل السجل (`ENABLED`) وثُبّت المؤقّت الليلي، فأنشأ أول تقرير حي سجل الطلاب، وأنشأ التحديث الليلي الملف العام، ولُصقت فيه أرقام «قبل النظام» (سبتمبر وأكتوبر حتى 24 منه) وشورك «لكل من معه الرابط: عارض»، ودُمج الفرع في `master`.
- test(telegram): 2026-10-25 — تحقق حي: إشعار أول تقرير ذكر «حلقة 32» في سطر «الفترة / النوع» (إصلاح 5.2.2).

## [5.7.1] — 2026-10-25
- fix(students): 2026-10-25 — حفظ البديل لاسم خطأ له بديل يستبدل صفه ولا يضيف صفاً ثانياً؛ وكلمة مرور اللوحة في `Config.local.js` أولاً؛ ونُشرت اللوحة على GitHub Pages بنشر مرقّم للسكربت (المرحلة D4).

## [5.7.0] — 2026-10-24
- feat(api): 2026-10-24 — `Api.js`: اللوحة تكلّم السكربت بـ `doPost` وحدها، بكلمة مرور في Script Properties وجلسة ست ساعات وقفل ربع ساعة بعد عشر محاولات خاطئة، وكل كتابة تُسجَّل في «سجل التعديلات» باسم من دخل؛ وحُذف `doGet` فلا تُخدم صفحة HtmlService، ونُشر السكربت باسم المالك لأي زائر (S-38…S-44، المرحلة D2). والصفحة لا تعمل حتى تنتقل إلى GitHub Pages في D3.

## [5.6.0] — 2026-10-24
- feat(pay): 2026-10-24 — سعر ساعة لكل معلم بالجنيه من لوحة الإدارة (تبويب «أسعار الساعة»، `saveTeacherRate`، ينتقل إلى سجل السنة الجديدة)، وجدول مستحقات شهري لكل معلم في اللوحة وحدها، ومصروف الشهر في الملف العام صار المستحقات مع المصروفات الأخرى ويُترك فارغاً إن بقي معلم بلا سعر، والنظام كله بالجنيه فحُذف اختيار العملة (S-34…S-37).

## [5.5.0] — 2026-10-24
- feat(dashboard): 2026-10-24 — قائمة الغائبين أكثر من 14 أو 30 يوماً وعمود «أيام الغياب»، وبحث لا يفرّق بين ة/ه وصور الهمزة، ورابط WhatsApp بجانب الهاتف المحفوظ.
- feat(students): 2026-10-24 — سنة الميلاد ورقم الهاتف لكل طالب من لوحة الإدارة (`setStudentDetails`، عمودان بعد M يُعرفان بعنوانهما)، ويُعرض السن، وينتقلان إلى سجل السنة الجديدة، ويملأ الدمج الخانة الفارغة من الصف الخطأ؛ وأُصلح في اللوحة ربط الجنس بالمعلم والطالب معاً.

## [5.4.0] — 2026-10-24
- feat(dashboard): 2026-10-24 — لوحة الإدارة تطبيقَ ويب بصلاحيات الزائر (`Dashboard.js` و`DashboardPage.html`): تعرض الأرقام والطلاب والبدائل والمصروفات، وتكتب تصحيح الاسم بدمج فوري بعد المراجعة، وحذف البديل (`deleteAlias`)، وتصحيح الجنس، والمصروف؛ ولا يُنشئ البحث عن المجلد الجذر مجلداً عند الزائر (`_findRootFolder`) (M5).

## [5.3.0] — 2026-10-24
- feat(stats): 2026-10-24 — `legacy_stats.py` يحسب أرقام الحلقات من ملفات التقارير قبل التثبيت ملفَّ CSV لتبويب «قبل النظام»، وطابق في أكتوبر عدّ «سمية حمدي» اليدوي (5 حلقات و21 حضوراً)، وعدّ ملف «فاطمة إبراهيم» 15-10 «(1)» حلقة ثانية؛ ووُثّق السجل والملف العام في `README.md` و`USER_GUIDE.md` (M4).
- feat(students): 2026-10-24 — `Students.js` بدوال سجل الطلاب الصرفة (المحلّل، ومفتاح المطابقة، والبدائل، والعدّ بالحلقة، والدمج، وتحويل الصف)، وأربعة أجنحة اختبار؛ ولا يستدعيها مسار التقرير بعد (M1).
- feat(students): 2026-10-24 — ملف السجل السنوي وتبويباته، وكتابة صفوف الطلاب و«الحلقات» مع كل تقرير، و`applyAlias` و`applyPendingAliases` و`setStudentGender`، وسطر «طلاب جدد» في Telegram؛ والمفتاح `CONFIG.STUDENTS_REGISTRY.ENABLED` مطفأ حتى يوم التثبيت (M2).
- feat(stats): 2026-10-24 — `PublicStats.js`: ملف `إحصاءات أكاديمية سنا <السنة>` بلا أسماء («الإجمالي» مع «منذ التأسيس»، و«شهرياً» بلقطة ثابتة بعد خامس الشهر التالي، و«قبل النظام» لا يُكتب فيه)، و`saveExpense`، و`nightlyStatsJob` و`installNightlyTrigger` الذي لا يُشغَّل إلا يوم التثبيت (M3).

## [5.2.2] — 2026-10-24
- fix(routing): `_parseReportDate` يقرأ التاريخ المكتوب بلا مسافة قبل اسم الشهر («7أكتوبر ٢٠٢٦»)، فلا يُصنَّف تقريره بتاريخ إرساله.
- fix(teachers): معرّف المعلم غير المسجّل في `CONFIG.TEACHERS` صار من SHA-256 الاسم كله (`T_` وثمانية أحرف hex)، فلا تشترك فيه معلمتان أولُ اسميهما واحد، ولا يُقرأ منه الاسم.
- fix(telegram): سطر «الفترة / النوع» في الإشعار يذكر رقم الحلقة، فلا تتشابه رسالتا حلقتين في يوم واحد.

## [5.2.1] — 2026-10-10
- feat(teachers): أُضيفت المعلمة «سمية حمدي» بالمعرّف `T008` إلى سجل `CONFIG.TEACHERS`.

## [5.2.0] — 2026-10-01
- fix(retry): إعادة المحاولة تقتصر على حفظ الملف في Drive، فلا يُنتج فشلٌ لاحق (سجل الأخطاء أو Telegram) ملفاً مكرراً أو صفاً مكرراً أو إشعاراً مكرراً؛ وأخطاء التسجيل غير القاتلة لا توقف المعالجة (`_safeLogToDrive`).
- fix(lock): رفع مهلة القفل إلى 4 دقائق حتى لا تُسقط الإرسالات المتزامنة، وتنبيه البريد يذكر المعلم وأن التقرير لم يُحفظ.
- fix(routing): توجيه التقرير إلى مجلد وتبويب شهر تاريخه المكتوب في التقرير (`_parseReportDate`) لا شهر إرساله، مع الرجوع لوقت الإرسال عند تعذر القراءة.
- fix(duplicates): قراءة «رقم الحلقة» وإدراجه في اسم الملف وعمود الحلقة، فلا تُعلَّم حلقتان من النوع نفسه في اليوم نفسه «مكررتين».
- fix(drive): تجاهل العناصر المحذوفة إلى سلة المهملات في كل عمليات البحث بالاسم (`_firstNotTrashed`).
- fix(duration): رفض قيم مثل `1.5` و`1:30` بدل قراءتها 15 أو 130 ساعة (`_parseWholeNumber`).
- fix(telegram): فشل الإرسال يُسجَّل في سجل Drive، وعدد الطلاب المجهول يظهر «غير محدد» لا 0.
- test: اختبارات التكامل تعمل على مجلد اختبار منفصل (`TEST_ROOT_FOLDER_ID`) دون Telegram وتتحقق فعلياً من النتائج، مع اختبارات وحدة جديدة للتاريخ ورقم الحلقة والمدة.

## [5.1.2] — 2026-09-06
- feat(teachers): أُضيفت المعلمات «رجاء لطفي» بالمعرّف `T004`، و«فاطمة عزت» بالمعرّف `T005`، و«سمية فتحي» بالمعرّف `T006`، و«سارة العدل» بالمعرّف `T007` إلى سجل `CONFIG.TEACHERS`.

## [5.1.1] — 2026-08-31
- feat(teachers): أُضيفت المعلمة «فاطمة إبراهيم» بالمعرّف `T003` إلى سجل `CONFIG.TEACHERS`.

## [5.1.0] — 2026-08-29

### test: complete test suite rewrite & v5.1 idiomatic polish
- Rewrote `Test.js` from scratch into an automated mini-framework covering 111 unit assertions across 12 test suites.
- Added 5 end-to-end integration test scenarios (normal submission, duplicate detection, eastern digits, missing fields, unknown teacher).
- Replaced all legacy `var` declarations with strict `const`/`let` scoping.
- Hardened `withRetry` with immediate propagation for `NON_RETRYABLE` errors (quota, rate-limit, auth).
- Fixed `getFieldCaseInsensitive` to preserve strict `null` instead of returning literal string `"null"`.
- Escaped `fileUrl` in Telegram HTML payload and refactored request options to immutable builders.
- Prevented orphaned empty month folders in Drive during PDF export attempts.

## [5.0.0] — 2026-08-29

### refactor: clean-code-guard pass (Version 5 - Clean Code Release)

**Security**
- Removed hardcoded Telegram Bot Token, Chat ID, and alert email from `Code.js`.
  Sensitive values now live in `Config.local.js` (gitignored, deployed via clasp).
  `Script Properties` remains a supported fallback for shared/team environments.
  See `Config.local.example.js` for setup.

**New files**
- `Config.local.js` — local secrets file (gitignored).
- `Config.local.example.js` — template committed to repo.
- `Diagnostics.js` — diagnostic functions moved out of production code:
  `authorizeAndTest`, `testTelegramConnection`, `getTelegramUpdates`.

**Bug fixes**
- Telegram notification failures now logged to Drive error log instead of being silently discarded.
- PDF export errors per-teacher now logged to Drive error log.
- `saveMarkdownFile` no longer mutates the `data` argument (CQS fix); returns `{ file, isDuplicate, duplicateIndex }`.
- `removeSummaryRows` replaced per-row `getValue()` API calls with a single batch `getValues()` read.

**Refactor**
- Extracted `_resolveTeacher`, `_parseDuration`, `_resolveSessionAndDate`, `_formatSubmissionDate` from monolithic `validateFormData` (154 → ~30 lines).
- Extracted `_formatArabicHours` to eliminate duplicated inline Arabic grammar logic.
- Extracted `_resolveDrivePath` shared by `resolveTargetFolder` and `exportTeacherMonthlyPdf`.
- Extracted `_exportOneTeacher` from `exportAllTeachersMonthlyPdf` for isolation and Drive logging.
- Removed "Step N:" scaffolding comments from `executeSubmissionPipeline`.
- Added "why" comment to `normalizeDigitsAndText` explaining the `split/join` workaround.
- Renamed `values` → `formFields` in `extractFormData` for clarity.

## [4.0.0] — 2026-08-26
- feat: Apps Script يعالج استجابات Google Forms ويحفظ التقارير Markdown في Drive.
- feat: ربط `clasp` عبر `.clasp.json` و`.claspignore` للدفع والسحب من الطرفية.
- feat: مستودع Git محلي مستقل مع `.gitignore`.
- feat: الإصدار الرابع: نموذج أقصر، واستخراج التاريخ والفترة وعدد الطلاب من المتن، وجداول Sheets سنوية بتبويبات شهرية RTL.
- feat: إشعارات `@sana_reportsbot` في Telegram لإدارة الأكاديمية فور تسليم التقرير.
- feat: صفا الإجمالي والمتوسط أسفل جدول كل شهر.
- feat: تصدير جداول الشهور إلى PDF عند الطلب في مجلدات الشهور.
- refactor: إشعارات Telegram دفعاً مباشراً، وحذف الـ Webhook لقيود Apps Script.
- fix: تحويل الأرقام المشرقية (٠-٩) وتنقية نصوص WhatsApp من المحارف الخفية.
