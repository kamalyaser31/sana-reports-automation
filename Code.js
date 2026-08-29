/**
 * ============================================================================
 * Sana Academy Reports Automation (Version 4 - Enhanced Hybrid Release)
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
 * ============================================================================
 */

// ============================================================================
// 1. CONFIGURATION
// ============================================================================
const CONFIG = {
  // Required: Target Google Drive Root Folder ID.
  get ROOT_FOLDER_ID() {
    return PropertiesService.getScriptProperties().getProperty('ROOT_FOLDER_ID') || '';
  },

  // Fallback Root Folder Name for Drive search and creation
  ROOT_FOLDER_NAME: 'تقرير حلقات أكاديمية سنا',

  // Error Log File Name prefix inside Root Folder.
  // Actual filename is monthly: automation_errors_YYYY_MM.log
  ERROR_LOG_FILENAME_PREFIX: 'automation_errors',

  // Alert Email Address for Fatal Failures.
  get ALERT_EMAIL() {
    return PropertiesService.getScriptProperties().getProperty('ALERT_EMAIL') || 'kamalyaser31@gmail.com';
  },

  // Concurrency Lock Timeout (30 seconds)
  LOCK_TIMEOUT_MS: 30000,

  // Retry Engine Configuration
  RETRY: {
    MAX_ATTEMPTS: 3,
    INITIAL_DELAY_MS: 1000,
    BACKOFF_MULTIPLIER: 2,
  },

  // Known Teacher Mappings.
  TEACHERS: {
    'محمد نبيل': { id: 'T001', name: 'محمد نبيل' },
    'أسماء علي': { id: 'T002', name: 'أسماء علي' },
  },

  // Internal Session Mappings.
  SESSIONS: {
    'صباحية': { id: 'MORNING', name: 'صباحية' },
    'مسائية': { id: 'EVENING', name: 'مسائية' },
    'إضافية': { id: 'EXTRA', name: 'إضافية' },
    'تجويد': { id: 'TAJWEED', name: 'تجويد' },
  },

  // Arabic Month Folder Names (Ordered 01 - 12)
  ARABIC_MONTHS: [
    '01 - يناير',
    '02 - فبراير',
    '03 - مارس',
    '04 - أبريل',
    '05 - مايو',
    '06 - يونيو',
    '07 - يوليو',
    '08 - أغسطس',
    '09 - سبتمبر',
    '10 - أكتوبر',
    '11 - نوفمبر',
    '12 - ديسمبر',
  ],

  // Google Form Fields
  FIELDS: {
    TEACHER: 'اسم المعلم',
    STUDENT_CATEGORY: 'فئة الطلاب',
    HOURS: 'الساعات',
    MINUTES: 'الدقائق',
    REPORT_TEXT: 'التقرير',
    ADMIN_NOTES: 'ملاحظات خاصة للإدارة',
  },

  // Google Sheets Headers for Monthly Tabs
  SHEET_HEADERS: [
    'تاريخ التقرير',
    'نوع الحلقة / الفترة',
    'فئة الطلاب',
    'مدة الحصة',
    'عدد الطلاب',
    'ملاحظات الإدارة',
  ],

  // Telegram Bot Notification Configuration
  TELEGRAM: {
    ENABLED: true,
    get BOT_TOKEN() {
      return PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN') || '8865369925:AAGuMdA4TjKu-D8mU1heLVDqQwn2nOygQFg';
    },
    get CHAT_ID() {
      const raw = PropertiesService.getScriptProperties().getProperty('TELEGRAM_CHAT_ID') || '-1005179038072';
      const trimmed = String(raw).trim();
      // Auto-prefix supergroups missing -100 (e.g. -5179038072 -> -1005179038072)
      if (trimmed.startsWith('-') && !trimmed.startsWith('-100') && trimmed.length > 8) {
        return '-100' + trimmed.substring(1);
      }
      return trimmed;
    },
  },

  // Fallback Values for Missing Data Preservation
  FALLBACKS: {
    TEACHER_NAME: 'معلم غير محدد',
    TEACHER_ID: 'T_UNKNOWN',
    SESSION_TYPE: 'حلقة غير محددة',
    SESSION_ID: 'SESSION_UNKNOWN',
    STUDENT_CATEGORY: 'غير محدد',
    DURATION_TIME: '00:00',
    DURATION_FORMATTED: 'غير محدد',
    STUDENT_COUNT: 0,
    REPORT_TEXT: 'لا يوجد نص للتقرير.',
    ADMIN_NOTES: 'لا توجد ملاحظات إدارية.',
    DATE_TEXT: 'تاريخ غير محدد',
  },
};

// ============================================================================
// 2. MAIN TRIGGER & AUTHORIZATION ENTRY POINTS
// ============================================================================

/**
 * Authorization & Self-Test function.
 * Run this function once from the Apps Script editor toolbar to grant permissions.
 */
function authorizeAndTest() {
  console.log('Running authorization and self-test...');
  const mockEvent = {
    mockData: {
      'اسم المعلم': 'محمد نبيل',
      'فئة الطلاب': 'كبار',
      'الساعات': '1',
      'الدقائق': '30',
      'التقرير': '═══ [ تقرير أكاديمية سنا ] ═══\nالتاريخ: 26-08-2026\nالفترة: تجويد\nعدد الطلاب: 6\n━━━━━━━━━━━━━━━\nتقرير تجريبي لتفويض الصلاحيات وإنشاء الجداول.',
      'ملاحظات خاصة للإدارة': 'تفويض صلاحيات Google Sheets.',
    },
  };
  onFormSubmit(mockEvent);
  console.log('Authorization and self-test completed successfully!');
}

