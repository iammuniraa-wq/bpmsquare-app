# Chapter 4. Workforce (WFM)

Snapshot 4 Nov 2026

> Screen names and button words may be refined as the product improves. If a name in this guide is slightly different on your screen, look for the same idea nearby. Items marked "(verify)" were read from the product code but not confirmed on a live screen.

## What this chapter covers

Workforce records who worked, when, where and for which job. It turns punches into hours, late marks, leave, overtime and a monthly summary that payroll can use. It is for three kinds of reader:

- **Employees** who punch in and out, ask for leave and fix mistakes.
- **Supervisors** who watch the day, approve requests and plan the roster.
- **Administrators and implementation consultants** who set up shifts, sites, leave types and rules.

Workforce is bought as two modules. The BPMSquare team switches them on for your workspace. Nobody in your company can switch them on or off.

| Module | What it gives you |
|---|---|
| Workforce (Attendance & Leave) | Everything in this chapter except Projects |
| Workforce, Project Costing | The Projects screen, hours per project, budget, billing, and the project choices on the Roster |

If you do not see a menu item, the module is not on for your workspace, or your role does not include it. Ask your administrator first, then us.

## Contents

1. [Who can do what](#who-can-do-what)
2. [My Workforce](#my-workforce)
3. [Door tablet (kiosk) and face punch](#door-tablet-kiosk-and-face-punch)
4. [Live board](#live-board)
5. [Workforce employees](#workforce-employees)
6. [Corrections](#corrections)
7. [Roster and shifts](#roster-and-shifts)
8. [Projects](#projects)
9. [Leave and holidays](#leave-and-holidays)
10. [Overtime](#overtime)
11. [Time summary and exports](#time-summary-and-exports)
12. [Rules by employment type](#rules-by-employment-type)
13. [Settings > Workforce at a glance](#settings--workforce-at-a-glance)
14. [Common questions](#common-questions)

---

## Who can do what

### Roles

| Role | Who it is | What they see |
|---|---|---|
| Employee | A person whose login is linked to an employee record, with the role "Employee" | **My Workforce** only |
| Supervisor | An employee with the role "Supervisor", a workspace administrator, or a login with an explicit edit grant on the Workforce area in Business Roles | Every Workforce screen, limited to their own people |
| Administrator | A workspace administrator | Everything, across all sites. Only an administrator can change shifts, sites, leave types, holidays, projects and kiosks |

Menu path for everyone: **Workforce** in the left menu. The group holds: **My Workforce**, **Live board**, **Workforce employees**, **Corrections**, **Roster**, **Projects**, **Leave & Holidays** and **Time Summary**. An employee sees only **My Workforce**. **Projects** appears only when the Project Costing module is on.

### Whose people a supervisor sees

A supervisor does not see the whole company. They see:

- Employees whose **Home site** is a site they supervise, or who are rostered onto that site for the dates in view.
- Every supervisor who reports to them (through the **Supervisor** field on the employee), and those supervisors' people, to any depth.
- Never themselves. A supervisor's own attendance belongs to their manager.

An administrator sees everyone.

A site has one **Supervisor** and can also have extra **Also approve here** people. Both can approve for that site. Set them in **Settings > Workforce > Places**.

### Who can approve what

- Approval is judged against the site the employee was **assigned to on the date of the request**, not the site they are on today. A later roster change does not move an old request to someone else.
- **Nobody approves their own request, not even an administrator.** The same applies to changing your own punch times.
- A request from an employee who has no site cannot be approved by a site supervisor. The error says to set their site first.
- A site with no supervisor and no extra approver shows the error "has no supervisor or approver assigned". Only an administrator can still approve.

### Switching on a supervisor

When an employee is saved with the role **Supervisor**, their linked login is promoted to workspace administrator. Demoting them later does not remove that. Plan for this when you choose who becomes a supervisor.

---

## My Workforce

### What it is

The employee's own page. It is where people punch in and out, see their day, ask for leave, file corrections and read announcements. It works in a phone browser and can be added to the home screen. Supervisors use the same page for their own attendance.

### Where to find it

- Menu: **Workforce > My Workforce**. URL path: `/wfm/me`.
- The link **My Details** (top right) opens `/wfm/me/details` with the tabs **Time**, **Requests**, **Profile**, **Timeline** and **Calendar**. **Back to punch** returns.
- After sign-in, the workspace can open this page straight away (**Settings > Workforce > Rules > More > After sign-in, open**). Otherwise people land on the Dashboard.

### Who uses it

Employees, supervisors and administrators who have a linked employee record. Switched on by the **Workforce (Attendance & Leave)** module. A login with no linked employee sees "No employee profile" and is told to ask a supervisor to add them.

### How to use it

**Give consent (first time only)**

1. Open **My Workforce**. The screen "Before you start" explains what is captured: a selfie, and your location converted to a street address.
2. Read it and tap **I agree**. Until you do, nothing can be punched.

**Punch in, take a break, punch out**

1. Open **My Workforce**. The tile shows four large buttons: **Check in**, **Check out**, **Break start**, **Break end**. All four are always on screen. Only the ones that are valid right now are lit.
2. Tap **Check in**. The phone asks for the camera (when a selfie is required) and for your location.
3. On the camera screen, tap **Capture & punch**.
4. A message confirms the time and the site, for example "Check in recorded at 09:02 at Main office".
5. Tap **Break start** when you go on break and **Break end** when you return. Tap **Check out** at the end of the shift.

**Use overtime, work from home or a site visit**

1. Open the **Other...** list under the four buttons. It appears only when something else is available.
2. Pick the punch (for example **OT in**) and tap **Go**. Nothing is pre-selected, on purpose, so a stray tap cannot record a punch.
3. Work from home and site visit need to be switched on in Settings. Work from home also needs an approved request for the day (see Overtime and the Requests tab).

**Ask for leave**

1. Open **My Details > Requests**.
2. Tap **+ Request leave**. Drag across the calendar or type the dates.
3. Choose the **Leave type**. The list shows the days left. For a single day you can choose **Half-day**.
4. Add a **Reason** and tap **Submit request**. The request shows as pending until a supervisor decides.

**Ask for a correction**

1. Open **My Details > Time** and tap **+ Request correction** (or click a day on **Timeline** and raise it from there).
2. Fill **Date**, **Correct time**, **Issue** and **Reason**, then tap **Submit**.
3. Nothing changes until a supervisor approves. See [Corrections](#corrections).

**Ask a supervisor a question about a punch**

1. Open **My Details > Requests > Clarifications** and tap **+ Ask a question**. You can tie the thread to a punch, a correction, an overtime session, or leave it general.
2. Either side replies in the thread. Either side can mark it resolved. A new message reopens a resolved thread.

### Statuses

Punch state, as shown on the tile:

| Shown | Meaning |
|---|---|
| Not checked in yet | No punch today |
| You're checked in | A session is open |
| On break | A break is open |
| On overtime | An overtime session is open |
| Checked out for today | The last session is closed |

Day status, as shown on **Time** and **Timeline**:

| Status | Meaning |
|---|---|
| Present | At least one punch that day |
| Late | First check-in after the shift start plus its grace minutes |
| Absent | No punch on a working day |
| Leave | Covered by a leave record |
| Holiday | A company holiday that applies to you |
| Week off | A weekly off day, or a rostered day off |
| Incomplete | A past day with a check-in and no check-out |

Request status (leave, correction, overtime/work from home): **pending**, **approved**, **rejected**.

### Rules that surprise people

- **Punching is a strict sequence.** You can only check in when out, take a break when in, and so on. A punch that does not fit is refused with a message such as "Cannot check in while in".
- **Overtime cannot sit inside a shift.** The overtime punch is only offered when you are checked out.
- **A punch cannot be earlier than your last punch.** It is refused.
- **Offline punches are kept on the phone and sent later.** The server accepts a punch time up to 7 days old and up to 5 minutes in the future. An older queued punch is declined and listed on the page as "could not be recorded", with a **Dismiss** button. Raise a correction for it.
- **A forgotten check-out does not block the next day.** On a new shift day the state resets, so you can check in. The earlier day stays **Incomplete**.
- **Incomplete days do not count.** The hours of an incomplete day are left out of the month's working-hours total until the day is corrected.
- **The punch is saved first and the selfie is sent after.** A missing photo cannot stop the punch from being recorded. Such a punch is marked so a supervisor can find it.
- **A denied camera ends the punch** when a selfie is required. Location problems show a help card with a retry.
- **Location is also required for breaks** when "Require location" or "Reject the punch" is on. Overtime, work from home and site visit punches are never blocked for location.
- **A weak location is flagged, not refused.** If the accuracy is worse than 200 metres the punch is saved with a "Location unreliable" flag.
- **The 2nd Saturday can be a holiday.** When the alternate-Saturday rule is on, starting a normal session on a 2nd Saturday is refused. Use **OT in** instead, which a supervisor must approve.
- **Where a supervisor turns phone punching off for you,** the tile shows the text "Punch in and out at the office kiosk" instead of buttons. Leave and corrections still work.
- The consent text is fixed and mentions a selfie "at every check-in, check-out and break" and the Indian DPDP Act, whatever your selfie setting is (verify wording with your legal adviser).
- The time you type in a correction is read in the phone's own timezone, not the workspace timezone (verify).

### Settings that change it

All in **Settings > Workforce** (administrator only).

| Setting | Tab | Effect on this screen |
|---|---|---|
| Extra punch types (Overtime, Work from home, Site visit) | Rules | Adds those choices to **Other...** |
| Selfie with a punch | Rules | Which punches show the camera: "Check in, check out, breaks, trips", every punch, or never |
| Keep selfies for (days) | Rules > More | Selfies older than this are deleted each night. Enrolment photos are kept |
| Employee self-service | Rules > More | **Off, tablet only** removes phone punching for everyone |
| After sign-in, open | Rules > More | Dashboard or My Workforce |
| Outside every site | Places | Keep and mark, reject, or no location check |
| Require location to check in and out | Places | Refuses the punch with no location |
| Alternate Saturdays | Rules > More | The 2nd Saturday becomes a holiday for punching |
| Punch-out reminder, Break reminder | Alerts | Phone notification after N hours worked or N minutes on break. Employees must tap **Turn on** on the page |
| Holiday digest | Alerts | A Monday message listing the week's holidays |

Per person: **Workforce employees > Edit > Punching** can override the workspace default (see [Workforce employees](#workforce-employees)).

Screenshot: wfm-my-workforce-punch.png | /wfm/me | The Punch tile with the four large buttons, the Other list and the Your day column

Screenshot: wfm-my-details-requests.png | /wfm/me/details?tab=requests | The Requests tab with Leave, Overtime / Work from home and Clarifications

---

## Door tablet (kiosk) and face punch

### What it is

A wall-mounted tablet at a site where people punch by showing their face. No login is needed on the tablet. It is the main punch method for a site-based workforce, and the only one when phone punching is off. A separate, optional check compares each phone selfie with the enrolled face.

### Where to find it

- Tablet page: `/kiosk` (no menu item; open it in the tablet's browser).
- Register a tablet: **Settings > Workforce > Places > Register a tablet** (`/settings/workforce?tab=places`).
- Enrol a face: **Workforce employees** (Face column) or **My Workforce** (the "Set up face punch" card).

### Who uses it

Employees punch on the tablet. Administrators register tablets. Supervisors or the employee enrol faces. It needs the **Workforce (Attendance & Leave)** module and **Face punch = Door tablet** in Settings. The face service must also be configured on the server, otherwise the tablet says "Face service is not configured yet".

### How to use it

**Register a tablet (administrator)**

1. Open **Settings > Workforce > Places**. Add the site first if it does not exist.
2. Under **Register a tablet**, type a **Tablet name** (for example "Main door") and choose the site, then tap **Get code**.
3. Copy the code with **Copy**. It is shown once.
4. On the tablet, open `/kiosk`, paste the code in "Set up this kiosk" and tap **Register kiosk**. This is done once.
5. If the code is lost, tap **New code** on the tablet's row. To stop a tablet, tap **Deactivate**.

**Enrol a face**

1. Set **Face punch** to **Door tablet** in **Settings > Workforce > Rules > More**.
2. An employee opens **My Workforce** and taps **Set up** on the "Set up face punch" card. Or a supervisor taps **Enroll** in the Face column of **Workforce employees**.
3. Consent is recorded as part of enrolling. Up to 3 photos are taken. If no usable face is found, retake in better light.
4. To remove a face, tap **Remove** next to the **Enrolled** label.

**Punch on the tablet**

1. Tap **Tap, then look at the camera**.
2. The tablet greets you ("Hi Asha") and shows only the buttons that are valid: **Punch in**, **Punch out**, **Start break**, **End break**.
3. Tap one within 12 seconds. A green confirmation appears. If it is not you, wait or ask your supervisor.
4. To change the tablet's site, use the small settings button and **Unregister this tablet**, then enter the correct code.

### Statuses

| Item | Values |
|---|---|
| Face enrolment | Enrolled, not enrolled |
| Tablet | Active, deactivated |
| Punch source on records | Kiosk (shown as a "Kiosk" label in the correction view) |

### Rules that surprise people

- **A face match is not a punch.** The person must still tap a button. The match only proves who is at the door.
- **The tablet offers only legal punches.** The sequence rules are the same as on a phone, and are re-checked when you tap.
- **A repeat tap of the same button within 20 seconds counts as the same punch.** It is not recorded twice.
- **Tablet punches take the tablet's site.** They are always marked as inside the fence. The selfie stored is the camera frame that was matched.
- **Tablets cannot punch overtime, work from home or site visit.** Those are phone-only.
- **No late-arrival email is sent for tablet punches.** The Live board and the summary still mark lateness, because they work it out when read.
- **Tablets do not apply the 2nd Saturday rule or the consent check on punch** (verify).
- **Removing or deactivating an employee removes their face data** (best effort).
- **Face sign-in and Passkey sign-in are separate options.** Face sign-in lets a person log in by face. It uses a stricter match than a punch and, without a liveness check, a photo of the person could fool it. Leave it off unless you accept that.
- **Check selfies against the face** (Rules > More) only flags a mismatch. It never blocks a punch.

### Settings that change it

| Setting | Tab | Effect |
|---|---|---|
| Face punch | Rules > More | Off or Door tablet. Off switches the whole kiosk and enrolment off |
| Face sign-in | Rules > More | Login by face |
| Check selfies against the face | Rules > More | Off, or flag a mismatch (shown as "Face mismatch" on the Live board) |
| Passkey sign-in | Rules > More | Phone fingerprint or Face ID login |
| Keep selfies for (days) | Rules > More | Selfie deletion |
| Register a tablet | Places | Codes, new codes, deactivation |

Screenshot: wfm-kiosk-choice.png | /kiosk | The tablet showing "Hi <name>" and the valid punch buttons

Screenshot: wfm-settings-register-tablet.png | /settings/workforce?tab=places | The Register a tablet row with a new code shown

---

## Live board

### What it is

A real-time picture of today: who is in, on break, out, late, absent or on leave, grouped by site. It refreshes by itself every 30 seconds.

### Where to find it

Menu: **Workforce > Live board**. URL path: `/wfm/live-board`.

### Who uses it

Supervisors and administrators. A site supervisor sees only their own people. Switched on by the **Workforce (Attendance & Leave)** module.

### How to use it

1. Open **Live board**. The donut **Right now** shows the headcount split by status. Click a slice to filter.
2. Use the tiles **Checked in**, **On break**, **Late**, **Absent**, **On leave** and **Geofence flags**. Each tile is also a filter.
3. Narrow with **Search name, code or shift...**, the **All sites** list or the **All statuses** list. The counter shows "N of M".
4. Click a row to see that person's punches with selfies and locations.
5. To question a punch, click **Flag for review** on it. Choose **What needs review?** (**Time and selfie**, **Time only**, **Selfie only**), write a **Message to employee**, and send. The employee sees it on their My Workforce page and can reply.
6. Use **On login, show me** (top right) to choose whether you land on the Live board or the Dashboard after sign-in.

### Statuses

| Status | Meaning |
|---|---|
| In | Checked in |
| On break | On a break |
| On leave | A leave record covers today (this wins over everything else) |
| Absent | Not in, and the shift's start plus grace has passed |
| Checked out | Has punched today and is now out (the row pill reads "Checked out") |
| Not in yet | No punch yet, and not yet past the grace time |

Flags on a row: **Outside geofence**, **Face mismatch**, **Location unreliable**. **Late** is a note beside the first-in time.

### Rules that surprise people

- **Late and absent use today's rostered shift,** and fall back to the employee's standing shift. Someone rostered on nights is not late against a day shift.
- **No lateness or absence is marked** on a holiday, a weekly off day, a rostered day off, or when the person is on leave. A banner says so.
- **No shift means no late or absent.** An employee with no shift is never marked either.
- **Rows are grouped by Home site,** not by the site of the punch.
- **Geofence flags** counts people who have any punch today marked outside the fence.
- The "Contractor" label on a row is shown for the employment-type code `contractor` only (verify for your own types).
- Obsolete employees still appear until their last day.

### Settings that change it

| Setting | Tab | Effect |
|---|---|---|
| Timezone | Rules | The day, the shift times and "today" |
| Weekly off days | Rules | No late or absent on those days |
| Grace (minutes) on the shift | Shifts | How late is late |
| Outside every site, Sites and radius | Places | What counts as outside the fence |
| Late arrival (Supervisor email) | Alerts | Emails the supervisor on a late check-in (phone check-ins only) |

Screenshot: wfm-live-board.png | /wfm/live-board | The donut, the six tiles and the site-grouped table

---

## Workforce employees

### What it is

The list of people for attendance, with their role, shift, home site, who they report to, whether they can punch from a phone, and whether they have a login and consent. Each person also has a page with their month at a glance.

### Where to find it

- Menu: **Workforce > Workforce employees**. URL path: `/wfm/employees`. The screen title reads **Workforce employees**.
- One person: click the name, or open `/wfm/employees/{id}`.
- HR details (name fields shared with the rest of the product) live in **Master data > Employees**. Bulk loading is done in **Data Workbench**.

### Who uses it

Supervisors and administrators, within their own people. Switched on by the **Workforce (Attendance & Leave)** module.

### How to use it

**Add an employee**

1. Tap **+ New employee**.
2. Fill **First name** (required), **Last name**, **Phone**, **Type**, **WFM role**, **Shift** and **Home site**. The **Code** (EMP-####) is assigned for you and cannot be edited later.
3. Tap **Create**.
4. If the type is not one your workspace has set up, the message names the types that are allowed and says where to add a new one (Settings > Workforce > Rules).

**Give them a login**

1. Tap **Edit** on the person.
2. Enter **Set up login (email)** and an **Initial password** of at least 8 characters, then **Save**. The person is asked to change the password at first sign-in.
3. If your workspace signs in by **User ID** (Rules > More > Sign in with), use **Create login** (or **Reset password**) on the row instead.

**Set where and how they work**

1. **Edit** the person.
2. Set **Shift**, **Home site**, **Supervisor** and **WFM role**.
3. Set **Punching** to **Workspace default**, **Kiosk only**, or **Phone punch + kiosk**. This beats the workspace setting for this one person.
4. Tap **Save**.

**Enrol or remove a face**

1. When Face punch is on, the **Face** column appears. Tap **Enroll** or **Remove**.

**Retire an employee**

1. Tap **Make obsolete**. To undo it, tap **Make active again**. The list switches to "All statuses" so you can still see the row.

**Correct a day's punches (supervisor)**

1. Open the person, go to the **Attendance** tab and tap **Correct** on the day.
2. In the **Correct time** window, tap **Change** on a punch, or **+ Add a missing punch**.
3. Enter the **Correct time** and **Why are you changing it?** (at least 5 characters). The employee sees the reason.
4. Tap **Save change**.

### Statuses

| Item | Values |
|---|---|
| Employee | Active, Obsolete |
| Login | Linked, No login |
| Consent | Given, or blank |
| Punching | Workspace default, Kiosk only, Phone + kiosk (Work from home and Site visit modes appear only for people who already had them) |
| WFM role | Employee, Supervisor |

The person page has tabs **Overview**, **Attendance**, **Corrections**, **Leave**, **Roster** and **Flagged**.

### Rules that surprise people

- **Obsolete is a date, not a delete.** The person is made inactive and the last day is stamped as today. Reports count them up to that date.
- **Making someone obsolete stops their punching** (only active employees can punch) **but does not by itself remove their login or supervisor access** (verify; the owner is addressing this separately).
- **Supervisor means administrator.** Saving someone as Supervisor promotes their login to workspace administrator.
- **Supervisor edits are bounded.** A supervisor can change a time only in this month and the previous month. Older dates are refused.
- **A direct change needs a reason, cannot move a punch by more than a day, cannot be in the future,** and cannot be done to yourself. Overtime punches cannot be changed here. You can add only Check in, Check out, Break start or Break end.
- **A direct change is logged as an already-approved correction** so the employee sees what changed and why.
- A supervisor's reach is limited to their own people (see [Who can do what](#who-can-do-what)). An administrator sees all.
- Employee types come from your own list (Settings > Workforce > Rules > Employment types). A type can also carry its own leave and weekly off rules (see [Rules by employment type](#rules-by-employment-type)); changing a person's type changes the rules that apply to them from then on.

### Settings that change it

| Setting | Tab | Effect |
|---|---|---|
| Employment types | Rules | The **Type** choices, the sheets in the payroll export and the rules a type can have |
| Sign in with | Rules > More | Email or User ID logins |
| Employee self-service | Rules > More | The default for **Punching** |
| Face punch | Rules > More | Shows the **Face** column |
| Shifts, Sites | Shifts, Places | The lists behind **Shift** and **Home site** |

Screenshot: wfm-employees-list.png | /wfm/employees | The employee table with filters, Punching, Login, Consent and Face columns

Screenshot: wfm-employee-correct-time.png | /wfm/employees/{id} | The Correct time window with Change and Add a missing punch

---

## Corrections

### What it is

The place where wrong or missing punches are fixed. Nothing is ever edited in place. An approval adds a new punch and retires the old one, so the history stays.

### Where to find it

Menu: **Workforce > Corrections**. URL path: `/wfm/corrections`. Tabs: **Corrections**, **Flagged for review**, and **Overtime** (only when overtime is switched on).

### Who uses it

Supervisors and administrators approve. Employees file requests from **My Details**. Switched on by the **Workforce (Attendance & Leave)** module.

### How to use it

**Approve or reject a correction**

1. Open **Corrections**. The list shows **Pending** requests first (use **All** to see decided ones). Search by employee, code or reason, or filter by issue type.
2. Read **Issue**, **Reason** and **Proposed time**.
3. Tap **Approve**, or tap **Reject**, type a **Reason (required)** and tap **Confirm**.

**Flag a punch you doubt**

1. On the **Live board**, open the person and tap **Flag for review**.
2. Follow up on the **Flagged for review** tab. Filter by **Awaiting employee**, **Employee replied**, or **All**.
3. When satisfied, tap **Resolve**. To close it without action, tap **Dismiss**.

**Fix it yourself instead**

1. Use **Workforce employees > person > Attendance > Correct**. See the previous section.

**As an employee, file a request**

1. **My Details > Time > + Request correction**. Choose **Issue**: **Missing check-in**, **Missing check-out**, **Missing break start**, **Missing break end**, **Wrong time** or **Other**.
2. Enter the **Correct time** and a **Reason**.

### Statuses

| Corrections | Meaning |
|---|---|
| pending | Waiting for a supervisor |
| approved | Applied to the timesheet |
| rejected | Not applied; the reason is shown to the employee |

| Flagged for review | Meaning |
|---|---|
| pending (Awaiting employee) | The employee has not replied |
| responded (Employee replied) | Waiting for the supervisor |
| resolved / dismissed | Closed |

### Rules that surprise people

- **Approving moves the hours everywhere.** The corrected punch replaces the old one in the timesheet, the summary, the Excel export and project hours. No second step is needed.
- **"Other" changes nothing.** It is only a note. Every other issue writes a punch on approval.
- **Two supervisors cannot both approve.** The first decision wins. The second sees "already resolved".
- **The proposed time must be near the date.** It must fall within a window from 12 hours before the day to 36 hours after its start, so a night shift still works.
- **Rejecting needs a reason.** The employee is told.
- **Employees can pick any past date** in the form. There is no age limit on an employee's request (only a supervisor's direct change has the two-month limit).
- **"Wrong time" cannot be filed from the phone form** as it stands: the form does not pick the punch, and the server then refuses with "Pick the punch you want corrected" (verify). Ask the employee to file "Missing check-in/out" with the right time, or have a supervisor use **Change**.
- **Rechecks are not scoped.** A supervisor can resolve or dismiss a flagged-for-review item without the site check applied to approvals (verify).
- **A flag is not a correction.** The employee's reply is words only. To fix a time they still file a real correction, which links back to the flag.

### Settings that change it

| Setting | Tab | Effect |
|---|---|---|
| Correction (Supervisor, Employee) | Alerts > Email | Emails the supervisor when a request is filed, and the employee when it is decided |
| Flagged punch (Employee) | Alerts > Email | Emails the employee when a punch is flagged |
| Clarification message | Alerts > Email | Emails the other side of a thread |
| Overtime (Extra punch types) | Rules | Shows the **Overtime** tab |

Email alerts need email sending set up in **Settings > Email output**.

Screenshot: wfm-corrections-queue.png | /wfm/corrections | The pending corrections table with Approve and Reject

Screenshot: wfm-flagged-for-review.png | /wfm/corrections?tab=recheck | The Flagged for review tab with its filters

---

## Roster and shifts

### What it is

The plan of who works which shift, at which site, and (with Project Costing) on which project. A person has a standing site and shift. The roster adds exceptions for specific dates.

### Where to find it

- Roster: menu **Workforce > Roster**. URL path: `/wfm/roster`. Tabs: **Standing site & shift**, **Shift changes & days off**, **Project assignments** (only with Project Costing), **Upload & generate**.
- Shifts: **Settings > Workforce > Shifts** (`/settings/workforce?tab=shifts`). Administrator only.

### Who uses it

Supervisors plan the roster. Administrators create shifts. Switched on by the **Workforce (Attendance & Leave)** module.

### How to use it

**Create a shift (administrator)**

1. Open **Settings > Workforce > Shifts** and tap **+ New shift**.
2. Enter **Name**, **Start**, **End** and **Grace (minutes)**.
3. Switch on **Night shift** if it pays the night allowance, and enter the allowance amount. A shift that ends after midnight is recognised from its start and end times, whatever this switch says.
4. Tap **Save**. Use **Active** to retire a shift. A shift still used by an employee or a roster day cannot be deleted. Deactivate it instead.

**Set standing shift and site for many people**

1. Roster > **Standing site & shift**. Filter by site or search.
2. Tick the cell for each person (or use **Assign all** on a column, which applies to everyone currently filtered).
3. Tap **Save changes**. All ticks across pages are saved together.

**Change a shift or give a day off for some dates**

1. Roster > **Shift changes & days off**.
2. Set **From**, **To**, and **Shift**, or tick **Mark as day off instead**.
3. Pick the employees and tap **Apply to N selected**.
4. Remove an entry from the **Upcoming** list with **Remove**.

**Put people on a project for some dates**

1. Roster > **Project assignments** (needs Project Costing).
2. Choose the **Project**, **From**, **To**, pick the people, tap **Assign N to ...**.

**Upload a roster from a spreadsheet**

1. Roster > **Upload & generate > Download template**.
2. Fill one row per employee: Employee Code, Date From, Date To (leave blank for a single day), Shift, Site, Day Off (yes/no), Note.
3. Choose the file (.xlsx, .xlsm or .csv). The result lists the rows applied and any skipped with the reason.

**Generate the alternate Saturdays**

1. Switch on **Alternate Saturdays** and choose the short-day shift in **Settings > Workforce > Rules > More**.
2. Roster > **Upload & generate > Alternate-Saturday roster**: pick the month and tap **Generate**.

### Statuses

| Item | Values |
|---|---|
| Shift | Active, inactive |
| Roster entry | A shift, a day off, a project, or a note for one date |

### Rules that surprise people

- **Roster beats standing.** For lateness, absence, night allowance and the "shift of the day", a roster row for that date wins over the person's standing shift. A day off wins outright: no late and no absent.
- **A roster row with only a project does not change the shift.** It falls back to the standing shift.
- **Limits per action:** up to 500 employees and 62 dates at once, and 3,000 employee-dates in total. A spreadsheet upload takes up to 2,000 rows, with up to 366 days per row and 5,000 dated rows in all.
- **The shift crossing midnight is detected from the times.** If the end is earlier than the start, the shift crosses midnight and all its punches belong to the day it started. The **Night shift** switch is separate: it controls the night allowance.
- **Night allowance is paid per night-shift day with at least one punch,** using the shift for that day.
- **Alternate Saturdays:** every Saturday uses the short shift except the 2nd, which is a company holiday. The generator never overwrites a row someone already set. It runs by itself on the 25th of each month for the next month (verify). The punch block on a 2nd Saturday works even if the generator has not run.
- **Holidays for everyone belong in Leave & Holidays,** not in the roster.
- A supervisor's roster tools are not limited to their own people (verify).

### Settings that change it

| Setting | Tab | Effect |
|---|---|---|
| Grace (minutes) | Shifts | How late is late, per shift |
| Night shift and allowance | Shifts | The night allowance in the summary |
| Alternate Saturdays and Short-day shift | Rules > More | The generator and the 2nd Saturday block |
| Weekly off days | Rules | Days where no lateness or absence is marked |

Screenshot: wfm-roster-standing.png | /wfm/roster | The Standing site & shift grid with Assign all buttons

Screenshot: wfm-settings-shifts.png | /settings/workforce?tab=shifts | The shifts table and the New shift panel

---

## Projects

### What it is

Hours worked, attributed to jobs. A project can have sub-projects (up to level 3), a budget in hours, an optional customer account, and a bill rate. From the hours you can raise a draft invoice.

### Where to find it

- Menu: **Workforce > Projects**. URL path: `/wfm/projects`. New: `/wfm/projects/new`. One project: `/wfm/projects/{id}`.
- Project page tabs: **Overview**, **Billing** (only if the Invoices module is on), **Details**, **Activity**.
- Billing rates: **Settings > Workforce > Billing** (`/settings/workforce?tab=billing`).

### Who uses it

Supervisors and administrators. Only an administrator can create, edit or delete a project, or raise an invoice. Switched on by the **Workforce, Project Costing** module (separate from Attendance & Leave).

### How to use it

**Create a project**

1. Tap **+ New Project**. Enter the **Project name**. That is all that is required. The ID (PRJ-####) is assigned for you.
2. Optionally set **Status**, **For account (optional)**, and under More: **Runs from**, **Until**, **Budget hours**, **Contract / PO number**, **Bill rate per hour**.
3. Open **Where its hours come from** and link people, shifts or sites (see the rules below).
4. Tap **Create project**. Use **Save & add sub-project** to add a level under it.

**See where hours are going**

1. Open **Projects**. The **Insights** section shows hours this month by project and the unassigned hours. Each row has an **Hours** figure.
2. Open a project. Choose **This month**, **Last 90 days** or **Last 12 months**. The page shows hours, people, and, if a budget is set, the percentage of budget used ("over" past 100%).

**Put people on a project for certain dates**

1. Use **Roster > Project assignments**. This is the strongest instruction and beats the links.

**Bill the hours**

1. Open the project, go to **Billing**. The project needs an **account** (set under **For account**).
2. Choose the period (**Last month**, **This month so far**, or dates) and the lines: **One line for the project** or **One per sub-project**. Tap **Preview**.
3. Read the hours, rate, amount and tax. Fix any red blocker.
4. Tap **Create draft invoice**. It lands as a draft in Invoices. If a correction added hours after an earlier invoice, tap **Bill the difference**.
5. The draft is reviewed and sent from the invoice itself.

### Statuses

| Status | Meaning |
|---|---|
| Planned | Not started; collects nothing yet |
| Active | Collecting hours now |
| On hold | Paused; collects nothing |
| Completed | Finished; stops collecting |
| Cancelled | Collects nothing |

### Rules that surprise people

- **A project is chosen by rule, not by the person punching.** The first match wins, in this order: (1) the roster row for that person and date, (2) the person is linked to the project, (3) their shift is linked, (4) their site is linked. If a step finds two projects, the hours are left **unassigned** rather than guessed.
- **Only Active projects inside their dates collect hours.**
- **The project is stamped on the punch when it happens** and never changes later. Editing a roster row tomorrow does not move yesterday's hours.
- **The site link only applies if the punch is inside the geofence.** With "No location check" or a punch outside every fence, the site step is skipped.
- **Unassigned hours are never billed.** The preview warns about them.
- **A rate of 0 means "not set", not free.** A preview with a zero-rate line is blocked.
- **Rate order:** the project's own rate, then the nearest parent's, then the rate for the employment type, then the workspace default.
- **No overlapping invoices.** A period that overlaps an earlier invoice for the project, a sub-project or its parent is refused, unless that invoice was cancelled. Deleting a draft frees its period.
- **Minutes are actual.** Hours on the invoice are minutes divided by 60, to two decimals. Overtime is not billed (overtime carries no project).
- **A day belongs to the day it started** in the workspace timezone, so a night shift's hours stay on one day.
- **Costs and margin** are shown to administrators on the preview only, and never on the invoice or the API.
- **Deleting a project** is refused while it has sub-projects. Punches keep their record but become unassigned.
- **Standalone projects cannot be billed.** Link an account first.
- The month-end automatic drafts run on the 1st when switched on. The code defines the schedule in two places (verify which one runs in your environment).

### Settings that change it

| Setting | Tab | Effect |
|---|---|---|
| Bill rate per hour | Billing | The default charge |
| Cost rate per hour | Billing | Internal cost for margin |
| Invoice due after (days) | Billing | Due date on the draft |
| Draft invoices at month end | Billing | On the 1st, a draft per active account-linked project with hours |
| Rate by employment type | Billing | Bill and cost per type |
| Deduct breaks | Rules | Project hours match the timesheet's net or gross hours |

The Billing tab only appears when Project Costing is on.

Screenshot: wfm-projects-list.png | /wfm/projects | The project tree with Hours and the Insights section

Screenshot: wfm-project-billing-preview.png | /wfm/projects/{id}?tab=billing | The Bill hours preview with the rate, tax and Create draft invoice button

---

## Leave and holidays

### What it is

Leave requests and records, and the company holiday calendar. Leave types and their quotas are set up in Settings. Approved leave stops lateness and absence being marked on those days.

### Where to find it

- Menu: **Workforce > Leave & Holidays**. URL path: `/wfm/leave`. Tabs: **Leave** and **Holidays** (`/wfm/leave?tab=holidays`).
- Leave types: **Settings > Workforce > Leave** (`/settings/workforce?tab=leave`).
- Employees ask from **My Workforce > My Details > Requests**.

### Who uses it

Employees request. Supervisors approve and enter records for their own people. Only an administrator adds or removes holidays and leave types. Switched on by the **Workforce (Attendance & Leave)** module.

### How to use it

**Set up leave types (administrator)**

1. **Settings > Workforce > Leave > + New leave type**.
2. Enter **Name** and **Category** (**Paid**, **Unpaid**, **Half-day**).
3. Enter **Days** and **Per** (**Month** or **Year**). Optionally set **Most days in a month** and **Paid days a month**.
4. Tap **Save**. Turn on **Unused leave carries forward** if you want that (see the rules below).

**Approve a request**

1. Open **Leave & Holidays > Leave**. Use **Pending** or **All**, or search.
2. Tap **Approve**, or tap **Reject**, give a **Reason (required)** and **Confirm**.

**Enter leave directly**

1. Under **Add a leave record directly** choose the **Employee**, **Leave type**, **From**, **To**, **Half-day** and **Remarks**.
2. Tap **Add leave**. To undo a record, tap **Delete** on it.

**Add holidays**

1. **Holidays** tab. Under **Add a holiday** enter **Date** and **Name**. For **Applies to** choose **Everyone**, or **These types** and tick the employment types the holiday is for. Then tap **Add holiday**.
2. The calendar shows who each holiday is for. A holiday for several types is kept as one row for each type, and each can be removed on its own.
3. For a whole year, tap **Download template**, fill it (Date, Name, Applies To) and upload it. In **Applies To** use All, or an employment type's name or code.

### Statuses

| Item | Values |
|---|---|
| Leave request | pending, approved, rejected |
| Leave type category | Paid, Unpaid, Half-day |
| Holiday applies to | Everyone, or one or more of your own employment types |

### Rules that surprise people

- **Approving creates a leave record.** The record carries the request's dates, half-day flag and reason.
- **A half-day counts as 0.5.** The Half-day choice is offered only for a one-day request.
- **Monthly caps are checked at request time.** Approved records and pending requests of the same type are counted. A per-month quota is also the cap. A request over the cap is refused with a message.
- **The remaining yearly balance is not checked.** Neither the request nor the direct entry refuses a request beyond the balance, so a balance can show a negative number (verify).
- **Balance counts every calendar day** from start to end, including weekends and holidays (verify).
- **Paid days a month:** the first N leave days each month are paid and later ones count as unpaid in the summary.
- **Authority is judged on the first date of the leave.**
- **Carry forward does nothing yet.** The setting is saved, but the balance is calculated per calendar year or month with no carried amount (verify).
- **A holiday can be for everyone or for chosen employment types.** The choices are the types in your own list. A holiday for one type does not touch the others.
- **Some leave can be switched off for a type.** If an employment type has a rule saying a leave type is not offered, that leave is missing from the person's request form and a new request or admin entry is refused with a message such as "Sick is not offered for Trainee. Use Leave on approval." (see [Rules by employment type](#rules-by-employment-type)).
- **When statuses overlap, the summary shows the first that applies:** Holiday, then Leave, then Week off, then Incomplete, Absent, Late, Present.
- Holidays are shown to employees on **My Details > Calendar**.

### Settings that change it

| Setting | Tab | Effect |
|---|---|---|
| Leave types, Days, Per, Most days in a month, Paid days a month | Leave | Quotas, caps and paid/unpaid split |
| Rules for an employment type | Rules > Employment types | Which leave a type is offered, and whether it is paid |
| Unused leave carries forward | Leave | Stored; no effect found (see above) |
| Weekly off days | Rules | Days with no lateness or absence |
| Leave (Supervisor, Employee) | Alerts > Email | Emails when a request is filed and when it is decided |
| Holiday digest | Alerts | Monday message with the week's holidays |

Screenshot: wfm-leave-queue.png | /wfm/leave | The leave requests table with Approve and Reject

Screenshot: wfm-holidays.png | /wfm/leave?tab=holidays | The holiday calendar and the Add a holiday form

---

## Overtime

### What it is

Extra hours worked outside the normal shift. The employee punches overtime in and out. A supervisor approves each session. Only approved overtime counts for pay. A related request, **Overtime (advance notice)**, lets an employee warn in advance. It never gates the punch.

### Where to find it

- Punch it: **My Workforce > Other... > OT in / OT out**.
- Ask in advance: **My Details > Requests > Overtime / Work from home > + OT / WFH**.
- Approve: **Workforce > Corrections > Overtime** tab (`/wfm/corrections?tab=ot`).
- Rate: **Settings > Workforce > Rules > Overtime rate per hour**.

### Who uses it

Employees punch. Supervisors and administrators approve. It needs **Extra punch types > Overtime** switched on in Settings. The Overtime tab is hidden otherwise.

### How to use it

**Punch overtime**

1. When you are checked out, open **Other...**, choose **OT in** and tap **Go**.
2. When finished, choose **OT out** and tap **Go**.
3. A session is created and shows as pending.

**Approve overtime**

1. Open **Corrections > Overtime**. Use **Pending** or **All**. Columns show **Employee**, **Date**, **From**, **To**, **Duration** and **Status**.
2. Tap **Approve**, or **Reject** with a reason and **Confirm**.

**Give advance notice, or ask for work from home**

1. **My Details > Requests > + OT / WFH**. Choose **Type** (**Work from home** or **Overtime (advance notice)**), **From**, **To** and **Reason**.

### Statuses

| Status | Meaning |
|---|---|
| Pending | Punched; waiting for a supervisor. Visible, but not in payable hours |
| Approved | Counts in payable hours and OT cost |
| Rejected | Does not count; the reason is shown |

An overtime session that is still open is not payable until the employee punches out.

### Rules that surprise people

- **Overtime is punch first, approve after.** It is the opposite of work from home.
- **Overtime cannot be nested.** It can only be started from "out".
- **An overnight session stays one block** and is counted on the day it started.
- **Pay uses actual minutes** at one flat hourly rate for the workspace. A rate of 0 means overtime is tracked but not costed.
- **Overtime on a 2nd Saturday** (when the rule is on) is the way to work that day, and still needs approval.
- **A supervisor cannot approve their own overtime.** It goes to their manager.
- **Work from home needs an approved request for the day** before it can be punched, unless the person has a standing permission. The system has a way to approve or reject these advance requests, but no screen with an approve or reject button for them was found when this guide was written (verify). Confirm how your supervisors decide them before you roll out work from home.
- **Overtime is not billed to projects.**

### Settings that change it

| Setting | Tab | Effect |
|---|---|---|
| Extra punch types: Overtime | Rules | Shows OT punches and the Overtime tab |
| Overtime rate per hour | Rules | Cost per approved hour |
| Extra punch types: Work from home | Rules | Allows that punch, subject to approval |
| Overtime or work-from-home request (Supervisor) | Alerts > Email | Emails the supervisor on a new request |

Screenshot: wfm-overtime-queue.png | /wfm/corrections?tab=ot | The overtime sessions table with pending total

---

## Time summary and exports

### What it is

The per-employee attendance record for a month or a date range, built for payroll. It shows days present, hours, late marks, leave, holidays, night allowance and overtime. It downloads as an Excel workbook.

### Where to find it

Menu: **Workforce > Time Summary**. URL path: `/wfm/summary`. Views: **Monthly summary**, **Daily — detailed**, **Custom range** (`/wfm/summary?tab=range`).

### Who uses it

Supervisors and administrators, within their own people. Switched on by the **Workforce (Attendance & Leave)** module.

### How to use it

**Read the month**

1. Open **Time Summary** on **Monthly summary**. Pick the month.
2. Filter by site, employment type, or "needs attention" (late marks, incomplete days, unpaid leave, clean).
3. Use **Daily — detailed** and click an employee to see every punch, break and overtime stretch. Pick a single date to focus.

**Look at any period**

1. Open **Custom range** and set the two dates. The range can be up to 93 days.

**Export to Excel**

1. Tap **Export to Excel**. The file is named `wfm-summary-<month>.xlsx` (or `<from>_to_<to>`).
2. The workbook contains these sheets, in order: **Summary** (one flat payroll list with a TOTAL row), **Payroll Report** (a block per employee with subtotals), one sheet per employment type in your list, an **Other** sheet if anyone has a type no longer in the list, and **Daily Detail**.

**Set the report options (administrator, once)**

Do this when your accountant wants the payroll report by location, or a minimum for overtime. Both are on the **Rules** tab of **Settings > Workforce**. Select **Save** at the top afterwards.

1. Switch on **Report by location**. The monthly Excel export then gets one sheet for each location and employment type, named `<Location> - <Type>` (for example `Workshop - Full-time`). A person with no home site goes to `No location - <Type>`. Off keeps the usual one-sheet-per-type layout.
2. With it on, every sheet gains **Sl No** (a serial number), **Category** (the employment type), **Standard Hrs** and **Actual Hrs**. Standard Hrs is the length of the person's shift on each day they were expected to work. Actual Hrs is hours worked less standard hours, and a minus sign marks time below standard, for example `-01:30`. A weekly off, a holiday and a full leave day add no standard hours.
3. Type **Minimum overtime per day (minutes)**. The field shows when **Overtime** is ticked under **Extra punch types**. Overtime on a day shorter than this many minutes is shown but not counted or paid. A day at or above it counts in full, not only the part over the minimum. 0 counts everything.
4. With a minimum set, the export adds an **OT not counted** column next to the overtime hours, and the day's status reads "OT below minimum, not counted".

### Statuses

Columns on the monthly table: Days present, Absent, Hours, Late marks, Half-day ded., Paid leave, Unpaid leave, Holidays, Night shifts, Night allowance, OT hrs, OT amt, Incomplete.

Day statuses are the same as in [My Workforce](#my-workforce).

### Rules that surprise people

- **Present** means any punch on the day, even a single one.
- **Late marks to half-days:** the number of half-day deductions is the late marks divided by "Late marks per half-day", rounded down. Only counted in the summary, with no money calculated.
- **Hours exclude incomplete days.** A day with an open session is left out of the month's hours until corrected.
- **Hours are net of breaks by default.** Turning off "Take breaks off worked hours" switches to gross. Every screen and the export follow the setting.
- **Overtime only counts when approved.** Pending overtime is shown separately, never added.
- **A night shift that closes after midnight** is counted whole on the day it started. A closing punch up to 18 hours after the opening one is included.
- **Overtime cost is hours times one flat rate,** to the exact minute.
- **Obsolete employees** are counted up to their last day.
- **The on-screen summary has fixed Full-Time and Contractors sections,** while the export has one sheet per your own employment types (verify for custom types).
- **Supervisors export only their own people.** The workbook never contains a site they do not supervise.
- **Month totals are shown as hours and minutes,** not decimal hours.
- **With a type that has no weekly off, its Sundays are working days.** A past Sunday with no punch is absent, and its shift length counts in Standard Hrs (see [Rules by employment type](#rules-by-employment-type)).
- **The report options change layout only.** With **Report by location** off and no overtime minimum, the sheets and columns are the same as before.

### Settings that change it

| Setting | Tab | Effect |
|---|---|---|
| Timezone | Rules | Which day an event belongs to |
| Take breaks off worked hours | Rules | Net or gross hours |
| Late marks per half-day | Rules | The half-day deduction count |
| Weekly off days | Rules | Excluded from late and absent |
| Employment types | Rules | Sheets in the export |
| Report by location | Rules | A sheet per location and type, with Sl No, Category, Standard Hrs and Actual Hrs |
| Minimum overtime per day (minutes) | Rules | Overtime on a shorter day is shown but not counted |
| Rules for an employment type | Rules > Employment types | Weekly off, and which leave is offered and paid |
| Overtime rate per hour | Rules | OT amount |
| Night shift and allowance | Shifts | Night allowance total |
| Keep selfies for (days) | Rules > More | Nothing here, but selfies behind older punches may be gone |

Screenshot: wfm-summary-monthly.png | /wfm/summary | The Monthly summary table with the day-mix donut and Export to Excel

Screenshot: wfm-summary-daily.png | /wfm/summary?tab=daily | One employee's daily detail with breaks and totals

---

## Rules by employment type

### What it is

A set of rules for one kind of employee, for example a trainee type with no paid leave. Every employment type follows the workspace until an administrator sets a row to **Custom**. Only the rows you set are stored. A new type needs no setup, and a workspace that never sets a rule works exactly as before.

A type can differ from the workspace in two ways: **which leave it is offered and how it is paid**, and **its weekly off days**. Holidays for a chosen type are added on the Holidays tab (see [Leave and holidays](#leave-and-holidays)).

### Where to find it

**Settings > Workforce > Rules**, field **Employment types** (`/settings/workforce`). Each type is one row with **People** (how many have it) and **Rules**. A type reads **Same as everyone** until you set a rule, and then for example **2 custom**. A **List** and **Compare** switch sits above the rows.

### Who uses it

Administrators only. Switched on by the **Workforce (Attendance & Leave)** module.

### How to use it

**Set the rules of a type**

1. Open **Settings > Workforce > Rules** and save any new type first. Select the type's row. A side panel opens with the title **Rules for** and the type's name, for example **Rules for Trainee**, the number of people, pending leave requests and custom rules.
2. On the **Leave** tab each active leave type has a list: **Same as everyone**, **Unpaid**, **Paid, up to N a month** and **Not offered**. **Not offered** hides the leave and refuses new requests. **Unpaid** records it but pays nothing. A leave type that is already unpaid shows **Unpaid, on approval** and has no choice.
3. On the **Days** tab, **Weekly off days** follows the workspace, or you choose **Custom** and tick the days. A custom list with no day ticked means every weekday is a working day for this type. The tab also says how many holidays are for this type alone, with a link to the Holidays tab.
4. **Copy rules from...** copies another type's rows into the panel. Nothing is saved until you apply. **Reset all to everyone** clears every custom row.
5. Select **Apply to N people**. The button stays grey until you change something. It opens **Review before applying**, which lists each change as before and after. Select **Apply** to save.

**Compare types**

1. Switch from **List** to **Compare**. Types are the columns and rules are the rows, with an **Everyone** column first.
2. A dot means the type follows the workspace. A filled cell is a custom rule. Select a cell to open that type's panel on the matching tab.

**See it from the other side**

1. On **My Workforce**, a person of the type sees a line such as "Weekly off: none" and "Not offered for Trainee: Paid leave, Sick". The leave request form lists only the leave they may ask for. Choosing an unpaid leave shows "This leave will be unpaid. It is recorded only once your supervisor approves it."
2. In the supervisor's leave table, a tag beside the leave type reads **Unpaid for Trainee**, **N paid a month** or **Not offered for Trainee**. A request filed before the rule changed stays in the list: approve it to record it as unpaid, or reject it and point to the unpaid leave type.

### Statuses

| Leave row for a type | Meaning |
|---|---|
| Same as everyone | The leave type's own rule applies |
| Unpaid | Offered, but every day counts as unpaid |
| Paid, up to N a month | The first N days a month are paid, later ones count as unpaid |
| Not offered | Hidden from the request form and refused |

### Rules that surprise people

- **Rules apply from a date, never to past days.** The date is the day you first apply rules to the type (or a date set for you by BPMSquare). Days before it keep the workspace rules and are never changed. Later edits keep the same start date. Approved leave stays approved, and exports you already sent to payroll do not change.
- **Apply is the save.** There is nothing to recompute. The summary is worked out when it is viewed or exported, so the next request, punch screen and summary use the new rules.
- **No weekly off means Sunday is a working day.** A past Sunday with no punch is absent, a late check-in is a late mark, and the shift length counts in Standard Hrs. A day off on the roster still wins for that person, and holidays still apply.
- **Leave on approval is just an unpaid leave type.** There is no special built-in. Add a leave type with the category **Unpaid** and people of a restricted type can still ask for it, and a supervisor approves it as usual.
- **"Comp off not available" means the comp-off leave type is Not offered** for that type. There is no automatic comp-off credit for anyone.
- **Changing a person's type changes the rules that apply to them,** from the type's start date onward.
- **A type can only differ on leave and weekly off days at this snapshot.** Punch types, overtime rate and late marks are still set for the whole workspace.
- **Removing a type removes its rules.**
- Every change is written to **Change history**.

### Settings that change it

| Setting | Tab | Effect |
|---|---|---|
| Employment types (name, code) | Rules | Which types exist. The code is fixed once saved |
| Weekly off days | Rules | The workspace default that a type follows |
| Leave types (category, paid days a month) | Leave | The workspace rule a type follows or overrides |
| Applies to (on a holiday) | Leave & Holidays > Holidays | Holidays for chosen types |

---

## Settings > Workforce at a glance

Where: **Settings > Workforce** (`/settings/workforce`). Administrator only, and only on a workspace with the Workforce module. Tabs: **Rules**, **Shifts**, **Places**, **Leave**, **Alerts**, **Billing** (Billing only with Project Costing). Rules, Leave, Alerts and Billing save together with the **Save** button. The lists (shifts, sites, leave types) save from their own panel.

| Setting | Tab | Changes |
|---|---|---|
| Timezone | Rules | The day boundary for lateness, absence and shift days |
| Late marks per half-day | Rules | The half-day deduction in the summary |
| Weekly off days | Rules | No lateness or absence on those days |
| Report by location | Rules | Monthly Excel: a sheet per location and type, with Sl No, Category, Standard Hrs, Actual Hrs |
| Minimum overtime per day (minutes) | Rules | Overtime on a shorter day is shown but not counted (shown when Overtime is on) |
| Take breaks off worked hours | Rules | Net or gross hours everywhere |
| Extra punch types | Rules | Overtime, Work from home, Site visit choices |
| Selfie with a punch | Rules | Which punches need the camera |
| Overtime rate per hour | Rules | OT cost (shown when Overtime is on) |
| Employee self-service | Rules > More | Phone punching for everyone, or tablet only |
| Sign in with | Rules > More | Email or User ID |
| After sign-in, open | Rules > More | Dashboard or My Workforce |
| Face punch, Face sign-in, Check selfies against the face | Rules > More | Kiosk, face login, mismatch flag |
| Keep selfies for (days) | Rules > More | Selfie deletion |
| Passkey sign-in | Rules > More | Phone biometric login |
| Alternate Saturdays, Short-day shift | Rules > More | 2nd Saturday holiday, short Saturdays |
| Employment types | Rules | Type list, export sheets, and the rules of each type (open a row) |
| Shifts (Name, Start, End, Grace, Night shift, allowance, Active) | Shifts | Lateness, night allowance |
| Outside every site | Places | Keep and mark, reject, or no check |
| Require location to check in and out | Places | Refuse punches with no location |
| Sites (Name, Location, Supervisor, Radius, Also approve here, Active) | Places | Geofence, who approves |
| Register a tablet | Places | Kiosk codes |
| Leave types and Unused leave carries forward | Leave | Quotas, caps, paid days |
| Punch-out reminder, Break reminder, Holiday digest | Alerts | Phone notifications |
| Tell by email when... | Alerts | Late arrival, correction, leave, overtime or work-from-home request, flagged punch, clarification |
| Bill rate, Cost rate, Invoice due after, Draft invoices at month end, Rate by employment type | Billing | Project billing |

---

## Common questions

**1. An employee forgot to check out yesterday. What happens, and how is it fixed?**
Yesterday shows as **Incomplete** and its hours are left out of the month's total. Today's check-in works normally, because the state resets on a new shift day. Either the employee files **Missing check-out** with the right time, or a supervisor opens the person, taps **Correct** on that day and adds the missing check-out with a reason.

**2. Why was someone marked late when they were on time?**
Lateness is judged against the shift for that date (a roster row beats the standing shift) plus its **Grace (minutes)**. Check the person's standing shift, the roster for that day, and the grace on the shift. If the person has no shift at all, they are never marked late. On a holiday, weekly off, day off or leave, lateness is not marked.

**3. A supervisor cannot approve a request. Why?**
The most common reasons: it is their own request (nobody approves their own), the employee has no site, the site has no supervisor or extra approver, or the employee did not work at a site they supervise on the date of the request. Set the site and the supervisor in **Settings > Workforce > Places** and on the employee.

**4. Can an employee punch from home?**
Only if three things line up: **Work from home** is switched on under **Extra punch types**; phone punching is allowed for that person (**Employee self-service** or their own **Punching** setting); and there is an approved work-from-home request covering the day (or a standing permission on the person). Without the third, the option is hidden and the server refuses with "Work from home isn't approved for today".

**5. Does turning on location block people?**
Two settings do. **Require location to check in and out** refuses a check-in, check-out or break punch when no location can be read. **Outside every site > Reject the punch** refuses a punch it can prove is outside every fence, and also requires a location. With **Keep the punch, mark it**, the punch is saved and flagged **Outside geofence** on the Live board. Overtime, work from home and site visit punches are never blocked for location.

**6. How far back can things be corrected?**
A supervisor's direct change is limited to this month and the previous month. An employee's request has no age limit, but a supervisor approving it is not held to the two-month window in the code I read (verify). The server also rejects any punch older than 7 days from a phone, which matters for offline punches.

**7. Why do the screen's Full-Time and Contractors sections not match my own employment types?**
The on-screen monthly summary groups people under fixed "Full-Time" and "Contractors" headings, while the Excel export makes one sheet per type in your list. If you use other types, rely on the export for the full picture (verify).

**8. What counts as overtime pay?**
Only approved sessions, at one flat hourly rate for the workspace, on exact minutes. Pending and rejected overtime is visible but never in payable hours. A rate of 0 means overtime is tracked but no amount is calculated.
