import { describe, expect, it } from "vitest";
import { canReadChangeType, changeTypeFilter, scopeForChangeType, stripInternalChangeFields } from "./changeFeedScope";
import type { ApiScopes } from "@/app/api/v1/_auth";

// Audit 2026-10-21 (M1): /api/v1/changes returned every object's change history to any
// read-scoped key. It must follow the same scope rule as the list endpoints.

const key = (objects: string[], read = true): ApiScopes => ({ read, write: false, objects });

describe("change feed scope", () => {
  it("a key scoped to products sees product changes and nothing else", () => {
    const s = key(["products"]);
    expect(canReadChangeType(s, "products")).toBe(true);
    for (const t of ["employees", "rfqs", "estimates", "accounts", "quotes", "invoices", "contacts", "suppliers", "assets", "settings"]) {
      expect(canReadChangeType(s, t), t).toBe(false);
    }
    const f = changeTypeFilter(s);
    expect(f.kind).toBe("only");
    expect(f.types).toEqual(expect.arrayContaining(["products", "product"]));
    expect(f.types).not.toContain("employees");
    expect(f.types).not.toContain("rfqs");
  });

  it("the wildcard still reaches ordinary objects but not the explicit-only ones", () => {
    const s = key(["*"]);
    for (const t of ["accounts", "quotes", "cases", "invoices", "suppliers", "assets", "work_orders", "standard_quotes", "settings"]) {
      expect(canReadChangeType(s, t), t).toBe(true);
    }
    for (const t of ["employees", "contacts", "rfqs", "pricing_rfqs", "estimates", "estimate_templates", "abm_target_accounts", "abm_buying_group_members"]) {
      expect(canReadChangeType(s, t), t).toBe(false);
    }
    const f = changeTypeFilter(s);
    expect(f.kind).toBe("except");
    expect(f.types).toEqual(expect.arrayContaining(["employees", "rfqs", "estimates", "contacts", "abm_target_accounts"]));
    expect(f.types).not.toContain("accounts");
  });

  it("naming an explicit-only object opens exactly that object, even alongside the wildcard", () => {
    const s = key(["*", "employees"]);
    expect(canReadChangeType(s, "employees")).toBe(true);
    expect(canReadChangeType(s, "rfqs")).toBe(false);
    expect(changeTypeFilter(s).types).not.toContain("employees");
  });

  it("a named key does not reach types that have no v1 endpoint, and a key without read reaches nothing", () => {
    expect(canReadChangeType(key(["accounts"]), "suppliers")).toBe(false);
    expect(canReadChangeType(key(["accounts"]), "accounts")).toBe(true);
    expect(canReadChangeType(key(["*"], false), "accounts")).toBe(false);
  });

  it("an unmapped type has no scope of its own", () => {
    expect(scopeForChangeType("suppliers")).toBeNull();
    expect(scopeForChangeType("quotes")).toBe("quotations");
    expect(scopeForChangeType("wfm_projects")).toBe("projects");
  });

  it("internal columns never travel back out as the from/to of a change", () => {
    const changes = [{ field: "cost_price", from: 40, to: 55 }, { field: "name", from: "A", to: "B" }];
    expect(stripInternalChangeFields("products", changes)).toEqual([{ field: "name", from: "A", to: "B" }]);
    expect(stripInternalChangeFields("accounts", changes)).toEqual(changes);
    expect(stripInternalChangeFields("products", null)).toBeNull();
  });
});
