/**
 * ============================================================================
 * Sana Academy Reports Automation
 * ============================================================================
 * Automates receiving Google Form responses for Sana Academy reports:
 * 1. Parses structured metadata (Date, Session/Period, Student Count) directly
 *    from the report body text.
 * 2. Reads Teacher, Student Category, Hours, Minutes, and Admin Notes from Form.
 * 3. Builds and stores structured UTF-8 Markdown files in Google Drive:
 *    Root / Year / Teacher / Month / DD-MM-YYYY_SessionType_TeacherName.md
 * 4. Creates/Updates a dedicated yearly Google Sheet per teacher in their year folder:
 *    "Teacher Name - تقارير الحلقات Year" with monthly tabs (08 - أغسطس),
 *    RTL direction, styled headers, standard duration (HH:MM), and clean data.
 * 5. Isolates failures, preserves data non-destructively, and logs errors monthly.
 *
 * Sensitive values (email, tokens) are loaded from Config.local.js (gitignored).
 * See Config.local.example.js for setup instructions.
 * ============================================================================
 */

// ============================================================================
// 1. SECRETS RESOLVER
// ============================================================================

/**
 * Reads a configuration secret from Config.local.js (primary, gitignored) or
 * falls back to Script Properties for shared/team environments.
 * Config.local.js is deployed via clasp push but never committed to git.
 * @param {string} key
 * @returns {string}
 */
function _getSecret(key) {
  if (typeof LOCAL_SECRETS !== 'undefined' && LOCAL_SECRETS[key]) {
    return LOCAL_SECRETS[key];
  }
  return PropertiesService.getScriptProperties().getProperty(key) || '';
}

// ============================================================================
// 2. CONFIGURATION
// ============================================================================
/**
 * Set to true only by Test.js integration runs: routes all Drive writes to
 * TEST_ROOT_FOLDER_ID and skips Telegram, so tests never touch production data.
 */
let _TEST_MODE = false;

const CONFIG = {
  get ROOT_FOLDER_ID() {
    return _TEST_MODE ? _getSecret('TEST_ROOT_FOLDER_ID') : (_getSecret('ROOT_FOLDER_ID') || '');
  },

  ROOT_FOLDER_NAME:          'تقرير حلقات أكاديمية سنا',
  ERROR_LOG_FILENAME_PREFIX: 'automation_errors',

  get ALERT_EMAIL() { return _getSecret('ALERT_EMAIL'); },

  // Apps Script caps a run at 6 min; waiting up to 4 min lets a burst of
  // simultaneous submissions queue up instead of being dropped.
  LOCK_TIMEOUT_MS: 240000,

  RETRY: {
    MAX_ATTEMPTS:       3,
    INITIAL_DELAY_MS:   1000,
    BACKOFF_MULTIPLIER: 2,
  },

  TEACHERS: {
    'محمد نبيل': { id: 'T001', name: 'محمد نبيل' },
    'أسماء علي': { id: 'T002', name: 'أسماء علي' },
    'فاطمة إبراهيم': { id: 'T003', name: 'فاطمة إبراهيم' },
    'رجاء لطفي': { id: 'T004', name: 'رجاء لطفي' },
    'فاطمة عزت': { id: 'T005', name: 'فاطمة عزت' },
    'سمية فتحي': { id: 'T006', name: 'سمية فتحي' },
    'سارة العدل': { id: 'T007', name: 'سارة العدل' },
    'سمية حمدي': { id: 'T008', name: 'سمية حمدي' },
  },

  SESSIONS: {
    'صباحية': { id: 'MORNING', name: 'صباحية' },
    'مسائية': { id: 'EVENING', name: 'مسائية' },
    'إضافية': { id: 'EXTRA',   name: 'إضافية'  },
    'تجويد':  { id: 'TAJWEED', name: 'تجويد'   },
  },

  ARABIC_MONTHS: [
    '01 - يناير', '02 - فبراير', '03 - مارس',
    '04 - أبريل', '05 - مايو',   '06 - يونيو',
    '07 - يوليو', '08 - أغسطس', '09 - سبتمبر',
    '10 - أكتوبر', '11 - نوفمبر', '12 - ديسمبر',
  ],

  FIELDS: {
    TEACHER:          'اسم المعلم',
    STUDENT_CATEGORY: 'فئة الطلاب',
    HOURS:            'الساعات',
    MINUTES:          'الدقائق',
    REPORT_TEXT:      'التقرير',
    ADMIN_NOTES:      'ملاحظات خاصة للإدارة',
  },

  SHEET_HEADERS: [
    'تاريخ التقرير',
    'نوع الحلقة / الفترة',
    'فئة الطلاب',
    'مدة الحصة',
    'عدد الطلاب',
    'ملاحظات الإدارة',
  ],

  // On since install day, 2026-10-25 (S-31 in PLAN_STUDENTS_SHEET.md); the registry starts that day.
  STUDENTS_REGISTRY: {
    ENABLED: true,
  },

  TELEGRAM: {
    ENABLED: true,
    get BOT_TOKEN() { return _getSecret('TELEGRAM_BOT_TOKEN'); },
    get CHAT_ID()   { return _getSecret('TELEGRAM_CHAT_ID');   },
  },

  FALLBACKS: {
    TEACHER_NAME:       'معلم غير محدد',
    TEACHER_ID:         'T_UNKNOWN',
    SESSION_TYPE:       'حلقة غير محددة',
    SESSION_ID:         'SESSION_UNKNOWN',
    STUDENT_CATEGORY:   'غير محدد',
    DURATION_TIME:      '00:00',
    DURATION_FORMATTED: 'غير محدد',
    STUDENT_COUNT:      0,
    REPORT_TEXT:        'لا يوجد نص للتقرير.',
    ADMIN_NOTES:        'لا توجد ملاحظات إدارية.',
  },
};

// ============================================================================
// 3. MAIN TRIGGER ENTRY POINT
// ============================================================================

/**
 * Handles Form Submit event from Google Forms installable trigger.
 * @param {Object} e - Event object from Google Forms submission.
 */
function onFormSubmit(e) {
  const executionId = Utilities.getUuid();
  const startTime   = new Date();
  const lock        = LockService.getScriptLock();
  let   hasLock     = false;

  try {
    hasLock = lock.tryLock(CONFIG.LOCK_TIMEOUT_MS);
    if (!hasLock) {
      throw new Error(`Could not obtain script lock within ${CONFIG.LOCK_TIMEOUT_MS}ms. The submission was NOT processed.`);
    }

    executeSubmissionPipeline(e, executionId, startTime);

  } catch (error) {
    const errorDetails = {
      executionId,
      timestamp:   startTime.toISOString(),
      error:       error.message,
      stack:       error.stack || 'No stack trace available',
      teacherName: _peekTeacherName(e),
    };
    console.error(`[FATAL ERROR] [ExecutionID: ${executionId}]`, error.message, error.stack);

    try { appendErrorToDriveLog(errorDetails); }
    catch (logError) { console.error('[LOGGER FAILURE] Failed to write Drive log:', logError.message); }

    try { sendEmailAlert(errorDetails); }
    catch (emailError) { console.error('[ALERT FAILURE] Failed to send email alert:', emailError.message); }

    // Thrown again so the run shows as Failed in Executions, not Completed (F-06).
    throw error;
  } finally {
    if (hasLock) {
      try { lock.releaseLock(); }
      catch (releaseError) { console.warn('[LOCK WARNING] Failed to release lock cleanly:', releaseError.message); }
    }
  }
}

// ============================================================================
// 4. PIPELINE EXECUTION ENGINE
// ============================================================================

/**
 * Executes the full processing pipeline for a single submission.
 * @param {Object} e           - Form submit event object.
 * @param {string} executionId - Unique UUID for this run.
 * @param {Date}   startTime   - Execution start timestamp.
 * @returns {Object} The validated data, including fileUrl and duplicate info.
 */