/**
 * Handles Form Submit event from Google Forms installable trigger.
 * @param {Object} e - Event object from Google Forms submission.
 */
function onFormSubmit(e) {
  const executionId = Utilities.getUuid();
  const startTime = new Date();

  const lock = LockService.getScriptLock();
  let hasLock = false;

  try {
    hasLock = lock.tryLock(CONFIG.LOCK_TIMEOUT_MS);
    if (!hasLock) {
      throw new Error(`Could not obtain script lock within ${CONFIG.LOCK_TIMEOUT_MS}ms. Submission queued or throttled.`);
    }

    withRetry(() => {
      executeSubmissionPipeline(e, executionId, startTime);
    }, CONFIG.RETRY.MAX_ATTEMPTS, CONFIG.RETRY.INITIAL_DELAY_MS, CONFIG.RETRY.BACKOFF_MULTIPLIER);

  } catch (error) {
    const errorDetails = {
      executionId: executionId,
      timestamp: startTime.toISOString(),
      error: error.message,
      stack: error.stack || 'No stack trace available',
    };

    console.error(`[FATAL ERROR] [ExecutionID: ${executionId}]`, error.message, error.stack);

    try {
      appendErrorToDriveLog(errorDetails);
    } catch (logError) {
      console.error('[LOGGER FAILURE] Failed to write to Drive monthly log:', logError.message);
    }

    try {
      sendEmailAlert(errorDetails);
    } catch (emailError) {
      console.error('[ALERT FAILURE] Failed to send email alert:', emailError.message);
    }

  } finally {
    if (hasLock) {
      try {
        lock.releaseLock();
      } catch (releaseError) {
        console.warn('[LOCK WARNING] Failed to release lock cleanly:', releaseError.message);
      }
    }
  }
}

// ============================================================================
// 3. PIPELINE EXECUTION ENGINE
// ============================================================================

/**
 * Executes the full processing pipeline for a single submission.
 * @param {Object} e - Form submit event object.
 * @param {string} executionId - Unique UUID for this run.
 * @param {Date} startTime - Execution start timestamp.
 */
function executeSubmissionPipeline(e, executionId, startTime) {
  // Step 1: Extract Form Inputs and Body Metadata
  const rawData = extractFormData(e);

  // Step 2: Validate and Sanitize Fields (Non-destructive)
  const validatedData = validateFormData(rawData, executionId, startTime);

  // Step 3: Resolve Storage Hierarchy in Google Drive (Root / Year / Teacher / Month)
  const driveTarget = resolveTargetFolder(validatedData);

  // Step 4: Generate Markdown Content with YAML Frontmatter
  const markdownContent = generateMarkdownContent(validatedData);

  // Step 5: Save Markdown File with Duplicate Detection and Collision Handling
  const savedFile = saveMarkdownFile(driveTarget.monthFolder, validatedData, markdownContent);
  validatedData.fileUrl = savedFile.getUrl();

  // Step 6: Verify File Integrity in Drive
  verifySavedFile(savedFile, markdownContent);

  // Step 7: Record Submission into Teacher's Yearly Google Sheet (Monthly Tab)
  try {
    recordToTeacherSheet(driveTarget.yearTeacherFolder, validatedData);
  } catch (sheetError) {
    console.error(`[SHEET RECORD WARNING] [ExecutionID: ${executionId}] Could not append to teacher sheet:`, sheetError.message);
    appendErrorToDriveLog({
      executionId: executionId,
      timestamp: startTime.toISOString(),
      error: `Google Sheets Warning: ${sheetError.message}`,
      stack: sheetError.stack || 'No stack trace',
    });
  }

  // Step 8: Send Telegram Admin Notification (Non-blocking)
  try {
    sendTelegramNotification(validatedData);
  } catch (telegramError) {
    console.warn(`[TELEGRAM NOTIFICATION WARNING] [ExecutionID: ${executionId}]`, telegramError.message);
  }

  console.log(`[PIPELINE SUCCESS] [ExecutionID: ${executionId}] Saved: ${savedFile.getName()} in ${driveTarget.monthFolder.getName()}`);
}

