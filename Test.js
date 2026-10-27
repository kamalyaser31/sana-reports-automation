/**
 * ============================================================================
 * Test.js — Comprehensive Regression Test Suite
 * Sana Academy Reports Automation v5.1
 * ============================================================================
 *
 * ENTRY POINTS:
 *   runAllUnitTests()  — اختبارات الوحدة فقط (~3 ثوانٍ، بدون Drive/Sheets)
 *   runAllTests()      — الجناحان معاً: وحدة + تكاملي (نحو خمس دقائق، قرب حد الست)
 *   runLiveFixChecks() — تعديل التقارير وحذفها وصفوف التبويب وحدها (~دقيقتان)
 *
 * كيفية التشغيل:
 *   افتح محرر Apps Script → اختر الدالة من القائمة → Run.
 *   اقرأ نتيجة كل اختبار في Execution Log.
 * ============================================================================
 */

// ============================================================================
// ① إطار الاختبار المصغّر (Mini Test Framework)
// ============================================================================

/** حالة الجلسة — تُصفَّر في بداية كل تشغيل. */
let _T = { pass: 0, fail: 0, log: [] };

/** يُسجّل عنواناً فرعياً داخل الجناح الحالي. */
function _section(label) {
  _T.log.push(`\n    · ${label}`);
}

/** يشغّل جناحاً ويحتجز أي استثناء غير متوقع. */
function _suite(name, fn) {
  _T.log.push(`\n╔══ ${name}`);
  try { fn(); }
  catch (e) {
    _T.fail++;
    _T.log.push(`  ✗ [SUITE CRASHED] ${e.message}\n     ${e.stack}`);
  }
  _T.log.push('╚══');
}

/** يُسجّل اختباراً ثنائي القيمة (نجح / فشل). */
function _ok(cond, name, hint) {
  if (cond) {
    _T.pass++;
    _T.log.push(`  ✓ ${name}`);
  } else {
    _T.fail++;
    _T.log.push(`  ✗ ${name}${hint ? '  →  ' + hint : ''}`);
  }
}

/** يقارن بالقيمة (عبر JSON.stringify لدعم المصفوفات والكائنات). */
function _eq(actual, expected, name) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  _ok(a === b, name, a === b ? '' : `got ${a}, want ${b}`);
}

/** يتحقق أن القيمة null بالضبط. */
function _isNull(val, name) {
  _ok(val === null, name, `expected null, got ${JSON.stringify(val)}`);
}

/** يتحقق أن السلسلة تحتوي على جزء معيّن. */
function _has(str, sub, name) {
  _ok(String(str).includes(sub), name, `"${sub}" not found`);
}

/** يطبع التقرير النهائي في Execution Log. */
function _report(label) {
  const total = _T.pass + _T.fail;
  const sep   = '═'.repeat(64);
  const msg   = _T.fail === 0
    ? `✓  ALL ${total} TESTS PASSED`
    : `✗  ${_T.fail} FAILED  /  ${total} TOTAL`;
  console.log([sep, `  ${label || 'RESULT'}`, _T.log.join('\n'), '', sep, `  ${msg}`, sep].join('\n'));
}

// ============================================================================
// ② اختبارات الوحدة (Unit Tests)
// ============================================================================

// ─── normalizeDigitsAndText ──────────────────────────────────────────────────
function _testNormalize() {
  _suite('normalizeDigitsAndText', () => {
    _eq(normalizeDigitsAndText(null),  '',    'null → empty');
    _eq(normalizeDigitsAndText('٠١٢٣٤٥٦٧٨٩'), '0123456789', 'all eastern → western');
    _eq(normalizeDigitsAndText('عدد الطلاب: ٢٥'), 'عدد الطلاب: 25', 'arabic label + eastern digits');
    _eq(normalizeDigitsAndText('test\u200Bval'), 'test val', 'zero-width space → space');
    _eq(normalizeDigitsAndText('abc\uFEFFdef'), 'abc def', 'BOM stripped');
    _eq(normalizeDigitsAndText('\u00A0'), ' ', 'non-breaking space → space');
  });
}

// ─── parseReportMetadata ─────────────────────────────────────────────────────
function _testParseMetadata() {
  _suite('parseReportMetadata', () => {
    _section('empty / invalid input');
    _eq(parseReportMetadata(null), { dateText: '', sessionTypeText: '', studentCountText: '', halaNumText: '' }, 'null input');

    _section('full valid report');
    const report = `═══ [ تقرير ] ═══\nالتاريخ: 29-08-2026\nالفترة: تجويد\nعدد الطلاب: 8\n━━━\nمتن.`;
    const m1 = parseReportMetadata(report);
    _eq(m1.dateText,         '29-08-2026', 'date extracted');
    _eq(m1.sessionTypeText,  'تجويد',      'session extracted via الفترة');
    _eq(m1.studentCountText, '8',          'student count extracted');

    _section('نوع الحلقة alias');
    const report2 = `نوع الحلقة: مسائية\nعدد الطلاب: 12`;
    _eq(parseReportMetadata(report2).sessionTypeText, 'مسائية', 'نوع الحلقة alias works');

    _section('eastern arabic digits in report');
    const report3 = `التاريخ: ٢٩-٠٨-٢٠٢٦\nالفترة: صباحية\nعدد الطلاب: ٢٠`;
    const m3 = parseReportMetadata(report3);
    _eq(m3.dateText, '٢٩-٠٨-٢٠٢٦', 'date preserved as-is from body');
    _eq(m3.studentCountText, '٢٠',    'eastern count preserved as-is (normalization is callers job)');

    _section('full-width arabic colon ：');
    const report4 = `التاريخ：15-08-2026\nالفترة：تجويد\nعدد الطلاب：5`;
    const m4 = parseReportMetadata(report4);
    _eq(m4.dateText,        '15-08-2026', 'full-width colon: date');
    _eq(m4.sessionTypeText, 'تجويد',      'full-width colon: session');

    _section('رقم الحلقة');
    const report5 = `التاريخ: 29-08-2026\nالفترة: صباحية\nرقم الحلقة: ٢\nعدد الطلاب: 5`;
    _eq(parseReportMetadata(report5).halaNumText, '٢', 'hala number extracted');
    _eq(parseReportMetadata(report).halaNumText,  '',  'no hala number → empty');
  });
}

// ─── _parseReportDate ────────────────────────────────────────────────────────
function _testParseReportDate() {
  _suite('_parseReportDate', () => {
    const same = (d, y, m, day) => d !== null && d.getFullYear() === y && d.getMonth() === m && d.getDate() === day;

    _ok(same(_parseReportDate('29-08-2026'), 2026, 7, 29),  'DD-MM-YYYY');
    _ok(same(_parseReportDate('05/01/2026'), 2026, 0, 5),   'DD/MM/YYYY');
    _ok(same(_parseReportDate('٢٩-٠٨-٢٠٢٦'), 2026, 7, 29),  'eastern digits DD-MM-YYYY');
    _ok(same(_parseReportDate('الأربعاء، ٣٠ سبتمبر ٢٠٢٦'), 2026, 8, 30), 'report app long Arabic form');
    _ok(same(_parseReportDate('‏الخميس، ١ أكتوبر ٢٠٢٦'), 2026, 9, 1), 'RLM mark ignored');
    _ok(same(_parseReportDate('الأربعاء، 7أكتوبر ٢٠٢٦'), 2026, 9, 7), 'no space before month');
    _isNull(_parseReportDate(''),                'empty → null');
    _isNull(_parseReportDate('تاريخ غير محدد'),  'free text → null');
    _isNull(_parseReportDate('31-02-2026'),      'impossible date → null');
    _isNull(_parseReportDate('30 شهر 2026'),     'unknown month name → null');
  });
}

// ─── getFieldCaseInsensitive ─────────────────────────────────────────────────
function _testGetFieldCI() {
  _suite('getFieldCaseInsensitive', () => {
    const obj = {
      'اسم المعلم':  'محمد نبيل',
      ' الساعات ':   '2',
      'التقرير':     '',
      'nullField':   null,
      'undefField':  undefined,
    };

    _eq(getFieldCaseInsensitive(obj, 'اسم المعلم'),  'محمد نبيل', 'exact match');
    _eq(getFieldCaseInsensitive(obj, 'الساعات'),     '2',         'trims key whitespace');
    _eq(getFieldCaseInsensitive(obj, 'NULLFIELD'),   null,        'null value → null (not "null" string)');
    _eq(getFieldCaseInsensitive(obj, 'UNDEFFIELD'),  null,        'undefined value → null (not "undefined" string)');
    _eq(getFieldCaseInsensitive(obj, 'التقرير'),     '',          'empty string returned as-is');
    _isNull(getFieldCaseInsensitive(obj, 'غير موجود'), 'missing key → null');
    _isNull(getFieldCaseInsensitive(null, 'key'),      'null obj → null');
  });
}

// ─── _formatArabicHours ──────────────────────────────────────────────────────
function _testFormatArabicHours() {
  _suite('_formatArabicHours', () => {
    _eq(_formatArabicHours(1),   'ساعة',    '1 → ساعة');
    _eq(_formatArabicHours(2),   'ساعتان',  '2 → ساعتان');
    _eq(_formatArabicHours(3),   'ساعات',   '3 → ساعات');
    _eq(_formatArabicHours(10),  'ساعات',   '10 → ساعات');
    _eq(_formatArabicHours(11),  'ساعة',    '11 → ساعة (كبير = مفرد)');
  });
}

// ─── sanitizeFilename ────────────────────────────────────────────────────────
function _testSanitize() {
  _suite('sanitizeFilename', () => {
    _eq(sanitizeFilename(''),           'unnamed',             'empty → unnamed');
    _eq(sanitizeFilename(null),         'unnamed',             'null → unnamed');
    _eq(sanitizeFilename('a/b\\c:d'),   'a_b_c_d',            'forbidden chars → underscore');
    _eq(sanitizeFilename(' trim '),     'trim',                'leading/trailing space trimmed');
    _eq(sanitizeFilename('29-08_تجويد'), '29-08_تجويد',       'arabic + hyphens preserved');
    _eq(sanitizeFilename('line\nnew'),   'line new',           'newline → space');
  });
}

// ─── escapeHtml ──────────────────────────────────────────────────────────────
function _testEscapeHtml() {
  _suite('escapeHtml', () => {
    _eq(escapeHtml(null),       '',          'null → empty');
    _eq(escapeHtml('a<b>&c'),   'a&lt;b&gt;&amp;c', '<, > and & escaped');
  });
}

// ─── _formatSubmissionDate ───────────────────────────────────────────────────
function _testFormatDate() {
  _suite('_formatSubmissionDate', () => {
    const d = _formatSubmissionDate(new Date(2026, 7, 29)); // Aug 29 2026
    _eq(d.monthFolderName, '08 - أغسطس',   'arabic month name');
    _eq(d.dateFormatted,   '29-08-2026',    'DD-MM-YYYY format');

    const d2 = _formatSubmissionDate(new Date(2026, 0, 5)); // Jan 5 2026
    _eq(d2.monthFolderName, '01 - يناير',  'january arabic');
    _eq(d2.dateFormatted,   '05-01-2026',   'zero-padded day');
  });
}

// ─── _resolveTeacher ─────────────────────────────────────────────────────────
function _testResolveTeacher() {
  _suite('_resolveTeacher', () => {
    _section('معلم معروف');
    const mf1 = [];
    const r1 = _resolveTeacher({ rawTeacherName: 'محمد نبيل' }, mf1);
    _eq(r1.teacherName, 'محمد نبيل', 'known teacher name');
    _eq(r1.teacherId,   'T001',       'known teacher ID');
    _eq(mf1.length,     0,            'no missing fields');

    _section('معلم غير مُدرج في CONFIG');
    const mf2 = [];
    const r2 = _resolveTeacher({ rawTeacherName: 'معلم جديد' }, mf2);
    _eq(r2.teacherName,             'معلم جديد', 'unknown teacher name kept');
    _eq(mf2.length, 0,                 'not missing — just unknown');
    _ok(/^T_[0-9a-f]{8}$/.test(r2.teacherId), 'unknown teacher ID is T_ + 8 hex chars');
    _eq(_resolveTeacher({ rawTeacherName: 'معلم جديد' }, []).teacherId, r2.teacherId, 'same name → same ID');
    const fa = _resolveTeacher({ rawTeacherName: 'فاطمة سالم' }, []).teacherId;
    const fb = _resolveTeacher({ rawTeacherName: 'فاطمة حسن' }, []).teacherId;
    _ok(fa !== fb, 'two new teachers sharing a first name get different IDs');

    _section('اسم فارغ');
    const mf3 = [];
    const r3 = _resolveTeacher({ rawTeacherName: '' }, mf3);
    _eq(r3.teacherName, CONFIG.FALLBACKS.TEACHER_NAME, 'empty → fallback name');
    _eq(mf3, [CONFIG.FIELDS.TEACHER],                   'empty → teacher field in missingFields');
  });
}

