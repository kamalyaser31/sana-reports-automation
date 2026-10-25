/**
 * ============================================================================
 * PublicStats.js — Public statistics file for donors (M3)
 * ============================================================================
 * Computes name-free numbers and writes them to «إحصاءات أكاديمية سنا <year>».
 * Halaqat, hours and attendance are the teachers' own sheets', every month
 * (S-53); students are the registry's. Teachers appear by code (S-17).
 * The month's expense is the teachers' pay (their own sheets' hours × «أسعار
 * الساعة», S-50), the fixed monthly expenses (S-51) and the other expenses in
 * «المصروفات», all in pounds (S-36, S-37).
 * The computation is a pure function, computePublicStats, covered by unit tests.
 * ============================================================================
 */

const PUBLIC_STATS = {
  FILE_PREFIX:  'إحصاءات أكاديمية سنا',
  TOTALS_TAB:   'الإجمالي',
  MONTHLY_TAB:  'شهرياً',
  ACADEMY:      'الأكاديمية',
  ACTIVE_DAYS:  30,
  FREEZE_DAY:   5,
  CHILDREN:     'أطفال',
  ADULTS:       'كبار',
  CURRENCY:     'EGP',
  // Pay, fixed expenses and the month's expense start here (S-50, S-51).
  PAY_FROM:     '2026-10',
  FIXED_ITEMS:  ['الهدايا والتكريمات', 'إدارة الأكاديمية'],
  // A month listed here counts only these teachers' halaqat: the other
  // reports of September 2026 had errors (S-54).
  MONTH_TEACHERS: {
    '2026-09': ['محمد نبيل', 'أسماء علي', 'سارة العدل', 'فاطمة إبراهيم'],
  },
  SHEET_HOURS_SECONDS: 600,
  TOTALS_HEADERS: [
    'المعلم', 'عدد الطلاب الكلي', 'الطلاب النشطون', 'الذكور', 'الإناث', 'عدد الحلقات',
    'ساعات التدريس', 'الحضور الكلي', 'متوسط الطلاب في الحلقة', 'حلقات الأطفال',
    'ساعات الأطفال', 'حلقات الكبار', 'ساعات الكبار', 'المعلمون النشطون',
  ],
  MONTHLY_HEADERS: [
    'الشهر', 'من تاريخ', 'المعلم', 'الطلاب الجدد', 'من حضر في الشهر',
    'المستمرون من الشهر السابق', 'نسبة الاستمرار', 'عدد الحلقات', 'الساعات',
    'الحضور الكلي', 'متوسط الطلاب في الحلقة', 'حلقات الأطفال', 'حلقات الكبار',
    'المعلمون النشطون', 'مصروف الشهر', 'العملة', 'تكلفة ساعة التدريس', 'كفالة الطالب في الشهر',
  ],
};

// ============================================================================
// 1. PURE COMPUTATION
// ============================================================================

/**
 * @param {number} n
 * @param {number} [digits]
 * @returns {number}
 */
function _round(n, digits) {
  const f = Math.pow(10, digits === undefined ? 2 : digits);
  return Math.round(n * f) / f;
}

/** "yyyy-mm" of a Date. */
function _monthOf(date) {
  return _isoDay(date).substring(0, 7);
}

/** The calendar month before "yyyy-mm". */
function _previousMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/**
 * A month is frozen once the 5th of the following month has passed (S-20).
 * @param {string} month - "yyyy-mm".
 * @param {Date} today
 * @returns {boolean}
 */
function isMonthFrozen(month, today) {
  const [y, m] = month.split('-').map(Number);
  return today >= new Date(y, m, PUBLIC_STATS.FREEZE_DAY + 1);
}

/**
 * Who a student is at academy level (S-22): a name of two words or more is
 * one person across teachers; a single name counts per teacher.
 * @param {string} teacher
 * @param {Object} s
 * @returns {string}
 */
function _academyStudentId(teacher, s) {
  return cleanStudentName(s.name).split(' ').length >= 2 ? `k|${s.key}` : `t|${teacher}|${s.key}`;
}

/**
 * Halaqa columns shared by «الإجمالي» and «شهرياً».
 * @param {Array<Object>} halaqat
 * @returns {Object}
 */
