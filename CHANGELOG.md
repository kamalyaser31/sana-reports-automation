# Changelog

## [5.1.1] — 2026-08-31
- feat(teachers): أُضيفت المعلمة «فاطمة إبراهيم» بالمعرّف `T003` إلى سجل `CONFIG.TEACHERS`.

## [5.1.0] — 2026-08-29

### test: complete test suite rewrite & v5.1 idiomatic polish
- Rewrote `Test.js` from scratch into an automated mini-framework covering 111 unit assertions across 12 test suites.
- Added 5 end-to-end integration test scenarios (normal submission, duplicate detection, eastern digits, missing fields, unknown teacher).
- Replaced all legacy `var` declarations with strict `const`/`let` scoping.
- Hardened `withRetry` with immediate propagation for `NON_RETRYABLE` errors (quota, rate-limit, auth).
- Fixed `getFieldCaseInsensitive` to preserve strict `null` instead of returning literal string `"null"`.
- Escaped `fileUrl` in Telegram HTML payload and refactored request options to immutable builders.
- Prevented orphaned empty month folders in Drive during PDF export attempts.

## [5.0.0] — 2026-08-29

### refactor: clean-code-guard pass (Version 5 - Clean Code Release)

**Security**
- Removed hardcoded Telegram Bot Token, Chat ID, and alert email from `Code.js`.
  Sensitive values now live in `Config.local.js` (gitignored, deployed via clasp).
  `Script Properties` remains a supported fallback for shared/team environments.
  See `Config.local.example.js` for setup.

**New files**
- `Config.local.js` — local secrets file (gitignored).
- `Config.local.example.js` — template committed to repo.
- `Diagnostics.js` — diagnostic functions moved out of production code:
  `authorizeAndTest`, `testTelegramConnection`, `getTelegramUpdates`.

**Bug fixes**
- Telegram notification failures now logged to Drive error log instead of being silently discarded.
- PDF export errors per-teacher now logged to Drive error log.
- `saveMarkdownFile` no longer mutates the `data` argument (CQS fix); returns `{ file, isDuplicate, duplicateIndex }`.
- `removeSummaryRows` replaced per-row `getValue()` API calls with a single batch `getValues()` read.

**Refactor**
- Extracted `_resolveTeacher`, `_parseDuration`, `_resolveSessionAndDate`, `_formatSubmissionDate` from monolithic `validateFormData` (154 → ~30 lines).
- Extracted `_formatArabicHours` to eliminate duplicated inline Arabic grammar logic.
- Extracted `_resolveDrivePath` shared by `resolveTargetFolder` and `exportTeacherMonthlyPdf`.
- Extracted `_exportOneTeacher` from `exportAllTeachersMonthlyPdf` for isolation and Drive logging.
- Removed "Step N:" scaffolding comments from `executeSubmissionPipeline`.
- Added "why" comment to `normalizeDigitsAndText` explaining the `split/join` workaround.
- Renamed `values` → `formFields` in `extractFormData` for clarity.