// ─── _parseDuration ──────────────────────────────────────────────────────────
function _testParseDuration() {
  _suite('_parseDuration', () => {
    _section('حالة عادية');
    const d1 = _parseDuration({ rawHours: '2', rawMinutes: '30' }, [], []);
    _eq(d1.hours,             2,               'hours');
    _eq(d1.minutes,           30,              'minutes');
    _eq(d1.durationTime,      '02:30',         'durationTime HH:MM');
    _eq(d1.durationFormatted, '2 ساعتان و30 دقيقة', 'Arabic formatted');

    _section('تجاوز الدقائق (overflow)');
    const d3 = _parseDuration({ rawHours: '1', rawMinutes: '90' }, [], []);
    _eq(d3.hours,   2,  '1h + 90min → 2h');
    _eq(d3.minutes, 30, '90min remainder → 30');

    _section('صفر ساعات وصفر دقائق');
    const d4 = _parseDuration({ rawHours: '0', rawMinutes: '0' }, [], []);
    _eq(d4.durationFormatted, '0 دقيقة', 'zero → 0 دقيقة');
    _eq(d4.durationTime,      '00:00',   'zero time HH:MM');

    _section('دقائق فقط');
    const d5 = _parseDuration({ rawHours: '0', rawMinutes: '45' }, [], []);
    _eq(d5.durationFormatted, '45 دقيقة', 'minutes-only format');

    _section('حقول مفقودة');
    const mf6 = []; const d6 = _parseDuration({ rawHours: null, rawMinutes: null }, mf6, []);
    _ok(mf6.includes(CONFIG.FIELDS.HOURS),   'null hours → missing');
    _ok(mf6.includes(CONFIG.FIELDS.MINUTES), 'null minutes → missing');

    _section('قيمة غير صالحة');
    const ve7 = []; _parseDuration({ rawHours: 'abc', rawMinutes: '30' }, [], ve7);
    _ok(ve7.length > 0, 'non-numeric hours → validationErrors');

    _section('كسور وصيغ غير صحيحة لا تُقرأ خطأً');
    const ve9 = []; const d9 = _parseDuration({ rawHours: '1.5', rawMinutes: '0' }, [], ve9);
    _ok(ve9.length > 0, '"1.5" hours → validationErrors');
    _eq(d9.hours, 0,    '"1.5" is not read as 15 hours');
    const ve10 = []; const d10 = _parseDuration({ rawHours: '1:30', rawMinutes: '0' }, [], ve10);
    _ok(ve10.length > 0, '"1:30" hours → validationErrors');
    _eq(d10.hours, 0,    '"1:30" is not read as 130 hours');
    const ve11 = []; const d11 = _parseDuration({ rawHours: ' 2 ', rawMinutes: '٤٥' }, [], ve11);
    _eq(ve11.length, 0,          'surrounding spaces accepted');
    _eq(d11.durationTime, '02:45', 'spaces + eastern digits parsed');

    _section('ساعة واحدة بدون دقائق');
    const d8 = _parseDuration({ rawHours: '1', rawMinutes: '0' }, [], []);
    _eq(d8.durationFormatted, '1 ساعة', 'hour-only format');
  });
}

// ─── _resolveSessionAndDate ──────────────────────────────────────────────────
function _testResolveSession() {
  _suite('_resolveSessionAndDate', () => {
    _section('بيانات كاملة — فترة معروفة');
    const r1 = _resolveSessionAndDate({
      bodyMetadata: { sessionTypeText: 'تجويد', dateText: '29-08-2026', studentCountText: '8' }
    }, []);
    _eq(r1.sessionType,    'تجويد',      'session type');
    _eq(r1.sessionId,      'TAJWEED',    'known session ID');
    _eq(r1.reportDateText, '29-08-2026', 'date');
    _eq(r1.studentCount,   8,            'student count');

    _section('فترة غير مُدرجة في CONFIG');
    const r2 = _resolveSessionAndDate({
      bodyMetadata: { sessionTypeText: 'حلقة خاصة', dateText: '01-09-2026', studentCountText: '3' }
    }, []);
    _ok(r2.sessionId.startsWith('SESSION_'), 'unknown session → SESSION_ prefix');

    _section('أرقام عربية في عدد الطلاب');
    const r3 = _resolveSessionAndDate({
      bodyMetadata: { sessionTypeText: 'مسائية', dateText: '29-08-2026', studentCountText: '٢٥' }
    }, []);
    _eq(r3.studentCount, 25, 'eastern arabic student count normalized');

    _section('بيانات مفقودة كلياً');
    const mf4 = [];
    const r4 = _resolveSessionAndDate({ bodyMetadata: { sessionTypeText: '', dateText: '', studentCountText: '' } }, mf4);
    _eq(r4.sessionType, CONFIG.FALLBACKS.SESSION_TYPE, 'fallback session type');
    _ok(mf4.length >= 3, 'all three fields added to missing list');
  });
}

// ─── validateFormData ────────────────────────────────────────────────────────
function _testValidate() {
  _suite('validateFormData', () => {
    const fullReport = `═══ تقرير ═══\nالتاريخ: 29-08-2026\nالفترة: تجويد\nعدد الطلاب: 8\n━━━\nمتن التقرير.`;

    _section('بيانات كاملة صالحة');
    const rawOk = {
      rawTeacherName: 'محمد نبيل', rawStudentCategory: 'كبار',
      rawHours: '1', rawMinutes: '30',
      rawReportText: fullReport, rawAdminNotes: 'ملاحظة.',
      bodyMetadata: parseReportMetadata(fullReport),
      submissionTimestamp: '2026-08-29T14:00:00Z',
    };
    const v1 = validateFormData(rawOk, 'uuid-1', new Date(2026, 7, 29));
    _eq(v1.validationStatus,  'VALID',      'all valid → VALID');
    _eq([v1.teacherId, v1.durationTime, v1.sessionType, v1.studentCount], ['T001', '01:30', 'تجويد', 8],
      'teacher, duration and metadata combined');

    _section('بيانات مفقودة كلياً');
    const rawEmpty = {
      rawTeacherName: '', rawStudentCategory: '', rawHours: '', rawMinutes: '',
      rawReportText: '', rawAdminNotes: '',
      bodyMetadata: { dateText: '', sessionTypeText: '', studentCountText: '', halaNumText: '' },
      submissionTimestamp: '2026-08-29T14:00:00Z',
    };
    const v2 = validateFormData(rawEmpty, 'uuid-2', new Date(2026, 7, 29));
    _eq(v2.validationStatus, 'MISSING DATA',            'empty → MISSING DATA');
    _ok(v2.missingFields.length > 0,                    'missingFields populated');
    _eq(v2.teacherName,   CONFIG.FALLBACKS.TEACHER_NAME, 'fallback teacher name');
    _eq(v2.reportText,    CONFIG.FALLBACKS.REPORT_TEXT,  'fallback report text');

    _section('معلم غير مُدرج في CONFIG');
    const rawUnknown = { ...rawOk, rawTeacherName: 'معلم جديد' };
    const v4 = validateFormData(rawUnknown, 'uuid-4', new Date(2026, 7, 29));
    _eq(v4.validationStatus,         'VALID',     'unknown teacher is not a validation error');

    _section('تقرير متأخر يُحفظ في شهر تاريخه لا شهر إرساله');
    const lateReport = `التاريخ: الاثنين، ٣١ أغسطس ٢٠٢٦\nالفترة: مسائية\nرقم الحلقة: 2\nعدد الطلاب: 4`;
    const rawLate = { ...rawOk, rawReportText: lateReport, bodyMetadata: parseReportMetadata(lateReport) };
    const v5 = validateFormData(rawLate, 'uuid-5', new Date(2026, 8, 1)); // submitted Sep 1
    _eq(v5.submissionMonthFolderName, '08 - أغسطس', 'routed to August');
    _eq(v5.submissionDateFormatted,   '31-08-2026', 'filename date = report date');
    _eq(v5.halaNum,                   '2',          'hala number carried through');

    _section('تاريخ غير قابل للقراءة → وقت الإرسال');
    const rawBadDate = { ...rawOk, bodyMetadata: { ...rawOk.bodyMetadata, dateText: 'اليوم' } };
    const v6 = validateFormData(rawBadDate, 'uuid-6', new Date(2026, 8, 1));
    _eq(v6.submissionMonthFolderName, '09 - سبتمبر', 'falls back to submission month');
  });
}

// ─── generateMarkdownContent ─────────────────────────────────────────────────
function _testGenerateMarkdown() {
  _suite('generateMarkdownContent', () => {
    const data = {
      executionId: 'test-uuid', submissionTimestamp: '2026-08-29T14:00:00Z',
      teacherName: 'محمد نبيل', teacherId: 'T001',
      sessionType: 'تجويد', sessionId: 'TAJWEED',
      studentCategory: 'كبار',
      reportDateText: '29-08-2026', submissionDateFormatted: '29-08-2026',
      durationHours: 1, durationMinutes: 30,
      durationTime: '01:30', durationFormatted: '1 ساعة و30 دقيقة',
      studentCount: 8,
      validationStatus: 'VALID', missingFields: [], validationErrors: [],
      reportText: 'نص التقرير التجريبي الكامل.',
      adminNotes: 'ملاحظة إدارية.',
    };
    const md = generateMarkdownContent(data);

    _has(md, 'teacher_name: "محمد نبيل"',   'text fields quoted in frontmatter');
    _has(md, 'student_count: 8',            'numbers unquoted in frontmatter');
    _has(md, 'نص التقرير التجريبي',         'report body present');
    _has(md, 'ملاحظة إدارية',              'admin notes present');
    _ok(!md.includes('undefined'),          'no raw "undefined" strings in output');
    _ok(!md.includes('"null"'),             'no raw "null" strings in output');

    const mdHala = generateMarkdownContent({ ...data, halaNum: '2' });
    _has(mdHala, 'hala_num: "2"',          'hala_num in frontmatter');
    _has(mdHala, 'تجويد (حلقة 2)',         'hala number shown with session type');
  });
}

// ─── سجل الطلاب (Students.js) ────────────────────────────────────────────────

/** يبني نص تقرير بصيغة formatStudent في تطبيق التقارير. */
function _sampleReport(blocks) {
  const sep = '━━━━━━━━━━━━━━━';
  return ['بسم الله الرحمن الرحيم', 'التاريخ: الجمعة، ٢٣ أكتوبر ٢٠٢٦', 'الفترة: صباحية',
    'رقم الحلقة: 1', `عدد الطلاب: ${blocks.length}`, sep, _sampleStudentText(blocks)].join('\n');
}

/** كتل الطلاب وحدها بصيغة formatStudent، ثم خاتمة التقرير. */
function _sampleStudentText(blocks) {
  const sep = '━━━━━━━━━━━━━━━';
  const body = blocks.map(b => {
    const lines = [`${b.female ? 'الطالبة' : 'الطالب'}: ${b.name}`, ''];
    lines.push('التسميع:', 'سورة نوح 1-20', `التقييم: ${b.grade || 'ممتاز'}`, sep);
    if (b.hifz) lines.push('الحفظ الجديد:', b.hifz, sep);
    lines.push('الماضي المطلوب:', 'سورة الإنسان');
    if (b.medal) lines.push(sep, 'الوسام:', b.medal);
    return lines.join('\n') + `\n\n${sep}`;
  });
  return body.concat(['', '*نسأل الله لهم التوفيق والسداد.*']).join('\n');
}

/** سياق تقرير جاهز لـ applyReportToStudents. */
function _sampleContext(day, blocks, extra) {
  return Object.assign({
    reportId: `r-${day}`, teacher: 'سمية حمدي', date: new Date(2026, 9, day),
    slot: `2026-10-${String(day).padStart(2, '0')}|صباحية|1`, category: 'أطفال',
    students: parseStudentBlocks(_sampleReport(blocks)),
  }, extra || {});
}

function _testStudentKey() {
  _suite('studentNameKey / resolveStudentName', () => {
    _eq(studentNameKey('جودياحمد'), studentNameKey('جودي احمد'), 'spaces ignored');
    _eq(studentNameKey('أسماء علي'), studentNameKey('اسماء علي'), 'hamza forms → ا');
    _eq(studentNameKey('فاطمة محمد'), studentNameKey('فاطمه محمد'), 'ة = ه');
    _eq(studentNameKey('مُنى سامي'), studentNameKey('منى سامى'), 'tashkeel and ى ignored');
    _ok(studentNameKey('حمزة علي') !== studentNameKey('حمزة علاء'), 'different names stay different');
    _eq(cleanStudentName('  هدى‏   مصطفى '), 'هدى مصطفى', 'display name trimmed and collapsed');

    _section('الأسماء البديلة');
    const map = buildAliasMap([
      { teacher: 'سمية حمدي', from: 'حمزه عالء', to: 'حمزة علاء' },
      { teacher: 'سمية حمدي', from: 'منى', to: 'منى' },
    ]);
    _eq(resolveStudentName('سمية حمدي', 'حمزه  عالء', map).display, 'حمزة علاء', 'alias applied');
    _eq(resolveStudentName('محمد نبيل', 'حمزه عالء', map).display, 'حمزه عالء', 'alias is per teacher');
    _eq(Object.keys(map).length, 1, 'alias to the same key ignored');
    const chain = buildAliasMap([
      { teacher: 'T', from: 'أ ب', to: 'ج د' }, { teacher: 'T', from: 'ج د', to: 'هـ و' },
      { teacher: 'T', from: 'س ص', to: 'ع غ' }, { teacher: 'T', from: 'ع غ', to: 'س ص' },
    ]);
    _eq(resolveStudentName('T', 'أ ب', chain).display, 'هـ و', 'alias chain followed');
    _ok(Boolean(resolveStudentName('T', 'س ص', chain).key), 'alias cycle does not hang');
  });
}

function _testParseStudents() {
  _suite('parseStudentBlocks', () => {
    const blocks = parseStudentBlocks(_sampleReport([
      { name: 'حمزة علاء', hifz: 'سورة نوح ٢١-٢٨', grade: 'إعادة' },
      { name: 'هدى مصطفى', female: true, medal: 'أداء ممتاز ومتميز' },
      { name: 'بدون اسم' },
    ]));
    _eq(blocks.length, 2, 'two students, «بدون اسم» skipped');
    _eq(blocks[0].name, 'حمزة علاء', 'name');
    _eq(blocks[0].gender, STUDENT_GENDER.MALE, 'الطالب → ذكر');
    _eq(blocks[1].gender, STUDENT_GENDER.FEMALE, 'الطالبة → أنثى');
    _eq(blocks[0].hifz, 'سورة نوح 21-28', 'new memorization, digits normalized');
    _eq(blocks[1].hifz, '', 'empty memorization');
    _ok(blocks[0].hifz.indexOf('الإنسان') === -1, '«الماضي المطلوب» not read as memorization');
    _eq(blocks[0].repeats, 1, 'repeat counted');
    _eq(blocks[1].repeats, 0, 'no repeat');
    _ok(!blocks[0].medal && blocks[1].medal, 'medal detected');
    _eq(parseStudentBlocks('').length, 0, 'empty text → no students');
  });
}

