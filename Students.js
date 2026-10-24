/**
 * ============================================================================
 * Students.js — Students registry: pure functions (M1)
 * ============================================================================
 * Parses the student blocks of a report, builds the matching key, applies
 * aliases, counts attendance once per halaqa (the "slot" rule), and merges two
 * rows of the same student. Nothing here touches Drive or Sheets, so every
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
// 1. NAME KEY & ALIASES
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
 * The report app's duplicate check uses the same rule, so what merges here is
 * already blocked there.
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

/**
 * Builds a lookup from the «الأسماء البديلة» rows.
 * @param {Array<{teacher: string, from: string, to: string}>} aliases
 * @returns {Object<string, string>} "teacher|fromKey" → correct display name.
 */
function buildAliasMap(aliases) {
  const map = {};
  (aliases || []).forEach(a => {
    const to = cleanStudentName(a.to);
    if (!a.teacher || !to || studentNameKey(a.from) === studentNameKey(to)) return;
    map[`${a.teacher}|${studentNameKey(a.from)}`] = to;
  });
  return map;
}

/**
 * Resolves a reported name through the aliases, following chains (a → b → c).
 * @param {string} teacher
 * @param {string} name
 * @param {Object<string, string>} aliasMap
 * @returns {{ key: string, display: string }}
 */
function resolveStudentName(teacher, name, aliasMap) {
  let display = cleanStudentName(name);
  // A bounded walk, so a cycle written by mistake (a → b → a) cannot hang the run.
  for (let hop = 0; hop < 5; hop++) {
    const next = (aliasMap || {})[`${teacher}|${studentNameKey(display)}`];
    if (!next) break;
    display = next;
  }
  return { key: studentNameKey(display), display };
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
 * Derives the counted columns from a student's slots, so a merge or a late
 * report recomputes them instead of patching them.
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
 * @param {Object<string, string>} aliasMap
 * @returns {{ students: Array<Object>, newStudents: string[], counted: number }}
 */
function applyReportToStudents(students, report, aliasMap) {
  const byKey = {};
  const result = (students || []).map(s => {
    const copy = _cloneStudent(s);
    byKey[copy.key] = copy;
    return copy;
  });
  const newStudents = [];
  let counted = 0;

  _mergeSameNameBlocks(report, aliasMap).forEach(block => {
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
 * Folds blocks that resolve to one key within a single report (S-13).
 * @param {Object} report
 * @param {Object<string, string>} aliasMap
 * @returns {Array<Object>}
 */
function _mergeSameNameBlocks(report, aliasMap) {
  const merged = {};
  const order = [];
  report.students.forEach(b => {
    const { key, display } = resolveStudentName(report.teacher, b.name, aliasMap);
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
// 4. MERGE (aliases)
// ============================================================================

/**
 * Merges the wrong row into the correct one: slots are united, so a halaqa in
 * both rows counts once; gender and admin cells come from the correct row.
 * @param {Object} wrong
 * @param {Object} right
 * @returns {Object}
 */
function mergeStudentRecords(wrong, right) {
  const merged = _cloneStudent(right);
  Object.keys(wrong.slots).forEach(k => {
    if (!merged.slots[k]) merged.slots[k] = wrong.slots[k].slice();
  });
  if (wrong.firstHifzDate && (!merged.firstHifzDate || wrong.firstHifzDate < merged.firstHifzDate)) {
    merged.firstHifz = wrong.firstHifz;
    merged.firstHifzDate = wrong.firstHifzDate;
  }
  if (wrong.lastHifzDate && (!merged.lastHifzDate || wrong.lastHifzDate > merged.lastHifzDate)) {
    merged.lastHifz = wrong.lastHifz;
    merged.lastHifzDate = wrong.lastHifzDate;
  }
  return merged;
}

/**
 * Applies one alias to a teacher's students: merges into the correct row when
 * it exists, otherwise renames the wrong row. A wrong name that is no longer
 * present changes nothing, so applying an alias twice is harmless.
 * @param {Array<Object>} students
 * @param {{from: string, to: string}} alias
 * @returns {{ students: Array<Object>, changed: boolean }}
 */
function applyAliasToStudents(students, alias) {
  const fromKey = studentNameKey(alias.from);
  const toName = cleanStudentName(alias.to);
  const toKey = studentNameKey(toName);
  const wrong = (students || []).find(s => s.key === fromKey);
  if (!wrong || !toKey || fromKey === toKey) {
    return { students: (students || []).map(_cloneStudent), changed: false };
  }

  const right = students.find(s => s.key === toKey);
  const replacement = right
    ? mergeStudentRecords(wrong, right)
    : Object.assign(_cloneStudent(wrong), { key: toKey, name: toName });
  const result = students
    .filter(s => s.key !== fromKey && s.key !== toKey)
    .map(_cloneStudent)
    .concat([replacement]);
  return { students: sortStudentsByLastSeen(result), changed: true };
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
    s.name, s.gender, st.category, st.firstSeen, st.lastSeen, st.attendance,
    s.firstHifz, s.firstHifzDate || '', s.lastHifz, s.lastHifzDate || '',
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
