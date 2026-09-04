# WFM Project Costing — Manual Test Cases (Release 1)

> Scope: **attribution only** — worked hours attributed to a project. There is
> deliberately **no cost, no rate, no billing and no invoicing** in this
> release; see §J before raising anything about money as a defect.
> Design: `WFM_PROJECT_COSTING.md`. Migration `0104` applied to both databases
> 2026-09-03; code promoted to main 2026-09-04.
>
> **The one rule that governs almost every case below:** a punch is stamped
> with its project **at the moment it is made**, and never recalculated.
> Changing configuration afterwards must never move hours that are already
> recorded.

**Test environment:** demo tenant first. `features.wfm_projects` is a
**platform-admin** flag (Admin → Tenants → Features → Core modules →
"Workforce — Project Costing"), off everywhere until switched on.

**Roles you need:** a platform admin (to set the flag), a tenant **admin**, a
**supervisor** login, and a plain **employee** login that can punch. A phone
or the kiosk for the punch cases — attribution only happens on a real punch.

**Test data used throughout** (matches the client deck, so QA and the client
describe the same thing):

| | |
|---|---|
| **Tower A** | one job — *Lift overhaul*, Active, budget 320h |
| **Metro Depot** | two jobs at once — *Annual service* and *Panel rewiring*, both Active |

---

## A. Module gating — nobody gets it who didn't buy it

| # | Steps | Expected |
|---|---|---|
| A1 | Flag **off**. Log in as tenant admin → Workforce group in sidebar | No **Projects** item. Live board, Employees, Corrections, Roster, Leave, Time Summary unchanged |
| A2 | Flag off. Open Workforce → **Roster** | No Project dropdown in the override form, no Project column in the upcoming-overrides table |
| A3 | Flag off. Browse directly to `/wfm/projects` | Redirected / not found — **not** an empty screen |
| A4 | Flag off. `GET /api/wfm/projects` | **404**, not 403 — a tenant without the module shouldn't learn the endpoint exists |
| A5 | Platform admin → tick "Workforce — Project Costing" → save → reload | **Projects** appears under Workforce; Roster gains a Project dropdown and column |
| A6 | Turn the flag back **off** after creating data | Everything disappears again. Turn it on once more — the projects and their hours are still there (hiding ≠ deleting) |
| A7 | Log in as a plain **employee** with the flag on. Check My Workforce, the punch screen and the kiosk | No project list, no job picker, nothing mentioning projects anywhere |

## B. Creating and editing a project (tenant admin)

| # | Steps | Expected |
|---|---|---|
| B1 | Projects → **+ Add Project** → name only → Create | Saved. ID assigned automatically as **PRJ-0001** — the field is never typed |
| B2 | Create a second project | **PRJ-0002**. Numbers are sequential per tenant |
| B3 | Submit with an empty name | Blocked: "Give the project a name." Nothing saved |
| B4 | Set Start 2026-09-30, End 2026-09-01 → Save | Rejected: "end_date can't be before start_date" |
| B5 | Set only an End date (no Start) | Allowed — both dates are optional and independent |
| B6 | Set Budget hours = 320 | Saved. Enter a negative number → rejected |
| B7 | Status dropdown | Exactly five: Planned, Active, On hold, Completed, Cancelled. Default **Active** |
| B8 | Edit a project's name → Save → reopen | Change persisted; ID unchanged |
| B9 | Change only the Status (touch nothing else) → Save | Sites stay linked. **A status change must never silently unlink sites** |
| B10 | Try to set a project as its own parent (via API `parent_id` = its own id) | Rejected: "A project can't be its own parent" |

## C. Linking sites to a project

| # | Steps | Expected |
|---|---|---|
| C1 | Edit *Lift overhaul* → tick **Tower A** → Save → reopen | Tower A shown ticked |
| C2 | Tick a second site → Save | Both ticked. A project may run at several sites |
| C3 | Untick all sites → Save | Saved with none. The project simply collects nothing automatically |
| C4 | Link **Metro Depot** to both *Annual service* and *Panel rewiring* | Allowed. One site may host several jobs — this is the case §D2 covers |
| C5 | Delete a site that a project is linked to (Settings → Workforce → Sites) | The project survives; it just loses that link |

## D. Attribution — the core of the release

> Every case here needs a **fresh punch**. Punches made before the module was
> switched on are not back-filled, by design (see D9).

| # | Steps | Expected |
|---|---|---|
| D1 | *Lift overhaul* is the only Active project at Tower A. Employee punches **in** at Tower A | Punch succeeds normally. Projects screen shows the hours under *Lift overhaul* |
| D2 | Both depot jobs Active at Metro Depot. Employee punches in at Metro Depot, with **no roster entry** | Hours appear under **Unassigned** — never guessed at one of the two |
| D3 | Roster → put that employee on *Panel rewiring* for today → they punch in at Metro Depot | Hours land on *Panel rewiring* |
| D4 | Roster someone at **Tower A** onto *Panel rewiring* (contradicting the unambiguous site default) → they punch at Tower A | Roster **wins**: hours go to *Panel rewiring*. The supervisor's instruction outranks the site |
| D5 | Set *Lift overhaul* to **Completed**, then punch at Tower A | **Unassigned.** Repeat for On hold, Planned and Cancelled — only **Active** projects collect automatically |
| D6 | Roster an employee with **Mark as day off** ticked, then have them punch anyway | The punch carries **no project**. A day off has no work to attribute |
| D7 | Punch from outside every geofence (so no site is matched) | Punch still succeeds (geofence never blocks). Project is **Unassigned** — no site means no site default |
| D8 | **Stamping.** Note a punch's project. Now change the roster for that same day, or relink the site, or rename the project | The already-recorded punch keeps its original project. Hours **do not move** |
| D9 | Look at hours from before the flag was switched on | Not attributed, and not back-filled. Expected — attribution happens at punch time only |
| D10 | Repeat D1 and D3 using the **kiosk** (face punch) instead of the phone | Identical attribution. The kiosk is the main punch surface and must stamp the same way |
| D11 | Punch **out**, take a break, punch **in** again on the same day | Each session is attributed independently; a day's hours are the sum of its sessions |