function executeSubmissionPipeline(e, executionId, startTime) {
  const rawData         = extractFormData(e);
  const validatedData   = validateFormData(rawData, executionId, startTime);
  const markdownContent = generateMarkdownContent(validatedData);

  // Only the Drive save is retried: it has no side effects until createFile succeeds,
  // so a retry can never produce a second copy of the same report.
  const { driveTarget, saveResult } = withRetry(
    () => _saveReportToDrive(validatedData, markdownContent),
    CONFIG.RETRY.MAX_ATTEMPTS,
    CONFIG.RETRY.INITIAL_DELAY_MS,
    CONFIG.RETRY.BACKOFF_MULTIPLIER
  );
  validatedData.fileUrl        = saveResult.file.getUrl();
  validatedData.isDuplicate    = saveResult.isDuplicate;
  validatedData.duplicateIndex = saveResult.duplicateIndex;

  verifySavedFile(saveResult.file);

  // The report is safe in Drive: the nightly check must not count it as missed.
  // Non-fatal, as a lost mark only brings a false alarm.
  try {
    markResponse(RESPONSE_MARKS.SAVED, rawData.responseId);
  } catch (markError) {
    _safeLogToDrive(executionId, startTime, `Saved mark failed: ${markError.message}`, markError.stack);
  }

  // Sheets failure is non-fatal: the Markdown file is already saved.
  try {
    validatedData.replacedEarlier = recordToTeacherSheet(driveTarget.yearTeacherFolder, validatedData).replaced > 0;
  } catch (sheetError) {
    console.error(`[SHEET WARNING] [ExecutionID: ${executionId}] Could not append to teacher sheet:`, sheetError.message);
    _safeLogToDrive(executionId, startTime, `Google Sheets Warning: ${sheetError.message}`, sheetError.stack);
    validatedData.sheetFailed = true;
  }

  // Only when the sheet counted this report in place of the earlier one (S-58);
  // non-fatal, as the note only helps whoever opens the old file.
  if (validatedData.replacedEarlier && saveResult.earlier) {
    try {
      markSupersededFile(saveResult.earlier, validatedData.fileUrl);
    } catch (markError) {
      _safeLogToDrive(executionId, startTime, `Superseded note failed: ${markError.message}`, markError.stack);
    }
  }

  // The students registry is non-fatal too; recordStudentsSafely logs its own failures.
  if (CONFIG.STUDENTS_REGISTRY.ENABLED || _TEST_MODE) {
    const registry = recordStudentsSafely(driveTarget.yearFolder, validatedData, executionId, startTime);
    if (registry) {
      validatedData.newStudents = registry.newStudents;
    } else {
      validatedData.registryFailed = true;
    }
  }

  // A deleted nightly trigger stops the missed-report check with no error to report.
  try {
    validatedData.nightlyMissing = !_TEST_MODE
      && !ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'nightlyStatsJob');
  } catch (triggerError) {
    _safeLogToDrive(executionId, startTime, `Trigger check failed: ${triggerError.message}`, triggerError.stack);
  }

  // Telegram is non-fatal: log failures to Drive so they are not silently lost.
  let delivered = false;
  let telegramFailure = '';
  try {
    delivered = sendTelegramNotification(validatedData);
  } catch (telegramError) {
    telegramFailure = telegramError.message;
    console.warn(`[TELEGRAM WARNING] [ExecutionID: ${executionId}]`, telegramError.message);
    _safeLogToDrive(executionId, startTime, `Telegram Notification Failed: ${telegramError.message}`, telegramError.stack);
  }

  // Email takes the alert Telegram could not carry: a failed message, or problems
  // with Telegram off.
  const problems = reportProblems(validatedData, new Date());
  let unreported = false;
  if (telegramFailure || (!delivered && problems.length)) {
    try {
      sendReportProblemEmail(validatedData, problems, telegramFailure);
    } catch (mailError) {
      unreported = true;
      _safeLogToDrive(executionId, startTime, `Problem email failed: ${mailError.message}`, mailError.stack);
    }
  }

  // Left unmarked when no alert went out, so the nightly check reports it.
  if (!unreported) {
    try {
      markResponse(RESPONSE_MARKS.DONE, rawData.responseId);
    } catch (markError) {
      _safeLogToDrive(executionId, startTime, `Done mark failed: ${markError.message}`, markError.stack);
    }
  }

  console.log(`[PIPELINE SUCCESS] [ExecutionID: ${executionId}] Saved: ${saveResult.file.getName()} in ${driveTarget.monthFolder.getName()}`);
  return validatedData;
}

/**
 * Resolves the Drive folders and saves the Markdown file (the retryable unit).
 * @param {Object} data
 * @param {string} content
 * @returns {{ driveTarget: Object, saveResult: Object }}
 */
function _saveReportToDrive(data, content) {
  const driveTarget = resolveTargetFolder(data);
  const saveResult  = saveMarkdownFile(driveTarget.monthFolder, data, content);
  return { driveTarget, saveResult };
}

/**
 * Writes a non-fatal warning to the Drive log without ever throwing,
 * so a logging failure cannot abort a pipeline whose report is already saved.
 * @param {string} executionId
 * @param {Date}   startTime
 * @param {string} message
 * @param {string} [stack]
 */
function _safeLogToDrive(executionId, startTime, message, stack) {
  try {
    appendErrorToDriveLog({
      executionId,
      timestamp: startTime.toISOString(),
      error:     message,
      stack:     stack || 'No stack trace',
    });
  } catch (logError) {
    console.error('[LOGGER FAILURE] Failed to write Drive log:', logError.message);
  }
}

/**
 * Best-effort read of the teacher name from a raw event, for fatal-error alerts.
 * @param {Object} e
 * @returns {string}
 */
function _peekTeacherName(e) {
  try {
    return extractFormData(e).rawTeacherName || CONFIG.FALLBACKS.TEACHER_NAME;
  } catch (peekError) {
    return CONFIG.FALLBACKS.TEACHER_NAME;
  }
}

// ============================================================================
// 5. DATA EXTRACTION & METADATA PARSING
// ============================================================================

/**
 * Extracts raw data from Form event and parses text metadata from the report body.
 * @param {Object} e - Event object.
 * @returns {Object} Raw extracted form fields.
 */
function extractFormData(e) {
  if (!e) {
    throw new Error('Missing event object (e is null or undefined).');
  }

  const formFields = {};

  if (e.mockData) {
    for (const key in e.mockData) {
      if (Object.prototype.hasOwnProperty.call(e.mockData, key)) {
        formFields[key.trim()] = e.mockData[key];
      }
    }
  } else if (e.namedValues) {
    for (const key in e.namedValues) {
      if (Object.prototype.hasOwnProperty.call(e.namedValues, key)) {
        const val = e.namedValues[key];
        formFields[key.trim()] = Array.isArray(val) ? val[0] : val;
      }
    }
  } else if (e.response && typeof e.response.getItemResponses === 'function') {
    const itemResponses = e.response.getItemResponses();
    for (let i = 0; i < itemResponses.length; i++) {
      const ir = itemResponses[i];
      formFields[ir.getItem().getTitle().trim()] = ir.getResponse();
    }
  } else {
    throw new Error('Unrecognized event format: neither e.namedValues nor e.response is available.');
  }

  const rawReportText = getFieldCaseInsensitive(formFields, CONFIG.FIELDS.REPORT_TEXT);
  const bodyMetadata  = parseReportMetadata(rawReportText || '');

  return {
    rawTeacherName:      getFieldCaseInsensitive(formFields, CONFIG.FIELDS.TEACHER),
    rawStudentCategory:  getFieldCaseInsensitive(formFields, CONFIG.FIELDS.STUDENT_CATEGORY),
    rawHours:            getFieldCaseInsensitive(formFields, CONFIG.FIELDS.HOURS),
    rawMinutes:          getFieldCaseInsensitive(formFields, CONFIG.FIELDS.MINUTES),
    rawReportText,
    rawAdminNotes:       getFieldCaseInsensitive(formFields, CONFIG.FIELDS.ADMIN_NOTES),
    bodyMetadata,
    // A form response carries its id, for the nightly check of missed responses.
    responseId:          e.response && typeof e.response.getId === 'function' ? e.response.getId() : '',
    submissionTimestamp: formFields['Timestamp'] || new Date().toISOString(),
  };
}

