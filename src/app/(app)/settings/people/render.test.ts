import { describe, expect, it, vi } from "vitest";
import { createElement as create, type ReactElement } from "react";
import { renderToString } from "react-dom/server";

const flags = vi.hoisted(() => ({ changeHistory: false, tab: "" }));
vi.mock("@/lib/tenant-context", async (orig) => ({
  ...(await orig<typeof import("@/lib/tenant-context")>()),
  useTenantFeature: (key: string) => key === "change_history" && flags.changeHistory,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(flags.tab ? { ptab: flags.tab } : {}),
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/settings/people",
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
}));

import { PeopleRows, RoleRows } from "./Rows";
import PersonPanel from "./PersonPanel";
import InvitePanel from "./InvitePanel";
import RolePanel from "./RolePanel";
import PeopleClient from "./PeopleClient";
import { ChangeRows } from "./ChangesSection";
import CredentialsNotice from "./CredentialsNotice";
import { mergePeople, type Login, type Member, type RoleFull } from "./logic";
import TeamRedirect from "../team/page";
import BusinessUsersRedirect from "../../administration/business-users/page";
import BusinessRolesRedirect from "../../administration/business-roles/page";

const el = create as unknown as (c: unknown, p: object | null, ...kids: unknown[]) => ReactElement;
const html = (e: ReactElement) => renderToString(e);
const noop = () => undefined;

const member = (o: Partial<Member> = {}): Member => ({ user_id: "u1", role: "member", email: "asha@acme.com", name: "Asha Rao", created_at: "2026-01-01", business_role_ids: ["r1"], ...o });
const login = (o: Partial<Login> = {}): Login => ({ user_id: "u1", employee_id: null, display_name: null, is_locked: false, valid_from: null, valid_to: null, counted: true, ...o });
const roles = [{ id: "r1", name: "Sales rep" }, { id: "r2", name: "Technician" }];
const people = mergePeople(
  [member(), member({ user_id: "u2", role: "admin", name: "Ben", email: "ben@acme.com", business_role_ids: [] })],
  [login(), login({ user_id: "u2", is_locked: true })],
);
const roleFull = (o: Partial<RoleFull> = {}): RoleFull => ({
  id: "r1", name: "Sales rep", description: "Quotes and accounts", is_standard: false,
  grants: [{ workcenter: "accounts", can_view: true, can_create: true, can_edit: false, can_delete: false }], ...o,
});

describe("the people table", () => {
  const out = html(el(PeopleRows, { items: people, roles, onOpen: noop }));
  it("is one row per person with name, email, role chips and status", () => {
    expect((out.match(/role="listitem"/g) ?? []).length).toBe(2);
    expect(out).toContain("Asha Rao");
    expect(out).toContain("asha@acme.com");
    expect(out).toContain("Sales rep");
    expect(out).toContain("Admin");
    expect(out).toContain("Active");
    expect(out).toContain("Locked");
  });
  it("opens the panel from a labelled button, and carries no per-row action buttons", () => {
    expect(out).toContain('aria-label="Asha Rao: open"');
    expect((out.match(/<button/g) ?? []).length).toBe(2);
  });
});

describe("the Employee column", () => {
  const emps = [{ id: "e1", first_name: "Asha", last_name: "Rao", email: null }];
  const linked = mergePeople([member(), member({ user_id: "u2", name: "Ben", email: "ben@acme.com", business_role_ids: [] })], [login({ employee_id: "e1" }), login({ user_id: "u2" })]);
  it("names the linked employee, a dash when there is none, and is left out without the employee list", () => {
    const withCol = html(el(PeopleRows, { items: linked, roles, employees: emps, onOpen: noop }));
    expect(withCol).toContain("Employee</span>");
    expect(withCol).toMatch(/employeeCell[^>]*>Asha Rao</);
    expect(withCol).toMatch(/employeeCell[^>]*>—</);
    expect(html(el(PeopleRows, { items: linked, roles, onOpen: noop }))).not.toContain("Employee</span>");
  });
});

describe("your own row in the person panel", () => {
  it("does not offer Member to the signed-in admin, because the server refuses a self-demotion", () => {
    const self = mergePeople([member({ user_id: "u9", role: "admin", is_self: true, business_role_ids: [] })], [login({ user_id: "u9" })]);
    const props = { roles: [], businessRoles: false, employees: [], onClose: noop, onSaved: noop, onRemove: noop };
    expect(html(el(PersonPanel, { ...props, person: self[0] }))).toMatch(/<button[^>]*disabled[^>]*>Member</);
    const other = mergePeople([member({ role: "admin", business_role_ids: [] })], [login()]);
    expect(html(el(PersonPanel, { ...props, person: other[0] }))).not.toMatch(/<button[^>]*disabled[^>]*>Member</);
  });
});

describe("the roles table", () => {
  const out = html(el(RoleRows, { items: [roleFull(), roleFull({ id: "r9", name: "Admin: Sales", is_standard: true, description: null })], people, onOpen: noop }));
  it("shows access, the people count and a Standard chip", () => {
    expect(out).toContain("1 area");
    expect(out).toContain("Standard");
    expect(out).toContain("Quotes and accounts");
    expect(out).toContain('aria-label="Sales rep: open"');
  });
});

