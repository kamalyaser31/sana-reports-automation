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
  PAY_PASSWORD_KEY: 'PAY_PASSWORD',
  PAY_SECONDS:      30 * 60,
  PAY_FAILS_KEY:    'api_pay_fails',
  PAY_LOCK_KEY:     'api_pay_locked',
};

/** Actions that need a session and write nothing in the registry. */
const API_SESSION_ACTIONS = ['data', 'unlockPay', 'lockPay'];

/**
 * The log action of a rate change; such rows stay out of the shared edit log.
 * Defined here because API_WRITES reads it while this file loads, before Students.js.
 */
const RATE_LOG_ACTION = 'سعر الساعة';
const FIXED_LOG_ACTION = 'مصروف ثابت';

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
    label: RATE_LOG_ACTION,
    pay: true,
    // Logged in the rates file, never in the shared registry (S-48).
    log: 'rates',
    run: (a, year, test) => dashboardSaveRate(a.teacher, a.rate, year, test),
    details: a => `${a.teacher}: ${a.rate}`,
  },
  saveFixed: {
    label: FIXED_LOG_ACTION,
    pay: true,
    log: 'rates',
    run: (a, year, test) => dashboardSaveFixedExpense(a.item, a.amount, year, test),
    details: a => `${a.item}: ${a.amount || 0}`,
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
      payPassword: _getSecret(API.PAY_PASSWORD_KEY),
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
  const known = action === 'login' || API_SESSION_ACTIONS.indexOf(action) !== -1
    || Object.prototype.hasOwnProperty.call(API_WRITES, action);
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
 * Runs one checked request. deps carries the two passwords, the cache and the
 * login lock, so tests can pass their own.
 * @param {Object} request - From parseApiRequest.
 * @param {{password: string, payPassword: string, cache: Object, loginLock: Object}} deps
 * @returns {Object}
 */
function handleApiRequest(request, deps) {
  if (request.action === 'login') {
    return _serialized(deps, () => Object.assign({ ok: true },
      apiLogin(request.args.name, request.args.password, deps.password, deps.cache)));
  }
  const session = apiSession(request.token, deps.password, deps.cache);
  if (request.action === 'unlockPay') {
    _serialized(deps, () => apiUnlockPay(session, request.token, request.args.password, deps.payPassword, deps.cache));
  }
  if (request.action === 'lockPay') apiLockPay(session, request.token, deps.cache);
  const payOpen = apiPayOpen(session, deps.payPassword);

  return _withPay(payOpen, () => {
    let reply;
    if (API_SESSION_ACTIONS.indexOf(request.action) !== -1) {
      reply = { ok: true, data: getDashboardData(request.year, request.test) };
    } else {
      reply = _runWrite(API_WRITES[request.action], request, session.name, payOpen);
    }
    reply.data.payOpen = payOpen;
    reply.data.payUntil = payOpen ? _clock(session.payUntil) : '';
    return reply;
  });
}

/** Runs fn under the login lock: parallel tries would all read one failure count. */
function _serialized(deps, fn) {
  if (!deps.loginLock.tryLock(API.LOGIN_WAIT_MS)) throw _authError('الدخول مشغول الآن؛ أعد المحاولة بعد لحظة.');
  try { return fn(); }
  finally { deps.loginLock.releaseLock(); }
}

/**
 * @param {Object} write - An API_WRITES entry.
 * @param {Object} request
 * @param {string} name - The session's admin.
 * @param {boolean} payOpen
 * @returns {Object}
 */
function _runWrite(write, request, name, payOpen) {
  if (write.pay && !payOpen) throw new Error('افتح الرواتب أولاً بكلمة مرورها.');
  const result = write.run(request.args, request.year, request.test);
  const data = result && result.data ? result.data : result;
  const details = write.details(request.args, result);
  try {
    _withMode(request.test, () => {
      if (write.log === 'rates') appendRateLog(name, details);
      else appendEditLog(request.year, name, write.label, details);
    });
    // The returned data was read before this row existed; add it rather than read everything again.
    const row = rowsToEditLog([[new Date(), name, write.label, details]])[0];
    (write.log === 'rates' ? data.rateLog : data.log).unshift(row);
  } catch (error) {
    // The write itself succeeded; a lost log row must not report it as failed.
    console.error('[API] edit log failed:', error.message);
  }
  return { ok: true, outcome: result && result.outcome, data };
}

/** "hh:mm" of a time in ms. */
function _clock(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
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
 * Counts one wrong password; the tenth locks that door for LOCK_SECONDS.
 * @param {Object} cache
 * @param {string} failsKey
 * @param {string} lockKey
 */
function _countFailure(cache, failsKey, lockKey) {
  const fails = (Number(cache.get(failsKey)) || 0) + 1;
  cache.put(failsKey, String(fails), API.LOCK_SECONDS);
  if (fails >= API.MAX_FAILS) {
    cache.put(lockKey, '1', API.LOCK_SECONDS);
    cache.remove(failsKey);
  }
}

/** Writes a session back for the time it has left. */
function _putSession(token, session, cache) {
  const seconds = Math.max(1, Math.ceil((session.until - Date.now()) / 1000));
  cache.put(API.SESSION_PREFIX + token, JSON.stringify(session), seconds);
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
    _countFailure(cache, API.FAILS_KEY, API.LOCK_KEY);
    throw _authError('كلمة المرور خطأ.');
  }
  cache.remove(API.FAILS_KEY);
  const token = Utilities.getUuid() + Utilities.getUuid();
  _putSession(token, { name: who, pw: _sha256Hex(configured), until: Date.now() + API.SESSION_SECONDS * 1000 }, cache);
  return { token, name: who };
}

/**
 * A valid session. A changed password ends every session (S-41).
 * @param {string} token
 * @param {string} configured
 * @param {Object} cache
 * @returns {{name: string, pw: string, until: number, payUntil?: number, payPw?: string}}
 */
function apiSession(token, configured, cache) {
  configured = String(configured || '').trim();
  const raw = token && configured ? cache.get(API.SESSION_PREFIX + token) : null;
  let session = null;
  try { session = raw ? JSON.parse(raw) : null; } catch (e) { session = null; }
  if (!session || !_sameDigest(String(session.pw || ''), _sha256Hex(configured)) || !(session.until > Date.now())) {
    throw _authError('انتهت الجلسة؛ ادخل من جديد.');
  }
  return session;
}

/**
 * Opens rates and pay for this session for PAY_SECONDS (S-47). Its errors keep
 * the admin logged in.
 * @param {Object} session - From apiSession.
 * @param {string} token
 * @param {string} password
 * @param {string} payConfigured - PAY_PASSWORD.
 * @param {Object} cache
 */
function apiUnlockPay(session, token, password, payConfigured, cache) {
  const configured = String(payConfigured || '').trim();
  if (!configured) throw new Error('لم تُضبط كلمة مرور الرواتب بعد.');
  if (cache.get(API.PAY_LOCK_KEY)) throw new Error('أُقفل فتح الرواتب ربع ساعة بعد محاولات خاطئة كثيرة.');
  if (!_sameDigest(_sha256Hex(password || ''), _sha256Hex(configured))) {
    _countFailure(cache, API.PAY_FAILS_KEY, API.PAY_LOCK_KEY);
    throw new Error('كلمة مرور الرواتب خطأ.');
  }
  cache.remove(API.PAY_FAILS_KEY);
  session.payUntil = Math.min(Date.now() + API.PAY_SECONDS * 1000, session.until);
  session.payPw = _sha256Hex(configured);
  _putSession(token, session, cache);
}

/** Closes rates and pay for this session. */
function apiLockPay(session, token, cache) {
  delete session.payUntil;
  delete session.payPw;
  _putSession(token, session, cache);
}

/**
 * Whether this session may see rates and pay now. A changed pay password closes them.
 * @param {Object} session
 * @param {string} payConfigured
 * @returns {boolean}
 */
function apiPayOpen(session, payConfigured) {
  const configured = String(payConfigured || '').trim();
  return !!configured && session.payUntil > Date.now()
    && _sameDigest(String(session.payPw || ''), _sha256Hex(configured));
}
