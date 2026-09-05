# Jet Boat Safety Log

An offline-first progressive web app for a **fixed safety-boat station** at a jet
boat race. One operator, one checkpoint, one device: it records what that
operator observed and heard on the radio — racer passages, starts and finishes,
radio traffic, ordinary events and emergencies.

> **What this is not.** It is not official timing or scoring, and it makes no
> claim that anyone is physically safe. It records observations and
> accountability, with honest labels for everything that was _not_ observed.

Each device runs independently. There is no account, no backend, no
synchronisation and no automatic communication of any kind in version 1. Logs
from several stations can be collected afterwards as separate files.

---

## Contents

- [What it does](#what-it-does)
- [Requirements and supported browsers](#requirements-and-supported-browsers)
- [Install and run locally](#install-and-run-locally)
- [Production build and HTTPS hosting](#production-build-and-https-hosting)
- [Installing it on a phone](#installing-it-on-a-phone)
- [Pre-race checks](#pre-race-checks)
- [Backup, restore and collecting logs](#backup-restore-and-collecting-logs)
- [Tests](#tests)
- [How it is built](#how-it-is-built)
- [Capabilities and limitations](#capabilities-and-limitations)

---

## What it does

**Live** — the capture screen. One very large **Record pass** control, plus
start, finish, sweep, heat-complete, radio, checkpoint-report and event-note
actions, and editable quick phrases.

The timestamp is taken the instant you press, before any form renders and before
any GPS is consulted. A capture with no boat attached is saved immediately and
can be assigned later, so you can fire repeatedly through a pack and sort out
identities afterwards. Nothing traps you in a form, and a half-finished form
never discards a captured marker.

**Accountability** — one row per boat in starting order, derived entirely from
the observations. Every cell says which of four things it is:

| Label                  | Meaning                                                     |
| ---------------------- | ----------------------------------------------------------- |
| Directly observed      | You saw it from this checkpoint                             |
| Confirmed by radio     | Another station reported it                                 |
| Not observed           | Expected, and nothing recorded                              |
| Not expected to report | This station never calls passages, so silence means nothing |

**Timeline** — observations, radio, events, incidents and heat transitions in
one list, filterable by heat, boat, checkpoint, type, unresolved incident and
review-needed. Corrections and voids happen here.

**Setup** — event, station session, roster, reporting checkpoints, heats and
legs, starting orders, and the offline readiness check.

**Backup & reports** — CSV, real XLSX, printable per-heat checklist, versioned
JSON backup and restore, and the read-only archive of other stations' logs.

**Emergency** — always one press away from the bottom bar.

### Race structure

A heat picks its own racers and starting order; boats need not be in every heat.
Three leg formats are supported:

- **One-way run** — a single leg with one start and one finish.
- **Continuous down-and-back** — **one** start, with outbound and return
  observations at this checkpoint. No second start and no intermediate finish
  are invented.
- **Separate legs** — each leg carries its own start and finish where you use
  them. Starting order carries through by default and can be edited.

Starts can be staggered individually or run as a class/group mass start, where
one press writes one shared timestamp against each selected boat and nothing at
all against the others.

### Things the app deliberately will not do

- A racer has no global status. Scratch, DNS, DNF and finish are recorded per
  heat, so a boat can DNF, be repaired, and race the next heat — and a finisher
  can sit the next one out.
- Copying a lineup copies boats, order and class. It never copies results,
  times, DNF or scratches.
- Hearing a boat pass your checkpoint does not mean it finished. "Finish heard"
  means you heard the finish line announce it.
- The heat-complete radio call, and your own administrative closing of the heat,
  are three separate records — neither one fills in a missing observation or
  invents a finish. Closed heats stay reviewable and correctable.
- Repeated passes are kept and surfaced, never silently suppressed as duplicates.
- Nothing is inferred from starting order. Overdue prompts appear only if you
  configure a threshold yourself.
- Quick phrases such as "EMS requested" record _what you say happened_. They send
  no request and notify no agency.

### Emergency mode

Pressing **EMERGENCY** writes the incident marker immediately — it does not wait
for a permission prompt, a GPS fix, or a single filled-in field. Every incident
field is optional and can be completed while the incident is open. Multiple
incidents can be open at once, and the capture controls stay reachable
throughout.

Three locations are shown separately and never confused with each other:

1. **Incident location** — initially labelled a checkpoint-based _estimate_, not
   a confirmed fix. It changes only when you explicitly set it, either to the
   current position or by typing coordinates. Live device movement never moves
   it. Each change is saved with its source, capture time and available
   accuracy. With no fix available it is recorded as _pending_ rather than
   filled in with a guess.
2. **Current device location** — updates on its own, with accuracy and fix age,
   and is labelled **STALE** past a minute.
3. **Saved checkpoint location** — the station's reference position.

Coordinates are stored internally as WGS84 decimal degrees and displayed in
whichever format you pick — decimal degrees, degrees and decimal minutes, or
degrees/minutes/seconds — always latitude first, with hemisphere letters and the
format named. No format is presented as the one dispatch prefers. The number of
digits shown says nothing about accuracy; accuracy is reported separately.

A copyable responder block names the location type, its source, the format, the
coordinates, the accuracy and the age of the fix.

Position is watched **in the foreground only**, while the emergency screen is
open. The app does not claim to track position with the screen locked or in the
background: when the page is hidden the watch is marked suspended, the last fix
is labelled stale, and a fresh one is acquired on return. An optional screen
wake lock is offered and fails gracefully; tracking stops when you resolve the
incident or leave the screen.

### Corrections and the audit trail

The capture time is written once and is permanent. A correction changes the
_effective_ time and the operational fields, and requires a reason. Every change
is stored as a revision with field-level before/after values, timestamp,
operator and reason, written in the same database transaction as the record
itself — the record and its audit entry either both land or neither does.

Deleting is voiding: the record stays, stays reviewable, and can be restored.
Capture order is preserved by a durable sequence number, so corrected times
reorder the display without losing the order things actually happened in.

---

## Requirements and supported browsers

- **HTTPS is required.** Service workers and geolocation only work in a secure
  context. `http://localhost` counts as secure for development.
- **Prepare the app online before the race.** The first load installs the
  service worker and caches every asset. After that it runs with no network.

Primary targets, in order:

| Platform              | Status                            |
| --------------------- | --------------------------------- |
| Android Chrome        | Primary target                    |
| Android Brave         | Primary target                    |
| iOS Safari            | Supported                         |
| iOS Chrome / Brave    | Supported (WebKit under the hood) |
| Desktop Chrome / Edge | Supported                         |

Automated checks run against Chromium (desktop and an emulated phone viewport)
and are configured for WebKit. **See [docs/TEST-REPORT.md](docs/TEST-REPORT.md)
for exactly which of these have actually been run and which have not.** No
browser or device is claimed as tested unless it appears there as tested.

Real-device verification is a manual step; the checklist is in
[docs/DEVICE-TEST-CHECKLIST.md](docs/DEVICE-TEST-CHECKLIST.md).

---

## Install and run locally

Requires Node.js 20 or newer.

```bash
npm install
npm run dev          # http://localhost:5173
```

| Command                           | What it does                        |
| --------------------------------- | ----------------------------------- |
| `npm run dev`                     | Development server                  |
| `npm run build`                   | Production build into `build/`      |
| `npm run preview`                 | Serve the production build locally  |
| `npm test`                        | Unit and integration tests (Vitest) |
| `npm run test:e2e`                | End-to-end tests (Playwright)       |
| `npm run check`                   | TypeScript and Svelte type checking |
| `npm run lint` / `npm run format` | Prettier                            |

If your machine has a Chromium that does not match the Playwright release, point
at it: `CHROMIUM_PATH=/path/to/chromium npm run test:e2e`.

---

## Production build and HTTPS hosting

```bash
npm run build
```

`build/` is a static site — plain files, no server-side code. Everything the app
needs, including the spreadsheet import and export libraries, is bundled into
it. Nothing is fetched from a CDN at runtime.

Host it on anything that serves static files over HTTPS (Netlify, Cloudflare
Pages, GitHub Pages, S3 + CloudFront, nginx). Two requirements:

1. **Serve `index.html` for unknown paths.** The app is a single-page app, so
   `/timeline` and `/emergency` must both return the app shell. Most static
   hosts call this "SPA mode" or a 404-to-index rewrite.
2. **Do not cache `service-worker.js` for long.** Serve it with
   `Cache-Control: no-cache` so devices notice updates. Files under
   `_app/immutable/` are content-hashed and can be cached forever.

nginx:

```nginx
location / {
  try_files $uri $uri/ /index.html;
}
location = /service-worker.js {
  add_header Cache-Control "no-cache";
}
location /_app/immutable/ {
  add_header Cache-Control "public, max-age=31536000, immutable";
}
```

### Updates never interrupt a live log

A new version downloads in the background and then waits. It is not applied
until an operator presses **Apply staged update and reload** on the Setup
screen. Nothing reloads underneath someone who is logging a heat. Do it between
heats.

---

## Installing it on a phone

1. Open the HTTPS URL in Chrome, Brave or Safari **while you have a signal**.
2. Add it to the home screen:
   - Android Chrome/Brave: menu → _Add to Home screen_ / _Install app_
   - iOS Safari: Share → _Add to Home Screen_
3. Open it from the home screen icon once, still online, so the service worker
   installs and the cache fills.
4. Go to **Setup → Offline readiness → Run readiness check** and confirm it says
   **Offline ready**.
5. Press **Request persistent storage**. The browser may refuse; the app reports
   the real answer either way. This is not a substitute for exporting backups.

---

## Pre-race checks

Do these on each device, online, before you leave the ramp.

1. **Setup → Offline readiness → Run readiness check.** You want _Offline
   ready_, all assets cached, and the database write/read check _passed_.
   Readiness is reported separately from whether you have a signal right now.
2. **Request persistent storage** and note what it says.
3. **Set up the event**: name, date, event timezone, course notes.
4. **Start the station session**: checkpoint name, safety boat number, operator,
   call sign, channel, and the **checkpoint coordinates** — these become the
   initial location estimate on any incident.
5. **Add the reporting checkpoints** and tick only the ones that actually call
   passages on the radio. Silence from a station that never reports is recorded
   as _not expected to report_, never as a missing racer.
6. **Enter the roster**, or import it.
7. **Test the GPS**: open Emergency once, grant location permission, confirm a
   fix appears with an accuracy figure, then resolve or discard the test
   incident. Do this where you can see the sky.
8. **Test airplane mode**: turn the radio off, force-close the app, reopen it,
   record a test pass, confirm it saves, then void it.
9. **Charge the device** and bring a power bank. GPS and a lit screen are hard
   on a battery.

There is a printable version of this in
[docs/OPERATOR-QUICK-START.md](docs/OPERATOR-QUICK-START.md).

---

## Backup, restore and collecting logs

**Export after every race, and ideally between heats.** Browser storage is not a
guaranteed permanent backup even when persistence is granted — a browser can
still clear it.

From **Backup & reports**:

- **Export full JSON backup** — everything: records, ids, audit history,
  incidents, roster, configuration. This is the one that round-trips.
- **Export CSV** / **Export XLSX** — reports for humans and spreadsheets. Text
  that a spreadsheet would treat as a formula is escaped, so notes and boat
  numbers survive intact.
- **Print this page** — the per-heat checklist, laid out for paper.

**Restoring** validates the whole backup before touching anything. A corrupt or
incompatible file is rejected and leaves your records exactly as they were. By
default a restore lands in a **separate workspace copy**, so it cannot shadow
the live log. Replacing an existing event has to be confirmed explicitly, and
downloads a backup of what is about to be replaced first.

**Collecting other stations' logs** puts each backup into a read-only archive,
whole and separate. Re-importing an identical file is detected and adds nothing;
a changed snapshot from the same station is kept as a new version alongside the
old one. Nothing is merged, deduplicated across stations, reconciled, or
combined into a single accountability claim — each station's log stands on its
own.

### Demo data

**Setup → Demo race** creates a clearly labelled demo event, marked `[DEMO]`
everywhere it appears and stamped "DEMO DATA — not a real log" on its reports.
It is a separate event and is never mixed into a real one. Delete it from the
same place.

---

## Tests

```bash
npm test          # 154 unit and integration tests
npm run test:e2e  # 30 end-to-end scenarios per browser project
```

The unit suite covers coordinate conversion and parsing (hemispheres, the
equator, range limits, and rounding that carries 59.9996 minutes up to the next
degree rather than printing 60), timezone and hundredths formatting, clock-drift
detection, accountability derivation, lineup copying, review prompts, the
timeline, spreadsheet escaping, report contents, transactional writes with their
audit rows, rollback on a failed write, and backup round-trip, rejection and
archiving.

The end-to-end suite drives a real browser through the acceptance scenarios:
airplane-mode cold-open of every screen, rapid distinct captures, one tap
producing exactly one observation, capture while a form is incomplete, mass
start, continuous down-and-back, heat-complete versus closing, non-reporting
checkpoints, corrections with audit history, void and restore, geolocation
denial, explicit-only incident relocation, exports, and backup round-trip and
rejection.

[docs/TEST-REPORT.md](docs/TEST-REPORT.md) records what was actually run, on
what, and what was not.

---

## How it is built

| Layer        | Choice                                               |
| ------------ | ---------------------------------------------------- |
| Framework    | SvelteKit 2 + Svelte 5, TypeScript, `adapter-static` |
| Storage      | IndexedDB via Dexie 4, with numbered schema versions |
| Offline      | Service worker precaching the whole shell            |
| Spreadsheets | `write-excel-file` and `read-excel-file`, bundled    |
| Tests        | Vitest with `fake-indexeddb`; Playwright             |

Everything renders client-side (`ssr = false`), so any route can be cold-opened
from the cached shell with no network.

```
src/lib/
  domain/     types, accountability, timeline, review prompts, leg formats
  db/         Dexie schema, transactional writes with audit, settings
  time/       epoch capture, monotonic drift detection, timezone formatting
  geo/        coordinate conversion, parsing, responder text
  services/   capture, setup, incidents, geolocation, readiness, tab lock
  import/     CSV and XLSX lineup import with column mapping
  export/     CSV, XLSX, versioned backup, restore, archive
  report/     report builders and the export service
  stores/     reactive app state, save queue
src/routes/   live, accountability, timeline, setup, reports, emergency
```

Design rules worth knowing before changing anything:

- **IndexedDB is authoritative.** Nothing derived is stored twice. Accountability
  is recomputed from observations and per-heat participation every time.
- **Capture time first.** `beginCapture()` runs synchronously in the event
  handler, before anything else.
- **Saved means committed.** The UI shows "saved" only after the transaction
  resolves. A rejection stays visible and retryable and is never dressed up as
  success.
- **Flatten before writing.** Svelte 5 wraps reactive values in proxies, which
  IndexedDB cannot clone. `toStorable()` handles this centrally at the write
  boundary.
- **Only one tab logs.** A localStorage lock with a heartbeat makes other tabs
  read-only, and a crashed tab releases it after a few seconds.

---

## Capabilities and limitations

**It does**

- Work fully offline once prepared, including cold starts and reloads.
- Keep committed records across reload, force-close and browser restart.
- Capture a timestamp first and let you attach the boat afterwards.
- Keep the original capture time forever, and every correction with its reason.
- Distinguish not observed, not expected to report, radio-confirmed and directly
  observed.
- Detect a wall-clock jump against monotonic time, log it, and ask you to
  review — without rewriting anything.
- Warn you honestly when a save, export or import fails.

**It does not**

- Synchronise, merge or reconcile between devices. Version 1 is one device, one
  log, collected afterwards as separate files.
- Track position in the background or with the screen locked.
- Guarantee a GPS fix, or any particular accuracy.
- Guarantee that browser storage survives. Export backups.
- Record audio, transcribe radio, or use any transcription service. Dictation,
  where the device offers it, is the ordinary phone keyboard; typing always
  works.
- Send anything to anyone. No dispatch, no notifications, no network calls
  during a race.
- Show a map, track breadcrumbs, or integrate what3words.
- Produce official timing or scoring.
- Prove that anyone is safe. It records what was observed. That is all.

**Known future work**: synchronisation and cross-device merging, what3words
alongside (never instead of) coordinates, offline maps, radio audio
transcription, official scoring.

---

## Licence

Not yet specified by the project owner.
