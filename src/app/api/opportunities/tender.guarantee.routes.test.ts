import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDb } from "@/lib/inbox/testing/memoryDb";

// GCC tender deals, redesign step 1: the bid guarantee's four states (migration 0228) through POST .../tender/bond { action: "set_status" }.
// Against an in-memory database: who may change it, the states it accepts, release staying release, another workspace's rows, the change
// log, and a database whose check constraint still allows held and released only.

const state = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  features: {} as Record<string, boolean>,
  changes: [] as { objectType: string; objectId: string; changes?: { field: string; from: unknown; to: unknown }[] }[],
  user: { id: "u1", email: "me@t1.test" },
  role: "member" as "admin" | "member",
  edit: true,
  /** The old check constraint: only held and released are accepted. */
  legacyCheck: false,
}));

const T1 = "t1";
const T2 = "t2";
const ME = "11111111-1111-4111-8111-111111111111";
const OPP = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const OPP_T2 = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => ({
    from: (t: string) => {
      const q = state.db.from(t) as unknown as Record<string, unknown>;
      if (t !== "opportunity_tenders" || !state.legacyCheck) return q;
      return new Proxy(q, {
        get(target, prop) {
          const value = Reflect.get(target, prop) as unknown;
          if (prop !== "update") return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
          return (patch: Record<string, unknown>) => {
            if (!["requested", "submitted", "issued"].includes(String(patch.bond_status))) return (value as (p: unknown) => unknown).call(target, patch);
            const chain: Record<string, unknown> = { eq: () => chain, neq: () => chain, select: () => chain, then: (res: (r: unknown) => unknown) => res({ data: null, error: { code: "23514", message: "violates check constraint" } }) };
            return chain;
          };
        },
      });
    },
    auth: state.db.auth,
  }),
  getAuthUser: async () => state.user,
  requireTenantUser: async () => ({ tenantId: T1, userId: state.user.id, role: state.role, supabase: {} }),
}));
vi.mock("@/lib/tenant", () => ({
  tenantHasFeature: async (_s: unknown, _t: string, key: string) => !!state.features[key],
  getTenant: async () => ({ config: {}, features: state.features }),
}));
vi.mock("@/lib/permissions", () => ({
  resolvePermissions: async () => ({ unrestricted: true, grants: new Map() }),
  canViewWorkcenter: () => true,
  canEditWorkcenter: () => state.edit,
}));
vi.mock("@/lib/changeLog", () => ({
  diffForLog: () => [],
  logChange: async (_c: unknown, p: (typeof state.changes)[number]) => { state.changes.push(p); },
}));

import { NextRequest } from "next/server";
import { POST as bondPost } from "./[id]/tender/bond/route";

