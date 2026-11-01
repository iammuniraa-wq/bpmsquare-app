# Workforce rules by employment type — design and build plan

**Status 2026-11-03: approved to build (owner), nothing built.** Mock-up (self-contained, sample data, every interaction
works, PC and 375 px): `docs/design/wfm-rules-by-type-mockup.html`. SQL the owner runs for BIM (slice 1):
`scripts/run-bim-trainee-rules-2026-11-03.sql`. Every file, function, column, line and test named here was read in the
code on 2026-11-03 (branch `develop`).

**Owner request (2026-11-03, client BIM Infotech, live WFM tenant; Vikas also runs WFM).** "Can we have a different set
of rules for different employee types? Easy for anyone to maintain, and applicable to all with a button click. Trainees
don't have any paid vacations." The client's exact Trainee policy: *"No leaves even on Sunday, training is there; no sick
leave; no comp off. When required, upon leave request they will get leave approved by BIM."* The owner stressed: the
Trainee set is the worked example, but the model must stay generic so any type can get its own combination later.

**Owner constraints baked in.** (1) Simple by design: a type's rules are one short list of *Same as everyone / Custom*
rows; more rules mean another tab inside the panel (`useUrlTab`), never a longer page. (2) The BIM Trainee set is applied
by SQL by the owner, not clicked: the storage shape is exact (section 2) and the script is part of the deliverable
(section 9).

---

## 1. What is already there (6c: look first)