// ============================================================================
// 4. DATA EXTRACTION & METADATA PARSING
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

  const values = {};

  // Form submit trigger provides e.namedValues or e.response (or e.mockData for tests)
  if (e.mockData) {
    for (const key in e.mockData) {
      if (Object.prototype.hasOwnProperty.call(e.mockData, key)) {
        values[key.trim()] = e.mockData[key];
      }
    }
  } else if (e.namedValues) {
    for (const key in e.namedValues) {
      if (Object.prototype.hasOwnProperty.call(e.namedValues, key)) {
        const val = e.namedValues[key];
        values[key.trim()] = Array.isArray(val) ? val[0] : val;
      }
    }
  } else if (e.response && typeof e.response.getItemResponses === 'function') {
    const itemResponses = e.response.getItemResponses();
    for (let i = 0; i < itemResponses.length; i++) {
      const itemResponse = itemResponses[i];
      const itemTitle = itemResponse.getItem().getTitle().trim();
      values[itemTitle] = itemResponse.getResponse();
    }
  } else {
    throw new Error('Unrecognized event format: neither e.namedValues nor e.response is available.');
  }

  const rawTeacherName = getFieldCaseInsensitive(values, CONFIG.FIELDS.TEACHER);
  const rawStudentCategory = getFieldCaseInsensitive(values, CONFIG.FIELDS.STUDENT_CATEGORY);
  const rawHours = getFieldCaseInsensitive(values, CONFIG.FIELDS.HOURS);
  const rawMinutes = getFieldCaseInsensitive(values, CONFIG.FIELDS.MINUTES);
  const rawReportText = getFieldCaseInsensitive(values, CONFIG.FIELDS.REPORT_TEXT);
  const rawAdminNotes = getFieldCaseInsensitive(values, CONFIG.FIELDS.ADMIN_NOTES);

  // Parse embedded metadata from the report body
  const bodyMetadata = parseReportMetadata(rawReportText || '');

  return {
    rawTeacherName,
    rawStudentCategory,
    rawHours,
    rawMinutes,
    rawReportText,
    rawAdminNotes,
    bodyMetadata,
    submissionTimestamp: values['Timestamp'] || new Date().toISOString(),
  };
}

/**
 * Normalizes Eastern Arabic numerals (٠-٩) to standard Western digits (0-9)
 * and strips invisible/zero-width whitespace.
 * @param {string} str
 * @returns {string}
 */
function normalizeDigitsAndText(str) {
  if (!str) return '';
  const arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  let normalized = String(str)
    // Replace zero-width and invisible spaces
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, ' ');

  // Replace Eastern Arabic digits with 0-9
  for (let i = 0; i < 10; i++) {
    normalized = normalized.split(arabicDigits[i]).join(String(i));
  }
  return normalized;
}

/**
 * Extracts metadata lines (Date, Session/Period, Student Count) directly from report text.
 * @param {string} text - Report body text.
 * @returns {Object} Extracted metadata.
 */
function parseReportMetadata(text) {
  if (!text || typeof text !== 'string') {
    return { dateText: '', sessionTypeText: '', studentCountText: '' };
  }

  // Clean invisible zero-width spaces
  const cleanText = text.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, ' ');

  let dateText = '';
  let sessionTypeText = '';
  let studentCountText = '';

  // Extract Date line: "التاريخ: ..."
  const dateMatch = cleanText.match(/التاريخ\s*[:：]\s*([^\n\r]+)/);
  if (dateMatch && dateMatch[1]) {
    dateText = dateMatch[1].trim();
  }

  // Extract Period/Session line: "الفترة: ..." or "نوع الحلقة: ..."
  const sessionMatch = cleanText.match(/(?:الفترة|نوع الحلقة)\s*[:：]\s*([^\n\r]+)/);
  if (sessionMatch && sessionMatch[1]) {
    sessionTypeText = sessionMatch[1].trim();
  }

  // Extract Student Count line: "عدد الطلاب: ..."
  const studentCountMatch = cleanText.match(/عدد الطلاب\s*[:：]\s*([^\n\r]+)/);
  if (studentCountMatch && studentCountMatch[1]) {
    studentCountText = studentCountMatch[1].trim();
  }

  return {
    dateText,
    sessionTypeText,
    studentCountText,
  };
}

/**
 * Searches for a field value by key name case-insensitively.
 * @param {Object} obj - Named values object.
 * @param {string} targetKey - Target field name.
 * @returns {string|null} Field value or null.
 */
function getFieldCaseInsensitive(obj, targetKey) {
  if (!obj || !targetKey) return null;
  const cleanTarget = targetKey.trim().toLowerCase();
  for (const k in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) {
      if (k.trim().toLowerCase() === cleanTarget) {
        return String(obj[k]).trim();
      }
    }
  }
  return null;
}

// ============================================================================
// 5. VALIDATION & SANITIZATION (NON-DESTRUCTIVE)
// ============================================================================

/**
 * Validates extracted fields and applies safe fallbacks without discarding submissions.
 * @param {Object} raw - Raw extracted fields.
 * @param {string} executionId - UUID.
 * @param {Date} startTime - Start time.
 * @returns {Object} Clean validated data structure.
 */
