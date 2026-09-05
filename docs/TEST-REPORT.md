# Test results report

Generated 2026-09-05. Re-run the suites and update this file whenever the code
changes.

**Read this before claiming anything about browser or device support.** The
sections below separate what was actually executed from what was not. Nothing
here is inferred.

---

## Summary

| Suite                         | Result                                                    | Where it ran                          |
| ----------------------------- | --------------------------------------------------------- | ------------------------------------- |
| Unit and integration (Vitest) | **154 passed, 0 failed**                                  | Node 22.22.2, `fake-indexeddb`        |
| End-to-end — desktop Chromium | **30 passed, 0 failed**                                   | Chromium 141.0.7390.37, 1280×720      |
| End-to-end — emulated phone   | **30 passed, 0 failed**                                   | Chromium 141, Pixel 7 viewport, touch |
| End-to-end — WebKit           | **NOT RUN**                                               | See _Not tested_ below                |
| Real Android device           | **NOT RUN**                                               | Manual step, see below                |
| Real iPhone                   | **NOT RUN**                                               | Manual step, see below                |
| Type check (`svelte-check`)   | **0 errors, 0 warnings**                                  | TypeScript 5.9.3                      |
| Formatting (Prettier)         | Clean                                                     | —                                     |
| `npm audit`                   | 3 low, all in dev-only tooling; none reachable at runtime | —                                     |

Environment: Node 22.22.2, Playwright 1.63.0, SvelteKit 2.x, Svelte 5.x,
Vite 7.x, Dexie 4.x.

---

## Unit and integration tests — 154 passed

Run with `npm test`. IndexedDB is provided by `fake-indexeddb`, so the database
tests exercise real transaction semantics, not mocks.

| File                     | Tests | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------ | ----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `coordinates.test.ts`    |    23 | DD/DDM/DMS conversion, both hemispheres on both axes, equator and prime meridian, ±90/±180 limits, out-of-range rejection, rounding carry (59.9996′ → next degree; 59.996″ → next minute), parsing of all three formats plus bare pairs and reversed axis order, round-trip through every format, staleness, responder text including the "coordinates not available" and STALE cases                                                                                                  |
| `clock.test.ts`          |    15 | Hundredths without rounding up, event-timezone vs device-timezone display, DST offsets on both sides of the year, ISO export retaining the original offset, date-line crossing, unknown-timezone fallback, operator-typed time parsing and rejection, wall-clock drift detection forward and backward, sub-threshold drift ignored                                                                                                                                                     |
| `accountability.test.ts` |    24 | The four cell states, repeated passes kept not collapsed, radio vs direct distinction, non-reporting checkpoint silence, a local pass not implying a finish, scratched marked not-applicable, DNF still expected on course, unassigned surfaced, voided excluded, uncertain flag, sweep per leg, heat-complete excluded from racer accountability, leg-format templates (one start for down-and-back), lineup copying carrying no prior outcome                                        |
| `database.test.ts`       |    13 | Create/update revisions with field-level diffs, capture time never rewritten by a correction, sequence stable when effective time moves earlier, strictly increasing durable sequence, **rollback when the audit write fails**, **rollback when the record write fails**, void keeps the record, restore, diffing                                                                                                                                                                      |
| `backup.test.ts`         |    18 | Backup contents including audit history and station identity, validation acceptance and rejection (not-a-backup, newer version, missing list), orphan-reference warnings, replace round-trip preserving ids and history, copy restore into a separate workspace with full id remapping, pre-replace backup, malformed backup changing nothing, archive keeping stations separate, identical re-import detected, changed snapshot versioned, content hash ignoring generation time      |
| `exports.test.ts`        |    21 | Formula escaping for `= + - @ TAB CR`, ordinary text and boat numbers left alone, CSV quoting, report headers naming station/operator/timezone/generation/scope, demo marking, checklist columns mirroring the printed sheet, hundredths in printed times, boat numbers as text, "No finish heard" distinct from DNF, non-reporting checkpoint labelling, corrected vs original time in the activity log, incident coordinate provenance, pending coordinates, correction history rows |
| `timeline.test.ts`       |    21 | Ordering by effective time with sequence tie-break, reordering on correction while capture order survives, merging radio/events/incidents, radio without a heat, heat close creating no observation, received vs reported time, unresolved-incident marking, filters, and the review prompts — including **no overdue prompt without a configured threshold** and **never inferring a missing racer from starting order**                                                              |
| `import.test.ts`         |    19 | CSV with quoted commas, embedded newlines, doubled quotes, CRLF, BOM, blank rows; tab and semicolon detection; header guessing; **a layout that does not match the supplied checklist**; boat numbers as text; refusal without a boat-number column; blank and duplicate handling; start-order resolution; pasted lists                                                                                                                                                                |

