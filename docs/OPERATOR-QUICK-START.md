# Operator quick start

One page. Print it and keep it with the boat.

---

## Before you leave the ramp — while you still have a signal

- [ ] Open the app from the **home screen icon** (not a browser tab).
- [ ] **Setup → Run readiness check** → must say **Offline ready**, all assets
      cached, database check **passed**.
- [ ] **Request persistent storage.** Note what it says.
- [ ] **Event**: name, date, **event timezone**.
- [ ] **Station session**: checkpoint name, safety boat number, your name, call
      sign, channel, and **checkpoint coordinates**.
- [ ] **Reporting checkpoints**: tick only the stations that actually call
      passages on the radio.
- [ ] **Roster**: enter or import the boats.
- [ ] **GPS test**: open Emergency, allow location, confirm a fix and an
      accuracy figure appear, then resolve the test incident.
- [ ] **Airplane-mode test**: radio off → force-close → reopen → record a test
      pass → confirm **saved** → void it.
- [ ] Battery full, power bank packed.

---

## Before each heat

1. **Setup → Create a heat.** Pick the leg format:
   - **One-way run** — one start, one finish.
   - **Continuous down-and-back** — one start, then outbound and return passes.
   - **Separate legs** — each leg has its own start and finish.
2. Choose **individual starts** or a **mass start**.
3. To reuse a lineup, pick **Copy lineup from**. Boats and order come across;
   times, DNF and scratches never do.
4. **Starting order** arrives on the radio: type a number, press **Enter**, the
   box clears, keep going. Or paste a list, or import a CSV/XLSX.
5. Reorder with **↑ ↓**. **Scratch** a boat to keep it listed and marked.
   **Remove** takes it off this lineup only — the event roster is untouched.

---

## During the heat — Live screen

**The big amber button records a pass at your checkpoint.**

- **Press it the moment the boat passes.** The time is taken at your press.
- **You do not need to pick a boat first.** Unassigned captures are saved
  immediately and listed at the bottom of the screen in capture order. Attach
  the boat when you get a moment.
- **Fire as fast as you need.** Each press is its own record.
- To attach a boat as you go, tap its chip first, or type the number.
- **Uncertain ID** marks a capture you are not sure about. Use it freely — an
  honest maybe is worth more than a confident guess.
- Same boat passing twice is fine. Both are kept.

**The other actions**

| Button             | Records                                                      |
| ------------------ | ------------------------------------------------------------ |
| Start heard        | You heard the start announced for a racer                    |
| Finish heard       | You heard the **finish line** announce a racer               |
| Sweep              | The sweep boat passed you                                    |
| Heat complete call | You heard the heat-complete call on the radio                |
| Radio…             | A radio message, with from/boats/priority                    |
| Checkpoint report… | Another station reported a boat passing them                 |
| Event note…        | Anything else worth writing down                             |
| Mass start…        | Select the boats, one press, one shared time for all of them |

**Check the top bar**: checkpoint, heat and leg, direction, the clock, offline
readiness, and **save state**. If save state ever shows **FAILED**, a red banner
appears with a **Retry** button. It is not saved until it says saved.

**Quick phrases** record what you say happened. They send nothing to anyone.

---

## Emergency

**Press EMERGENCY.** The marker is saved instantly — before any permission
prompt, before any GPS fix, before you fill in anything. Fill in the rest when
you can.

Three locations, kept separate:

1. **Incident location** — starts as an estimate from your checkpoint. It only
   changes when you press **Set incident location to current position** or type
   coordinates. The boat drifting does not move it. If there is no fix, it says
   **pending** — it will not invent a position.
2. **Current device location** — updates by itself, with accuracy and age.
   Marked **STALE** if the fix is over a minute old.
3. **Saved checkpoint location** — your reference position.

**Reading coordinates to responders**: pick the format they ask for from the
dropdown — decimal degrees, degrees and decimal minutes, or degrees/minutes/
seconds. Read **latitude first**, and say which format you are using. The
grey block has the full text, including accuracy and how old the fix is.

Log actions as they happen — quick phrase or free text. Each one is timestamped
and attached to the incident. You can go back to Live and keep recording passes
with the incident still open.

**Location only updates while this screen is open and in front.** It does not
track with the screen locked. Coming back from the background, the old fix is
marked stale until a new one arrives.

---

## After the heat

- **Accountability** — check the table. Anything showing **Not observed** is
  something to think about, not a conclusion. _Not expected to report_ means
  that station never calls passages; it is not a gap.
- Record the **heat complete** call when you hear it.
- **Close the heat** on Setup when you are done. That is your administrative
  action — it is separate from the radio call, and neither one fills in a
  missing observation or invents a finish. You can still correct a closed heat.

---

## After the race — do not skip this

1. **Backup & reports → Export full JSON backup.** This is the complete record.
2. Export **CSV** or **XLSX** if someone wants a spreadsheet.
3. **Print this page** for the paper checklist.
4. Get the backup file off the device — email, cloud, cable, whatever works.

Browser storage is not a guaranteed permanent backup. The exported file is.

---

## If something goes wrong

| Problem                            | What to do                                                                                                                   |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Save state says **FAILED**         | Press **Retry** in the red banner. It is not stored until it says saved. Do not carry on assuming it saved.                  |
| App will not load offline          | It was not prepared online. Get a signal, open it, run the readiness check.                                                  |
| No GPS fix                         | Logging is unaffected — GPS is optional. Press **Reacquire fix**. Record the incident location manually or leave it pending. |
| Wrong boat / wrong time recorded   | **Timeline → Edit…**, fix it, give a reason. The original is kept.                                                           |
| Recorded something by mistake      | **Timeline → Void**. It stays in the record and can be restored.                                                             |
| "Another tab is the active logger" | Close the other tab and reload.                                                                                              |
| App says an update is waiting      | Apply it **between heats**, never mid-heat.                                                                                  |
| Device clock jumped                | The app tells you and logs it. Nothing already recorded is changed. Review times around that point.                          |

---

**This log records what you observed and heard. It is not official timing, and
it does not prove anyone is safe.**
