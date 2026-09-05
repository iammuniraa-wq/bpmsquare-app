# WFM Project Costing — Architecture

> Design gate for the Project Costing capability in WFM. Written 2026-09-03
> after a research pass over SAP CATS, UKG/Kronos, ADP, Workday, Zoho
> Projects, busybusy and ClockShark, plus GCC (UAE/KSA) manpower-supply
> practice. **Read this before touching the schema** — several of the
> decisions below are cheap now and a rewrite later.

Status: v1.0 — approved by the owner 2026-09-03, build started same day.

---

## 1. What this is

Attribute worked hours to a **project** so a tenant can answer "how many
hours went into this job, and what did it cost". The industry name is
**project costing** (field/construction vernacular: *job costing*;
payroll-accounting vernacular: *labour distribution*).

The first tenant is BIM Infotech — attendance only, no Service Cloud, no
billing. The design has to serve them without exposing a single field they
don't need, while not foreclosing the GCC manpower-supply model where the
same mechanism is the entire business.

## 2. The finding that shaped the design

The obvious approach — *link a project to a site, derive hours from punches
inside its geofence* — is not how any system does it, including the two
that are GPS-native.

busybusy and ClockShark have our exact setup (geofenced sites, punch on
arrival) and in both the geofence only **verifies presence** — "onsite
verification", clock-in refused outside the fence. The **job and cost code
are declared**: picked by the employee or pre-assigned by a supervisor.

> Location proves *where*. It never answers *what for*.

Three concrete reasons site-derivation fails:

1. Two projects can run at one site at once — punches can't be split.
2. One project can span several sites — its hours scatter.
3. Sites are permanent; projects start and end. If the project link lives on
   the site row, editing it **silently re-attributes every historical
   punch** and last quarter's cost changes. Same principle as
   bpmsquarecore.md §3: cost data is stamped at the time of the event, never
   derived at read time from a mutable parent.

## 3. How the reference systems work

| System | Cost object | Attribution |
|---|---|---|
| SAP CATS | Project → WBS element (n levels) → network activity | Booked against a WBS element; approval required, then CAT7 posts to Controlling |
| UKG/Kronos | Up to 7 *labor levels* | Every punch carries labor-level entries; mid-shift switch = *labor level transfer* |
| ADP | Department → Job → Work order/task (*labor charge fields*) | Codes on the timecard; department transfers mid-shift |
| busybusy / ClockShark | Project → cost code (phase/activity) | Clock into job + cost code; switchable mid-shift; supervisors pre-assign |
| Workday | Project *worktags* on time entry | Worktags required/optional per config |
| Zoho Projects | Project → milestone → task | Manual time logs; `actual cost = logged hours × rate` |

Five mechanics they share, and what we take from each:

1. **The cost object is a hierarchy, never flat.** Everyone has 2–4 levels.
   → We ship one level (project) but the table carries `parent_id` so a
   phase/cost-code level costs a column, not a migration of history.
2. **Attribution is declared, not inferred.** → §4.
3. **Mid-shift transfer is normal, not an edge case.** → §5.
4. **Two rates: cost vs bill.** → §7, deferred but not foreclosed.
5. **Approval gates costing.** SAP won't post unapproved time. → §7.

## 4. Attribution — how a punch gets a project

