/**
 * ============================================================================
 * Honors.js — Students honoured by the administration (S-60)
 * ============================================================================
 * The admin enters each honor from the dashboard, into the registry's
 * «التكريمات» tab: the date, the teacher, the student and an optional reason.
 * It is not the «وسام» of a halaqa report, which the registry counts apart.
 * An honor costs the honor amount of its month, kept in the rates file behind
 * the pay password; that cost replaced the fixed item «الهدايا والتكريمات».
 * ============================================================================
 */

const HONORS = {
  HEADERS:        ['التاريخ', 'المعلم', 'الطالب', 'السبب', 'مفتاح الطالب'],
  AMOUNT_TAB:     'مبلغ التكريم',
  AMOUNT_HEADERS: ['من شهر', 'المبلغ'],
  REASON_MAX:     100,
};

// ============================================================================
// 1. PURE READING (unit-tested)
// ============================================================================

/** A cell that holds a day or a month as text, or a Date Sheets made of it. */
function _dayText(v, length) {
  return v instanceof Date ? _isoDay(v).substring(0, length) : String(v || '').trim();
}

/**
 * «التكريمات» rows; an unreadable row is left out, and each keeps its sheet row.
 * @param {Array<Array>} rows
 * @returns {Array<{date: string, month: string, teacher: string, name: string, reason: string, key: string, row: number}>}
 */
function readHonors(rows) {
  return (rows || []).map((r, i) => {
    const date = _dayText(r[0], 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    return {
      date, month: date.substring(0, 7), teacher: String(r[1] || '').trim(), name: String(r[2] || '').trim(),
      reason: String(r[3] || '').trim(), key: String(r[4] || '').trim(), row: i + 2,
    };
  }).filter(h => h && h.teacher && h.key);
}

/**
 * «مبلغ التكريم» rows: each amount holds from its month on.
 * @param {Array<Array>} rows
 * @returns {Array<{from: string, amount: number}>} Sorted by month.
 */
function readHonorAmounts(rows) {
  return (rows || []).map(r => ({ from: _dayText(r[0], 7), amount: Number(r[1]) }))
    .filter(a => /^\d{4}-\d{2}$/.test(a.from) && a.amount >= 0)
    .sort((a, b) => (a.from > b.from ? 1 : -1));
}

/**
 * The amount of one honor in a month: the last amount set from that month or
 * before; a month before the first amount takes the first. '' before any.
 * @param {string} month
 * @param {Array<{from: string, amount: number}>} amounts - From readHonorAmounts.
 * @returns {number|string}
 */
function honorAmountFor(month, amounts) {
  if (!amounts.length) return '';
  const past = amounts.filter(a => a.from <= month);
  return (past.length ? past[past.length - 1] : amounts[0]).amount;
}

/**
 * The honors rows a name correction moves (F-03): those of the teacher's tab
 * whose student key is the wrong name's, with the right key and name.
 * @param {Array<Array>} rows - «التكريمات» values.
 * @param {string} tabName - The teacher's registry tab.
 * @param {string} from - The name as written.
 * @param {string} to - The correct name.
 * @returns {Array<{row: number, key: string, name: string}>}
 */
function honorsAfterAlias(rows, tabName, from, to) {
  const fromKey = studentNameKey(from);
  const name = cleanStudentName(to);
  return readHonors(rows).filter(h => h.teacher === tabName && h.key === fromKey)
    .map(h => ({ row: h.row, key: studentNameKey(name), name }));
}

// ============================================================================
// 2. SPREADSHEET
// ============================================================================

/**
 * Moves a corrected student's honors to the right name, so they stay counted
 * for that student. Runs inside the alias's script lock.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} registry
 * @param {string} tabName
 * @param {string} from
 * @param {string} to
 */
function moveHonorsToName(registry, tabName, from, to) {
  const sheet = registry.getSheetByName(REGISTRY.HONORS_TAB);
  if (!sheet) return;
  honorsAfterAlias(_readBody(sheet), tabName, from, to).forEach(u => {
    sheet.getRange(u.row, 3).setValue(u.name);
    sheet.getRange(u.row, 5).setValue(u.key);
  });
}

/** «التكريمات» values of a registry, or []. */
function readHonorRows(registry) {
  return _readBody(registry.getSheetByName(REGISTRY.HONORS_TAB));
}

/** «مبلغ التكريم» values of the rates file, or []. */
function readHonorAmountRows() {
  const ss = _findRatesFile();
  const sheet = ss && ss.getSheetByName(HONORS.AMOUNT_TAB);
  return sheet ? _readBody(sheet) : [];
}

/**
 * Adds one honor (S-60). The student must be in the teacher's registry tab,
 * and the month still open.
 * @param {{teacher: string, key: string, date: string, reason: string}} honor
 * @param {string} year
 * @param {Date} today
 * @returns {{name: string}}
 */
function addHonor(honor, year, today) {
  const date = normalizeDigitsAndText(String(honor.date || '')).trim();
  const [y, m, d] = date.split('-').map(Number);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || String(y) !== year || _isoDay(new Date(y, m - 1, d)) !== date) {
    throw new Error(`اختر تاريخ التكريم في سنة ${year}.`);
  }
  if (date > _isoDay(today)) throw new Error('تاريخ التكريم لم يأتِ بعد.');
  if (isMonthFrozen(date.substring(0, 7), today)) {
    throw new Error(`شهر ${date.substring(0, 7)} ثابت بعد الخامس من الشهر التالي، فلا يُضاف فيه تكريم.`);
  }
  const reason = String(honor.reason || '').trim();
  if (reason.length > HONORS.REASON_MAX) throw new Error(`السبب ${HONORS.REASON_MAX} حرف على الأكثر.`);

  return _withScriptLock(() => {
    const ss = _registryOrThrow(year);
    const tab = ss.getSheetByName(_teacherTabName(honor.teacher || ''));
    const student = tab && readStudentsTab(tab).students.find(s => s.key === honor.key);
    if (!student) throw new Error('لم يوجد هذا الطالب عند هذا المعلم في سجل الطلاب.');
    let sheet = ss.getSheetByName(REGISTRY.HONORS_TAB);
    if (!sheet) {
      sheet = ss.insertSheet(REGISTRY.HONORS_TAB);
      _styleHeader(sheet, HONORS.HEADERS);
    }
    const row = sheet.getLastRow() + 1;
    // Text, or Sheets turns "2026-10-25" into a date.
    sheet.getRange(row, 1).setNumberFormat('@');
    sheet.getRange(row, 1, 1, HONORS.HEADERS.length).setValues([[date, tab.getName(), student.name, reason, student.key]]);
    return { name: student.name };
  });
}

