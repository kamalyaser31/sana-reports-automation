/**
 * ============================================================================
 * Sana Academy Reports Automation (Version 3 - Final Release)
 * ============================================================================
 * Automates receiving Google Form/Sheets submissions for Sana Academy reports,
 * validates data (saving reports even with missing fields), and stores structured
 * UTF-8 Markdown files in Google Drive under: Root / Year / Teacher / Month.
 * Logs failures to monthly automation_errors_YYYY_MM.log files in the Root folder.
 * ============================================================================
 */

// ============================================================================
// 1. CONFIGURATION
// ============================================================================
const CONFIG = {
  // Required: Target Google Drive Root Folder ID.
  // Read fresh on every access so runtime changes to Script Properties take effect immediately.
  get ROOT_FOLDER_ID() {
    return PropertiesService.getScriptProperties().getProperty('ROOT_FOLDER_ID') || '';
  },

  // Fallback Root Folder Name for log references
  ROOT_FOLDER_NAME: 'تقرير حلقات أكاديمية سنا',

  // Error Log File Name prefix inside Root Folder.
  // Actual filename is monthly: automation_errors_YYYY_MM.log (managed by getMonthlyErrorLogFilename)
  ERROR_LOG_FILENAME_PREFIX: 'automation_errors',

  // Alert Email Address for Fatal Failures.
  // Read fresh on every access so runtime changes to Script Properties take effect immediately.
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

  // Internal Teacher Mappings.
  // MAINTENANCE: Keys must match the Google Form dropdown values EXACTLY (copy-paste to avoid typos).
  // When a teacher's display name changes in the Form, add the new name here with the SAME id.
  // Never reuse or change an existing id — downstream AI processing depends on id stability.
  TEACHERS: {
    'محمد نبيل': { id: 'T001', name: 'محمد نبيل' },
    'أسماء علي': { id: 'T002', name: 'أسماء علي' },
  },

  // Internal Session Mappings.
  // MAINTENANCE: Keys must match the Google Form dropdown values EXACTLY.
  // Add new session types here with a new unique id; never reuse or remove existing ids.
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

  // Google Form / Sheets Exact Field Names
  FIELDS: {
    TEACHER: 'اسم المعلم',
    SESSION_TYPE: 'نوع الحلقة',
    STUDENT_CATEGORY: 'فئة الطلاب',
    REPORT_DATE: 'تاريخ التقرير',
    DURATION: 'مدة الحصة',
    STUDENT_COUNT: 'عدد الطلاب',
    REPORT_TEXT: 'التقرير',
    ADMIN_NOTES: 'ملاحظات خاصة للإدارة',
  },

  // Fallback Values for Missing Data Preservation
  FALLBACKS: {
    TEACHER_NAME: 'معلم غير محدد',
    TEACHER_ID: 'T_UNKNOWN',
    SESSION_TYPE: 'حلقة غير محددة',
    SESSION_ID: 'SESSION_UNKNOWN',
    STUDENT_CATEGORY: 'غير محدد',
    DURATION: 'غير محدد',
    STUDENT_COUNT: 0,
    REPORT_TEXT: 'لم يُكتب تقرير في هذا الحقل.',
    ADMIN_NOTES: 'لا توجد ملاحظات خاصة للإدارة.',
  },
};

// ============================================================================
// 2. TRIGGER HANDLER & PIPELINE
// ============================================================================

/**
 * Main entry point for the installable Spreadsheet/Form submit trigger.
 * @param {Object} e - Trigger event object.
 */
function onFormSubmit(e) {
  const executionId = Utilities.getUuid();
  const lock = LockService.getScriptLock();

  try {
    const hasLock = lock.tryLock(CONFIG.LOCK_TIMEOUT_MS);
    if (!hasLock) {
      throw new Error('Lock acquisition timeout: another execution is currently processing.');
    }

    withRetry(() => {
      executeSubmissionPipeline(e, executionId);
    }, CONFIG.RETRY.MAX_ATTEMPTS, executionId);

  } catch (error) {
    handleFatalError(error, executionId);
  } finally {
    try {
      lock.releaseLock();
    } catch (_) {
      // Ignore errors when releasing lock
    }
  }
}

