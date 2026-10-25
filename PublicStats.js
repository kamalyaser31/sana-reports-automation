/**
 * ============================================================================
 * PublicStats.js — Public statistics file for donors (M3)
 * ============================================================================
 * Computes name-free numbers from the students registry and its «الحلقات» tab
 * only (S-18), and writes them to «إحصاءات أكاديمية سنا <year>». Teachers
 * appear by code (S-17). The «قبل النظام» tab is pasted once by hand and never
 * written here (S-28); it is read for the «منذ التأسيس» row (S-30).
 * The month's expense is the teachers' pay (hours × «أسعار الساعة») plus the
 * other expenses in «المصروفات», all in pounds (S-36, S-37).
 * The computation is a pure function, computePublicStats, covered by unit tests.
 * ============================================================================
 */

const PUBLIC_STATS = {
  FILE_PREFIX:  'إحصاءات أكاديمية سنا',
  TOTALS_TAB:   'الإجمالي',
  MONTHLY_TAB:  'شهرياً',
  LEGACY_TAB:   'قبل النظام',
  ACADEMY:      'الأكاديمية',
  SINCE_START:  'منذ التأسيس',
  ACTIVE_DAYS:  30,
  FREEZE_DAY:   5,
  CHILDREN:     'أطفال',
  ADULTS:       'كبار',
  CURRENCY:     'EGP',
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
  // legacy_stats.py (M4) writes exactly these columns (S-29).
  LEGACY_HEADERS: [
    'الشهر', 'المعلم', 'عدد الحلقات', 'الساعات', 'الحضور الكلي', 'متوسط الطلاب في الحلقة',
    'حلقات الأطفال', 'ساعات الأطفال', 'حلقات الكبار', 'ساعات الكبار', 'المعلمون النشطون',
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
 * One halaqa per (teacher, date, session, number), whatever the number of
 * reports; reports in which nobody was counted are skipped (S-15).
 * @param {Array<Array>} rows - «الحلقات» values.
 * @returns {Array<{teacher: string, date: Date, month: string, category: string, minutes: number, attendance: number}>}
 */
function collectHalaqat(rows) {
  const bySlot = {};
  (rows || []).forEach(r => {
    const counted = Number(r[7]) || 0;
    if (!(r[1] instanceof Date) || counted <= 0) return;
    const slot = `${r[2]}|${_isoDay(r[1])}|${r[3]}|${r[4]}`;
    if (!bySlot[slot]) {
      bySlot[slot] = { teacher: String(r[2]), date: r[1], month: _monthOf(r[1]),
        category: String(r[5]), minutes: Number(r[6]) || 0, attendance: 0 };
    }
    bySlot[slot].attendance += counted;
  });
  return Object.keys(bySlot).map(k => bySlot[k]);
}

/**
 * Halaqa columns shared by «الإجمالي», «شهرياً» and «منذ التأسيس».
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
 * Teacher code → name, from the registry's teachers and CONFIG.TEACHERS, so a
 * teacher with no registry tab yet still has a name for «قبل النظام».
 * @param {Array<{name: string, code: string}>} teachers
 * @returns {Object<string, string>}
 */
function teacherNamesByCode(teachers) {
  const out = {};
  Object.keys(CONFIG.TEACHERS).forEach(k => { out[CONFIG.TEACHERS[k].id] = _teacherTabName(CONFIG.TEACHERS[k].name); });
  teachers.forEach(t => { out[t.code] = t.name; });
  return out;
}

/**
 * Each teacher's pay per month (S-35): the month's hours times the current
 * rate, rounded to the pound. Hours are the registry's, plus the teacher rows
 * of «قبل النظام» for the days before install (S-49). rate and pay are '' without a rate.
 * @param {Array<Object>} halaqat - From collectHalaqat.
 * @param {Object<string, number>} rates - From readRates.
 * @param {Array<Array>} [legacyRows] - «قبل النظام» values.
 * @param {Object<string, string>} [nameOfCode] - From teacherNamesByCode.
 * @returns {Array<{month: string, teacher: string, hours: number, rate: number|string, pay: number|string}>}
 */
function computeTeacherPay(halaqat, rates, legacyRows, nameOfCode) {
  const byKey = {};
  const add = (month, teacher, minutes) => {
    const k = `${month}|${teacher}`;
    (byKey[k] = byKey[k] || { month, teacher, minutes: 0 }).minutes += minutes;
  };
  halaqat.forEach(h => add(h.month, h.teacher, h.minutes));
  (legacyRows || []).forEach(r => {
    const code = String(r[1] || '').trim();
    const hours = Number(r[3]) || 0;
    const month = r[0] instanceof Date ? _monthOf(r[0]) : String(r[0] || '').trim();
    if (code && code !== PUBLIC_STATS.ACADEMY && hours > 0 && /^\d{4}-\d{2}$/.test(month)) {
      add(month, (nameOfCode || {})[code] || code, hours * 60);
    }
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
 * @param {Array<Array>} input.halaqat  - «الحلقات» values.
 * @param {Array<Array>} input.expenses - «المصروفات» values (other expenses).
 * @param {Array<Array>} [input.rates]  - «أسعار الساعة» values.
 * @param {Array<Array>} input.legacy   - «قبل النظام» values.
 * @param {Date} input.today
 * @param {Object<string, Array<Array>>} [input.frozenMonthly] - Existing «شهرياً» rows by month.
 * @returns {{ totals: Array<Array>, monthly: Array<Array>, pay: Array<Object> }}
 *   pay names teachers, so it is for the dashboard only.
 */
function computePublicStats(input) {
  const today = input.today;
  const activeFrom = new Date(today.getFullYear(), today.getMonth(), today.getDate() - PUBLIC_STATS.ACTIVE_DAYS);
  const halaqat = collectHalaqat(input.halaqat);
  const expenses = readExpenses(input.expenses);
  const pay = computeTeacherPay(halaqat, readRates(input.rates), input.legacy, teacherNamesByCode(input.teachers));
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
  totals.push(_sinceStartRow(halaqat, input.legacy));

  return { totals, monthly: _monthlyRows(teachers, academyStudents, teacherStudents, halaqat, expenses, pay, input), pay };
}

/**
 * «منذ التأسيس» (S-30): halaqat, hours and attendance from «قبل النظام» (its
 * academy rows) plus the registry, with no student count.
 * @param {Array<Object>} halaqat
 * @param {Array<Array>} legacyRows
 * @returns {Array}
 */
function _sinceStartRow(halaqat, legacyRows) {
  const n = _halaqaNumbers(halaqat);
  const academy = (legacyRows || []).filter(r => String(r[1]).trim() === PUBLIC_STATS.ACADEMY);
  const sum = i => academy.reduce((a, r) => a + (Number(r[i]) || 0), 0);
  const count = n.count + sum(2);
  const attendance = n.attendance + sum(4);
  return [PUBLIC_STATS.SINCE_START, '', '', '', '',
    count, _round(n.hours + sum(3)), attendance, count ? _round(attendance / count, 1) : 0,
    n.kids + sum(6), _round(n.kidsHours + sum(7)), n.adults + sum(8), _round(n.adultsHours + sum(9)), ''];
}

/**
 * «شهرياً»: one block of rows per month (teachers, then the academy). A frozen
 * month keeps the rows already written for it (S-20).
 * @returns {Array<Array>}
 */
function _monthlyRows(teachers, academyStudents, teacherStudents, halaqat, expenses, pay, input) {
  const months = Array.from(new Set(halaqat.map(h => h.month))).sort();
  const firstDay = halaqat.length ? halaqat.map(h => h.date).sort((a, b) => a - b)[0] : null;
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
    const total = monthPay.some(p => p.pay === '') ? ''
      : monthPay.reduce((a, p) => a + p.pay, 0) + (expenses[month] ? expenses[month].amount : 0);
    // Days before install are in «قبل النظام»: their hours join the divisor, and
    // the month has no full student count, so no sponsorship (S-49).
    const legacyHours = (input.legacy || [])
      .filter(r => String(r[0]).trim() === month && String(r[1]).trim() === PUBLIC_STATS.ACADEMY)
      .reduce((a, r) => a + (Number(r[3]) || 0), 0);
    const hours = hp.hours + legacyHours;
    rows.push([month, since, PUBLIC_STATS.ACADEMY].concat(sp.cols).concat(hp.cols).concat([
      new Set(monthHalaqat.map(h => h.teacher)).size,
      total,
      total === '' ? '' : PUBLIC_STATS.CURRENCY,
      total !== '' && hours ? _round(total / hours) : '',
      total !== '' && sp.attended && !legacyHours ? _round(total / sp.attended) : '',
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
  const teachers = registryTeacherSheets(registry)
    .map(sh => ({
      name:     sh.getName(),
      code:     _resolveTeacher({ rawTeacherName: sh.getName() }, []).teacherId,
      students: readStudentsTab(sh).students,
    }));

  const halaqatRows = _readBody(registry.getSheetByName(REGISTRY.HALAQAT_TAB))
    .map(r => [r[0], r[1], _teacherTabName(r[2])].concat(r.slice(3)));
  const monthlyTab = ss.getSheetByName(PUBLIC_STATS.MONTHLY_TAB);
  const frozenMonthly = {};
  _readBody(monthlyTab).forEach(r => {
    const m = String(r[0]);
    (frozenMonthly[m] = frozenMonthly[m] || []).push(r);
  });

  const stats = computePublicStats({
    teachers,
    halaqat:  halaqatRows,
    expenses: _readBody(registry.getSheetByName(REGISTRY.EXPENSES_TAB)),
    rates:    readRateRows(),
    legacy:   _readBody(ss.getSheetByName(PUBLIC_STATS.LEGACY_TAB)),
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
  const legacy = ss.insertSheet(PUBLIC_STATS.LEGACY_TAB);
  _styleHeader(legacy, PUBLIC_STATS.LEGACY_HEADERS);
  legacy.getRange('A:A').setNumberFormat('@');
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