/**
 * Removes one honor, after checking the row still holds what the page showed.
 * @param {{row: *, date: string, teacher: string, key: string}} ref
 * @param {string} year
 * @param {Date} today
 * @returns {Object} The honor removed, as readHonors.
 */
function deleteHonor(ref, year, today) {
  return _withScriptLock(() => {
    const sheet = _registryOrThrow(year).getSheetByName(REGISTRY.HONORS_TAB);
    const honor = readHonors(_readBody(sheet)).find(h => h.row === Number(ref.row));
    if (!honor || honor.date !== ref.date || honor.teacher !== ref.teacher || honor.key !== ref.key) {
      throw new Error('تغيّرت التكريمات منذ حُمّلت الصفحة؛ حدّث الصفحة ثم أعد المحاولة.');
    }
    if (isMonthFrozen(honor.month, today)) {
      throw new Error(`شهر ${honor.month} ثابت بعد الخامس من الشهر التالي، فلا يُحذف تكريمه.`);
    }
    sheet.deleteRow(honor.row);
    return honor;
  });
}

/**
 * The amount of one honor from this month on (S-60); earlier months keep theirs.
 * @param {*} amount - Pounds.
 * @param {Date} today
 * @returns {{from: string, amount: number}}
 */
function _honorAmountRow(amount, today) {
  const text = normalizeDigitsAndText(String(amount === undefined ? '' : amount)).trim();
  const value = Number(text);
  if (text === '' || !(value >= 0)) throw new Error('مبلغ التكريم رقم لا يقل عن صفر.');
  const month = _monthOf(today) < PUBLIC_STATS.PAY_FROM ? PUBLIC_STATS.PAY_FROM : _monthOf(today);
  return { from: month, amount: Math.round(value * 100) / 100 };
}

/** Writes a checked honor amount in the rates file, behind the pay password. Inside the lock. */
function _writeHonorAmount(saved) {
  const ss = _getOrCreateRatesFile();
  let sheet = ss.getSheetByName(HONORS.AMOUNT_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(HONORS.AMOUNT_TAB);
    _styleHeader(sheet, HONORS.AMOUNT_HEADERS);
  }
  const index = _readBody(sheet).map(r => _dayText(r[0], 7)).indexOf(saved.from);
  const row = index === -1 ? sheet.getLastRow() + 1 : index + 2;
  sheet.getRange(row, 1).setNumberFormat('@');
  sheet.getRange(row, 1, 1, 2).setValues([[saved.from, saved.amount]]);
}
