import { describe, expect, it } from "vitest";
import { tipTextProblems } from "@/lib/infoTip";
import { PEOPLE_TIPS } from "./tips";
import {
  accessWord, draftFromPerson, emptyInvite, filterPeople, freeEmployees, grantDraftFrom, grantsFromDraft, inviteSuccessText, mergePeople,
  passwordProblem, peopleRedirect, peopleWithRole, personDirty, planInvite, planPersonSave, roleChips, roleProblem, sortRoles, statusOf,
  type Login, type Member, type RoleFull,
} from "./logic";

const member = (o: Partial<Member> = {}): Member => ({
  user_id: "u1", role: "member", email: "asha@acme.com", name: "Asha Rao", created_at: "2026-01-01", business_role_ids: [], ...o,
});
const login = (o: Partial<Login> = {}): Login => ({
  user_id: "u1", employee_id: null, display_name: null, is_locked: false, valid_from: null, valid_to: null, counted: true, ...o,
});
const roles = [{ id: "r1", name: "Sales rep" }, { id: "r2", name: "Technician" }];

describe("one row per person", () => {
  it("joins a member with their login and reads status from it", () => {
    const [p] = mergePeople([member()], [login({ is_locked: true })]);
    expect(p.status).toBe("locked");
    expect(p.login?.counted).toBe(true);
  });
  it("shows a member without login controls (module off) as active", () => {
    const [p] = mergePeople([member()], []);
    expect(p.login).toBeNull();
    expect(p.status).toBe("active");
  });
  it("calls a login outside its dates out of validity", () => {
    expect(statusOf(login({ valid_to: "2000-01-01" }))).toBe("expired");
    expect(statusOf(login({ valid_from: "2999-01-01" }))).toBe("expired");
  });
  it("names a person by display name, then account name, then the email's first part", () => {
    expect(mergePeople([member()], [login({ display_name: "A. Rao" })])[0].name).toBe("A. Rao");
    expect(mergePeople([member()], [])[0].name).toBe("Asha Rao");
    expect(mergePeople([member({ name: null })], [])[0].name).toBe("asha");
  });
  it("chips: Admin alone, or Member then each business role held", () => {
    const [a, m] = mergePeople([member({ role: "admin", business_role_ids: ["r1"] }), member({ user_id: "u2", business_role_ids: ["r1", "r2"] })], []);
    expect(roleChips(a, roles)).toEqual(["Admin"]);
    expect(roleChips(m, roles)).toEqual(["Member", "Sales rep", "Technician"]);
  });
  it("searches name, email, role and status; every word must match", () => {
    const people = mergePeople([member(), member({ user_id: "u2", name: "Ben", email: "ben@x.com", role: "admin" })], [login(), login({ user_id: "u2", is_locked: true })]);
    expect(filterPeople(people, roles, "asha").map((p) => p.userId)).toEqual(["u1"]);
    expect(filterPeople(people, roles, "admin").map((p) => p.userId)).toEqual(["u2"]);
    expect(filterPeople(people, roles, "locked").map((p) => p.userId)).toEqual(["u2"]);
    expect(filterPeople(people, roles, "asha ben")).toEqual([]);
    expect(filterPeople(people, roles, "  ")).toHaveLength(2);
  });
  it("offers only employees without a login", () => {
    const emps = [{ id: "e1", first_name: "A", last_name: "B", email: null }, { id: "e2", first_name: "C", last_name: "D", email: null }];
    expect(freeEmployees(emps, [login({ employee_id: "e1" })]).map((e) => e.id)).toEqual(["e2"]);
  });
});

describe("saving a person sends only what changed, through the routes Team and Business Users always used", () => {
  const p = mergePeople([member({ business_role_ids: ["r1"] })], [login()])[0];

  it("nothing changed means nothing to save", () => {
    expect(planPersonSave(p, draftFromPerson(p))).toEqual([]);
    expect(personDirty(p, draftFromPerson(p))).toBe(false);
  });
  it("role change goes to the Team route", () => {
    expect(planPersonSave(p, { ...draftFromPerson(p), role: "admin" })).toEqual([
      { url: "/api/settings/team/u1", method: "PATCH", body: { role: "admin" } },
    ]);
  });
  it("business roles are replaced wholesale, and only for a member", () => {
    expect(planPersonSave(p, { ...draftFromPerson(p), roleIds: ["r1", "r2"] })).toEqual([
      { url: "/api/settings/team/u1/roles", method: "PUT", body: { role_ids: ["r1", "r2"] } },
    ]);
    expect(planPersonSave(p, { ...draftFromPerson(p), role: "admin", roleIds: [] }).map((c) => c.method + c.url)).toEqual(["PATCH/api/settings/team/u1"]);
  });
  it("switching Active off locks the login; switching it on unlocks", () => {
    const off = planPersonSave(p, { ...draftFromPerson(p), active: false });
    expect(off).toEqual([{ url: "/api/business-users/u1", method: "PATCH", body: { is_locked: true } }]);
    const locked = mergePeople([member()], [login({ is_locked: true })])[0];
    expect(planPersonSave(locked, { ...draftFromPerson(locked), active: true })[0].body).toEqual({ is_locked: false });
  });
  it("login details go first, empty dates clear, a password and an employee link are sent once", () => {
    const calls = planPersonSave(p, {
      ...draftFromPerson(p), displayName: " Asha R ", validTo: "2027-01-01", counted: false, newPassword: "longenough", employeeId: "e9", role: "admin",
    });
    expect(calls[0]).toEqual({
      url: "/api/business-users/u1", method: "PATCH",
      body: { display_name: "Asha R", valid_to: "2027-01-01", counted: false, new_password: "longenough", employee_id: "e9" },
    });
    expect(calls[1].url).toBe("/api/settings/team/u1");
    const cleared = mergePeople([member()], [login({ valid_from: "2026-01-01" })])[0];
    expect(planPersonSave(cleared, { ...draftFromPerson(cleared), validFrom: "" })[0].body).toEqual({ valid_from: null });
  });
  it("never re-links an employee that is already linked", () => {
    const linked = mergePeople([member()], [login({ employee_id: "e1" })])[0];
    expect(planPersonSave(linked, { ...draftFromPerson(linked), employeeId: "e2" })).toEqual([]);
  });
  it("without the login controls only role and business roles are saved", () => {
    const bare = mergePeople([member()], [])[0];
    expect(planPersonSave(bare, { ...draftFromPerson(bare), active: false, displayName: "x" })).toEqual([]);
  });
  it("short passwords are caught before the server", () => {
    expect(passwordProblem("short")).not.toBeNull();
    expect(passwordProblem("")).toBeNull();
    expect(passwordProblem("12345678")).toBeNull();
  });
});