---

## End-to-end tests — 30 scenarios, run twice

Run with `npm run test:e2e` against the **production build** served over
`http://localhost`, which browsers treat as a secure context — the same
conditions the app requires in the field over HTTPS.

Both projects executed all 30 scenarios and all passed.

### Acceptance scenarios covered

**Offline** (`offline.spec.ts`)

- After online preparation, with the browser context set offline: cold-open of
  Live, Accountability, Timeline, Setup and Backup & reports; capture; reload;
  committed records survive. Confirmed 48 of 48 assets cached and the service
  worker active.
- Offline readiness reported separately from connectivity.
- Database write/read check included in readiness.

**Capture** (`capture.spec.ts`)

- One intentional tap creates exactly one observation; a second creates another.
- Five rapid captures stay distinct and in capture order.
- An unassigned capture saves immediately and is assignable afterwards.
- A half-filled radio form neither blocks another pass nor loses its content.
- Mass start writes one shared timestamp to the selected boats only.
- A local pass does not imply a finish.
- The heat-complete call, and closing the heat, each fill in nothing.
- Continuous down-and-back keeps one start with two directional passes.
- A non-reporting checkpoint produces no missing-passage prompt.

**Corrections** (`corrections.spec.ts`)

- An edited time and reassigned boat preserve the original capture time and
  produce a field-level audit history with the operator's reason.
- A correction without a reason is refused.
- Void removes a record from accountability, keeps it visible under _show
  voided_, and restore brings it back.
- A radio checkpoint pass keeps its received time and accepts a reported
  occurrence time added later.
- Copying a heat lineup carries no previous DNF, scratch, time or result.

**Emergency** (`emergency.spec.ts`)

- Denied geolocation never blocks the emergency capture; the location records as
  pending rather than invented.
- With permission granted and the simulated position moved twice: the device
  panel follows, the incident location does not, and only the explicit control
  changes it.
- A manually entered location is saved and labelled as manual entry.
- Unreadable coordinates change nothing.
- The responder block names the location type, format, accuracy and fix age, and
  follows a format change.
- Capture controls stay reachable with an incident open.
- Incident actions are timestamped, linked, and appear on the timeline as
  unresolved.

**Reports and backup** (`reports.spec.ts`)

- The printable checklist labels station, operator, timezone, scope, "No finish
  heard" and "Not observed".
- The CSV export escapes a formula-leading cell and no cell begins with a bare
  `=`.
- The XLSX export is a real zipped workbook (PK header verified), not a renamed
  CSV.
- A full backup round-trips into a separate workspace, leaving the live event
  untouched.
- A malformed backup is rejected and changes nothing.
- Two station logs stay separate and an identical re-import is detected.

---

## Defects found by these tests and fixed

Recorded because they show what the suites are actually worth.

1. **Reactive array sorted in place.** A store getter called `Array.sort()`
   directly on Svelte 5 reactive state. Svelte forbids mutating state during a
   template read, so the emergency screen stopped rendering after the second
   incident action. The records were on disk and invisible. _Found by the
   incident-actions e2e scenario._
