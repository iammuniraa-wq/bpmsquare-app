import { describe, expect, it, vi } from "vitest";
import { createElement as create, type ReactElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/settings/people",
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
}));

import { PeopleRows, RoleRows } from "./Rows";
import PersonPanel from "./PersonPanel";
import InvitePanel from "./InvitePanel";
import RolePanel from "./RolePanel";
import PeopleClient from "./PeopleClient";
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
  const props = { roles, businessRoles: true, employees: [], onClose: noop, onSaved: noop, onRemove: noop };
  it("shows Role, Business roles, Active and Remove, with the rest behind More", () => {
    const out = html(el(PersonPanel, { ...props, person: people[0] }));
    expect(out).toContain("Member");
    expect(out).toContain("Admin");
    expect(out).toContain("Business roles");
    expect(out).toContain("Sales rep");
    expect(out).toContain("Technician");
    expect(out).toContain("Active");
    expect(out).toContain(">Remove<");
    expect(out).toContain("<summary>More</summary>");
    expect(out).toContain("Display name");
    expect(out).toContain("Valid from");
    expect(out).toContain("New password");
    expect(out).toContain("Counted user");
  });
  it("keeps Save off until something changes", () => {
    expect(html(el(PersonPanel, { ...props, person: people[0] }))).toMatch(/<button[^>]*disabled[^>]*>Save</);
  });
  it("hides business roles for an admin, who bypasses them", () => {
    const out = html(el(PersonPanel, { ...props, person: people[1] }));
    expect(out).not.toContain("aria-label=\"Business roles\"");
    expect(out).not.toContain("Technician");
  });
  it("is just Role and Remove when the Business Roles module is off", () => {
    const bare = mergePeople([member()], [])[0];
    const out = html(el(PersonPanel, { ...props, businessRoles: false, person: bare }));
    expect(out).not.toContain("Business roles");
    expect(out).not.toContain("Active");
    expect(out).not.toContain("<summary>");
    expect(out).toContain(">Remove<");
  });
  it("offers the unlinked employees to tie a login to", () => {
    const out = html(el(PersonPanel, { ...props, person: people[0], employees: [{ id: "e1", first_name: "Asha", last_name: "Rao", email: null, employee_code: "EMP-0001" }] }));
    expect(out).toContain("Asha Rao (EMP-0001)");
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
