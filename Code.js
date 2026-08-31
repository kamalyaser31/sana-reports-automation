/**
 * ============================================================================
 * Sana Academy Reports Automation (Version 5.1 - Idiomatic ES6+)
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
const CONFIG = {
  get ROOT_FOLDER_ID() { return _getSecret('ROOT_FOLDER_ID') || ''; },

  ROOT_FOLDER_NAME:          'تقرير حلقات أكاديمية سنا',
  ERROR_LOG_FILENAME_PREFIX: 'automation_errors',

  get ALERT_EMAIL() { return _getSecret('ALERT_EMAIL'); },

  LOCK_TIMEOUT_MS: 30000,

  RETRY: {
    MAX_ATTEMPTS:       3,
    INITIAL_DELAY_MS:   1000,
    BACKOFF_MULTIPLIER: 2,
  },

  TEACHERS: {
    'محمد نبيل': { id: 'T001', name: 'محمد نبيل' },
    'أسماء علي': { id: 'T002', name: 'أسماء علي' },
    'فاطمة إبراهيم': { id: 'T003', name: 'فاطمة إبراهيم' },
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
    DATE_TEXT:          'تاريخ غير محدد',
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
      throw new Error(`Could not obtain script lock within ${CONFIG.LOCK_TIMEOUT_MS}ms. Submission queued or throttled.`);
    }

    withRetry(
      () => executeSubmissionPipeline(e, executionId, startTime),
      CONFIG.RETRY.MAX_ATTEMPTS,
      CONFIG.RETRY.INITIAL_DELAY_MS,
      CONFIG.RETRY.BACKOFF_MULTIPLIER
    );

  } catch (error) {
    const errorDetails = {
      executionId,
      timestamp: startTime.toISOString(),
      error:     error.message,
      stack:     error.stack || 'No stack trace available',
    };
    console.error(`[FATAL ERROR] [ExecutionID: ${executionId}]`, error.message, error.stack);

    try { appendErrorToDriveLog(errorDetails); }
    catch (logError) { console.error('[LOGGER FAILURE] Failed to write Drive log:', logError.message); }

    try { sendEmailAlert(errorDetails); }
    catch (emailError) { console.error('[ALERT FAILURE] Failed to send email alert:', emailError.message); }

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
 */
function executeSubmissionPipeline(e, executionId, startTime) {
  const rawData         = extractFormData(e);
  const validatedData   = validateFormData(rawData, executionId, startTime);
  const driveTarget     = resolveTargetFolder(validatedData);
  const markdownContent = generateMarkdownContent(validatedData);

  const saveResult = saveMarkdownFile(driveTarget.monthFolder, validatedData, markdownContent);
  validatedData.fileUrl        = saveResult.file.getUrl();
  validatedData.isDuplicate    = saveResult.isDuplicate;
  validatedData.duplicateIndex = saveResult.duplicateIndex;

  verifySavedFile(saveResult.file);

  // Sheets failure is non-fatal: the Markdown file is already saved.
  // Log to Drive so the failure is not silently discarded.
  try {
    recordToTeacherSheet(driveTarget.yearTeacherFolder, validatedData);
  } catch (sheetError) {
    console.error(`[SHEET WARNING] [ExecutionID: ${executionId}] Could not append to teacher sheet:`, sheetError.message);
    appendErrorToDriveLog({
      executionId,
      timestamp: startTime.toISOString(),
      error:     `Google Sheets Warning: ${sheetError.message}`,
      stack:     sheetError.stack || 'No stack trace',
    });
  }

  // Telegram is non-fatal: log failures to Drive so they are not silently lost.
  try {
    sendTelegramNotification(validatedData);
  } catch (telegramError) {
    console.warn(`[TELEGRAM WARNING] [ExecutionID: ${executionId}]`, telegramError.message);
    appendErrorToDriveLog({
      executionId,
      timestamp: startTime.toISOString(),
      error:     `Telegram Notification Failed: ${telegramError.message}`,
      stack:     telegramError.stack || 'No stack trace',
    });
  }

  console.log(`[PIPELINE SUCCESS] [ExecutionID: ${executionId}] Saved: ${saveResult.file.getName()} in ${driveTarget.monthFolder.getName()}`);
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
    submissionTimestamp: formFields['Timestamp'] || new Date().toISOString(),
  };
}