function _halaqaNumbers(halaqat) {
  const sum = (list, f) => list.reduce((a, h) => a + f(h), 0);
  const kids = halaqat.filter(h => h.category === PUBLIC_STATS.CHILDREN);
  const adults = halaqat.filter(h => h.category === PUBLIC_STATS.ADULTS);
  const attendance = sum(halaqat, h => h.attendance);
  return {
    count:       halaqat.length,
    hours:       _round(sum(halaqat, h => h.minutes) / 60),
    attendance,
    average:     halaqat.length ? _round(attendance / halaqat.length, 1) : 0,
    kids:        kids.length,
    kidsHours:   _round(sum(kids, h => h.minutes) / 60),
    adults:      adults.length,
    adultsHours: _round(sum(adults, h => h.minutes) / 60),
  };
}

/**
 * Reads «المصروفات» values into a month → { amount, currency } map. A month
 * typed by hand may come back from Sheets as a Date.
 * @param {Array<Array>} rows
 * @returns {Object<string, {amount: number, currency: string}>}
 */
function readExpenses(rows) {
  const out = {};
  (rows || []).forEach(r => {
    const month = r[0] instanceof Date ? _monthOf(r[0]) : String(r[0] || '').trim();
    const amount = Number(r[1]);
    if (/^\d{4}-\d{2}$/.test(month) && amount > 0) out[month] = { amount, currency: String(r[2] || '') };
  });
  return out;
}

/**
 * The reports of one monthly tab of a teacher's sheet (S-50, S-55), from its
 * display values below the header, in the sheet's order: one per row except
 * the two summary rows. A row marked «(تقرير مكرر)» is kept with duplicate set.
 * Minutes are «مدة الحصة» (column D, "h:mm"), attendance «عدد الطلاب» (column E).
 * @param {Array<Array>} rows
 * @param {string} teacher - Teacher tab name.
 * @param {string} month - "yyyy-mm" of the tab.
 * @returns {Array<Object>} teacher, date, month, category, minutes, attendance,
 *   duplicate, and the cells as shown: dateText, session, duration, students, notes.
 */
function teacherSheetReports(rows, teacher, month) {
  const summary = new Set(['الإجمالي', 'المتوسط']);
  const [y, m] = month.split('-').map(Number);
  const text = v => String(v === undefined || v === null ? '' : v).trim();
  const out = [];
  (rows || []).forEach(r => {
    if (summary.has(text(r[0])) || r.slice(0, 6).every(v => text(v) === '')) return;
    const d = text(r[3]);
    const hm = /^(\d+):(\d{1,2})/.exec(d);
    // A plain number is a day fraction, as Sheets stores a duration.
    const minutes = hm ? Number(hm[1]) * 60 + Number(hm[2]) : Math.round((Number(d) || 0) * 1440);
    out.push({ teacher, date: new Date(y, m - 1, _sheetDay(r[0])), month,
      category: text(r[2]), minutes,
      attendance: Number(normalizeDigitsAndText(text(r[4]))) || 0,
      duplicate: text(r[5]).indexOf('(تقرير مكرر)') === 0,
      dateText: text(r[0]), session: text(r[1]), duration: d, students: text(r[4]), notes: text(r[5]) });
  });
  return out;
}

/**
 * Whether a report counts in the numbers and the pay: not a duplicate, with a
 * duration, and by a teacher the month allows (S-54).
 * @param {Object} r - From teacherSheetReports.
 * @returns {boolean}
 */
function isCountedReport(r) {
  const only = PUBLIC_STATS.MONTH_TEACHERS[r.month];
  return !r.duplicate && r.minutes > 0 && (!only || only.indexOf(r.teacher) !== -1);
}

/**
 * Day of the month in a report date: "الاثنين، ١٢ أكتوبر ٢٠٢٦" or "12-10-2026";
 * 1 when none is found, so the halaqa still counts in its tab's month.
 * @param {*} text
 * @returns {number}
 */
function _sheetDay(text) {
  const s = normalizeDigitsAndText(String(text || ''));
  const m = /(\d{1,2})[-/.]\d{1,2}[-/.]\d{4}/.exec(s) || /(\d{1,2})\s+[^\d\s]+\s+\d{4}/.exec(s);
  const day = m ? Number(m[1]) : 1;
  return day >= 1 && day <= 31 ? day : 1;
}