## E. Hours and reporting

| # | Steps | Expected |
|---|---|---|
| E1 | Projects screen after some punches | Donut + list: hours per project, this month |
| E2 | Read every duration on the screen | Always **h:mm** (e.g. `9h 15m`). Never a decimal such as 12.98 |
| E3 | A project with unattributed hours in the period | **Unassigned** shown with the same weight as the projects, in amber, with the note explaining how to fix it |
| E4 | Each row | Shows headcount ("3 people") and session count — 200h from one person and from ten mean different things |
| E5 | Open a project with **Budget hours** set | Budget-vs-actual percentage shown; goes red once past 100% |
| E6 | Open a project with **no** budget | No percentage shown — never "0% of 0" |
| E7 | Switch This month / Last 90 days / Last 12 months on a project | Figures change; the same punches counted once in each window |
| E8 | **Reconciliation.** Total a person's project hours for a period vs their Time Summary hours for the same period | They must **agree exactly**, including the tenant's break-deduction setting |
| E9 | Log in as a **site supervisor**, open Projects | Only their own employees' hours. A supervisor at another site must not see hours for people they don't supervise |

## F. Deleting a project

| # | Steps | Expected |
|---|---|---|
| F1 | Delete a project that has hours recorded against it | Deletion succeeds; the response reports how many punches were affected |
| F2 | Check the attendance for those employees afterwards | **Punches still exist.** Their times, selfies and locations are intact — attendance evidence must survive a costing decision |
| F3 | Projects screen after F1 | Those hours now appear under **Unassigned**, not vanished |

## G. Permissions

| # | Steps | Expected |
|---|---|---|
| G1 | **Supervisor** login → Projects screen | Can view projects and hours |
| G2 | Supervisor → try to create a project (UI, then `POST /api/wfm/projects` directly) | **403 Forbidden.** Creation is tenant-admin only |
| G3 | Supervisor → `PATCH` / `DELETE` a project directly | 403 on both |
| G4 | Supervisor → Roster → assign someone to a project | **Allowed** — rostering is part of the supervisor's job |
| G5 | Plain employee → `GET /api/wfm/projects` | 403 (not a supervisor) |
| G6 | Revoke the **Workforce** workcenter from a business role, assign it to a supervisor | Projects unreachable — it sits behind the same workcenter grant as the rest of WFM |

## H. Tenant isolation (do not skip — this is the highest-risk area)

| # | Steps | Expected |
|---|---|---|
| H1 | As tenant A, `GET /api/wfm/projects/<a project id belonging to tenant B>` | **404 Not found.** Never tenant B's data |
| H2 | As tenant A, `PATCH` / `DELETE` tenant B's project id | 404 — no rows matched, nothing changed in tenant B |
| H3 | As tenant A, create a project with `site_ids` containing a **tenant B** site id | Rejected: "One or more sites weren't found in this tenant" |
| H4 | Same for `account_id` and `parent_id` from tenant B | Rejected as unknown |
| H5 | As tenant A, roster an employee with a **tenant B** `project_id` | Rejected: "Unknown project" |
| H6 | After every case above, log into tenant B | Nothing created, changed or deleted there |

## I. Audit trail

| # | Steps | Expected |
|---|---|---|
| I1 | Create, edit and delete a project. Administration → **Change history** → object filter | **Workforce: Projects** is in the dropdown; all three actions listed with who and when |
| I2 | Edit a project and check the history entry | Field-level before/after values recorded |
| I3 | Open a project's detail page (Nova theme on) | Timeline/comments panel present; an @mention on a project reaches the inbox and the link opens the project |

## J. Deliberately NOT in this release — do not raise as defects

| Area | Status |
|---|---|
| Cost per project, cost rates, employee rates | **Level 2**, not built |
| Billing, rate cards, margin, utilisation, invoicing | **Level 3**, not built |
| Client sign-off on timesheets | **Level 4**, not built |
| Switching project mid-shift from the punch screen | Not built. The data model supports it (each session carries its own project) but there is no UI |
| Project in Data Workbench (import/export/update) | Not wired |
| Project in the v1 REST API, MCP, global search, ⌘K palette | Not wired |
| Project tiles in Analytics / Dashboard / Reports | Not wired |
| Project phases or sub-projects | Column exists; one level ships |
| **Lateness** when a day's first check-in is late | Unchanged behaviour, out of scope of this feature |

---

## Reporting a defect

Include: tenant, role you were logged in as, the **exact punch time** and site,
the project's status and its linked sites at that moment, and whether a roster
entry existed for that employee on that date. Attribution depends on all of
them, and a screenshot of the result alone can't be diagnosed.

File under Jira **KAN** (WFM-BIM). If hours look wrong, attach the same
period's Time Summary too — E8 is the check that separates an attribution bug
from an hours bug.