describe("the person panel", () => {
  const rich = [
    { id: "r1", name: "Sales rep", grants: [{ workcenter: "accounts", can_view: true, can_create: true, can_edit: false, can_delete: false }, { workcenter: "contacts", can_view: true, can_create: false, can_edit: false, can_delete: false }] },
    { id: "r2", name: "Technician", grants: [] },
  ];
  const props = { roles: rich, businessRoles: true, employees: [], onClose: noop, onSaved: noop, onRemove: noop };
  it("puts the actions first: Lock, Reset password and Remove", () => {
    flags.changeHistory = false; flags.tab = "";
    const out = html(el(PersonPanel, { ...props, person: people[0] }));
    expect(out).toContain(">Lock<");
    expect(out).toContain(">Reset password<");
    expect(out).toContain(">Remove<");
    expect(out.indexOf(">Lock<")).toBeLessThan(out.indexOf("Business roles"));
    expect(out.indexOf(">Remove<")).toBeLessThan(out.indexOf("Business roles"));
  });
  it("offers Unlock for a locked login, and says so", () => {
    const out = html(el(PersonPanel, { ...props, person: people[1] }));
    expect(out).toContain(">Unlock<");
    expect(out).toContain("Locked");
  });
  it("has Access rights, Validity and Changes sections", () => {
    flags.changeHistory = true; flags.tab = "";
    const out = html(el(PersonPanel, { ...props, person: people[0] }));
    expect(out).toContain("Access rights");
    expect(out).toContain("Validity");
    expect(out).toContain("Changes");
    flags.changeHistory = false;
  });
  it("Access rights: the workspace role first, then each Business Role as a tick with its areas in one line", () => {
    const out = html(el(PersonPanel, { ...props, person: people[0] }));
    expect(out.indexOf(">Member<")).toBeLessThan(out.indexOf("Business roles"));
    expect(out).toContain('aria-label="Business roles"');
    expect(out).toMatch(/<input type="checkbox"[^>]*checked=""[^>]*\/>\s*<span>Sales rep</);
    expect(out).toContain("Accounts, Contacts");
    expect(out).toContain("No areas yet");
    expect(out).toContain("Technician");
  });
  it("Validity: dates, the counted seat and the rarely needed details behind More", () => {
    flags.tab = "validity";
    const out = html(el(PersonPanel, { ...props, person: people[0] }));
    flags.tab = "";
    expect(out).toContain("Valid from");
    expect(out).toContain("Valid to");
    expect(out).toContain("Counted user");
    expect(out).toContain("<summary>More</summary>");
    expect(out).toContain("Display name");
    expect(out).not.toContain('aria-label="Business roles"');
  });
  it("Changes: loads this login's history instead of the form, with no Save", () => {
    flags.changeHistory = true; flags.tab = "changes";
    const out = html(el(PersonPanel, { ...props, person: people[0] }));
    flags.changeHistory = false; flags.tab = "";
    expect(out).toContain("Loading");
    expect(out).not.toContain(">Save<");
    expect(out).not.toContain("Valid from");
  });
  it("keeps Save off until something changes", () => {
    expect(html(el(PersonPanel, { ...props, person: people[0] }))).toMatch(/<button[^>]*disabled[^>]*>Save</);
  });
  it("hides business roles for an admin, who bypasses them", () => {
    const out = html(el(PersonPanel, { ...props, person: people[1] }));
    expect(out).not.toContain("aria-label=\"Business roles\"");
    expect(out).not.toContain("Technician");
  });
  it("is just Role and Remove when the Business Roles module is off: no login, so no Lock, Reset or sections", () => {
    const bare = mergePeople([member()], [])[0];
    const out = html(el(PersonPanel, { ...props, businessRoles: false, person: bare }));
    expect(out).not.toContain("Business roles");
    expect(out).not.toContain(">Lock<");
    expect(out).not.toContain("Reset password");
    expect(out).not.toContain('role="tablist"');
    expect(out).not.toContain("<summary>");
    expect(out).toContain(">Remove<");
  });
  it("offers the unlinked employees to tie a login to (under More on Validity)", () => {
    flags.tab = "validity";
    const out = html(el(PersonPanel, { ...props, person: people[0], employees: [{ id: "e1", first_name: "Asha", last_name: "Rao", email: null, employee_code: "EMP-0001" }] }));
    flags.tab = "";
    expect(out).toContain("Asha Rao (EMP-0001)");
  });
});

