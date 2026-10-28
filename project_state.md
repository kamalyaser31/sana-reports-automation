# حالة المشروع (Project State) — sana-reports-automation

**الإصدار:** `5.23.0` في `master`، والنشر المرقّم على النسخة 33. والسجل يعمل منذ يوم التثبيت 2026-10-25.
**تاريخ التحديث:** `2026-10-28`
**المستودع:** `https://github.com/kamalyaser31/sana-reports-automation` (خاص)
**التاريخ:** ما سبق في [CHANGELOG.md](./CHANGELOG.md)، والقرارات S-xx في [PLAN_STUDENTS_SHEET.md](./PLAN_STUDENTS_SHEET.md).

## المعرّفات الحية

- **الاستمارة:** `1cQC0Gn9whT0V0hWY5S34XeZLqgAHNDhpI4bpxbausXM`، والسكربت مربوط بها: `1oIlpDdcu94rv76YBzbWviGZLRxa1xsViLmEUMI6Y7h_yqgp1hxNHqGwf`.
- **النشر المرقّم:** `AKfycbwxv2ueJUqhNRX-rBSBGLqzm9ReKH59pWftoYi-cfRF7CdU8MK60XJZeyuKI2qhqm7I`، تكلّمه اللوحة؛ وبعد كل تعديل: `clasp push` ثم `clasp deploy -i` بهذا المعرّف، وإلا بقيت اللوحة على الكود القديم.
- **السجل:** `1KGvHUvjDMqig1_6m8992o8YvvxQ-fkLjDY4wGr5qZOk`، والملف العام `14x7drGCPR4Iwm1dRYKT_HKAigkeeDTAeNbFNlsNC_UM` (عارض لمن معه الرابط)، كلاهما في مجلد 2026.
- **الملف العام منشوراً على الويب** (تقرؤه `donors.html`): `2PACX-1vQ7aGR14f7fqNl1_dXTGZAGqQaocaBgDGhkiCDFJcBowcK9NTmmOR-3tLx6oKWPnZLMoKBN4Sk7GpsO`، «الإجمالي» `gid=0` و«شهرياً» `gid=1942124452`. ونسخة «قبل النظام» محفوظة في ملف خاص `1hQyyy8TCd7W3lWTls4M08F1uQBMYtcNOlA_oBaIkfo8`.

## البنية