/**
 * Sequential processing pipeline.
 * Flow: Extraction -> Validation -> Folder Resolution -> Duplicate Check -> Markdown -> Creation -> Verification.
 * @param {Object} e - Event object.
 * @param {string} executionId - Execution UUID.
 */
function executeSubmissionPipeline(e, executionId) {
  // Step 1: Extract form response values
  const rawData = extractFormData(e);

  // Step 2: Validate fields (identifies missing fields without aborting)
  const validatedData = validateFormData(rawData, executionId);

  // Step 3: Resolve root and hierarchical Drive folders
  const targetFolder = resolveTargetFolder(validatedData);

  // Step 4: Resolve unique filename and check duplicate state
  const fileResolution = resolveFileNameAndDuplicateState(targetFolder, validatedData);

  // Step 5: Generate sanitized Markdown content
  const markdownContent = generateMarkdown(validatedData, fileResolution);

  // Step 6: Create UTF-8 Markdown file in Google Drive
  const createdFile = saveMarkdownFile(targetFolder, fileResolution.fileName, markdownContent);

  // Step 7: Verify created file integrity
  verifyCreatedFile(createdFile, fileResolution.fileName);
}

// ============================================================================
// 3. DATA EXTRACTION
// ============================================================================

/**
 * Safely extracts field values from Spreadsheet-bound or Form-bound events.
 * @param {Object} e - Event object.
 * @returns {Object} Extracted raw values.
 */
function extractFormData(e) {
  if (!e) {
    throw new Error('Missing event object (e is null or undefined).');
  }

  const responses = {};

  // Primary: Spreadsheet-bound trigger (e.namedValues)
  if (e.namedValues) {
    for (const key in e.namedValues) {
      const cleanKey = key.trim();
      const val = e.namedValues[key];
      responses[cleanKey] = Array.isArray(val) ? val[0] : val;
    }
  }
  // Fallback: Form-bound trigger (e.response.getItemResponses)
  else if (e.response && typeof e.response.getItemResponses === 'function') {
    const itemResponses = e.response.getItemResponses();
    for (let i = 0; i < itemResponses.length; i++) {
      const title = itemResponses[i].getItem().getTitle().trim();
      responses[title] = itemResponses[i].getResponse();
    }
  }
  // Mock event support for test simulation
  else if (e.mockData) {
    Object.assign(responses, e.mockData);
  } else {
    throw new Error('Unrecognized event structure: neither namedValues nor itemResponses found.');
  }

  return {
    teacherName: getSafeString(responses[CONFIG.FIELDS.TEACHER]),
    sessionType: getSafeString(responses[CONFIG.FIELDS.SESSION_TYPE]),
    studentCategory: getSafeString(responses[CONFIG.FIELDS.STUDENT_CATEGORY]),
    reportDateRaw: responses[CONFIG.FIELDS.REPORT_DATE],
    duration: getSafeString(responses[CONFIG.FIELDS.DURATION]),
    studentCountRaw: responses[CONFIG.FIELDS.STUDENT_COUNT],
    reportText: getSafeString(responses[CONFIG.FIELDS.REPORT_TEXT]),
    adminNotes: getSafeString(responses[CONFIG.FIELDS.ADMIN_NOTES]),
  };
}

// ============================================================================
// 4. DATA VALIDATION (NON-DESTRUCTIVE)
// ============================================================================

/**
 * Validates fields and assigns fallbacks for missing data instead of throwing errors.
 * Preserves every submission while recording missing field details.
 * @param {Object} data - Raw extracted values.
 * @param {string} executionId - Execution UUID.
 * @returns {Object} Structured data with validation status.
 */