/**
 * Normalizes Eastern Arabic numerals (٠-٩) to Western digits (0-9)
 * and strips invisible/zero-width whitespace characters.
 * @param {string} str
 * @returns {string}
 */
function normalizeDigitsAndText(str) {
  if (!str) return '';
  const arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  let normalized = String(str).replace(/[\u200B-\u200D\uFEFF\u00A0]/g, ' ');

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
    return { dateText: '', sessionTypeText: '', studentCountText: '' };
  }

  const cleanText    = text.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, ' ');
  const dateMatch    = cleanText.match(/التاريخ\s*[:：]\s*([^\n\r]+)/);
  const sessionMatch = cleanText.match(/(?:الفترة|نوع الحلقة)\s*[:：]\s*([^\n\r]+)/);
  const countMatch   = cleanText.match(/عدد الطلاب\s*[:：]\s*([^\n\r]+)/);

  return {
    dateText:         (dateMatch    && dateMatch[1])    ? dateMatch[1].trim()    : '',
    sessionTypeText:  (sessionMatch && sessionMatch[1]) ? sessionMatch[1].trim() : '',
    studentCountText: (countMatch   && countMatch[1])   ? countMatch[1].trim()   : '',
  };
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
    return {
      teacherName: trimmed,
      teacherId:   'T_' + Utilities.base64EncodeWebSafe(trimmed).substring(0, 6),
    };
  }
  missingFields.push(CONFIG.FIELDS.TEACHER);
  return { teacherName: CONFIG.FALLBACKS.TEACHER_NAME, teacherId: CONFIG.FALLBACKS.TEACHER_ID };
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
    const cleanH  = normalizeDigitsAndText(raw.rawHours).replace(/[^\d]/g, '');
    const parsedH = parseInt(cleanH, 10);
    if (!isNaN(parsedH) && parsedH >= 0) {
      hours = parsedH;
    } else {
      validationErrors.push(`Invalid hours value: ${raw.rawHours}`);
    }
  } else {
    missingFields.push(CONFIG.FIELDS.HOURS);
  }

  if (raw.rawMinutes !== null && raw.rawMinutes !== undefined && String(raw.rawMinutes).trim().length > 0) {
    const cleanM  = normalizeDigitsAndText(raw.rawMinutes).replace(/[^\d]/g, '');
    const parsedM = parseInt(cleanM, 10);
    if (!isNaN(parsedM) && parsedM >= 0 && parsedM <= 59) {
      minutes = parsedM;
    } else if (!isNaN(parsedM) && parsedM > 59) {
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

  return { sessionType, sessionId, reportDateText, studentCount };
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
  const subDate      = _formatSubmissionDate(startTime);

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
 * Shared by resolveTargetFolder and exportTeacherMonthlyPdf to avoid duplication.
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
 * @returns {GoogleAppsScript.Drive.Folder}
 */
function getRootFolder() {
  const rootId = CONFIG.ROOT_FOLDER_ID;
  if (rootId && rootId.trim().length > 0) {
    try {
      return DriveApp.getFolderById(rootId.trim());
    } catch (e) {
      console.warn(`[DRIVE WARNING] Could not access Root Folder by ID "${rootId}". Falling back to name search.`);
    }
  }

  const searchResults = DriveApp.getFoldersByName(CONFIG.ROOT_FOLDER_NAME);
  if (searchResults.hasNext()) return searchResults.next();

  return DriveApp.createFolder(CONFIG.ROOT_FOLDER_NAME);
}

/**
 * Finds or creates a child folder inside a parent folder.
 * @param {GoogleAppsScript.Drive.Folder} parentFolder
 * @param {string} childName
 * @returns {GoogleAppsScript.Drive.Folder}
 */
function getOrCreateChildFolder(parentFolder, childName) {
  const sanitizedName = sanitizeFilename(childName);
  const children = parentFolder.getFoldersByName(sanitizedName);
  if (children.hasNext()) return children.next();
  return parentFolder.createFolder(sanitizedName);
}

// ============================================================================
// 9. MARKDOWN GENERATION
// ============================================================================

/**
 * Generates structured Markdown text with YAML frontmatter and report body.
 * @param {Object} data - Validated data.
 * @returns {string} Complete Markdown document string.
 */
function generateMarkdownContent(data) {
  const yamlFrontmatter = [
    '---',
    `report_id: ${JSON.stringify(data.executionId)}`,
    `submission_timestamp: ${JSON.stringify(data.submissionTimestamp)}`,
    `teacher_name: ${JSON.stringify(data.teacherName)}`,
    `teacher_id: ${JSON.stringify(data.teacherId)}`,
    `session_type: ${JSON.stringify(data.sessionType)}`,
    `session_id: ${JSON.stringify(data.sessionId)}`,
    `student_category: ${JSON.stringify(data.studentCategory)}`,
    `report_date_text: ${JSON.stringify(data.reportDateText || data.submissionDateFormatted)}`,
    `duration_hours: ${data.durationHours}`,
    `duration_minutes: ${data.durationMinutes}`,
    `duration_time: ${JSON.stringify(data.durationTime)}`,
    `duration_formatted: ${JSON.stringify(data.durationFormatted)}`,
    `student_count: ${data.studentCount !== null ? data.studentCount : 'null'}`,
    `validation_status: ${JSON.stringify(data.validationStatus)}`,
    `missing_fields: ${JSON.stringify(data.missingFields)}`,
    '---',
  ].join('\n');

  const bodyContent = [
    `# تقرير حلقة: ${data.sessionType} — ${data.teacherName}`,
    '',
    `- **اسم المعلم:** ${data.teacherName} (\`${data.teacherId}\`)`,
    `- **نوع الحلقة:** ${data.sessionType} (\`${data.sessionId}\`)`,
    `- **فئة الطلاب:** ${data.studentCategory}`,
    `- **تاريخ التقرير:** ${data.reportDateText || data.submissionDateFormatted}`,
    `- **مدة الحصة:** ${data.durationFormatted} (\`${data.durationTime}\`)`,
    `- **عدد الطلاب:** ${data.studentCount !== null ? data.studentCount : 'غير محدد'}`,
    `- **حالة التحقق:** ${data.validationStatus}`,
    '',
    '---',
    '',
    '## نص التقرير',
    '',
    data.reportText,
    '',
    '---',
    '',
    '## ملاحظات خاصة للإدارة',
    '',
    data.adminNotes || 'لا توجد ملاحظات إدارية.',
    '',
  ].join('\n');

  return `${yamlFrontmatter}\n\n${bodyContent}`;
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
 * @returns {{ file: GoogleAppsScript.Drive.File, isDuplicate: boolean, duplicateIndex: number }}
 */
function saveMarkdownFile(monthFolder, data, content) {
  const baseName = sanitizeFilename(`${data.submissionDateFormatted}_${data.sessionType}_${data.teacherName}`);
  let targetFilename = `${baseName}.md`;
  let duplicateIndex = 0;

  while (monthFolder.getFilesByName(targetFilename).hasNext()) {
    duplicateIndex++;
    targetFilename = `${baseName} (${duplicateIndex}).md`;
  }

  const blob = Utilities.newBlob(content, 'text/markdown; charset=UTF-8', targetFilename);
  return { file: monthFolder.createFile(blob), isDuplicate: duplicateIndex > 0, duplicateIndex };
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

/**
 * Records the session into the Teacher's yearly Google Sheet under the monthly tab.
 * @param {GoogleAppsScript.Drive.Folder} yearTeacherFolder
 * @param {Object} data
 */
function recordToTeacherSheet(yearTeacherFolder, data) {
  const spreadsheet = getOrCreateTeacherSpreadsheet(yearTeacherFolder, data.teacherName, data.submissionYear);
  const sheet       = getOrCreateMonthlyTab(spreadsheet, data.submissionMonthFolderName);

  removeSummaryRows(sheet);

  // Duration stored as a day fraction so SUM/AVERAGE work natively in Sheets.
  const durationDayFraction = (data.durationHours / 24) + (data.durationMinutes / 1440);
  const adminCellValue = data.isDuplicate
    ? `(تقرير مكرر) ${data.adminNotes || ''}`.trim()
    : (data.adminNotes || '');

  sheet.appendRow([
    data.reportDateText || data.submissionDateFormatted,
    data.sessionType,
    data.studentCategory,
    durationDayFraction,
    data.studentCount !== null ? data.studentCount : '',
    adminCellValue,
  ]);

  const newDataRow = sheet.getLastRow();
  sheet.getRange(newDataRow, 4).setNumberFormat('[h]:mm');
  if (data.studentCount !== null) {
    sheet.getRange(newDataRow, 5).setNumberFormat('0');
  }

  appendSummaryRows(sheet);

  for (let i = 1; i <= CONFIG.SHEET_HEADERS.length; i++) {
    sheet.autoResizeColumn(i);
  }
}

/**
 * Removes existing summary rows (الإجمالي / المتوسط) from the sheet bottom.
 * Reads column A in a single batch to avoid per-row API calls.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 */
function removeSummaryRows(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  // Single batch read — one API call instead of one per row.
  const columnAValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  const summaryLabels = new Set(['الإجمالي', 'المتوسط']);

  // Find the topmost summary row scanning from the bottom; stop at first non-summary.
  let deleteFrom = -1;
  for (let i = columnAValues.length - 1; i >= 0; i--) {
    if (summaryLabels.has(String(columnAValues[i][0]).trim())) {
      deleteFrom = i + 2; // +1 for 1-based index, +1 for header row offset
    } else {
      break;
    }
  }

  if (deleteFrom > 0) {
    sheet.deleteRows(deleteFrom, lastRow - deleteFrom + 1);
  }
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

  sheet.appendRow(['الإجمالي', '', '', `=SUM(D2:D${lastDataRow})`,     `=SUM(E2:E${lastDataRow})`,     '']);
  sheet.appendRow(['المتوسط',  '', '', `=AVERAGE(D2:D${lastDataRow})`, `=AVERAGE(E2:E${lastDataRow})`, '']);

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
  const files = yearTeacherFolder.getFilesByName(expectedTitle);

  if (files.hasNext()) {
    return SpreadsheetApp.openById(files.next().getId());
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

  const files = rootFolder.getFilesByName(logFilename);
  if (files.hasNext()) {
    const file = files.next();
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
    'حدث خطأ أثناء معالجة تقرير حلقة في أكاديمية سنا:',
    '',
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
 * Sends a structured notification card to Telegram via Bot API.
 * @param {Object} data - Validated submission data.
 */
function sendTelegramNotification(data) {
  if (!CONFIG.TELEGRAM.ENABLED) return;

  const botToken = CONFIG.TELEGRAM.BOT_TOKEN;
  const chatId   = CONFIG.TELEGRAM.CHAT_ID;

  if (!botToken || !chatId) {
    console.warn('[TELEGRAM WARNING] Bot token or Chat ID is missing. Notification skipped.');
    return;
  }

  const messageLines = [
    '📖 <b>تقرير حلقة جديد — أكاديمية سنا</b>',
    '',
    `• <b>المعلم:</b> ${escapeHtml(data.teacherName || 'غير محدد')}`,
    `• <b>الفترة / النوع:</b> ${escapeHtml(data.sessionTypeName || data.sessionType || 'غير محدد')}`,
    `• <b>تاريخ التقرير:</b> ${escapeHtml(data.reportDateText || data.submissionDateFormatted || 'غير محدد')}`,
    `• <b>مدة الحصة:</b> ${escapeHtml(data.durationFormatted || 'غير محدد')} (<code>${escapeHtml(data.durationTime || '00:00')}</code>)`,
    `• <b>عدد الطلاب:</b> ${escapeHtml(String(data.studentCount || 0))}`,
  ];

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

  if (resCode !== 200) {
    console.warn(`[TELEGRAM ERROR] Status ${resCode} for chat ${chatId}: ${response.getContentText()}`);
    // If chatId is a bare negative number missing the supergroup -100 prefix, retry once.
    if (resCode === 400 && !chatId.startsWith('-100')) {
      const fallbackChatId = `-100${chatId.replace(/^-/, '')}`;
      console.log(`[TELEGRAM RETRY] Retrying with supergroup ID: ${fallbackChatId}`);
      const retryRes = UrlFetchApp.fetch(url, buildOptions(fallbackChatId));
      if (retryRes.getResponseCode() === 200) {
        console.log('[TELEGRAM SUCCESS] Delivered on retry with supergroup ID.');
        return;
      }
    }
  } else {
    console.log('[TELEGRAM SUCCESS] Notification delivered successfully.');
  }
}

/**
 * Escapes HTML special characters for Telegram HTML parse mode.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ============================================================================
// 15. ON-DEMAND MONTHLY PDF EXPORT ENGINE
// ============================================================================

/**
 * Exports all teachers' monthly report tabs as PDFs in their Drive month folders.
 * @param {string|number} [targetYear]      - Defaults to current year.
 * @param {string}        [targetMonthName] - Defaults to current month.
 * @returns {Array<Object>} Per-teacher export result records.
 */
function exportAllTeachersMonthlyPdf(targetYear, targetMonthName) {
  const now       = new Date();
  const year      = String(targetYear || now.getFullYear());
  const monthName = targetMonthName || CONFIG.ARABIC_MONTHS[now.getMonth()];

  console.log(`[PDF EXPORT] Starting batch export — year: ${year}, month: ${monthName}`);

  const rootFolder      = getRootFolder();
  const yearFolder      = getOrCreateChildFolder(rootFolder, year);
  const teacherFolders  = yearFolder.getFolders();
  const processedNames  = new Set();
  const results         = [];

  while (teacherFolders.hasNext()) {
    const teacherFolder = teacherFolders.next();
    const teacherName   = teacherFolder.getName();
    processedNames.add(teacherName);
    results.push(_exportOneTeacher(teacherName, year, monthName));
  }

  // Also check CONFIG.TEACHERS in case their Drive folder has not been created yet.
  for (const tKey in CONFIG.TEACHERS) {
    if (Object.prototype.hasOwnProperty.call(CONFIG.TEACHERS, tKey)) {
      const tName = CONFIG.TEACHERS[tKey].name;
      if (!processedNames.has(tName)) {
        results.push(_exportOneTeacher(tName, year, monthName));
      }
    }
  }

  console.log(`[PDF EXPORT COMPLETED] ${results.length} teacher(s): ${JSON.stringify(results)}`);
  return results;
}

/**
 * Exports one teacher's monthly PDF and returns a result record.
 * Errors are isolated per teacher and logged to Drive.
 * @param {string} teacherName
 * @param {string} year
 * @param {string} monthName
 * @returns {Object}
 */
function _exportOneTeacher(teacherName, year, monthName) {
  try {
    const pdfFile = exportTeacherMonthlyPdf(teacherName, year, monthName);
    return pdfFile
      ? { teacher: teacherName, status: 'SUCCESS', fileId: pdfFile.getId() }
      : { teacher: teacherName, status: 'SKIPPED (No tab found)' };
  } catch (err) {
    console.error(`[PDF EXPORT ERROR] Teacher "${teacherName}":`, err.message);
    appendErrorToDriveLog({
      executionId: 'PDF_EXPORT',
      timestamp:   new Date().toISOString(),
      error:       `PDF export failed for "${teacherName}": ${err.message}`,
      stack:       err.stack || '',
    });
    return { teacher: teacherName, status: 'ERROR', error: err.message };
  }
}

/**
 * Exports a specific teacher's monthly tab as a PDF in their Drive month folder.
 * @param {string}        teacherName
 * @param {string|number} [targetYear]
 * @param {string}        [targetMonthName]
 * @returns {GoogleAppsScript.Drive.File|null}
 */
function exportTeacherMonthlyPdf(teacherName, targetYear, targetMonthName) {
  const now       = new Date();
  const year      = String(targetYear || now.getFullYear());
  const monthName = targetMonthName || CONFIG.ARABIC_MONTHS[now.getMonth()];

  const rootFolder = getRootFolder();

  // Navigate existing folders without creating any — we only create the month folder
  // once we are certain we have a spreadsheet and a tab to export. This prevents
  // orphaned empty folders in Drive when nothing exists yet for this teacher/month.
  const yearFolders = rootFolder.getFoldersByName(sanitizeFilename(year));
  if (!yearFolders.hasNext()) return null;

  const teacherFolders = yearFolders.next().getFoldersByName(sanitizeFilename(teacherName));
  if (!teacherFolders.hasNext()) return null;
  const teacherFolder = teacherFolders.next();

  const spreadsheetTitle = `${teacherName} - تقارير الحلقات ${year}`;
  const files = teacherFolder.getFilesByName(spreadsheetTitle);

  if (!files.hasNext()) {
    console.warn(`[PDF EXPORT] Spreadsheet "${spreadsheetTitle}" not found for teacher "${teacherName}".`);
    return null;
  }

  const spreadsheet = SpreadsheetApp.openById(files.next().getId());
  const sheet       = spreadsheet.getSheetByName(monthName);

  if (!sheet) {
    console.warn(`[PDF EXPORT] Tab "${monthName}" not found in "${spreadsheetTitle}".`);
    return null;
  }

  // Only now resolve (or create) the month folder — we have a PDF to put there.
  const monthFolder = getOrCreateChildFolder(teacherFolder, monthName);
  const pdfFilename = `تقرير_شهري_${sanitizeFilename(teacherName).replace(/\s+/g, '_')}_${sanitizeFilename(monthName).replace(/\s+/g, '_')}_${year}.pdf`;
  return exportSingleSheetToPdf(spreadsheet, sheet, monthFolder, pdfFilename);
}

/**
 * Exports a single sheet tab to PDF and saves it idempotently in the target folder.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 * @param {GoogleAppsScript.Spreadsheet.Sheet}       sheet
 * @param {GoogleAppsScript.Drive.Folder}            targetFolder
 * @param {string}                                    pdfFilename
 * @returns {GoogleAppsScript.Drive.File}
 */
function exportSingleSheetToPdf(spreadsheet, sheet, targetFolder, pdfFilename) {
  const url =
    `https://docs.google.com/spreadsheets/d/${spreadsheet.getId()}/export?` +
    `exportFormat=pdf&format=pdf&size=A4&portrait=false&fitw=true` +
    `&gridlines=true&printtitle=false&sheetnames=false&fzr=true` +
    `&gid=${sheet.getSheetId()}`;

  const response = UrlFetchApp.fetch(url, {
    headers:            { Authorization: `Bearer ${ScriptApp.getOAuthToken()}` },
    muteHttpExceptions: true,
  });

  const resCode = response.getResponseCode();
  if (resCode !== 200) {
    throw new Error(`PDF Export failed with HTTP ${resCode}: ${response.getContentText()}`);
  }

  const blob = response.getBlob().setName(pdfFilename);

  // Idempotent: trash any existing PDF with the same name before creating a fresh one.
  const existingFiles = targetFolder.getFilesByName(pdfFilename);
  while (existingFiles.hasNext()) {
    existingFiles.next().setTrashed(true);
  }

  const newPdf = targetFolder.createFile(blob);
  console.log(`[PDF EXPORT SUCCESS] "${pdfFilename}" (ID: ${newPdf.getId()}) in "${targetFolder.getName()}"`);
  return newPdf;
}
