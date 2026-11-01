/**
 * ============================================================================
 * Students.js — Students registry: pure functions (M1)
 * ============================================================================
 * Parses the student blocks of a report, builds the matching key, and counts
 * attendance once per halaqa (the "slot" rule). Nothing here touches Drive or Sheets, so every
 * function is covered by runAllUnitTests. The plan is PLAN_STUDENTS_SHEET.md.
 * ============================================================================
 */

/** Columns A–M of a teacher tab; admin columns start after them (S-06). */
const STUDENT_SYSTEM_COLUMNS = 13;

const STUDENT_GENDER = { MALE: 'ذكر', FEMALE: 'أنثى' };

// Matches the app's formatStudent(): "الطالب: name" or "الطالبة: name".
const STUDENT_HEADER_RE = /^(الطالب|الطالبة)\s*[:：]\s*(.+)$/;
const FIELD_SEPARATOR_RE = /^━+$/;
const REPORT_FOOTER_RE = /^\*?نسأل الله/;

// ============================================================================
// 1. NAME KEY
// ============================================================================

/**
 * Display form of a name: invisible marks removed, spaces collapsed.
 * @param {string} name
 * @returns {string}
 */
function cleanStudentName(name) {
  return String(name || '')
    .replace(/[​-‏؜﻿ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Matching key (S-03): hamza forms → ا, ة → ه, ى → ي, no tashkeel, tatweel or spaces.
 * The report app's duplicate check uses the same rule, so two blocks that share
 * a key here are already blocked there.
 * @param {string} name
 * @returns {string}
 */
function studentNameKey(name) {
  return cleanStudentName(name)
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[ً-ْٰـ\s]/g, '');
}

// ============================================================================
// 2. REPORT PARSER
// ============================================================================

/**
 * Splits the report text into student blocks.
 * A block holds the name, gender, new memorization, repeats («التقييم: إعادة»)
 * and whether it has a medal. Blocks named «بدون اسم» are skipped.
 * @param {string} reportText
 * @returns {Array<{name: string, gender: string, hifz: string, repeats: number, medal: boolean}>}
 */
function parseStudentBlocks(reportText) {
  const lines = normalizeDigitsAndText(reportText || '').split(/\r?\n/).map(l => l.trim());
  const blocks = [];
  let current = null;
  let field = '';

  lines.forEach(line => {
    const header = line.match(STUDENT_HEADER_RE);
    if (header) {
      current = {
        name:    cleanStudentName(header[2]),
        gender:  header[1] === 'الطالبة' ? STUDENT_GENDER.FEMALE : STUDENT_GENDER.MALE,
        hifz:    '',
        repeats: 0,
        medal:   false,
      };
      blocks.push(current);
      field = '';
      return;
    }
    if (!current) return;
    if (REPORT_FOOTER_RE.test(line)) { current = null; return; }
    if (FIELD_SEPARATOR_RE.test(line)) { field = ''; return; }

    const label = line.match(/^([^:：]+)\s*[:：]\s*(.*)$/);
    if (label && _isStudentFieldLabel(label[1].trim())) {
      field = label[1].trim();
      if (field === 'التقييم' && label[2].trim() === 'إعادة') current.repeats++;
      if (field === 'الوسام' && label[2].trim()) current.medal = true;
      if (field === 'الحفظ الجديد' && label[2].trim()) current.hifz = label[2].trim();
      return;
    }
    if (!line) return;
    if (field === 'الحفظ الجديد') current.hifz = current.hifz ? `${current.hifz} ${line}` : line;
    if (field === 'الوسام') current.medal = true;
  });

  return blocks.filter(b => b.name && b.name !== 'بدون اسم');
}

/**
 * Field labels written by formatStudent(); any other "x: y" line is content.
 * «الماضي المطلوب» and «الماضي القريب المطلوب» are labels too, so their text
 * never leaks into «الحفظ الجديد».
 * @param {string} label
 * @returns {boolean}
 */
function _isStudentFieldLabel(label) {
  return ['التسميع', 'التقييم', 'الماضي', 'الماضي القريب', 'الحفظ الجديد',
    'الماضي المطلوب', 'الماضي القريب المطلوب', 'ملاحظات', 'الوسام'].indexOf(label) !== -1;
}

// ============================================================================
// 3. REPORT CONTEXT & SLOT RULE
// ============================================================================

/**
 * yyyy-mm-dd in local time, so a slot key sorts by date as plain text.
 * @param {Date} date
 * @returns {string}
 */
function _isoDay(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Collects what the registry needs from one validated submission.
 * submissionDateFormatted is already the report's own date, or the submission
 * date when that could not be read (S-07), so it always parses.
 * @param {Object} data - Output of validateFormData, with reportText.
 * @returns {Object}
 */
function buildReportContext(data) {
  const date = _parseReportDate(data.submissionDateFormatted) || new Date();
  return {
    reportId: data.executionId,
    teacher:  data.teacherName,
    date,
    slot:     `${_isoDay(date)}|${data.sessionType}|${data.halaNum || ''}`,
    session:  data.sessionType,
    halaNum:  data.halaNum || '',
    category: data.studentCategory,
    minutes:  (data.durationHours || 0) * 60 + (data.durationMinutes || 0),
    students: parseStudentBlocks(data.reportText),
  };
}

/**
 * Derives the counted columns from a student's slots, so a late report
 * recomputes them instead of patching them.
 * @param {Object<string, Array>} slots - slot key → [category, repeats, medal 0|1].
 * @returns {{ attendance: number, firstSeen: Date|null, lastSeen: Date|null, category: string, repeats: number, medals: number }}
 */
function deriveStudentStats(slots) {
  const keys = Object.keys(slots || {}).sort();
  const catCount = {};
  const catLatest = {};
  let repeats = 0;
  let medals = 0;

  keys.forEach((k, i) => {
    const [cat, r, m] = slots[k];
    catCount[cat] = (catCount[cat] || 0) + 1;
    catLatest[cat] = i;
    repeats += r;
    medals += m;
  });

  // Majority category; on a tie, the one seen in the latest slot (S-10).
  const category = Object.keys(catCount).sort((a, b) =>
    (catCount[b] - catCount[a]) || (catLatest[b] - catLatest[a]))[0] || '';
  const dayOf = k => {
    const [y, m, d] = k.split('|')[0].split('-').map(Number);
    return new Date(y, m - 1, d);
  };

  return {
    attendance: keys.length,
    firstSeen:  keys.length ? dayOf(keys[0]) : null,
    lastSeen:   keys.length ? dayOf(keys[keys.length - 1]) : null,
    category,
    repeats,
    medals,
  };
}

/**
 * Applies one report to a teacher's students (S-05): a slot already stored for
 * a student adds nothing, so a resubmitted report changes no count.
 * Does not mutate its input (CQS).
 * @param {Array<Object>} students - Records as returned by rowToStudent.
 * @param {Object} report - From buildReportContext.
 * @returns {{ students: Array<Object>, newStudents: string[], counted: number }}
 */
function applyReportToStudents(students, report) {
  const byKey = {};
  const result = (students || []).map(s => {
    const copy = _cloneStudent(s);
    byKey[copy.key] = copy;
    return copy;
  });
  const newStudents = [];
  let counted = 0;

  _mergeSameNameBlocks(report).forEach(block => {
    let student = byKey[block.key];
    if (!student) {
      // Gender is written only here, at creation; afterwards it belongs to the admin (S-11).
      student = {
        key: block.key, name: block.display, gender: block.gender, slots: {},
        firstHifz: '', firstHifzDate: null, lastHifz: '', lastHifzDate: null, extra: [],
      };
      byKey[block.key] = student;
      result.push(student);
      newStudents.push(block.display);
    }
    if (student.slots[report.slot]) return;

    student.slots[report.slot] = [report.category, block.repeats, block.medal ? 1 : 0];
    counted++;
    if (block.hifz) _recordHifz(student, block.hifz, report.date);
  });

  return { students: sortStudentsByLastSeen(result), newStudents, counted };
}

/**
 * Folds blocks that share one key within a single report (S-13).
 * @param {Object} report
 * @returns {Array<Object>}
 */
function _mergeSameNameBlocks(report) {
  const merged = {};
  const order = [];
  report.students.forEach(b => {
    const display = cleanStudentName(b.name);
    const key = studentNameKey(display);
    if (!key) return;
    if (!merged[key]) {
      merged[key] = { key, display, gender: b.gender, hifz: '', repeats: 0, medal: false };
      order.push(key);
    }
    const m = merged[key];
    m.repeats += b.repeats;
    m.medal = m.medal || b.medal;
    m.hifz = m.hifz || b.hifz;
  });
  return order.map(k => merged[k]);
}

/**
 * First and last non-empty memorization by halaqa date (S-08). A halaqa with
 * no memorization never clears the last one.
 * @param {Object} student - Mutated; callers pass their own copy.
 * @param {string} hifz
 * @param {Date} date
 */
function _recordHifz(student, hifz, date) {
  if (!student.firstHifzDate || date < student.firstHifzDate) {
    student.firstHifz = hifz;
    student.firstHifzDate = date;
  }
  if (!student.lastHifzDate || date >= student.lastHifzDate) {
    student.lastHifz = hifz;
    student.lastHifzDate = date;
  }
}

// ============================================================================
// 5. ROWS, SORTING & CLONING
// ============================================================================

/**
 * Newest attendance first (S-09); a row carries its admin cells with it.
 * @param {Array<Object>} students
 * @returns {Array<Object>} A new sorted array.
 */
function sortStudentsByLastSeen(students) {
  const last = s => {
    const keys = Object.keys(s.slots).sort();
    return keys.length ? keys[keys.length - 1].split('|')[0] : '';
  };
  return students.slice().sort((a, b) => (last(b) > last(a) ? 1 : last(b) < last(a) ? -1 : 0));
}

/**
 * A student record as the A–M values of a teacher tab, then the admin cells.
 * @param {Object} s
 * @returns {Array}
 */
function studentToRow(s) {
  const st = deriveStudentStats(s.slots);
  return [
    sheetText(s.name), s.gender, st.category, st.firstSeen, st.lastSeen, st.attendance,
    sheetText(s.firstHifz), s.firstHifzDate || '', sheetText(s.lastHifz), s.lastHifzDate || '',
    st.repeats, st.medals, JSON.stringify({ key: s.key, slots: s.slots }),
  ].concat(s.extra || []);
}

/**
 * Reads a teacher-tab row back into a record. The key and slots come from
 * column M, so an admin who corrects the spelling in column A does not split
 * the student into two rows.
 * @param {Array} row
 * @returns {Object|null} null for a row without valid system data.
 */
function rowToStudent(row) {
  let meta;
  try { meta = JSON.parse(row[STUDENT_SYSTEM_COLUMNS - 1]); }
  catch (e) { return null; }
  if (!meta || !meta.key || !meta.slots) return null;
  const asDate = v => (v instanceof Date ? v : null);
  return {
    key:           meta.key,
    name:          cleanStudentName(row[0]),
    gender:        row[1],
    slots:         meta.slots,
    firstHifz:     row[6] || '',
    firstHifzDate: asDate(row[7]),
    lastHifz:      row[8] || '',
    lastHifzDate:  asDate(row[9]),
    extra:         row.slice(STUDENT_SYSTEM_COLUMNS),
  };
}

/**
 * Deep enough copy for the pure functions above.
 * @param {Object} s
 * @returns {Object}
 */
function _cloneStudent(s) {
  const slots = {};
  Object.keys(s.slots).forEach(k => { slots[k] = s.slots[k].slice(); });
  return Object.assign({}, s, { slots, extra: (s.extra || []).slice() });
}

/**
 * Reads «سجل التعديلات» values, newest first, as plain objects for the page.
 * @param {Array<Array>} values
 * @param {number} [limit]
 * @returns {Array<{time: string, name: string, action: string, details: string}>}
 */
function rowsToEditLog(values, limit) {
  const pad = n => String(n).padStart(2, '0');
  const stamp = d => (d instanceof Date ? `${_isoDay(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}` : String(d || ''));
  return (values || []).filter(v => v[1] || v[2])
    .map(v => ({ time: stamp(v[0]), name: String(v[1] || ''), action: String(v[2] || ''), details: String(v[3] || '') }))
    .reverse().slice(0, limit || 200);
}

/**
 * Reads «أسعار الساعة» values into teacher tab name → rate (S-34); a blank or
 * non-positive cell is no rate.
 * @param {Array<Array>} values
 * @returns {Object<string, number>}
 */
function readRates(values) {
  const out = {};
  (values || []).forEach(v => {
    const teacher = String(v[0] || '').trim();
    const rate = Number(v[1]);
    if (teacher && rate > 0) out[_teacherTabName(teacher)] = rate;
  });
  return out;
}

// ============================================================================
// 6. REGISTRY SPREADSHEET (M2)
// ============================================================================

const REGISTRY = {
  FILE_PREFIX:  'طلاب أكاديمية سنا',
  // No longer written (2026-11-01); kept so registries that have it do not list it as a teacher tab.
  ALIASES_TAB:  'الأسماء البديلة',
  EXPENSES_TAB: 'المصروفات',
  // No longer written (S-53); kept so registries that have it do not list it as a teacher tab.
  HALAQAT_TAB:  'الحلقات',
  // Kept only so registries made before S-48 do not list it as a teacher tab.
  RATES_TAB:    'أسعار الساعة',
  LOG_TAB:      'سجل التعديلات',
  HONORS_TAB:   'التكريمات',
  DATE_FORMAT:  'dd-mm-yyyy',
  STUDENT_HEADERS: [
    'اسم الطالب', 'الجنس', 'فئة الطلاب', 'أول ظهور', 'آخر ظهور', 'عدد مرات الحضور',
    'أول حفظ جديد', 'تاريخ أول حفظ', 'آخر حفظ جديد', 'تاريخ آخر حفظ',
    'مرات الإعادة', 'عدد الأوسمة', 'بيانات النظام',
  ],
  EXPENSE_HEADERS: ['الشهر', 'المبلغ', 'العملة'],
  LOG_HEADERS:     ['الوقت', 'الاسم', 'الفعل', 'التفاصيل'],
};

/** Columns of a teacher tab that hold dates (1-based): D, E, H, J. */
const STUDENT_DATE_COLUMNS = [4, 5, 8, 10];

/**
 * Records one report in the registry, inside the submission lock.
 * @param {GoogleAppsScript.Drive.Folder} yearFolder
 * @param {Object} data - Validated data.
 * @returns {{ newStudents: string[], counted: number }}
 */
function recordStudents(yearFolder, data) {
  const report = buildReportContext(data);
  const ss = getOrCreateRegistry(yearFolder, data.submissionYear);
  const sheet = _getOrCreateTeacherTab(ss, report.teacher);
  _ensureDetailColumns(sheet);
  const current = readStudentsTab(sheet);

  const result = applyReportToStudents(current.students, report);
  const known = new Set(current.students.map(s => s.key));
  const created = result.students.filter(s => !known.has(s.key));
  if (created.length) _carryDetailsFromLastYear(sheet, created, report.teacher, data.submissionYear);
  writeStudentsTab(sheet, result.students, current.orphans);
  return {
    newStudents: result.newStudents,
    counted:     result.counted,
  };
}

/**
 * A student's first row of a new year takes their birth year and phone from
 * last year's registry, same teacher and key (S-33). Mutates `created`, which
 * are the caller's own fresh records.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {Array<Object>} created
 * @param {string} teacher
 * @param {string} year
 */
function _carryDetailsFromLastYear(sheet, created, teacher, year) {
  const previous = _findRegistry(String(Number(year) - 1));
  const lastTab = previous && previous.getSheetByName(_teacherTabName(teacher));
  if (!lastTab) return;
  const lastCols = studentDetailColumns(_headerRow(lastTab));
  const lastByKey = {};
  readStudentsTab(lastTab).students.forEach(s => { lastByKey[s.key] = s; });
  const cols = studentDetailColumns(_headerRow(sheet));
  created.forEach(s => {
    const old = lastByKey[s.key];
    if (old) s.extra = copyStudentDetails(old.extra, lastCols, s.extra, cols);
  });
}

// ============================================================================
// 6-أ. STUDENT DETAILS: birth year and phone (S-32)
// ============================================================================

const STUDENT_DETAIL_HEADERS = { birthYear: 'سنة الميلاد', phone: 'رقم الهاتف' };

/**
 * Where the detail columns sit among the admin cells (0-based index into a
 * record's `extra`), found by header text, so other admin columns may come
 * before or after them.
 * @param {Array} headerRow
 * @returns {{ birthYear: number, phone: number }} -1 when a column is missing.
 */
function studentDetailColumns(headerRow) {
  const admin = (headerRow || []).slice(STUDENT_SYSTEM_COLUMNS).map(v => String(v).trim());
  return {
    birthYear: admin.indexOf(STUDENT_DETAIL_HEADERS.birthYear),
    phone:     admin.indexOf(STUDENT_DETAIL_HEADERS.phone),
  };
}

/**
 * Copies birth year and phone from one record's admin cells into another's,
 * leaving every other admin cell alone.
 * @param {Array} fromExtra
 * @param {{birthYear: number, phone: number}} fromCols
 * @param {Array} toExtra
 * @param {{birthYear: number, phone: number}} toCols
 * @returns {Array} New admin cells.
 */
function copyStudentDetails(fromExtra, fromCols, toExtra, toCols) {
  const out = (toExtra || []).slice();
  ['birthYear', 'phone'].forEach(f => {
    if (fromCols[f] < 0 || toCols[f] < 0) return;
    const v = (fromExtra || [])[fromCols[f]];
    if (v === '' || v === undefined || v === null) return;
    while (out.length <= toCols[f]) out.push('');
    out[toCols[f]] = v;
  });
  return out;
}

/**
 * A birth year as a number, or '' to clear it.
 * @param {*} value
 * @param {Date} today
 * @returns {number|string}
 */
function normalizeBirthYear(value, today) {
  const clean = normalizeDigitsAndText(String(value === undefined || value === null ? '' : value)).trim();
  if (!clean) return '';
  const year = Number(clean);
  if (!/^\d{4}$/.test(clean) || year < 1930 || year > today.getFullYear()) {
    throw new Error(`سنة الميلاد أربعة أرقام بين 1930 و${today.getFullYear()}.`);
  }
  return year;
}

/**
 * A phone in international form "+<digits>", or '' to clear it. Spaces,
 * dashes and brackets are dropped; "00" in front becomes "+".
 * @param {*} value
 * @returns {string}
 */
function normalizePhone(value) {
  let clean = normalizeDigitsAndText(String(value === undefined || value === null ? '' : value))
    .replace(/[\s\-().‎‏]/g, '');
  if (!clean) return '';
  if (clean.indexOf('00') === 0) clean = '+' + clean.substring(2);
  if (!/^\+\d{8,15}$/.test(clean)) {
    throw new Error('اكتب الهاتف بمفتاح الدولة، مثل +201001234567، من 8 إلى 15 رقماً.');
  }
  return clean;
}

/**
 * The age a student reaches this year, from the birth year.
 * @param {*} birthYear
 * @param {Date} today
 * @returns {number|string} '' when unknown.
 */
function ageFromBirthYear(birthYear, today) {
  const y = Number(birthYear);
  return y ? today.getFullYear() - y : '';
}

/**
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @returns {Array}
 */
function _headerRow(sheet) {
  const lastCol = sheet.getLastColumn();
  return lastCol ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
}

/**
 * Adds the detail headers to a tab that lacks them (tabs made before S-32),
 * after the last column, so existing admin columns keep their place.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @returns {{ birthYear: number, phone: number }}
 */
function _ensureDetailColumns(sheet) {
  const header = _headerRow(sheet);
  let width = Math.max(header.length, STUDENT_SYSTEM_COLUMNS);
  const cols = studentDetailColumns(header);
  ['birthYear', 'phone'].forEach(f => {
    if (cols[f] !== -1) return;
    width++;
    sheet.getRange(1, width).setValue(STUDENT_DETAIL_HEADERS[f]).setFontWeight('bold');
  });
  return studentDetailColumns(_headerRow(sheet));
}

/**
 * Saves the name, gender, birth year and phone of the students changed on the
 * page (U-03), each found by key in column M. Only the fields that differ from
 * the sheet are checked and written, all checked before any is written, and
 * each teacher tab is read once. Empty details clear the cell.
 * A new name takes a new key, so later reports in that spelling join the row;
 * one that matches another student of the teacher is refused, as nothing is
 * merged (2026-11-01).
 * @param {Array<{teacher: string, key: string, name: string, gender: string, birthYear: *, phone: *}>} list
 * @param {string} [year]
 * @returns {Array<{teacher: string, name: string, oldName: string, gender: string,
 *   birthYear: number|string, phone: string}>}
 */
function saveStudentsDetails(list, year) {
  if (!list.length) throw new Error('لا طالب تغيّر ليُحفظ.');
  const today = new Date();
  return _withScriptLock(() => {
    const ss = _registryOrThrow(year);
    const tabs = {};
    const saved = list.map(item => {
      let tab = tabs[item.teacher];
      if (!tab) {
        const sheet = ss.getSheetByName(_teacherTabName(item.teacher));
        if (!sheet) throw new Error(`لا تبويب للمعلم «${item.teacher}» في السجل.`);
        const body = _readBody(sheet);
        tab = tabs[item.teacher] = { sheet, body, students: body.map(rowToStudent), cols: studentDetailColumns(_headerRow(sheet)) };
      }
      const index = tab.students.findIndex(st => st && st.key === item.key);
      if (index === -1) throw new Error('لم يوجد الطالب؛ لعل اسمه صُحّح من جهاز آخر. حدّث الصفحة.');
      const oldName = tab.students[index].name;
      let name = oldName;
      const row = tab.body[index];
      const text = v => String(v === undefined || v === null ? '' : v).trim();
      const cell = f => (tab.cols[f] === -1 ? '' : text(row[STUDENT_SYSTEM_COLUMNS + tab.cols[f]]));
      // Only what the admin changed is checked and written: an old cell typed by
      // hand must not refuse the save of another field.
      const change = {};
      try {
        const typed = cleanStudentName(item.name);
        if (item.name !== undefined && typed !== oldName) {
          if (!studentNameKey(typed)) throw new Error('اكتب الاسم.');
          change.name = typed;
          change.key = studentNameKey(typed);
          name = typed;
        }
        if (text(item.gender) !== text(row[1])) {
          if (item.gender !== STUDENT_GENDER.MALE && item.gender !== STUDENT_GENDER.FEMALE) throw new Error('الجنس ذكر أو أنثى.');
          change.gender = item.gender;
        }
        if (text(item.birthYear) !== cell('birthYear')) change.birthYear = normalizeBirthYear(item.birthYear, today);
        if (text(item.phone) !== cell('phone')) change.phone = normalizePhone(item.phone);
      } catch (error) {
        throw new Error(`${oldName} عند ${item.teacher}: ${error.message}`);
      }
      return {
        teacher: item.teacher, name, oldName, key: item.key, row: index + 2, change,
        gender: 'gender' in change ? change.gender : text(row[1]),
        birthYear: 'birthYear' in change ? change.birthYear : cell('birthYear'),
        phone: 'phone' in change ? change.phone : cell('phone'),
      };
    });
    // Checked for every tab before any write: a new name may not be another student's.
    Object.keys(tabs).forEach(teacher => {
      const mine = saved.filter(s => s.teacher === teacher);
      const finalKeys = tabs[teacher].students.map((st, i) => {
        const s = mine.find(m => m.row === i + 2);
        return s && s.change.key ? s.change.key : st && st.key;
      });
      mine.filter(s => s.change.key).forEach(s => {
        if (finalKeys.filter(k => k === s.change.key).length > 1) {
          throw new Error(`الاسم «${s.name}» لطالب آخر عند ${teacher}، ولا دمج بين الطلاب.`);
        }
      });
    });
    Object.keys(tabs).forEach(teacher => {
      const sheet = tabs[teacher].sheet;
      const mine = saved.filter(s => s.teacher === teacher);
      const cols = mine.some(s => 'birthYear' in s.change || 'phone' in s.change) ? _ensureDetailColumns(sheet) : null;
      mine.forEach(s => {
        if ('name' in s.change) {
          const meta = JSON.parse(tabs[teacher].body[s.row - 2][STUDENT_SYSTEM_COLUMNS - 1]);
          meta.key = s.change.key;
          sheet.getRange(s.row, 1).setValue(sheetText(s.name));
          sheet.getRange(s.row, STUDENT_SYSTEM_COLUMNS).setValue(JSON.stringify(meta));
          moveHonorsToKey(ss, sheet.getName(), s.key, s.name);
        }
        if ('gender' in s.change) sheet.getRange(s.row, 2).setValue(s.gender);
        if ('birthYear' in s.change) sheet.getRange(s.row, STUDENT_SYSTEM_COLUMNS + 1 + cols.birthYear).setValue(s.birthYear);
        // Text, or Sheets reads "+20…" as a number and drops the plus sign.
        if ('phone' in s.change) sheet.getRange(s.row, STUDENT_SYSTEM_COLUMNS + 1 + cols.phone).setNumberFormat('@').setValue(s.phone);
      });
    });
    return saved.map(({ teacher, name, oldName, gender, birthYear, phone }) =>
      ({ teacher, name, oldName, gender, birthYear, phone }));
  });
}

/**
 * Non-fatal wrapper used by the pipeline: the report is already saved, so a
 * registry failure is logged to Drive and the run goes on.
 * @param {GoogleAppsScript.Drive.Folder} yearFolder
 * @param {Object} data
 * @param {string} executionId
 * @param {Date} startTime
 * @returns {{ newStudents: string[], counted: number }|null}
 */
function recordStudentsSafely(yearFolder, data, executionId, startTime) {
  try {
    return recordStudents(yearFolder, data);
  } catch (error) {
    console.error(`[REGISTRY WARNING] [ExecutionID: ${executionId}]`, error.message);
    _safeLogToDrive(executionId, startTime, `Students registry failed: ${error.message}`, error.stack);
    return null;
  }
}

/**
 * Opens the year's registry, creating it with its tabs on first use.
 * @param {GoogleAppsScript.Drive.Folder} yearFolder
 * @param {string} year
 * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet}
 */
function getOrCreateRegistry(yearFolder, year) {
  const title = `${REGISTRY.FILE_PREFIX} ${year}`;
  const existing = _firstNotTrashed(yearFolder.getFilesByName(title));
  if (existing) return SpreadsheetApp.openById(existing.getId());

  const ss = SpreadsheetApp.create(title);
  DriveApp.getFileById(ss.getId()).moveTo(yearFolder);
  const first = ss.getSheets()[0];
  first.setName(REGISTRY.EXPENSES_TAB);
  _styleHeader(first, REGISTRY.EXPENSE_HEADERS);
  return ss;
}

// ============================================================================
// 6-ب. HOURLY RATES FILE (S-48)
// ============================================================================

/**
 * Rates and their log live outside the shared academy folder, in the owner's
 * own Drive, so whoever was given the folder cannot open them. One rate per
 * teacher for every year.
 */
const RATES_FILE = {
  NAME:        'أسعار ساعات معلمي سنا',
  RATES_TAB:   'أسعار الساعة',
  LOG_TAB:     'سجل الأسعار',
  FIXED_TAB:   'المصروفات الثابتة',
  HEADERS:     ['المعلم', 'السعر'],
  LOG_HEADERS: ['الوقت', 'الاسم', 'الفعل', 'التفاصيل'],
  FIXED_HEADERS: ['البند', 'المبلغ'],
};

/** My Drive of the owner, or the test folder while testing. */
function _ratesFolder() {
  return _TEST_MODE ? getRootFolder() : DriveApp.getRootFolder();
}

/** @returns {GoogleAppsScript.Spreadsheet.Spreadsheet|null} */
function _findRatesFile() {
  const file = _firstNotTrashed(_ratesFolder().getFilesByName(RATES_FILE.NAME));
  return file ? SpreadsheetApp.openById(file.getId()) : null;
}

/** @returns {GoogleAppsScript.Spreadsheet.Spreadsheet} */
function _getOrCreateRatesFile() {
  const existing = _findRatesFile();
  if (existing) return existing;
  // A new spreadsheet is born in My Drive root, which is the live home already;
  // the tabs come first, so a failed move never leaves a half-built file.
  const ss = SpreadsheetApp.create(RATES_FILE.NAME);
  const first = ss.getSheets()[0];
  first.setName(RATES_FILE.RATES_TAB);
  _styleHeader(first, RATES_FILE.HEADERS);
  _styleHeader(ss.insertSheet(RATES_FILE.LOG_TAB), RATES_FILE.LOG_HEADERS);
  if (_TEST_MODE) DriveApp.getFileById(ss.getId()).moveTo(_ratesFolder());
  return ss;
}

/** «أسعار الساعة» values, or [] before the first rate is saved. */
function readRateRows() {
  const ss = _findRatesFile();
  return ss ? _readBody(ss.getSheetByName(RATES_FILE.RATES_TAB)) : [];
}

/** «سجل الأسعار» values, or []. */
function readRateLogRows() {
  const ss = _findRatesFile();
  return ss ? _readBody(ss.getSheetByName(RATES_FILE.LOG_TAB)) : [];
}

/** «المصروفات الثابتة» values (S-51), or [] before the first is saved. */
function readFixedRows() {
  const ss = _findRatesFile();
  const sheet = ss && ss.getSheetByName(RATES_FILE.FIXED_TAB);
  return sheet ? _readBody(sheet) : [];
}

/**
 * Writes [key, value] rows into a two-column tab: a key's existing row is
 * updated, a new key is appended.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {Array<Array>} rows
 */
function _upsertRows(sheet, rows) {
  const keys = _readBody(sheet).map(r => String(r[0]).trim());
  rows.forEach(([key, value]) => {
    let index = keys.indexOf(key);
    if (index === -1) index = keys.push(key) - 1;
    sheet.getRange(index + 2, 1, 1, 2).setValues([[key, value]]);
  });
}

/**
 * The fixed monthly expenses (S-51); each counts in every open month from
 * PUBLIC_STATS.PAY_FROM. A blank amount clears it.
 * @param {Array<{item: string, amount: *}>} list - Items of PUBLIC_STATS.FIXED_ITEMS.
 * @returns {Array<[string, number]>}
 */
function _fixedRows(list) {
  return list.map(({ item, amount }) => {
    if (PUBLIC_STATS.FIXED_ITEMS.indexOf(item) === -1) throw new Error(`لا بند ثابت باسم «${item}».`);
    const text = normalizeDigitsAndText(String(amount === undefined ? '' : amount)).trim();
    const value = text === '' ? 0 : Number(text);
    if (!(value >= 0)) throw new Error(`مبلغ «${item}» رقم لا يقل عن صفر.`);
    return [item, Math.round(value * 100) / 100];
  });
}

/** Writes checked fixed expenses. Inside the lock. */
function _writeFixed(rows) {
  const ss = _getOrCreateRatesFile();
  let sheet = ss.getSheetByName(RATES_FILE.FIXED_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(RATES_FILE.FIXED_TAB);
    _styleHeader(sheet, RATES_FILE.FIXED_HEADERS);
  }
  _upsertRows(sheet, rows);
}

/**
 * @param {string} name - As typed by the admin at login.
 * @param {string} action
 * @param {string} details
 */
function appendRateLog(name, action, details) {
  const sheet = _getOrCreateRatesFile().getSheetByName(RATES_FILE.LOG_TAB);
  sheet.appendRow([new Date(), name, action, details]);
  sheet.getRange(sheet.getLastRow(), 1).setNumberFormat('dd-mm-yyyy hh:mm');
}

/**
 * Adds one row to the hidden «سجل التعديلات» of a year's registry (S-44),
 * creating the tab on first use.
 * @param {string} year
 * @param {string} name - As typed by the admin at login.
 * @param {string} action
 * @param {string} details
 */
function appendEditLog(year, name, action, details) {
  const ss = _registryOrThrow(year);
  let sheet = ss.getSheetByName(REGISTRY.LOG_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(REGISTRY.LOG_TAB);
    _styleHeader(sheet, REGISTRY.LOG_HEADERS);
    sheet.hideSheet();
  }
  sheet.appendRow([new Date(), name, action, details]);
  sheet.getRange(sheet.getLastRow(), 1).setNumberFormat('dd-mm-yyyy hh:mm');
}

/**
 * The registry's teacher tabs: every tab but the reserved ones.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @returns {GoogleAppsScript.Spreadsheet.Sheet[]}
 */
function registryTeacherSheets(ss) {
  const reserved = [REGISTRY.ALIASES_TAB, REGISTRY.EXPENSES_TAB, REGISTRY.HALAQAT_TAB, REGISTRY.RATES_TAB,
    REGISTRY.LOG_TAB, REGISTRY.HONORS_TAB];
  return ss.getSheets().filter(sh => reserved.indexOf(sh.getName()) === -1);
}

/**
 * The registry of a year, or null when it does not exist yet.
 * @param {string} year
 * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet|null}
 */
function _findRegistry(year) {
  const root = _findRootFolder();
  const yearFolder = root && _firstNotTrashed(root.getFoldersByName(sanitizeFilename(year)));
  if (!yearFolder) return null;
  const file = _firstNotTrashed(yearFolder.getFilesByName(`${REGISTRY.FILE_PREFIX} ${year}`));
  return file ? SpreadsheetApp.openById(file.getId()) : null;
}

/**
 * The root folder without ever creating one. getRootFolder() creates a root
 * when its name search finds none, which is right for the owner's pipeline but
 * would plant an empty folder in a dashboard visitor's Drive.
 * @returns {GoogleAppsScript.Drive.Folder|null}
 */
function _findRootFolder() {
  return getRootFolder(false);
}

/**
 * Sheet names may not contain : \ / ? * [ ].
 * @param {string} teacher
 * @returns {string}
 */
function _teacherTabName(teacher) {
  return String(teacher || CONFIG.FALLBACKS.TEACHER_NAME).replace(/[:\\\/?*\[\]]/g, '_').substring(0, 100);
}

/**
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {string} teacher
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function _getOrCreateTeacherTab(ss, teacher) {
  const name = _teacherTabName(teacher);
  const existing = ss.getSheetByName(name);
  if (existing) return existing;
  const sheet = ss.insertSheet(name, 0);
  _styleHeader(sheet, REGISTRY.STUDENT_HEADERS.concat(
    [STUDENT_DETAIL_HEADERS.birthYear, STUDENT_DETAIL_HEADERS.phone]));
  sheet.hideColumns(STUDENT_SYSTEM_COLUMNS);
  return sheet;
}

/**
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {string[]} headers
 */
function _styleHeader(sheet, headers) {
  sheet.setRightToLeft(true);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sheet.setFrozenRows(1);
}

/**
 * All rows below the header, as one batch read.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @returns {Array<Array>}
 */
function _readBody(sheet) {
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  return sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
}

/**
 * Reads a teacher tab. Rows without valid system data in column M (for
 * example a row the admin typed by hand) are kept aside and written back, so
 * a rewrite never loses them.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @returns {{ students: Array<Object>, orphans: Array<Array> }}
 */
function readStudentsTab(sheet) {
  const students = [];
  const orphans = [];
  _readBody(sheet).forEach(row => {
    if (row.every(v => v === '' || v === null)) return;
    const s = rowToStudent(row);
    if (s) students.push(s); else orphans.push(row);
  });
  return { students, orphans };
}

/**
 * Rewrites a teacher tab below the header in one batch, sorted, with the
 * orphan rows last. Admin header cells after column M are left as they are.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {Array<Object>} students
 * @param {Array<Array>} orphans
 */
function writeStudentsTab(sheet, students, orphans) {
  const rows = sortStudentsByLastSeen(students).map(studentToRow).concat(orphans || []);
  const width = Math.max(STUDENT_SYSTEM_COLUMNS, sheet.getLastColumn(), ...rows.map(r => r.length));
  const padded = rows.map(r => r.concat(new Array(width - r.length).fill('')));

  // Written over the old rows, never cleared first, so a failed write never
  // leaves the tab empty (F-01). The list only grows, as nothing merges rows.
  if (padded.length) {
    sheet.getRange(2, 1, padded.length, width).setValues(padded);
    STUDENT_DATE_COLUMNS.forEach(c => sheet.getRange(2, c, padded.length, 1).setNumberFormat(REGISTRY.DATE_FORMAT));
  }
}

// ============================================================================
// 7. ADMIN WRITES (called by the dashboard in M5, and by the nightly trigger)
// ============================================================================

/**
 * Runs fn under the script lock that the submission pipeline also takes, so a
 * dashboard write and an incoming report never interleave.
 * @param {Function} fn
 * @returns {*}
 */
function _withScriptLock(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.LOCK_TIMEOUT_MS)) {
    throw new Error('النظام مشغول بتقرير آخر الآن؛ أعد المحاولة بعد دقيقة.');
  }
  try { return fn(); }
  finally { lock.releaseLock(); }
}

/**
 * Saves what the pay section changed in one go (U-02): the hourly rates, the
 * fixed expenses and the honor amount in the rates file (S-48), and a month's
 * other expenses in the registry. Every value is checked before any is
 * written, under one lock.
 * @param {{rates: Array<{teacher: string, rate: *}>, fixed: Array<{item: string, amount: *}>, honorAmount: *,
 *   expense: ?{month: string, amount: *}}} change - A blank expense amount is no change.
 * @param {string} [year]
 * @param {Date} today
 * @returns {{rates: Array, fixed: Array, honor: ?{from: string, amount: number},
 *   expense: ?{month: string, amount: number}}} What was written.
 */
function savePay(change, year, today) {
  const rates = _rateRows(change.rates || []);
  const fixed = _fixedRows(change.fixed || []);
  const amount = String(change.honorAmount === undefined ? '' : change.honorAmount).trim();
  const honor = amount === '' ? null : _honorAmountRow(amount, today);
  const e = change.expense;
  const expense = e && String(e.amount === undefined ? '' : e.amount).trim() !== '' ? _expenseRow(e.month, e.amount) : null;
  if (!rates.length && !fixed.length && !honor && !expense) throw new Error('لا شيء تغيّر ليُحفظ.');
  return _withScriptLock(() => {
    // Rates first: an unknown teacher is refused before anything is written.
    if (rates.length) _writeRates(rates, year);
    if (fixed.length) _writeFixed(fixed);
    if (honor) _writeHonorAmount(honor);
    if (expense) _writeExpense(expense);
    return { rates, fixed, honor, expense };
  });
}

/**
 * Teachers' hourly rates in pounds (S-34): the one rate prices every open month.
 * @param {Array<{teacher: string, rate: *}>} list - Teacher tab names.
 * @returns {Array<[string, number]>}
 */
function _rateRows(list) {
  return list.map(({ teacher, rate }) => {
    const value = Number(normalizeDigitsAndText(String(rate)).trim());
    if (!(value > 0)) throw new Error(`سعر ساعة «${teacher}» رقم أكبر من صفر.`);
    return [teacher, Math.round(value * 100) / 100];
  });
}

/** Writes checked rates, updating a teacher's row or appending it. Inside the lock. */
function _writeRates(rows, year) {
  const ss = _registryOrThrow(year);
  const y = String(year || new Date().getFullYear());
  const known = new Set(academyTeachers(ss, readTeacherSheetReports(y)).map(t => t.name));
  rows.forEach(([teacher]) => {
    if (!known.has(teacher)) throw new Error(`لا معلم باسم «${teacher}».`);
  });
  _upsertRows(_getOrCreateRatesFile().getSheetByName(RATES_FILE.RATES_TAB), rows);
}

/**
 * @param {string} [year]
 * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet}
 */
function _registryOrThrow(year) {
  const ss = _findRegistry(String(year || new Date().getFullYear()));
  if (!ss) throw new Error('لم يُنشأ سجل الطلاب لهذه السنة بعد.');
  return ss;
}