const req = (body?: unknown) => new NextRequest(new URL("http://internal.invalid/x"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const set = (status: unknown, id = OPP) => bondPost(req({ action: "set_status", status }), ctx(id));
const tender = (id = OPP) => state.db.rows("opportunity_tenders").find((t) => t.opportunity_id === id)!;

const tenderRow = (opportunity_id: string, tenant_id: string, over: Record<string, unknown> = {}) => ({
  opportunity_id, tenant_id, tender_no: "ARB-1", issuer_name: "Aramco", portal: "ariba", closing_at: "2026-10-30T09:00:00.000Z", bid_bond_amount: 96000,
  bid_bond_currency: "SAR", bid_bond_expiry: "2027-01-30", addenda_count: 0, decision: null, decision_reason: null, decided_by: null, decided_at: null, source_email_id: null,
  custom_data: null, reminders_sent: [], bond_status: "requested", bond_released_at: null, bond_released_by: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", ...over,
});
const oppRow = (id: string, tenant_id: string) => ({
  id, tenant_id, ref: "OPP-2", title: "Valves", account_id: "acc", contact_id: null, stage: "estimating", outcome: "open", probability: 25, owner_id: ME, team: [], amount: 0,
  created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", closed_at: null,
});

beforeEach(() => {
  state.db = new MemoryDb({
    tenants: [{ id: T1, slug: "kamco", name: "KAMCO", is_demo: false, config: {}, custom_domain: null }, { id: T2, slug: "other", name: "Other", is_demo: false, config: {}, custom_domain: null }],
    opportunities: [oppRow(OPP, T1), oppRow(OPP_T2, T2)],
    opportunity_tenders: [tenderRow(OPP, T1), tenderRow(OPP_T2, T2)],
  });
  state.features = { pipeline: true, gcc_tender: true };
  state.changes = [];
  state.edit = true;
  state.legacyCheck = false;
  state.user = { id: ME, email: "me@t1.test" };
  state.role = "member";
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("moving the guarantee through its states", () => {
  it("Requested, Issued and Submitted can be set in any order, and each change is logged with the words", async () => {
    for (const s of ["issued", "submitted", "requested"]) {
      const res = await set(s);
      expect(res.status).toBe(200);
      expect(tender().bond_status).toBe(s);
    }
    expect(state.changes.map((c) => c.changes?.[0])).toEqual([
      { field: "bond_status", from: "Requested", to: "Issued" },
      { field: "bond_status", from: "Issued", to: "Submitted" },
      { field: "bond_status", from: "Submitted", to: "Requested" },
    ]);
  });

  it("the legacy 'held' reads as Issued: setting Issued again changes and logs nothing", async () => {
    Object.assign(tender(), { bond_status: "held" });
    expect((await set("issued")).status).toBe(200);
    expect(tender().bond_status).toBe("held");
    expect(state.changes).toHaveLength(0);
    expect((await set("submitted")).status).toBe(200);
    expect(state.changes[0].changes?.[0]).toEqual({ field: "bond_status", from: "Issued", to: "Submitted" });
  });

  it("refuses Released (it has its own confirmed step), an unknown state and a released guarantee", async () => {
    expect((await set("released")).status).toBe(400);
    expect((await set("nonsense")).status).toBe(400);
    expect((await set(undefined)).status).toBe(400);
    Object.assign(tender(), { bond_status: "released" });
    const res = await set("issued");
    expect(res.status).toBe(409);
    expect(tender().bond_status).toBe("released");
  });

  it("needs edit access to the Pipeline; a person who can only view is refused and nothing changes", async () => {
    state.edit = false;
    const res = await set("issued");
    expect(res.status).toBe(403);
    expect(tender().bond_status).toBe("requested");
    expect(state.changes).toHaveLength(0);
  });

  it("another workspace's deal is a 404 and its row is untouched", async () => {
    expect((await set("issued", OPP_T2)).status).toBe(404);
    expect(tender(OPP_T2).bond_status).toBe("requested");
  });

  it("with the flag off it is a 404", async () => {
    state.features = { pipeline: true };
    expect((await set("issued")).status).toBe(404);
  });
});

describe("before migration 0228 is run", () => {
  beforeEach(() => { state.legacyCheck = true; Object.assign(tender(), { bond_status: "held" }); });

  it("every row is held, which already reads as Issued: choosing Issued is a quiet success", async () => {
    expect((await set("issued")).status).toBe(200);
    expect(tender().bond_status).toBe("held");
    expect(state.changes).toHaveLength(0);
  });

  it("Requested and Submitted say a database update is needed and change nothing", async () => {
    for (const s of ["requested", "submitted"]) {
      const res = await set(s);
      expect(res.status).toBe(503);
      expect((await res.json()).error).toMatch(/migration 0228/);
    }
    expect(tender().bond_status).toBe("held");
  });

  it("Release still works", async () => {
    const res = await bondPost(req({ action: "release" }), ctx(OPP));
    expect(res.status).toBe(200);
    expect(tender().bond_status).toBe("released");
    expect(state.changes.at(-1)?.changes).toEqual([{ field: "bond_status", from: "held", to: "released" }]);
  });
});