- **`Code.js`:** مسار التقرير من `onFormSubmit`: يستخرج الترويسة، ويحفظ ملف md في `السنة/المعلم/الشهر`، ويكتب شيت المعلم، ثم السجل، ثم رسالة Telegram للإدارة، ثم رسائل أولياء الأمور. وفيه التنبيهات والعلامات والفحص الليلي (القسم التالي).
- **`Students.js`:** سجل الطلاب السنوي `طلاب أكاديمية سنا <السنة>`: تبويب لكل معلم (العمود M يحفظ الحلقات، وخانات الإدارة بعده)، و«الأسماء البديلة» و«المصروفات» و«أسعار الساعة»، و«الحلقات» اسم محجوز لا يُكتب. والعدّ مرة لكل حلقة (التاريخ، الفترة، الرقم). و`recordStudents` يردّ هواتف طلاب التقرير (`reportPhones`).
- **`PublicStats.js`:** `computePublicStats` صرفة تحسب «الإجمالي» و«شهرياً» من شيتات المعلمين (الحلقات والساعات والحضور) والسجل (الطلاب). ويكتب `refreshPublicStats` الملف بعد `assertNoNames`. ومصروف الشهر من `PAY_FROM` ('2026-10') = المستحقات + الثابتة + التكريمات + الأخرى، وتكلفة الساعة على ساعات التدريس المعروضة. و`PUBLIC_STATS.MONTH_TEACHERS` يقصر سبتمبر 2026 على أربعة معلمين لأخطاء في تقارير غيرهم. و`nightlyStatsJob` (02:00) يدمج البدائل المعلّقة، ثم يحدّث الملف (والسنة السابقة حتى 5 يناير)، ثم `checkMissedResponses`.
- **`Api.js`:** `doPost` المدخل الوحيد للوحة (`webapp`: USER_DEPLOYING، ANYONE_ANONYMOUS). الدخول SHA-256 لـ `DASHBOARD_PASSWORD`، والجلسة ست ساعات في CacheService، والقفل ربع ساعة بعد عشر محاولات. والرواتب بكلمة ثانية `PAY_PASSWORD` نصف ساعة. والكتابات التسع في `API_WRITES`: applyAlias وdeleteAlias وsaveStudents وsavePay وsaveExpense وaddHonor وdeleteHonor وeditReport وdeleteReport، وكلها في «سجل التعديلات» (والرواتب في «سجل الأسعار»).
- **`Dashboard.js`:** `buildDashboardData` صرفة تجمع بيانات اللوحة، ودوال `dashboard*` تنفّذ الكتابات وتردّ البيانات محدّثة. و`readTeacherSheetReports` يخبّئ صفوف الشيتات عشر دقائق؛ وتعديل التقرير وحذفه تحت القفل ببصمة الصف، ويُرفضان في الشهر الثابت.
- **`Honors.js`:** تبويب «التكريمات» في السجل، ومبلغ التكريم في ملف الأسعار.
- **`Parents.js`:** رسالة Telegram لكل طالب له هاتف إلى `TELEGRAM_PARENTS_CHAT_ID`، بزر `wa.me` فيه قسمه من التقرير. معطّلة بـ `PARENTS.ENABLED: false` حتى يطلبها كمال. و`LINK_LIMIT` 1937 لأنه أطول رابط فتح WhatsApp في تجربة 2026-10-28، و2184 فشل حتى من `api.whatsapp.com`؛ وما جاوزه يُرسل نصاً للنسخ.
- **ملف الأسعار** `أسعار ساعات معلمي سنا` في جذر Drive المالك، خارج المجلد المشارَك: الأسعار و«المصروفات الثابتة» و«مبلغ التكريم» و«سجل الأسعار».
- **`Diagnostics.js`:** `authorizeAndTest` وفحوص الربط. **`Test.js`:** `runAllUnitTests` بلا Drive، و`runAllTests` على مجلد الاختبار (يتجاوز ست دقائق في المحرر)، و`runLiveFixChecks`.
- **`Config.local.js`:** الأسرار، خارج Git، ويُرفع إلى Google بـ `clasp push`؛ و`_getSecret` يقرأ منه ثم من Script Properties.

## القرارات والضوابط

1. **ترتيب التحميل:** Apps Script يحمّل الملفات بالأبجدية، فلا يقرأ ثابتٌ في أعلى ملف ثابتاً من ملف بعده (لذلك `PAY_LOG_ACTION` في `Api.js`). و`.claspignore` قائمة سماح: كل ملف جديد يُضاف بـ `!`.
2. **عزل الأعطال:** فشل الشيت أو السجل أو Telegram لا يمنع حفظ ملف md، والأخطاء في `automation_errors_YYYY_MM.log` في Drive.
3. **التنبيهات:** `reportProblems` في سطر «تنبيه» برسالة Telegram، وإيميل `sendReportProblemEmail` إن فشلت الرسالة. وكل تشغيل يكتب `SAVED_<يوم>` بعد حفظ الملف و`DONE_<يوم>` في آخره، و`MARKS_SINCE` مع أول علامة. و`checkMissedResponses` يرسل إيميلاً بردود الأمس الناقصة ويحذف العلامات بعد 14 يوماً، و`reprocessMissedResponses` يعيد ما لم يُحفظ وحده. وما يوقف السكربت كله يُنبَّه عليه من إشعار فشل Google («Notify me immediately» في المشغّلين منذ 2026-10-28).
4. **الساعات اليدوية:** صف شيت عدد طلابه صفر يدخل الراتب، ولا يُعدّ حلقة ولا ساعات في الملف العام.
5. **المشاركة (كمال، 2026-10-24):** `ibgad9800@gmail.com` محرر في مجلد الأكاديمية `1VN8XH-kFriJrVfh_-lZ0iNbMPGnyZRKu` وفي الاستمارة، فهو محرر للسكربت ويرى `Config.local.js` ورمز البوت؛ ومحرر في مجلد الاختبار ليجرّب اللوحة بـ `?test=1`.
6. **الإرسال المباشر من تطبيق المعلمين إلى السكربت مرفوض (كمال، 2026-10-27).**

## العمل المعلّق

في [task.md](./task.md).
