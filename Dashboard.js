/**
 * ============================================================================
 * Dashboard.js — Admin dashboard data and writes (M5, S-38)
 * ============================================================================
 * The page is served from GitHub Pages and reaches these functions only through
 * doPost in Api.js, after the password check. They run as the script owner.
 * It shows everything and writes: aliases (S-12), expenses
 * (S-25), gender (S-11), birth year with phone (S-32), hourly rates (S-34),
 * report rows (S-59) and honors (S-60).
 * Teachers' pay is shown here and nowhere else (S-35). Dates leave as
 * "yyyy-mm-dd" strings, because the page reads JSON.
 * ============================================================================
 */

const DASHBOARD = {
  NEW_DAYS:    14,
};

// ============================================================================
// 1. PURE SHAPING (unit-tested)
// ============================================================================

/** "yyyy-mm-dd", or '' for a missing date. */
function _dayOrBlank(value) {
  return value instanceof Date ? _isoDay(value) : '';
}

/**
 * Turns registry contents into the plain object the page renders. Teacher
 * codes in the statistics become names again: the dashboard is private.
 * @param {Object} input
 * @param {string} input.year
 * @param {Array<{name: string, code: string, students: Array<Object>}>} input.teachers
 * @param {Array<Array>} input.expenses
 * @param {Array<Array>} [input.rates] - «أسعار الساعة» values.
 * @param {Array<Array>} [input.log]   - «سجل التعديلات» values.
 * @param {Array<Array>} [input.rateLog] - «سجل الأسعار» values.
 * @param {Array<Object>} [input.sheetReports] - From readTeacherSheetReports.
 * @param {Array<Array>} [input.fixed] - «المصروفات الثابتة» values.
 * @param {Array<Array>} [input.honors] - «التكريمات» values (S-60).
 * @param {Array<Array>} [input.honorAmounts] - «مبلغ التكريم» values; shown with the pay only.
 * @param {boolean} [input.showPay] - Rates and pay leave only for an unlocked session (S-47).
 * @param {Array<Array>} input.aliases - «الأسماء البديلة» values.
 * @param {Date} input.today
 * @returns {Object}
 */
function buildDashboardData(input) {
  const stats = computePublicStats({
    teachers: input.teachers, expenses: input.expenses,
    rates: input.rates, sheetReports: input.sheetReports, fixed: input.fixed,
    honors: input.honors, honorAmounts: input.honorAmounts,
    today: input.today,
  });
  const honors = readHonors(input.honors);
  const honorCount = {};
  honors.forEach(h => { honorCount[`${h.teacher}|${h.key}`] = (honorCount[`${h.teacher}|${h.key}`] || 0) + 1; });
  const fixed = readFixedExpenses(input.fixed);
  const rates = readRates(input.rates);
  const nameOf = {};
  input.teachers.forEach(t => { nameOf[t.code] = t.name; });
  const named = rows => rows.map(r => {
    const out = r.map(v => (v instanceof Date ? _isoDay(v) : v));
    const col = out.length === PUBLIC_STATS.MONTHLY_HEADERS.length ? 2 : 0;
    if (nameOf[out[col]]) out[col] = nameOf[out[col]];
    return out;
  });
  const newFrom = _isoDay(new Date(input.today.getFullYear(), input.today.getMonth(),
    input.today.getDate() - DASHBOARD.NEW_DAYS));

  return {
    year: input.year,
    today: _isoDay(input.today),
    currency: PUBLIC_STATS.CURRENCY,
    totalsHeaders: PUBLIC_STATS.TOTALS_HEADERS,
    monthlyHeaders: PUBLIC_STATS.MONTHLY_HEADERS,
    totals: named(stats.totals),
    monthly: named(stats.monthly),
    pay: input.showPay ? stats.pay : null,
    rateLog: input.showPay ? rowsToEditLog(input.rateLog) : [],
    unpriced: Array.from(new Set(stats.pay.filter(p => p.pay === '').map(p => p.teacher))).sort(),
    fixed: input.showPay ? PUBLIC_STATS.FIXED_ITEMS.map(item => ({ item, amount: fixed[item] || '' })) : null,
    honorAmount: input.showPay ? honorAmountFor(_monthOf(input.today), readHonorAmounts(input.honorAmounts)) : '',
    // Newest first; the page counts and ranks from these (S-60).
    honors: honors.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.row - a.row)).map(h => ({
      date: h.date, month: h.month, teacher: h.teacher, name: h.name, reason: h.reason, key: h.key, row: h.row,
      editable: !isMonthFrozen(h.month, input.today),
    })),
    teachers: input.teachers.map(t => ({
      name: t.name,
      rate: input.showPay ? (rates[t.name] || '') : '',
      students: sortStudentsByLastSeen(t.students).map(s => {
        const cols = t.detailCols || { birthYear: -1, phone: -1 };
        const birthYear = cols.birthYear >= 0 ? (s.extra[cols.birthYear] || '') : '';
        const st = deriveStudentStats(s.slots);
        const firstSeen = _dayOrBlank(st.firstSeen);
        return {
          key: s.key, name: s.name, gender: s.gender, category: st.category,
          firstSeen, lastSeen: _dayOrBlank(st.lastSeen), attendance: st.attendance,
          lastHifz: s.lastHifz, repeats: st.repeats, medals: st.medals,
          birthYear: birthYear === '' ? '' : Number(birthYear),
          age: ageFromBirthYear(birthYear, input.today),
          phone: cols.phone >= 0 ? String(s.extra[cols.phone] || '') : '',
          honors: honorCount[`${t.name}|${s.key}`] || 0,
          isNew: firstSeen >= newFrom,
        };
      }),
    })).sort((a, b) => (a.name > b.name ? 1 : -1)),
    log: rowsToEditLog(input.log),
    // Every row of the teachers' sheets, as they show them (S-55).
    reports: (input.sheetReports || []).map((r, i) => ({
      teacher: r.teacher, month: r.month, day: _isoDay(r.date), order: i,
      date: r.dateText, session: r.session, link: r.link, category: r.category, duration: r.duration,
      students: r.students, notes: r.notes, minutes: r.minutes, attendance: r.attendance,
      status: isCountedReport(r) ? '' : (r.duplicate ? 'مكرر' : 'لا يُحسب'),
      // Where an edit writes, and whether it may (S-59).
      row: r.row, stamp: r.stamp, editable: !isMonthFrozen(r.month, input.today),
    })),
    aliases: rowsToAliases(input.aliases).map(a => ({
      teacher: a.teacher, from: a.from, to: a.to, applied: a.applied,
    })),
    expenses: (input.expenses || []).map((r, i) => ({
      month: readExpenseMonths([r])[0], amount: Number(r[1]) || 0, currency: String(r[2] || ''), row: i + 2,
    })).filter(e => e.month),
  };
}

