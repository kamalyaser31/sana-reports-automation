/**
 * ============================================================================
 * Test.js — Comprehensive Regression Test Suite
 * Sana Academy Reports Automation v5.1
 * ============================================================================
 *
 * ENTRY POINTS:
 *   runAllUnitTests()  — اختبارات الوحدة فقط (~3 ثوانٍ، بدون Drive/Sheets)
 *   runAllTests()      — الجناحان معاً: وحدة + تكاملي (~45 ثانية)
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
    _eq(normalizeDigitsAndText(''),    '',    'empty string → empty');
    _eq(normalizeDigitsAndText(null),  '',    'null → empty');
    _eq(normalizeDigitsAndText('123'), '123', 'western digits unchanged');
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
    _eq(parseReportMetadata(''),   { dateText: '', sessionTypeText: '', studentCountText: '', halaNumText: '' }, 'empty string');
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
    _eq(_formatArabicHours(100), 'ساعة',    '100 → ساعة');
  });
}

// ─── sanitizeFilename ────────────────────────────────────────────────────────
function _testSanitize() {
  _suite('sanitizeFilename', () => {
    _eq(sanitizeFilename(''),           'unnamed',             'empty → unnamed');
    _eq(sanitizeFilename(null),         'unnamed',             'null → unnamed');
    _eq(sanitizeFilename('normal'),     'normal',              'clean name unchanged');
    _eq(sanitizeFilename('a/b\\c:d'),   'a_b_c_d',            'forbidden chars → underscore');
    _eq(sanitizeFilename(' trim '),     'trim',                'leading/trailing space trimmed');
    _eq(sanitizeFilename('29-08_تجويد'), '29-08_تجويد',       'arabic + hyphens preserved');
    _eq(sanitizeFilename('line\nnew'),   'line new',           'newline → space');
  });
}

// ─── escapeHtml ──────────────────────────────────────────────────────────────
function _testEscapeHtml() {
  _suite('escapeHtml', () => {
    _eq(escapeHtml(''),         '',          'empty → empty');
    _eq(escapeHtml(null),       '',          'null → empty');
    _eq(escapeHtml('plain'),    'plain',     'no special chars unchanged');
    _eq(escapeHtml('a & b'),    'a &amp; b', '& escaped');
    _eq(escapeHtml('<b>tag</b>'), '&lt;b&gt;tag&lt;/b&gt;', '< and > escaped');
    _eq(escapeHtml('a<b>&c'),   'a&lt;b&gt;&amp;c', 'all three combined');
  });
}

// ─── _formatSubmissionDate ───────────────────────────────────────────────────
function _testFormatDate() {
  _suite('_formatSubmissionDate', () => {
    const d = _formatSubmissionDate(new Date(2026, 7, 29)); // Aug 29 2026
    _eq(d.year,            '2026',          'year as string');
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
    _ok(r2.teacherId.startsWith('T_'), 'unknown teacher gets T_ prefix');
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
    _eq(mf3.length,     1,                              'empty → pushed to missingFields');

    _section('اسم null');
    const mf4 = [];
    const r4 = _resolveTeacher({ rawTeacherName: null }, mf4);
    _eq(r4.teacherName, CONFIG.FALLBACKS.TEACHER_NAME, 'null → fallback');
    _ok(mf4.includes(CONFIG.FIELDS.TEACHER),            'null → correct field in missing list');
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

    _section('أرقام عربية شرقية');
    const d2 = _parseDuration({ rawHours: '١', rawMinutes: '١٥' }, [], []);
    _eq(d2.hours,        1,       'eastern hours');
    _eq(d2.minutes,      15,      'eastern minutes');
    _eq(d2.durationTime, '01:15', 'eastern durationTime');
    _eq(d2.durationFormatted, '1 ساعة و15 دقيقة', 'eastern Arabic formatted');

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
    _eq(v1.teacherName,       'محمد نبيل', 'teacher resolved');
    _eq(v1.teacherId,         'T001',       'teacher ID');
    _eq(v1.durationTime,      '01:30',      'duration time');
    _eq(v1.sessionType,       'تجويد',      'session from metadata');
    _eq(v1.studentCount,      8,            'student count from metadata');
    _eq(v1.submissionYear,    '2026',       'year');
    _ok(v1.missingFields.length === 0,      'no missing fields');

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

    _section('بيانات صالحة بأرقام عربية');
    const rawArabic = { ...rawOk, rawHours: '١', rawMinutes: '٣٠' };
    const v3 = validateFormData(rawArabic, 'uuid-3', new Date(2026, 7, 29));
    _eq(v3.durationTime, '01:30', 'eastern arabic digits normalized in validateFormData');

    _section('معلم غير مُدرج في CONFIG');
    const rawUnknown = { ...rawOk, rawTeacherName: 'معلم جديد' };
    const v4 = validateFormData(rawUnknown, 'uuid-4', new Date(2026, 7, 29));
    _eq(v4.teacherName,              'معلم جديد', 'unknown teacher name kept');
    _ok(v4.teacherId.startsWith('T_'), 'unknown teacher dynamic ID');
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

    _has(md, '---',                         'YAML frontmatter delimiters');
    _has(md, 'teacher_name: "محمد نبيل"',   'teacher_name in frontmatter');
    _has(md, 'session_type: "تجويد"',       'session_type in frontmatter');
    _has(md, 'duration_time: "01:30"',      'duration_time in frontmatter');
    _has(md, 'student_count: 8',            'student_count in frontmatter');
    _has(md, 'validation_status: "VALID"',  'validation_status in frontmatter');
    _has(md, '# تقرير حلقة:',              'H1 title present');
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
  _suite('buildHalaqaRow / rowsToAliases', () => {
    const ctx = _sampleContext(5, [{ name: 'حمزة علاء' }], { reportId: 'r1', session: 'صباحية', halaNum: '2', minutes: 90 });
    _eq(buildHalaqaRow(ctx, 0).slice(2), ['سمية حمدي', 'صباحية', '2', 'أطفال', 90, 0], 'halaqa row columns');
    _eq(buildHalaqaRow(ctx, 0)[0], 'r1', 'keyed by report_id');

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
}

// ─── الملف العام (PublicStats.js) ────────────────────────────────────────────

/** معلمان وحلقات في سبتمبر وأكتوبر، والاسم المفرد «محمد» عند كليهما. */
function _sampleStatsInput(today, extra) {
  const rec = (name, slots) => ({ key: studentNameKey(name), name, gender: STUDENT_GENDER.MALE, slots });
  const slot = (day, s, cat) => ({ [`${day}|${s}|1`]: [cat, 0, 0] });
  const row = (id, y, m, d, t, s, cat, min, n) => [id, new Date(y, m, d), t, s, '1', cat, min, n];
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
    halaqat: [
      row('r1', 2026, 8, 28, 'محمد نبيل', 'صباحية', 'أطفال', 60, 1),
      row('r2', 2026, 9, 3, 'محمد نبيل', 'صباحية', 'أطفال', 60, 2),
      row('r2b', 2026, 9, 3, 'محمد نبيل', 'صباحية', 'أطفال', 60, 0),
      row('r3', 2026, 9, 5, 'أسماء علي', 'مسائية', 'كبار', 90, 2),
    ],
    expenses: [['2026-10', 500, 'EGP'], ['2026-08', '', 'EGP']],
    rates: [['محمد نبيل', 100], ['أسماء علي', 80]],
    legacy: [
      ['2026-09', 'الأكاديمية', 10, 12, 40, 4, 6, 7, 4, 5, 2],
      ['2026-09', 'T001', 6, 7, 20, 3.3, 6, 7, 0, 0, ''],
    ],
    today,
  }, extra || {});
}

