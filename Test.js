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

// ============================================================================
// ③ تشغيل جميع اختبارات الوحدة
// ============================================================================

/**
 * يشغّل جميع اختبارات الوحدة (لا يتصل بـ Drive/Sheets).
 * الوقت المتوقع: 2–4 ثوانٍ.
 */
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

// ============================================================================
// ⑤ المُشغِّل الكامل
// ============================================================================

/**
 * يشغّل الجناحين: اختبارات الوحدة أولاً ثم اختبارات التكامل.
 * يتطلب TEST_ROOT_FOLDER_ID؛ وإلا تفشل اختبارات التكامل برسالة واضحة.
 * الوقت المتوقع: 40–60 ثانية (حسب سرعة Drive/Sheets).
 */
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
  _report('INTEGRATION TESTS');

  console.log(`\nSUMMARY — Unit: ${unitPass}P/${unitFail}F | Integration: ${_T.pass}P/${_T.fail}F`);
}