/**
 * Reads «المصروفات الثابتة» into item → amount; only the known items count (S-51).
 * @param {Array<Array>} rows
 * @returns {Object<string, number>}
 */
function readFixedExpenses(rows) {
  const out = {};
  (rows || []).forEach(r => {
    const item = String(r[0] || '').trim();
    const amount = Number(r[1]);
    if (PUBLIC_STATS.FIXED_ITEMS.indexOf(item) !== -1 && amount > 0) out[item] = amount;
  });
  return out;
}

/**
 * Each teacher's pay per month (S-35): the month's hours in the teacher's own
 * sheet (S-50) times the current rate, rounded to the pound. rate and pay are
 * '' without a rate.
 * @param {Array<{month: string, teacher: string, minutes: number}>} sheetReports - From readTeacherSheetReports.
 * @param {Object<string, number>} rates - From readRates.
 * @returns {Array<{month: string, teacher: string, hours: number, rate: number|string, pay: number|string}>}
 */
function computeTeacherPay(sheetReports, rates) {
  const byKey = {};
  (sheetReports || []).forEach(h => {
    if (!(h.month >= PUBLIC_STATS.PAY_FROM) || !(h.minutes > 0)) return;
    const k = `${h.month}|${h.teacher}`;
    (byKey[k] = byKey[k] || { month: h.month, teacher: h.teacher, minutes: 0 }).minutes += h.minutes;
  });
  return Object.keys(byKey).sort().map(k => {
    const p = byKey[k];
    const rate = rates[p.teacher] || '';
    return { month: p.month, teacher: p.teacher, hours: _round(p.minutes / 60), rate,
      pay: rate ? Math.round(p.minutes / 60 * rate) : '' };
  });
}

/**
 * Computes both public tabs.
 * @param {Object} input
 * @param {Array<{name: string, code: string, students: Array<Object>}>} input.teachers
 * @param {Array<Array>} input.expenses - «المصروفات» values (other expenses).
 * @param {Array<Array>} [input.rates]  - «أسعار الساعة» values.
 * @param {Array<Object>} [input.sheetReports] - From readTeacherSheetReports.
 * @param {Array<Array>} [input.fixed]  - «المصروفات الثابتة» values.
 * @param {Date} input.today
 * @param {Object<string, Array<Array>>} [input.frozenMonthly] - Existing «شهرياً» rows by month.
 * @returns {{ totals: Array<Array>, monthly: Array<Array>, pay: Array<Object> }}
 *   pay names teachers, so it is for the dashboard only.
 */
function computePublicStats(input) {
  const today = input.today;
  const activeFrom = new Date(today.getFullYear(), today.getMonth(), today.getDate() - PUBLIC_STATS.ACTIVE_DAYS);
  // Halaqat are the teachers' sheets' (S-53); students the registry's, as the
  // sheets hold counts, not names. The registry's first day is when students
  // began to be counted.
  const halaqat = (input.sheetReports || []).filter(isCountedReport);
  const studentDays = [].concat(...input.teachers.map(t => [].concat(...t.students
    .map(s => Object.keys(s.slots).map(k => k.split('|')[0]))))).sort();
  const studentsFrom = studentDays.length ? studentDays[0] : '';
  const expenses = readExpenses(input.expenses);
  const pay = computeTeacherPay(halaqat, readRates(input.rates));
  const teachers = input.teachers.slice().sort((a, b) => (a.code > b.code ? 1 : -1));
  const codeOf = {};
  teachers.forEach(t => { codeOf[t.name] = t.code; });

  // Academy-level students: one entry per person, holding all their slots.
  const people = {};
  teachers.forEach(t => t.students.forEach(s => {
    const id = _academyStudentId(t.name, s);
    if (!people[id]) people[id] = { gender: s.gender, slots: {} };
    Object.keys(s.slots).forEach(k => { people[id].slots[`${t.name}|${k}`] = s.slots[k]; });
  }));
  const academyStudents = Object.keys(people).map(id => ({
    gender: people[id].gender,
    days: Object.keys(people[id].slots).map(k => k.split('|')[1]).sort(),
  }));
  const teacherStudents = t => t.students.map(s => ({
    gender: s.gender, days: Object.keys(s.slots).map(k => k.split('|')[0]).sort(),
  }));

  const activeDay = _isoDay(activeFrom);
  const studentColumns = list => [
    list.length,
    list.filter(s => s.days.length && s.days[s.days.length - 1] >= activeDay).length,
    list.filter(s => s.gender === STUDENT_GENDER.MALE).length,
    list.filter(s => s.gender === STUDENT_GENDER.FEMALE).length,
  ];
  const halaqaColumns = list => {
    const n = _halaqaNumbers(list);
    return [n.count, n.hours, n.attendance, n.average, n.kids, n.kidsHours, n.adults, n.adultsHours];
  };
  const activeTeachers = list => new Set(list.map(h => h.teacher)).size;

  const totals = teachers.map(t => [t.code]
    .concat(studentColumns(teacherStudents(t)))
    .concat(halaqaColumns(halaqat.filter(h => h.teacher === t.name)))
    .concat(['']));
  totals.push([PUBLIC_STATS.ACADEMY]
    .concat(studentColumns(academyStudents))
    .concat(halaqaColumns(halaqat))
    .concat([activeTeachers(halaqat.filter(h => h.date >= activeFrom))]));

  return { totals, monthly: _monthlyRows(teachers, academyStudents, teacherStudents, halaqat, expenses, pay, studentsFrom, input), pay };
}

