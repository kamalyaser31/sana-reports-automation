# خارطة طريق التكامل المستقبلي المباشر (Direct Webhook Integration Roadmap)

هذه الوثيقة تُفصِّل الاستعدادات الهندسية لترقية هذا المشروع مستقبلاً لاستقبال التقارير مباشرة من تطبيق الويب (`sana-report`) عبر بروتوكول HTTP POST دون المرور بنموذج Google Forms.

---

## 1. التعديل المستقبلي المستهدف في `Code.js`

إضافة دالة `doPost(e)` لاستقبال البيانات ككائن JSON صريح متجاوزة استخلاص النصوص بالتعابير النمطية:

```javascript
/**
 * مدخل الاستقبال المباشر للتقارير عبر طلبات الويب (Web App Endpoint)
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  let hasLock = false;
  
  try {
    hasLock = lock.tryLock(CONFIG.LOCK_TIMEOUT_MS);
    if (!hasLock) {
      return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Lock busy' }))
                           .setMimeType(ContentService.MimeType.JSON);
    }

    const payload = JSON.parse(e.postData.contents);
    const executionId = payload.idempotencyKey || Utilities.getUuid();
    const startTime = new Date();

    // بناء كائن البيانات الموثقة مباشرة دون Regex
    const validatedData = buildValidatedDataFromDirectPayload(payload, executionId, startTime);
    
    // تنفيذ مسار الحفظ المعتاد في Drive و Sheets و Telegram
    const driveTarget = resolveTargetFolder(validatedData);
    const markdownContent = generateMarkdownContent(validatedData);
    const saveResult = saveMarkdownFile(driveTarget.monthFolder, validatedData, markdownContent);
    
    validatedData.fileUrl = saveResult.file.getUrl();
    recordToTeacherSheet(driveTarget.yearTeacherFolder, validatedData);
    sendTelegramNotification(validatedData);

    return ContentService.createTextOutput(JSON.stringify({ 
      status: 'success', 
      fileUrl: validatedData.fileUrl 
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    console.error('[DIRECT POST ERROR]', err.message);
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.message }))
                         .setMimeType(ContentService.MimeType.JSON);
  } finally {
    if (hasLock) lock.releaseLock();
  }
}
```

---

## 2. متطلبات النشر عند البدء في الترقية

1. **نشر تطبيق الويب (Deploy as Web App):**
   - Execute as: `Me (مالك السكربت)`.
   - Who has access: `Anyone`.
2. **رابط النشر (Web App URL):**
   - يُنسخ الرابط ويُدرج في ملف الثوابت بتطبيق الويب `sana-report`.