function validateFormData(data, executionId) {
  const missingFields = [];
  const validationErrors = [];

  // Teacher validation & fallback
  let teacherName = CONFIG.FALLBACKS.TEACHER_NAME;
  let teacherId = CONFIG.FALLBACKS.TEACHER_ID;
  if (!data.teacherName) {
    missingFields.push(CONFIG.FIELDS.TEACHER);
  } else if (CONFIG.TEACHERS[data.teacherName]) {
    teacherName = CONFIG.TEACHERS[data.teacherName].name;
    teacherId = CONFIG.TEACHERS[data.teacherName].id;
  } else {
    teacherName = data.teacherName;
    validationErrors.push(`Unmapped teacher: "${data.teacherName}"`);
  }

  // Session type validation & fallback
  let sessionType = CONFIG.FALLBACKS.SESSION_TYPE;
  let sessionId = CONFIG.FALLBACKS.SESSION_ID;
  if (!data.sessionType) {
    missingFields.push(CONFIG.FIELDS.SESSION_TYPE);
  } else if (CONFIG.SESSIONS[data.sessionType]) {
    sessionType = CONFIG.SESSIONS[data.sessionType].name;
    sessionId = CONFIG.SESSIONS[data.sessionType].id;
  } else {
    sessionType = data.sessionType;
    validationErrors.push(`Unmapped session type: "${data.sessionType}"`);
  }

  // Student category validation
  let studentCategory = data.studentCategory;
  if (!studentCategory) {
    missingFields.push(CONFIG.FIELDS.STUDENT_CATEGORY);
    studentCategory = CONFIG.FALLBACKS.STUDENT_CATEGORY;
  }

  // Date parsing & fallback
  let dateInfo;
  let dateIsSystemFallback = false;
  if (!data.reportDateRaw) {
    missingFields.push(CONFIG.FIELDS.REPORT_DATE);
    dateInfo = getFallbackDateInfo();
    dateIsSystemFallback = true;
  } else {
    try {
      dateInfo = parseReportDate(data.reportDateRaw);
    } catch (err) {
      validationErrors.push(`Invalid date format: ${err.message}`);
      dateInfo = getFallbackDateInfo();
      dateIsSystemFallback = true;
    }
  }

  // Duration validation
  let duration = data.duration;
  if (!duration) {
    missingFields.push(CONFIG.FIELDS.DURATION);
    duration = CONFIG.FALLBACKS.DURATION;
  }

  // Student count validation
  let studentCount = parseInt(data.studentCountRaw, 10);
  if (!data.studentCountRaw || data.studentCountRaw.trim() === '') {
    missingFields.push(CONFIG.FIELDS.STUDENT_COUNT);
    studentCount = CONFIG.FALLBACKS.STUDENT_COUNT;
  } else if (isNaN(studentCount) || studentCount < 0) {
    validationErrors.push(`Invalid student count: "${data.studentCountRaw}"`);
    studentCount = CONFIG.FALLBACKS.STUDENT_COUNT;
  }

  // Report text validation
  let reportText = data.reportText;
  if (!reportText) {
    missingFields.push(CONFIG.FIELDS.REPORT_TEXT);
    reportText = CONFIG.FALLBACKS.REPORT_TEXT;
  }

  // Determine overall validation status
  let validationStatus = 'VALID';
  if (missingFields.length > 0 && validationErrors.length > 0) {
    validationStatus = 'MISSING_AND_INVALID_DATA';
  } else if (missingFields.length > 0) {
    validationStatus = 'MISSING DATA';
  } else if (validationErrors.length > 0) {
    validationStatus = 'INVALID DATA';
  }

  return {
    reportId: Utilities.getUuid(),
    executionId: executionId,
    timestamp: new Date().toISOString(),
    teacherName: teacherName,
    teacherId: teacherId,
    sessionType: sessionType,
    sessionId: sessionId,
    studentCategory: studentCategory,
    dateInfo: dateInfo,
    dateIsSystemFallback: dateIsSystemFallback,
    duration: duration,
    studentCount: studentCount,
    reportText: reportText,
    adminNotes: data.adminNotes || '',
    validationStatus: validationStatus,
    missingFields: missingFields,
    validationErrors: validationErrors,
  };
}