function _testSlotRule() {
  _suite('applyReportToStudents (قاعدة الحلقة)', () => {
    const r1 = applyReportToStudents([], _sampleContext(1, [
      { name: 'حمزة علاء', grade: 'إعادة', hifz: 'نوح 1-10' }, { name: 'هدى مصطفى', female: true, medal: 'وسام' },
    ]), {});
    _eq(r1.newStudents, ['حمزة علاء', 'هدى مصطفى'], 'new students listed');
    _eq(r1.counted, 2, 'both counted');

    _section('إعادة إرسال التقرير نفسه');
    const again = applyReportToStudents(r1.students, _sampleContext(1, [
      { name: 'حمزه علاء', grade: 'إعادة' }, { name: 'هدى مصطفى', female: true, medal: 'وسام' },
    ]), {});
    _eq(again.counted, 0, 'resubmission counts nobody');
    _eq(again.newStudents.length, 0, 'ة/ه spelling is not a new student');
    const h = again.students.find(s => s.name === 'حمزة علاء');
    const st = deriveStudentStats(h.slots);
    _eq([st.attendance, st.repeats], [1, 1], 'attendance and repeats unchanged');
    _eq(deriveStudentStats(again.students.find(s => s.name === 'هدى مصطفى').slots).medals, 1, 'medal unchanged');
    _eq(r1.students[0].name, again.students[0].name, 'input not mutated');
    _eq(Object.keys(r1.students[0].slots).length, 1, 'input slots not mutated');

    _section('حلقة ثانية في اليوم نفسه');
    const second = applyReportToStudents(r1.students, _sampleContext(1, [{ name: 'سارة أحمد', female: true }],
      { slot: '2026-10-01|صباحية|2' }), {});
    _eq(second.counted, 1, 'second halaqa counted');

    _section('حلقة لاحقة، ثم تقرير متأخر');
    const later = applyReportToStudents(r1.students, _sampleContext(10, [{ name: 'حمزة علاء' }]), {});
    const late = applyReportToStudents(later.students, _sampleContext(5, [{ name: 'حمزة علاء', hifz: 'نوح 11-20' }]), {});
    const hz = late.students.find(s => s.name === 'حمزة علاء');
    const hs = deriveStudentStats(hz.slots);
    _eq(hs.attendance, 3, 'three halaqat');
    _eq(_isoDay(hs.lastSeen), '2026-10-10', 'late report does not change last seen');
    _eq(_isoDay(hs.firstSeen), '2026-10-01', 'first seen');
    _eq(late.students[0].name, 'حمزة علاء', 'newest attendance sorted first');
    _eq([hz.firstHifz, hz.lastHifz], ['نوح 1-10', 'نوح 11-20'], 'first and last memorization by date');
    _eq(hz.gender, STUDENT_GENDER.MALE, 'gender kept');
    const older = applyReportToStudents(late.students, _sampleContext(3, [{ name: 'حمزة علاء', hifz: 'نوح 5-6' }]), {});
    const ho = older.students.find(s => s.name === 'حمزة علاء');
    _eq([ho.firstHifz, ho.lastHifz], ['نوح 1-10', 'نوح 11-20'], 'older late memorization changes neither first nor last');

    _section('حلقة بلا حفظ لا تمحو آخر حفظ');
    const noHifz = applyReportToStudents(late.students, _sampleContext(12, [{ name: 'حمزة علاء' }]), {});
    _eq(noHifz.students.find(s => s.name === 'حمزة علاء').lastHifz, 'نوح 11-20', 'last memorization kept');

    _section('الجنس يُكتب عند الإنشاء وحده');
    const wrongPrefix = applyReportToStudents(r1.students, _sampleContext(3, [{ name: 'هدى مصطفى' }]), {});
    _eq(wrongPrefix.students.find(s => s.name === 'هدى مصطفى').gender, STUDENT_GENDER.FEMALE, 'existing gender not overwritten');

    _section('الاسم المكرر في تقرير واحد');
    const dup = applyReportToStudents([], _sampleContext(2, [
      { name: 'منى سامي', female: true, grade: 'إعادة' }, { name: 'منى سامى', female: true, grade: 'إعادة' },
    ]), {});
    _eq(dup.students.length, 1, 'same key folded into one row');
    _eq(dup.counted, 1, 'counted once');
    _eq(deriveStudentStats(dup.students[0].slots).repeats, 2, 'repeats of both blocks kept');

    _section('البديل يُطبَّق على تقرير جديد');
    const map = buildAliasMap([{ teacher: 'سمية حمدي', from: 'حمزه عالء', to: 'حمزة علاء' }]);
    const aliased = applyReportToStudents(r1.students, _sampleContext(4, [{ name: 'حمزه عالء' }]), map);
    _eq(aliased.newStudents.length, 0, 'aliased name is not new');
    _eq(deriveStudentStats(aliased.students.find(s => s.name === 'حمزة علاء').slots).attendance, 2, 'counted on the right row');

    _section('الفئة بالأغلب، والتعادل لأحدث حلقة');
    _eq(deriveStudentStats({ '2026-10-01|a|1': ['كبار', 0, 0], '2026-10-02|a|1': ['أطفال', 0, 0],
      '2026-10-03|a|1': ['كبار', 0, 0] }).category, 'كبار', 'majority category');
    _eq(deriveStudentStats({ '2026-10-01|a|1': ['كبار', 0, 0], '2026-10-02|a|1': ['أطفال', 0, 0] }).category,
      'أطفال', 'tie → latest halaqa');
  });
}

function _testMergeStudents() {
  _suite('applyAliasToStudents (الدمج)', () => {
    const base = applyReportToStudents([], _sampleContext(1, [
      { name: 'حمزة علاء', hifz: 'نوح 1-10' }, { name: 'حمزه عالء', grade: 'إعادة' },
    ]), {}).students;
    const withSecond = applyReportToStudents(base, _sampleContext(8, [{ name: 'حمزه عالء', hifz: 'نوح 11-20' }]), {}).students;
    const right = withSecond.find(s => s.name === 'حمزة علاء');
    right.gender = STUDENT_GENDER.FEMALE;
    right.extra = ['ملاحظة الإدارة'];

    const r = applyAliasToStudents(withSecond, { from: 'حمزه عالء', to: 'حمزة علاء' });
    _ok(r.changed, 'merged');
    _eq(r.students.length, 1, 'wrong row removed');
    const m = r.students[0];
    const st = deriveStudentStats(m.slots);
    _eq(st.attendance, 2, 'shared halaqa counted once');
    _eq(st.repeats, 0, 'shared slot keeps the correct row values');
    _eq(m.gender, STUDENT_GENDER.FEMALE, 'gender from the correct row');
    _eq(m.extra, ['ملاحظة الإدارة'], 'admin cells from the correct row');
    _eq([m.firstHifz, m.lastHifz], ['نوح 1-10', 'نوح 11-20'], 'memorization from both rows by date');

    _ok(!applyAliasToStudents(r.students, { from: 'حمزه عالء', to: 'حمزة علاء' }).changed, 'alias not applied twice');

    _section('بلا صف صحيح: إعادة تسمية');
    const renamed = applyAliasToStudents(base.filter(s => s.name === 'حمزه عالء'), { from: 'حمزه عالء', to: 'حمزة علي' });
    _eq([renamed.students[0].name, renamed.students[0].key], ['حمزة علي', studentNameKey('حمزة علي')], 'row and key renamed');

    _section('الصف والعمود M');
    const row = studentToRow(m);
    _eq(row.length, STUDENT_SYSTEM_COLUMNS + 1, 'A–M then admin cells');
    _eq(row[5], 2, 'F = attendance');
    const back = rowToStudent(row.slice(0, 1).concat(['أنثى']).concat(row.slice(2)));
    _eq([back.key, back.extra], [m.key, ['ملاحظة الإدارة']], 'row read back by key, admin cells kept');
    const respelled = rowToStudent(['حمزة علاءالدين'].concat(row.slice(1)));
    _eq(respelled.key, m.key, 'admin spelling fix in A keeps the key');
    _isNull(rowToStudent(['x', '', '', '', '', '', '', '', '', '', '', '', 'not json']), 'bad column M → null');
  });
}

function _testRegistryRows() {
  _suite('rowsToAliases', () => {
    const aliases = rowsToAliases([
      ['سمية حمدي', ' حمزه  عالء ', 'حمزة علاء', ''],
      ['سمية حمدي', 'منى', 'منى سامي', new Date()],
      ['', 'ناقص', 'ناقص', ''],
    ]);
    _eq(aliases.length, 2, 'incomplete alias row ignored');
    _eq([aliases[0].row, aliases[0].from, aliases[0].applied], [2, 'حمزه عالء', false], 'pending alias');
    _ok(aliases[1].applied, 'dated alias is applied');
    _eq(_teacherTabName('أ/ب:ج'), 'أ_ب_ج', 'tab name sanitized');
  });

  _suite('writeStudentsTab (F-01)', () => {
    const sheetWith = rows => {
      const cells = {};
      const ops = [];
      rows.forEach((row, i) => row.forEach((v, j) => { cells[`${i + 2},${j + 1}`] = v; }));
      const sheet = {
        ops, cells, failWrite: false,
        getLastRow: () => Math.max(1, ...Object.keys(cells).filter(k => cells[k] !== '').map(k => Number(k.split(',')[0]))),
        getLastColumn: () => STUDENT_SYSTEM_COLUMNS,
        getRange: (r, c, nr, nc) => ({
          setValues: v => {
            ops.push('write');
            if (sheet.failWrite) throw new Error('quota');
            v.forEach((row, i) => row.forEach((x, j) => { cells[`${r + i},${c + j}`] = x; }));
          },
          clearContent: () => {
            ops.push(`clear ${r}-${r + (nr || 1) - 1}`);
            for (let i = 0; i < (nr || 1); i++) for (let j = 0; j < (nc || 1); j++) cells[`${r + i},${c + j}`] = '';
          },
          setNumberFormat: () => {},
        }),
      };
      return sheet;
    };
    const student = (name, day) => ({ key: studentNameKey(name), name, gender: STUDENT_GENDER.MALE,
      slots: { [`${day}|صباحية|1`]: ['أطفال', 0, 0] }, firstHifz: '', lastHifz: '', extra: [] });
    const three = [student('حمزة علاء', '2026-10-03'), student('منى سامي', '2026-10-02'), student('علي حسن', '2026-10-01')];
    const sheet = sheetWith(three.map(studentToRow));
    writeStudentsTab(sheet, three.slice(0, 2), []);
    _eq([sheet.ops, sheet.getLastRow()], [['write', 'clear 4-4'], 3],
      'rows written first, then only the leftover row below is cleared');
    const failing = sheetWith(three.map(studentToRow));
    failing.failWrite = true;
    let thrown = '';
    try { writeStudentsTab(failing, three.slice(0, 2), []); } catch (e) { thrown = e.message; }
    _eq([thrown, failing.getLastRow(), failing.cells['2,1']], ['quota', 4, 'حمزة علاء'],
      'a failed write leaves the tab as it was, not empty');
  });
}

// ─── الملف العام (PublicStats.js) ────────────────────────────────────────────

/** معلمان وحلقات في سبتمبر وأكتوبر، والاسم المفرد «محمد» عند كليهما. */
function _sampleStatsInput(today, extra) {
  const rec = (name, slots) => ({ key: studentNameKey(name), name, gender: STUDENT_GENDER.MALE, slots });
  const slot = (day, s, cat) => ({ [`${day}|${s}|1`]: [cat, 0, 0] });
  return Object.assign({
    teachers: [
      { name: 'أسماء علي', code: 'T002', students: [
        rec('حمزة علاء', slot('2026-10-05', 'مسائية', 'كبار')),
        rec('محمد', slot('2026-10-05', 'مسائية', 'كبار')),
      ] },
      { name: 'محمد نبيل', code: 'T001', students: [
        rec('حمزة علاء', Object.assign(slot('2026-09-28', 'صباحية', 'أطفال'), slot('2026-10-03', 'صباحية', 'أطفال'))),
        rec('محمد', slot('2026-10-03', 'صباحية', 'أطفال')),
      ] },
    ],
    expenses: [['2026-10', 500, 'EGP'], ['2026-08', '', 'EGP']],
    rates: [['محمد نبيل', 100], ['أسماء علي', 80]],
    // The halaqat as the teacher sheets hold them (S-53).
    sheetReports: [
      { teacher: 'محمد نبيل', date: new Date(2026, 8, 28), month: '2026-09', category: 'أطفال', minutes: 60, attendance: 1 },
      { teacher: 'محمد نبيل', date: new Date(2026, 9, 3), month: '2026-10', category: 'أطفال', minutes: 60, attendance: 2 },
      { teacher: 'أسماء علي', date: new Date(2026, 9, 5), month: '2026-10', category: 'كبار', minutes: 90, attendance: 2 },
    ],
    fixed: [['إدارة الأكاديمية', 200]],
    today,
  }, extra || {});
}

/** تكريمات: اثنان لحمزة عند محمد نبيل في أكتوبر، وواحد في سبتمبر، وواحد عند أسماء، وصف تالف. */
function _sampleHonorRows() {
  return [
    ['2026-10-03', 'محمد نبيل', 'حمزة علاء', 'حفظ جزء', studentNameKey('حمزة علاء')],
    ['2026-10-04', 'محمد نبيل', 'حمزة علاء', '', studentNameKey('حمزة علاء')],
    ['2026-10-05', 'أسماء علي', 'محمد', '', studentNameKey('محمد')],
    ['تالف', 'x', 'y', '', 'k'],
    [new Date(2026, 8, 28), 'محمد نبيل', 'محمد', '', studentNameKey('محمد')],
  ];
}