/**
 * «شهرياً»: one block of rows per month (teachers, then the academy). A frozen
 * month keeps the rows already written for it (S-20).
 * @returns {Array<Array>}
 */
function _monthlyRows(teachers, academyStudents, teacherStudents, halaqat, expenses, pay, studentsFrom, input) {
  const months = Array.from(new Set(halaqat.map(h => h.month).concat(pay.map(p => p.month)))).sort();
  const firstDay = halaqat.length ? halaqat.map(h => h.date).sort((a, b) => a - b)[0] : null;
  // The registry counts students from its first day only, so that month has no sponsorship (S-50).
  const partialMonth = studentsFrom && studentsFrom.slice(8) !== '01' ? studentsFrom.slice(0, 7) : '';
  const fixedItems = readFixedExpenses(input.fixed);
  const fixedTotal = Object.keys(fixedItems).reduce((a, k) => a + fixedItems[k], 0);
  const frozen = input.frozenMonthly || {};
  const rows = [];

  months.forEach((month, i) => {
    if (isMonthFrozen(month, input.today) && frozen[month] && frozen[month].length) {
      frozen[month].forEach(r => rows.push(r));
      return;
    }
    const since = i === 0 && firstDay ? firstDay : '';
    const hasPrevious = months.indexOf(_previousMonth(month)) !== -1;
    const studentPart = list => {
      const inMonth = s => s.days.some(d => d.substring(0, 7) === month);
      const inPrev = s => s.days.some(d => d.substring(0, 7) === _previousMonth(month));
      const attended = list.filter(inMonth).length;
      const prev = list.filter(inPrev).length;
      const stayed = list.filter(s => inMonth(s) && inPrev(s)).length;
      return {
        attended,
        cols: [
          list.filter(s => s.days.length && s.days[0].substring(0, 7) === month).length,
          attended,
          hasPrevious ? stayed : '',
          hasPrevious && prev ? _round(stayed / prev, 3) : '',
        ],
      };
    };
    const halaqaPart = list => {
      const n = _halaqaNumbers(list);
      return { hours: n.hours, cols: [n.count, n.hours, n.attendance, n.average, n.kids, n.adults] };
    };
    const monthHalaqat = halaqat.filter(h => h.month === month);

    teachers.forEach(t => {
      rows.push([month, since, t.code]
        .concat(studentPart(teacherStudents(t)).cols)
        .concat(halaqaPart(monthHalaqat.filter(h => h.teacher === t.name)).cols)
        .concat(['', '', '', '', '']));
    });

    const sp = studentPart(academyStudents);
    const hp = halaqaPart(monthHalaqat);
    // A teacher without a rate would understate the cost, so it stays blank (S-36).
    const monthPay = pay.filter(p => p.month === month);
    const total = month < PUBLIC_STATS.PAY_FROM || monthPay.some(p => p.pay === '') ? ''
      : monthPay.reduce((a, p) => a + p.pay, 0) + fixedTotal + (expenses[month] ? expenses[month].amount : 0);
    // The cost of an hour is over the teachers' own sheets' hours, as their pay is (S-50).
    const hours = monthPay.reduce((a, p) => a + p.hours, 0);
    rows.push([month, since, PUBLIC_STATS.ACADEMY].concat(sp.cols).concat(hp.cols).concat([
      new Set(monthHalaqat.map(h => h.teacher)).size,
      total,
      total === '' ? '' : PUBLIC_STATS.CURRENCY,
      total !== '' && hours ? _round(total / hours) : '',
      total !== '' && sp.attended && month !== partialMonth ? _round(total / sp.attended) : '',
    ]));
  });
  return rows;
}