/**
 * Parses raw date input into structured year, Arabic month folder, and DD-MM-YYYY string.
 * @param {string|Date} rawDate
 * @returns {Object}
 */
function parseReportDate(rawDate) {
  let year, month, day;

  if (rawDate instanceof Date) {
    year = rawDate.getFullYear();
    month = rawDate.getMonth() + 1;
    day = rawDate.getDate();
  } else {
    const str = String(rawDate).trim();
    const isoMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    const dmyMatch = str.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);

    if (isoMatch) {
      year = parseInt(isoMatch[1], 10);
      month = parseInt(isoMatch[2], 10);
      day = parseInt(isoMatch[3], 10);
    } else if (dmyMatch) {
      day = parseInt(dmyMatch[1], 10);
      month = parseInt(dmyMatch[2], 10);
      year = parseInt(dmyMatch[3], 10);
    } else {
      const parsed = new Date(str);
      if (isNaN(parsed.getTime())) {
        throw new Error(`Unrecognized date string: "${str}"`);
      }
      year = parsed.getFullYear();
      month = parsed.getMonth() + 1;
      day = parsed.getDate();
    }
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error(`Date out of range: Day=${day}, Month=${month}, Year=${year}`);
  }

  const paddedDay = String(day).padStart(2, '0');
  const paddedMonth = String(month).padStart(2, '0');
  const formattedDate = `${paddedDay}-${paddedMonth}-${year}`;
  const monthFolder = CONFIG.ARABIC_MONTHS[month - 1];

  return {
    year: String(year),
    monthFolder: monthFolder,
    formattedDate: formattedDate,
  };
}

/**
 * Generates fallback date info using current project script timezone.
 * @returns {Object}
 */
function getFallbackDateInfo() {
  const now = new Date();
  const timeZone = Session.getScriptTimeZone();
  const year = Utilities.formatDate(now, timeZone, 'yyyy');
  const monthIndex = parseInt(Utilities.formatDate(now, timeZone, 'M'), 10) - 1;
  const formattedDate = Utilities.formatDate(now, timeZone, 'dd-MM-yyyy');

  return {
    year: year,
    monthFolder: CONFIG.ARABIC_MONTHS[monthIndex],
    formattedDate: formattedDate,
  };
}

// ============================================================================
// 5. FOLDER MANAGEMENT
// ============================================================================

/**
 * Navigates and creates hierarchical path: Root / Year / Teacher / Month.
 * Requires a valid ROOT_FOLDER_ID configured in CONFIG or Script Properties.
 * @param {Object} validData - Validated payload.
 * @returns {GoogleAppsScript.Drive.Folder}
 */
function resolveTargetFolder(validData) {
  const root = getStrictRootFolder();
  const yearFolder = getOrCreateChildFolder(root, sanitizeFileNamePart(validData.dateInfo.year));
  const teacherFolder = getOrCreateChildFolder(yearFolder, sanitizeFileNamePart(validData.teacherName));
  const monthFolder = getOrCreateChildFolder(teacherFolder, sanitizeFileNamePart(validData.dateInfo.monthFolder));
  return monthFolder;
}

/**
 * Gets the strictly configured Root Folder by ID.
 * Throws a fatal error if ROOT_FOLDER_ID is missing or not accessible.
 * @returns {GoogleAppsScript.Drive.Folder}
 */
function getStrictRootFolder() {
  const rootId = CONFIG.ROOT_FOLDER_ID;
  if (!rootId || typeof rootId !== 'string' || rootId.trim() === '') {
    // Attempt lookup by name if ID was not specified
    const folders = DriveApp.getFoldersByName(CONFIG.ROOT_FOLDER_NAME);
    if (folders.hasNext()) {
      const found = folders.next();
      PropertiesService.getScriptProperties().setProperty('ROOT_FOLDER_ID', found.getId());
      return found;
    }
    throw new Error(`Root folder ID is not configured. Please set ROOT_FOLDER_ID in script properties or create folder "${CONFIG.ROOT_FOLDER_NAME}".`);
  }

  try {
    return DriveApp.getFolderById(rootId.trim());
  } catch (err) {
    throw new Error(`Failed to access configured Root Folder ID "${rootId}": ${err.message}`);
  }
}

