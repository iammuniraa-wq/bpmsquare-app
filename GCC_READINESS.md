# GCC Readiness — Project Costing and Workforce Management

> Written 2026-09-06 after the project costing build (WFM_PROJECT_COSTING.md
> §11–13) shipped end to end on the demo. This is the market view: what
> exists in the Gulf today, why the product fits, what it is missing before
> a Gulf sale, and in what order to close the gaps. Owner decisions marked ⚠️.

## 1. The one-line position

**From gate to invoice.** A worker's face-verified, geofenced punch is
attributed to a project with no action on their part, and the customer's
invoice line is produced from that same record with an audit trail back to
the punch. Nobody types a timesheet; nobody re-keys hours into billing.

## 2. What exists in the GCC today

Three families of tools. None runs the whole chain.

| Family | Examples | What they do | Where they stop |
|---|---|---|---|
| HR / attendance platforms | Bayzat, ZenHR, Jisr, PalmHR, greytHR ME, Truein | Attendance, geofence, shifts, overtime at 125/150 %, payroll, WPS, GOSI, Mudad | At payroll. No customer invoice. Truein targets site contractors but has no billing. |
| Timesheet / project tools | Harvest, TimeCamp, Zoho, Odoo timesheets | Hours → invoice | Hours are self-reported timesheets, not verified punches; no labour-law attendance, shifts or sites. |
| ERP job costing | Sage HCM, SAP Business One, Dynamics, dotsHR | Job costing from approved timesheets, invoicing | Integrator-led, expensive, still fed by timesheets typed after the fact. |

The gap between them is exactly what we built: verified attendance,
automatic attribution, billing from the same record.

## 3. Why the Gulf is the right market

- **The region runs on supplied labour.** Manpower supply, secondment,
  facility management, MEP, security, cleaning, oil and gas services all
  bill clients per man-hour or man-day. Man-hour disputes are the normal
  state of affairs; a client who can see verified hours behind every line
  has less to argue about.
- **Overtime is regulated and priced.** UAE: 125 % normal, 150 % between
  22:00 and 04:00, Ramadan day is six hours and anything beyond is overtime.
  KSA: 150 % (basic + 50 %). Any contractor billing hours must get this right
  on the cost side and pass it through on the billing side.
- **Compliance deadlines create buying moments.** KSA e-invoicing Phase 2
  wave 24 pulled businesses above SAR 375,000 turnover into live ZATCA
  integration by 30 June 2026. UAE e-invoicing pilots 1 July 2026, large
  businesses mandatory from 1 January 2027, everyone else from 1 July 2027,
  through Peppol accredited service providers (PINT AE format).
- **Payroll rails are digital.** WPS (UAE), Mudad + Qiwa + GOSI (KSA). The
  attendance side of the product already produces the monthly summary those
  files are built from.

## 4. What we have that the HR platforms do not

- Verified hours: face kiosk, selfies, geofence, tamper-evident punches.
- Attribution with no employee action: roster > linked people > shift >
  site, stamped at punch time, never recomputed.
- Rate ladder (project > employment type > workspace default) with internal
  cost and margin on the preview.
- Double-billing guard by period; top-up for hours added after invoicing;
  month-end auto-draft.
- Invoice by email from the system, with the demo-safe email output channel.
- Analytics, Talk to data over every work session, the v1 API and MCP for
  integrators, Data Workbench for bulk load.
- Multi-tenant SaaS price point against ERP.

## 5. Gaps before a Gulf pitch — in the order to close them

| # | Gap | Why it matters in the Gulf | Size | Status |
|---|---|---|---|---|
| 1 | **Overtime billing.** OT sessions carry no project, so OT is neither attributed nor billed. | Every man-hour contract bills OT at a multiplier. | Medium: stamp project on `ot_in` via the same resolver; add `ot_bill_multiplier` to costing; OT lines on the preview. | ⚠️ not started |
| 2 | **Billing by worker category.** Contracts price by skill category (engineer, technician, helper), not by employment type. | Rate cards in tenders are per category. | Small–medium: a `billing_category` on the employee plus a rung in the ladder, or reuse employment types as categories. | ⚠️ decision: reuse types vs new field |
| 3 | **Client timesheet sign-off.** Clients approve hours before they accept an invoice. | Avoids the invoice dispute loop. | Medium: signed public link (like the quote public link) showing the period's lines with Approve / Query; draft raised on approval. | not started |
| 4 | **E-invoicing.** KSA is live now; UAE from 2027. | Legal requirement to send the invoice at all. | Medium–large: provider integration (ZATCA-compliant XML + QR + cryptographic stamp for KSA; a Peppol ASP for UAE). Do not build the crypto ourselves. | not started |
| 5 | **Currency and locale.** ₹ is hardcoded on invoice, billing and analytics screens; en-IN number format. | AED and SAR, with 5 % / 15 % VAT (tax config already exists). | Small: tenant currency in config, one `money()` helper. | not started |
| 6 | **Arabic / RTL.** | Comes up in every enterprise conversation, less so with SME owners. | Large; defer until a paying Gulf tenant asks. | deferred |
| 7 | **Man-day billing.** Some contracts bill per day, not per hour. | Common for helpers and drivers. | Small: a per-day rate option on the ladder, day = any session on that date. | not started |
| 8 | **WPS / Mudad file export.** | Payroll side, not billing; the monthly summary already has the numbers. | Small–medium per country. | not started |
| 9 | **Biometric device gate.** ZKTeco-style terminals at site gates are common. | Kiosk face punch covers it where a tablet is acceptable; device import covers the rest. | Medium: presence-event import from device logs. | not started |

## 6. Positioning

- **Who:** labour-supply and site-services companies, 50–500 workers, UAE
  and KSA first.
- **Against Bayzat and the HR platforms:** they stop at payroll; we go on
  to the invoice, from the same verified record.
- **Against ERP:** they need an integrator and still run on timesheets; we
  are live in a week and nobody types hours.
- **Proof points to lead with:** the punch screen showing the project, the
  billing preview with the rate that applied, the invoice with the period
  on every line, and Talk to data answering "billable amount by account
  last month".

## 7. Sources consulted (2026-09-06)

Sage Middle East time management; Truein GCC; dotsHR project costing;
Bayzat vs Jisr; Ensaan GCC HR comparison; Qeemah and Flick ZATCA Phase 2
guides; Avalara and ClearTax UAE e-invoicing timelines; Paci UAE overtime
rules 2026; WION Ramadan 2026 hours; Safwa HR Mudad guide; Mercans Qiwa
glossary.