Our workforce punches at a kiosk; they do not fill timesheets and will not
reliably pick a project on a tablet. So attribution is **pre-assigned by the
supervisor**, which is also what busybusy does ("assign employees to cost
codes, projects and equipment").

`wfm_roster_assignments` is already unique per `(tenant_id, employee_id,
date)` and already carries `site_id` — it is the natural carrier. Adding
`project_id` there is one column and one dropdown on a screen that exists.

Resolution order at punch time, first hit wins:

1. **Roster** — the employee's roster row for that shift-day has a project.
2. **Site default** — the site has exactly *one* active project on that date
   (via the date-effective link in §6). Unambiguous, so auto-assign it.
   This is the case BIM is in, and it costs them zero configuration.
3. **Unassigned** — `null`. A real, reportable state (see §8), never an
   error and never a blocked punch.

The resolved project is **stamped onto the presence event** at insert time
and never recomputed. Changing a roster row tomorrow does not move
yesterday's hours.

## 5. Granularity — per punch, not per day

`project_id` goes on `wfm_presence_events`, not on a day record.

`workSessions()` already splits a day into check-in→check-out stretches
(a day legitimately has several). If each session inherits the project of
its own `check_in`, then **mid-shift transfer is already supported** by the
data model: punch out of project A, punch in to project B. We are not
building the transfer UI in v1, but nothing in the schema prevents it.

Putting `project_id` on a day-level record would make transfer a rewrite
rather than a feature. This is the single most important shape decision here.

## 6. Project ↔ site is many-to-many and date-effective

`wfm_project_sites (project_id, site_id, from_date, to_date)`. Not a column
on either table. `to_date is null` means open-ended.

This is what makes the §4 rule-2 fallback safe: "the site's sole active
project **on that date**" is a question you can only ask of a date-effective
link. With a scalar column it silently becomes "the site's project *now*",
which is the historical-re-attribution bug in a different costume.

## 7. GCC readiness — what we decide now vs defer

The GCC manpower-supply model (agency is the legal employer; workers
deployed to client sites; billed per man-hour against a contracted rate
card) makes the timesheet the primary financial document rather than a
management report. Fully-loaded cost there is salary **plus** visa &
mobilisation, accommodation, transport, medical insurance, leave pay + air
ticket provision, and EOSB/gratuity accrual.

**Decided now** (cheap now, expensive later):

- **No scalar `cost_rate_per_hour` column on `employees`.** When rates land
  they are a record with components and an effective date. A scalar column
  cannot become a loaded rate without rewriting every historical posting.
- **Bill rate belongs to the project's rate card, not the employee.** Each
  client contract has its own rates including separate OT and holiday rates.
  Employee-level bill rate works until the second contract.
- **The approval model leaves room for a third party.** GCC invoicing needs
  a *client*-approved timesheet; ours is supervisor-only. We already have
  signed no-login link machinery (public quote PDF, campaign-interest) that
  would serve a client approval link — just don't build approval so a third
  approver is impossible.

**Deliberately deferred** — real, but separate features, not this one:

- WPS payroll export (UAE pipe-delimited SIF via bank; KSA Mudad XML). The
  export layer is already template-driven (`summaryExportTemplate.ts`), so
  it slots in without touching this.
- OT multipliers with time-of-day banding (UAE 125%, 150% for 22:00–04:00,
  excluded for shift workers normally scheduled then; KSA hourly + 50%) and
  the Ramadan reduced-standard-day calendar (UAE 8h→6h; KSA 6h/36h). These
  are hours-engine changes and must be per-tenant **config**, never
  `if (country === "AE")` — bpmsquarecore.md §1.
- Gratuity/EOSB accrual. Feeds loaded cost; not part of attribution.

## 8. Configurability — nobody is forced into any of it

Layered, so a tenant only meets the depth they bought:

| Level | Adds | Flag |
|---|---|---|
| 1 | Attribution — hours per project. No money anywhere. | `wfm_projects` |
| 2 | Cost rates → cost per project | *(later)* |
| 3 | Rate card → revenue, margin, utilisation | *(later)* |
| 4 | Client approval → invoice-ready timesheets | *(later)* |

`features.wfm_projects` is off by default, missing key reads false. A tenant
without it gets **no nav item, no tab, no column, no API** — absent, not
greyed out. Disabled-and-visible is how a simple product starts feeling
heavy.

BIM runs at level 1: one dropdown on the roster, one column on the summary,
one new screen. They never see a rate field.

**Unassigned is a first-class state, not a null hole.** Utilisation
(billable ÷ available hours) is the headline metric in manpower supply and
needs a bench concept; making it real from the start costs nothing.

## 9. Schema (migration 0104)

```
wfm_projects          id, tenant_id, ref (PRJ-####), name, code, parent_id,
                      account_id?, status, start_date, end_date,
                      budget_hours, custom_data, created_at, updated_at
wfm_project_sites     id, tenant_id, project_id, site_id, from_date, to_date
wfm_roster_assignments  + project_id
wfm_presence_events     + project_id      ← stamped, never recomputed
```

**RLS follows the WFM convention, not the standard one**: tenant-scoped
`select` only, no insert/update/delete policy, every write through the
service-role client behind an app-level role check. Per
MULTI_TENANT_GUARDRAILS.md — a table that drives cost or billing is
something a user has an incentive to forge, so `for all` is the wrong
default here even though `products` (ordinary master data) uses it. This is
the `wfm_ot_sessions` lesson (0077 → 0078) applied up front.

`account_id` is nullable and optional — the Sales link that gives
quoted-vs-actual margin for tenants who have Sales Cloud. BIM leaves it
empty and never sees it.

## 10. Build scope — §3b surfaces

Per bpmsquarecore.md §3b, "build X" means build X on every surface. Tracked
in the commit; deliberate skips stated explicitly rather than left silent.

## 11. Billing — account link, costing, invoice from hours (plan, 2026-09-06)

Owner decisions, recorded so the build has no judgement calls left in it.

### What exists already
- `wfm_projects.account_id` (0104) is nullable and has never been set by a
  screen. Standalone-or-linked is already the data model; the screens are
  what is missing.
- `invoices.account_id` is **NOT NULL**. An invoice cannot exist without an
  account, and the invoicing screens assume one. That is left exactly as it
  is: billing is for account-linked projects only. A standalone project is
  fine to run and report on; to bill it you link an account first, and the
  Bill hours button says so.
- The AMC work-order invoice route already pre-fills a labour line from WFM
  hours x the labour rate in `pricing_items`. That is the precedent, not the
  implementation: rates here get their own config (below).
- Quotes go out by email via Resend as a PDF. Invoices do not -- there is no
  invoice email route. Wiring one is a prerequisite step, useful on its own.
- `GET /api/v1/projects/:id/hours?from&to` (projectHoursServer) is the feed:
  hours per project rolled up over a period, the same arithmetic the screens
  show. An invoice raised from it can never disagree with the screen.

### Decisions
1. **Rate basis -- three rungs, most specific wins**, mirroring attribution
   so there is one mental model: project override > employment type >
   workspace default. Per-employee rates are deliberately NOT offered until
   a client asks. Bill rate (what the customer pays) and cost rate (margin)
   are separate fields; cost rate never reaches the API, same rule as
   `products.cost_price`.
2. **Actual minutes, no rounding** -- consistent with how OT is paid.
3. **Line granularity is chosen at billing time**: one line per Level-1
   sub-project, or one line for the whole project. Not a setting; a choice
   on the preview.
4. **Recipients**: the linked account's contact(s), plus addresses typed in
   by hand. Both, on the send step.
5. **Standalone projects are not billable** (follows from `invoices.
   account_id NOT NULL`). Manual recipients do not change that; they are
   about who receives an invoice, not whether one can be raised.

### Model
- `wfm.costing` in tenant config: `default_bill_rate`,
  `bill_rate_by_employment_type` (code -> rate), `ot_bill_multiplier`
  (billing side only; the pay-side `ot_rate_per_hour` is untouched), tax
  from the tenant's existing tax config.
- `wfm_projects.bill_rate numeric null` -- the override rung. One migration.
- `wfm_project_invoices` (tenant_id, project_id, invoice_id, period_from,
  period_to, minutes, amount, created_at; RLS select-only per the WFM
  convention). The double-billing guard: the preview refuses an overlapping
  period for the same project. Attribution is stamped at punch time, so a
  roster change after billing moves nothing -- billing is stable by
  construction. The one case that adds hours to a billed period is a
  correction approved afterwards; the next preview surfaces it as a top-up
  ("3h added since invoiced") rather than folding it in silently.
- Unassigned hours are never billable (they are on no project). The preview
  shows them as a warning to settle on the roster first.

### Screens
- Project form: optional **Account** picker (searchable). Account shown on
  the project page and list.
- Account page: **Projects** section -- its projects, hours this month,
  unbilled hours, **+ New project** pre-linked via `?account=`.
- Account 360: a Projects card, built the way the drawer already builds
  cards (data, not a component).
- Project page: **Bill hours** -> preview (period, hours per sub-project,
  rate rung applied, amount, tax, unassigned warning, granularity choice)
  -> create invoice (draft) -> send (recipients).

### Sequence
1. Account link (form, page, list, account section + create, 360 card). No migration. **Built 2026-09-06.**
2. Costing config (settings section + project override). Migration. **Built 2026-09-06 (0108).**
3. Invoice from hours (preview, create, link table, guard). Migration. **Built 2026-09-06 (0108).**
4. Send invoices by email (Resend + PDF), independent of 1-3. **Built 2026-09-06.**
5. Month-end auto-draft -- GitHub Actions, since the Vercel Hobby plan's
   two crons are both taken. **Built 2026-09-06.**

## 12. Billing — how it works (built 2026-09-06)

Where things live:

| Piece | Where |
|---|---|
| Rate ladder + line folding (pure, tested) | `src/lib/wfm/billing.ts`, `billing.test.ts` |
| Preview / create / billed periods | `src/lib/wfm/billingServer.ts` |
| App API | `GET/POST /api/wfm/projects/[id]/billing` |
| v1 API | `GET/POST /api/v1/projects/:id/invoices` (`dry_run` previews; write scope on `projects`) |
| Project page | `wfm/projects/[id]/ProjectBilling.tsx` — "Bill hours" card |
| Settings | Settings → Workforce → General → **Project billing** (`config.wfm.costing`) |
| Project override | `wfm_projects.bill_rate` — on the form under "More" |
| Invoice email | `GET/POST /api/invoices/[id]/email`, `invoices/[id]/EmailInvoicePanel.tsx` |
| Month-end drafts | `/api/wfm/cron/project-invoices` ← `.github/workflows/wfm-project-invoices.yml` |
| Schema | `supabase/migrations/0108_wfm_project_billing.sql` |

Rules the code enforces, so nobody has to remember them:

- **Rate ladder**: the project's own `bill_rate`, else the nearest ancestor's,
  else `costing.rates_by_employment_type[type].bill`, else
  `costing.default_bill_rate`. A rate of 0 anywhere means "unset", never
  "free": a preview with a 0-rate line is blocked, not priced at nothing.
- **Cost** has no project rung (what a person costs does not change with
  the job): employment type, else default. Cost and margin show on the app
  preview to admins only and are stripped from the v1 response.
- **Minutes are actual.** Line qty is minutes/60 to two decimals; amount is
  qty × rate to two decimals, so the printed line agrees with itself.
- **Line granularity** is chosen per invoice: one line for the project, or
  one per direct sub-project (the project's own hours stay on the project).
  When people on one line would be billed at different rates and no project
  override flattens them, the line splits by employment type and says so
  ("— Contractor"), rather than showing a blended rate.
- **Tax** is the tenant's existing `config.tax`, shown on the preview and
  applied on the invoice print exactly as for any other invoice.
- **Double-billing guard**: `wfm_project_invoices` records the period each
  invoice covers. A preview refuses any overlap on the project, its
  sub-projects, or a parent that covered it — unless the invoice was
  cancelled. Deleting a draft frees its period (cascade).
- **Top-up**: when the *same* project and period was billed once and more
  hours have landed since (a correction approved afterwards), the preview
  offers "Bill the difference": one line for the delta minutes and the
  delta amount, never a re-bill.
- **Unassigned hours** in the window are shown as a warning, never billed.
- **Standalone projects are not billable** (`invoices.account_id NOT NULL`).
  The card says to link an account first.
- **Email**: recipients are the account's contacts (decrypted server-side)
  plus any typed address; the PDF is the same bytes as "Download PDF"; a
  draft becomes `sent` on the first successful send; every recipient is a
  row in `email_log` (kind `invoice`).
- **Month-end**: with `costing.auto_draft_monthly` on, the 1st drafts last
  month for every active, account-linked, top-level project with hours,
  one line per sub-project. Drafts only. Idempotent via the guard.
- **Overtime is not billed** yet: `wfm_ot_sessions` carries no project, so
  OT minutes cannot be attributed. Deliberately left out rather than
  invented; revisit when OT gets a project stamp.