/**
 * Finds child folder by name or creates it inside parent folder.
 * If multiple folders share the same name under the same parent (Drive allows this),
 * the first result is used deterministically and a console warning is emitted.
 * @param {GoogleAppsScript.Drive.Folder} parent
 * @param {string} name
 * @returns {GoogleAppsScript.Drive.Folder}
 */
function getOrCreateChildFolder(parent, name) {
  const subFolders = parent.getFoldersByName(name);
  if (subFolders.hasNext()) {
    const first = subFolders.next();
    if (subFolders.hasNext()) {
      console.warn(`[WARN] Multiple folders named "${name}" found inside "${parent.getName()}". Using the first result.`);
    }
    return first;
  }
  return parent.createFolder(name);
}

// ============================================================================
// 6. FILE MANAGEMENT, SANITIZATION & DUPLICATE RESOLUTION
// ============================================================================

/**
 * Sanitizes dynamic strings for filesystem path safety.
 * @param {string} text
 * @returns {string}
 */
function sanitizeFileNamePart(text) {
  return String(text || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\x00-\x1F\x7F]/g, '')
    .trim();
}

/**
 * Sanitizes text content to prevent breaking Markdown and YAML frontmatter.
 * @param {string} text
 * @returns {string}
 */
function sanitizeMarkdownText(text) {
  if (!text) return '';
  return String(text)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Prevent breaking horizontal rules or frontmatter boundaries
    .replace(/^---$/gm, '— — —');
}

/**
 * Checks for existing files and determines duplicate state.
 * @param {GoogleAppsScript.Drive.Folder} targetFolder
 * @param {Object} validData
 * @returns {Object}
 */
function resolveFileNameAndDuplicateState(targetFolder, validData) {
  const safeDate = sanitizeFileNamePart(validData.dateInfo.formattedDate);
  const safeSession = sanitizeFileNamePart(validData.sessionType);
  const safeTeacher = sanitizeFileNamePart(validData.teacherName);

  const baseName = `${safeDate}_${safeSession}_${safeTeacher}`;
  const extension = '.md';
  const primaryName = `${baseName}${extension}`;

  const hasCollision = targetFolder.getFilesByName(primaryName).hasNext();
  if (!hasCollision) {
    return {
      fileName: primaryName,
      isDuplicate: false,
      duplicateIndex: 0,
    };
  }

  let counter = 1;
  let candidateName = `${baseName} (${counter})${extension}`;
  while (targetFolder.getFilesByName(candidateName).hasNext()) {
    counter++;
    candidateName = `${baseName} (${counter})${extension}`;
  }

  return {
    fileName: candidateName,
    isDuplicate: true,
    duplicateIndex: counter,
  };
}

/**
 * Writes the UTF-8 encoded Markdown document into Google Drive.
 * @param {GoogleAppsScript.Drive.Folder} folder
 * @param {string} fileName
 * @param {string} content
 * @returns {GoogleAppsScript.Drive.File}
 */
function saveMarkdownFile(folder, fileName, content) {
  const blob = Utilities.newBlob(content, 'text/markdown; charset=UTF-8', fileName);
  return folder.createFile(blob);
}

/**
 * Verifies that the file was successfully created with a non-empty ID.
 * @param {GoogleAppsScript.Drive.File} file
 * @param {string} expectedName
 */
function verifyCreatedFile(file, expectedName) {
  if (!file) {
    throw new Error(`File verification failed: Null file object returned for "${expectedName}".`);
  }
  const fileId = file.getId();
  if (!fileId || typeof fileId !== 'string' || fileId.trim() === '') {
    throw new Error(`File verification failed: Invalid file ID returned for "${expectedName}".`);
  }
}

// ============================================================================
// 7. MARKDOWN GENERATOR
// ============================================================================