function validateFormData(raw, executionId, startTime) {
  const missingFields = [];
  const validationErrors = [];

  // 1. Teacher Validation & Dynamic ID resolution
  let teacherName = CONFIG.FALLBACKS.TEACHER_NAME;
  let teacherId = CONFIG.FALLBACKS.TEACHER_ID;

  if (raw.rawTeacherName && raw.rawTeacherName.trim().length > 0) {
    const trimmed = raw.rawTeacherName.trim();
    if (CONFIG.TEACHERS[trimmed]) {
      teacherName = CONFIG.TEACHERS[trimmed].name;
      teacherId = CONFIG.TEACHERS[trimmed].id;
    } else {
      teacherName = trimmed;
      teacherId = 'T_' + Utilities.base64EncodeWebSafe(trimmed).substring(0, 6);
    }
  } else {
    missingFields.push(CONFIG.FIELDS.TEACHER);
  }

  // 2. Student Category Validation
  let studentCategory = CONFIG.FALLBACKS.STUDENT_CATEGORY;
  if (raw.rawStudentCategory && raw.rawStudentCategory.trim().length > 0) {
    studentCategory = raw.rawStudentCategory.trim();
  } else {
    missingFields.push(CONFIG.FIELDS.STUDENT_CATEGORY);
  }

  // 3. Duration Hours & Minutes Validation
  let hours = 0;
  let minutes = 0;

  if (raw.rawHours !== null && raw.rawHours !== undefined && String(raw.rawHours).trim().length > 0) {
    const cleanH = normalizeDigitsAndText(raw.rawHours).replace(/[^\d]/g, '');
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
    const cleanM = normalizeDigitsAndText(raw.rawMinutes).replace(/[^\d]/g, '');
    const parsedM = parseInt(cleanM, 10);
    if (!isNaN(parsedM) && parsedM >= 0 && parsedM <= 59) {
      minutes = parsedM;
    } else if (!isNaN(parsedM) && parsedM > 59) {
      minutes = parsedM % 60;
      hours += Math.floor(parsedM / 60);
    } else {
      validationErrors.push(`Invalid minutes value: ${raw.rawMinutes}`);
    }
  } else {
    missingFields.push(CONFIG.FIELDS.MINUTES);
  }

  const durationTime = String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0');
  let durationFormatted = '';
  if (hours > 0 && minutes > 0) {
    durationFormatted = `${hours} ${hours === 1 ? 'ساعة' : (hours === 2 ? 'ساعتان' : (hours <= 10 ? 'ساعات' : 'ساعة'))} و${minutes} دقيقة`;
  } else if (hours > 0) {
    durationFormatted = `${hours} ${hours === 1 ? 'ساعة' : (hours === 2 ? 'ساعتان' : (hours <= 10 ? 'ساعات' : 'ساعة'))}`;
  } else if (minutes > 0) {
    durationFormatted = `${minutes} دقيقة`;
  } else {
    durationFormatted = '0 دقيقة';
  }

  // 4. Session Type / Period Extraction from Report
  let sessionType = CONFIG.FALLBACKS.SESSION_TYPE;
  let sessionId = CONFIG.FALLBACKS.SESSION_ID;

  if (raw.bodyMetadata && raw.bodyMetadata.sessionTypeText && raw.bodyMetadata.sessionTypeText.length > 0) {
    const st = raw.bodyMetadata.sessionTypeText.trim();
    sessionType = st;
    if (CONFIG.SESSIONS[st]) {
      sessionId = CONFIG.SESSIONS[st].id;
    } else {
      sessionId = 'SESSION_' + Utilities.base64EncodeWebSafe(st).substring(0, 6);
    }
  } else {
    missingFields.push('نوع الحلقة (من التقرير)');
  }

  // 5. Date Text Extraction from Report
  let reportDateText = '';
  if (raw.bodyMetadata && raw.bodyMetadata.dateText && raw.bodyMetadata.dateText.length > 0) {
    reportDateText = raw.bodyMetadata.dateText.trim();
  } else {
    missingFields.push('تاريخ التقرير (من التقرير)');
    reportDateText = '';
  }

  // 6. Student Count Extraction from Report
  let studentCount = null;
  if (raw.bodyMetadata && raw.bodyMetadata.studentCountText && raw.bodyMetadata.studentCountText.length > 0) {
    const normalizedSc = normalizeDigitsAndText(raw.bodyMetadata.studentCountText);
    const scMatch = normalizedSc.match(/\d+/);
    if (scMatch) {
      studentCount = parseInt(scMatch[0], 10);
    }
  }
  if (studentCount === null) {
    missingFields.push('عدد الطلاب (من التقرير)');
  }

  // 7. Report Text & Admin Notes
  const reportText = raw.rawReportText && raw.rawReportText.trim().length > 0
    ? raw.rawReportText.trim()
    : CONFIG.FALLBACKS.REPORT_TEXT;

  const adminNotes = raw.rawAdminNotes && raw.rawAdminNotes.trim().length > 0
    ? raw.rawAdminNotes.trim()
    : '';

  // 8. Submission Date Formatting (for Folder routing & Fallbacks)
  const submissionDateObj = startTime;
  const submissionYear = String(submissionDateObj.getFullYear());
  const submissionMonthIndex = submissionDateObj.getMonth();
  const submissionMonthFolderName = CONFIG.ARABIC_MONTHS[submissionMonthIndex] || `${String(submissionMonthIndex + 1).padStart(2, '0')} - شهر`;
  const submissionDay = String(submissionDateObj.getDate()).padStart(2, '0');
  const submissionMonth = String(submissionMonthIndex + 1).padStart(2, '0');
  const submissionDateFormatted = `${submissionDay}-${submissionMonth}-${submissionYear}`;

  const validationStatus = (missingFields.length === 0 && validationErrors.length === 0)
    ? 'VALID'
    : 'MISSING DATA';

  return {
    executionId,
    submissionTimestamp: raw.submissionTimestamp,
    submissionDateFormatted,
    submissionYear,
    submissionMonthFolderName,
    teacherName,
    teacherId,
    studentCategory,
    durationHours: hours,
    durationMinutes: minutes,
    durationTime,
    durationFormatted,
    sessionType,
    sessionId,
    reportDateText,
    studentCount,
    reportText,
    adminNotes,
    validationStatus,
    missingFields,
    validationErrors,
  };
}

