/**
 * ============================================================================
 * Api.js — The dashboard's JSON API (S-38…S-44)
 * ============================================================================
 * The dashboard page lives on GitHub Pages and talks to this script by POST
 * only. The web app runs as the owner and is open to anyone (appsscript.json
 * "webapp"), so doPost is the one door in: no HtmlService page is served, and
 * no other function can be reached from a browser (S-39). Every action but
 * "login" needs a session token, and every write is logged with the name the
 * admin typed at login (S-44).
 * The page posts with Content-Type text/plain, so the browser sends no CORS
 * preflight, which Apps Script cannot answer (D1).
 * ============================================================================
 */

const API = {
  PASSWORD_KEY:    'DASHBOARD_PASSWORD',
  SESSION_SECONDS: 6 * 60 * 60,
  MAX_FAILS:       10,
  LOCK_SECONDS:    15 * 60,
  LOGIN_WAIT_MS:   5000,
  NAME_MAX:        40,
  FAILS_KEY:       'api_fails',
  LOCK_KEY:        'api_locked',
  SESSION_PREFIX:  'api_session_',
};

/** Write actions: their handler and the Arabic words of their log row (S-44). */
const API_WRITES = {
  applyAlias: {
    label: 'تصحيح اسم',
    run: (a, year, test) => dashboardApplyAlias({ teacher: a.teacher, from: a.from, to: a.to }, year, test),
    details: (a, r) => `${a.from} ← ${a.to} عند ${a.teacher} (${{ merged: 'دُمج', renamed: 'أُعيدت التسمية', absent: 'لم يوجد' }[r.outcome] || r.outcome})`,
  },
  deleteAlias: {
    label: 'حذف بديل',
    run: (a, year, test) => dashboardDeleteAlias(a.teacher, a.from, year, test),
    details: a => `${a.from} عند ${a.teacher}`,
  },
  setGender: {
    label: 'الجنس',
    run: (a, year, test) => dashboardSetGender(a.teacher, a.key, a.gender, year, test),
    details: a => `${a.label || a.key} عند ${a.teacher}: ${a.gender}`,
  },
  setDetails: {
    label: 'سنة الميلاد والهاتف',
    run: (a, year, test) => dashboardSetDetails(a.teacher, a.key, { birthYear: a.birthYear, phone: a.phone }, year, test),
    details: a => `${a.label || a.key} عند ${a.teacher}: ${a.birthYear || '-'}، ${a.phone || '-'}`,
  },
  saveRate: {
    label: 'سعر الساعة',
    run: (a, year, test) => dashboardSaveRate(a.teacher, a.rate, year, test),
    details: a => `${a.teacher}: ${a.rate}`,
  },
  saveExpense: {
    label: 'مصروف',
    run: (a, year, test) => dashboardSaveExpense(a.month, a.amount, year, test),
    details: a => `${a.month}: ${a.amount}`,
  },
};

// ============================================================================
// 1. ENTRY POINT
// ============================================================================

/**
 * @param {Object} e - Apps Script POST event.
 * @returns {GoogleAppsScript.Content.TextOutput} JSON { ok, ... } or { ok: false, error, auth? }.
 */