/**
 * Builds standard Markdown document with safe YAML frontmatter and clear body sections.
 * @param {Object} d - Validated submission data.
 * @param {Object} fileRes - Duplicate state resolution.
 * @returns {string} Markdown text.
 */
function generateMarkdown(d, fileRes) {
  const adminNotesClean = sanitizeMarkdownText(d.adminNotes || CONFIG.FALLBACKS.ADMIN_NOTES);
  const reportTextClean = sanitizeMarkdownText(d.reportText);

  // Date source label for AI processing clarity
  const dateSource = d.dateIsSystemFallback ? 'FALLBACK_SYSTEM_DATE' : 'FORM_INPUT';
  const dateSourceDisplay = d.dateIsSystemFallback
    ? 'تاريخ النظام (بديل — التاريخ الأصلي غير متوفر)'
    : 'تاريخ التقرير (أدخله المعلم)';

  // Missing fields formatting
  let missingFieldsYaml = '[]';
  let missingFieldsBody = '';
  if (d.missingFields && d.missingFields.length > 0) {
    missingFieldsYaml = JSON.stringify(d.missingFields);
    missingFieldsBody = `\n> [!WARNING]\n> **حقول ناقصة:** ${d.missingFields.join('، ')}\n`;
  }

  // Report status formatting in body
  const reportStatusDisplay = fileRes.isDuplicate
    ? `تقرير مكرر (نسخة رقم ${fileRes.duplicateIndex})`
    : 'تقرير أصيل (أول إرسال)';

  return `---
report_id: ${JSON.stringify(d.reportId)}
execution_id: ${JSON.stringify(d.executionId)}
submission_timestamp: ${JSON.stringify(d.timestamp)}
teacher_name: ${JSON.stringify(d.teacherName)}
teacher_id: ${JSON.stringify(d.teacherId)}
session_type: ${JSON.stringify(d.sessionType)}
session_id: ${JSON.stringify(d.sessionId)}
student_category: ${JSON.stringify(d.studentCategory)}
report_date: ${JSON.stringify(d.dateInfo.formattedDate)}
date_source: ${JSON.stringify(dateSource)}
duration: ${JSON.stringify(d.duration)}
student_count: ${d.studentCount}
validation_status: ${JSON.stringify(d.validationStatus)}
missing_fields: ${missingFieldsYaml}
is_duplicate: ${fileRes.isDuplicate}
duplicate_index: ${fileRes.duplicateIndex}
report_status: ${JSON.stringify(fileRes.isDuplicate ? 'Duplicate submission' : 'Original submission')}
---

# تقرير حلقة: ${d.sessionType} — ${d.teacherName}

- **اسم المعلم:** ${d.teacherName} (\`${d.teacherId}\`)
- **نوع الحلقة:** ${d.sessionType} (\`${d.sessionId}\`)
- **فئة الطلاب:** ${d.studentCategory}
- **تاريخ التقرير:** ${d.dateInfo.formattedDate}
- **مصدر التاريخ:** ${dateSourceDisplay}
- **مدة الحصة:** ${d.duration}
- **عدد الطلاب:** ${d.studentCount}
- **حالة التحقق:** ${d.validationStatus}
- **حالة التقرير (Report Status):** ${reportStatusDisplay}
${missingFieldsBody}
---

## نص التقرير

${reportTextClean}

---

## ملاحظات خاصة للإدارة

${adminNotesClean}
`;
}

// ============================================================================
// 8. RETRY HANDLER
// ============================================================================

/**
 * Generic retry wrapper with exponential backoff.
 * @param {Function} operation
 * @param {number} maxAttempts
 * @param {string} executionId
 */
function withRetry(operation, maxAttempts, executionId) {
  if (maxAttempts < 1) {
    throw new Error(`withRetry: maxAttempts must be >= 1, got ${maxAttempts}.`);
  }

  let attempt = 0;
  let delay = CONFIG.RETRY.INITIAL_DELAY_MS;

  while (attempt < maxAttempts) {
    try {
      attempt++;
      return operation();
    } catch (err) {
      if (attempt >= maxAttempts) {
        throw err;
      }
      Utilities.sleep(delay);
      delay *= CONFIG.RETRY.BACKOFF_MULTIPLIER;
    }
  }
}

