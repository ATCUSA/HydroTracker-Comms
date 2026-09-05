# Real-device test checklist

Automated checks run in Chromium — including one project that emulates a phone
viewport with touch input. **An emulated viewport is not a phone.** It shares
the desktop engine, a desktop GPS stack, desktop memory behaviour and desktop
background rules. Everything below has to be done on real hardware by a person,
and the result written down.

Record each run in [TEST-REPORT.md](TEST-REPORT.md) with the device, OS version,
browser version, date and tester. Anything not run stays marked _not run_ — do
not infer a result from a similar device.

## Devices to cover

| Priority | Device        | Browser |
| -------- | ------------- | ------- |
| 1        | Android phone | Chrome  |
| 1        | Android phone | Brave   |
| 2        | iPhone        | Safari  |
| 3        | iPhone        | Chrome  |
| 3        | iPhone        | Brave   |

Test on the actual phone the operator will use, at least once.

---

## A. Install and offline preparation

- [ ] Site loads over **HTTPS**.
- [ ] "Add to Home screen" / "Install app" is offered and works.
- [ ] Launching from the home-screen icon opens standalone (no browser chrome).
- [ ] Setup → readiness check reports **Offline ready**, all assets cached,
      database check **passed**.
- [ ] **Request persistent storage** — record what it actually returned on this
      device. iOS Safari commonly declines.
- [ ] Note the storage quota shown.

## B. Airplane mode

Turn the radio fully off. Wi-Fi off too.

- [ ] Force-close the app, reopen from the icon: it starts.
- [ ] Cold-open every screen: Live, Accountability, Timeline, Setup, Backup &
      reports, Emergency.
- [ ] Record passes, starts, finishes, a sweep, a radio message, an event note.
- [ ] Edit a record and void another.
- [ ] Export a JSON backup, a CSV and an XLSX. Confirm the files land in the
      device's downloads and open.
- [ ] Force-close and reopen. **Every committed record is still there.**
- [ ] Reboot the phone, reopen: still there.

## C. Capture under real conditions

- [ ] One deliberate tap creates exactly **one** observation. Ten taps make ten.
- [ ] Tap rapidly for 30 seconds — every capture is distinct, in capture order,
      with plausible times.
- [ ] **Wearing the gloves you will actually wear.** Are the controls big
      enough?
- [ ] Record a pass while the radio form is half-filled — the form is not lost
      and does not block the capture.
- [ ] Screen readable in **direct sunlight** at full brightness.
- [ ] Readable with polarised sunglasses, in portrait and landscape.
- [ ] Usable with wet hands, and with rain on the screen.
- [ ] Usable one-handed while the boat moves.
- [ ] Keyboard entry of a boat number with letters (e.g. `4B`) and leading zeros
      (`007`) — both preserved.
- [ ] Dictation into a text field, if the device offers it. Typing must work
      regardless.

## D. Accountability and reports

- [ ] Copy a lineup: a previous DNF can be selected, a previous finisher left
      out, and no prior time, DNF or scratch appears in the new heat.
- [ ] Mass start with a subset selected — only those boats get the shared time.
- [ ] A non-reporting checkpoint shows _Not expected to report_ and raises no
      missing-passage prompt.
- [ ] Print the per-heat checklist to a real printer or PDF. Check the columns
      fit, nothing is cut off, and the station, operator, timezone and scope
      notes are all on the page.

## E. GPS and emergency

Do this **outdoors, with a view of the sky**.

- [ ] Emergency press saves the marker **before** the permission prompt is
      answered.
- [ ] **Deny** location: incident capture still works, the location shows
      _pending_, and logging is unaffected.
- [ ] **Allow** location: a fix appears with an accuracy figure. Note typical
      accuracy in metres.
- [ ] Time to first fix, cold. Note it.
- [ ] Walk or drive 100 m: the **device** location updates; the **incident**
      location does not move.
- [ ] Press _Set incident location to current position_: it updates once, is
      labelled a device fix, and does not move again as you keep moving.
- [ ] Enter coordinates manually — saved and labelled as manual entry.
- [ ] Enter nonsense coordinates — rejected, nothing changed.
- [ ] Switch between DD, DDM and DMS. Check the values against a second source
      (a handheld GPS or another phone) and confirm they agree.
- [ ] Copy the responder text and paste it somewhere. Is it readable aloud?
- [ ] Lock the screen for two minutes, unlock: the fix is labelled **stale** and
      a new one is acquired. Confirm the app does not claim background tracking.
- [ ] Switch to another app for two minutes and back: same behaviour.
- [ ] Screen wake lock: does this device honour it? Record yes or no.
- [ ] **Battery drain**: run the emergency screen for 30 minutes with GPS on and
      the screen lit. Record the percentage used.
- [ ] Take a real incoming phone call mid-incident, then return to the app.
      Nothing lost.

## F. Interruptions and edge cases

- [ ] Low battery mode on: does capture still work? Does GPS?
- [ ] Fill the screen with an incoming notification while capturing — no double
      captures, no lost taps.
- [ ] Open the app in two tabs: the second is read-only and says so.
- [ ] Change the device clock forward by an hour while the app is open: the app
      reports the jump, logs it, and does **not** alter existing records.
- [ ] Deploy a new version while the app is open: it does **not** reload by
      itself. It reloads only when the operator presses the button.
- [ ] Fill the device storage close to full, then capture: a failure is shown
      honestly and is retryable. Nothing reads "saved" that was not.

## G. Backup and handover

- [ ] Export a JSON backup on the phone, transfer it to a computer, restore it
      there: ids and history survive.
- [ ] Import a second station's backup into the archive: kept separate, nothing
      merged.
- [ ] Re-import the identical file: detected, nothing added.
- [ ] Import a deliberately corrupted file: rejected, existing records intact.

---

## Reporting a run

For each device add a row to [TEST-REPORT.md](TEST-REPORT.md):

```
| Android 15 / Pixel 8 / Chrome 141 | 2026-09-12 | A. Cole | A–G pass; GPS ~6 m, first fix 18 s, 9% battery in 30 min | Wake lock honoured |
```

Note anything that failed, and anything you could not test.