function _testPublicStats() {
  _suite('computePublicStats', () => {
    const out = computePublicStats(_sampleStatsInput(new Date(2026, 9, 20)));
    const byCode = code => out.totals.find(r => r[0] === code);

    _section('الإجمالي');
    _eq(out.totals.map(r => r[0]), ['T001', 'T002', 'الأكاديمية', 'منذ التأسيس'], 'rows ordered by code, then academy and since start');
    _eq(byCode('T001').slice(1), [2, 2, 2, 0, 2, 2, 3, 1.5, 2, 2, 0, 0, ''], 'teacher totals (resubmission row skipped)');
    _eq(byCode('T002').slice(5, 9), [1, 1.5, 2, 2], 'second teacher halaqat, hours, attendance, average');
    _eq(byCode('الأكاديمية')[1], 3, 'two-word name once across teachers, single name per teacher');
    _eq(byCode('الأكاديمية').slice(5, 9), [3, 3.5, 5, 1.7], 'academy halaqat');
    _eq(byCode('الأكاديمية')[13], 2, 'active teachers in the last 30 days');
    _eq(byCode('منذ التأسيس').slice(1, 13), ['', '', '', '', 13, 15.5, 45, 3.5, 8, 9, 5, 6.5],
      'since start = legacy academy rows + registry, no student count');
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
    _eq(ac.slice(14), [720, 'EGP', 288, 240], 'expense = pay 220 + other 500; cost per teaching hour; sponsorship');
    _eq(month('2026-09', 'الأكاديمية').slice(14), [800, 'EGP', 61.54, ''],
      'pre-system hours paid too: 1 + 7 hours × 100, ÷ 13 hours, no sponsorship (S-49)');
    _eq(month('2026-10', 'T001').slice(14), ['', '', '', ''], 'no expense or pay on teacher rows');
    const partial = computePublicStats(_sampleStatsInput(new Date(2026, 9, 20), { rates: [['محمد نبيل', 100]] }));
    const academy = m => partial.monthly.find(r => r[0] === m && r[2] === PUBLIC_STATS.ACADEMY);
    _eq(academy('2026-10').slice(14), ['', '', '', ''], 'a teacher with halaqat and no rate blanks the expense');
    _eq(academy('2026-09').slice(14, 16), [800, 'EGP'], 'a month whose teachers all have rates stays priced');

    _section('المستحقات');
    _eq(out.pay, [
      { month: '2026-09', teacher: 'محمد نبيل', hours: 8, rate: 100, pay: 800 },
      { month: '2026-10', teacher: 'أسماء علي', hours: 1.5, rate: 80, pay: 120 },
      { month: '2026-10', teacher: 'محمد نبيل', hours: 1, rate: 100, pay: 100 },
    ], 'pay per teacher and month, resubmission and zero-count reports skipped');
    _eq(partial.pay[1].rate + '|' + partial.pay[1].pay, '|', 'no rate → rate and pay blank');
    const legacyOnly = computeTeacherPay([], { 'رجاء لطفي': 50 },
      [['2026-09', 'T004', 5, 27, 19], ['2026-09', 'الأكاديمية', 5, 27, 19], ['2026-09', 'T_ab12', 1, 2, 3]],
      teacherNamesByCode([]));
    _eq(legacyOnly.map(p => [p.teacher, p.hours, p.pay]), [['T_ab12', 2, ''], ['رجاء لطفي', 27, 1350]],
      'a pre-system teacher without a tab is named from CONFIG; an unknown code stays a code; the academy row is skipped');
    const odd = computeTeacherPay(collectHalaqat([['x', new Date(2026, 9, 1), 'س', 'صباحية', '1', 'كبار', 50, 3]]), { 'س': 37.5 });
    _eq(odd[0].pay, 31, 'pay rounded to the pound (50 min × 37.5)');
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
      rateLog: [[new Date(2026, 9, 25, 10, 0), 'منى', 'محمد نبيل: 100']] }, input));
    _eq([open.teachers.map(t => t.rate), open.unpriced], [[80, 100], []], 'rates per teacher once unlocked, none missing');
    _eq([open.pay.length, open.rateLog[0].details], [3, 'محمد نبيل: 100'], 'pay rows and rate log sent once unlocked');
    const withLegacy = buildDashboardData(Object.assign({ year: '2026', aliases: [], showPay: true }, input,
      { legacy: input.legacy.concat([['2026-09', 'T004', 5, 27, 19]]) }));
    _eq(withLegacy.rateTeachers.map(t => t.name), ['أسماء علي', 'رجاء لطفي', 'محمد نبيل'],
      'rate list includes a pre-system teacher without a registry tab');
    _eq(d.rateTeachers.map(t => t.rate), ['', ''], 'rate list has no amounts before the pay password');
    const oldLog = buildDashboardData(Object.assign({ year: '2026', aliases: [] }, input, {
      log: [[new Date(), 'منى', RATE_LOG_ACTION, 'محمد نبيل: 100'], [new Date(), 'منى', 'مصروف', '2026-10: 5']] }));
    _eq(oldLog.log.map(e => e.action), ['مصروف'], 'old rate rows kept out of the shared log');
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