// ============================================================================
// 9. ERROR LOGGING & NOTIFICATION SERVICE
// ============================================================================

/**
 * Centralized error handler: logs failure to Drive error log file, console, and sends alert email.
 * @param {Error} error
 * @param {string} executionId
 */
function handleFatalError(error, executionId) {
  const timestamp = new Date().toISOString();
  const errorMessage = error.message || String(error);
  const errorStack = error.stack || 'No stack trace available.';

  // 1. Console Failure Log
  console.error(`[FATAL ERROR] [ExecutionID: ${executionId}] [Timestamp: ${timestamp}] ${errorMessage}\nStack: ${errorStack}`);

  // 2. Persist to actual automation_errors.log in Google Drive Root Folder
  try {
    appendErrorToDriveLog(executionId, timestamp, errorMessage, errorStack);
  } catch (logErr) {
    console.error(`Failed to write to Drive error log file: ${logErr.message}`);
  }

  // 3. Dispatch Email Alert with Fallback
  try {
    sendAlertNotification(executionId, timestamp, errorMessage, errorStack);
  } catch (emailErr) {
    console.error(`Failed to send alert email: ${emailErr.message}`);
  }
}

/**
 * Appends a structured error record to a monthly log file inside the Root Folder.
 * Log filename format: automation_errors_YYYY_MM.log
 * A new file is created automatically each month.
 * @param {string} executionId
 * @param {string} timestamp
 * @param {string} message
 * @param {string} stack
 */
function appendErrorToDriveLog(executionId, timestamp, message, stack) {
  let rootFolder;
  try {
    rootFolder = getStrictRootFolder();
  } catch (_) {
    // If root folder is completely inaccessible, cannot append to Drive log
    return;
  }

  const logFileName = getMonthlyErrorLogFilename();
  const logEntry = `================================================================================
Timestamp   : ${timestamp}
ExecutionID : ${executionId}
Error       : ${message}
Stack Trace :
${stack}
================================================================================\n\n`;

  const files = rootFolder.getFilesByName(logFileName);
  if (files.hasNext()) {
    const logFile = files.next();
    const existingContent = logFile.getBlob().getDataAsString('UTF-8');
    logFile.setContent(existingContent + logEntry);
  } else {
    rootFolder.createFile(logFileName, logEntry, MimeType.PLAIN_TEXT);
  }
}

/**
 * Returns the monthly error log filename for the current month in the script timezone.
 * Format: automation_errors_YYYY_MM.log
 * @returns {string}
 */
function getMonthlyErrorLogFilename() {
  const now = new Date();
  const timeZone = Session.getScriptTimeZone();
  const yearMonth = Utilities.formatDate(now, timeZone, 'yyyy_MM');
  return `automation_errors_${yearMonth}.log`;
}

/**
 * Sends failure notification email to system administrator.
 * @param {string} executionId
 * @param {string} timestamp
 * @param {string} message
 * @param {string} stack
 */
function sendAlertNotification(executionId, timestamp, message, stack) {
  const recipient = CONFIG.ALERT_EMAIL;
  if (!recipient) {
    return;
  }

  const subject = `[Alert] Sana Academy Report Automation Failure - ${executionId.substring(0, 8)}`;
  const body = `Sana Academy Reports Automation encountered a fatal error:

- Execution ID: ${executionId}
- Timestamp: ${timestamp}
- Error Message: ${message}

Stack Trace:
${stack}

This failure has been recorded to ${getMonthlyErrorLogFilename()} in the root Google Drive folder.`;

  MailApp.sendEmail({
    to: recipient,
    subject: subject,
    body: body,
  });
}

// ============================================================================
// 10. UTILITY FUNCTIONS
// ============================================================================

/**
 * Converts any value safely to a trimmed string.
 * @param {*} val
 * @returns {string}
 */
function getSafeString(val) {
  if (val === null || val === undefined) {
    return '';
  }
  return String(val).trim();
}