function doPost(e) {
  let reply;
  try {
    const request = parseApiRequest(e && e.postData ? e.postData.contents : '');
    reply = handleApiRequest(request, {
      // Config.local.js first, then Script Properties (_getSecret).
      password: _getSecret(API.PASSWORD_KEY),
      cache: CacheService.getScriptCache(),
      // The form's document lock: shared by every anonymous call, and not the
      // script lock the report pipeline waits on for minutes.
      loginLock: LockService.getDocumentLock() || LockService.getUserLock(),
    });
  } catch (error) {
    reply = { ok: false, error: String(error && error.message || error), auth: !!(error && error.auth) };
  }
  return ContentService.createTextOutput(JSON.stringify(reply)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Reads and checks the request body. Unknown fields are dropped.
 * @param {string} contents
 * @returns {{action: string, token: string, test: boolean, year: string, args: Object}}
 */
function parseApiRequest(contents) {
  let body;
  try { body = JSON.parse(String(contents || '')); } catch (e) { throw new Error('طلب غير مفهوم.'); }
  if (!body || typeof body !== 'object') throw new Error('طلب غير مفهوم.');
  const action = String(body.action || '');
  const known = action === 'login' || action === 'data' || Object.prototype.hasOwnProperty.call(API_WRITES, action);
  if (!known) throw new Error('طلب غير معروف.');
  const year = String(body.year || new Date().getFullYear());
  if (!/^\d{4}$/.test(year)) throw new Error('السنة أربعة أرقام.');
  const args = body.args && typeof body.args === 'object' ? body.args : {};
  const clean = {};
  Object.keys(args).forEach(k => {
    const v = args[k];
    if (typeof v === 'string' || typeof v === 'number') clean[k] = String(v).replace(/[\u0000-\u001f\u007f]/g, '').trim().substring(0, 200);
  });
  return { action, token: String(body.token || ''), test: body.test === true, year, args: clean };
}

/**
 * Runs one checked request. deps carries the configured password, the cache and
 * the login lock, so tests can pass their own.
 * @param {Object} request - From parseApiRequest.
 * @param {{password: string, cache: Object, loginLock: Object}} deps
 * @returns {Object}
 */
function handleApiRequest(request, deps) {
  if (request.action === 'login') {
    // Without the lock, parallel tries all read the same failure count and the limit of ten is lost.
    if (!deps.loginLock.tryLock(API.LOGIN_WAIT_MS)) throw _authError('الدخول مشغول الآن؛ أعد المحاولة بعد لحظة.');
    try {
      return Object.assign({ ok: true }, apiLogin(request.args.name, request.args.password, deps.password, deps.cache));
    } finally {
      deps.loginLock.releaseLock();
    }
  }
  const name = apiSession(request.token, deps.password, deps.cache);
  if (request.action === 'data') return { ok: true, data: getDashboardData(request.year, request.test) };

  const write = API_WRITES[request.action];
  const result = write.run(request.args, request.year, request.test);
  const data = result && result.data ? result.data : result;
  const details = write.details(request.args, result);
  try {
    _withMode(request.test, () => appendEditLog(request.year, name, write.label, details));
    // The returned data was read before this row existed; add it rather than read everything again.
    data.log.unshift(rowsToEditLog([[new Date(), name, write.label, details]])[0]);
  } catch (error) {
    // The write itself succeeded; a lost log row must not report it as failed.
    console.error('[API] edit log failed:', error.message);
  }
  return { ok: true, outcome: result && result.outcome, data };
}

// ============================================================================
// 2. PASSWORD AND SESSIONS (S-41, S-42)
// ============================================================================

/** An error the page answers by showing the login form again. */
function _authError(message) {
  const error = new Error(message);
  error.auth = true;
  return error;
}

/** @returns {string} SHA-256 of text, as hex. */
function _sha256Hex(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8);
  return bytes.map(b => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
}

/** Compares two equal-length hex digests without stopping at the first difference. */
function _sameDigest(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * @param {string} name - Typed by the admin, kept for the edit log.
 * @param {string} password
 * @param {string} configured - DASHBOARD_PASSWORD.
 * @param {Object} cache - CacheService cache (get/put/remove).
 * @returns {{token: string, name: string}}
 */
function apiLogin(name, password, configured, cache) {
  configured = String(configured || '').trim();
  const who = String(name || '').replace(/\s+/g, ' ').trim();
  if (!configured) throw _authError('لم تُضبط كلمة مرور اللوحة بعد.');
  if (cache.get(API.LOCK_KEY)) throw _authError('أُقفل الدخول ربع ساعة بعد محاولات خاطئة كثيرة.');
  if (who.length < 2 || who.length > API.NAME_MAX) throw _authError('اكتب اسمك (من حرفين إلى أربعين).');

  if (!_sameDigest(_sha256Hex(password || ''), _sha256Hex(configured))) {
    const fails = (Number(cache.get(API.FAILS_KEY)) || 0) + 1;
    cache.put(API.FAILS_KEY, String(fails), API.LOCK_SECONDS);
    if (fails >= API.MAX_FAILS) {
      cache.put(API.LOCK_KEY, '1', API.LOCK_SECONDS);
      cache.remove(API.FAILS_KEY);
    }
    throw _authError('كلمة المرور خطأ.');
  }
  cache.remove(API.FAILS_KEY);
  const token = Utilities.getUuid() + Utilities.getUuid();
  cache.put(API.SESSION_PREFIX + token, JSON.stringify({ name: who, pw: _sha256Hex(configured) }), API.SESSION_SECONDS);
  return { token, name: who };
}

/**
 * The name of a valid session. A changed password ends every session (S-41).
 * @param {string} token
 * @param {string} configured
 * @param {Object} cache
 * @returns {string}
 */
function apiSession(token, configured, cache) {
  configured = String(configured || '').trim();
  const raw = token && configured ? cache.get(API.SESSION_PREFIX + token) : null;
  let session = null;
  try { session = raw ? JSON.parse(raw) : null; } catch (e) { session = null; }
  if (!session || !_sameDigest(String(session.pw || ''), _sha256Hex(configured))) {
    throw _authError('انتهت الجلسة؛ ادخل من جديد.');
  }
  return session.name;
}
