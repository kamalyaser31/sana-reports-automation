/**
 * ============================================================================
 * Dashboard.js — Admin dashboard data and writes (M5, S-38)
 * ============================================================================
 * The page is served from GitHub Pages and reaches these functions only through
 * doPost in Api.js, after the password check. They run as the script owner.
 * It shows everything and writes five things only: aliases (S-12), expenses
 * (S-25), gender (S-11), birth year with phone (S-32), and hourly rates (S-34).
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
 * @param {Array<Object>} [input.sheetHalaqat] - From readTeacherSheetHalaqat.
 * @param {Array<Array>} [input.fixed] - «المصروفات الثابتة» values.
 * @param {boolean} [input.showPay] - Rates and pay leave only for an unlocked session (S-47).
 * @param {Array<Array>} input.aliases - «الأسماء البديلة» values.
 * @param {Date} input.today
 * @returns {Object}
 */
function buildDashboardData(input) {
  const stats = computePublicStats({
    teachers: input.teachers, expenses: input.expenses,
    rates: input.rates, sheetHalaqat: input.sheetHalaqat, fixed: input.fixed,
    today: input.today,
  });
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
    // The rates log keeps no action column; a fixed item's name opens its row (S-51).
    rateLog: input.showPay ? rowsToEditLog((input.rateLog || []).map(r => [r[0], r[1],
      PUBLIC_STATS.FIXED_ITEMS.some(i => String(r[2]).indexOf(`${i}:`) === 0) ? FIXED_LOG_ACTION : RATE_LOG_ACTION, r[2]])) : [],
    unpriced: Array.from(new Set(stats.pay.filter(p => p.pay === '').map(p => p.teacher))).sort(),
    rateTeachers: input.teachers.map(t => t.name).sort().map(name => ({ name, rate: input.showPay ? (rates[name] || '') : '' })),
    fixed: input.showPay ? PUBLIC_STATS.FIXED_ITEMS.map(item => ({ item, amount: fixed[item] || '' })) : null,
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
          isNew: firstSeen >= newFrom,
        };
      }),
    })).sort((a, b) => (a.name > b.name ? 1 : -1)),
    // Rate rows written before S-48 stay out of the shared log.
    log: rowsToEditLog((input.log || []).filter(r => r[2] !== RATE_LOG_ACTION)),
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
 * @returns {Object}
 */
function getDashboardData(year, test) {
  return _withMode(test, () => _getDashboardData(year));
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
 * @returns {Object}
 */
function _getDashboardData(year) {
  try {
    const y = String(year || new Date().getFullYear());
    const registry = _findRegistry(y);
    if (!registry) throw new Error(`لا سجل طلاب لسنة ${y} بعد، أو لم يُشارَك معك مجلد الأكاديمية.`);
    const sheetHalaqat = readTeacherSheetHalaqat(y);
    const teachers = academyTeachers(registry, sheetHalaqat);
    return buildDashboardData({
      year: y,
      teachers,
      expenses: _readBody(registry.getSheetByName(REGISTRY.EXPENSES_TAB)),
      rates: readRateRows(),
      sheetHalaqat,
      fixed: readFixedRows(),
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
 * @param {string} teacher
 * @param {string} key
 * @param {string} gender
 * @param {string} year
 * @returns {Object} Fresh dashboard data.
 */
function dashboardSetGender(teacher, key, gender, year, test) {
  return _withMode(test, () => {
    try {
      setStudentGender(teacher, key, gender, year);
      return _getDashboardData(year);
    } catch (error) {
      throw _friendlyError(error);
    }
  });
}

/**
 * Saves a student's birth year and phone (S-32).
 * @param {string} teacher
 * @param {string} key
 * @param {{birthYear: *, phone: *}} details
 * @param {string} year
 * @param {boolean} [test]
 * @returns {Object} Fresh dashboard data.
 */
function dashboardSetDetails(teacher, key, details, year, test) {
  return _withMode(test, () => {
    try {
      setStudentDetails(teacher, key, details, year);
      return _getDashboardData(year);
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

/**
 * Saves the hourly rates typed on the page, in one go (S-34).
 * @param {Array<{teacher: string, rate: *}>} list - Pounds per hour.
 * @param {string} year
 * @param {boolean} [test]
 * @returns {Object} Fresh dashboard data.
 */
function dashboardSaveRates(list, year, test) {
  return _withMode(test, () => {
    try {
      saveTeacherRates(list, year);
      return _getDashboardData(year);
    } catch (error) {
      throw _friendlyError(error);
    }
  });
}

/**
 * Saves the fixed monthly expenses typed on the page, in one go (S-51).
 * @param {Array<{item: string, amount: *}>} list - Pounds; blank clears one.
 * @param {string} year
 * @param {boolean} [test]
 * @returns {Object} Fresh dashboard data.
 */
function dashboardSaveFixedExpenses(list, year, test) {
  return _withMode(test, () => {
    try {
      saveFixedExpenses(list);
      return _getDashboardData(year);
    } catch (error) {
      throw _friendlyError(error);
    }
  });
}