/**
 * Throws when any cell holds a student name: the file is shared with donors.
 * @param {Array<Array>} rows
 * @param {Set<string>} forbidden - Student and teacher names.
 */
function assertNoNames(rows, forbidden) {
  rows.forEach(r => r.forEach(v => {
    if (typeof v === 'string' && forbidden.has(cleanStudentName(v))) {
      throw new Error('الملف العام لا يُكتب: فيه اسم.');
    }
  }));
}

// ============================================================================
// 2. SPREADSHEET
// ============================================================================

/**
 * Rebuilds the public file of a year from its registry.
 * @param {string} [year] - Defaults to the current year.
 * @param {Date} [today]
 * @returns {boolean} false when the year has no registry yet.
 */
function refreshPublicStats(year, today) {
  const y = String(year || new Date().getFullYear());
  const now = today || new Date();
  const registry = _findRegistry(y);
  if (!registry) return false;

  const yearFolder = _firstNotTrashed(_findRootFolder().getFoldersByName(sanitizeFilename(y)));
  const ss = _getOrCreatePublicFile(yearFolder, y);
  const sheetReports = readTeacherSheetReports(y);
  const teachers = academyTeachers(registry, sheetReports);
  const monthlyTab = ss.getSheetByName(PUBLIC_STATS.MONTHLY_TAB);
  const frozenMonthly = {};
  _readBody(monthlyTab).forEach(r => {
    const m = String(r[0]);
    (frozenMonthly[m] = frozenMonthly[m] || []).push(r);
  });

  const stats = computePublicStats({
    teachers,
    expenses: _readBody(registry.getSheetByName(REGISTRY.EXPENSES_TAB)),
    rates:    readRateRows(),
    sheetReports,
    fixed:    readFixedRows(),
    today:    now,
    frozenMonthly,
  });

  const names = new Set();
  teachers.forEach(t => {
    names.add(cleanStudentName(t.name));
    t.students.forEach(s => names.add(cleanStudentName(s.name)));
  });
  assertNoNames(stats.totals.concat(stats.monthly), names);

  const totalsTab = ss.getSheetByName(PUBLIC_STATS.TOTALS_TAB);
  totalsTab.getRange(1, 2).setValue(now).setNumberFormat('dd-mm-yyyy hh:mm');
  _rewriteBody(totalsTab, 3, stats.totals, PUBLIC_STATS.TOTALS_HEADERS.length);
  _rewriteBody(monthlyTab, 2, stats.monthly, PUBLIC_STATS.MONTHLY_HEADERS.length);
  return true;
}

/**
 * The academy's teachers (S-53): every registry tab, and every teacher with a
 * sheet but no tab yet, who has no students until a report reaches the registry.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} registry
 * @param {Array<Object>} sheetReports - From readTeacherSheetReports.
 * @returns {Array<{name: string, code: string, students: Array<Object>, detailCols: Object}>}
 */
function academyTeachers(registry, sheetReports) {
  const codeOf = name => _resolveTeacher({ rawTeacherName: name }, []).teacherId;
  const teachers = registryTeacherSheets(registry).map(sh => ({
    name: sh.getName(), code: codeOf(sh.getName()),
    students: readStudentsTab(sh).students, detailCols: studentDetailColumns(_headerRow(sh)),
  }));
  const known = new Set(teachers.map(t => t.name));
  Array.from(new Set(sheetReports.map(h => h.teacher))).filter(n => !known.has(n)).forEach(name => {
    teachers.push({ name, code: codeOf(name), students: [], detailCols: { birthYear: -1, phone: -1 } });
  });
  return teachers;
}