// ============================================================================
// ③ تشغيل جميع اختبارات الوحدة
// ============================================================================

/**
 * يشغّل جميع اختبارات الوحدة (لا يتصل بـ Drive/Sheets).
 * الوقت المتوقع: 2–4 ثوانٍ.
 */
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
    const req = parseApiRequest(JSON.stringify({ action: 'saveRate', token: 't', test: true, year: '2026',
      args: { teacher: ' سمية ', rate: 50, extra: { a: 1 } } }));
    _eq(req, { action: 'saveRate', token: 't', test: true, year: '2026', args: { teacher: 'سمية', rate: '50' } },
      'args trimmed, control characters and objects dropped');
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
    _eq(throws(() => handleApiRequest({ action: 'saveRate', token: tok, year: '2026', args: { teacher: 'x', rate: '5' } },
      payDeps)), 'error', 'saving a rate needs the pay password, and keeps the session');
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
// تستدعي executeSubmissionPipeline مباشرةً — لا onFormSubmit الذي يبتلع الأخطاء —
// فأي فشل في Drive/Sheets يُسقط الاختبار بدل أن يمرّ صامتاً.

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

/** اختبار تكاملي — تقرير كامل صالح: يُنشئ ملف Markdown وصفاً في Sheets. */
function integrationTest_NormalSubmission() {
  const result = _runIntegrationSubmission({
    'اسم المعلم':           'محمد نبيل',
    'فئة الطلاب':           'كبار',
    'الساعات':              '1',
    'الدقائق':              '30',
    'التقرير':              _buildTestReport('29-08-2026', 'تجويد', 8, '', 'تم شرح أحكام النون الساكنة.'),
    'ملاحظات خاصة للإدارة': 'اختبار تكاملي — تقرير عادي.',
  });
  _ok(Boolean(result.fileUrl),                        'file saved to Drive');
  _eq(result.validationStatus, 'VALID',               'status VALID');
  _eq(result.submissionMonthFolderName, '08 - أغسطس', 'routed by report date');
}