function _testPublicStats() {
  _suite('computePublicStats', () => {
    const out = computePublicStats(_sampleStatsInput(new Date(2026, 9, 20)));
    const byCode = code => out.totals.find(r => r[0] === code);

    _section('الإجمالي');
    _eq(out.totals.map(r => r[0]), ['T001', 'T002', 'الأكاديمية'], 'rows ordered by code, then the academy');
    _eq(byCode('T001').slice(1), [2, 2, 2, 0, 2, 2, 3, 1.5, 2, 2, 0, 0, '', 0], 'teacher totals');
    _eq(byCode('T002').slice(5, 9), [1, 1.5, 2, 2], 'second teacher halaqat, hours, attendance, average');
    _eq(byCode('الأكاديمية')[1], 3, 'two-word name once across teachers, single name per teacher');
    _eq(byCode('الأكاديمية').slice(5, 9), [3, 3.5, 5, 1.7], 'academy halaqat');
    _eq(byCode('الأكاديمية')[13], 2, 'active teachers in the last 30 days');
    const later = computePublicStats(_sampleStatsInput(new Date(2026, 11, 1)));
    _eq(later.totals.find(r => r[0] === 'الأكاديمية')[2], 0, 'nobody active after 30 days');

    _section('شهرياً');
    const month = (m, code) => out.monthly.find(r => r[0] === m && r[2] === code);
    _ok(month('2026-09', 'T001')[1] instanceof Date, 'first month shows its start date');
    _eq(month('2026-10', 'T001')[1], '', 'later months have no start date');
    _eq(month('2026-09', 'T001').slice(3, 7), [1, 1, '', ''], 'first month: no continuity yet');
    _eq(month('2026-10', 'T001').slice(3, 7), [1, 2, 1, 1], 'new, attended, continuing, ratio');
    const ac = month('2026-10', 'الأكاديمية');
    _eq(ac.slice(3, 14), [2, 3, 1, 1, 2, 2.5, 4, 2, 1, 1, 2], 'academy month');
    _eq(ac.slice(14, 18), [920, 'EGP', 368, 306.67],
      'expense = pay 220 + fixed 200 + other 500; ÷ 2.5 sheet hours; sponsorship over 3 students');
    _eq(month('2026-09', 'الأكاديمية').slice(14, 18), ['', '', '', ''], 'no expense before October 2026 (S-50)');
    const base = _sampleStatsInput(new Date(2026, 9, 20));
    const listed = computePublicStats(Object.assign(base, { sheetReports: base.sheetReports.concat([
      { teacher: 'رجاء لطفي', date: new Date(2026, 8, 9), month: '2026-09', category: 'كبار', minutes: 480, attendance: 4 },
      { teacher: 'رجاء لطفي', date: new Date(2026, 9, 9), month: '2026-10', category: 'كبار', minutes: 60, attendance: 4 },
    ]) }));
    const academyOf = (stats, m) => stats.monthly.find(r => r[0] === m && r[2] === PUBLIC_STATS.ACADEMY);
    _eq([academyOf(listed, '2026-09')[7], academyOf(listed, '2026-10')[7]], [1, 3],
      'September counts only its listed teachers; October counts everyone (S-54)');
    _ok(!isCountedReport({ teacher: CONFIG.FALLBACKS.TEACHER_NAME, month: '2026-10', minutes: 60, duplicate: false }),
      'a report without a teacher\'s name is not counted (S-57)');
    const sample = _sampleStatsInput(new Date(2026, 9, 20));
    const lateStart = computePublicStats(Object.assign(sample, {
      sheetReports: sample.sheetReports.slice(1),
      teachers: [{ name: 'محمد نبيل', code: 'T001', students: [{ key: 'a', name: 'حمزة علاء',
        gender: STUDENT_GENDER.MALE, slots: { '2026-10-25|صباحية|1': ['أطفال', 0, 0] } }] }] }));
    _eq(lateStart.monthly.find(r => r[2] === PUBLIC_STATS.ACADEMY).slice(14, 18), [920, 'EGP', 368, ''],
      'the first month of the registry, begun after the 1st, has no sponsorship');
    _eq(month('2026-10', 'T001').slice(14, 18), ['', '', '', ''], 'no expense or pay on teacher rows');
    const partial = computePublicStats(_sampleStatsInput(new Date(2026, 9, 20), { rates: [['محمد نبيل', 100]] }));
    const academy = m => partial.monthly.find(r => r[0] === m && r[2] === PUBLIC_STATS.ACADEMY);
    _eq(academy('2026-10').slice(14, 18), ['', '', '', ''], 'a teacher with halaqat and no rate blanks the expense');
    const allPriced = computePublicStats(_sampleStatsInput(new Date(2026, 9, 20), { fixed: [] }));
    _eq(allPriced.monthly.find(r => r[0] === '2026-10' && r[2] === PUBLIC_STATS.ACADEMY)[14], 720,
      'no fixed expenses → pay and other expenses only');

    _section('التكريمات');
    _eq(readHonors(_sampleHonorRows()).map(h => [h.date, h.row]),
      [['2026-10-03', 2], ['2026-10-04', 3], ['2026-10-05', 4], ['2026-09-28', 6]],
      'honors read with their rows; a date cell becomes text, a bad row is left out');
    _eq(honorsAfterAlias(_sampleHonorRows(), 'محمد نبيل', 'حمزه علاء', 'حمزة علاءالدين'),
      [{ row: 2, key: studentNameKey('حمزة علاءالدين'), name: 'حمزة علاءالدين' },
        { row: 3, key: studentNameKey('حمزة علاءالدين'), name: 'حمزة علاءالدين' }],
      'a name correction moves that teacher\'s honors of the wrong name only (F-03)');
    const amounts = readHonorAmounts([['2026-11', 80], [new Date(2026, 9, 1), 50]]);
    _eq(['2026-09', '2026-10', '2026-12'].map(m => honorAmountFor(m, amounts)).concat([honorAmountFor('2026-10', [])]),
      [50, 50, 80, ''], 'an amount holds from its month; earlier months take the first; none before any');
    const honored = computePublicStats(_sampleStatsInput(new Date(2026, 9, 20),
      { honors: _sampleHonorRows(), honorAmounts: [['2026-10', 50]] }));
    const hm = (m, code) => honored.monthly.find(r => r[0] === m && r[2] === code);
    _eq([hm('2026-10', 'الأكاديمية')[14], hm('2026-10', 'الأكاديمية')[18], hm('2026-10', 'T001')[18],
      hm('2026-09', 'الأكاديمية')[18]], [1070, 3, 2, 1],
      'honors: 3 × 50 added to the expense, counted per month and per teacher (S-60)');
    _eq(['T001', 'الأكاديمية'].map(c => honored.totals.find(r => r[0] === c)[14]), [3, 4], 'honors in the totals');
    const unpricedHonors = computePublicStats(_sampleStatsInput(new Date(2026, 9, 20), { honors: _sampleHonorRows() }));
    _eq(unpricedHonors.monthly.find(r => r[0] === '2026-10' && r[2] === PUBLIC_STATS.ACADEMY)[14], '',
      'honors without an amount blank the expense');

    _section('المستحقات');
    _eq(out.pay, [
      { month: '2026-10', teacher: 'أسماء علي', hours: 1.5, rate: 80, pay: 120 },
      { month: '2026-10', teacher: 'محمد نبيل', hours: 1, rate: 100, pay: 100 },
    ], 'pay from the teacher sheets, from October 2026 only');
    _eq(partial.pay[0].rate + '|' + partial.pay[0].pay, '|', 'no rate → rate and pay blank');
    const odd = computeTeacherPay([{ month: '2026-10', teacher: 'س', minutes: 50 }], { 'س': 37.5 });
    _eq(odd[0].pay, 31, 'pay rounded to the pound (50 min × 37.5)');
    _eq(teacherSheetReports([
      ['الاثنين، ١٢ أكتوبر ٢٠٢٦', 'مسائية (حلقة 1)', 'كبار', '1:30', '٣', ''],
      ['02-10-2026', 'صباحية', 'كبار', '0:45', '2', '(تقرير مكرر) أُعيد'],
      ['03-10-2026', 'مسائية', 'أطفال', 0.03125, '1', 'ملاحظة'],
      ['بلا تاريخ', 'مسائية', 'كبار', '0:30', '', ''],
      ['الإجمالي', '', '', '3:00', '6', ''],
      ['المتوسط', '', '', '1:00', '2', ''],
    ], 'س', '2026-10').map(h => [h.date.getDate(), h.month, h.category, h.minutes, h.attendance, h.duplicate, isCountedReport(h)]),
    [[12, '2026-10', 'كبار', 90, 3, false, true], [2, '2026-10', 'كبار', 45, 2, true, false],
      [3, '2026-10', 'أطفال', 45, 1, false, true], [1, '2026-10', 'كبار', 30, 0, false, true]],
    'sheet reports: Arabic and numeric dates, h:mm and day fractions, no summaries; duplicates kept, not counted');
    const shown = teacherSheetReports([['الاثنين، ١٢ أكتوبر ٢٠٢٦', 'مسائية (حلقة 1)', 'كبار', '1:30', '٣', 'ملاحظة']], 'س', '2026-10')[0];
    _eq([shown.dateText, shown.session, shown.duration, shown.students, shown.notes],
      ['الاثنين، ١٢ أكتوبر ٢٠٢٦', 'مسائية (حلقة 1)', '1:30', '٣', 'ملاحظة'], 'cells kept as the sheet shows them');
    const kept = ['03-10-2026', 'صباحية', 'كبار', '1:00', '2', ''];
    const rowed = teacherSheetReports([['', '', '', '', '', ''], kept, ['الإجمالي', '', '', '1:00', '2', '']], 'س', '2026-10');
    _eq(rowed.map(h => [h.row, h.stamp]), [[3, reportRowStamp(kept)]],
      'a report keeps its sheet row and the stamp of its cells (S-59)');
    _ok(reportRowStamp(kept) !== reportRowStamp(kept.slice(0, 3).concat(['1:30', '2', ''])), 'the stamp changes with a cell');
    _eq(parseReportEdit({ hours: '١', minutes: '٣٠', students: '٤' }), { minutes: 90, students: 4 }, 'edit reads Arabic digits');
    _eq(parseReportEdit({ hours: '5', minutes: '', students: '0' }), { minutes: 300, students: 0 }, 'five hours and no students accepted');
    const editRefusals = [['5', '1', '1'], ['0', '0', '1'], ['1', '60', '1'], ['1.5', '0', '1'], ['1', '0', ''], ['1', '0', '-1']]
      .filter(([hours, minutes, students]) => {
        try { parseReportEdit({ hours, minutes, students }); return true; } catch (e) { return false; }
      });
    _eq(editRefusals, [], 'over five hours, zero, 60 minutes, fractions and a missing count refused');
    const tab = [
      ['29-08-2026', 'تجويد', 'كبار', '1:00', '8', ''],
      ['الثلاثاء، ٢٩ أغسطس ٢٠٢٦', 'تجويد', 'كبار', '1:30', '8', 'ملاحظة'],
      ['29-08-2026', 'تجويد', 'كبار', '1:00', '8', '(تقرير مكرر)'],
      ['29-08-2026', 'صباحية', 'كبار', '1:00', '8', ''],
      ['30-08-2026', 'تجويد', 'كبار', '1:00', '8', ''],
    ];
    _eq(supersededRows(tab, '29-08-2026', 'تجويد'), [0, 1],
      'a resubmission replaces its halaqa\'s unmarked rows, whatever the date spelling (S-58)');
    const earlier = [
      ['29-08-2026', 'تجويد', 'كبار', '1:00', '8', '(تقرير مكرر) أول'],
      ['الثلاثاء، ٢٩ أغسطس ٢٠٢٦', 'تجويد', 'كبار', '1:30', '8', '(تقرير مكرر)'],
      ['29-08-2026', 'صباحية', 'كبار', '1:00', '8', '(تقرير مكرر)'],
    ];
    const counted = ['29-08-2026', 'تجويد', 'كبار', '1:00', '8', ''];
    _eq([restoredRow(earlier, counted), restoredRow(earlier, earlier[0]),
      restoredRow(earlier.concat([counted]), counted)], [1, -1, -1],
      'deleting the counted report restores its halaqa\'s last earlier one; a marked or still-counted halaqa none (F-04)');
    _eq(['=1+1', '+20', '-غاب', '@x', 'حضر', 5].map(sheetText), ["'=1+1", "'+20", "'-غاب", "'@x", 'حضر', 5],
      'form text that Sheets would read as a formula stays text (F-08)');
    _eq(summaryRowIndexes([['1-9'], ['الإجمالي'], ['المتوسط'], ['يدوي'], [' الإجمالي '], ['المتوسط']]), [1, 2, 4, 5],
      'summary rows are found wherever they are (F-07)');
    const appended = [];
    const range = { setBackground() { return range; }, setFontWeight() { return range; },
      setNumberFormat() { return range; }, setHorizontalAlignment() { return range; } };
    appendSummaryRows({ getLastRow: () => 5, appendRow: r => appended.push(r), getRange: () => range });
    _eq(appended.map(r => [r[0], r[3], r[4]]), [
      ['الإجمالي', '=SUMIFS(D2:D5,F2:F5,"<>(تقرير مكرر)*")', '=SUMIFS(E2:E5,F2:F5,"<>(تقرير مكرر)*")'],
      ['المتوسط', '=IFERROR(AVERAGEIFS(D2:D5,F2:F5,"<>(تقرير مكرر)*"),"")', '=IFERROR(AVERAGEIFS(E2:E5,F2:F5,"<>(تقرير مكرر)*"),"")'],
    ], 'sheet total and average leave duplicate reports out (S-56)');
    _eq(readFixedExpenses([['الهدايا والتكريمات', 200], ['إدارة الأكاديمية', 300], ['x', 5]]),
      { 'إدارة الأكاديمية': 300 }, 'fixed expenses: known items only; the old gifts item no longer counts (S-60)');
    _eq(readRates([['محمد نبيل', 100], ['x', ''], ['y', -5], ['', 9], ['z', '٤٠']]), { 'محمد نبيل': 100 },
      'blank, non-positive and nameless rates read as no rate');

    _section('اللقطة الثابتة');
    _ok(!isMonthFrozen('2026-09', new Date(2026, 9, 5)), 'not frozen on the 5th');
    _ok(isMonthFrozen('2026-09', new Date(2026, 9, 6)), 'frozen from the 6th');
    const marker = ['2026-09', '', 'T001', 99];
    const frozen = computePublicStats(_sampleStatsInput(new Date(2026, 9, 20), { frozenMonthly: { '2026-09': [marker] } }));
    _eq(frozen.monthly.filter(r => r[0] === '2026-09'), [marker], 'frozen month keeps its written rows');
    const open = computePublicStats(_sampleStatsInput(new Date(2026, 9, 20), { frozenMonthly: { '2026-10': [marker] } }));
    _ok(open.monthly.filter(r => r[0] === '2026-10').length === 3, 'open month is recomputed');

    _section('بلا أسماء');
    const names = new Set(['حمزة علاء', 'محمد', 'محمد نبيل', 'أسماء علي']);
    let error = '';
    try { assertNoNames(out.totals.concat(out.monthly), names); } catch (e) { error = e.message; }
    _eq(error, '', 'computed rows hold no student or teacher name');
    try { assertNoNames([['T001', 'محمد']], names); } catch (e) { error = e.message; }
    _ok(error !== '', 'a name in a row is refused');

    _section('المصروفات');
    _eq(readExpenses([['2026-10', 500, 'EGP'], [new Date(2026, 10, 1), 300, 'EGP'], ['x', 1, 'EGP']]),
      { '2026-10': { amount: 500, currency: 'EGP' }, '2026-11': { amount: 300, currency: 'EGP' } },
      'expense months read, a date cell becomes yyyy-mm');
  });
}

