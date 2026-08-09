# WFM — Manual Test Cases (M1 build)

> Scope: what is actually built as of 2026-08-05 (punch + selfie + GPS, state machine,
> geofence flagging, live board, employees/sites/shifts admin, consent, break-deducted
> running total). Timesheet screen, corrections, offline queue, leave/holiday UI and the
> monthly summary are M2/M3 — cases for those are marked **[LATER]** so this file can grow
> into the full UAT script.
>
> Break rule under test (client decision 2026-08-05, overrides spec v1.0 §6):
> **working hours = last check-out − first check-in − breaks.**

**Test environment:** demo tenant on app.bpmsquare.com (features.wfm = on there only).
**Roles you need:** one tenant **admin** login (you), and ideally one plain **member**
login linked to an employee record. Use a phone for the punch tests — camera + GPS.

---

## A. Setup (admin, desktop)

| # | Steps | Expected |
|---|---|---|
| A1 | Sidebar → check for **WORKFORCE** group | Live board, Employees, Sites & Shifts visible. On the real Vikas tenant: nothing (flag off). |
| A2 | Sites & Shifts → add site with your real coordinates (get them from Google Maps → right-click → copy lat, lng), radius 150 | Site appears in list, Active |
| A3 | Add a second site with coordinates far away (e.g. another city), radius 150 | Listed; used later for geofence tests |
| A4 | Add shift "General" 09:00–18:00, grace 10 | Listed; timing shows 09:00 – 18:00, no "next day" tag |
| A5 | Add shift "Night" 21:00–06:00, night shift = yes, allowance 300 | Listed with "next day" tag and Night pill |
| A6 | Employees → + New employee: code EMP-001, your name, Full-time, role Supervisor, shift General, home site = near site | Row appears; Login = "No login", Consent = — |
| A7 | Edit EMP-001 → Invite login = your own email → Save | Login column shows "Linked" (existing account is linked; no new invite email needed) |
| A8 | Create EMP-002 (employee role, General shift) and link a second email you control | Second row, Linked |

## B. Consent gate (phone or browser)

| # | Steps | Expected |
|---|---|---|
| B1 | Open **/wfm-app** logged in as EMP-001 | DPDP consent screen appears first — selfie + location purpose + retention wording. No punch UI. |
| B2 | Without tapping "I agree", try POST /api/wfm/punch (or just reload) | Consent screen persists; a direct API punch returns 403 "Consent required" |
| B3 | Tap **I agree** | Punch screen loads; in Workforce → Employees the Consent column now shows "Given" |
| B4 | Reload /wfm-app | Consent screen does NOT reappear (recorded once) |

## C. Punch with selfie + GPS (the core flow — phone)

| # | Steps | Expected |
|---|---|---|
| C1 | At the near site, tap **Check in** | Front camera opens with live preview |
| C2 | Deny camera permission (first run) | Clear error: camera required; punch not recorded |
| C3 | Allow camera + location → **Capture & punch** | Confirmation: "Check in recorded at HH:MM at <site name>"; running total starts |
| C4 | Admin → Live board (desktop) | Within 30 s, EMP-001 shows **In**, first-in time, under the correct site group |
| C5 | Supabase dashboard → Storage → `wfm` bucket → `{tenant}/{employee}/{yyyy-mm}/` | One image, roughly 100–400 KB, filename = the event id. Bucket is **private** — opening the file URL without a signed token must fail |
| C6 | Supabase → Table editor → `wfm_presence_events` newest row | kind=check_in, source=web_selfie, geo_lat/lng populated, within_geofence=true, selfie_path set, site_id set |
| C7 | iOS Safari: repeat C1–C3 on an iPhone | Camera re-prompt works; punch lands (this is the explicit iOS test pass from NFRs) |

## D. Geofence policy — flag, never block