describe("invite", () => {
  it("is the Team invite: an email invite, or a login with the password you typed", () => {
    const plan = planInvite({ ...emptyInvite(), email: " New@Acme.com ", role: "admin" }, []);
    expect(plan.call).toEqual({ url: "/api/settings/team", method: "POST", body: { email: "new@acme.com", password: undefined, role: "admin" } });
    expect(plan.viaEmployee).toBe(false);
  });
  it("with an employee it is the Business Users create, which needs a password for a new login", () => {
    const base = { ...emptyInvite(), email: "e@acme.com", employeeId: "e1" };
    expect(planInvite(base, []).problem).toMatch(/password/i);
    expect(planInvite({ ...base, password: "longenough" }, []).call).toEqual({
      url: "/api/business-users", method: "POST", body: { employee_id: "e1", email: "e@acme.com", password: "longenough", counted: true },
    });
    expect(planInvite(base, ["E@acme.com"]).call?.url).toBe("/api/business-users");
  });
  it("asks for an email and a long enough password", () => {
    expect(planInvite(emptyInvite(), []).problem).toMatch(/email/i);
    expect(planInvite({ ...emptyInvite(), email: "a@b.co", password: "short" }, []).problem).toMatch(/8/);
  });
  it("words the outcome", () => {
    expect(inviteSuccessText({ linkedExisting: true }, true)).toMatch(/unchanged/);
    expect(inviteSuccessText({ passwordSet: true }, false)).toMatch(/sign-in details/);
    expect(inviteSuccessText({}, false)).toBe("Invite sent.");
  });
});

describe("roles", () => {
  const grants = [
    { workcenter: "accounts", can_view: true, can_create: true, can_edit: false, can_delete: false },
    { workcenter: "contacts", can_view: true, can_create: false, can_edit: true, can_delete: true },
  ];
  it("round-trips the checklist, keeping Create, Edit and Delete per area", () => {
    const d = grantDraftFrom(grants);
    expect(d.accounts).toEqual({ granted: true, can_create: true, can_edit: false, can_delete: false });
    expect(d.quotations.granted).toBe(false);
    expect(grantsFromDraft(d)).toEqual(grants);
  });
  it("summarises access and counts who holds a role", () => {
    expect(accessWord([])).toBe("Nothing yet");
    expect(accessWord(grants)).toBe("2 areas");
    const people = mergePeople([member({ business_role_ids: ["r1"] }), member({ user_id: "u2", role: "admin", business_role_ids: ["r1"] })], []);
    expect(peopleWithRole(people, "r1")).toBe(1);
  });
  it("lists your own roles before the standard ones", () => {
    const r = (id: string, name: string, std: boolean): RoleFull => ({ id, name, description: null, grants: [], is_standard: std });
    expect(sortRoles([r("1", "Admin", true), r("2", "Zed", false), r("3", "Alpha", false)]).map((x) => x.id)).toEqual(["3", "2", "1"]);
  });
  it("needs a name", () => {
    expect(roleProblem("  ")).not.toBeNull();
    expect(roleProblem("Sales")).toBeNull();
  });
});

describe("the retired addresses", () => {
  it("Team and Business users land on People", () => {
    expect(peopleRedirect(undefined)).toBe("/settings/people");
  });
  it("Business roles lands on the Roles tab", () => {
    expect(peopleRedirect("roles")).toBe("/settings/people?tab=roles");
  });
  it("keeps a tab that was asked for and any other query", () => {
    expect(peopleRedirect(undefined, { tab: "roles" })).toBe("/settings/people?tab=roles");
    expect(peopleRedirect(undefined, { q: "asha", tab: "people" })).toBe("/settings/people?q=asha");
    expect(peopleRedirect("roles", { x: ["1", "2"] })).toBe("/settings/people?x=1&x=2&tab=roles");
  });
});

describe("the People tips", () => {
  for (const [key, text] of Object.entries(PEOPLE_TIPS)) {
    it(`${key} fits the limit`, () => expect(tipTextProblems(text)).toEqual([]));
  }
});
