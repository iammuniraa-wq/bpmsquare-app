import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  inserted: [] as Row[],
  updates: [] as Row[],
  before: null as Row | null,
}));

function table(name: string) {
  const filters: [string, unknown][] = [];
  let inList: [string, unknown[]] | null = null;
  let pendingUpdate: Row | null = null;
  const b: Record<string, unknown> = {};
  const rows = () =>
    (state.tables[name] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v) && (!inList || inList[1].includes(r[inList[0]])));
  Object.assign(b, {
    select: () => b,
    eq: (k: string, v: unknown) => { filters.push([k, v]); return b; },
    in: (k: string, v: unknown[]) => { inList = [k, v]; return b; },
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    update: (patch: Row) => { pendingUpdate = patch; state.updates.push(patch); return b; },
    then: (resolve: (r: unknown) => void) => resolve({ data: pendingUpdate ? null : rows(), error: null }),
  });
  return b;
}

const U1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1"; // caller, member of t1
const U2 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2"; // colleague, member of t1
const U9 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa9"; // member of t2 only
const ACC = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1";
const OPP = "cccccccc-cccc-cccc-cccc-ccccccccccc1";

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => ({ from: (n: string) => table(n) }),
  getAuthUser: async () => ({ id: U1, email: "me@x.com" }),
  requireTenantUser: async () => ({ tenantId: "t1", userId: U1, role: "member", supabase: {} }),
}));
vi.mock("@/lib/tenant", () => ({ tenantHasFeature: async () => true, getTenant: async () => ({ config: {} }) }));
vi.mock("@/lib/masterRef", () => ({
  insertWithMasterRef: async (_a: unknown, _t: string, _tid: string, record: Row) => {
    state.inserted.push(record);
    return { data: { id: "new1", ref: "OPP-1" }, error: null };
  },
}));
vi.mock("@/lib/changeLog", () => ({ diffForLog: () => [], logChange: async () => {} }));
vi.mock("@/lib/events/emitters", () => ({
  emitOpportunityCreated: async () => {}, emitOpportunityStageChanged: async () => {},
  emitOpportunityClosed: async () => {}, emitOpportunityUpdated: async () => {},
}));
vi.mock("@/lib/sales/opportunityServer", () => ({
  listOpportunities: async () => [],
  loadOpportunity: async () => state.before,
  loadOpportunityLines: async () => [], loadLinkedQuotes: async () => [], stageSinceMap: async () => new Map(),
  refreshOpportunityDerived: async () => {},
}));

import { POST } from "./route";
import { PATCH } from "./[id]/route";

beforeEach(() => {
  state.inserted = []; state.updates = [];
  state.before = { id: OPP, ref: "OPP-1", title: "Deal", stage: "new", outcome: "open", account_id: ACC, contact_id: null, owner_id: U1, team: [], loss_reason: null, probability_override: null, custom_data: {} };
  state.tables = {
    accounts: [{ id: ACC, tenant_id: "t1", name: "Acme" }],
    tenant_users: [
      { tenant_id: "t1", user_id: U1 }, { tenant_id: "t1", user_id: U2 }, { tenant_id: "t2", user_id: U9 },
    ],
  };
});

const post = (b: Row) => POST(new Request("http://x/api/opportunities", { method: "POST", body: JSON.stringify(b) }) as never);
const patch = (b: Row) =>
  PATCH(new Request("http://x/api/opportunities/" + OPP, { method: "PATCH", body: JSON.stringify(b) }) as never, { params: Promise.resolve({ id: OPP }) });

describe("POST /api/opportunities owner", () => {
  it("accepts a workspace colleague as owner", async () => {
    expect((await post({ account_id: ACC, title: "t", owner_id: U2 })).status).toBe(201);
    expect(state.inserted[0].owner_id).toBe(U2);
  });

  it("defaults the owner to the caller when none is sent", async () => {
    expect((await post({ account_id: ACC, title: "t" })).status).toBe(201);
    expect(state.inserted[0].owner_id).toBe(U1);
  });

  it("422s a user id that belongs to another workspace, and creates nothing", async () => {
    const res = await post({ account_id: ACC, title: "t", owner_id: U9 });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/owner_id/);
    expect(state.inserted).toHaveLength(0);
  });

  it("422s a value that is not a user id at all", async () => {
    expect((await post({ account_id: ACC, title: "t", owner_id: "nobody" })).status).toBe(422);
  });
});

describe("PATCH /api/opportunities/[id] owner and team", () => {
  it("accepts a colleague as owner and as team member", async () => {
    const res = await patch({ owner_id: U2, team: [{ user_id: U2, role: "sales" }, { user_id: U1, role: "sales" }] });
    expect(res.status).toBe(200);
    expect(state.updates[0].owner_id).toBe(U2);
  });

  it("422s a foreign-tenant owner and writes nothing", async () => {
    const res = await patch({ owner_id: U9 });
    expect(res.status).toBe(422);
    expect(state.updates).toHaveLength(0);
  });

  it("422s a foreign-tenant user inside team", async () => {
    const res = await patch({ team: [{ user_id: U2, role: "sales" }, { user_id: U9, role: "sales" }] });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/team/);
    expect(state.updates).toHaveLength(0);
  });

  it("lets a deal be left without an owner (null or empty)", async () => {
    expect((await patch({ owner_id: null })).status).toBe(200);
    expect((await patch({ owner_id: "" })).status).toBe(200);
    expect(state.updates.every((u) => u.owner_id === null)).toBe(true);
  });

  it("does not re-check ids already on the deal when an unrelated team change is saved", async () => {
    state.before = { ...state.before!, owner_id: U9, team: [{ user_id: U9, role: "sales" }] };
    const res = await patch({ owner_id: U9, team: [{ user_id: U9, role: "sales" }, { user_id: U2, role: "sales" }] });
    expect(res.status).toBe(200);
  });
});