/**
 * Normalizes Eastern Arabic numerals (٠-٩) to Western digits (0-9)
 * and strips invisible/zero-width whitespace characters.
 * @param {string} str
 * @returns {string}
 */
/** Zero-width marks and the no-break space, read as a plain space. */
const INVISIBLE_SPACES_RE = /[\u200B-\u200D\uFEFF\u00A0]/g;

function normalizeDigitsAndText(str) {
  if (!str) return '';
  const arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  let normalized = String(str).replace(INVISIBLE_SPACES_RE, ' ');

  // String.prototype.replaceAll is unavailable in the V8 runtime used by Google Apps Script
  // (pre-ES2021 build). split/join is the standard workaround in this environment.
  for (let i = 0; i < 10; i++) {
    normalized = normalized.split(arabicDigits[i]).join(String(i));
  }
  return normalized;
}

/**
 * Extracts metadata lines (Date, Session/Period, Student Count) from the report body text.
 * @param {string} text - Report body text.
 * @returns {Object} Extracted metadata fields.
 */
function parseReportMetadata(text) {
  if (!text || typeof text !== 'string') {
    return { dateText: '', sessionTypeText: '', studentCountText: '', halaNumText: '' };
  }

  const cleanText    = text.replace(INVISIBLE_SPACES_RE, ' ');
  const dateMatch    = cleanText.match(/التاريخ\s*[:：]\s*([^\n\r]+)/);
  const sessionMatch = cleanText.match(/(?:الفترة|نوع الحلقة)\s*[:：]\s*([^\n\r]+)/);
  const countMatch   = cleanText.match(/عدد الطلاب\s*[:：]\s*([^\n\r]+)/);
  const halaNumMatch = cleanText.match(/رقم الحلقة\s*[:：]\s*([^\n\r]+)/);

  return {
    dateText:         (dateMatch    && dateMatch[1])    ? dateMatch[1].trim()    : '',
    sessionTypeText:  (sessionMatch && sessionMatch[1]) ? sessionMatch[1].trim() : '',
    studentCountText: (countMatch   && countMatch[1])   ? countMatch[1].trim()   : '',
    halaNumText:      (halaNumMatch && halaNumMatch[1]) ? halaNumMatch[1].trim() : '',
  };
}

/** Arabic month names as produced by toLocaleDateString('ar-EG') in the report app. */
const ARABIC_MONTH_NAMES = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

/**
 * Parses the report's own date text into a Date, so the report is filed under
 * the month it belongs to rather than the month it happened to be submitted in.
 * Supports "الأربعاء، ٣٠ سبتمبر ٢٠٢٦" (report app) and "30-09-2026" / "30/09/2026".
 * @param {string} dateText
 * @returns {Date|null} null when the text cannot be parsed into a real calendar date.
 */
function _parseReportDate(dateText) {
  if (!dateText) return null;
  const text = normalizeDigitsAndText(dateText).replace(/[\u200E\u200F\u061C]/g, '');

  let day, monthIndex, year;
  const numeric = text.match(/(\d{1,2})\s*[-\/.]\s*(\d{1,2})\s*[-\/.]\s*(\d{4})/);
  // \s* before the month: teachers sometimes type "7أكتوبر" with no space.
  const named   = text.match(/(\d{1,2})\s*([^\s\d،,]+)\s+(\d{4})/);

  if (numeric) {
    day = parseInt(numeric[1], 10); monthIndex = parseInt(numeric[2], 10) - 1; year = parseInt(numeric[3], 10);
  } else if (named && ARABIC_MONTH_NAMES.indexOf(named[2]) !== -1) {
    day = parseInt(named[1], 10); monthIndex = ARABIC_MONTH_NAMES.indexOf(named[2]); year = parseInt(named[3], 10);
  } else {
    return null;
  }

  const date = new Date(year, monthIndex, day);
  const isRealDate = date.getFullYear() === year && date.getMonth() === monthIndex && date.getDate() === day;
  return isRealDate ? date : null;
}

/**
 * Searches for a field value by key name case-insensitively.
 * @param {Object} obj       - Named values object.
 * @param {string} targetKey - Target field name.
 * @returns {string|null}
 */
function getFieldCaseInsensitive(obj, targetKey) {
  if (!obj || !targetKey) return null;
  const cleanTarget = targetKey.trim().toLowerCase();
  for (const k in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) {
      if (k.trim().toLowerCase() === cleanTarget) {
        const val = obj[k];
        // Return null for absent values rather than the literal strings "null"/"undefined".
        return (val === null || val === undefined) ? null : String(val).trim();
      }
    }
  }
  return null;
}

// ============================================================================
// 6. VALIDATION HELPERS  (private — prefixed with _)
// ============================================================================

/**
 * Formats an hour count as an Arabic grammatical label.
 * Arabic grammar: 1→ساعة, 2→ساعتان, 3–10→ساعات, 11+→ساعة (singular for large numbers).
 * @param {number} hours
 * @returns {string}
 */
function _formatArabicHours(hours) {
  if (hours === 1) return 'ساعة';
  if (hours === 2) return 'ساعتان';
  if (hours <= 10) return 'ساعات';
  return 'ساعة';
}

/**
 * Resolves the teacher name and ID from raw form input.
 * @param {Object}   raw          - Raw form data.
 * @param {string[]} missingFields - Accumulates missing field names.
 * @returns {{ teacherName: string, teacherId: string }}
 */
function _resolveTeacher(raw, missingFields) {
  if (raw.rawTeacherName && raw.rawTeacherName.trim().length > 0) {
    const trimmed = raw.rawTeacherName.trim();
    if (CONFIG.TEACHERS[trimmed]) {
      return { teacherName: CONFIG.TEACHERS[trimmed].name, teacherId: CONFIG.TEACHERS[trimmed].id };
    }
    // A hash of the whole name: a base64 prefix covered only the first two letters,
    // so two new teachers named "فاطمة …" shared one ID, and it was readable as a name.
    return { teacherName: trimmed, teacherId: 'T_' + _shortHash(trimmed) };
  }
  missingFields.push(CONFIG.FIELDS.TEACHER);
  return { teacherName: CONFIG.FALLBACKS.TEACHER_NAME, teacherId: CONFIG.FALLBACKS.TEACHER_ID };
}

/**
 * First 8 hex characters of the SHA-256 of a string: stable, and reveals nothing of it.
 * @param {string} text
 * @returns {string}
 */