/**
 * The reports of every «[teacher] - تقارير الحلقات <year>» under the year
 * folder, every month (S-50, S-53). Opening each
 * sheet is slow, so the live result is cached for SHEET_HOURS_SECONDS; a test
 * run reads afresh, as its reports change from one step to the next.
 * @param {string} year
 * @param {boolean} [fresh] - Read the sheets even when cached («حدّث التقارير»).
 * @returns {Array<Object>} As teacherSheetReports.
 */
function readTeacherSheetReports(year, fresh) {
  const cache = CacheService.getScriptCache();
  const key = `sheet_reports_${year}`;
  const hit = _TEST_MODE || fresh ? null : _cacheGetJson(cache, key);
  // JSON turns each Date into text; it is made a Date again.
  if (hit) return hit.map(h => Object.assign(h, { date: new Date(h.date) }));

  const root = _findRootFolder();
  const yearFolder = root && _firstNotTrashed(root.getFoldersByName(sanitizeFilename(year)));
  const suffix = ` - تقارير الحلقات ${year}`;
  const seen = new Set();
  const out = [];
  const folders = yearFolder ? yearFolder.getFolders() : { hasNext: () => false };
  while (folders.hasNext()) {
    const files = folders.next().getFiles();
    while (files.hasNext()) {
      const file = files.next();
      const name = file.getName();
      if (file.isTrashed() || !name.endsWith(suffix) || file.getMimeType() !== MimeType.GOOGLE_SHEETS) continue;
      const teacher = _teacherTabName(name.slice(0, -suffix.length));
      if (seen.has(teacher)) continue;
      seen.add(teacher);
      SpreadsheetApp.openById(file.getId()).getSheets().forEach(sheet => {
        const m = /^(\d{1,2})\s*-/.exec(sheet.getName());
        const month = m ? `${year}-${m[1].padStart(2, '0')}` : '';
        if (!month || sheet.getLastRow() < 2) return;
        const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getDisplayValues();
        teacherSheetReports(rows, teacher, month).forEach(h => out.push(h));
      });
    }
  }
  if (!_TEST_MODE) _cachePutJson(cache, key, out, PUBLIC_STATS.SHEET_HOURS_SECONDS);
  return out;
}

/**
 * A cache value holds at most 100 KB, and a year of reports with their notes is
 * more, so the JSON is kept in parts. Arabic takes two bytes a letter.
 */
const CACHE_PART_CHARS = 40000;

/** @returns {*} The value put by _cachePutJson, or null if any part has gone. */
function _cacheGetJson(cache, key) {
  const n = Number(cache.get(`${key}_n`));
  if (!n) return null;
  const keys = Array.from({ length: n }, (_, i) => `${key}_${i}`);
  const parts = cache.getAll(keys);
  if (keys.some(k => parts[k] === undefined || parts[k] === null)) return null;
  return JSON.parse(keys.map(k => parts[k]).join(''));
}

function _cachePutJson(cache, key, value, seconds) {
  const json = JSON.stringify(value);
  const parts = {};
  let n = 0;
  for (let i = 0; i < json.length; i += CACHE_PART_CHARS) parts[`${key}_${n++}`] = json.slice(i, i + CACHE_PART_CHARS);
  parts[`${key}_n`] = String(n);
  try { cache.putAll(parts, seconds); } catch (e) { console.warn('[CACHE] reports not cached:', e.message); }
}

/**
 * @param {GoogleAppsScript.Drive.Folder} yearFolder
 * @param {string} year
 * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet}
 */
