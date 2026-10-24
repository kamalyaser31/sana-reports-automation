/**
 * ============================================================================
 * Dashboard.js — Admin dashboard web app (M5)
 * ============================================================================
 * Served by doGet() from DashboardPage.html (Apps Script refuses two files named
 * "Dashboard", even of different types) as a Web App deployed with
 * "Execute as: User accessing the web app" and "Who has access: Anyone with
 * Google account" (appsscript.json "webapp"). So every read and write runs with
 * the visitor's own Drive permissions: whoever was not given the academy
 * folders sees nothing, and a viewer cannot write (S-27).
 * It shows everything and writes three things only: aliases (S-12), expenses
 * (S-25) and gender (S-11). Dates cross google.script.run as "yyyy-mm-dd"
 * strings, because Date objects are not allowed there.
 * ============================================================================
 */

const DASHBOARD = {
  TITLE:       'لوحة إدارة أكاديمية سنا',
  NEW_DAYS:    14,
  CURRENCIES:  ['EGP', 'USD', 'EUR', 'SAR', 'AED', 'KWD', 'QAR'],
};

/**
 * @returns {GoogleAppsScript.HTML.HtmlOutput}
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('DashboardPage')
    .setTitle(DASHBOARD.TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

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
 * @param {Array<Array>} input.halaqat
 * @param {Array<Array>} input.expenses
 * @param {Array<Array>} input.aliases - «الأسماء البديلة» values.
 * @param {Array<Array>} input.legacy
 * @param {Date} input.today
 * @returns {Object}
 */
function buildDashboardData(input) {
  const stats = computePublicStats({
    teachers: input.teachers, halaqat: input.halaqat, expenses: input.expenses,
    legacy: input.legacy, today: input.today,
  });
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
    currencies: DASHBOARD.CURRENCIES,
    totalsHeaders: PUBLIC_STATS.TOTALS_HEADERS,
    monthlyHeaders: PUBLIC_STATS.MONTHLY_HEADERS,
    totals: named(stats.totals),
    monthly: named(stats.monthly),
    teachers: input.teachers.map(t => ({
      name: t.name,
      students: sortStudentsByLastSeen(t.students).map(s => {
        const st = deriveStudentStats(s.slots);
        const firstSeen = _dayOrBlank(st.firstSeen);
        return {
          key: s.key, name: s.name, gender: s.gender, category: st.category,
          firstSeen, lastSeen: _dayOrBlank(st.lastSeen), attendance: st.attendance,
          lastHifz: s.lastHifz, repeats: st.repeats, medals: st.medals,
          isNew: firstSeen >= newFrom,
        };
      }),
    })).sort((a, b) => (a.name > b.name ? 1 : -1)),
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
// 2. CALLS FROM THE PAGE (google.script.run)
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

/**
 * @param {string} [year]
 * @returns {Object}
 */
function _getDashboardData(year) {
  try {
    const y = String(year || new Date().getFullYear());
    const registry = _findRegistry(y);
    if (!registry) throw new Error(`لا سجل طلاب لسنة ${y} بعد، أو لم يُشارَك معك مجلد الأكاديمية.`);
    const reserved = [REGISTRY.ALIASES_TAB, REGISTRY.EXPENSES_TAB, REGISTRY.HALAQAT_TAB];
    const teachers = registry.getSheets()
      .filter(sh => reserved.indexOf(sh.getName()) === -1)
      .map(sh => ({
        name: sh.getName(),
        code: _resolveTeacher({ rawTeacherName: sh.getName() }, []).teacherId,
        students: readStudentsTab(sh).students,
      }));
    const publicFile = _findPublicFile(y);
    return buildDashboardData({
      year: y,
      teachers,
      halaqat: _readBody(registry.getSheetByName(REGISTRY.HALAQAT_TAB))
        .map(r => [r[0], r[1], _teacherTabName(r[2])].concat(r.slice(3))),
      expenses: _readBody(registry.getSheetByName(REGISTRY.EXPENSES_TAB)),
      aliases: _readBody(registry.getSheetByName(REGISTRY.ALIASES_TAB)),
      legacy: publicFile ? _readBody(publicFile.getSheetByName(PUBLIC_STATS.LEGACY_TAB)) : [],
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
 * @param {string} month
 * @param {number|string} amount
 * @param {string} currency
 * @param {string} year
 * @returns {Object} Fresh dashboard data.
 */
function dashboardSaveExpense(month, amount, currency, year, test) {
  return _withMode(test, () => {
    try {
      saveExpense(month, amount, currency);
      return _getDashboardData(year);
    } catch (error) {
      throw _friendlyError(error);
    }
  });
}

/**
 * The public statistics file of a year, or null.
 * @param {string} year
 * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet|null}
 */
function _findPublicFile(year) {
  const root = _findRootFolder();
  const yearFolder = root && _firstNotTrashed(root.getFoldersByName(sanitizeFilename(year)));
  const file = yearFolder && _firstNotTrashed(yearFolder.getFilesByName(`${PUBLIC_STATS.FILE_PREFIX} ${year}`));
  return file ? SpreadsheetApp.openById(file.getId()) : null;
}
