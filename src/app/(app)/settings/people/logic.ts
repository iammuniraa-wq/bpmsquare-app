import { isMembershipActive } from "@/lib/constants";
import { WORKCENTERS } from "@/lib/workcenters";
import type { ChangeLogRow } from "@/app/(app)/administration/change-history/changeHistoryRows";

// The rules behind Settings > People, kept free of React so they can be tested. One person is one row: the
// workspace member (Settings > Team's list) joined with the login controls (Business Users' list) when the
// Business Roles module is on. Every write goes through the routes those two screens always used.

export type Member = {
  user_id: string;
  role: "admin" | "member";
  email: string | null;
  name: string | null;
  created_at: string;
  business_role_ids: string[];
};

export type Login = {
  user_id: string;
  employee_id: string | null;
  display_name: string | null;
  is_locked: boolean;
  valid_from: string | null;
  valid_to: string | null;
  counted: boolean;
};

export type RoleLite = { id: string; name: string };
/** A role as the person panel lists it: its name and, when known, the areas it opens. */
export type RoleView = RoleLite & { grants?: readonly Grant[] };
export type EmployeeLite = {
  id: string; first_name: string; last_name: string; email: string | null; employee_code?: string | null;
  valid_from?: string | null; valid_to?: string | null;
};

export type StatusKey = "active" | "locked" | "expired";

export type Person = {
  userId: string;
  name: string;
  email: string | null;
  role: "admin" | "member";
  roleIds: string[];
  login: Login | null;
  status: StatusKey;
};

export const STATUS_WORD: Record<StatusKey, string> = { active: "Active", locked: "Locked", expired: "Outside validity" };

export function nameOf(m: Member, login: Login | null): string {
  return login?.display_name?.trim() || m.name?.trim() || m.email?.split("@")[0] || m.user_id.slice(0, 8);
}

export function statusOf(login: Login | null): StatusKey {
  if (!login) return "active";
  if (login.is_locked) return "locked";
  return isMembershipActive(login) ? "active" : "expired";
}

export function mergePeople(members: readonly Member[], logins: readonly Login[]): Person[] {
  const byUser = new Map(logins.map((l) => [l.user_id, l]));
  return members.map((m) => {
    const login = byUser.get(m.user_id) ?? null;
    return { userId: m.user_id, name: nameOf(m, login), email: m.email, role: m.role, roleIds: m.business_role_ids, login, status: statusOf(login) };
  });
}

/** The chips on a row: the workspace role first, then the Business Roles a member holds. */
export function roleChips(p: Person, roles: readonly RoleLite[]): string[] {
  const head = p.role === "admin" ? "Admin" : "Member";
  if (p.role === "admin") return [head];
  const names = p.roleIds.map((id) => roles.find((r) => r.id === id)?.name).filter((n): n is string => !!n);
  return [head, ...names];
}

