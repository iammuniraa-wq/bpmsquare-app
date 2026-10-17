import { describe, expect, it } from "vitest";
import { explainNav, resolveAccess, type AccessInput } from "./accessView";

const admin: AccessInput = { role: "admin", viewable: "all", isWfmSupervisor: true, roleNames: [] };
const all = { quotations: true, standard_quotes: true, pipeline: true, invoices: true, purchasing: true, rfq: true, wfm: true, accounts: true };
const row = (v: ReturnType<typeof explainNav>, label: string) => v.find((x) => x.label === label)!;

describe("resolveAccess", () => {
  it("treats an admin and an unassigned member as unrestricted", () => {
    expect(resolveAccess({ role: "admin", assignedRoleIds: [], grants: [], employeeIsActiveSupervisor: false })).toEqual({ viewable: "all", isWfmSupervisor: true });
    expect(resolveAccess({ role: "member", assignedRoleIds: [], grants: [], employeeIsActiveSupervisor: false })).toEqual({ viewable: "all", isWfmSupervisor: false });
  });

  it("unions the workcenters of every assigned role, and counts edit on wfm as supervisor", () => {
    const grants = [
      { role_id: "a", workcenter: "cases", can_view: true, can_edit: false },
      { role_id: "b", workcenter: "wfm", can_view: true, can_edit: true },
      { role_id: "c", workcenter: "accounts", can_view: true, can_edit: true },
    ];
    const r = resolveAccess({ role: "member", assignedRoleIds: ["a", "b"], grants, employeeIsActiveSupervisor: false });
    expect(r.viewable).toEqual(["cases", "wfm"]);
    expect(r.isWfmSupervisor).toBe(true);
  });
});

describe("explainNav", () => {
  it("names the layer that hides each missing entry", () => {
    const v = explainNav({
      features: { ...all, rfq: false },
      hiddenHrefs: ["/pipeline"],
      access: { role: "member", viewable: ["quotations", "wfm"], isWfmSupervisor: false, roleNames: ["Sales"] },
    });
    expect(row(v, "Quotations").visible).toBe(true);
    expect(row(v, "RFQs").hiddenBy).toEqual(expect.arrayContaining(["module", "role"]));
    expect(row(v, "Pipeline").hiddenBy).toEqual(expect.arrayContaining(["role", "navigation"]));
    expect(row(v, "Live board").hiddenBy).toEqual(["supervisor"]);
    expect(row(v, "My Workforce").visible).toBe(true);
  });

  it("shows an admin everything their workspace owns, minus what the workspace hid", () => {
    const v = explainNav({ features: all, hiddenHrefs: ["/standard-quotes"], access: admin });
    expect(row(v, "Standard Quotes").hiddenBy).toEqual(["navigation"]);
    expect(row(v, "Quotations").visible).toBe(true);
    expect(row(v, "Cases").hiddenBy).toEqual(["module"]);
  });

  it("lists children under their bundle and not the bundle itself", () => {
    const v = explainNav({ features: all, hiddenHrefs: [], access: admin });
    expect(row(v, "Quotations").parent).toBe("Sales");
    expect(v.find((x) => x.label === "Sales")).toBeUndefined();
    expect(row(v, "Dashboard").parent).toBeNull();
  });
});