// ─── سنة الميلاد والهاتف (S-32، S-33) ───────────────────────────────────────

function _testStudentDetails() {
  _suite('student details (birth year, phone)', () => {
    const today = new Date(2026, 9, 24);
    const throws = fn => { try { fn(); return false; } catch (e) { return true; } };
    _eq(normalizeBirthYear('٢٠١٥', today), 2015, 'eastern digits birth year');
    _eq(normalizeBirthYear(' ', today), '', 'empty clears');
    _ok(throws(() => normalizeBirthYear('15', today)), 'two digits refused');
    _ok(throws(() => normalizeBirthYear('2030', today)), 'future year refused');
    _ok(throws(() => normalizeBirthYear('1900', today)), 'before 1930 refused');
    _eq(normalizePhone('0020 100-123 4567'), '+201001234567', '00 prefix, spaces and dashes');
    _eq(normalizePhone('+49 (151) 234 5678'), '+491512345678', 'brackets dropped');
    _eq(normalizePhone('+٢٠١٠٠١٢٣٤٥٦٧'), '+201001234567', 'eastern digits phone');
    _eq(normalizePhone(''), '', 'empty clears');
    _ok(throws(() => normalizePhone('01001234567')), 'no country code refused');
    _ok(throws(() => normalizePhone('+2010')), 'too short refused');
    _eq(ageFromBirthYear(2015, today), 11, 'age from birth year');
    _eq(ageFromBirthYear('', today), '', 'no birth year → no age');

    _section('الأعمدة بالعنوان');
    const header = REGISTRY.STUDENT_HEADERS.concat(['ملاحظة', 'رقم الهاتف', 'سنة الميلاد']);
    _eq(studentDetailColumns(header), { birthYear: 2, phone: 1 }, 'found by header after other admin columns');
    _eq(studentDetailColumns(REGISTRY.STUDENT_HEADERS), { birthYear: -1, phone: -1 }, 'missing → -1');
    _eq(copyStudentDetails([2015, '+201001234567'], { birthYear: 0, phone: 1 }, ['متابعة'], { birthYear: 2, phone: 1 }),
      ['متابعة', '+201001234567', 2015], 'copied to new positions, other admin cell kept');
    _eq(copyStudentDetails(['', ''], { birthYear: 0, phone: 1 }, ['x'], { birthYear: 0, phone: 1 }), ['x'],
      'empty values copy nothing');

    _section('الدمج يملأ الفارغ ولا يكتب فوق القائم');
    const base = { slots: {}, firstHifz: '', firstHifzDate: null, lastHifz: '', lastHifzDate: null };
    const wrong = Object.assign({}, base, { key: 'a', extra: ['', '+201001234567', 2015] });
    const right = Object.assign({}, base, { key: 'b', extra: ['متابعة', '', 2014] });
    _eq(mergeStudentRecords(wrong, right).extra, ['متابعة', '+201001234567', 2014], 'phone filled, birth year kept');
  });
}

// ─── لوحة الإدارة (Dashboard.js) ─────────────────────────────────────────────

/** يتحقق أن لا Date في الكائن، لأن google.script.run يرفضها. */
function _hasDate(value) {
  if (value instanceof Date) return true;
  if (Array.isArray(value)) return value.some(_hasDate);
  if (value && typeof value === 'object') return Object.keys(value).some(k => _hasDate(value[k]));
  return false;
}

function _testDashboard() {
  _suite('buildDashboardData', () => {
    const input = _sampleStatsInput(new Date(2026, 9, 15));
    const d = buildDashboardData(Object.assign({ year: '2026', aliases: [['محمد نبيل', 'حمزه عالء', 'حمزة علاء', '']] }, input));
    _ok(!_hasDate(d), 'no Date object crosses google.script.run');
    _eq(d.totals.map(r => r[0]).slice(0, 2), ['محمد نبيل', 'أسماء علي'], 'codes become teacher names');
    _ok(d.monthly.some(r => r[2] === 'محمد نبيل'), 'monthly rows named too');
    _eq(d.teachers.map(t => t.name), ['أسماء علي', 'محمد نبيل'], 'teachers by name');
    const mn = d.teachers[1].students;
    _eq(mn[0].name, 'حمزة علاء', 'students newest first');
    _eq([mn[0].firstSeen, mn[0].lastSeen, mn[0].attendance], ['2026-09-28', '2026-10-03', 2], 'student dates as text');
    _ok(mn[1].isNew && !mn[0].isNew, 'first seen in the last 14 days → new');
    _eq(d.aliases, [{ teacher: 'محمد نبيل', from: 'حمزه عالء', to: 'حمزة علاء', applied: false }], 'aliases listed');
    _eq(d.expenses.map(e => e.month), ['2026-10', '2026-08'], 'expense rows listed');
    _eq(d.currency, 'EGP', 'one currency');
    _eq([d.pay, d.teachers.map(t => t.rate), d.rateLog], [null, ['', ''], []], 'no rates or pay without the pay password');
    const open = buildDashboardData(Object.assign({ year: '2026', aliases: [], showPay: true,
      rateLog: [[new Date(2026, 9, 25, 10, 0), 'منى', 'سعر الساعة', 'محمد نبيل: 100']] }, input));
    _eq([open.teachers.map(t => t.rate), open.unpriced], [[80, 100], []], 'rates per teacher once unlocked, none missing');
    _eq([open.pay.length, open.rateLog[0].details], [2, 'محمد نبيل: 100'], 'pay rows and rate log sent once unlocked');
    _eq([d.fixed, open.fixed], [null, [{ item: 'إدارة الأكاديمية', amount: 200 }]],
      'fixed expenses only once unlocked');
    const hd = buildDashboardData(Object.assign({ year: '2026', aliases: [], showPay: true }, input,
      { honors: _sampleHonorRows(), honorAmounts: [['2026-10', 50]] }));
    _eq(hd.teachers[1].students.map(s => [s.name, s.honors]), [['حمزة علاء', 2], ['محمد', 1]], 'honors per student');
    _eq(hd.honors.map(h => [h.date, h.editable]),
      [['2026-10-05', true], ['2026-10-04', true], ['2026-10-03', true], ['2026-09-28', false]],
      'honors newest first; one in a frozen month cannot be removed');
    _eq([hd.honorAmount, d.honorAmount], [50, ''], 'honor amount once unlocked only');
    const fixedLog = buildDashboardData(Object.assign({ year: '2026', aliases: [], showPay: true }, input,
      { rateLog: [[new Date(2026, 9, 25, 9), 'منى', 'مصروف ثابت', 'إدارة الأكاديمية: 900'], [new Date(2026, 9, 25, 8), 'منى', 'سعر الساعة', 'محمد نبيل: 100']] }));
    _eq(fixedLog.rateLog.map(e => e.action), ['سعر الساعة', 'مصروف ثابت'], 'rates log rows named by kind, newest first');
    const withSheet = buildDashboardData(Object.assign({ year: '2026', aliases: [], showPay: true }, input,
      { teachers: input.teachers.concat([{ name: 'رجاء لطفي', code: 'T004', students: [] }]) }));
    _eq(withSheet.teachers.map(t => t.name), ['أسماء علي', 'رجاء لطفي', 'محمد نبيل'],
      'rate list holds every academy teacher, one without students too');
    _eq(withSheet.teachers[1].rate, '', 'a teacher without a rate has none');
    const withReports = buildDashboardData(Object.assign({ year: '2026', aliases: [] }, input, { sheetReports: input.sheetReports.concat([
      Object.assign({}, input.sheetReports[1], { duplicate: true, notes: '(تقرير مكرر)' }),
      { teacher: 'رجاء لطفي', date: new Date(2026, 8, 9), month: '2026-09', category: 'كبار', minutes: 480, attendance: 4 },
    ]) }));
    _eq(withReports.reports.map(r => [r.teacher, r.day, r.status]), [
      ['محمد نبيل', '2026-09-28', ''], ['محمد نبيل', '2026-10-03', ''], ['أسماء علي', '2026-10-05', ''],
      ['محمد نبيل', '2026-10-03', 'مكرر'], ['رجاء لطفي', '2026-09-09', 'لا يُحسب'],
    ], 'every sheet row sent in order, a duplicate and an excluded month named (S-55)');
    _ok(!_hasDate(withReports.reports), 'report rows hold no Date');
    const noRate = buildDashboardData(Object.assign({ year: '2026', aliases: [], showPay: true }, input,
      { rates: [['محمد نبيل', 100]] }));
    _eq([noRate.teachers[0].rate, noRate.unpriced], ['', ['أسماء علي']], 'teacher without a rate named');
    const withDetails = buildDashboardData(Object.assign({ year: '2026', aliases: [] }, input, {
      teachers: [{ name: 'أسماء علي', code: 'T002', detailCols: { birthYear: 0, phone: 1 },
        students: [Object.assign({}, input.teachers[0].students[0], { extra: [2015, '+201001234567'] })] }],
    }));
    _eq(['birthYear', 'age', 'phone'].map(f => withDetails.teachers[0].students[0][f]), [2015, 11, '+201001234567'],
      'birth year, age and phone shown');
    _has(_friendlyError(new Error('Exception: You do not have permission to access the requested document.')).message,
      'ليس لك حق التعديل', 'permission error explained in Arabic');
    _eq(_friendlyError(new Error('اختر المعلم والاسمين.')).message, 'اختر المعلم والاسمين.', 'own messages kept');
    _eq([_withMode(true, () => _TEST_MODE), _TEST_MODE], [true, false], '?test=1 uses the test folder, then restores');
    _TEST_MODE = true;
    try { _ok(_withMode(undefined, () => _TEST_MODE), 'a page call never switches test mode off'); }
    finally { _TEST_MODE = false; }
  });
}

// ─── واجهة اللوحة (Api.js) ──────────────────────────────────────────────────

/** ذاكرة مؤقتة في الذاكرة بواجهة CacheService (get/put/remove). */
function _memoryCache() {
  const store = {};
  return { get: k => (k in store ? store[k] : null), put: (k, v) => { store[k] = v; }, remove: k => { delete store[k]; } };
}

function _testApi() {
  _suite('dashboard API (Api.js)', () => {
    const throws = fn => { try { fn(); return ''; } catch (e) { return e.auth ? 'auth' : 'error'; } };
    _section('قراءة الطلب');
    _eq(throws(() => parseApiRequest('{')), 'error', 'malformed JSON refused');
    _eq(throws(() => parseApiRequest('{"action":"_getSecret"}')), 'error', 'unknown action refused');
    _eq(throws(() => parseApiRequest('{"action":"constructor"}')), 'error', 'built-in object names refused');
    _eq(throws(() => parseApiRequest('{"action":"data","year":"26"}')), 'error', 'bad year refused');
    const req = parseApiRequest(JSON.stringify({ action: 'savePay', token: 't', test: true, year: '2026',
      args: { teacher: ' سمية ', rate: 50, extra: { a: 1 } } }));
    _eq(req, { action: 'savePay', token: 't', test: true, year: '2026', args: { teacher: 'سمية', rate: '50' } },
      'args trimmed, control characters and objects dropped');
    _eq(_argPairs({ n0: 'أ', v0: '5', n1: 'ب', n3: 'د' }), [{ name: 'أ', value: '5' }, { name: 'ب', value: '' }],
      'batch pairs read in order, up to the first gap');
    _eq([_argPairs({ rn0: 'أ', rv0: '5', fn0: 'ب' }, 'r'), _argPairs({ rn0: 'أ', fn0: 'ب' }, 'f')],
      [[{ name: 'أ', value: '5' }], [{ name: 'ب', value: '' }]], 'each kind of a pay save read by its prefix (U-02)');
    _eq(_studentArgs({ t0: 'سمية', k0: 'ك', g0: 'ذكر', t1: 'منى', k1: 'م', b1: '2015' }).map(s => [s.teacher, s.gender, s.birthYear]),
      [['سمية', 'ذكر', ''], ['منى', '', '2015']], 'the students of one save read in order (U-03)');
    _eq(parseApiRequest('{"action":"data","test":"true"}').test, false, 'test mode only for a real true');

    _section('كلمة المرور والجلسة');
    const cache = _memoryCache();
    _eq(throws(() => apiLogin('أحمد', 'x', '', cache)), 'auth', 'no configured password → no login');
    _eq(throws(() => apiLogin('أ', 'secret', 'secret', cache)), 'auth', 'name of one letter refused');
    _eq(throws(() => apiLogin('أحمد', 'wrong', 'secret', cache)), 'auth', 'wrong password refused');
    const session = apiLogin(' أحمد  علي ', 'secret', 'secret', cache);
    _eq(session.name, 'أحمد علي', 'login returns the cleaned name');
    _ok(session.token.length >= 64, 'long random token');
    _eq(apiSession(session.token, 'secret', cache).name, 'أحمد علي', 'session gives the name back');
    _eq(throws(() => apiSession(session.token, 'changed', cache)), 'auth', 'a new password ends old sessions');
    _eq(throws(() => apiSession('', 'secret', cache)), 'auth', 'no token refused');
    _eq(throws(() => handleApiRequest({ action: 'data', token: 'nope', year: '2026', args: {} },
      { password: 'secret', cache })), 'auth', 'data needs a session');
    _eq(apiSession(apiLogin('أحمد', 'secret', ' secret ', cache).token, 'secret ', cache).name, 'أحمد',
      'spaces around the stored password ignored');

    _section('قفل الدخول');
    const busy = _memoryCache();
    const lockHeld = { tryLock: () => false, releaseLock() {} };
    const login = { action: 'login', token: '', year: '2026', args: { name: 'أحمد', password: 'wrong' } };
    _eq(throws(() => handleApiRequest(login, { password: 'secret', cache: busy, loginLock: lockHeld })), 'auth',
      'login refused while the lock is held');
    _isNull(busy.get(API.FAILS_KEY), 'a refused try does not touch the counter');
    let released = 0;
    const freeLock = { tryLock: () => true, releaseLock: () => { released++; } };
    throws(() => handleApiRequest(login, { password: 'secret', cache: busy, loginLock: freeLock }));
    _eq([busy.get(API.FAILS_KEY), released], ['1', 1], 'a wrong try counts once and releases the lock');

    _section('منع التخمين');
    const guarded = _memoryCache();
    for (let i = 0; i < API.MAX_FAILS; i++) throws(() => apiLogin('أحمد', 'wrong', 'secret', guarded));
    _eq(throws(() => apiLogin('أحمد', 'secret', 'secret', guarded)), 'auth', 'locked after ten wrong tries, even with the right one');
    const nine = _memoryCache();
    for (let i = 0; i < API.MAX_FAILS - 1; i++) throws(() => apiLogin('أحمد', 'wrong', 'secret', nine));
    _eq(throws(() => apiLogin('أحمد', 'secret', 'secret', nine)), '', 'nine wrong tries do not lock');

    _section('كلمة مرور الرواتب (S-47)');
    const payCache = _memoryCache();
    const free = { tryLock: () => true, releaseLock() {} };
    const payDeps = { password: 'secret', payPassword: 'money', cache: payCache, loginLock: free };
    const tok = apiLogin('منى', 'secret', 'secret', payCache).token;
    const sess = () => apiSession(tok, 'secret', payCache);
    _ok(!apiPayOpen(sess(), 'money'), 'pay closed after login');
    _eq(throws(() => handleApiRequest({ action: 'savePay', token: tok, year: '2026', args: { rn0: 'x', rv0: '5' } },
      payDeps)), 'error', 'saving pay needs the pay password, and keeps the session');
    _eq(throws(() => apiUnlockPay(sess(), tok, 'secret', 'money', payCache)), 'error', 'login password does not open pay');
    _ok(!!apiSession(tok, 'secret', payCache), 'a wrong pay password keeps the admin logged in');
    apiUnlockPay(sess(), tok, 'money', 'money ', payCache);
    _ok(apiPayOpen(sess(), 'money'), 'pay open with its password');
    _ok(!apiPayOpen(sess(), 'changed'), 'a new pay password closes pay');
    _ok(sess().payUntil - Date.now() <= API.PAY_SECONDS * 1000, 'pay open for half an hour at most');
    apiLockPay(sess(), tok, payCache);
    _ok(!apiPayOpen(sess(), 'money'), 'lock closes pay');
    _eq(throws(() => apiUnlockPay(sess(), tok, 'x', '', payCache)), 'error', 'no pay password configured → no unlock');
    const payGuard = _memoryCache();
    const tok2 = apiLogin('منى', 'secret', 'secret', payGuard).token;
    for (let i = 0; i < API.MAX_FAILS; i++) throws(() => apiUnlockPay(apiSession(tok2, 'secret', payGuard), tok2, 'bad', 'money', payGuard));
    _eq(throws(() => apiUnlockPay(apiSession(tok2, 'secret', payGuard), tok2, 'money', 'money', payGuard)), 'error',
      'pay locked after ten wrong tries');
    _isNull(payGuard.get(API.LOCK_KEY), 'pay tries do not lock the login');

    _section('سجل التعديلات');
    _eq(rowsToEditLog([[new Date(2026, 9, 24, 9, 5), 'أحمد', 'مصروف', '2026-10: 500'], ['', '', '', ''],
      [new Date(2026, 9, 25, 14, 30), 'منى', 'سعر الساعة', 'سمية حمدي: 60']]),
      [{ time: '2026-10-25 14:30', name: 'منى', action: 'سعر الساعة', details: 'سمية حمدي: 60' },
        { time: '2026-10-24 09:05', name: 'أحمد', action: 'مصروف', details: '2026-10: 500' }], 'newest first, empty rows skipped');
    _eq(API_WRITES.applyAlias.details({ teacher: 'سمية حمدي', from: 'ريما', to: 'ريم' }, { outcome: 'merged' }),
      'ريما ← ريم عند سمية حمدي (دُمج)', 'alias log line');
    _ok(Object.keys(API_WRITES).every(k => typeof API_WRITES[k].run === 'function'), 'every write has a handler');
  });
}