describe("the changes list", () => {
  const rows = Array.from({ length: 7 }, (_, i) => ({
    id: `c${i}`, object_type: "tenant_users", object_id: "u1", object_label: "asha@acme.com", action: "update" as const,
    changes: [{ field: "locked", from: false, to: true }], actor_id: "a1", actor_email: "boss@acme.com", actor_name: "Boss Person",
    created_at: `2026-10-0${i + 1}T10:00:00Z`,
  }));
  it("shows a few rows, who made each change, and Show all for the rest", () => {
    const out = html(el(ChangeRows, { rows, all: false, onShowAll: noop }));
    expect((out.match(/<li/g) ?? []).length).toBe(5);
    expect(out).toContain("Locked");
    expect(out).toContain("Boss Person");
    expect(out).toContain("Show all (7)");
    expect((html(el(ChangeRows, { rows, all: true, onShowAll: noop })).match(/<li/g) ?? []).length).toBe(7);
  });
  it("has an empty state", () => {
    expect(html(el(ChangeRows, { rows: [], all: false, onShowAll: noop }))).toContain("No changes recorded yet.");
  });
});

describe("the sign-in details notice", () => {
  it("shows the details and says the person will choose a new password at first sign-in", () => {
    const out = html(el(CredentialsNotice, { text: "Login created.", credentials: { email: "a@b.co", password: "fixture-pass-1" }, onDismiss: noop }));
    expect(out).toContain("a@b.co");
    expect(out).toContain("fixture-pass-1");
    expect(out).toContain("Copy details");
    expect(out).toContain("They will be asked to choose a new password at first sign-in.");
  });
  it("has no such line when no password was set", () => {
    expect(html(el(CredentialsNotice, { text: "Invite sent.", credentials: null, onDismiss: noop }))).not.toContain("first sign-in");
  });
});

describe("the invite panel", () => {
  it("asks for email, role and an optional password", () => {
    const out = html(el(InvitePanel, { employees: [], existingEmails: [], onClose: noop, onDone: noop }));
    expect(out).toContain("Email");
    expect(out).toContain("Role");
    expect(out).toContain("Password");
    expect(out).not.toContain("Employee");
    expect(out).toContain("Send invite");
  });
  it("shows the role also with an employee picked, and the employee's validity", () => {
    const emp = { id: "e1", first_name: "Asha", last_name: "Rao", email: "a@x.com", valid_from: "2026-01-05", valid_to: null };
    const out = html(el(InvitePanel, { employees: [emp], existingEmails: [], prefillEmployeeId: "e1", onClose: noop, onDone: noop }));
    expect(out).toContain("Role");
    expect(out).toContain("Admin");
    expect(out).toContain("Member");
    expect(out).toContain('value="a@x.com"');
    expect(out).toContain("From 5 Jan 2026");
    expect(out).toContain(">Add<");
  });
  it("adds the employee choice only when there is one to give a login to", () => {
    const out = html(el(InvitePanel, { employees: [{ id: "e1", first_name: "Asha", last_name: "Rao", email: "a@x.com" }], existingEmails: [], onClose: noop, onDone: noop }));
    expect(out).toContain("Employee");
    expect(out).toContain("Asha Rao");
  });
});

describe("the role panel", () => {
  const props = { features: {} as never, onClose: noop, onChanged: noop, onDelete: noop };
  it("is a name and one checklist of areas, with Create / Edit / Delete on the ticked ones", () => {
    const out = html(el(RolePanel, { ...props, role: roleFull() }));
    expect(out).toContain("Name");
    expect(out).toContain("Accounts");
    expect(out).toContain("Create");
    expect(out).toContain("Delete");
    expect(out).toContain("<summary>More</summary>");
    expect(out).toContain("Default dashboard");
  });
  it("a new role has no Delete and tells you to save before the dashboard", () => {
    const out = html(el(RolePanel, { ...props, role: null }));
    expect(out).toContain("New role");
    expect(out).not.toMatch(/<button[^>]*>Delete</);
    expect(out).toContain("Save the role first");
  });
  it("a standard role is read-only: Duplicate and edit, Sync, no Save", () => {
    const out = html(el(RolePanel, { ...props, role: roleFull({ is_standard: true }) }));
    expect(out).toContain("Duplicate and edit");
    expect(out).toContain("Sync with catalog");
    expect(out).not.toContain(">Save<");
    expect(out).not.toMatch(/<button[^>]*>Delete</);
  });
});

describe("the page", () => {
  it("renders its loading state without a tenant", () => {
    expect(html(el(PeopleClient, null))).toContain("Loading");
  });
});

describe("the retired addresses redirect", () => {
  const to = async (fn: () => Promise<void>) => {
    try { await fn(); } catch (e) { return (e as Error).message; }
    return "";
  };
  const sp = (o: Record<string, string> = {}) => Promise.resolve(o);
  it("Team goes to People", async () => {
    expect(await to(() => TeamRedirect({ searchParams: sp() }))).toBe("REDIRECT:/settings/people");
  });
  it("Business users goes to People", async () => {
    expect(await to(() => BusinessUsersRedirect({ searchParams: sp() }))).toBe("REDIRECT:/settings/people");
  });
  it("Business roles goes to the Roles tab, and a tab asked for is kept", async () => {
    expect(await to(() => BusinessRolesRedirect({ searchParams: sp() }))).toBe("REDIRECT:/settings/people?tab=roles");
    expect(await to(() => TeamRedirect({ searchParams: sp({ tab: "roles" }) }))).toBe("REDIRECT:/settings/people?tab=roles");
  });
});
