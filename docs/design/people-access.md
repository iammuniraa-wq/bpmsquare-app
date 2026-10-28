# People and access: one clean setup inside the workspace (C4C-shaped)

> Owner decision 2026-10-28: "I need a clean setup like C4C. We have it in BPMSquare but it is scattered. The tenant-provisioning e-mail is
> only once, for the client admin to get system access, not always. Everything else is in the client tenant. Access context can be done later."
> Model described by the owner (SAP C4C): employee first (e-mail is the key, also for SSO later); from the employee, "create business user",
> which copies the employee code, e-mail and validity dates; access rights = tick the Business Roles (a role is a set of workcenters); next
> tab access restrictions (read / write per object with access contexts: deferred); a Changes tab; lock, unlock and reset password at the top.

## What is already there (rule 6c)

- Employees master data (`employees`: EMP-#### code, e-mail, department, validity dates): Employees workcenter, `/employees/[id]`.
- A business user is a `tenant_users` row linked to an employee (`employee_id`, `display_name`, `is_locked`, `valid_from/valid_to`,
  `counted`, `must_change_password`, migrations 0057 and 0073). Created from Settings > People (`settings/people/InvitePanel.tsx`, which replaced
  Settings > Team, Administration > Business users and Business Roles) through `POST /api/business-users` (employee path, forces a password
  change at first sign-in, but makes a Member unless the employee is a Workforce supervisor) or `POST /api/settings/team` (e-mail + role +
  optional password, no forced change). The person panel (`PersonPanel.tsx`) already has role, lock, validity, reset password, Business Roles.
- Business Roles (`business_roles`, grants per workcenter view/edit, dashboard layout) assigned in `business_user_roles`. Owner decision
  2026-10-23: a menu-visibility feature, not a security boundary. Unchanged here.
- Platform admin: Admin > Tenants > invite (`/api/admin/tenants/[id]/invite`), with or without a password.
- Change history (`logChange`) on records; `administration/change-history`.
- The forced change screen `/force-password-change` (app layout redirects while `must_change_password`), `/reset-password` for links.

## Decisions

1. **Admin > Tenants invite is for the first admin of a new workspace only** (provisioning, once). Its wording says so. Everything else happens
   inside the workspace in Settings > People. `TENANT_PROVISIONING.md` states this.
2. **One Add flow** (Settings > People > Add, and the same panel opened from an employee record): e-mail, role **Admin or Member always shown**,
   an optional employee link (prefilled when opened from the employee: code, e-mail, validity), and an initial password. With a password the
   login is created, the screen shows the sign-in details to hand over, and **the first sign-in forces a new password, on every path**
   (`POST /api/settings/team` sets `must_change_password` like `POST /api/business-users` does; `POST /api/business-users` takes `role` from the
   body, the supervisor heuristic stays only as the default when no role is sent). Without a password an invite e-mail is sent and its link
   lands on the set-password screen (already in the held commit c97926c0).
3. **The employee record gets the C4C action at the top**: "Create business user" when no login is linked (opens the Add panel prefilled); when
   one is linked, a chip with the login state (active / locked / outside validity) linking to the person in Settings > People.
4. **Person panel laid out like C4C**: actions at the top (Lock / Unlock, Reset password, Remove); then sections (tabs via `useUrlTab` if it
   gets long): **Access rights** (workspace role Admin/Member, then the Business Roles tick list, each with its workcenters in one line),
   **Validity** (dates, counted), **Changes** (change-history entries for this login). Explanations behind InfoTips, no running text (6b).
5. **Every access change is logged** with `logChange` and the actor: login created / removed, role changed, Business Roles changed, locked /
   unlocked, password reset, validity changed; object type `tenant_users` (or the existing one if change history already names it) and the
   object in the change-history filter.
6. **Access restrictions with access contexts: deferred** (owner). When it comes, it is a design doc of its own and reverses decision 2026-10-23.
7. **SSO: later.** E-mail stays the login identifier so it can carry over.

## Definition of done

- Tests: route tests for both create paths (role honoured, must_change_password on every password path, existing account linked not forced),
  person-panel render tests, change-log tests; `tsc`, full vitest (only the 4 known sapFlow failures), `next build`.
- 375 px and PC: the Add panel is a bottom sheet on phones, the person panel's sections stack, tap targets 44 px.
- Live-client screens changed: Settings > People (admin-only) and the employee record header; note it in the commit (rule 6c.7).
- Docs: `TENANT_PROVISIONING.md` updated in the same work; the Admin & Setup Drive guide after the owner validates.