/**
 * Plain Arabic for the errors a visitor can cause; anything else keeps its text.
 * @param {Error} error
 * @returns {Error}
 */
function _friendlyError(error) {
  const msg = String(error && error.message || error);
  if (/permission|access denied|not have access|ليس لديك إذن|forbidden/i.test(msg)) {
    return new Error('ليس لك حق التعديل في ملف السجل، أو لم يُشارَك معك. اطلب من مالك الملف صلاحية «محرر».');
  }
  return new Error(msg);
}

// ============================================================================
// 2. CALLS FROM THE API (Api.js)
// ============================================================================

/**
 * Everything the page shows, for one year.
 * @param {string} [year]
 * @param {boolean} [test] - true for the test folder (?test=1).
 * @param {boolean} [fresh] - Read the teachers' sheets again («حدّث التقارير»).
 * @returns {Object}
 */
function getDashboardData(year, test, fresh) {
  return _withMode(test, () => _getDashboardData(year, fresh));
}

/**
 * Runs fn against the test folder when the page was opened with ?test=1, so the
 * dashboard can be tried before install day. Never switches test mode off.
 * @param {boolean} test
 * @param {Function} fn
 * @returns {*}
 */
function _withMode(test, fn) {
  const previous = _TEST_MODE;
  _TEST_MODE = previous || test === true;
  try { return fn(); }
  finally { _TEST_MODE = previous; }
}

/** Pay data is sent only inside _withPay(true). */
let _SHOW_PAY = false;

/**
 * Runs fn with rates and pay shown or hidden (S-47); the API sets it from the session.
 * @param {boolean} show
 * @param {Function} fn
 * @returns {*}
 */
function _withPay(show, fn) {
  const previous = _SHOW_PAY;
  _SHOW_PAY = show === true;
  try { return fn(); }
  finally { _SHOW_PAY = previous; }
}

/**
 * @param {string} [year]
 * @param {boolean} [fresh]
 * @returns {Object}
 */
