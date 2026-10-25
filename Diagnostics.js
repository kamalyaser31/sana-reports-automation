/**
 * ============================================================================
 * Diagnostics.js — أدوات التشخيص والاختبار اليدوي
 * ============================================================================
 * هذه الدوال مخصصة للتشغيل اليدوي من محرر Apps Script فقط.
 * لا تُستدعى تلقائياً ولا تنتمي إلى مسار معالجة النماذج.
 *
 * ⚠ اعتماد صريح على ترتيب التحميل:
 *   يعتمد هذا الملف على CONFIG و onFormSubmit و sendTelegramNotification
 *   المُعرَّفة في Code.js. يُحمِّل Apps Script الملفات أبجدياً (C قبل D)
 *   مما يضمن تهيئة Code.js أولاً. لا تُعيد تسمية هذا الملف بحرف يسبق C.
 * ============================================================================
 */

/**
 * دالة التفويض والاختبار الذاتي.
 * شغّلها مرة واحدة من شريط محرر Apps Script لمنح الصلاحيات والتحقق من الإعداد.
 */
function authorizeAndTest() {
  console.log('Running authorization and self-test...');
  const mockEvent = {
    mockData: {
      'اسم المعلم':              'محمد نبيل',
      'فئة الطلاب':              'كبار',
      'الساعات':                 '1',
      'الدقائق':                 '30',
      'التقرير':
        '═══ [ تقرير أكاديمية سنا ] ═══\n' +
        'التاريخ: 26-08-2026\n' +
        'الفترة: تجويد\n' +
        'عدد الطلاب: 6\n' +
        '━━━━━━━━━━━━━━━\n' +
        'تقرير تجريبي لتفويض الصلاحيات وإنشاء الجداول.',
      'ملاحظات خاصة للإدارة': 'تفويض صلاحيات Google Sheets.',
    },
  };
  // The test folder, not the live one: the teachers' sheets are the source of
  // the halaqat and the pay, so a sample report must never reach them.
  _TEST_MODE = true;
  try { onFormSubmit(mockEvent); }
  finally { _TEST_MODE = false; }
  console.log('Authorization and self-test completed successfully!');
}

/**
 * تشخيص: يختبر الاتصال بـ Telegram Bot API ويرسل رسالة تجريبية.
 * شغّله من محرر Apps Script للتأكد من صحة ربط البوت.
 */
function testTelegramConnection() {
  const botToken = CONFIG.TELEGRAM.BOT_TOKEN;
  const chatId   = CONFIG.TELEGRAM.CHAT_ID;

  console.log('[TELEGRAM DIAGNOSTIC] Starting connection test...');
  console.log(`[TELEGRAM DIAGNOSTIC] Bot Token Prefix: ${botToken ? botToken.substring(0, 10) + '...' : 'MISSING'}`);
  console.log(`[TELEGRAM DIAGNOSTIC] Target Chat ID: ${chatId}`);

  const meRes = UrlFetchApp.fetch(
    `https://api.telegram.org/bot${botToken}/getMe`,
    { muteHttpExceptions: true }
  );
  console.log(`[TELEGRAM DIAGNOSTIC] getMe → status: ${meRes.getResponseCode()}, body: ${meRes.getContentText()}`);

  if (meRes.getResponseCode() !== 200) {
    throw new Error(`Telegram Bot Token is invalid or blocked! Response: ${meRes.getContentText()}`);
  }

  sendTelegramNotification({
    teacherName:       'محمد نبيل (اختبار)',
    sessionType:       'صباحية',
    reportDateText:    '29-08-2026',
    durationFormatted: '1 ساعة',
    durationTime:      '01:00',
    studentCount:      5,
    fileUrl:           'https://drive.google.com',
    adminNotes:        'رسالة اختبارية للتأكد من ربط بوت تيليجرام بنجاح.',
  });

  console.log('[TELEGRAM DIAGNOSTIC] Test completed. Check your Telegram group/channel now!');
}

/**
 * تشخيص: يجلب آخر التحديثات من Telegram Bot API لاكتشاف Chat ID الصحيح.
 * الخطوات:
 *   1. أضف البوت إلى مجموعتك أو قناتك.
 *   2. أرسل أي رسالة داخل المجموعة / القناة.
 *   3. شغّل هذه الدالة لعرض Chat IDs المكتشفة.
 */
function getTelegramUpdates() {
  const botToken = CONFIG.TELEGRAM.BOT_TOKEN;
  const response = UrlFetchApp.fetch(
    `https://api.telegram.org/bot${botToken}/getUpdates`,
    { muteHttpExceptions: true }
  );
  const rawText = response.getContentText();
  console.log('[TELEGRAM UPDATES RESULT]:\n' + rawText);

  try {
    const json = JSON.parse(rawText);
    if (json.ok && json.result && json.result.length > 0) {
      console.log('--- FOUND CHAT IDs ---');
      json.result.forEach(function (u) {
        const msg = u.message || u.channel_post || u.my_chat_member;
        if (msg && msg.chat) {
          console.log(
            'Title: "' + (msg.chat.title || msg.chat.first_name || 'Direct') +
            '", Type: ' + msg.chat.type +
            ', Chat ID: ' + msg.chat.id
          );
        }
      });
      console.log('----------------------');
    } else {
      console.warn('[TELEGRAM UPDATES] No updates found. Add the bot to the group, send a message, then run again.');
    }
  } catch (e) {
    console.error('Failed to parse getUpdates response:', e.message);
  }
}