/** اختبار تكاملي — التقرير نفسه مرة ثانية: يجب أن يُعلَّم مكرراً. */
function integrationTest_DuplicateDetection() {
  const mockData = {
    'اسم المعلم':           'محمد نبيل',
    'فئة الطلاب':           'كبار',
    'الساعات':              '1',
    'الدقائق':              '30',
    'التقرير':              _buildTestReport('29-08-2026', 'تجويد', 8, '', 'تقرير مكرر.'),
    'ملاحظات خاصة للإدارة': '',
  };
  _runIntegrationSubmission(mockData);
  const second = _runIntegrationSubmission(mockData);
  _ok(second.isDuplicate,         'second identical submission flagged duplicate');
  _ok(second.duplicateIndex >= 1, 'duplicate gets a (n) suffix');
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

/** اختبار تكاملي — أرقام عربية شرقية في حقول الساعات والدقائق. */
function integrationTest_EasternArabicDigits() {
  const result = _runIntegrationSubmission({
    'اسم المعلم':           'أسماء علي',
    'فئة الطلاب':           'كبار',
    'الساعات':              '٢',
    'الدقائق':              '١٥',
    'التقرير':              _buildTestReport('29-08-2026', 'مسائية', '٢٠', '', 'تقرير بأرقام عربية شرقية.'),
    'ملاحظات خاصة للإدارة': 'اختبار أرقام عربية شرقية.',
  });
  _eq(result.durationTime, '02:15', 'eastern digits → 02:15');
  _eq(result.studentCount, 20,      'eastern student count → 20');
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

/** اختبار تكاملي — معلم غير مُدرج في CONFIG: يُقبل ويُنشأ له ID ديناميكي. */
function integrationTest_UnknownTeacher() {
  const result = _runIntegrationSubmission({
    'اسم المعلم':           'معلم جديد',
    'فئة الطلاب':           'أطفال',
    'الساعات':              '1',
    'الدقائق':              '0',
    'التقرير':              _buildTestReport('29-08-2026', 'صباحية', 5, '', 'تقرير معلم جديد.'),
    'ملاحظات خاصة للإدارة': 'اختبار معلم غير مُدرج.',
  });
  _ok(result.teacherId.startsWith('T_'), 'unknown teacher gets T_ ID');
  _eq(result.validationStatus, 'VALID',  'unknown teacher is still VALID');
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
  const halaqat = () => {
    _TEST_MODE = true;
    try { return _readBody(_findRegistry('2026').getSheetByName(REGISTRY.HALAQAT_TAB)); }
    finally { _TEST_MODE = false; }
  };
  const counted = id => halaqat().filter(r => r[0] === id).map(r => r[7]);
  _eq(counted(first.executionId), [2], 'halaqa row: two students counted');
  _eq(counted(resent.executionId), [0], 'resubmission row counts nobody');
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
    setStudentGender(teacher, studentNameKey(hamza), STUDENT_GENDER.FEMALE, '2026');
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
    'التقرير': _buildTestReport('10-09-2026', 'مسائية', 1, `${tag}9`, _sampleStudentText([{ name: student }])),
    'ملاحظات خاصة للإدارة': '',
  });

  _TEST_MODE = true;
  try {
    saveExpense('2026-09', '٤٠٠');
    saveExpense('2026-09', 450);
    let refused = '';
    try { saveExpense('2026-9', 10); } catch (e) { refused = e.message; }
    _ok(refused !== '', 'malformed month refused');
    // 60 pounds an hour makes each teacher's pay their minutes, to check the sum.
    const teachers = registryTeacherSheets(_findRegistry('2026')).map(sh => sh.getName());
    const oldTab = () => _findRegistry('2026').getSheetByName(REGISTRY.RATES_TAB);
    const registryRatesBefore = oldTab() ? JSON.stringify(_readBody(oldTab())) : '';
    saveTeacherRate(teachers[0], '٧٠');
    teachers.forEach(t => saveTeacherRate(t, 60));
    const rates = readRateRows();
    _eq(oldTab() ? JSON.stringify(_readBody(oldTab())) : '', registryRatesBefore,
      'rates not written to the shared registry');
    _eq(rates.filter(r => r[0] === teachers[0]).map(r => r[1]), [60], 'rate updated in place, eastern digits read');
    refused = '';
    try { saveTeacherRate(teachers[0], '0'); } catch (e) { refused = e.message; }
    _ok(refused !== '', 'zero rate refused');

    // A day when September is still open, so its rows are recomputed, not kept frozen.
    const openDay = new Date(2026, 9, 1);
    _ok(refreshPublicStats('2026', openDay), 'public file refreshed');
    const ss = SpreadsheetApp.openById(_firstNotTrashed(
      getRootFolder().getFoldersByName('2026').next().getFilesByName(`${PUBLIC_STATS.FILE_PREFIX} 2026`)).getId());
    const legacy = ss.getSheetByName(PUBLIC_STATS.LEGACY_TAB);
    if (legacy.getLastRow() < 2) legacy.appendRow(['2026-08', PUBLIC_STATS.ACADEMY, 1, 1, 1, 1, 0, 0, 1, 1, 1]);
    const legacyBefore = JSON.stringify(_readBody(legacy));
    refreshPublicStats('2026', openDay);
    _eq(JSON.stringify(_readBody(legacy)), legacyBefore, '«قبل النظام» unchanged by the refresh');

    const cells = _readBody(ss.getSheetByName(PUBLIC_STATS.TOTALS_TAB))
      .concat(_readBody(ss.getSheetByName(PUBLIC_STATS.MONTHLY_TAB)));
    _ok(!cells.some(r => r.some(v => String(v).indexOf(tag) !== -1)), 'no student name in the public file');
    _ok(!cells.some(r => r.some(v => v === 'سمية حمدي')), 'no teacher name in the public file');
    const sept = _readBody(ss.getSheetByName(PUBLIC_STATS.MONTHLY_TAB))
      .find(r => String(r[0]) === '2026-09' && r[2] === PUBLIC_STATS.ACADEMY);
    _eq([sept[14], sept[15]], [450 + Math.round(sept[8] * 60), 'EGP'], 'expense = pay + other expenses, updated in place');
    const expenses = readExpenseMonths(_readBody(_findRegistry('2026').getSheetByName(REGISTRY.EXPENSES_TAB)));
    _eq(expenses.filter(m => m === '2026-09').length, 1, 'one expense row per month');
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
    const withRate = _withPay(true, () => dashboardSaveRate(teacher, '٥٠', '2026'));
    _eq(withRate.teachers.find(t => t.name === teacher).rate, 50, 'rate saved from the dashboard');
    _ok(withRate.pay.filter(p => p.teacher === teacher).every(p => p.rate === 50), 'pay uses the new rate');

    const key = studentNameKey(right);
    const g = dashboardSetGender(teacher, key, STUDENT_GENDER.MALE, '2026');
    _eq(g.teachers.find(t => t.name === teacher).students.find(s => s.key === key).gender, STUDENT_GENDER.MALE, 'gender saved from the dashboard');

    let err = '';
    try { dashboardSetGender(teacher, 'لا_يوجد', STUDENT_GENDER.MALE, '2026'); } catch (e) { err = e.message; }
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
    const saved = dashboardSetDetails(teacher, studentNameKey(student), { birthYear: '٢٠١٦', phone: `00${phone.slice(1)}` }, '2025');
    _eq([find(saved).birthYear, find(saved).phone], [2016, phone], 'details saved and normalized');
    let err = '';
    try { dashboardSetDetails(teacher, studentNameKey(student), { birthYear: '2016', phone: '0100' }, '2025'); }
    catch (e) { err = e.message; }
    _has(err, 'مفتاح الدولة', 'bad phone explained');
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

// ============================================================================
// ⑤ المُشغِّل الكامل
// ============================================================================

/**
 * يشغّل الجناحين: اختبارات الوحدة أولاً ثم اختبارات التكامل.
 * يتطلب TEST_ROOT_FOLDER_ID؛ وإلا تفشل اختبارات التكامل برسالة واضحة.
 * الوقت المتوقع: 40–60 ثانية (حسب سرعة Drive/Sheets).
 */
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
  try { call('saveRate', { teacher, rate: '65' }, login.token); } catch (e) { refused = e.message; }
  _has(refused, 'افتح الرواتب', 'rate refused before the pay password');

  const opened = call('unlockPay', { password: deps.payPassword }, login.token);
  _ok(opened.data.payOpen && Array.isArray(opened.data.pay), 'pay password opens rates and pay');
  const saved = call('saveRate', { teacher, rate: '65' }, login.token);
  _eq(saved.data.teachers.find(t => t.name === teacher).rate, 65, 'rate saved through the API');
  _eq(saved.data.rateLog[0].name + '|' + saved.data.rateLog[0].details, `مختبر ${tag}|${teacher}: 65`,
    'rate change logged with the name typed at login');
  const after = call('data', {}, login.token).data;
  _eq(after.rateLog[0].name, `مختبر ${tag}`, 'rate log row written to the rates file');
  _ok(!after.log.some(e => e.action === RATE_LOG_ACTION), 'no rate row in the shared edit log');

  call('setGender', { teacher, key: studentNameKey(`منير ${tag}`), gender: STUDENT_GENDER.MALE, label: `منير ${tag}` }, login.token);
  _eq(call('data', {}, login.token).data.log[0].name, `مختبر ${tag}`, 'other writes logged in the registry');
  _eq(call('lockPay', {}, login.token).data.pay, null, 'lock hides pay again');

  const reply = JSON.parse(doPost({ postData: { contents: '{' } }).getContent());
  _eq([reply.ok, reply.error], [false, 'طلب غير مفهوم.'], 'doPost answers a bad body with JSON');
}

function runAllTests() {
  runAllUnitTests();
  const unitPass = _T.pass;
  const unitFail = _T.fail;

  // جناح التكامل
  _T = { pass: 0, fail: 0, log: [] };
  _suite('Integration: NormalSubmission',            integrationTest_NormalSubmission);
  _suite('Integration: DuplicateDetection',          integrationTest_DuplicateDetection);
  _suite('Integration: DistinctHalaqatNotDuplicate', integrationTest_DistinctHalaqatNotDuplicate);
  _suite('Integration: EasternArabicDigits',         integrationTest_EasternArabicDigits);
  _suite('Integration: MissingFields',               integrationTest_MissingFields);
  _suite('Integration: UnknownTeacher',              integrationTest_UnknownTeacher);
  _suite('Integration: StudentsRegistry',            integrationTest_StudentsRegistry);
  _suite('Integration: PublicStats',                 integrationTest_PublicStats);
  _suite('Integration: Dashboard',                   integrationTest_Dashboard);
  _suite('Integration: StudentDetails',              integrationTest_StudentDetails);
  _suite('Integration: Api',                         integrationTest_Api);
  _report('INTEGRATION TESTS');

  console.log(`\nSUMMARY — Unit: ${unitPass}P/${unitFail}F | Integration: ${_T.pass}P/${_T.fail}F`);
}
