/**
 * Parents.js — each student's part of a report, ready for the parent on WhatsApp.
 *
 * The bot sends one private Telegram message per student to PARENTS_CHAT_ID,
 * with a wa.me button that opens the parent's chat with the text filled in;
 * the admin presses send there. Nothing is sent to a parent automatically.
 */

// ============================================================================
// 1. CONFIGURATION
// ============================================================================

const PARENTS = {
  // Off until the admin wants it; set to true and clasp push to turn it on.
  ENABLED:    false,
  get CHAT_ID() { return _getSecret('TELEGRAM_PARENTS_CHAT_ID'); },
  // Longest wa.me link that opened WhatsApp in the 2026-10-28 trial; 2184 failed
  // even on api.whatsapp.com, so the limit is WhatsApp's own.
  LINK_LIMIT: 1937,
  SIGNATURE:  'أكاديمية سنا لتعليم القرآن الكريم',
  // Telegram allows about one message a second in a private chat.
  PAUSE_MS:   350,
};

// ============================================================================
// 2. MESSAGE TEXT (pure)
// ============================================================================

/**
 * Each student's part of the report as the teacher wrote it, from the name line
 * to the next student, without the ━ separator lines. «بدون اسم» is skipped.
 * @param {string} reportText
 * @returns {Array<{name: string, lines: string[]}>}
 */
function studentSections(reportText) {
  const sections = [];
  let current = null;
  String(reportText || '').split(/\r?\n/).map(l => l.trim()).forEach(line => {
    const header = normalizeDigitsAndText(line).match(STUDENT_HEADER_RE);
    if (header) {
      current = { name: cleanStudentName(header[2]), lines: [line] };
      sections.push(current);
      return;
    }
    if (!current) return;
    if (REPORT_FOOTER_RE.test(line)) { current = null; return; }
    // A separator becomes a blank line, so the fields stay apart without it.
    const text = FIELD_SEPARATOR_RE.test(line) ? '' : line;
    const last = current.lines[current.lines.length - 1];
    if (text || last) current.lines.push(text);
  });
  sections.forEach(s => { while (s.lines.length && !s.lines[s.lines.length - 1]) s.lines.pop(); });
  return sections.filter(s => s.name && s.name !== 'بدون اسم');
}

/**
 * The WhatsApp text for one student: name, the report date, the section, the signature.
 * @param {{name: string, lines: string[]}} section
 * @param {string} date
 * @returns {string}
 */
function parentText(section, date) {
  const rest = section.lines.slice(1);
  while (rest.length && !rest[0]) rest.shift();
  return [section.lines[0], `التاريخ: ${date}`, '', ...rest, '', PARENTS.SIGNATURE].join('\n');
}

/**
 * @param {string} phone - "+<digits>"
 * @param {string} [text]
 * @returns {string}
 */
function whatsAppLink(phone, text) {
  const base = `https://wa.me/${String(phone).replace(/\D/g, '')}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

/**
 * One entry per student of the report. `link` holds the text when it fits
 * WhatsApp's limit; otherwise it only opens the chat and the text is pasted.
 * @param {Object} data - Validated data, with reportText.
 * @param {Object<string, string>} phones - From recordStudents.
 * @returns {Array<{name: string, phone: string, text: string, link: string, fits: boolean}>}
 */
function parentMessages(data, phones) {
  const date = data.reportDateText || data.submissionDateFormatted || '';
  return studentSections(data.reportText).map(section => {
    const phone = (phones || {})[studentNameKey(section.name)] || '';
    const text = parentText(section, date);
    const full = phone ? whatsAppLink(phone, text) : '';
    const fits = Boolean(full) && full.length <= PARENTS.LINK_LIMIT;
    return { name: section.name, phone, text, link: fits ? full : (phone ? whatsAppLink(phone) : ''), fits };
  });
}

// ============================================================================
// 3. TELEGRAM
// ============================================================================

/**
 * Sends the report's parent messages to the admin's private chat: a title,
 * then one silent message per student with a phone, then the students with none.
 * Off while PARENTS.ENABLED is false or TELEGRAM_PARENTS_CHAT_ID is empty.
 * @param {Object} data - Validated data.
 * @param {Object<string, string>|null} phones - null when the registry failed.
 * @returns {number} Messages sent.
 */
function sendParentMessages(data, phones) {
  const chatId = PARENTS.CHAT_ID;
  const token = CONFIG.TELEGRAM.BOT_TOKEN;
  if (_TEST_MODE || !PARENTS.ENABLED || !CONFIG.TELEGRAM.ENABLED || !chatId || !token) return 0;
  const messages = parentMessages(data, phones);
  if (!messages.length) return 0;

  const title = [
    `<b>تقارير أولياء الأمور — ${escapeHtml(data.teacherName)} — ${escapeHtml(_sessionLabel(data))}</b>`,
    escapeHtml(data.reportDateText || data.submissionDateFormatted || ''),
  ];
  if (data.isDuplicate) title.push('إعادة إرسال لحلقة سبق تقريرها، فلا تُرسل ما أُرسل.');
  if (phones === null) title.push('لم يُقرأ سجل الطلاب، فلا هواتف.');

  const sends = [{ text: title.join('\n'), disable_notification: false }];
  messages.filter(m => m.phone).forEach(m => {
    sends.push(m.fits
      ? { text: `تقرير ${escapeHtml(m.name)}`, button: ['أرسل على WhatsApp', m.link] }
      : {
        text: `تقرير ${escapeHtml(m.name)}: أطول من أن يحمله الرابط، فانسخه ثم الصقه.\n<pre>${escapeHtml(m.text)}</pre>`,
        button: ['افتح محادثة وليّ الأمر', m.link],
      });
  });
  const missing = messages.filter(m => !m.phone).map(m => m.name);
  if (missing.length) {
    sends.push({ text: `لا هاتف في سجل الطلاب لـ: ${escapeHtml(missing.join('، '))}. أضِفه من لوحة الإدارة.` });
  }

  const failures = [];
  sends.forEach((s, i) => {
    if (i) Utilities.sleep(PARENTS.PAUSE_MS);
    const payload = {
      chat_id: chatId,
      text: s.text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      disable_notification: s.disable_notification !== false,
    };
    if (s.button) payload.reply_markup = { inline_keyboard: [[{ text: s.button[0], url: s.button[1] }]] };
    const error = _sendTelegram(token, payload);
    if (error) failures.push(error);
  });
  if (failures.length) {
    throw new Error(`${failures.length} of ${sends.length} parent messages failed: ${failures[0]}`);
  }
  return sends.length;
}

/**
 * One sendMessage call, waiting once when Telegram asks to slow down (429).
 * @param {string} token
 * @param {Object} payload
 * @returns {string} '' on success, else the error.
 */
function _sendTelegram(token, payload) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const options = { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true };
  let response = UrlFetchApp.fetch(url, options);
  if (response.getResponseCode() === 429) {
    let wait = 3;
    try { wait = JSON.parse(response.getContentText()).parameters.retry_after || wait; } catch (e) { /* default wait */ }
    Utilities.sleep(Math.min(wait, 30) * 1000);
    response = UrlFetchApp.fetch(url, options);
  }
  return response.getResponseCode() === 200 ? '' : `HTTP ${response.getResponseCode()}: ${response.getContentText()}`;
}