function _getDashboardData(year, fresh) {
  try {
    const y = String(year || new Date().getFullYear());
    const registry = _findRegistry(y);
    if (!registry) throw new Error(`لا سجل طلاب لسنة ${y} بعد، أو لم يُشارَك معك مجلد الأكاديمية.`);
    const sheetReports = readTeacherSheetReports(y, fresh === true);
    const teachers = academyTeachers(registry, sheetReports);
    return buildDashboardData({
      year: y,
      teachers,
      expenses: _readBody(registry.getSheetByName(REGISTRY.EXPENSES_TAB)),
      rates: readRateRows(),
      sheetReports,
      fixed: readFixedRows(),
      honors: readHonorRows(registry),
      honorAmounts: readHonorAmountRows(),
      rateLog: _SHOW_PAY ? readRateLogRows() : [],
      showPay: _SHOW_PAY,
      log: _readBody(registry.getSheetByName(REGISTRY.LOG_TAB)),
      aliases: _readBody(registry.getSheetByName(REGISTRY.ALIASES_TAB)),
      today: new Date(),
    });
  } catch (error) {
    throw _friendlyError(error);
  }
}

/**
 * @param {{teacher: string, from: string, to: string}} alias
 * @param {string} year
 * @param {boolean} [test] - true for the test folder (?test=1).
 * @returns {Object} { outcome, data }
 */
function dashboardApplyAlias(alias, year, test) {
  return _withMode(test, () => {
    try {
      const result = applyAlias(alias, year);
      return { outcome: result.outcome, data: _getDashboardData(year) };
    } catch (error) {
      throw _friendlyError(error);
    }
  });
}

/**
 * @param {string} teacher
 * @param {string} from
 * @param {string} year
 * @returns {Object} Fresh dashboard data.
 */
function dashboardDeleteAlias(teacher, from, year, test) {
  return _withMode(test, () => {
    try {
      deleteAlias(teacher, from, year);
      return _getDashboardData(year);
    } catch (error) {
      throw _friendlyError(error);
    }
  });
}

/**
 * Saves the students changed on the page in one go (U-03).
 * @param {Array<Object>} list - As saveStudentsDetails.
 * @param {string} year
 * @param {boolean} [test]
 * @returns {Object} { saved, data }
 */
function dashboardSaveStudents(list, year, test) {
  return _withMode(test, () => {
    try {
      const saved = saveStudentsDetails(list, year);
      return { saved, data: _getDashboardData(year) };
    } catch (error) {
      throw _friendlyError(error);
    }
  });
}

/**
 * Edits or erases one report row of a teacher's sheet (S-59).
 * @param {{teacher: string, month: string, row: *, stamp: string}} ref
 * @returns {Object} { before, after?, data }
 */
function dashboardEditReport(ref, change, year, test) {
  return _withMode(test, () => {
    try {
      const result = editTeacherReport(ref, change, year);
      return Object.assign(result, { data: _getDashboardData(year) });
    } catch (error) {
      throw _friendlyError(error);
    }
  });
}

function dashboardDeleteReport(ref, year, test) {
  return _withMode(test, () => {
    try {
      const result = deleteTeacherReport(ref, year);
      return Object.assign(result, { data: _getDashboardData(year) });
    } catch (error) {
      throw _friendlyError(error);
    }
  });
}

/**
 * Adds or removes an honor, or sets its amount (S-60).
 * @returns {Object} { honor?, saved?, data }
 */
function dashboardAddHonor(honor, year, test) {
  return _withMode(test, () => {
    try {
      const result = addHonor(honor, year, new Date());
      return Object.assign(result, { data: _getDashboardData(year) });
    } catch (error) {
      throw _friendlyError(error);
    }
  });
}

function dashboardDeleteHonor(ref, year, test) {
  return _withMode(test, () => {
    try {
      const honor = deleteHonor(ref, year, new Date());
      return { honor, data: _getDashboardData(year) };
    } catch (error) {
      throw _friendlyError(error);
    }
  });
}

/**
 * Saves the pay section in one go (U-02).
 * @param {Object} change - As savePay.
 * @param {string} year
 * @param {boolean} [test]
 * @returns {Object} { saved, data }
 */
function dashboardSavePay(change, year, test) {
  return _withMode(test, () => {
    try {
      const saved = savePay(change, year, new Date());
      return { saved, data: _getDashboardData(year) };
    } catch (error) {
      throw _friendlyError(error);
    }
  });
}

/**
 * @param {string} month
 * @param {number|string} amount - Pounds.
 * @param {string} year
 * @returns {Object} Fresh dashboard data.
 */
function dashboardSaveExpense(month, amount, year, test) {
  return _withMode(test, () => {
    try {
      saveExpense(month, amount);
      return _getDashboardData(year);
    } catch (error) {
      throw _friendlyError(error);
    }
  });
}