2. **Svelte proxies reaching IndexedDB.** Structured clone cannot copy a Proxy,
   so every restore, archive import and edit of a record containing an array
   failed with `DataCloneError`. Now flattened centrally at the write boundary.
   _Found by the backup round-trip scenario._
3. **Outcome messages overwritten.** Two screens replaced their specific result
   ("identical backup, nothing added"; "DNF and scratches were not copied") with
   a generic success line. _Found by the archive and copy-lineup scenarios._
4. **Re-picking the same file did nothing.** The file input retained its value
   and fired no change event, so re-importing one station's log silently failed.
5. **Bottom bar scrolled off-screen on a phone.** At 412 px the navigation was a
   horizontal scroller and could be left scrolled with Live and Emergency out of
   view. Replaced with a grid that always fits.
6. **Bottom bar covered content.** Being sticky, it floated over whatever was at
   the bottom of the viewport, leaving controls underneath untappable. Now fixed
   with matching reserved padding.
7. **Full-width input painting over its button** in a compact row.
8. **The SPA shell was not precached**, so a cold offline open of any sub-route
   would have failed. _Found while wiring up the offline scenario._

---

## Not tested

State this plainly wherever support is discussed.

| Not run                                      | Why                                                                                                                                                                                 | How to close the gap                                                                                             |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **WebKit / iOS Safari engine**               | The WebKit browser build could not be downloaded in this environment (`npx playwright install webkit` fails on the network policy). The Playwright project is configured and ready. | On a machine with normal network access: `npx playwright install webkit && npx playwright test --project=webkit` |
| **Real Android device (Chrome)**             | Requires physical hardware. The emulated Pixel 7 viewport shares the desktop engine, GPS stack and background rules — it is not evidence about a phone.                             | [DEVICE-TEST-CHECKLIST.md](DEVICE-TEST-CHECKLIST.md), sections A–G                                               |
| **Real Android device (Brave)**              | As above.                                                                                                                                                                           | As above                                                                                                         |
| **Real iPhone (Safari, Chrome, Brave)**      | As above.                                                                                                                                                                           | As above                                                                                                         |
| **Actual GPS hardware**                      | Every geolocation test used Playwright's simulated position. No claim is made about time-to-fix, real accuracy, or behaviour under tree cover or on water.                          | Checklist section E                                                                                              |
| **Background and screen-lock behaviour**     | Cannot be exercised meaningfully in a desktop browser. The app deliberately makes no background-tracking promise.                                                                   | Checklist section E                                                                                              |
| **Battery consumption**                      | Needs real hardware over real time.                                                                                                                                                 | Checklist section E                                                                                              |
| **Screen wake lock on a real device**        | Support varies; the app treats failure as expected and reports it.                                                                                                                  | Checklist section E                                                                                              |
| **Sunlight readability, gloves, wet hands**  | Physical conditions.                                                                                                                                                                | Checklist section C                                                                                              |
| **Printing to a physical printer**           | Only the print stylesheet is exercised.                                                                                                                                             | Checklist section D                                                                                              |
| **Storage eviction under pressure**          | Requires a device near its quota.                                                                                                                                                   | Checklist section F                                                                                              |
| **Migration from a previous schema version** | Only schema version 1 exists so far; there is nothing to migrate from. Add a test with the first version 2.                                                                         | —                                                                                                                |

---

## Device test log

Add a row per real-device run. Empty until someone runs one.

| Device / OS / browser | Date | Tester | Result | Notes |
| --------------------- | ---- | ------ | ------ | ----- |
| _(none yet)_          |      |        |        |       |

---

## Reproducing

```bash
npm install
npm test                                   # 154 unit and integration tests
npm run check                              # type check
npm run build                              # production build
npm run test:e2e                           # end-to-end, all configured projects

# If the local Chromium does not match the Playwright release:
CHROMIUM_PATH=/path/to/chromium npm run test:e2e
```