// ============================================================================
// ③ تشغيل جميع اختبارات الوحدة
// ============================================================================

/** يشغّل جميع اختبارات الوحدة (لا يتصل بـ Drive/Sheets، ثوانٍ معدودة). */
function runAllUnitTests() {
  _T = { pass: 0, fail: 0, log: [] };

  _testNormalize();
  _testParseMetadata();
  _testGetFieldCI();
  _testFormatArabicHours();
  _testSanitize();
  _testEscapeHtml();
  _testFormatDate();
  _testParseReportDate();
  _testResolveTeacher();
  _testParseDuration();
  _testResolveSession();
  _testValidate();
  _testGenerateMarkdown();
  _testStudentKey();
  _testParseStudents();
  _testSlotRule();
  _testMergeStudents();
  _testRegistryRows();
  _testPublicStats();
  _testDashboard();
  _testApi();
  _testStudentDetails();

  _report('UNIT TESTS');
}

// ============================================================================
// ④ اختبارات التكامل (Integration Tests)
// ============================================================================
//
// تعمل على مجلد اختبار منفصل (TEST_ROOT_FOLDER_ID في Config.local.js أو Script Properties)
// ولا ترسل إلى Telegram، فلا تمسّ جداول المعلمين الحقيقية.
// تستدعي executeSubmissionPipeline مباشرةً لا onFormSubmit، فلا تُرسل تنبيه بريد عند
// الفشل، وأي فشل في Drive/Sheets يُسقط الاختبار.

/**
 * يشغّل مسار المعالجة في وضع الاختبار ويُرجع البيانات المُتحقَّق منها.
 * @param {Object} mockData
 * @returns {Object}
 */
function _runIntegrationSubmission(mockData) {
  _TEST_MODE = true;
  try {
    return executeSubmissionPipeline({ mockData }, Utilities.getUuid(), new Date());
  } finally {
    _TEST_MODE = false;
  }
}

/** يبني متن تقرير تجريبي بالحقول الوصفية المطلوبة. */
function _buildTestReport(date, session, count, halaNum, body) {
  const halaLine = halaNum ? `رقم الحلقة: ${halaNum}\n` : '';
  return `═══ [ تقرير أكاديمية سنا ] ═══\nالتاريخ: ${date}\nالفترة: ${session}\n${halaLine}عدد الطلاب: ${count}\n━━━━━━━━━━━━━━━\n${body}`;
}

/** اختبار تكاملي — تقرير يُحفظ في Drive وSheets، ثم التقرير نفسه مرة ثانية يُعلَّم مكرراً. */
function integrationTest_DuplicateDetection() {
  const mockData = {
    'اسم المعلم':           'محمد نبيل',
    'فئة الطلاب':           'كبار',
    'الساعات':              '1',
    'الدقائق':              '30',
    'التقرير':              _buildTestReport('29-08-2026', 'تجويد', 8, '', 'تقرير مكرر.'),
    'ملاحظات خاصة للإدارة': '',
  };
  const first = _runIntegrationSubmission(mockData);
  _ok(Boolean(first.fileUrl), 'file saved to Drive');
  const second = _runIntegrationSubmission(mockData);
  _ok(second.isDuplicate,         'second identical submission flagged duplicate');
  _ok(second.duplicateIndex >= 1, 'duplicate gets a (n) suffix');
  _ok(second.replacedEarlier,     'the resubmission replaced the earlier row (S-58)');
  _TEST_MODE = true;
  try {
    const teacherFolder = getRootFolder().getFoldersByName('2026').next().getFoldersByName('محمد نبيل').next();
    const sheet = SpreadsheetApp.openById(_firstNotTrashed(teacherFolder.getFilesByName('محمد نبيل - تقارير الحلقات 2026')).getId())
      .getSheetByName('08 - أغسطس');
    const slot = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getDisplayValues()
      .filter(r => _slotDateKey(r[0]) === '29-08-2026' && r[1] === 'تجويد');
    const counted = slot.map((r, i) => (String(r[5]).indexOf(DUPLICATE_MARK) === 0 ? -1 : i)).filter(i => i !== -1);
    _eq(counted, [slot.length - 1], 'only the last report of the halaqa is counted');
  } finally {
    _TEST_MODE = false;
  }
}

/** اختبار تكاملي — حلقتان من النوع نفسه في اليوم نفسه برقمين مختلفين: ليستا مكررتين. */
function integrationTest_DistinctHalaqatNotDuplicate() {
  const runTag = String(Date.now());
  const submit = (halaNum) => _runIntegrationSubmission({
    'اسم المعلم':           'محمد نبيل',
    'فئة الطلاب':           'أطفال',
    'الساعات':              '1',
    'الدقائق':              '0',
    'التقرير':              _buildTestReport('30-08-2026', 'صباحية', 4, halaNum, 'حلقة مستقلة.'),
    'ملاحظات خاصة للإدارة': '',
  });
  const first  = submit(`${runTag}1`);
  const second = submit(`${runTag}2`);
  _ok(!first.isDuplicate,  'first halaqa not a duplicate');
  _ok(!second.isDuplicate, 'second halaqa (different number) not a duplicate');
}

/** اختبار تكاملي — بيانات مفقودة: يستمر بالقيم الاحتياطية وحالة MISSING DATA. */
function integrationTest_MissingFields() {
  const result = _runIntegrationSubmission({
    'اسم المعلم':           '',
    'فئة الطلاب':           '',
    'الساعات':              '',
    'الدقائق':              '',
    'التقرير':              '',
    'ملاحظات خاصة للإدارة': '',
  });
  _ok(Boolean(result.fileUrl),                           'file still saved');
  _eq(result.validationStatus, 'MISSING DATA',           'status MISSING DATA');
  _eq(result.teacherName, CONFIG.FALLBACKS.TEACHER_NAME, 'fallback teacher name');
}

/**
 * اختبار تكاملي — سجل الطلاب: تقرير، وإعادة إرساله، وتقرير ثانٍ، وعمود إداري،
 * ثم بديل يُدمج في الحال، وتصحيح جنس. والأسماء بوسم التشغيل، فلا تختلط بتشغيل سابق.
 */
function integrationTest_StudentsRegistry() {
  const tag = String(Date.now()).slice(-6);
  const hamza = `حمزة ${tag}`;
  const hoda = `هدى ${tag}`;
  const typo = `هدا ${tag}`;
  const teacher = 'سمية حمدي';
  const submit = (date, hala, blocks) => _runIntegrationSubmission({
    'اسم المعلم': teacher, 'فئة الطلاب': 'أطفال', 'الساعات': '1', 'الدقائق': '0',
    'التقرير': _buildTestReport(date, 'صباحية', blocks.length, hala, _sampleStudentText(blocks)),
    'ملاحظات خاصة للإدارة': '',
  });
  const tab = () => {
    _TEST_MODE = true;
    try { return _findRegistry('2026').getSheetByName(teacher); }
    finally { _TEST_MODE = false; }
  };
  const find = (name) => readStudentsTab(tab()).students.find(s => s.key === studentNameKey(name));

  const first = submit('01-09-2026', `${tag}1`, [
    { name: hamza, hifz: 'نوح 1-10', grade: 'إعادة' }, { name: hoda, female: true },
  ]);
  _eq(first.newStudents, [hamza, hoda], 'first report: both new');
  const resent = submit('01-09-2026', `${tag}1`, [{ name: hamza, grade: 'إعادة' }, { name: hoda, female: true }]);
  _eq(deriveStudentStats(find(hamza).slots).attendance, 1, 'resubmission not counted');
  _eq(deriveStudentStats(find(hamza).slots).repeats, 1, 'resubmission adds no repeat');

  _section('عمود إداري يبقى مع صفه');
  const sheet = tab();
  const adminCol = STUDENT_SYSTEM_COLUMNS + 1;
  sheet.getRange(1, adminCol).setValue('ملاحظة الإدارة');
  const body = _readBody(sheet);
  const hamzaRow = body.findIndex(r => (rowToStudent(r) || {}).key === studentNameKey(hamza));
  sheet.getRange(hamzaRow + 2, adminCol).setValue('متابعة');
  const manual = `صف يدوي ${tag}`;
  sheet.appendRow([manual]);

  const second = submit('02-09-2026', `${tag}1`, [{ name: `حمزه ${tag}` }, { name: typo, female: true }]);
  _eq(second.newStudents, [typo], 'only the misspelt name is new');
  _eq(find(hamza).extra[0], 'متابعة', 'admin cell moved with its row');
  _ok(_readBody(tab()).some(r => r[0] === manual), 'hand-typed row without column M kept');
  _eq(deriveStudentStats(find(hamza).slots).attendance, 2, 'ة/ه spelling counted on the same row');
  _section('بديل يُدمج في الحال');
  _TEST_MODE = true;
  try {
    _eq(applyAlias({ teacher, from: typo, to: hoda }, '2026').outcome, 'merged', 'alias merged');
    _eq(applyAlias({ teacher, from: typo, to: hoda }, '2026').outcome, 'absent', 'second time changes nothing');
    const aliasRows = rowsToAliases(_readBody(_findRegistry('2026').getSheetByName(REGISTRY.ALIASES_TAB)))
      .filter(a => a.teacher === teacher && a.from === typo);
    _eq(aliasRows.length, 1, 'the same alias twice keeps one row');
    _eq(applyPendingAliases('2026').failed, 0, 'no pending alias fails');
    let sameNameError = '';
    try { applyAlias({ teacher, from: hoda, to: `هدي ${tag}` }, '2026'); }
    catch (e) { sameNameError = e.message; }
    _ok(sameNameError !== '', 'alias between two spellings of one key is refused');
    saveStudentsDetails([{ teacher, key: studentNameKey(hamza), gender: STUDENT_GENDER.FEMALE }], '2026');
  } finally {
    _TEST_MODE = false;
  }
  _isNull(find(typo) || null, 'misspelt row removed');
  _eq(deriveStudentStats(find(hoda).slots).attendance, 2, 'merged row has both halaqat');
  _eq(find(hamza).gender, STUDENT_GENDER.FEMALE, 'gender corrected by key');

  const third = submit('03-09-2026', `${tag}1`, [{ name: typo, female: true }]);
  _eq(third.newStudents.length, 0, 'alias applies to the next report');
}

/**
 * اختبار تكاملي — الملف العام: يُبنى من السجل، ولا اسم فيه، ولا يمسّ «قبل النظام»،
 * ويُكتب المصروف ثم يظهر في «شهرياً».
 */