| Piece | State today (read in the code) | What happens to it |
|---|---|---|
| Employment types | `WfmConfig.employment_types: {code,label}[]` (`src/lib/constants.ts` 940), seed `DEFAULT_EMPLOYMENT_TYPES` full_time/contractor (1035); edited as a row list in `settings/workforce/RulesTab.tsx` 104-122 (`setTypeLabel`, `setTypeCode`, "+ Add type"), cleaned by `cleanEmploymentTypes` (`logic.ts` 57) and validated by the PUT route (`api/settings/workforce/route.ts` 140-151, `CODE_RE`). `employees.employment_type` holds the code; validated in `api/wfm/employees/route.ts` 67-69 and `[id]/route.ts` 201-217 with `employmentTypeError` (`reportRules.ts` 66). BIM has Full-time, Intern, Trainee, To Be Assigned. | The row list becomes a small **table** (the shared `SettingsList`); a row opens the **type panel** that holds its rules. Codes, labels, validation unchanged. |
| A per-type value that already exists | `costing.rates_by_employment_type: Record<code, {bill?, cost?}>` (`constants.ts` 1013-1014), "rung 2 keyed by employment-type CODE", edited in `BillingTab.tsx`, validated in the PUT route 237-249. | **The precedent for storage**: rules are a second map keyed by code, `type_rules`. Billing rates stay where they are (one place per setting). |
| A per-person override resolved in one function | `phonePolicy(override, workspaceDefault, remoteMode)` (`src/lib/wfm/selfService.ts` 51): one pure function used by the punch route AND by `buildWfmMeState` "so the screen cannot offer a button the gate will refuse". | **The precedent for the resolver**: `rulesFor()` is the same idea for the type layer. |
| Holidays by type | `wfm_holidays.applies_to` = `'all'` or one type code; `monthlySummary.ts` 487-489 and `server.ts` 503-505 (live board) already match `applies_to === emp.employment_type`; `holidayAppliesTo` (`holidayAlert.ts` 20) for the Monday digest (`api/wfm/cron/holiday-week/route.ts` 84). But `APPLIES_TO = ["all","full_time","contractor"]` is hard-coded in `api/wfm/holidays/route.ts` 16 and `bulk-upload/route.ts` 16, the screen hard-codes the three labels (`wfm/leave/HolidaysClient.tsx` 9, 187, 202, and `MeClient.tsx` 2694), **and the table has a CHECK** `applies_to in ('all','full_time','contractor')` (`supabase/migrations/0062_wfm_module.sql` 169-170, never altered since). So an Intern- or Trainee-only holiday is impossible today at the database. | Route, upload and screens offer the **configured types**; the CHECK is replaced by a migration (section 7). The matching logic needs no change. |
| Leave rules | `wfm_leave_types` (0062 + 0109 `monthly_limit`, `paid_days_per_month` + 0112 `quota_period`); pure arithmetic in `leaveRules.ts` (`checkMonthlyLimit`, `paidWithinMonthlyAllowance`), server half in `leaveServer.ts` (`LeaveTypeRow`, `loadLeaveType`, `quotaFor`, `effectiveMonthlyCap`, `monthlyLimitError`); request creation `api/wfm/leave-requests/route.ts` 100-109; admin entry `api/wfm/leave-records/route.ts` 69-77; approval writes a `wfm_leave_records` row (`leave-requests/[id]/route.ts` 124-138); the monthly summary turns paid days beyond the allowance into **unpaid** (`monthlySummary.ts` 389-405, `paidAllowanceByType` 615) and totals `paid_leave_days` / `unpaid_leave_days` 593-594; the balance screen data `getLeaveBalance` 636-674 (served by `api/wfm/me/timesheet/route.ts` 43, 56); the employee's dropdown `MeClient.tsx` 2342-2349; the supervisor table `LeaveClient.tsx` 191. Quotas: `wfm_leave_quotas` default row (employee_id null) + per-employee override. | Gains a per-type layer: **eligibility** (offered / not offered) and **paid days** (same / unpaid / up to N a month) per leave type, resolved by the same function on every one of those paths. |
| Comp off | **No comp-off logic exists.** "Comp off" is only a leave type by convention (BIM: a type with `monthly_limit` 1, see `leaveRules.test.ts` 11 "CompOff at most 1 a month"; `siteApprovers.ts` 14 names it). Nothing credits a day for working a weekly off or a holiday; the Saturday rule (`saturdayRule.ts`, `saturdayRosterServer.ts`) writes roster rows and one `applies_to: 'all'` holiday row, no compensation. | "Comp off not available" for a type = the Comp off leave type **not offered** for that type. No new mechanism. Automatic credit for a worked off day stays out of scope (it does not exist for anyone). |
| Weekly off | `WfmConfig.week_off_days` (0 = Sunday), workspace-wide: summary `monthlySummary.ts` 498 (`isWeekOff`, plus 2nd Saturday), live board `server.ts` 464-466 (**computed once for the whole board**, before the per-employee map), `standardMinutesForDay` (`reportRules.ts` 36) takes `weekOff`, the calendar marks come from the timesheet days' `is_week_off` (`LeaveRangePicker.tsx` 12). | Resolved per employee (`rulesFor(emp.employment_type, config).week_off_days`); the live board moves the check inside the map. **None** is a valid value. |
| Punch types, OT rate, OT minimum, late marks | `punch_types` gate in `api/wfm/punch/route.ts` 176-177 (`PUNCH_KIND_GROUP`), `meState.ts` 167-169 (WFH today) and 210 (`punch_types` to the screen), `employees/[id]/route.ts` 152-153 (remote mode needs the group on); `ot_rate_per_hour` and `ot_min_minutes` in `monthlySummary.ts` 527, 602 (`otCountedMinutes`); `late_marks_per_half_day` 590; `CorrectionsPageTabs` `otEnabled` (workspace flag, a supervisor tab). | Resolved per employee at those lines (slice 2 and 3). `otEnabled` for the supervisor tab stays the workspace flag (a tab, not a person's rule). |
| Settings screen | Settings > Workforce = one draft, one Save, tabs Rules / Shifts / Places / Leave / Alerts / Billing (`WorkforceClient.tsx`, `WORKFORCE_TABS` in `settingsFolded.ts` 18, `TAB_LABEL` in `logic.ts` 10); lists (shifts, sites, leave types) save from their own `SidePanel`; `CONFIG_KEYS` (`logic.ts` 20) and `changedConfig` decide what is sent; tips in `tips.ts` tested by `workforce.test.ts` ("every tip fits the InfoTip limit"); `settingsMenu.ts` 76 entry is `adminOnly: true, featureKey: "wfm"`. | No new tab, no new menu entry. The type panel is a list panel like shifts and sites and **saves on its own** (sends `{ type_rules }` only). |
| Audit | `PUT /api/settings/workforce` writes **no `logChange` at all** (read 2026-11-03: the route ends with `tenants.update` and `revalidateTag`). `OBJECT_TYPES` in `administration/change-history/ChangeHistoryClient.tsx` lists `wfm_leave_types` (62) but nothing for workforce settings. | The route logs `type_rules` changes (and, same cost, every other key it changes) as `wfm_settings`; the filter gets "Workforce: Rules". |
| Config read path | `getWfmConfig` (`server.ts` 157-188): React `cache()` per request over `tenants.config`, defaults spread from `DEFAULT_WFM_CONFIG`, nested groups merged by hand; `GET /api/settings/workforce` merges the same way (route 29-37). `configPatchCoverage.test.ts` fails the build if a `DEFAULT_WFM_CONFIG` key has no `body.<key>` branch in the PUT route. | `type_rules` gets its own merge line in both places, a PUT branch, and `DEFAULT_WFM_CONFIG.type_rules = {}`. |

**6c check.** What is reused: the employment-type list, `SidePanel`, `SettingsList`, `Tabs`/`useUrlTab`, InfoTip, the
holidays screen, `logChange`. What is replaced: nothing. Duplicates: zero (billing rates stay on Billing; holiday audience
stays on Holidays and is only *shown* in the panel as a count with a link). Options on the first view of the panel: one
tab of 4-5 rows (one per leave type), each row one select; Days = 3 rows; Punches = 5 rows. Each tab fits a phone screen.

---

## 2. The model

### 2.1 One sentence
A **rule set per employment type that inherits from the workspace**: every type is *Same as everyone* until an admin sets
a row to *Custom*; only the custom rows are stored; every enforcement point asks one pure resolver for the person's
effective value. A new type works with zero setup; a workspace that never sets an override behaves exactly as today.

### 2.2 Storage — inside `tenants.config`, no new table
`WfmConfig.type_rules: Record<EmploymentTypeCode, WfmTypeRules>` in `src/lib/constants.ts`, default `{}`.

```ts
// src/lib/constants.ts (new)
export type WfmTypeRules = {
  /** Keyed by wfm_leave_types.id. off = not offered to this type; unpaid = recorded, every day counts as unpaid;
   *  paid = the first `paid_days_per_month` days a month are paid (0 = unpaid). Absent = the leave type's own rule. */
  leave?: Record<string, { mode: "off" } | { mode: "unpaid" } | { mode: "paid"; paid_days_per_month: number }>;
  /** [] = none: every weekday is a working day. Absent = WfmConfig.week_off_days. */
  week_off_days?: number[];
  late_marks_per_half_day?: number;
  /** Only `false` is stored: a type can switch a group off, never on (the supervisor tabs hang on the workspace flag). */
  punch_types?: Partial<Record<"ot" | "mobile_work" | "business_trip", false>>;
  ot_rate_per_hour?: number;
  ot_min_minutes?: number;
  /** Given to a new employee of this type; verified against wfm_shifts on save. A person's own shift_id still wins. */
  default_shift_id?: string | null;
};
```

JSON path: `tenants.config -> 'wfm' -> 'type_rules' -> '<code>'`. The BIM Trainee entry the SQL writes:

```json
{ "wfm": { "type_rules": { "trainee": {
  "week_off_days": [],
  "leave": { "<id of Paid leave>": {"mode":"off"}, "<id of Sick>": {"mode":"off"}, "<id of Comp off>": {"mode":"off"} }
} } } }
```
(every active leave type whose `category <> 'unpaid'` is `off`; the unpaid-category type is absent = offered, unpaid.)

Why JSONB and not a table: the values are a handful of scalars per type; they are read by the same `getWfmConfig` every
rule already reads; RLS and a migration buy nothing (the PUT route is admin-only, `tenants.config` is already member-readable
and holds no secret here); the "keyed by code" shape already exists (`rates_by_employment_type`). Why a separate map and
not `employment_types[].rules`: the list editor rewrites rows (`cleanEmploymentTypes`) and `changedConfig` would send
rules whenever a label changed; a separate key means the panel sends `type_rules` and nothing else.

Validation in the PUT route (`api/settings/workforce/route.ts`): drop keys whose code is not in the merged
`employment_types`; drop leave ids not in this tenant's `wfm_leave_types` (`.eq("tenant_id", tenantId)`); `week_off_days`
as the workspace one but **empty allowed**; numbers as the workspace ones; `punch_types` only `false` values;
`default_shift_id` verified like `saturday_rule.short_shift_id` (route 207-219). Removing a type on the Rules tab removes
its entry (one line in the same PUT).

### 2.3 Resolver — `src/lib/wfm/typeRules.ts` (pure, client-safe, tested)
```ts
export function rulesFor(employmentType: string | null | undefined, config: WfmConfig): ResolvedTypeRules
// -> { week_off_days, late_marks_per_half_day, punch_types, ot_rate_per_hour, ot_min_minutes, default_shift_id,
//      source: Record<RuleId, "workspace" | "type"> }
export function leaveRuleFor(employmentType, leaveType: Pick<LeaveTypeRow,"id"|"category"|"paid_days_per_month">, config)
// -> { eligible: boolean; paid_days_per_month: number | null; unpaid: boolean; source: "workspace" | "type" }
//    unpaid = category unpaid, or mode unpaid, or paid_days_per_month === 0
export const TYPE_RULES: TypeRuleDef[]   // the catalog the panel and the compare view render: id, tab, label, kind, tip key
```
Unknown or empty type (e.g. "To Be Assigned" with no entry, or an old row with a removed code) resolves to the workspace
values. `rulesFor(x, {...cfg, type_rules: {}})` returns exactly the workspace picks for every x — the Vikas-safety test.

### 2.4 Enforcement points that call it (every one named)
| Where | Today | After |
|---|---|---|
| `monthlySummary.ts` 487-489 holiday | per type already | unchanged |
| `monthlySummary.ts` 498 `isWeekOff` | `config.week_off_days` | `rulesFor(emp.employment_type, config).week_off_days` (2nd Saturday part unchanged, see 2.5) |
| `monthlySummary.ts` 389-405 paid allowance | per leave type | per employee **and** leave type: `leaveRuleFor(emp.employment_type, type, config)`; a day of a not-eligible type is still counted if a record exists (unpaid); the appended name reads `(unpaid for Trainee)` instead of `(beyond N paid days this month)` when the rule came from the type |
| `monthlySummary.ts` 527, 590, 602 | workspace OT min / late marks / OT rate | resolved per employee (slice 2) |
| `server.ts` 464-466 live board `isWeekOff` | once per board | inside the `employees.map` per row |
| `api/wfm/leave-requests/route.ts` after 103 | type exists and is active | `if (!leaveRuleFor(employee.employment_type, leaveType, config).eligible) 400 "Sick is not offered for Trainee. Use Leave on approval."` |
| `api/wfm/leave-records/route.ts` after 69 | same | same check against the chosen employee's type (admin entry) |
| `getLeaveBalance` (`monthlySummary.ts` 653) | every active type | not-eligible types filtered out; each row carries `pay: "paid" \| "unpaid" \| { paid_days_per_month }` and `pay_source` for the wording |
| `GET /api/wfm/leave-requests` (supervisor) | embeds `employees(first_name,…)` | adds `employment_type` to the embed so the table can show the chip without a second call |
| `api/wfm/punch/route.ts` 176-177, `meState.ts` 167-169 and 210, `employees/[id]/route.ts` 152-153 | `config.punch_types` | `rulesFor(employee.employment_type, config).punch_types` (slice 2) |
| `api/wfm/employees/route.ts` 94 (create) | `shift_id` from body | `shift_id ?? rulesFor(type).default_shift_id` (slice 3) |
| Holiday digest cron, Saturday generator, `summaryWorkbook.ts` | — | unchanged |

### 2.5 Weekly off **None** — how it interacts with everything else (precise)
For a person whose type resolves `week_off_days: []`:
- **Absence**: `monthlySummary.ts` 503 `if (dayShift && !effective.isDayOff && !onLeave && !holiday && !isWeekOff)` — Sunday is judged like Monday: no punch on a past Sunday = **absent**; a late check-in = a late mark. The live board does the same today.
- **Standard hours**: `standardMinutesForDay` gets `weekOff: false` on Sundays, so Sunday adds the shift length to `standard_minutes` and to the Actual Hrs figure of the BIM export (CR-BIM-001). No off-day credit of any kind.
- **Holidays still apply**: a holiday with `applies_to = 'all'` (Republic Day, the generated "2nd Saturday") or one for the person's type is a holiday for them too — weekly off and holidays are independent checks, as today. A holiday nobody wants trainees to have is simply added for the other types only (the Holidays screen now offers "These types").
- **Roster wins per person**: a `wfm_roster_assignments` row with `is_day_off` for one trainee still gives that trainee that day off (`effective.isDayOff`, unchanged). This is how a supervisor gives a trainee a Sunday off.
- **Alternate Saturdays** (`saturday_rule`): stays a workspace rule in release 1. The generator still rosters every active employee (trainees included) onto the short shift and writes the 2nd-Saturday holiday for `'all'`; the punch gate (`punch/route.ts` 203-207) stays. Release 2 adds a per-type "Alternate Saturdays: Same / Not applied" row: the generator then writes the holiday row per type that keeps it (one row each, the unique key `(tenant_id, date, applies_to)` allows it) and skips roster rows for excluded people; the punch gate and `isSecondSaturday` fallback (`monthlySummary.ts` 499) read `rulesFor`. Assumption stated in section 8.
- **Calendar marks**: the employee's leave calendar reads `is_week_off` from the resolved summary days, so a trainee's calendar shows no "Week off" on Sundays.
- **Leave on a Sunday**: allowed (a working day); counted and, for the trainee, unpaid.

### 2.6 Leave eligibility, "Leave on approval" and comp off (the Trainee policy, generic)
- **Which types a person may request** = `leaveRuleFor(...).eligible`. Not offered: absent from the employee's dropdown and balance tiles, 400 on the request route, 400 on the admin-entry route (so an admin cannot accidentally file Sick for a trainee), and a red "Not offered for Trainee" chip on a pending request that was filed before the rule changed (the supervisor approves it as unpaid or rejects it; nothing is deleted).
- **"On request, approved by BIM"** = the tenant's own **unpaid-category leave type**, which BIM names *Leave on approval* (category Unpaid, 30 a year, no monthly cap). **Not a new built-in.** Reasons: the category `unpaid` already makes every day of it unpaid in the summary (`category === "unpaid"` at 594) and in the export; approval is the ordinary supervisor flow (`leave-requests/[id]` PATCH, scope by site, notifications); every tenant names its types; a built-in type would be a code branch for a thing that is data (3c rule 11 spirit). The type panel shows unpaid-category types as "Unpaid, on approval" with no control (there is nothing to override); if a workspace has none, the Leave tab of the panel shows one line "Add an unpaid leave type under Leave to allow leave on approval" (a next step on an empty state, allowed to stay visible per 6b).
- **Comp off not available** = the Comp off leave type set to *Not offered* for the type. There is no credit mechanism to switch off (section 1).
- **Paid leave none** = Paid leave *Not offered* (BIM's reading: trainees have no paid vacation at all). The alternative *Unpaid* (recorded under the Paid leave name, counted unpaid) exists for a type that may take the leave but not be paid — Intern in the mock-up.

### 2.7 "Applicable to all with a button click" — what it means technically
Rules resolve at run time by the employee's type, so a saved rule set applies to every person of that type on their next
request: the punch screen (`buildWfmMeState`), the next leave request, the live board's next refresh (30 s), the monthly
summary the next time it is viewed or exported. **Apply is the Save**: the panel's primary button reads *Apply to 14
Trainees* and opens one confirm that lists each changed row (before → after), the count of active employees of the type,
the number of their pending leave requests, and two sentences: nothing is recomputed (the summary is live); approved
leave stays approved and whether a day is paid is worked out by the summary with the rules in force when it is viewed or
exported; past exports already sent to payroll are files and do not change. There is no "recompute this month" button
because there is nothing stored to recompute (`getMonthlySummary` builds from events, records and config every call).

**When a person's type changes** (`employees/[id]` PATCH `employment_type`): the new type's rules apply to every
computation from then on, including a past month viewed later — exactly how a shift change, a holiday edit or a leave type
edit behaves today, because nothing per month is stored. Date-effective type history is not built (open question 1).

---

## 3. Which rules can differ per type (release 1 vs later), justified

| Rule | Release | Why |
|---|---|---|
| Holidays that apply (everyone / these types) | **1** | BIM asks for it, the matching already exists, only the CHECK, the routes and the screens hard-code two codes |
| Leave: offered / not offered per leave type | **1** | the Trainee policy (no sick, no comp off, no paid leave) |
| Leave: unpaid / paid up to N a month per leave type | **1** | the generic form of "no paid vacations" for a type that may still take the leave; same arithmetic as `paid_days_per_month` |
| Weekly off days, including none | **1** | "no leaves even on Sunday, training is there" |
| Overtime / Work from home / Site visit: not allowed | 2 | one resolver call at the punch gate and in `buildWfmMeState`; no client asked yet |
| OT rate, OT minimum | 2 | billing-like numbers; BIM runs one rate today |
| Late marks per half-day | 3 | nobody asked; trivial once the resolver exists |
| Default shift for new employees of a type | 3 | convenience for creation; the person's shift stays the rule |
| Alternate Saturdays per type | 2 | needs the generator and the punch gate to read the resolver (2.5) |

**Not in release 1 and why:** annual **quota** per type — `wfm_leave_quotas` has a default row and a per-employee row with
unique partial indexes; a type rung needs a new column or key in two balance functions (`quotaFor`, `getLeaveBalance`); the
BIM need is covered by not-offered / unpaid (open question 3). **Timezone, selfie, face, geofence, login** — workspace
facts, not employment terms. **Night allowance** — a shift attribute. **Billing rates** — already per type on Billing.
**Carry-forward** — a year-end rule; per type later if asked. **Automatic comp-off credit** — does not exist for anyone.

---

## 4. The screens

### 4.1 Settings > Workforce > Rules — employment types as a table, a row opens the type panel
The "Employment types" field (`RulesTab.tsx` 104-122) becomes a `SettingsList` table: **Type** (label, code and people
count under it), **People**, **Rules** (chip: *Same as everyone* / *3 custom* / *Save to set rules* for an unsaved row);
"+ Add type" stays above it; a **List | Compare** segment beside it. Labels and codes are edited in the panel's header
(label editable; code shown, editable only while new — the current rule). The workspace controls above it are unchanged.
The one Save of the screen still saves labels/codes; the panel saves rules on its own (section 4.2).

### 4.2 The type panel (`TypeRulesPanel.tsx`, `SidePanel`; bottom sheet on a phone)
Header: *Rules for Trainee* · *14 people · 1 pending leave request · 4 custom rules*. **Tabs inside the panel**
(`useUrlTab`, key `trule`, like the People panel's `ptab`): **Leave** (one row per active leave type), **Days** (Weekly
off days, Late marks per half-day, Default shift, and a result line "Holidays only for Trainee: 3 this year · Open"),
**Punches** (Overtime, Overtime rate, Minimum overtime, Work from home, Site visit). A tab shows a count chip when it has
custom rows. Each row is: label + InfoTip, one select whose first option is *Same as everyone*, the current value as one
quiet line (*Same as everyone: Sun* / *Custom: None*), a *Reset* link when custom. The Leave select: *Same as everyone ·
Unpaid · Paid, up to N a month · Not offered*; Weekly off: *Same as everyone · Custom* then the seven day buttons (none
ticked is valid); allow rows: *Same as everyone (allowed) · Not allowed* (or a quiet "Off for the workspace" chip when the
workspace has the group off). Under the list: **Copy rules from…** (a select of the other types; copies the whole map into
the draft, nothing saved yet) and **Reset all to everyone**. Footer: *No changes / Unsaved changes* · Cancel · **Apply to
14 Trainees** → the confirm of 2.7 → `PUT /api/settings/workforce { type_rules }` → toast *Applied to 14 Trainees. Logged
in Change history.* Rows a slice has not shipped are not rendered (the catalog `TYPE_RULES` carries a `since` slice), so
release 1 shows Leave and Days with Weekly off only. Phone: the panel is a bottom sheet at 88 % height, selects full width,
44 px rows, Apply in the sheet footer.

### 4.3 Compare (types as columns, rules as rows)
The List | Compare segment swaps the table for a matrix: rule rows grouped by tab, an *Everyone* column, one column per
saved type; a dot means Same as everyone, a filled accent cell is the custom value; clicking a cell opens that type's panel
on that tab. A last row shows the count of holidays only for each type. On a phone: a chip row of types and one column at a
time (no horizontal scroll).

### 4.4 Holidays (Leave & Holidays > Holidays, `HolidaysClient.tsx`)
**Applies to** becomes *Everyone | These types* with chips of the configured types (`employment_types` from the tenant
context); the list shows one line per date+name with chips per type; adding with N types stores N rows (the unique key
allows it; each can be removed alone). `POST /api/wfm/holidays` accepts `applies_to: "all" | string[]` of configured
codes, `bulk-upload` accepts a code or a label in *Applies To* and the template line lists the codes. `MeClient.tsx` 2694
shows the type's label. Before the migration lands, a POST with a non-seed code hits the CHECK (`23514`) and the route
answers 400 *"Run migration 0244 to use this type for holidays"* (degrades, no crash).

### 4.5 What a Trainee sees (`/wfm/me`, Leave)
Header line: *Day shift · Weekly off: none* with an InfoTip. Balance tiles only for offered types; the *Leave on approval*
tile says *Unpaid, on approval*; a quiet line *Not offered for Trainee: Paid leave, Sick, Comp off* with an InfoTip.
Request form: the dropdown lists offered types only, each with its pay wording in the brackets (*Leave on approval (29 left
· unpaid, on approval)*). Choosing an unpaid one shows the one notice that must stay visible: *This leave will be unpaid.
It is recorded only once your supervisor approves it.* After submit the request shows chips *Unpaid · pending*. Wording
comes from one helper (`payLabel` in the mock-up → `leavePayLabel()` in `typeRules.ts`) used by the employee and the
supervisor alike (6b: one meaning per word).

### 4.6 What a supervisor sees (`LeaveClient.tsx`)
The Type cell carries the same chip: *Unpaid, on approval* (quiet), *Unpaid for Trainee* (amber), *N paid a month*
(quiet) or *Not offered for Trainee* (red, with an InfoTip: filed before the rule changed or by an admin; approve = recorded
unpaid, or reject and point to Leave on approval). Approve/Reject unchanged. The monthly summary day cell and the Excel
show the leave name with *(unpaid for Trainee)* appended, the way *(beyond 1 paid day this month)* is appended today.

### 4.7 A new type
"+ Add type" → *Consultant* → Save → the row reads *Same as everyone*; opening it shows every row at *Same as everyone*;
nothing to configure. The holiday and leave screens offer it at once.

---

## 5. Effects

- **Payroll / monthly summary / BIM export**: `paid_leave_days` and `unpaid_leave_days` follow the resolved rule;
  Standard Hrs and Actual Hrs count a trainee's Sundays; sheets per location and type and the Sl No column are untouched
  (`summaryWorkbook.ts` 272-316 already groups by `employment_types`). A trainee's absent Sunday shows as absent.
- **Self-service**: 4.5. **Live board**: a trainee with no punch on a Sunday after grace shows *Absent* (today they show
  nothing because the board treats Sunday as week off for everyone). **Alerts**: the holiday digest already filters per
  type; the late-arrival mail fires on a Sunday for a trainee like any day (it keys off the board's `late`).
- **Data that never changes retroactively**: `wfm_presence_events`, `wfm_ot_sessions`, `wfm_leave_records`,
  `wfm_leave_requests` rows, exported Excel files. The summary is a live computation and will show the new rules for any
  month viewed after the change (stated in the confirm; open question 1).
- **Audit**: the PUT route calls `logChange(admin, { tenantId, objectType: "wfm_settings", objectId: tenantId,
  objectLabel: "Workforce rules", action: "update", actorId, actorEmail, changes })` with one change per rule:
  field `Trainee · Sick`, `before: "Same as everyone"`, `after: "Not offered"` (the same `fmt` the panel uses). Filter
  entry *Workforce: Rules* (`OBJECT_TYPES`, `wfm_settings`). The SQL-applied BIM set is not a UI change and so not logged;
  the script's preview output is the owner's record (section 9).
- **Permissions**: admin only — `PUT /api/settings/workforce` already returns 403 for non-admins (route 62), the menu
  entry is `adminOnly` (`settingsMenu.ts` 76), holidays POST/bulk/DELETE already require `role === "admin"`. Business
  Roles are a menu-visibility feature, not a security boundary (owner 2026-10-23); no change.
- **Multi-tenant**: everything is inside the tenant's own `tenants.config` row (admin client, `.eq("id", tenantId)`),
  leave ids and the default shift id from the body are verified against this tenant before they are stored, holidays
  insert with `tenant_id: tenantId` as today. No new table, no RLS change; the migration only relaxes a CHECK.
- **Cache**: `getWfmConfig` is a per-request React `cache()` (`server.ts` 149-157) — every request reads `tenants.config`
  fresh; `GET /api/settings/workforce` reads the row directly. After the SQL (or a UI Apply) the next request is on the new
  rules; nothing to clear. The only `unstable_cache` over `tenants` is `getTenantBrandingByHost` (branding keys).

---

## 6. Slices (ordered, each shippable)

### Slice 1 — the BIM Trainee policy + holidays by configured types + the resolver
**Delivers exactly:** weekly off per type including none; leave eligibility and pay per type per leave type; holidays for
any configured type; the type panel with the Leave and Days tabs (Days = Weekly off + the holidays result line); Compare;
Copy from; Apply confirm; the employee and supervisor wording; change history; the BIM SQL.

Files:
- `src/lib/constants.ts`: `WfmTypeRules`, `WfmConfig.type_rules`, `DEFAULT_WFM_CONFIG.type_rules = {}`.
- `src/lib/wfm/typeRules.ts` (new): `TYPE_RULES`, `rulesFor`, `leaveRuleFor`, `leavePayLabel`, `formatRuleValue`,
  `diffTypeRules`; `typeRules.test.ts` (new).
- `src/lib/wfm/server.ts` 161-180: merge `type_rules: stored.type_rules ?? {}`; 464-466 live board per row.
- `src/lib/wfm/monthlySummary.ts` 389-405, 498, and `getLeaveBalance` 653-673 (filter + `pay`).
- `src/lib/wfm/leaveServer.ts`: `assertLeaveOffered(admin, tenantId, employeeId, type)` used by both create routes.
- `src/app/api/wfm/leave-requests/route.ts` (after 103, and the GET embed), `leave-records/route.ts` (after 69).
- `src/app/api/settings/workforce/route.ts`: `body.type_rules` branch, orphan-code drop, `logChange`.
- `src/app/api/wfm/holidays/route.ts`, `holidays/bulk-upload/route.ts`: `APPLIES_TO` from `getWfmConfig(...).employment_types`, array form, 23514 → 400.
- `src/app/(app)/settings/workforce/`: `RulesTab.tsx` (table + segment), `TypeRulesPanel.tsx` (new), `TypeRulesCompare.tsx` (new), `logic.ts` (`CONFIG_KEYS` + `type_rules`, `typeRulesPayload`), `tips.ts` (+ ~12 tips), `workforce.module.css` (matrix, rows).
- `src/app/(app)/wfm/leave/HolidaysClient.tsx`, `LeaveClient.tsx` (chip), `src/app/(app)/wfm/me/MeClient.tsx` (2342-2349 wording, 2694 label, header line), `src/lib/wfm/types.ts` (`WfmHoliday.applies_to` comment).
- `src/app/(app)/administration/change-history/ChangeHistoryClient.tsx` (`wfm_settings`).
- `supabase/migrations/0244_wfm_holidays_applies_to_any_type.sql` (section 7); `scripts/run-bim-trainee-rules-2026-11-03.sql` (section 9); PROJECT.md ledger: 0244 pending on both DBs.

Tests to update: `src/lib/wfm/configPatchCoverage.test.ts` (fails until `body.type_rules` exists — that is the point);
`src/app/(app)/settings/workforce/workforce.test.ts` ("Rules shows employment types … up front" now expects the table and
"+ Add type"; `changedConfig` sends `type_rules` only when it changed; the tip test picks up the new tips; add a render test
that the panel shows *Same as everyone* on every row for a type with no entry); `src/lib/wfm/leaveRules.test.ts` (add
`paidWithinMonthlyAllowance(0, …)` → every day false); `src/lib/wfm/holidayAlert.test.ts` (unchanged, `holidayAppliesTo`
already takes any code); `src/lib/rlsPolicies.test.ts` replays migrations — 0244 adds no policy, confirm it stays green.
New `typeRules.test.ts`: (a) **default behaviour byte-identical** — for every code in a 4-type config with `type_rules: {}`
and for `null`, `rulesFor` returns exactly `pick(DEFAULT_WFM_CONFIG, …)` and `leaveRuleFor` returns the leave type's own
rule, deep-equal, with `source: "workspace"` everywhere; (b) the Trainee set resolves to `week_off_days: []`, three
`eligible: false`, the unpaid type `eligible: true, unpaid: true`; (c) an orphan code and an unknown leave id are ignored;
(d) `diffTypeRules` produces the confirm lines; (e) `formatRuleValue([])` is "None (every day is a working day)".
A monthly-summary pure-path test: extract the `isWeekOff` and leave-name decision into `summaryDayRules.ts` (pure) so a
trainee Sunday with no punch is asserted absent with standard minutes, and the same input with `type_rules: {}` is
asserted week-off with 0 — the Vikas-safety proof at the summary level without a database.

Done when: `npx tsc --noEmit`, `npx vitest`, `npx next build` clean; a demo-tenant Trainee cannot see Sick in the dropdown,
sees *unpaid, on approval* on Leave on approval, and a past Sunday shows absent on their timesheet; a Full-time person's
month is unchanged (compare an export before and after with `type_rules: {}`); holidays can be added for Intern; the
panel, Compare and the Holidays form checked at 375 px and on PC (one column, no horizontal scroll, 44 px targets, Apply in
the sheet footer); `docs/design/settings-simplification.md` status row added; Vikas: `type_rules` absent = `{}` = today.

### Slice 2 — punches and overtime per type
`punch_types` (false only), `ot_rate_per_hour`, `ot_min_minutes` rows; `punch/route.ts` 176, `meState.ts` 167/210,
`employees/[id]/route.ts` 152, `monthlySummary.ts` 527/602; Alternate Saturdays per type (generator + punch gate).
Tests: `punchRules.test.ts` sibling for the resolver at the gate; `monthlySummary.otMinimum.test.ts` with a per-type minimum.

### Slice 3 — late marks and default shift
`late_marks_per_half_day` (590), `default_shift_id` on `employees/route.ts` 94 and the New employee form.

### Docs (after the owner validates, per the docs rule)
Website: `guide-wfm-leave-overtime.html` (Holidays step: Applies to; the request screen wording), `workforce.html`
(Settings: employment types table and the type panel). Solution Guide `docs/guides/solution/04-workforce.md` (section
"Leave and holidays", the Settings table, the "Contractor label" caveat at line 323). Drive: Workforce Management (WFM)
Guide, snapshot date bumped.

---

## 7. Migration (one, for holidays only)
`supabase/migrations/0244_wfm_holidays_applies_to_any_type.sql` (0243 is reserved by the WBS design; use the next free
number when built):
```sql
alter table wfm_holidays drop constraint if exists wfm_holidays_applies_to_check;
alter table wfm_holidays add constraint wfm_holidays_applies_to_check
  check (applies_to = 'all' or applies_to ~ '^[a-z0-9_]{1,40}$');
```
The code validates the code against the tenant's configured list; the CHECK keeps the column machine-safe. No RLS change
(0062's select-only convention stands). Pending on both DBs; the code degrades (4.4) until it is run. Everything else in
this design is JSONB inside `tenants.config`: no migration.

---

## 8. Open assumptions (stated plainly)
1. **Approved "Leave on approval" is unpaid** — yes: its category is unpaid, so the summary and the export count it under
   `unpaid_leave_days`, and the day's standard hours are 0 (`standardMinutesForDay`, a leave day). If BIM means "approved
   = paid", the type is set to category Paid and the Trainee row to *Paid* — the model carries both.
2. **A trainee's Sunday with no punch counts as absent**, with the shift's standard hours against them — yes, that is what
   "Sunday is a working day" means in this engine. A supervisor gives a Sunday off with a roster day-off row.
3. **Holidays for everyone still apply to trainees** (Republic Day, the generated 2nd Saturday) unless the holiday is
   typed to other types. If BIM wants trainees to train on public holidays too, the holidays are added for the other
   types only — no code needed.
4. **Alternate Saturdays stay workspace-wide** in slice 1 (trainees get the short Saturday and the 2nd-Saturday holiday
   like everyone); per type in slice 2.
5. **Pending requests of a now-not-offered type are kept**, shown red to the supervisor, approved as unpaid or rejected.
6. **A type can only narrow** a punch group (switch off), never widen it; narrowing the OT group hides the OT punch but
   leaves the Overtime tab for supervisors.

## 9. The SQL the owner runs for BIM — `scripts/run-bim-trainee-rules-2026-11-03.sql`
Updates only `tenants` where `slug = 'bim'`, only `config -> wfm -> type_rules -> trainee`, via nested `jsonb_set` on a
copy of the existing document (`wfm` and `type_rules` created if absent, every other key untouched); refuses if the
`trainee` code is not configured or no active unpaid-category leave type exists; previews before and after (type rules,
each leave type with the rule it gets, the count of active trainees); idempotent (recomputed from the live leave types, so
a second run writes the same value or includes a leave type added since); rollback snippet in comments removes the
`trainee` key only. Run **after** slice 1 is deployed; before that the key is ignored. Nothing to clear afterwards
(section 5, Cache).

## 10. Open questions for the owner (3)
1. **Type change and past months.** Recommendation: keep the engine live (a changed type recomputes any month viewed
   later, as shift, holiday and leave-type edits do today) and rely on the exported file as the payroll record. The
   alternative, a dated `employment_type` history, is a new table and a resolver by date; only worth it if payroll
   re-opens months in the app.
2. **Should a type ever widen a workspace rule** (e.g. OT off for everyone, on for Contractors)? Recommendation: no in
   release 1 and 2 — the supervisor tabs and the OT settings hang on the workspace flag; widening is a second flag model.
3. **Annual quota per type** (e.g. Interns 6 Paid leave a year, Full-time 12)? Recommendation: defer; not-offered / unpaid
   / paid-up-to-N covers BIM, and the per-employee quota override already exists for exceptions. If wanted, it is one key
   `leave[id].annual_quota` and a rung in `quotaFor` and `getLeaveBalance`.