function _getOrCreatePublicFile(yearFolder, year) {
  const title = `${PUBLIC_STATS.FILE_PREFIX} ${year}`;
  const existing = _firstNotTrashed(yearFolder.getFilesByName(title));
  if (existing) return SpreadsheetApp.openById(existing.getId());

  const ss = SpreadsheetApp.create(title);
  DriveApp.getFileById(ss.getId()).moveTo(yearFolder);
  const totals = ss.getSheets()[0];
  totals.setName(PUBLIC_STATS.TOTALS_TAB);
  totals.setRightToLeft(true);
  totals.getRange(1, 1).setValue('آخر تحديث').setFontWeight('bold');
  totals.getRange(2, 1, 1, PUBLIC_STATS.TOTALS_HEADERS.length)
    .setValues([PUBLIC_STATS.TOTALS_HEADERS]).setFontWeight('bold');
  totals.setFrozenRows(2);
  const monthly = ss.insertSheet(PUBLIC_STATS.MONTHLY_TAB);
  _styleHeader(monthly, PUBLIC_STATS.MONTHLY_HEADERS);
  // The month stays text, or Sheets turns "2026-10" into a date.
  monthly.getRange('A:A').setNumberFormat('@');
  return ss;
}

/**
 * Clears a tab from firstRow down and writes rows there in one batch.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} firstRow
 * @param {Array<Array>} rows
 * @param {number} width
 */
function _rewriteBody(sheet, firstRow, rows, width) {
  const lastRow = sheet.getLastRow();
  if (lastRow >= firstRow) sheet.getRange(firstRow, 1, lastRow - firstRow + 1, width).clearContent();
  // Frozen rows read back from the sheet may be shorter (trailing blanks) or wider.
  const fitted = rows.map(r => r.slice(0, width).concat(new Array(Math.max(0, width - r.length)).fill('')));
  if (fitted.length) sheet.getRange(firstRow, 1, fitted.length, width).setValues(fitted);
}

// ============================================================================
// 3. EXPENSES & NIGHTLY TRIGGER
// ============================================================================

/**
 * Saves a month's other expenses, in pounds, in the registry (S-25, S-36):
 * updates the month's row if it exists, else appends one. Called by the dashboard.
 * @param {string} month - "yyyy-mm".
 * @param {number|string} amount
 */
function saveExpense(month, amount) {
  const m = String(month || '').trim();
  const value = Number(normalizeDigitsAndText(String(amount)).trim());
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new Error('اكتب الشهر بصيغة 2026-10.');
  if (!(value > 0)) throw new Error('المبلغ رقم أكبر من صفر.');

  _withScriptLock(() => {
    const sheet = _registryOrThrow(m.substring(0, 4)).getSheetByName(REGISTRY.EXPENSES_TAB);
    const index = readExpenseMonths(_readBody(sheet)).indexOf(m);
    const row = index === -1 ? sheet.getLastRow() + 1 : index + 2;
    sheet.getRange(row, 1).setNumberFormat('@');
    sheet.getRange(row, 1, 1, 3).setValues([[m, value, PUBLIC_STATS.CURRENCY]]);
  });
}

/**
 * The month of each «المصروفات» row, in row order ('' for an unreadable one).
 * @param {Array<Array>} rows
 * @returns {string[]}
 */
function readExpenseMonths(rows) {
  return (rows || []).map(r => (r[0] instanceof Date ? _monthOf(r[0]) : String(r[0] || '').trim()));
}

/**
 * Nightly job (S-21): pending aliases, then the public file. In the first days
 * of January the previous year is refreshed too, until its December freezes.
 * @param {Date} [today]
 */
function nightlyStatsJob(today) {
  const now = today instanceof Date ? today : new Date();
  try { applyPendingAliases(String(now.getFullYear())); }
  catch (error) { _safeLogToDrive('NIGHTLY', now, `applyPendingAliases failed: ${error.message}`, error.stack); }

  const years = [String(now.getFullYear())];
  if (now.getMonth() === 0 && now.getDate() <= PUBLIC_STATS.FREEZE_DAY) years.push(String(now.getFullYear() - 1));
  years.forEach(y => {
    try { refreshPublicStats(y, now); }
    catch (error) { _safeLogToDrive('NIGHTLY', now, `refreshPublicStats ${y} failed: ${error.message}`, error.stack); }
  });
}

/**
 * Installs the nightly trigger once, replacing any older copy. Run by hand
 * from the editor on install day (S-31), not before.
 */
function installNightlyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'nightlyStatsJob')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('nightlyStatsJob').timeBased().everyDays(1).atHour(2).create();
  console.log('[NIGHTLY] nightlyStatsJob trigger installed (daily, around 02:00).');
}