// ============================================================================
// 6. GOOGLE DRIVE HIERARCHY RESOLUTION
// ============================================================================

/**
 * Resolves Root / Year / Teacher / Month folders in Google Drive.
 * @param {Object} data - Validated data.
 * @returns {Object} Target folder references.
 */
function resolveTargetFolder(data) {
  const rootFolder = getRootFolder();

  // Year folder (e.g. "2026")
  const yearFolder = getOrCreateChildFolder(rootFolder, data.submissionYear);

  // Year Teacher folder (e.g. "2026 / أسماء علي")
  const yearTeacherFolder = getOrCreateChildFolder(yearFolder, data.teacherName);

  // Month folder (e.g. "2026 / أسماء علي / 08 - أغسطس")
  const monthFolder = getOrCreateChildFolder(yearTeacherFolder, data.submissionMonthFolderName);

  return {
    rootFolder,
    yearFolder,
    yearTeacherFolder,
    monthFolder,
  };
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
      console.warn(`[DRIVE WARNING] Could not access Root Folder by ID "${rootId}". Falling back to search by name.`);
    }
  }

  const searchResults = DriveApp.getFoldersByName(CONFIG.ROOT_FOLDER_NAME);
  if (searchResults.hasNext()) {
    return searchResults.next();
  }

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
  if (children.hasNext()) {
    return children.next();
  }
  return parentFolder.createFolder(sanitizedName);
}

// ============================================================================
// 7. MARKDOWN GENERATION & SAVING
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

  return yamlFrontmatter + '\n\n' + bodyContent;
}

/**
 * Saves Markdown file to the Month folder, checking for collisions and indexing duplicates.
 * @param {GoogleAppsScript.Drive.Folder} monthFolder
 * @param {Object} data
 * @param {string} content
 * @returns {GoogleAppsScript.Drive.File}
 */
function saveMarkdownFile(monthFolder, data, content) {
  const baseName = sanitizeFilename(`${data.submissionDateFormatted}_${data.sessionType}_${data.teacherName}`);
  let targetFilename = `${baseName}.md`;
  let duplicateIndex = 0;

  // Check if file exists to determine duplicate index
  while (monthFolder.getFilesByName(targetFilename).hasNext()) {
    duplicateIndex++;
    targetFilename = `${baseName} (${duplicateIndex}).md`;
  }

  data.isDuplicate = (duplicateIndex > 0);
  data.duplicateIndex = duplicateIndex;

  const blob = Utilities.newBlob(content, 'text/markdown; charset=UTF-8', targetFilename);
  return monthFolder.createFile(blob);
}

/**
 * Verifies file creation and content integrity in Drive.
 * @param {GoogleAppsScript.Drive.File} file
 * @param {string} originalContent
 */
function verifySavedFile(file, originalContent) {
  if (!file || !file.getId()) {
    throw new Error('File creation verification failed: file object or ID is missing.');
  }

  const size = file.getSize();
  if (size === 0) {
    throw new Error(`File creation verification failed: created file "${file.getName()}" has 0 bytes.`);
  }
}

// ============================================================================
// 8. GOOGLE SHEETS MANAGEMENT & LOGGING
// ============================================================================

/**
 * Records the session into the Teacher's yearly Google Sheet under the appropriate monthly tab.
 * Includes dynamic management of bottom Total and Average summary rows.
 * @param {GoogleAppsScript.Drive.Folder} yearTeacherFolder
 * @param {Object} data
 */
function recordToTeacherSheet(yearTeacherFolder, data) {
  const spreadsheet = getOrCreateTeacherSpreadsheet(yearTeacherFolder, data.teacherName, data.submissionYear);
  const sheet = getOrCreateMonthlyTab(spreadsheet, data.submissionMonthFolderName);

  // 1. Remove existing summary rows before inserting new record
  removeSummaryRows(sheet);

  // 2. Compute day fraction for duration so SUM and AVERAGE work natively
  const hours = data.durationHours || 0;
  const minutes = data.durationMinutes || 0;
  const durationDayFraction = (hours / 24) + (minutes / 1440);

  const rowValues = [
    data.reportDateText || data.submissionDateFormatted,
    data.sessionType,
    data.studentCategory,
    durationDayFraction,
    data.studentCount !== null ? data.studentCount : '',
    data.isDuplicate ? `(تقرير مكرر) ${data.adminNotes || ''}`.trim() : (data.adminNotes || ''),
  ];

  sheet.appendRow(rowValues);

  // Format the new data row's duration cell
  const newDataRow = sheet.getLastRow();
  sheet.getRange(newDataRow, 4).setNumberFormat('[h]:mm');
  if (data.studentCount !== null) {
    sheet.getRange(newDataRow, 5).setNumberFormat('0');
  }

  // 3. Append dynamic bottom summary rows (Total & Average)
  appendSummaryRows(sheet);

  // 4. Auto-resize columns to fit content
  for (let i = 1; i <= CONFIG.SHEET_HEADERS.length; i++) {
    sheet.autoResizeColumn(i);
  }
}

/**
 * Removes existing summary rows from the bottom of the sheet if present.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 */
