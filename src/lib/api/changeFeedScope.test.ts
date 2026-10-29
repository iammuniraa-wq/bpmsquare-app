import { describe, expect, it } from "vitest";
import { canReadChangeType, changeTypeFilter, redactChangeEntries, scopeForChangeType, shapeChangeEvent, stripInternalChangeFields, webhookTypeFilter } from "./changeFeedScope";
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
    for (const t of ["accounts", "quotes", "cases", "invoices", "suppliers", "assets", "work_orders", "standard_quotes", "sales_orders", "settings"]) {
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

  it("standard quote changes follow the standard_quotes scope, not the quotations one", () => {
    expect(scopeForChangeType("standard_quotes")).toBe("standard_quotes");
    expect(scopeForChangeType("standard_quote")).toBe("standard_quotes");
    expect(canReadChangeType(key(["standard_quotes"]), "standard_quotes")).toBe(true);
    expect(canReadChangeType(key(["quotations"]), "standard_quotes")).toBe(false);
    expect(canReadChangeType(key(["standard_quotes"]), "quotes")).toBe(false);
    expect(changeTypeFilter(key(["standard_quotes"])).types).toEqual(expect.arrayContaining(["standard_quotes", "standard_quote"]));
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

  it("a webhook's all-objects filter equals a wildcard key's: every explicit-only type is held back", () => {
    const hook = webhookTypeFilter(["*"]);
    const apiKey = changeTypeFilter(key(["*"]));
    expect(hook.kind).toBe("except");
    expect([...hook.types].sort()).toEqual([...apiKey.types].sort());
    expect(webhookTypeFilter(null)).toEqual(hook);
    expect(webhookTypeFilter([])).toEqual(hook);
  });

  it("a webhook that names an explicit-only type (by change type or by scope) gets that type, a named list is literal", () => {
    expect(webhookTypeFilter(["*", "employees"]).types).not.toContain("employees");
    expect(webhookTypeFilter(["*", "employees"]).types).toContain("rfqs");
    expect(webhookTypeFilter(["*", "rfqs"]).types).not.toContain("pricing_rfqs");
    expect(webhookTypeFilter(["employees", "quotes"])).toEqual({ kind: "only", types: ["employees", "quotes"] });
  });

  it("one shaper serves both feeds: internal columns stripped, personal fields redacted", () => {
    const row = { id: "i", object_type: "employees", object_id: "o", object_label: "L", action: "update", actor_email: null, created_at: "t",
      changes: [{ field: "phone", from: "0501", to: "0502" }, { field: "name", from: "A", to: "B" }] };
    expect(shapeChangeEvent(row).changes).toEqual([{ field: "phone", from: "[redacted]", to: "[redacted]", redacted: true }, { field: "name", from: "A", to: "B" }]);
    expect(shapeChangeEvent({ ...row, object_type: "products", changes: [{ field: "cost_price", from: 1, to: 2 }] }).changes).toEqual([]);
    expect(redactChangeEntries("quotes", row.changes)).toBe(row.changes);
  });
});
