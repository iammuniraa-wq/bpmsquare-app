# Workforce Management for the Middle East — plan

> Plan for the owner, 2026-10-24. Not built. Built from three code scans (punch sources, phone dependence, country rules) and
> `GCC_READINESS.md`. Countries first: KSA, then UAE, then Qatar (Big Blue). Rule: **statutory behaviour is data per pack, never a
> country branch in code** (`WFM_PROJECT_COSTING.md` section 7, bpmsquarecore.md section 1). Dates and percentages marked *verify*
> must be confirmed with each country's current labour regulation before they ship as pack defaults.

## 1. What already fits

Hours engine (pure, shift-day logic, cross-midnight), roster, shifts and sites, leave, corrections, OT approval flow, monthly summary and
CA/payroll Excel export, project attribution and billing, change history. Configurable already: week-off days, holidays (bulk upload),
leave types and quotas, flat OT rate, late marks, timezone and GCC currencies (3-decimal for OMR, KWD, BHD).

## 2. The two big changes

### 2a. Camera mode (workers do not carry phones)

New config `punch_method: phone | kiosk | camera`. In `camera` mode the phone surfaces (geofence, selfie, consent for selfie, web push,
login and passkey, WFH and site-visit punches) are hidden; supervisors keep every tool.

- **Ingest:** `POST /api/wfm/ingest/presence`, batch, key-authenticated per camera (token bound to a site, hashed, admin-issued once,
  rotatable: the kiosk-device pattern), new `source = 'camera'` (widen the source CHECK). Each event: vendor event id (idempotent),
  camera id, direction (entry or exit), time, confidence, person reference (**the employee code we already generate**), optional image
  reference. Camera id, vendor event id and confidence go in `flags` first.
- **Identity:** the vendor's recognition system returns our employee code; no biometric matching on our side in this mode. An unknown
  or low-confidence person goes to a review queue (new `wfm_camera_review`), never silently dropped. If a vendor can only send video, a
  face service in a GCC region would be needed (decision).
- **Reducer between camera and punches:** sightings are noisy. A pure, tested function collapses duplicates inside N minutes, takes the
  first entry and last exit per shift day (configurable tolerance), flags missing exits for the supervisor, orders late or out-of-order
  events, then writes ordinary `check_in` / `check_out` events through the existing project-attribution step (`resolveProjectForPunch`).
  The state-machine 409 rules for human punches stay as they are.
- **Overtime without punches:** derived. Hours beyond the shift's standard day, or worked on a weekly off or holiday, become **OT
  candidates** the supervisor approves in the existing flow; no `ot_in/ot_out` needed.
- **Breaks without punches:** a fixed deduction per shift (config) replaces break punches; `deduct_breaks` keeps its meaning.
- **Fix first:** the kiosk code comment says match confidence is stamped on the punch but it was not; done in the 2026-10-23 security
  follow-up, so camera confidence can use the same `flags.match_confidence`.

### 2b. Statutory rules as pack data

A **rules engine** (pure) reads a per-workspace `config.wfm.rules` document, filled by the pack and editable:
- **Overtime:** multipliers and bands (for example 125 percent normal, 150 percent on weekly off, holidays and the night band,
  *verify per country*), weekly caps, daily caps; applied to the derived OT and to the summary and project billing (also GCC_READINESS
  gap 1, OT billing).
- **Working-hour limits:** 8 per day and 48 per week (*verify*), shown as warnings and caps.
- **Ramadan:** a date range (entered per year, since Hijri dates move) with reduced daily hours for Muslim employees (*verify scope per
  country*); shift and OT calculations read the range.
- **Midday-sun ban:** a summer date range and time window per country (*verify*), shown as a roster and attendance flag for outdoor sites.
- **Holiday calendars:** per-country starter calendars with Eid dates adjustable (moon sighting), loaded through the existing bulk path.
- **Statutory leave:** starter leave types and quotas (annual, sick tiers, Hajj, marriage, bereavement, maternity, iddah, *verify*),
  with tenure-based accrual and document requirement flags as new leave-type fields.
- **End of service (EOSB, gratuity):** a calculation report from join date, basic salary and reason for leaving, per country formula
  (data), shown on the employee and exportable; not posted to payroll.
- **Payroll files:** **WPS / SIF (UAE) and Mudad (KSA)** as export templates on the existing summary export; QAR WPS format for Qatar.
- **Employee data:** nationality, gender (for rules), date of joining, sponsor, Iqama or Emirates ID, passport and visa numbers with
  **expiry dates and alerts**, IBAN (bank details are India-shaped today: account, IFSC, UPI), all as employee fields (migration), with
  PII encrypted like bank details.
- **Locale:** the six GCC timezones in the picker, Arabic / RTL (large, deferred until a paying GCC workspace asks), consent text per
  country (today India's DPDP wording), data-protection retention for camera images (new setting), face data region review.

## 3. The Region pack

`config.country` (KSA, UAE, QAR..., new) chosen once in Tenant Studio / new-tenant form; a pack is a typed preset table in code (the
`PACKAGES` and `JURISDICTION_RULES` pattern). Applying it writes defaults into the workspace's own config and seeds rows (holidays,
leave types, week-off, OT rules, punch method, timezone, currency, consent jurisdiction, e-invoicing scheme); everything stays editable;
change-logged. Studio allow-list (`normalisePlan`) extended so the plan can name the country.

## 4. Phases

- **W1 Pack framework and employee fields.** `config.country`, pack tables for KSA and UAE, Studio field, employee fields with expiry
  alerts, IBAN, timezones, consent wording per country.
- **W2 Camera mode.** Ingest route, camera tokens and settings screen (one table, side panel), the reducer, review queue, camera-mode
  UI hiding, confidence and retention settings, a camera simulator script for testing and a demo.
- **W3 Rules engine.** OT candidates and multipliers, caps, Ramadan, midday ban, auto-break; summary and billing use them (a tested
  parity switch so existing workspaces keep today's flat-rate behaviour).
- **W4 Statutory content and payroll files.** Holiday and leave seeds per pack, EOSB report, WPS/SIF and Mudad exports.
- **W5 Privacy and Arabic.** Consent and retention per country, region review for face data, RTL when asked.

## 5. Safety for live clients

BIM and Vikas defaults do not change: every new key defaults to today's behaviour, flags and packs are opt-in, tests prove the summary
for an unchanged config is byte-identical. Migrations are additive; `configPatchCoverage.test.ts` must list every new `WfmConfig` key.

## 6. Decisions needed from the owner

1. Who supplies the camera system, and does it send events with a person ID (the employee code) or only video?
2. Overtime under camera mode: derived OT with supervisor approval, and fixed auto-breaks, acceptable?
3. Which countries and which first client (rules and dates differ; get the client's HR policy as the source of truth, not generic law).
4. Do the clients pay through WPS/Mudad with the files produced here, or only need the monthly summary?
5. Data protection: where face or camera data may be stored, and image retention.