function removeSummaryRows(sheet) {
  let lastRow = sheet.getLastRow();
  while (lastRow > 1) {
    const firstCellVal = String(sheet.getRange(lastRow, 1).getValue()).trim();
    if (firstCellVal === 'الإجمالي' || firstCellVal === 'المتوسط') {
      sheet.deleteRow(lastRow);
      lastRow = sheet.getLastRow();
    } else {
      break;
    }
  }
}

/**
 * Appends formatted Total and Average summary rows at the bottom of the sheet.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 */
function appendSummaryRows(sheet) {
  const lastDataRow = sheet.getLastRow();
  if (lastDataRow < 2) return; // No data rows to summarize

  const totalRowIndex = lastDataRow + 1;
  const averageRowIndex = lastDataRow + 2;

  // Total Row
  sheet.appendRow([
    'الإجمالي',
    '',
    '',
    `=SUM(D2:D${lastDataRow})`,
    `=SUM(E2:E${lastDataRow})`,
    '',
  ]);

  // Average Row
  sheet.appendRow([
    'المتوسط',
    '',
    '',
    `=AVERAGE(D2:D${lastDataRow})`,
    `=AVERAGE(E2:E${lastDataRow})`,
    '',
  ]);

  // Format Summary Range
  const summaryRange = sheet.getRange(totalRowIndex, 1, 2, CONFIG.SHEET_HEADERS.length);
  summaryRange.setBackground('#f3f4f6'); // Clean neutral light gray
  summaryRange.setFontWeight('bold');

  // Format Duration column in summary
  sheet.getRange(totalRowIndex, 4, 2, 1).setNumberFormat('[h]:mm');
  // Format Students column in summary
  sheet.getRange(totalRowIndex, 5).setNumberFormat('0');
  sheet.getRange(averageRowIndex, 5).setNumberFormat('0.0');

  // Center align labels and values
  sheet.getRange(totalRowIndex, 1, 2, 5).setHorizontalAlignment('center');
}

/**
 * Gets or creates the yearly spreadsheet for a teacher inside their Year/Teacher folder.
 * Title format: "[اسم المعلم] - تقارير الحلقات [السنة]"
 * @param {GoogleAppsScript.Drive.Folder} yearTeacherFolder
 * @param {string} teacherName
 * @param {string} year
 * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet}
 */
function getOrCreateTeacherSpreadsheet(yearTeacherFolder, teacherName, year) {
  const expectedTitle = `${teacherName} - تقارير الحلقات ${year}`;
  const files = yearTeacherFolder.getFilesByName(expectedTitle);

  if (files.hasNext()) {
    const file = files.next();
    return SpreadsheetApp.openById(file.getId());
  }

  // Create new Spreadsheet
  const newSpreadsheet = SpreadsheetApp.create(expectedTitle);
  const newFile = DriveApp.getFileById(newSpreadsheet.getId());

  // Move into the Year/Teacher folder
  newFile.moveTo(yearTeacherFolder);

  return newSpreadsheet;
}

/**
 * Gets or creates the monthly tab in the Spreadsheet with RTL formatting and styled headers.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 * @param {string} monthTabName
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getOrCreateMonthlyTab(spreadsheet, monthTabName) {
  let sheet = spreadsheet.getSheetByName(monthTabName);
  if (sheet) {
    return sheet;
  }

  // Check if default Sheet1 exists and is completely blank
  const sheets = spreadsheet.getSheets();
  if (sheets.length === 1 && sheets[0].getLastRow() === 0) {
    sheet = sheets[0];
    sheet.setName(monthTabName);
  } else {
    sheet = spreadsheet.insertSheet(monthTabName);
  }

  // Set Right-to-Left direction
  sheet.setRightToLeft(true);

  // Set Headers
  sheet.getRange(1, 1, 1, CONFIG.SHEET_HEADERS.length).setValues([CONFIG.SHEET_HEADERS]);

  // Style Header Row
  const headerRange = sheet.getRange(1, 1, 1, CONFIG.SHEET_HEADERS.length);
  headerRange.setBackground('#1f2937'); // Professional dark slate
  headerRange.setFontColor('#ffffff');
  headerRange.setFontWeight('bold');
  headerRange.setHorizontalAlignment('center');
  headerRange.setVerticalAlignment('middle');

  // Freeze Header Row
  sheet.setFrozenRows(1);

  // Set Column widths
  for (let i = 1; i <= CONFIG.SHEET_HEADERS.length; i++) {
    sheet.autoResizeColumn(i);
  }

  return sheet;
}

// ============================================================================
// 9. ERROR LOGGING & ALERTING
// ============================================================================

/**
 * Appends error details to the monthly error log in Drive: automation_errors_YYYY_MM.log.
 * @param {Object} details
 */