function integrationTest_PublicStats() {
  const tag = String(Date.now()).slice(-6);
  const student = `سامي ${tag}`;
  _runIntegrationSubmission({
    'اسم المعلم': 'سمية حمدي', 'فئة الطلاب': 'أطفال', 'الساعات': '1', 'الدقائق': '30',
    'التقرير': _buildTestReport('10-10-2026', 'مسائية', 1, `${tag}9`, _sampleStudentText([{ name: student }])),
    'ملاحظات خاصة للإدارة': '',
  });

  _TEST_MODE = true;
  try {
    saveExpense('2026-10', '٤٠٠');
    saveExpense('2026-10', 450);
    let refused = '';
    try { saveExpense('2026-9', 10); } catch (e) { refused = e.message; }
    _ok(refused !== '', 'malformed month refused');
    // 60 pounds an hour makes each teacher's pay their minutes, to check the sum.
    // Pay follows the teacher sheets (S-50), whose teachers may have no registry tab.
    const sheetReports = readTeacherSheetReports('2026').filter(h => h.month === '2026-10');
    const teachers = Array.from(new Set(registryTeacherSheets(_findRegistry('2026')).map(sh => sh.getName())
      .concat(sheetReports.map(h => h.teacher))));
    const oldTab = () => _findRegistry('2026').getSheetByName(REGISTRY.RATES_TAB);
    const registryRatesBefore = oldTab() ? JSON.stringify(_readBody(oldTab())) : '';
    const today = new Date();
    savePay({ rates: [{ teacher: teachers[0], rate: '٧٠' }] }, '2026', today);
    savePay({ rates: teachers.map(teacher => ({ teacher, rate: 60 })) }, '2026', today);
    const rates = readRateRows();
    _eq(oldTab() ? JSON.stringify(_readBody(oldTab())) : '', registryRatesBefore,
      'rates not written to the shared registry');
    _eq(rates.filter(r => r[0] === teachers[0]).map(r => r[1]), [60], 'rate updated in place, eastern digits read');
    refused = '';
    try { savePay({ rates: [{ teacher: teachers[0], rate: '0' }] }, '2026', today); } catch (e) { refused = e.message; }
    _ok(refused !== '', 'zero rate refused');
    refused = '';
    try { savePay({ rates: [{ teacher: teachers[0], rate: 55 }, { teacher: teachers[0], rate: '' }] }, '2026', today); } catch (e) { refused = e.message; }
    _ok(refused !== '' && readRates(readRateRows())[teachers[0]] === 60,
      'one bad rate in a batch saves none');
    savePay({ fixed: [{ item: 'إدارة الأكاديمية', amount: '١٠٠' }] }, '2026', today);
    refused = '';
    try { savePay({ fixed: [{ item: 'إيجار', amount: 10 }] }, '2026', today); } catch (e) { refused = e.message; }
    _ok(refused !== '', 'unknown fixed item refused');
    refused = '';
    try {
      savePay({ rates: [{ teacher: teachers[0], rate: 80 }], fixed: [{ item: 'إدارة الأكاديمية', amount: 300 }],
        honorAmount: '-5' }, '2026', today);
    } catch (e) { refused = e.message; }
    _ok(refused !== '' && readRates(readRateRows())[teachers[0]] === 60
      && readFixedExpenses(readFixedRows())['إدارة الأكاديمية'] === 100,
      'a bad honor amount saves neither the rate nor the fixed expense (U-02)');
    const fixed = readFixedExpenses(readFixedRows());
    _eq(fixed['إدارة الأكاديمية'], 100, 'fixed expense saved in the rates file, eastern digits read');

    // A day when October is still open, so its rows are recomputed, not kept frozen.
    const openDay = new Date(2026, 10, 1);
    _ok(refreshPublicStats('2026', openDay), 'public file refreshed');
    const ss = SpreadsheetApp.openById(_firstNotTrashed(
      getRootFolder().getFoldersByName('2026').next().getFilesByName(`${PUBLIC_STATS.FILE_PREFIX} 2026`)).getId());

    const cells = _readBody(ss.getSheetByName(PUBLIC_STATS.TOTALS_TAB))
      .concat(_readBody(ss.getSheetByName(PUBLIC_STATS.MONTHLY_TAB)));
    _ok(!cells.some(r => r.some(v => String(v).indexOf(tag) !== -1)), 'no student name in the public file');
    _ok(!cells.some(r => r.some(v => v === 'سمية حمدي')), 'no teacher name in the public file');
    const oct = _readBody(ss.getSheetByName(PUBLIC_STATS.MONTHLY_TAB))
      .find(r => String(r[0]) === '2026-10' && r[2] === PUBLIC_STATS.ACADEMY);
    const fixedTotal = Object.keys(fixed).reduce((a, k) => a + fixed[k], 0);
    const pay = computeTeacherPay(sheetReports, readRates(readRateRows())).reduce((a, p) => a + p.pay, 0);
    _ok(sheetReports.length > 0, 'teacher sheet halaqat read for October');
    const octHours = _round(sheetReports.reduce((a, h) => a + h.minutes, 0) / 60);
    _eq([oct[14], oct[15]], [450 + fixedTotal + pay, 'EGP'], 'expense = sheet pay + fixed + other, updated in place');
    _eq(oct[8], octHours, 'October hours in the public file are the sheets\' hours (S-52)');
    const expenses = readExpenseMonths(_readBody(_findRegistry('2026').getSheetByName(REGISTRY.EXPENSES_TAB)));
    _eq(expenses.filter(m => m === '2026-10').length, 1, 'one expense row per month');
  } finally {
    _TEST_MODE = false;
  }
}

/**
 * اختبار تكاملي — دوال اللوحة كما تستدعيها الصفحة: القراءة، ثم بديل يُدمج،
 * ثم حذفه، ثم مصروف، ثم جنس. وكل نتيجة بلا Date.
 */
function integrationTest_Dashboard() {
  const tag = String(Date.now()).slice(-6);
  const teacher = 'سمية حمدي';
  const right = `ريم ${tag}`;
  const typo = `ريما ${tag}`;
  _runIntegrationSubmission({
    'اسم المعلم': teacher, 'فئة الطلاب': 'أطفال', 'الساعات': '1', 'الدقائق': '0',
    'التقرير': _buildTestReport('05-09-2026', 'صباحية', 2, `${tag}5`,
      _sampleStudentText([{ name: right, female: true }, { name: typo, female: true }])),
    'ملاحظات خاصة للإدارة': '',
  });

  _TEST_MODE = true;
  try {
    const data = getDashboardData('2026');
    _ok(!_hasDate(data), 'dashboard data has no Date');
    const students = () => getDashboardData('2026').teachers.find(t => t.name === teacher).students;
    _ok(students().some(s => s.name === typo), 'misspelt student listed');

    const merged = dashboardApplyAlias({ teacher, from: typo, to: right }, '2026');
    _eq(merged.outcome, 'merged', 'alias merged from the dashboard');
    _ok(!merged.data.teachers.find(t => t.name === teacher).students.some(s => s.name === typo), 'fresh data returned');
    _ok(merged.data.aliases.some(a => a.from === typo && a.applied), 'alias listed as applied');

    const afterDelete = dashboardDeleteAlias(teacher, typo, '2026');
    _ok(!afterDelete.aliases.some(a => a.from === typo), 'alias deleted');
    _ok(afterDelete.teachers.find(t => t.name === teacher).students.some(s => s.name === right), 'merged row stays merged');

    const withExpense = dashboardSaveExpense('2026-08', '120', '2026');
    _ok(withExpense.expenses.some(e => e.month === '2026-08' && e.amount === 120), 'expense saved from the dashboard');
    const withRate = _withPay(true, () => dashboardSavePay({ rates: [{ teacher, rate: '٥٠' }] }, '2026').data);
    _eq(withRate.teachers.find(t => t.name === teacher).rate, 50, 'rate saved from the dashboard');
    _ok(withRate.pay.filter(p => p.teacher === teacher).every(p => p.rate === 50), 'pay uses the new rate');

    const key = studentNameKey(right);
    const g = dashboardSaveStudents([{ teacher, key, gender: STUDENT_GENDER.MALE }], '2026').data;
    _eq(g.teachers.find(t => t.name === teacher).students.find(s => s.key === key).gender, STUDENT_GENDER.MALE, 'gender saved from the dashboard');

    let err = '';
    try { dashboardSaveStudents([{ teacher, key: 'لا_يوجد', gender: STUDENT_GENDER.MALE }], '2026'); } catch (e) { err = e.message; }
    _has(err, 'لم يوجد الطالب', 'unknown student explained');
  } finally {
    _TEST_MODE = false;
  }
}

/**
 * اختبار تكاملي — سنة الميلاد والهاتف: تُكتب من اللوحة في سجل 2025، ثم تنتقل
 * إلى سجل 2026 حين يظهر الطالب فيه أول مرة، ولا يظهر الهاتف في الملف العام.
 */
function integrationTest_StudentDetails() {
  const tag = String(Date.now()).slice(-6);
  const teacher = 'سمية حمدي';
  const student = `يوسف ${tag}`;
  const phone = `+2010${tag}99`;
  const submit = date => _runIntegrationSubmission({
    'اسم المعلم': teacher, 'فئة الطلاب': 'أطفال', 'الساعات': '1', 'الدقائق': '0',
    'التقرير': _buildTestReport(date, 'صباحية', 1, `${tag}7`, _sampleStudentText([{ name: student }])),
    'ملاحظات خاصة للإدارة': '',
  });
  const find = (data) => data.teachers.find(t => t.name === teacher).students
    .find(s => s.key === studentNameKey(student));

  submit('20-12-2025');
  _TEST_MODE = true;
  try {
    const one = { teacher, key: studentNameKey(student), gender: STUDENT_GENDER.MALE };
    const saved = dashboardSaveStudents([Object.assign({ birthYear: '٢٠١٦', phone: `00${phone.slice(1)}` }, one)], '2025').data;
    _eq([find(saved).birthYear, find(saved).phone], [2016, phone], 'details saved and normalized');
    let err = '';
    try { dashboardSaveStudents([Object.assign({ birthYear: '2016', phone: '0100' }, one)], '2025'); }
    catch (e) { err = e.message; }
    _has(err, 'مفتاح الدولة', 'bad phone explained');
    _has(err, student, 'the refusal names the student (U-03)');
    _eq(find(_getDashboardData('2025')).phone, phone, 'a refused save writes nothing');
    // A phone typed by hand in the sheet does not block a gender change.
    const tab = _findRegistry('2025').getSheetByName(_teacherTabName(teacher));
    const row = _readBody(tab).findIndex(r => (rowToStudent(r) || {}).key === studentNameKey(student)) + 2;
    const phoneCol = STUDENT_SYSTEM_COLUMNS + 1 + studentDetailColumns(_headerRow(tab)).phone;
    tab.getRange(row, phoneCol).setValue('0100');
    const regendered = dashboardSaveStudents([Object.assign({}, one, { gender: STUDENT_GENDER.FEMALE, birthYear: '2016', phone: '0100' })], '2025').data;
    _eq([find(regendered).gender, tab.getRange(row, phoneCol).getValues()[0][0]], [STUDENT_GENDER.FEMALE, '0100'],
      'only the changed field is checked and written (U-03)');
    tab.getRange(row, phoneCol).setValue(phone);
  } finally {
    _TEST_MODE = false;
  }

  submit('05-01-2026');
  _TEST_MODE = true;
  try {
    const next = getDashboardData('2026');
    _eq([find(next).birthYear, find(next).phone], [2016, phone], 'details carried into the new year');
    refreshPublicStats('2026');
    const ss = SpreadsheetApp.openById(_firstNotTrashed(
      getRootFolder().getFoldersByName('2026').next().getFilesByName(`${PUBLIC_STATS.FILE_PREFIX} 2026`)).getId());
    const cells = _readBody(ss.getSheetByName(PUBLIC_STATS.TOTALS_TAB))
      .concat(_readBody(ss.getSheetByName(PUBLIC_STATS.MONTHLY_TAB)));
    _ok(!cells.some(r => r.some(v => String(v).indexOf(tag) !== -1)), 'no phone in the public file');
  } finally {
    _TEST_MODE = false;
  }
}

/**
 * اختبار تكاملي — واجهة اللوحة كما تستدعيها الصفحة: الدخول، ثم البيانات، ثم
 * كتابة تُسجَّل باسم من دخل، ثم doPost بطلب فاسد يُرجع JSON بخطأ.
 */
function integrationTest_Api() {
  const tag = String(Date.now()).slice(-6);
  const teacher = 'سمية حمدي';
  _runIntegrationSubmission({
    'اسم المعلم': teacher, 'فئة الطلاب': 'أطفال', 'الساعات': '1', 'الدقائق': '0',
    'التقرير': _buildTestReport('06-09-2026', 'صباحية', 3, `${tag}6`, _sampleStudentText([{ name: `منير ${tag}` }])),
    'ملاحظات خاصة للإدارة': '',
  });
  const deps = { password: `pass-${tag}`, payPassword: `pay-${tag}`, cache: _memoryCache(),
    loginLock: LockService.getDocumentLock() || LockService.getUserLock() };
  const call = (action, args, token) => handleApiRequest(
    { action, token: token || '', test: true, year: '2026', args: args || {} }, deps);

  const login = call('login', { name: `مختبر ${tag}`, password: deps.password });
  _ok(login.ok && login.token, 'login gives a token');
  const data = call('data', {}, login.token);
  _ok(data.ok && !_hasDate(data.data) && Array.isArray(data.data.log), 'data has the edit log and no Date');

  _eq([data.data.pay, data.data.payOpen], [null, false], 'no pay before the pay password');
  let refused = '';
  try { call('savePay', { rn0: teacher, rv0: '65' }, login.token); } catch (e) { refused = e.message; }
  _has(refused, 'افتح الرواتب', 'rate refused before the pay password');

  const opened = call('unlockPay', { password: deps.payPassword }, login.token);
  _ok(opened.data.payOpen && Array.isArray(opened.data.pay), 'pay password opens rates and pay');
  const saved = call('savePay', { rn0: teacher, rv0: '65', fn0: 'إدارة الأكاديمية', fv0: '200' }, login.token);
  _eq(saved.data.teachers.find(t => t.name === teacher).rate, 65, 'rate saved through the API');
  _eq([saved.data.rateLog[0].name, saved.data.rateLog[0].action, saved.data.rateLog[0].details],
    [`مختبر ${tag}`, PAY_LOG_ACTION, `سعر الساعة: ${teacher}: 65؛ مصروف ثابت: إدارة الأكاديمية: 200`],
    'one log row for the pay save, with the name typed at login');
  const after = call('data', {}, login.token).data;
  _eq(after.rateLog[0].name, `مختبر ${tag}`, 'rate log row written to the rates file');
  _ok(!after.log.some(e => e.action === PAY_LOG_ACTION), 'no pay row in the shared edit log');

  call('saveStudents', { t0: teacher, k0: studentNameKey(`منير ${tag}`), g0: STUDENT_GENDER.MALE }, login.token);
  const logged = call('data', {}, login.token).data.log[0];
  _eq([logged.name, logged.action], [`مختبر ${tag}`, 'بيانات الطلاب'], 'other writes logged in the registry');
  _has(logged.details, `منير ${tag}`, 'the log row names who changed');
  _eq(call('lockPay', {}, login.token).data.pay, null, 'lock hides pay again');
  const refreshed = call('refreshReports', {}, login.token).data;
  _ok(Array.isArray(refreshed.reports) && refreshed.reports.length > 0, 'refresh reads the teachers\' sheets again');

  const reply = JSON.parse(doPost({ postData: { contents: '{' } }).getContent());
  _eq([reply.ok, reply.error], [false, 'طلب غير مفهوم.'], 'doPost answers a bad body with JSON');
}