export function filterPeople(people: readonly Person[], roles: readonly RoleLite[], query: string): Person[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...people];
  return people.filter((p) => {
    const hay = `${p.name} ${p.email ?? ""} ${roleChips(p, roles).join(" ")} ${STATUS_WORD[p.status]}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** Employees that do not have a login yet: the ones a login can still be tied to. */
export function freeEmployees(employees: readonly EmployeeLite[], logins: readonly Login[]): EmployeeLite[] {
  const taken = new Set(logins.map((l) => l.employee_id).filter(Boolean));
  return employees.filter((e) => !taken.has(e.id));
}

export const employeeName = (e: EmployeeLite) => `${e.first_name} ${e.last_name}`.trim();
export const employeeLabel = (e: EmployeeLite) => (e.employee_code ? `${employeeName(e)} (${e.employee_code})` : employeeName(e));

// ── The person panel ────────────────────────────────────────────────────────

export type PersonDraft = {
  role: "admin" | "member";
  roleIds: string[];
  displayName: string;
  validFrom: string;
  validTo: string;
  counted: boolean;
  employeeId: string;
};

export function draftFromPerson(p: Person): PersonDraft {
  const l = p.login;
  return {
    role: p.role,
    roleIds: [...p.roleIds],
    displayName: l?.display_name ?? "",
    validFrom: l?.valid_from ?? "",
    validTo: l?.valid_to ?? "",
    counted: l?.counted ?? true,
    employeeId: "",
  };
}

export type Call = { url: string; method: "PATCH" | "PUT" | "POST" | "DELETE"; body: Record<string, unknown> };

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * The calls Save makes, in order, for what changed. Login fields go first (a bad password fails before anything else
 * is written), then the workspace role, then the Business Roles: only for a member, because an admin bypasses them.
 */
export function planPersonSave(p: Person, d: PersonDraft): Call[] {
  const calls: Call[] = [];
  const l = p.login;
  if (l) {
    const body: Record<string, unknown> = {};
    if (d.displayName.trim() !== (l.display_name ?? "")) body.display_name = d.displayName.trim();
    if (d.validFrom !== (l.valid_from ?? "")) body.valid_from = d.validFrom || null;
    if (d.validTo !== (l.valid_to ?? "")) body.valid_to = d.validTo || null;
    if (d.counted !== l.counted) body.counted = d.counted;
    if (d.employeeId && !l.employee_id) body.employee_id = d.employeeId;
    if (Object.keys(body).length > 0) calls.push({ url: `/api/business-users/${p.userId}`, method: "PATCH", body });
  }
  if (d.role !== p.role) calls.push({ url: `/api/settings/team/${p.userId}`, method: "PATCH", body: { role: d.role } });
  if (d.role === "member" && !sameSet(d.roleIds, p.roleIds)) {
    calls.push({ url: `/api/settings/team/${p.userId}/roles`, method: "PUT", body: { role_ids: d.roleIds } });
  }
  return calls;
}

export const personDirty = (p: Person, d: PersonDraft) => planPersonSave(p, d).length > 0;

/** Lock or unlock straight away: the one action that flips with the login's current state. */
export const planLockToggle = (p: Person): Call => ({ url: `/api/business-users/${p.userId}`, method: "PATCH", body: { is_locked: !p.login?.is_locked } });

export const planPasswordReset = (p: Person, password: string): Call => ({ url: `/api/business-users/${p.userId}`, method: "PATCH", body: { new_password: password } });

/** A new password is the only login field with its own rule on the client; the server repeats it. */
export function passwordProblem(pw: string): string | null {
  return pw && pw.length < 8 ? "Use at least 8 characters." : null;
}

// ── Invite ──────────────────────────────────────────────────────────────────

export type InviteDraft = { email: string; role: "admin" | "member"; password: string; employeeId: string };
export const emptyInvite = (): InviteDraft => ({ email: "", role: "member", password: "", employeeId: "" });

export type InvitePlan = { call: Call; viaEmployee: boolean; problem: null } | { call: null; viaEmployee: boolean; problem: string };

/**
 * One form, two routes. Without an employee it is the old Team invite (an email invite, or a login with the
 * password you typed). With an employee it is the Business Users create, which has no email invite, so a password
 * is required unless that email already has a login in this workspace (then it is linked, password untouched).
 */
export function planInvite(d: InviteDraft, existingEmails: readonly string[]): InvitePlan {
  const email = d.email.trim().toLowerCase();
  if (!email) return { call: null, viaEmployee: !!d.employeeId, problem: "Enter an email address." };
  const pwProblem = passwordProblem(d.password);
  if (pwProblem) return { call: null, viaEmployee: !!d.employeeId, problem: pwProblem };
  if (d.employeeId) {
    const exists = existingEmails.map((e) => e.toLowerCase()).includes(email);
    if (!exists && !d.password) return { call: null, viaEmployee: true, problem: "A password is needed for a new login." };
    return {
      viaEmployee: true, problem: null,
      call: { url: "/api/business-users", method: "POST", body: { employee_id: d.employeeId, email, password: d.password || undefined, role: d.role, counted: true } },
    };
  }
  return {
    viaEmployee: false, problem: null,
    call: { url: "/api/settings/team", method: "POST", body: { email, password: d.password || undefined, role: d.role } },
  };
}

export function inviteSuccessText(json: { passwordSet?: boolean; linkedExisting?: boolean }, viaEmployee: boolean): string {
  if (json.linkedExisting) return "Linked the existing login. Its password is unchanged.";
  if (json.passwordSet) return "Login created. Share the sign-in details below.";
  return viaEmployee ? "Login created." : "Invite sent.";
}

const dayWord = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** "1 Jan 2026 to 31 Dec 2026", "From 1 Jan 2026" or "Until 31 Dec 2026"; null with no dates. */
export function validityWord(from: string | null | undefined, to: string | null | undefined): string | null {
  if (from && to) return `${dayWord(from)} to ${dayWord(to)}`;
  if (from) return `From ${dayWord(from)}`;
  if (to) return `Until ${dayWord(to)}`;
  return null;
}

/** The line shown with the sign-in details of a login that was just given a password. */
export const FIRST_SIGNIN_LINE = "They will be asked to choose a new password at first sign-in.";

// ── Roles ───────────────────────────────────────────────────────────────────

export type Grant = { workcenter: string; can_view: boolean; can_create: boolean; can_edit: boolean; can_delete: boolean };
export type RoleFull = {
  id: string; name: string; description: string | null; grants: Grant[];
  template_key?: string | null; is_standard?: boolean;
  dashboard_layout?: import("@/lib/constants").DashLayoutItem[] | null;
};

export type GrantDraft = Record<string, { granted: boolean; can_create: boolean; can_edit: boolean; can_delete: boolean }>;

export function emptyGrantDraft(): GrantDraft {
  const d: GrantDraft = {};
  for (const w of WORKCENTERS) d[w.key] = { granted: false, can_create: false, can_edit: false, can_delete: false };
  return d;
}

export function grantDraftFrom(grants: readonly Grant[]): GrantDraft {
  const d = emptyGrantDraft();
  for (const g of grants) {
    if (d[g.workcenter]) d[g.workcenter] = { granted: g.can_view, can_create: g.can_create, can_edit: g.can_edit, can_delete: g.can_delete };
  }
  return d;
}

export function grantsFromDraft(d: GrantDraft): Grant[] {
  return WORKCENTERS.filter((w) => d[w.key]?.granted).map((w) => ({
    workcenter: w.key, can_view: true, can_create: d[w.key].can_create, can_edit: d[w.key].can_edit, can_delete: d[w.key].can_delete,
  }));
}

export function accessWord(grants: readonly Grant[]): string {
  const n = grants.filter((g) => g.can_view).length;
  return n === 0 ? "Nothing yet" : n === 1 ? "1 area" : `${n} areas`;
}

/** Roles you made first, then the ones shipped with the product. */
export function sortRoles(roles: readonly RoleFull[]): RoleFull[] {
  return [...roles].sort((a, b) => Number(!!a.is_standard) - Number(!!b.is_standard) || a.name.localeCompare(b.name));
}

export function peopleWithRole(people: readonly Person[], roleId: string): number {
  return people.filter((p) => p.role === "member" && p.roleIds.includes(roleId)).length;
}

export function roleProblem(name: string): string | null {
  return name.trim() ? null : "Give the role a name.";
}

// ── Old addresses ───────────────────────────────────────────────────────────

export const PEOPLE_PATH = "/settings/people";

/** Where People opens one person; the employee record links here. */
export const personHref = (userId: string) => `${PEOPLE_PATH}?person=${encodeURIComponent(userId)}`;

/** The workcenters a role opens, in one line: the first few by name, then how many more. */
export function roleSummary(grants: readonly Grant[] | undefined, show = 3): string {
  const names = WORKCENTERS.filter((w) => grants?.some((g) => g.workcenter === w.key && g.can_view)).map((w) => w.label);
  if (names.length === 0) return "No areas yet";
  return names.length <= show ? names.join(", ") : `${names.slice(0, show).join(", ")} +${names.length - show}`;
}

// ── The Changes section ─────────────────────────────────────────────────────

const asText = (v: unknown) => (v === null || v === undefined || v === "" ? "none" : String(v));

/** What happened, in the words a person would use, from one history row. */
export function accessEventTitle(r: Pick<ChangeLogRow, "action" | "changes">): string {
  if (r.action === "create") return "Login added";
  if (r.action === "delete") return "Removed from workspace";
  const fields = new Set(r.changes.map((c) => c.field));
  const out: string[] = [];
  if (fields.has("password")) out.push("Password reset");
  if (fields.has("role")) out.push("Role changed");
  if (fields.has("business roles")) out.push("Business roles changed");
  const lock = r.changes.find((c) => c.field === "locked");
  if (lock) out.push(lock.to ? "Locked" : "Unlocked");
  if (fields.has("valid from") || fields.has("valid to")) out.push("Validity changed");
  if (fields.has("counted user") || fields.has("display name") || fields.has("employee")) out.push("Details changed");
  return out.length ? out.join(", ") : "Changed";
}

/** The before and after of each field, one short line each; a password or lock event needs none. */
export function accessEventDetails(r: Pick<ChangeLogRow, "action" | "changes">): string[] {
  return r.changes
    .filter((c) => c.field !== "password" && c.field !== "locked")
    .map((c) => (r.action === "update" ? `${c.field}: ${asText(c.from)} → ${asText(c.to)}` : `${c.field}: ${asText(c.to ?? c.from)}`));
}

/** Where the retired Team / Business users / Business roles addresses send you, keeping any other query. */
export function peopleRedirect(tab: "roles" | undefined, search: Record<string, string | string[] | undefined> = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(search)) {
    if (k === "tab" || v == null) continue;
    for (const one of Array.isArray(v) ? v : [v]) q.append(k, one);
  }
  const wanted = tab ?? (typeof search.tab === "string" && search.tab === "roles" ? "roles" : undefined);
  if (wanted) q.set("tab", wanted);
  const qs = q.toString();
  return qs ? `${PEOPLE_PATH}?${qs}` : PEOPLE_PATH;
}