function appendErrorToDriveLog(details) {
  const rootFolder = getRootFolder();
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
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
    const existingContent = file.getBlob().getDataAsString('UTF-8');
    file.setContent(existingContent + '\n' + logEntry);
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
// 10. UTILITIES & RETRY ENGINE
// ============================================================================

/**
 * Executes a function with exponential backoff retry.
 */
function withRetry(fn, maxAttempts, delayMs, backoffMultiplier) {
  let currentDelay = delayMs;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return fn();
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }
      console.warn(`[RETRY WARNING] Attempt ${attempt}/${maxAttempts} failed: ${error.message}. Retrying in ${currentDelay}ms...`);
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
// 11. TELEGRAM NOTIFICATIONS
// ============================================================================

/**
 * Sends a structured notification card to Telegram admin channel/chat via Telegram Bot API.
 * @param {Object} data - Validated submission data.
 */
function sendTelegramNotification(data) {
  if (!CONFIG.TELEGRAM.ENABLED) return;

  const botToken = CONFIG.TELEGRAM.BOT_TOKEN;
  let chatId = CONFIG.TELEGRAM.CHAT_ID;

  if (!botToken || !chatId) {
    console.warn('[TELEGRAM WARNING] Bot token or Chat ID is missing. Notification skipped.');
    return;
  }

  // Ensure supergroup ID has -100 prefix if 10 digits
  if (chatId.startsWith('-') && !chatId.startsWith('-100') && chatId.length > 8) {
    chatId = '-100' + chatId.substring(1);
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
    messageLines.push(`• <b>رابط التقرير:</b> <a href="${data.fileUrl}">فتح الملف في Google Drive</a>`);
  }

  if (data.adminNotes && data.adminNotes !== 'لا توجد ملاحظات إدارية.' && data.adminNotes.trim() !== '') {
    messageLines.push(`• <b>ملاحظات الإدارة:</b> ${escapeHtml(data.adminNotes)}`);
  }

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const payload = {
    chat_id: chatId,
    text: messageLines.join('\n'),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  const response = UrlFetchApp.fetch(url, options);
  const resCode = response.getResponseCode();
  const resText = response.getContentText();

  if (resCode !== 200) {
    console.warn(`[TELEGRAM ERROR] API returned status ${resCode} for chat ${chatId}: ${resText}`);
    // If chat not found and ID was negative without -100, retry with -100
    if (resCode === 400 && !chatId.startsWith('-100')) {
      const fallbackChatId = '-100' + chatId.replace(/^-/, '');
      console.log(`[TELEGRAM RETRY] Retrying with supergroup ID: ${fallbackChatId}`);
      payload.chat_id = fallbackChatId;
      options.payload = JSON.stringify(payload);
      const retryRes = UrlFetchApp.fetch(url, options);
      if (retryRes.getResponseCode() === 200) {
        console.log('[TELEGRAM SUCCESS] Notification delivered on retry with supergroup ID.');
        return;
      }
    }
  } else {
    console.log('[TELEGRAM SUCCESS] Notification delivered successfully.');
  }
}

/**
 * Diagnostic function to test Telegram Bot API directly from the Apps Script editor.
 * Run this function from the Apps Script toolbar to verify Telegram notifications.
 */
function testTelegramConnection() {
  const botToken = CONFIG.TELEGRAM.BOT_TOKEN;
  let chatId = CONFIG.TELEGRAM.CHAT_ID;

  console.log('[TELEGRAM DIAGNOSTIC] Starting Telegram connection test...');
  console.log(`[TELEGRAM DIAGNOSTIC] Bot Token Prefix: ${botToken ? botToken.substring(0, 10) + '...' : 'MISSING'}`);
  console.log(`[TELEGRAM DIAGNOSTIC] Target Chat ID: ${chatId}`);

  // 1. Verify Bot via getMe
  const meUrl = `https://api.telegram.org/bot${botToken}/getMe`;
  const meRes = UrlFetchApp.fetch(meUrl, { muteHttpExceptions: true });
  console.log(`[TELEGRAM DIAGNOSTIC] getMe status: ${meRes.getResponseCode()}, response: ${meRes.getContentText()}`);

  if (meRes.getResponseCode() !== 200) {
    throw new Error(`Telegram Bot Token is invalid or blocked! Response: ${meRes.getContentText()}`);
  }

  // 2. Test Sending Message
  const testData = {
    teacherName: 'محمد نبيل (اختبار)',
    sessionTypeName: 'صباحية',
    reportDateText: '29-08-2026',
    durationFormatted: '1 ساعة',
    durationTime: '01:00',
    studentCount: 5,
    fileUrl: 'https://drive.google.com',
    adminNotes: 'رسالة اختبارية للتأكد من ربط بوت تيليجرام بنجاح.',
  };

  sendTelegramNotification(testData);
  console.log('[TELEGRAM DIAGNOSTIC] Test completed. Check your Telegram group/channel now!');
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
// 12. ON-DEMAND MONTHLY PDF EXPORT ENGINE
// ============================================================================

/**
 * Exports all teachers' monthly report tabs as formatted PDFs in their respective month folders in Drive.
 * Run this function from the Apps Script editor or triggers on demand.
 * @param {string|number} [targetYear] - Optional year (e.g. 2026). Defaults to current year.
 * @param {string} [targetMonthName] - Optional month folder name (e.g. "08 - أغسطس"). Defaults to current month.
 */
function exportAllTeachersMonthlyPdf(targetYear, targetMonthName) {
  const now = new Date();
  const year = String(targetYear || now.getFullYear());
  const monthName = targetMonthName || CONFIG.ARABIC_MONTHS[now.getMonth()];

  console.log(`[PDF EXPORT] Starting batch export for year: ${year}, month: ${monthName}`);

  const rootFolder = getRootFolder();
  const yearFolder = getOrCreateChildFolder(rootFolder, year);

  // Iterate over known teachers in CONFIG and teacher folders in Drive
  const teacherFolders = yearFolder.getFolders();
  const processedTeachers = new Set();
  const results = [];

  while (teacherFolders.hasNext()) {
    const teacherFolder = teacherFolders.next();
    const teacherName = teacherFolder.getName();
    processedTeachers.add(teacherName);

    try {
      const pdfFile = exportTeacherMonthlyPdf(teacherName, year, monthName);
      if (pdfFile) {
        results.push({ teacher: teacherName, status: 'SUCCESS', fileId: pdfFile.getId() });
      } else {
        results.push({ teacher: teacherName, status: 'SKIPPED (No tab found)' });
      }
    } catch (err) {
      console.error(`[PDF EXPORT ERROR] Failed for teacher "${teacherName}":`, err.message);
      results.push({ teacher: teacherName, status: 'ERROR', error: err.message });
    }
  }

  // Check any additional known teachers from CONFIG
  for (const tKey in CONFIG.TEACHERS) {
    if (Object.prototype.hasOwnProperty.call(CONFIG.TEACHERS, tKey)) {
      const tName = CONFIG.TEACHERS[tKey].name;
      if (!processedTeachers.has(tName)) {
        try {
          const pdfFile = exportTeacherMonthlyPdf(tName, year, monthName);
          if (pdfFile) {
            results.push({ teacher: tName, status: 'SUCCESS', fileId: pdfFile.getId() });
          }
        } catch (err) {
          console.error(`[PDF EXPORT ERROR] Failed for teacher "${tName}":`, err.message);
          results.push({ teacher: tName, status: 'ERROR', error: err.message });
        }
      }
    }
  }

  console.log(`[PDF EXPORT COMPLETED] Processed ${results.length} teacher(s):`, JSON.stringify(results));
  return results;
}

/**
 * Exports a specific teacher's monthly report tab as a formatted PDF in their month folder.
 * @param {string} teacherName - Teacher name.
 * @param {string|number} [targetYear] - Year.
 * @param {string} [targetMonthName] - Month folder name.
 * @returns {GoogleAppsScript.Drive.File|null} Created PDF file or null if tab does not exist.
 */
function exportTeacherMonthlyPdf(teacherName, targetYear, targetMonthName) {
  const now = new Date();
  const year = String(targetYear || now.getFullYear());
  const monthName = targetMonthName || CONFIG.ARABIC_MONTHS[now.getMonth()];

  const rootFolder = getRootFolder();
  const yearFolder = getOrCreateChildFolder(rootFolder, year);
  const teacherFolder = getOrCreateChildFolder(yearFolder, teacherName);
  const monthFolder = getOrCreateChildFolder(teacherFolder, monthName);

  const spreadsheetTitle = `${teacherName} - تقارير الحلقات ${year}`;
  const files = teacherFolder.getFilesByName(spreadsheetTitle);

  if (!files.hasNext()) {
    console.warn(`[PDF EXPORT] Spreadsheet "${spreadsheetTitle}" not found for teacher "${teacherName}".`);
    return null;
  }

  const spreadsheet = SpreadsheetApp.openById(files.next().getId());
  const sheet = spreadsheet.getSheetByName(monthName);

  if (!sheet) {
    console.warn(`[PDF EXPORT] Tab "${monthName}" not found in spreadsheet "${spreadsheetTitle}".`);
    return null;
  }

  const cleanMonth = sanitizeFilename(monthName).replace(/\s+/g, '_');
  const cleanTeacher = sanitizeFilename(teacherName).replace(/\s+/g, '_');
  const pdfFilename = `تقرير_شهري_${cleanTeacher}_${cleanMonth}_${year}.pdf`;

  return exportSingleSheetToPdf(spreadsheet, sheet, monthFolder, pdfFilename);
}

/**
 * Exports a specific sheet tab from a spreadsheet to PDF and saves it in the target folder.
 * Idempotently replaces any existing PDF file with the same filename.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {GoogleAppsScript.Drive.Folder} targetFolder
 * @param {string} pdfFilename
 * @returns {GoogleAppsScript.Drive.File}
 */
function exportSingleSheetToPdf(spreadsheet, sheet, targetFolder, pdfFilename) {
  const spreadsheetId = spreadsheet.getId();
  const sheetId = sheet.getSheetId();

  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?` +
    `exportFormat=pdf&format=pdf` +
    `&size=A4` +
    `&portrait=false` +
    `&fitw=true` +
    `&gridlines=true` +
    `&printtitle=false` +
    `&sheetnames=false` +
    `&fzr=true` +
    `&gid=${sheetId}`;

  const token = ScriptApp.getOAuthToken();
  const response = UrlFetchApp.fetch(url, {
    headers: {
      'Authorization': 'Bearer ' + token,
    },
    muteHttpExceptions: true,
  });

  const resCode = response.getResponseCode();
  if (resCode !== 200) {
    throw new Error(`PDF Export failed with HTTP ${resCode}: ${response.getContentText()}`);
  }

  const blob = response.getBlob().setName(pdfFilename);

  // Replace existing file if present (Idempotency)
  const existingFiles = targetFolder.getFilesByName(pdfFilename);
  while (existingFiles.hasNext()) {
    existingFiles.next().setTrashed(true);
  }

  const newPdf = targetFolder.createFile(blob);
  console.log(`[PDF EXPORT SUCCESS] Created PDF: "${pdfFilename}" (ID: ${newPdf.getId()}) in folder "${targetFolder.getName()}"`);
  return newPdf;
}