| # | Steps | Expected |
|---|---|---|
| D1 | Punch check-in while NOT inside any site radius (or temporarily set both sites' coordinates far away) | Punch **succeeds** — never rejected. Confirmation says "location noted" instead of a site name |
| D2 | Live board after D1 | Row shows **Outside geofence** amber pill |
| D3 | `wfm_presence_events` row | within_geofence=false, site_id=null, flags contains `"outside_geofence": true` |
| D4 | Punch with location permission denied | Punch still succeeds; flags contains `"no_location": true` |

## E. State machine

| # | Steps | Expected |
|---|---|---|
| E1 | While checked **in**, buttons offered | Check out (+ Start break). No Check in |
| E2 | Tap **Start break** | Single tap, no camera. State → "On break"; live board shows amber "On break" |
| E3 | While on break, buttons offered | End break, Check out. No Check in / Start break |
| E4 | Tap **End break** | Back to "You're checked in" |
| E5 | Tap **Check out** | Camera opens (selfie required), then state → checked out; live board shows "Out" with last-out time |
| E6 | Direct API abuse: POST /api/wfm/punch kind=break_start while checked out | 409 "Cannot break start while out" — server enforces the state machine independently of the UI |
| E7 | Send the same punch id twice (double-tap / retry) | Second response `duplicate: true`; only ONE row in wfm_presence_events |

## F. Time calculation — breaks deducted

Do this as one continuous sequence with a watch (minute precision is enough):

| # | Steps | Expected |
|---|---|---|
| F1 | Check in at T | Total starts at 0h 00m |
| F2 | Wait ~10 min → Start break at T+10 | Total ≈ 0h 10m |
| F3 | Wait ~5 min on break → End break at T+15 | Total still ≈ **0h 10m** — break time did NOT count. Screen shows "breaks: 0h 05m (not counted)" |
| F4 | Wait ~5 min → Check out at T+20 | Final total ≈ **0h 15m** (20 gross − 5 break). Confirmation shows it |
| F5 | Two breaks in one day (repeat with a second break) | Both breaks summed and excluded; today's punch list shows all 6 events in order |
| F6 | Check out while still ON break (skip End break) | Allowed; the open break is closed at the check-out instant and still excluded from the total |
| F7 | [Config check] Set `tenants.config.wfm.deduct_breaks = false` (SQL) and re-check totals | Total switches to gross (out − in, breaks ignored) — the old spec behaviour. Set back to true after |

## G. Late / absent (live board logic)

| # | Steps | Expected |
|---|---|---|
| G1 | Check in more than shift start + grace (e.g. after 09:10 for the General shift) | Live board first-in shows red "late" marker |
| G2 | An employee with an assigned shift who hasn't checked in after start + grace | Shows red **Absent** pill |
| G3 | The same employee with a leave record covering today (insert into `wfm_leave_records` via SQL until the UI ships) | Shows **On leave**, not Absent |
| G4 | Add today's date into `wfm_holidays` (SQL) and reload | Banner "Today is a holiday — no lateness or absence is being marked"; no late/absent pills |
| G5 | On a Sunday (default week-off) | Same behaviour as G4 with the week-off banner |

## H. Security / integrity — "no employee can alter attendance"

| # | Steps | Expected |
|---|---|---|
| H1 | As the plain member (EMP-002), open /wfm/live-board and /wfm/employees | API data calls return 403 (employee is not a supervisor); pages show error, no data |
| H2 | As EMP-001 (wfm_role=supervisor, but tenant role member): same pages | Allowed — supervisor sees the board and employee management |
| H3 | As a plain member, using browser dev tools + the anon key, POST directly to Supabase REST: `insert/update wfm_presence_events` | **Rejected by RLS** (no write policy exists for session clients). This is the acceptance-critical case |
| H4 | Same, try `update employees set shift_id=…` on your own row via REST | Rejected (admin-only write policy) |
| H5 | Punch with a hand-crafted ts 8 days in the past or 10 min in the future | 400 "ts out of acceptable range" |
| H6 | Punch with ts earlier than your last punch | 409 "Punch time predates your last punch" |

## I. [LATER] — built in M2/M3, keep for the full UAT

- Timesheet screen: month view, per-day in/out/breaks/net hours, late marks, leave days.
- Corrections round-trip: employee requests missing check-out → supervisor approves →
  original event superseded (never edited), new event with source=correction, timesheet updates.
- Offline punch: airplane mode → punch → reconnect → queued punch syncs with the ORIGINAL
  capture time, no duplicate on retry.
- Late→half-day counting (3 late marks ⇒ 1 half-day in summary), night-shift count ×
  allowance, midnight-crossing shift attribution to start date.
- Monthly CA summary: on-screen + Excel export, full-time vs contractor sections.
- Selfie retention: punch selfies auto-deleted after 90 days; enrollment photo kept.

---

**Pass criterion for M1:** C1–C6 and F1–F4 green, H3 rejected, and the punch appears on
the live board — that is the contract's "one real punch flows end-to-end" gate.
