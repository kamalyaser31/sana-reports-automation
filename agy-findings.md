# Audit Findings (Antigravity), verified

Each finding below was checked against the code on 2026-10-26. Claims that did not hold were dropped (see the end). Severity: **Medium** = a real gap worth fixing soon; **Low** = minor, fix when convenient; **Info** = known trade-off, no action unless it starts to hurt.

Fixes in `Code.js` need Kamal's explicit permission, per the project rules.

## Medium

| # | Finding | Location | Fix |
|---|---|---|---|
| M1 | `onFormSubmit` catches every fatal error, logs it to Drive and emails an alert, then returns normally, so Apps Script records the run as *Completed*. A failed submission is invisible in the executions dashboard; only the email shows it. | `Code.js:157-176` | Re-throw after logging and alerting (`throw error;` at the end of the `catch`). |
| M2 | The dashboard's `fetch` has no timeout. If the server stalls (cold start, lock wait), every button stays disabled (`busy = true`) until the browser gives up. | `sana-dashboard/index.html`, `call()` | Pass `signal: AbortSignal.timeout(60000)` and show a retry message on abort. |

## Low

| # | Finding | Location | Fix |
|---|---|---|---|
| L1 | `CONFIG.FALLBACKS.DATE_TEXT` is defined and never read. | `Code.js:133` | Delete it. |
| L2 | The zero-width/no-break-space regex is written twice. | `Code.js:348`, `Code.js:368` | Let `parseReportMetadata` call one shared helper. |
| L3 | `_findRootFolder` repeats most of `getRootFolder` (ID first, then search by name); they differ only in that one may create the folder. | `Students.js:907-915`, `Code.js:708` | One function with a "do not create" option. |
| L4 | If someone types a row below «الإجمالي» and «المتوسط» by hand, `removeSummaryRows` stops at that row, leaving the old summary rows inside the data, so the sheet's own totals double-count. The dashboard and the public file are not affected: they read the rows and skip the summary labels. | `Code.js:950-971` | Remove every row labelled الإجمالي/المتوسط, wherever it is, before appending the new pair. |
| L5 | The whole submission pipeline holds the script lock, including the Telegram call and the Markdown file write. With today's volume it has not caused a timeout. | `Code.js:146-157` | Only if lock waits appear: send Telegram after releasing the lock. |
| L6 | `autoResizeColumn` runs for 6 columns on every submission. The time cost has not been measured. | `Code.js:939-941` | Resize once when the monthly tab is created. |

## Info (known trade-offs)

| # | Finding | Location | Note |
|---|---|---|---|
| I1 | Sessions and failed-login counters live in `CacheService`. If Google evicts them early, an admin is logged out before 6 hours and the lockout counter resets. | `Api.js:290-360` (`apiLogin`, `apiSession`) | Design of S-41/S-42. Logging in again is the only cost. |
| I2 | Saving rates or fixed expenses is last-write-wins. Two admins saving the same item at the same moment: the later save wins. | `Api.js` (`saveRates`, `saveFixed`) | The page sends only the changed items, so only the same item can collide. |
| I3 | Each submission rewrites the teacher's whole registry tab. | `Students.js:990` (`writeStudentsTab`) | Intended: it keeps the newest-first sort. Revisit only if submissions slow down. |
| I4 | Teacher sheets are opened one by one and the year folder is walked file by file. | `PublicStats.js`, `_teacherSheetFiles`, `readTeacherSheetReports` | Cached for 10 minutes (S-53); a cached dashboard load measured 4.8 s. |

## Dropped (checked, not real)

- **Duplicate teacher sheets from concurrent submissions:** creation runs inside the pipeline's script lock, so two submissions cannot create the sheet at the same time.
- **Sheets quota of 100 requests per 100 s:** that quota is for the Sheets REST API, not `SpreadsheetApp`; a live refresh read 273 rows in 16.5 s without error.
- **512 MB heap exhaustion:** the payload is a few hundred KB.
- **Cache purge storm after writes:** no dashboard write clears the cache; only failed-login counters are removed.
- **`batchGet` across all teacher sheets in one request:** `batchGet` reads one spreadsheet per request.
- **Row-index desync on gender/details writes:** the row is found and written inside one script-lock call, and every sort runs under the same lock.
- **25+ queued aliases timing out and corrupting the registry:** aliases apply when saved (S-12); each nightly retry is dated on its own, so an interrupted run leaves the rest pending, not half-merged.
- **`_carryDetailsFromLastYear` run per new student:** it runs once per report, for all its new students.
- **Rendering 300–600 students:** the academy has about 100.
- **`_memoryCache` should coerce to strings:** every value the code caches is already a string.
- **Deleting integration tests, splitting `_testPublicStats`, renaming tests:** preferences, not defects; the integration tests cover the Drive pipeline that unit tests cannot.
- **Layered architecture, repositories, DTOs, new modules (`Telegram.js`, `Rates.js`, …):** restructuring a stable script without a defect to fix; out of scope under the project rules.
- **Optimistic UI, delta responses, 6-hour dashboard cache, debounced search, pagination:** feature proposals with unmeasured gains, not defects.
