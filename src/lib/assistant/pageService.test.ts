import { describe, expect, it, vi } from "vitest";

const { ROWS } = vi.hoisted(() => {
  const ACC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const ACC_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  return {
    ROWS: {
      ACC, ACC_B,
      accounts: { "t-A": [{ id: ACC, name: "Al-Otaibi Contracting", type: "Customer", city: "Riyadh" }], "t-B": [{ id: ACC_B, name: "Other Ltd" }] } as Record<string, Record<string, unknown>[]>,
      contacts: { "t-A": [] as Record<string, unknown>[], "t-B": [] as Record<string, unknown>[] },
      quotations: { "t-A": [{ id: "q1", ref: "SQ-1", status: "draft", created_at: "2026-10-01T00:00:00Z", account: { id: ACC, name: "Al-Otaibi Contracting" } }] as Record<string, unknown>[], "t-B": [] as Record<string, unknown>[] },
      cases: { "t-A": [] as Record<string, unknown>[], "t-B": [] as Record<string, unknown>[] },
    },
  };
});

vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: () => { throw new Error("no database"); }, requireTenantUser: async () => { throw new Error("n/a"); } }));
vi.mock("@/lib/marketing/leads/queries", () => ({ listScoredLeads: vi.fn() }));
vi.mock("@/lib/api/listSources", () => {
  const src = (wc: string, key: "accounts" | "contacts" | "quotations" | "cases") => ({
    label: key, description: key, relatedWorkcenter: wc,
    fields: [{ path: "id", type: "string" }, { path: "name", type: "string" }, { path: "ref", type: "string" }, { path: "status", type: "string" }, { path: "created_at", type: "date" }, { path: "city", type: "string" }, { path: "account.id", type: "string" }, { path: "account.name", type: "string" }],
    load: async (t: string) => (ROWS as unknown as Record<string, Record<string, Record<string, unknown>[]>>)[key][t] ?? [],
  });
  return { LIST_SOURCES: { accounts: src("accounts", "accounts"), contacts: src("contacts", "contacts"), quotations: src("quotations", "quotations"), cases: src("cases", "cases") } };
});
const ownWork = vi.hoisted(() => vi.fn());
vi.mock("./ownWork", () => ({ loadOwnWork: ownWork }));

import { describePage } from "./pageService";
import type { PermissionSet } from "@/lib/permissions";

const ALL: PermissionSet = { unrestricted: true, grants: new Map() };
const NOW = new Date("2026-10-21T09:00:00Z");
const ctx = (tenantId: string, features: Record<string, boolean>, perms: PermissionSet = ALL) => ({ tenantId, perms, features });

describe("the dock's context line and suggestions strip", () => {
  it("labels the record on screen and suggests from it and what belongs to it", async () => {
    const page = await describePage({} as never, ctx("t-A", { accounts: true, contacts: true, quotations: true, cases: true }), "u1", `/accounts/${ROWS.ACC}`, NOW);
    expect(page.context).toMatchObject({ label: "Al-Otaibi Contracting", objectType: "account", recordId: ROWS.ACC });
    const ids = page.suggestions.map((s) => s.id);
    expect(ids).toContain("account.add-contact");
    expect(ids).toContain("account.finish-draft");
    expect(page.suggestions.length).toBeLessThanOrEqual(3);
  });

  it("leaves out what the workspace has not bought or the person may not view, and fills the strip from what is left", async () => {
    const noContacts = await describePage({} as never, ctx("t-A", { accounts: true, quotations: true, cases: true }), "u1", `/accounts/${ROWS.ACC}`, NOW);
    expect(noContacts.suggestions.map((s) => s.id)).not.toContain("account.add-contact");
    expect(noContacts.suggestions.map((s) => s.id)).toContain("account.finish-draft");
    const restricted: PermissionSet = { unrestricted: false, grants: new Map([["accounts", { workcenter: "accounts", canView: true, canCreate: false, canEdit: false, canDelete: false }]]) };
    const onlyAccounts = await describePage({} as never, ctx("t-A", { accounts: true, contacts: true, quotations: true }, restricted), "u1", `/accounts/${ROWS.ACC}`, NOW);
    expect(onlyAccounts.suggestions.map((s) => s.id)).not.toContain("account.finish-draft");
  });

  it("another workspace's record gives no context and falls back to the person's own work", async () => {
    ownWork.mockResolvedValue({ staleDrafts: [{ id: "q9", ref: "SQ-9" }] });
    const page = await describePage({} as never, ctx("t-A", { accounts: true, quotations: true }), "u1", `/accounts/${ROWS.ACC_B}`, NOW);
    expect(page.context).toBeNull();
    expect(page.suggestions.map((s) => s.id)).toEqual(["own.draft"]);
    expect(JSON.stringify(page)).not.toContain("Other Ltd");
  });

  it("no record in front of the person: their own work, read for their own id", async () => {
    ownWork.mockResolvedValue({ staleDrafts: [{ id: "q9", ref: "SQ-9" }], readyLeads: 2 });
    const page = await describePage({} as never, ctx("t-A", { quotations: true, marketing_scoring: true }), "user-7", "/settings/currency", NOW);
    expect(ownWork).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ tenantId: "t-A" }), "user-7", NOW);
    expect(page.context).toBeNull();
    expect(page.suggestions.map((s) => s.id)).toEqual(["own.draft", "own.leads"]);
  });

  it("a failing read is an empty strip, never an error", async () => {
    ownWork.mockRejectedValue(new Error("db down"));
    const page = await describePage({} as never, ctx("t-A", { quotations: true }), "u1", null, NOW);
    expect(page).toEqual({ context: null, suggestions: [] });
  });
});