/** اختبار تكاملي — تعديل تقرير وحذفه من اللوحة (S-59). */
function integrationTest_ReportEdits() {
  const tag = String(Date.now()).slice(-6);
  const teacher = 'سمية حمدي';
  const now = new Date();
  const year = String(now.getFullYear());
  const pad = n => String(n).padStart(2, '0');
  _runIntegrationSubmission({
    'اسم المعلم': teacher, 'فئة الطلاب': 'أطفال', 'الساعات': '1', 'الدقائق': '0',
    'التقرير': _buildTestReport(`${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${year}`, 'صباحية', 2, `${tag}7`,
      _sampleStudentText([{ name: `ياسر ${tag}` }])),
    'ملاحظات خاصة للإدارة': '',
  });
  const deps = { password: `pass-${tag}`, payPassword: `pay-${tag}`, cache: _memoryCache(),
    loginLock: LockService.getDocumentLock() || LockService.getUserLock() };
  const call = (action, args, token) => handleApiRequest(
    { action, token: token || '', test: true, year, args: args || {} }, deps);
  const refusal = (action, args) => {
    try { call(action, args, token); return ''; } catch (e) { return e.message; }
  };
  const token = call('login', { name: `مختبر ${tag}`, password: deps.password }).token;
  const mine = d => d.reports.find(r => r.teacher === teacher && r.session === `صباحية (حلقة ${tag}7)`);

  const data = call('data', {}, token).data;
  const shown = mine(data);
  _ok(shown && shown.editable && shown.row >= 2 && shown.stamp, 'a report of this month carries its row and stamp');
  _ok(data.reports.filter(r => isMonthFrozen(r.month, now)).every(r => !r.editable), 'frozen months shown without edits');
  const ref = { teacher, month: shown.month, row: shown.row, stamp: shown.stamp };
  const change = { hours: '1', minutes: '30', students: '3' };
  _has(refusal('editReport', Object.assign({}, ref, change, { stamp: 'x' })), 'حدّث التقارير', 'a changed row is refused');
  _has(refusal('editReport', Object.assign({}, ref, change, { hours: '6' })), '5 ساعات', 'over five hours refused');
  const old = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  if (old.getFullYear() === now.getFullYear()) {
    _has(refusal('editReport', Object.assign({}, ref, change, { month: `${year}-${pad(old.getMonth() + 1)}` })), 'ثابت',
      'a frozen month is refused');
  }

  const edited = call('editReport', Object.assign({}, ref, change), token).data;
  const after = mine(edited);
  _eq([after.minutes, after.attendance], [90, 3], 'duration and count written to the sheet');
  _eq([edited.log[0].action, edited.log[0].name], ['تعديل تقرير', `مختبر ${tag}`], 'edit logged with the admin');
  _has(edited.log[0].details, '← 1:30', 'log shows the new duration');
  _has(refusal('editReport', Object.assign({}, ref, change)), 'حدّث التقارير', 'the old stamp no longer matches');

  const deleted = call('deleteReport', { teacher, month: after.month, row: after.row, stamp: after.stamp }, token).data;
  _ok(!mine(deleted), 'deleted report gone from the sheet');
  _eq(deleted.log[0].action, 'حذف تقرير', 'delete logged');
  const tab = _withMode(true, () => {
    const file = _teacherSheetFiles(year).find(f => f.teacher === teacher);
    return SpreadsheetApp.openById(file.id).getSheets().find(s => _tabMonth(s.getName(), year) === after.month);
  });
  const last = tab.getLastRow();
  _eq(last < 2 ? [] : tab.getRange(last - 1, 1, 2, 1).getValues().map(r => r[0]),
    last < 2 ? [] : ['الإجمالي', 'المتوسط'], 'total and average rebuilt after a delete');

  // A halaqa sent twice: deleting the counted report brings the earlier one back (F-04).
  const twice = {
    'اسم المعلم': teacher, 'فئة الطلاب': 'أطفال', 'الساعات': '1', 'الدقائق': '0',
    'التقرير': _buildTestReport(`${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${year}`, 'صباحية', 2, `${tag}9`,
      _sampleStudentText([{ name: `ياسر ${tag}` }])),
    'ملاحظات خاصة للإدارة': '',
  };
  _runIntegrationSubmission(twice);
  _runIntegrationSubmission(twice);
  const halaqa = d => d.reports.filter(r => r.teacher === teacher && r.session === `صباحية (حلقة ${tag}9)`);
  const pair = halaqa(call('data', {}, token).data);
  _eq(pair.map(r => r.status), ['مكرر', ''], 'the resubmission counts and the first is marked (S-58)');
  const kept = halaqa(call('deleteReport', { teacher, month: pair[1].month, row: pair[1].row, stamp: pair[1].stamp }, token).data);
  _eq(kept.map(r => [r.status, r.notes.indexOf(DUPLICATE_MARK)]), [['', -1]],
    'after deleting the counted one, the earlier report counts again');
}

/** اختبار تكاملي — تكريم طالب وحذفه ومبلغ التكريم عبر الـ API (S-60). */
function integrationTest_Honors() {
  const tag = String(Date.now()).slice(-6);
  const teacher = 'سمية حمدي';
  const now = new Date();
  const year = String(now.getFullYear());
  const pad = n => String(n).padStart(2, '0');
  const today = `${year}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  _runIntegrationSubmission({
    'اسم المعلم': teacher, 'فئة الطلاب': 'أطفال', 'الساعات': '1', 'الدقائق': '0',
    'التقرير': _buildTestReport(`${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${year}`, 'مسائية', 1, `${tag}8`,
      _sampleStudentText([{ name: `نور ${tag}`, female: true }])),
    'ملاحظات خاصة للإدارة': '',
  });
  const deps = { password: `pass-${tag}`, payPassword: `pay-${tag}`, cache: _memoryCache(),
    loginLock: LockService.getDocumentLock() || LockService.getUserLock() };
  const call = (action, args, token) => handleApiRequest(
    { action, token: token || '', test: true, year, args: args || {} }, deps);
  const refusal = (action, args) => {
    try { call(action, args, token); return ''; } catch (e) { return e.message; }
  };
  const token = call('login', { name: `مختبر ${tag}`, password: deps.password }).token;
  const student = d => d.teachers.find(t => t.name === teacher).students.find(s => s.name === `نور ${tag}`);
  const key = student(call('data', {}, token).data).key;

  _has(refusal('addHonor', { teacher, key: 'لا-أحد', date: today }), 'لم يوجد', 'an unknown student refused');
  _has(refusal('addHonor', { teacher, key, date: `${year}-12-32` }), 'اختر تاريخ', 'a bad date refused');
  const old = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  if (old.getFullYear() === now.getFullYear()) {
    _has(refusal('addHonor', { teacher, key, date: `${year}-${pad(old.getMonth() + 1)}-01` }), 'ثابت',
      'a frozen month refused');
  }
  const added = call('addHonor', { teacher, key, date: today, reason: 'ختم جزء' }, token).data;
  const mine = added.honors.find(h => h.key === key);
  _eq([student(added).honors, mine.reason, mine.editable], [1, 'ختم جزء', true], 'honor added and counted for the student');
  _eq([added.log[0].action, added.log[0].name], ['تكريم', `مختبر ${tag}`], 'honor logged with the admin');

  _has(refusal('savePay', { honorAmount: '75' }), 'افتح الرواتب', 'the amount needs the pay password');
  call('unlockPay', { password: deps.payPassword }, token);
  const priced = call('savePay', { honorAmount: '٧٥' }, token).data;
  _eq([priced.honorAmount, priced.rateLog[0].action], [75, PAY_LOG_ACTION], 'amount saved in the rates file and logged there');

  // A name correction carries the honor to the right name (F-03).
  const renamed = call('applyAlias', { teacher, from: `نور ${tag}`, to: `نورة ${tag}` }, token).data;
  const moved = renamed.teachers.find(t => t.name === teacher).students.find(s => s.name === `نورة ${tag}`);
  const movedHonor = renamed.honors.find(h => h.row === mine.row);
  _eq([moved.honors, movedHonor.name, movedHonor.key], [1, `نورة ${tag}`, moved.key],
    'the honor follows the student\'s corrected name');

  const ref = { row: movedHonor.row, date: movedHonor.date, teacher: movedHonor.teacher, key: movedHonor.key };
  _has(refusal('deleteHonor', Object.assign({}, ref, { key: 'x' })), 'حدّث الصفحة', 'a changed row refused');
  const removed = call('deleteHonor', ref, token).data;
  _eq([removed.teachers.find(t => t.name === teacher).students.find(s => s.key === moved.key).honors,
    removed.log[0].action], [0, 'حذف تكريم'], 'honor removed and logged');
}

/**
 * اختبار تكاملي — صفوف تبويب المعلم: ملاحظة تبدأ بـ «=» تبقى نصاً (F-08)، وصفّا
 * الإجمالي والمتوسط يُنقلان إلى الآخر وإن كُتب صف يدوي تحتهما (F-07).
 */
function integrationTest_SheetFixes() {
  const tag = String(Date.now()).slice(-6);
  const teacher = 'سمية حمدي';
  const now = new Date();
  const year = String(now.getFullYear());
  const pad = n => String(n).padStart(2, '0');
  const month = `${year}-${pad(now.getMonth() + 1)}`;
  const send = (n, note) => _runIntegrationSubmission({
    'اسم المعلم': teacher, 'فئة الطلاب': 'أطفال', 'الساعات': '1', 'الدقائق': '0',
    'التقرير': _buildTestReport(`${pad(now.getDate())}-${month.slice(5)}-${year}`, 'صباحية', 2, `${tag}${n}`,
      _sampleStudentText([{ name: `سالم ${tag}` }])),
    'ملاحظات خاصة للإدارة': note,
  });
  const tabOf = () => _withMode(true, () => {
    const file = _teacherSheetFiles(year).find(f => f.teacher === teacher);
    return SpreadsheetApp.openById(file.id).getSheets().find(s => _tabMonth(s.getName(), year) === month);
  });
  const rowsOf = tab => tab.getRange(2, 1, tab.getLastRow() - 1, 6).getValues();

  send(1, '=1+1');
  let tab = tabOf();
  const noted = rowsOf(tab).find(r => String(r[1]).includes(`حلقة ${tag}1`));
  // Read as a formula, the cell would hold 2, not the text typed.
  _eq(noted && noted[5], '=1+1', 'a note starting with = is kept as text (F-08)');

  const hand = `يدوي ${tag}`;
  tab.appendRow([hand, '', '', '', '', '']);
  send(2, '');
  tab = tabOf();
  const after = rowsOf(tab);
  const labels = after.map(r => String(r[0]).trim());
  _eq(labels.slice(-2), ['الإجمالي', 'المتوسط'], 'summary rows moved to the end below a hand-typed row (F-07)');
  _eq(summaryRowIndexes(after.map(r => [r[0]])).length, 2, 'no summary row left in the middle (F-07)');

  const handRow = labels.indexOf(hand);
  if (handRow !== -1) {
    tab.deleteRow(handRow + 2);
    removeSummaryRows(tab);
    appendSummaryRows(tab);
  }
}

/**
 * فحص حيّ قصير لإصلاحات التدقيق (F-04، F-07، F-08) في مجلد الاختبار؛ يُشغَّل وحده
 * لأن runAllTests صار يتجاوز حد الدقائق الست في المحرر.
 */
function runLiveFixChecks() {
  _T = { pass: 0, fail: 0, log: [] };
  _suite('Integration: ReportEdits', integrationTest_ReportEdits);
  _suite('Integration: SheetFixes',  integrationTest_SheetFixes);
  _report('LIVE FIX CHECKS (F-04, F-07, F-08)');
}

// ============================================================================
// ⑤ المُشغِّل الكامل
// ============================================================================

/**
 * يشغّل الجناحين: اختبارات الوحدة أولاً ثم اختبارات التكامل.
 * يتطلب TEST_ROOT_FOLDER_ID؛ وإلا تفشل اختبارات التكامل برسالة واضحة.
 */
function runAllTests() {
  runAllUnitTests();
  const unitPass = _T.pass;
  const unitFail = _T.fail;

  // جناح التكامل
  _T = { pass: 0, fail: 0, log: [] };
  _suite('Integration: DuplicateDetection',          integrationTest_DuplicateDetection);
  _suite('Integration: DistinctHalaqatNotDuplicate', integrationTest_DistinctHalaqatNotDuplicate);
  _suite('Integration: MissingFields',               integrationTest_MissingFields);
  _suite('Integration: StudentsRegistry',            integrationTest_StudentsRegistry);
  _suite('Integration: PublicStats',                 integrationTest_PublicStats);
  _suite('Integration: Dashboard',                   integrationTest_Dashboard);
  _suite('Integration: StudentDetails',              integrationTest_StudentDetails);
  _suite('Integration: Api',                         integrationTest_Api);
  _suite('Integration: ReportEdits',                 integrationTest_ReportEdits);
  _suite('Integration: Honors',                      integrationTest_Honors);
  _report('INTEGRATION TESTS');

  console.log(`\nSUMMARY — Unit: ${unitPass}P/${unitFail}F | Integration: ${_T.pass}P/${_T.fail}F`);
}