function _shortHash(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.slice(0, 4).map(b => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
}

/**
 * Parses a non-negative whole number (Eastern or Western digits).
 * Rejects anything else — "1.5" or "1:30" must be flagged, not silently read as 15 / 130.
 * @param {string|number} value
 * @returns {number|null}
 */
function _parseWholeNumber(value) {
  const clean = normalizeDigitsAndText(value).trim();
  return /^\d+$/.test(clean) ? parseInt(clean, 10) : null;
}

/**
 * Parses hours and minutes from raw form input and computes formatted duration strings.
 * @param {Object}   raw              - Raw form data.
 * @param {string[]} missingFields    - Accumulates missing field names.
 * @param {string[]} validationErrors - Accumulates validation error messages.
 * @returns {{ hours: number, minutes: number, durationTime: string, durationFormatted: string }}
 */
function _parseDuration(raw, missingFields, validationErrors) {
  let hours   = 0;
  let minutes = 0;

  if (raw.rawHours !== null && raw.rawHours !== undefined && String(raw.rawHours).trim().length > 0) {
    const parsedH = _parseWholeNumber(raw.rawHours);
    if (parsedH !== null) {
      hours = parsedH;
    } else {
      validationErrors.push(`Invalid hours value: ${raw.rawHours}`);
    }
  } else {
    missingFields.push(CONFIG.FIELDS.HOURS);
  }

  if (raw.rawMinutes !== null && raw.rawMinutes !== undefined && String(raw.rawMinutes).trim().length > 0) {
    const parsedM = _parseWholeNumber(raw.rawMinutes);
    if (parsedM !== null && parsedM <= 59) {
      minutes = parsedM;
    } else if (parsedM !== null) {
      // Overflow: convert excess minutes into hours.
      minutes  = parsedM % 60;
      hours   += Math.floor(parsedM / 60);
    } else {
      validationErrors.push(`Invalid minutes value: ${raw.rawMinutes}`);
    }
  } else {
    missingFields.push(CONFIG.FIELDS.MINUTES);
  }

  const durationTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  let durationFormatted;
  if (hours > 0 && minutes > 0) {
    durationFormatted = `${hours} ${_formatArabicHours(hours)} و${minutes} دقيقة`;
  } else if (hours > 0) {
    durationFormatted = `${hours} ${_formatArabicHours(hours)}`;
  } else if (minutes > 0) {
    durationFormatted = `${minutes} دقيقة`;
  } else {
    durationFormatted = '0 دقيقة';
  }

  return { hours, minutes, durationTime, durationFormatted };
}

/**
 * Extracts session type, report date, and student count from embedded report metadata.
 * @param {Object}   raw          - Raw form data (with bodyMetadata).
 * @param {string[]} missingFields - Accumulates missing field names.
 * @returns {{ sessionType, sessionId, reportDateText, studentCount }}
 */
function _resolveSessionAndDate(raw, missingFields) {
  let sessionType    = CONFIG.FALLBACKS.SESSION_TYPE;
  let sessionId      = CONFIG.FALLBACKS.SESSION_ID;
  let reportDateText = '';
  let studentCount   = null;

  if (raw.bodyMetadata && raw.bodyMetadata.sessionTypeText && raw.bodyMetadata.sessionTypeText.length > 0) {
    const st = raw.bodyMetadata.sessionTypeText.trim();
    sessionType = st;
    sessionId   = CONFIG.SESSIONS[st]
      ? CONFIG.SESSIONS[st].id
      : `SESSION_${Utilities.base64EncodeWebSafe(st).substring(0, 6)}`;
  } else {
    missingFields.push('نوع الحلقة (من التقرير)');
  }

  if (raw.bodyMetadata && raw.bodyMetadata.dateText && raw.bodyMetadata.dateText.length > 0) {
    reportDateText = raw.bodyMetadata.dateText.trim();
  } else {
    missingFields.push('تاريخ التقرير (من التقرير)');
  }

  if (raw.bodyMetadata && raw.bodyMetadata.studentCountText && raw.bodyMetadata.studentCountText.length > 0) {
    const scMatch = normalizeDigitsAndText(raw.bodyMetadata.studentCountText).match(/\d+/);
    if (scMatch) studentCount = parseInt(scMatch[0], 10);
  }
  if (studentCount === null) missingFields.push('عدد الطلاب (من التقرير)');

  // Optional: distinguishes several halaqat of the same session type on the same day.
  const halaNum = (raw.bodyMetadata && raw.bodyMetadata.halaNumText)
    ? normalizeDigitsAndText(raw.bodyMetadata.halaNumText).trim()
    : '';

  return { sessionType, sessionId, reportDateText, studentCount, halaNum };
}

/**
 * Formats the submission timestamp into Drive folder-routing components.
 * @param {Date} startTime
 * @returns {{ year: string, monthFolderName: string, dateFormatted: string }}
 */
function _formatSubmissionDate(startTime) {
  const year        = String(startTime.getFullYear());
  const monthIndex  = startTime.getMonth();
  const monthFolderName = CONFIG.ARABIC_MONTHS[monthIndex]
    || `${String(monthIndex + 1).padStart(2, '0')} - شهر`;
  const day   = String(startTime.getDate()).padStart(2, '0');
  const month = String(monthIndex + 1).padStart(2, '0');
  return { year, monthFolderName, dateFormatted: `${day}-${month}-${year}` };
}

// ============================================================================
// 7. VALIDATION & SANITIZATION (NON-DESTRUCTIVE)
// ============================================================================

/**
 * Validates extracted fields and applies safe fallbacks without discarding submissions.
 * @param {Object} raw         - Raw extracted fields.
 * @param {string} executionId - UUID.
 * @param {Date}   startTime   - Start time.
 * @returns {Object} Clean validated data structure.
 */
function validateFormData(raw, executionId, startTime) {
  const missingFields    = [];
  const validationErrors = [];

  const teacher      = _resolveTeacher(raw, missingFields);
  const duration     = _parseDuration(raw, missingFields, validationErrors);
  const sessionDate  = _resolveSessionAndDate(raw, missingFields);
  // Route by the report's own date (e.g. a late "yesterday" report sent on the 1st);
  // fall back to the submission time only when the date text cannot be parsed.
  const subDate      = _formatSubmissionDate(_parseReportDate(sessionDate.reportDateText) || startTime);

  let studentCategory;
  if (raw.rawStudentCategory && raw.rawStudentCategory.trim().length > 0) {
    studentCategory = raw.rawStudentCategory.trim();
  } else {
    missingFields.push(CONFIG.FIELDS.STUDENT_CATEGORY);
    studentCategory = CONFIG.FALLBACKS.STUDENT_CATEGORY;
  }

  const reportText = (raw.rawReportText && raw.rawReportText.trim().length > 0)
    ? raw.rawReportText.trim()
    : CONFIG.FALLBACKS.REPORT_TEXT;

  const adminNotes = (raw.rawAdminNotes && raw.rawAdminNotes.trim().length > 0)
    ? raw.rawAdminNotes.trim()
    : '';

  const validationStatus = (missingFields.length === 0 && validationErrors.length === 0)
    ? 'VALID'
    : 'MISSING DATA';

  return {
    executionId,
    submissionTimestamp:       raw.submissionTimestamp,
    submissionDateFormatted:   subDate.dateFormatted,
    submissionYear:            subDate.year,
    submissionMonthFolderName: subDate.monthFolderName,
    teacherName:               teacher.teacherName,
    teacherId:                 teacher.teacherId,
    studentCategory,
    durationHours:    duration.hours,
    durationMinutes:  duration.minutes,
    durationTime:     duration.durationTime,
    durationFormatted: duration.durationFormatted,
    sessionType:      sessionDate.sessionType,
    sessionId:        sessionDate.sessionId,
    halaNum:          sessionDate.halaNum,
    reportDateText:   sessionDate.reportDateText,
    studentCount:     sessionDate.studentCount,
    reportText,
    adminNotes,
    validationStatus,
    missingFields,
    validationErrors,
  };
}

// ============================================================================
// 8. GOOGLE DRIVE HIERARCHY RESOLUTION
// ============================================================================

/**
 * Navigates or creates a three-level Drive path: Year → Teacher → Month.
 * @param {GoogleAppsScript.Drive.Folder} rootFolder
 * @param {string} year
 * @param {string} teacherName
 * @param {string} monthName
 * @returns {{ yearFolder, teacherFolder, monthFolder }}
 */
function _resolveDrivePath(rootFolder, year, teacherName, monthName) {
  const yearFolder    = getOrCreateChildFolder(rootFolder, year);
  const teacherFolder = getOrCreateChildFolder(yearFolder, teacherName);
  const monthFolder   = getOrCreateChildFolder(teacherFolder, monthName);
  return { yearFolder, teacherFolder, monthFolder };
}

/**
 * Resolves Root / Year / Teacher / Month folders in Google Drive.
 * @param {Object} data - Validated data.
 * @returns {Object} Target folder references.
 */
function resolveTargetFolder(data) {
  const rootFolder = getRootFolder();
  const { yearFolder, teacherFolder: yearTeacherFolder, monthFolder } =
    _resolveDrivePath(rootFolder, data.submissionYear, data.teacherName, data.submissionMonthFolderName);
  return { rootFolder, yearFolder, yearTeacherFolder, monthFolder };
}

/**
 * Returns the Root Folder for Sana Academy reports.
 * @param {boolean} [create=true] - false never creates one: readers must not
 *   make an empty root when the real one is out of reach.
 * @returns {GoogleAppsScript.Drive.Folder|null}
 */
function getRootFolder(create = true) {
  const rootId = CONFIG.ROOT_FOLDER_ID;
  if (_TEST_MODE) {
    // Never fall back to the production folder search while testing.
    if (!rootId) throw new Error('TEST_ROOT_FOLDER_ID is not set — refusing to run integration tests against production.');
    return DriveApp.getFolderById(rootId.trim());
  }
  if (rootId && rootId.trim().length > 0) {
    try {
      return DriveApp.getFolderById(rootId.trim());
    } catch (e) {
      console.warn(`[DRIVE WARNING] Could not access Root Folder by ID "${rootId}". Falling back to name search.`);
    }
  }

  return _firstNotTrashed(DriveApp.getFoldersByName(CONFIG.ROOT_FOLDER_NAME))
    || (create ? DriveApp.createFolder(CONFIG.ROOT_FOLDER_NAME) : null);
}

/**
 * Finds or creates a child folder inside a parent folder.
 * @param {GoogleAppsScript.Drive.Folder} parentFolder
 * @param {string} childName
 * @returns {GoogleAppsScript.Drive.Folder}
 */
function getOrCreateChildFolder(parentFolder, childName) {
  const sanitizedName = sanitizeFilename(childName);
  return _firstNotTrashed(parentFolder.getFoldersByName(sanitizedName))
    || parentFolder.createFolder(sanitizedName);
}

/**
 * Returns the first non-trashed item of a DriveApp iterator.
 * DriveApp name lookups also return items in the trash, which must be ignored.
 * @param {GoogleAppsScript.Drive.FileIterator|GoogleAppsScript.Drive.FolderIterator} iterator
 * @returns {GoogleAppsScript.Drive.File|GoogleAppsScript.Drive.Folder|null}
 */
function _firstNotTrashed(iterator) {
  while (iterator.hasNext()) {
    const item = iterator.next();
    if (!item.isTrashed()) return item;
  }
  return null;
}

// ============================================================================
// 9. MARKDOWN GENERATION
// ============================================================================

/**
 * Session type with the halaqa number when present, e.g. "صباحية (حلقة 2)".
 * @param {Object} data
 * @returns {string}
 */
function _sessionLabel(data) {
  return data.halaNum ? `${data.sessionType} (حلقة ${data.halaNum})` : data.sessionType;
}

/**
 * The report file, for a person reading it in Drive: one heading, one line of
 * facts, the teacher's text as sent, the admin notes, and a trace line last.
 * Nothing parses it; the numbers live in the teacher's sheet.
 * @param {Object} data - Validated data.
 * @returns {string}
 */
function generateMarkdownContent(data) {
  const count = data.studentCount !== null ? data.studentCount : 'غير محدد';
  const gaps = data.missingFields.slice();
  if (data.validationErrors.length) gaps.push('المدة غير صحيحة');
  return [
    `# ${_sessionLabel(data)} — ${data.teacherName} — ${data.reportDateText || data.submissionDateFormatted}`,
    '',
    `المدة: ${data.durationFormatted}، والطلاب: ${count}، والفئة: ${data.studentCategory}`,
    ...(gaps.length ? ['', `نقص في التقرير: ${gaps.join('، ')}`] : []),
    '',
    '## نص التقرير',
    '',
    data.reportText,
    '',
    '## ملاحظات الإدارة',
    '',
    data.adminNotes || 'لا ملاحظات.',
    '',
    '---',
    `للتتبع: ${data.executionId}، ${data.submissionTimestamp}، ${data.teacherId}، ${data.sessionId}`,
    '',
  ].join('\n');
}

/** Heads a report file that a later resubmission of the same halaqa replaced. */
const SUPERSEDED_NOTE = 'تنبيه: حلّ محلَّ هذا التقرير تقريرٌ أحدث للحلقة نفسها:';

/**
 * Puts the superseded note, with the newer file's link, at the head of the
 * earlier report file; once only.
 * @param {GoogleAppsScript.Drive.File} earlier
 * @param {string} newerUrl
 */
function markSupersededFile(earlier, newerUrl) {
  const content = earlier.getBlob().getDataAsString('UTF-8');
  if (content.indexOf(SUPERSEDED_NOTE) === 0) return;
  earlier.setContent(`${SUPERSEDED_NOTE} ${newerUrl}\n\n${content}`);
}

// ============================================================================
// 10. FILE SAVING & VERIFICATION
// ============================================================================

/**
 * Saves Markdown file to the Month folder with collision-safe naming.
 * Returns a value object — does NOT mutate the data argument (CQS).
 * @param {GoogleAppsScript.Drive.Folder} monthFolder
 * @param {Object} data
 * @param {string} content
 * @returns {{ file: GoogleAppsScript.Drive.File, isDuplicate: boolean, duplicateIndex: number,
 *   earlier: ?GoogleAppsScript.Drive.File }} earlier is the latest file of the same halaqa.
 */
function saveMarkdownFile(monthFolder, data, content) {
  // Include the halaqa number so two halaqat of the same type on the same day are not "duplicates".
  const halaPart = data.halaNum ? `_حلقة ${data.halaNum}` : '';
  const baseName = sanitizeFilename(`${data.submissionDateFormatted}_${data.sessionType}${halaPart}_${data.teacherName}`);
  let targetFilename = `${baseName}.md`;
  let duplicateIndex = 0;
  let earlier = null;
  let found;

  while ((found = _firstNotTrashed(monthFolder.getFilesByName(targetFilename)))) {
    earlier = found;
    duplicateIndex++;
    targetFilename = `${baseName} (${duplicateIndex}).md`;
  }

  const blob = Utilities.newBlob(content, 'text/markdown; charset=UTF-8', targetFilename);
  return { file: monthFolder.createFile(blob), isDuplicate: duplicateIndex > 0, duplicateIndex, earlier };
}

/**
 * Verifies file creation integrity in Drive: confirms the file exists and is non-empty.
 * @param {GoogleAppsScript.Drive.File} file
 */
function verifySavedFile(file) {
  if (!file || !file.getId()) {
    throw new Error('File creation verification failed: file object or ID is missing.');
  }
  if (file.getSize() === 0) {
    throw new Error(`File creation verification failed: "${file.getName()}" has 0 bytes.`);
  }
}

// ============================================================================
// 11. GOOGLE SHEETS MANAGEMENT & LOGGING
// ============================================================================

/** Begins the admin cell of a report that is not counted, as another replaced it. */
const DUPLICATE_MARK = '(تقرير مكرر)';

/**
 * Form text for a cell: a leading = + - or @ would make Sheets read it as a
 * formula, so it is kept as text (F-08).
 * @param {*} v
 * @returns {*}
 */
function sheetText(v) {
  return typeof v === 'string' && /^[=+\-@]/.test(v) ? `'${v}` : v;
}

/**
 * A report date as one comparable key: "dd-mm-yyyy" when it can be read, else the text.
 * @param {*} text
 * @returns {string}
 */
function _slotDateKey(text) {
  const date = _parseReportDate(String(text || ''));
  return date ? _formatSubmissionDate(date).dateFormatted : String(text || '').trim();
}

/**
 * The rows of a monthly tab that a resubmitted report replaces (S-58): same date
 * and session label, and not marked already.
 * @param {Array<Array>} rows - Display values of columns A:F below the header.
 * @param {string} dateText
 * @param {string} label - From _sessionLabel.
 * @returns {number[]} Indexes into rows.
 */
function supersededRows(rows, dateText, label) {
  const key = _slotDateKey(dateText);
  return rows.map((r, i) => i).filter(i => String(rows[i][1]).trim() === label
    && _slotDateKey(rows[i][0]) === key
    && String(rows[i][5] || '').trim().indexOf(DUPLICATE_MARK) !== 0);
}

/**
 * Records the session into the Teacher's yearly Google Sheet under the monthly tab.
 * @param {GoogleAppsScript.Drive.Folder} yearTeacherFolder
 * @param {Object} data
 * @returns {{ replaced: number }} Earlier rows this report replaced.
 */
function recordToTeacherSheet(yearTeacherFolder, data) {
  const spreadsheet = getOrCreateTeacherSpreadsheet(yearTeacherFolder, data.teacherName, data.submissionYear);
  const sheet       = getOrCreateMonthlyTab(spreadsheet, data.submissionMonthFolderName);

  removeSummaryRows(sheet);

  // A resubmission is usually a correction, so the last report of a halaqa is the
  // one counted and paid: the earlier rows are marked instead (S-58). Without an
  // earlier row to replace, the report marks itself, as before.
  let replaced = [];
  if (data.isDuplicate && sheet.getLastRow() >= 2) {
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getDisplayValues();
    replaced = supersededRows(rows, data.reportDateText || data.submissionDateFormatted, _sessionLabel(data));
    replaced.forEach(i => sheet.getRange(i + 2, 6).setValue(sheetText(`${DUPLICATE_MARK} ${rows[i][5]}`.trim())));
  }

  // Duration stored as a day fraction so SUM/AVERAGE work natively in Sheets.
  const durationDayFraction = (data.durationHours / 24) + (data.durationMinutes / 1440);
  const adminCellValue = data.isDuplicate && !replaced.length
    ? `${DUPLICATE_MARK} ${data.adminNotes || ''}`.trim()
    : (data.adminNotes || '');

  sheet.appendRow([
    data.reportDateText || data.submissionDateFormatted,
    sheetText(_sessionLabel(data)),
    sheetText(data.studentCategory),
    durationDayFraction,
    data.studentCount !== null ? data.studentCount : '',
    sheetText(adminCellValue),
  ]);

  const newDataRow = sheet.getLastRow();
  // The halaqa label links to the report file, in the sheet and the dashboard alike.
  if (data.fileUrl) {
    sheet.getRange(newDataRow, 2).setRichTextValue(SpreadsheetApp.newRichTextValue()
      .setText(_sessionLabel(data)).setLinkUrl(data.fileUrl).build());
  }
  sheet.getRange(newDataRow, 4).setNumberFormat('[h]:mm');
  if (data.studentCount !== null) {
    sheet.getRange(newDataRow, 5).setNumberFormat('0');
  }

  appendSummaryRows(sheet);
  return { replaced: replaced.length };
}

/**
 * Removes the summary rows (الإجمالي / المتوسط) wherever they are: a row typed
 * by hand below them would otherwise leave them in the middle (F-07).
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 */
function removeSummaryRows(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  summaryRowIndexes(sheet.getRange(2, 1, lastRow - 1, 1).getValues())
    .reverse().forEach(i => sheet.deleteRow(i + 2));
}

/**
 * Indexes of the rows whose first cell is الإجمالي or المتوسط.
 * @param {Array<Array>} columnA
 * @returns {number[]}
 */
function summaryRowIndexes(columnA) {
  const labels = new Set(['الإجمالي', 'المتوسط']);
  return columnA.map((r, i) => (labels.has(String(r[0]).trim()) ? i : -1)).filter(i => i !== -1);
}

/**
 * Appends formatted Total and Average summary rows at the sheet bottom.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 */
function appendSummaryRows(sheet) {
  const lastDataRow   = sheet.getLastRow();
  if (lastDataRow < 2) return;

  const totalRowIndex   = lastDataRow + 1;
  const averageRowIndex = lastDataRow + 2;

  // Rows whose admin cell begins with «(تقرير مكرر)» stay out, as they do from the pay (S-56).
  const notDuplicate = `F2:F${lastDataRow},"<>(تقرير مكرر)*"`;
  const sumOf = col => `=SUMIFS(${col}2:${col}${lastDataRow},${notDuplicate})`;
  const averageOf = col => `=IFERROR(AVERAGEIFS(${col}2:${col}${lastDataRow},${notDuplicate}),"")`;
  sheet.appendRow(['الإجمالي', '', '', sumOf('D'),     sumOf('E'),     '']);
  sheet.appendRow(['المتوسط',  '', '', averageOf('D'), averageOf('E'), '']);

  const summaryRange = sheet.getRange(totalRowIndex, 1, 2, CONFIG.SHEET_HEADERS.length);
  summaryRange.setBackground('#f3f4f6');
  summaryRange.setFontWeight('bold');
  sheet.getRange(totalRowIndex, 4, 2, 1).setNumberFormat('[h]:mm');
  sheet.getRange(totalRowIndex,   5).setNumberFormat('0');
  sheet.getRange(averageRowIndex, 5).setNumberFormat('0.0');
  sheet.getRange(totalRowIndex, 1, 2, 5).setHorizontalAlignment('center');
}

/**
 * Gets or creates the yearly spreadsheet for a teacher.
 * @param {GoogleAppsScript.Drive.Folder} yearTeacherFolder
 * @param {string} teacherName
 * @param {string} year
 * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet}
 */
function getOrCreateTeacherSpreadsheet(yearTeacherFolder, teacherName, year) {
  const expectedTitle = `${teacherName} - تقارير الحلقات ${year}`;
  const existing = _firstNotTrashed(yearTeacherFolder.getFilesByName(expectedTitle));

  if (existing) {
    return SpreadsheetApp.openById(existing.getId());
  }

  const newSpreadsheet = SpreadsheetApp.create(expectedTitle);
  DriveApp.getFileById(newSpreadsheet.getId()).moveTo(yearTeacherFolder);
  return newSpreadsheet;
}

/**
 * Gets or creates the monthly tab with RTL formatting and styled headers.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 * @param {string} monthTabName
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getOrCreateMonthlyTab(spreadsheet, monthTabName) {
  let sheet = spreadsheet.getSheetByName(monthTabName);
  if (sheet) return sheet;

  // Reuse the default blank Sheet1 tab if this is a fresh spreadsheet.
  const sheets = spreadsheet.getSheets();
  if (sheets.length === 1 && sheets[0].getLastRow() === 0) {
    sheet = sheets[0];
    sheet.setName(monthTabName);
  } else {
    sheet = spreadsheet.insertSheet(monthTabName);
  }

  sheet.setRightToLeft(true);
  sheet.getRange(1, 1, 1, CONFIG.SHEET_HEADERS.length).setValues([CONFIG.SHEET_HEADERS]);

  const headerRange = sheet.getRange(1, 1, 1, CONFIG.SHEET_HEADERS.length);
  headerRange.setBackground('#1f2937');
  headerRange.setFontColor('#ffffff');
  headerRange.setFontWeight('bold');
  headerRange.setHorizontalAlignment('center');
  headerRange.setVerticalAlignment('middle');

  sheet.setFrozenRows(1);
  for (let i = 1; i <= CONFIG.SHEET_HEADERS.length; i++) {
    sheet.autoResizeColumn(i);
  }

  return sheet;
}

// ============================================================================
// 12. ERROR LOGGING & ALERTING
// ============================================================================

/**
 * Appends error details to the monthly log file in Drive: automation_errors_YYYY_MM.log.
 * @param {Object} details
 */
function appendErrorToDriveLog(details) {
  const rootFolder  = getRootFolder();
  const now         = new Date();
  const year        = now.getFullYear();
  const month       = String(now.getMonth() + 1).padStart(2, '0');
  const logFilename = `${CONFIG.ERROR_LOG_FILENAME_PREFIX}_${year}_${month}.log`;

  const logEntry = [
    '================================================================================',
    `Timestamp   : ${details.timestamp}`,
    `ExecutionID : ${details.executionId}`,
    `Error       : ${details.error}`,
    'Stack Trace :',
    details.stack,
    '================================================================================',
    '',
  ].join('\n');

  const file = _firstNotTrashed(rootFolder.getFilesByName(logFilename));
  if (file) {
    file.setContent(file.getBlob().getDataAsString('UTF-8') + '\n' + logEntry);
  } else {
    rootFolder.createFile(logFilename, logEntry, 'text/plain; charset=UTF-8');
  }
}

/**
 * Sends an email notification to the administrator about a fatal error.
 * @param {Object} details
 */
function sendEmailAlert(details) {
  const recipient = CONFIG.ALERT_EMAIL;
  if (!recipient) return;

  const subject = `[تنبيه أتمتة أكاديمية سنا] خطأ في معالجة تقرير (${details.executionId})`;
  const body = [
    'السلام عليكم ورحمة الله وبركاته،',
    '',
    'حدث خطأ أثناء معالجة تقرير حلقة في أكاديمية سنا، ولم يُحفظ التقرير.',
    'يُرجى التواصل مع المعلم لإعادة إرسال الاستمارة.',
    '',
    `• المعلم: ${details.teacherName || CONFIG.FALLBACKS.TEACHER_NAME}`,
    `• معرّف التنفيذ: ${details.executionId}`,
    `• التوقيت: ${details.timestamp}`,
    `• رسالة الخطأ: ${details.error}`,
    '',
    'تفاصيل التتبع:',
    details.stack,
    '',
    'تم تسجيل الخطأ في السجل الشهري بـ Google Drive.',
  ].join('\n');

  MailApp.sendEmail(recipient, subject, body);
}

/**
 * Mails the admin; quiet in a test run and without ALERT_EMAIL.
 * @param {string} subject
 * @param {string[]} lines
 */
function _mailAdmin(subject, lines) {
  if (!CONFIG.ALERT_EMAIL || _TEST_MODE) return;
  MailApp.sendEmail(CONFIG.ALERT_EMAIL, `[تنبيه أتمتة أكاديمية سنا] ${subject}`, lines.join('\n'));
}

/**
 * A saved report whose alert Telegram could not carry.
 * @param {Object} data - Validated data.
 * @param {string[]} problems - From reportProblems.
 * @param {string} telegramFailure - The Telegram error, or ''.
 */
function sendReportProblemEmail(data, problems, telegramFailure) {
  const lines = problems.map(p => `• ${p}`);
  if (telegramFailure) lines.push(`• فشلت رسالة Telegram: ${telegramFailure}`);
  _mailAdmin(`${data.teacherName} — ${_sessionLabel(data)}`, [
    'وصل تقرير حلقة وحُفظ في Drive، وفيه ما يحتاج نظرك:',
    '',
    ...lines,
    '',
    `المعلم: ${data.teacherName}`,
    `الحلقة: ${_sessionLabel(data)}`,
    `التاريخ: ${data.reportDateText || data.submissionDateFormatted}`,
    `التقرير: ${data.fileUrl || 'لا رابط'}`,
  ]);
}

// Two marks per form response, one script property per stage and day, kept
// MISSED_CHECK_KEEP_DAYS: SAVED once its file is in Drive, DONE when the run
// ends. Saved but not done is a run cut off midway, which reprocessing must not
// repeat: a second file would mark itself a duplicate and not count.
const RESPONSE_MARKS = { SAVED: 'SAVED_', DONE: 'DONE_' };
const MARKS_SINCE = 'MARKS_SINCE';
const MISSED_CHECK_KEEP_DAYS = 14;

/**
 * Marks a form response at a stage. The first mark also records when marking
 * began, as earlier responses have none.
 * @param {string} prefix - A RESPONSE_MARKS value.
 * @param {string} responseId - '' for a test or diagnostic run, which is not marked.
 */
function markResponse(prefix, responseId) {
  if (!responseId || _TEST_MODE) return;
  const props = PropertiesService.getScriptProperties();
  const now = new Date();
  if (!props.getProperty(MARKS_SINCE)) props.setProperty(MARKS_SINCE, now.toISOString());
  const key = prefix + Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const ids = JSON.parse(props.getProperty(key) || '[]');
  ids.push(responseId);
  props.setProperty(key, JSON.stringify(ids));
}

/**
 * The responses of [from, to), after marking began, that a run did not finish:
 * notSaved has no file; cutOff has its file but stopped before the sheet,
 * registry or Telegram were sure.
 * @param {Array<{id: string, time: Date}>} responses
 * @param {{saved: Set<string>, done: Set<string>}} marks
 * @param {Date} from
 * @param {Date} to
 * @param {Date} since
 * @returns {{notSaved: Array<Object>, cutOff: Array<Object>}}
 */
function missedResponses(responses, marks, from, to, since) {
  const inRange = responses.filter(r => r.time >= from && r.time < to && r.time >= since && !marks.done.has(r.id));
  return { notSaved: inRange.filter(r => !marks.saved.has(r.id)), cutOff: inRange.filter(r => marks.saved.has(r.id)) };
}

/** The form's responses since a time, with both marks and when marking began. */
function _responseState(from) {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  const marksOf = prefix => {
    const ids = new Set();
    Object.keys(all).filter(k => k.indexOf(prefix) === 0).forEach(k => JSON.parse(all[k] || '[]').forEach(id => ids.add(id)));
    return ids;
  };
  const responses = FormApp.getActiveForm().getResponses(from)
    .map(r => ({ id: r.getId(), time: r.getTimestamp(), response: r }));
  return { props, all, responses, marks: { saved: marksOf(RESPONSE_MARKS.SAVED), done: marksOf(RESPONSE_MARKS.DONE) },
    since: all[MARKS_SINCE] ? new Date(all[MARKS_SINCE]) : null };
}

/**
 * Nightly: mails the admin yesterday's responses that a run did not finish,
 * which covers what no run could report (a timeout, a quota, a crash). Then
 * drops the marks older than MISSED_CHECK_KEEP_DAYS. A lost authorization or a
 * deleted trigger stops this job too: Google's own failure email covers those.
 * @param {Date} now
 */
function checkMissedResponses(now) {
  const tz = Session.getScriptTimeZone();
  const today = new Date(Utilities.formatDate(now, tz, "yyyy-MM-dd'T'00:00:00XXX"));
  const yesterday = new Date(today.getTime() - 24 * 3600 * 1000);
  const state = _responseState(yesterday);
  if (state.since) {
    const missed = missedResponses(state.responses, state.marks, yesterday, today, state.since);
    const line = r => `• ${Utilities.formatDate(r.time, tz, 'HH:mm')} — ${_peekTeacherName({ response: r.response })}`;
    const day = Utilities.formatDate(yesterday, tz, 'yyyy-MM-dd');
    const body = [];
    if (missed.notSaved.length) {
      body.push(`لم يُحفظ تقرير هذه الردود يوم ${day}:`, ...missed.notSaved.map(line),
        'وهي محفوظة في الاستمارة؛ ولمعالجتها شغّل reprocessMissedResponses من محرر Apps Script.', '');
    }
    if (missed.cutOff.length) {
      body.push(`حُفظ تقرير هذه الردود يوم ${day} وانقطع ما بعده:`, ...missed.cutOff.map(line),
        'فراجع شيت المعلم وسجل الطلاب بيدك، ولا تُعِد معالجتها.');
    }
    if (body.length) _mailAdmin(`${missed.notSaved.length + missed.cutOff.length} من تقارير ${day} لم تكتمل`, body);
  }
  const keepFrom = Utilities.formatDate(new Date(today.getTime() - MISSED_CHECK_KEEP_DAYS * 24 * 3600 * 1000), tz, 'yyyy-MM-dd');
  Object.values(RESPONSE_MARKS).forEach(prefix => Object.keys(state.all)
    .filter(k => k.indexOf(prefix) === 0 && k < prefix + keepFrom)
    .forEach(k => state.props.deleteProperty(k)));
}

/**
 * Run by hand from the editor: processes again, as the form trigger would,
 * every response of the last MISSED_CHECK_KEEP_DAYS days whose report was not
 * saved. One saved but cut off is left for a hand check.
 */
function reprocessMissedResponses() {
  const now = new Date();
  const from = new Date(now.getTime() - MISSED_CHECK_KEEP_DAYS * 24 * 3600 * 1000);
  const state = _responseState(from);
  if (!state.since) return console.log('[REPROCESS] No marks yet; nothing to compare.');
  const missed = missedResponses(state.responses, state.marks, from, now, state.since).notSaved;
  missed.forEach(r => {
    try { onFormSubmit({ response: r.response }); }
    catch (error) { console.error(`[REPROCESS] ${r.id} failed:`, error.message); }
  });
  console.log(`[REPROCESS] ${missed.length} response(s) processed again.`);
}

// ============================================================================
// 13. UTILITIES & RETRY ENGINE
// ============================================================================

/**
 * Executes a function with exponential backoff retry.
 * Errors matching NON_RETRYABLE (quota, rate limit, auth) propagate immediately
 * without retrying — retrying them wastes execution time and quota.
 * @param {Function} fn
 * @param {number}   maxAttempts
 * @param {number}   delayMs
 * @param {number}   backoffMultiplier
 */
function withRetry(fn, maxAttempts, delayMs, backoffMultiplier) {
  // Quota/auth errors are permanent for this execution window — never retry them.
  const NON_RETRYABLE = /quota|rate.?limit|exceeded|authorization|invalid.?token/i;
  let currentDelay = delayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return fn();
    } catch (error) {
      if (attempt === maxAttempts || NON_RETRYABLE.test(error.message)) throw error;
      console.warn(`[RETRY] Attempt ${attempt}/${maxAttempts} failed: ${error.message}. Retrying in ${currentDelay}ms...`);
      Utilities.sleep(currentDelay);
      currentDelay *= backoffMultiplier;
    }
  }
}

/**
 * Sanitizes strings for safe filename creation.
 * @param {string} str
 * @returns {string}
 */
function sanitizeFilename(str) {
  if (!str) return 'unnamed';
  return String(str)
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

// ============================================================================
// 14. TELEGRAM NOTIFICATIONS
// ============================================================================

/**
 * What the admin must know of a report that the form and the app cannot stop:
 * a failed write, a stopped nightly trigger, a hand-typed report without the
 * app's header lines, and a report for a frozen month (S-20).
 * @param {Object} data - Validated data, after the sheet and registry steps.
 * @param {Date} today
 * @returns {string[]}
 */
function reportProblems(data, today) {
  const out = [];
  if (data.sheetFailed) out.push('لم يُكتب في شيت المعلم، فأضِفه باليد');
  if (data.registryFailed) out.push('لم يُسجَّل حضور الطلاب في سجل الطلاب');
  if (data.nightlyMissing) out.push('المؤقت الليلي متوقف، فشغّل installNightlyTrigger من المحرر');
  const fromHeader = ' (من التقرير)';
  // The Telegram diagnostic sends a bare sample without missingFields.
  const header = (data.missingFields || []).filter(f => f.endsWith(fromHeader)).map(f => f.slice(0, -fromHeader.length));
  if (header.length) out.push(`ينقص من ترويسة التقرير: ${header.join('، ')}`);
  if (data.reportDateText && !_parseReportDate(data.reportDateText)) {
    out.push('لم يُفهم تاريخ التقرير، فحُسب بتاريخ الإرسال');
  }
  const month = _tabMonth(data.submissionMonthFolderName, data.submissionYear);
  if (month && isMonthFrozen(month, today)) out.push('شهر ثابت: يدخل الراتب لا الملف العام');
  return out;
}

/**
 * Sends a structured notification card to Telegram via Bot API.
 * @param {Object} data - Validated submission data.
 * @returns {boolean} Whether a message went out; false when Telegram is off.
 */
function sendTelegramNotification(data) {
  if (!CONFIG.TELEGRAM.ENABLED || _TEST_MODE) return false;

  const botToken = CONFIG.TELEGRAM.BOT_TOKEN;
  // A chat id typed without quotes in Config.local.js is a number, and the -100 retry below needs a string.
  const chatId   = String(CONFIG.TELEGRAM.CHAT_ID || '');

  if (!botToken || !chatId) {
    console.warn('[TELEGRAM WARNING] Bot token or Chat ID is missing. Notification skipped.');
    return false;
  }

  const messageLines = [
    '📖 <b>تقرير حلقة جديد — أكاديمية سنا</b>',
    '',
    `• <b>المعلم:</b> ${escapeHtml(data.teacherName || 'غير محدد')}`,
    `• <b>الفترة / النوع:</b> ${escapeHtml(_sessionLabel(data) || 'غير محدد')}`,
    `• <b>تاريخ التقرير:</b> ${escapeHtml(data.reportDateText || data.submissionDateFormatted || 'غير محدد')}`,
    `• <b>مدة الحصة:</b> ${escapeHtml(data.durationFormatted || 'غير محدد')} (<code>${escapeHtml(data.durationTime || '00:00')}</code>)`,
    `• <b>عدد الطلاب:</b> ${escapeHtml(data.studentCount !== null && data.studentCount !== undefined ? String(data.studentCount) : 'غير محدد')}`,
  ];

  // Under the title, so the phone's notification shows it.
  const problems = reportProblems(data, new Date());
  if (problems.length) messageLines.splice(1, 0, `⚠️ <b>تنبيه:</b> ${escapeHtml(problems.join('، '))}`);

  // Says which report of a resent halaqa counts (S-58), so the admin need not open the sheet.
  if (data.replacedEarlier) {
    messageLines.push('• <b>إعادة إرسال:</b> يحل محل التقرير السابق لهذه الحلقة، وهذا المحسوب الآن.');
  } else if (data.isDuplicate) {
    messageLines.push('• <b>مكرر:</b> لن يُحسب في الساعات.');
  }
  if (data.newStudents && data.newStudents.length) {
    messageLines.push(`• <b>طلاب جدد:</b> ${escapeHtml(data.newStudents.join('، '))}`);
  }
  if (data.fileUrl) {
    messageLines.push(`• <b>رابط التقرير:</b> <a href="${escapeHtml(data.fileUrl)}">فتح الملف في Google Drive</a>`);
  }
  if (data.adminNotes && data.adminNotes !== 'لا توجد ملاحظات إدارية.' && data.adminNotes.trim() !== '') {
    messageLines.push(`• <b>ملاحظات الإدارة:</b> ${escapeHtml(data.adminNotes)}`);
  }

  const url            = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const messagePayload = {
    text:                     messageLines.join('\n'),
    parse_mode:               'HTML',
    disable_web_page_preview: true,
  };

  // Builder: creates a fresh, immutable options object for each fetch call.
  // Avoids mutating `const` and prevents shared state between primary and retry calls.
  const buildOptions = (targetChatId) => ({
    method:             'post',
    contentType:        'application/json',
    payload:            JSON.stringify({ ...messagePayload, chat_id: targetChatId }),
    muteHttpExceptions: true,
  });

  const response = UrlFetchApp.fetch(url, buildOptions(chatId));
  const resCode  = response.getResponseCode();

  if (resCode === 200) {
    console.log('[TELEGRAM SUCCESS] Notification delivered successfully.');
    return true;
  }

  console.warn(`[TELEGRAM ERROR] Status ${resCode} for chat ${chatId}: ${response.getContentText()}`);
  // If chatId is a bare negative number missing the supergroup -100 prefix, retry once.
  if (resCode === 400 && !chatId.startsWith('-100')) {
    const fallbackChatId = `-100${chatId.replace(/^-/, '')}`;
    console.log(`[TELEGRAM RETRY] Retrying with supergroup ID: ${fallbackChatId}`);
    const retryRes = UrlFetchApp.fetch(url, buildOptions(fallbackChatId));
    if (retryRes.getResponseCode() === 200) {
      console.log('[TELEGRAM SUCCESS] Delivered on retry with supergroup ID.');
      return true;
    }
  }
  // Throw so the caller logs the failure to Drive instead of losing it in the console.
  throw new Error(`Telegram API returned HTTP ${resCode}: ${response.getContentText()}`);
}

/**
 * Escapes HTML special characters for Telegram HTML parse mode, quotes too, since
 * the report link is written inside an href attribute.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

