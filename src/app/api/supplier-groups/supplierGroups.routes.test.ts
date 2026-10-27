import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDb } from "@/lib/inbox/testing/memoryDb";

// Supplier groups: a client's approved vendor list (docs/design/contract-buyout.md section 0b). The routes that manage a group, and the place the
// list bites: the Costing "New RFQ" composer's picker and the create and add-suppliers routes of a TENDER deal's RFQ. Standard RFQs are untouched.

const state = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  features: {} as Record<string, boolean>,
  owned: {} as Record<string, boolean>,
  changes: [] as { objectType: string; objectId: string; action: string; changes?: { field: string; from: unknown; to: unknown }[] }[],
  user: { id: "11111111-1111-4111-8111-111111111111", email: "me@t1.test" },
  suppliersEdit: true,
  suppliersView: true,
}));

const id = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const T1 = "t1";
const T2 = "t2";
const ME = "11111111-1111-4111-8111-111111111111";
const ACC = id(1), ACC2 = id(2), ACC_T2 = id(3);
const OPP = id(10), OPP_STD = id(11), OPP_NOACC = id(12);
const EST = id(20);
const S1 = id(201), S2 = id(202), S3 = id(203), S5 = id(205), S9 = id(209);
const RFQ_TENDER = id(30), RFQ_STD = id(31), RFQ_PKG = id(32);
const PKG = id(40), PRJ = id(41);
const G1 = id(50), G_T2 = id(51);

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => ({ from: (t: string) => state.db.from(t), auth: state.db.auth, storage: state.db.storage }),
  getAuthUser: async () => state.user,
  requireTenantUser: async () => ({ tenantId: T1, userId: state.user.id, role: "member", supabase: { from: (t: string) => state.db.from(t) } }),
}));
vi.mock("@/lib/tenant", () => ({
  tenantHasFeature: async (_s: unknown, _t: string, key: string) => !!state.features[key],
  getTenant: async () => ({ id: "t1", slug: "kamco", name: "KAMCO", custom_domain: null, config: {}, features: state.features, company_info: null }),
}));
vi.mock("@/lib/permissions", () => ({
  resolvePermissions: async () => ({}),
  canViewWorkcenter: (_p: unknown, wc: string) => (wc === "suppliers" ? state.suppliersView : true),
  canEditWorkcenter: (_p: unknown, wc: string) => (wc === "suppliers" ? state.suppliersEdit : true),
  canCreateWorkcenter: () => true,
}));
vi.mock("@/lib/objectFeatures", async (orig) => ({ ...(await orig<typeof import("@/lib/objectFeatures")>()), tenantOwnsObject: async (_t: string, o: string) => !!state.owned[o] }));
vi.mock("@/lib/changeLog", () => ({
  diffForLog: () => [],
  logChange: async (_c: unknown, p: (typeof state.changes)[number]) => { state.changes.push(p); },
}));
vi.mock("@/lib/events/emitters", () => ({ emitRfqSent: async () => {}, emitRfqReplied: async () => {}, emitRfqAwarded: async () => {} }));
vi.mock("@/lib/tenantClock", () => ({ tenantToday: async () => "2026-10-28", tenantTimezone: async () => "Asia/Riyadh" }));

import { NextRequest } from "next/server";
import { GET as groupsGet, POST as groupsPost } from "./route";
import { GET as groupGet, PATCH as groupPatch, DELETE as groupDelete } from "./[id]/route";
import { PUT as membersPut } from "./[id]/members/route";
import { GET as costingSuppliersGet } from "../opportunities/[id]/tender/costing/suppliers/route";
import { POST as rfqPost } from "../rfqs/route";
import { POST as rfqAddSuppliers } from "../rfqs/[id]/suppliers/route";
import { GET as suppliersGet } from "../suppliers/route";

const json = (method: string, body?: unknown) => new NextRequest(new URL("http://internal.invalid/x"), { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (gid: string) => ({ params: Promise.resolve({ id: gid }) });
const rows = (t: string) => state.db.rows(t);
const body = async (res: Response) => (await res.json()) as Record<string, any>;
const logged = () => state.changes.flatMap((c) => (c.changes ?? []).map((x) => `${c.objectType}: ${x.field}`));

const makeGroup = async (b: Record<string, unknown> = {}) => { const r = await groupsPost(json("POST", { name: "Aramco approved vendors", account_id: ACC, supplier_ids: [S1, S2], ...b })); return { status: r.status, json: await body(r) }; };
const tenderRfq = async (supplier_ids: string[], over: Record<string, unknown> = {}) => {
  const r = await rfqPost(json("POST", { origin_type: "opportunity", origin_id: OPP, lines: [{ description: "Pipe", qty: 1 }], supplier_ids, ...over }));
  return { status: r.status, json: await body(r) };
};
const addSuppliers = async (rfq: string, supplier_ids: string[]) => { const r = await rfqAddSuppliers(json("POST", { supplier_ids }), ctx(rfq)); return { status: r.status, json: await body(r) }; };

beforeEach(() => {
  state.features = { gcc_tender: true, suppliers: true, rfq: true, pipeline: true, estimator: true };
  state.owned = { rfqs: true, estimates: true };
  state.db = new MemoryDb({
    tenants: [{ id: T1, config: {}, features: state.features }, { id: T2, config: {}, features: { gcc_tender: true, suppliers: true } }],
    accounts: [{ id: ACC, tenant_id: T1, name: "Aramco" }, { id: ACC2, tenant_id: T1, name: "SABIC" }, { id: ACC_T2, tenant_id: T2, name: "Other client" }],
    suppliers: [
      { id: S1, tenant_id: T1, ref: "SUP-0001", name: "Gulf Pipes", email: "a@x.test", phone: null, city: null, status: "active", type: "vendor" },
      { id: S2, tenant_id: T1, ref: "SUP-0002", name: "Desert Supply", email: "b@x.test", phone: null, city: null, status: "active", type: "vendor" },
      { id: S3, tenant_id: T1, ref: "SUP-0003", name: "Outside Co", email: "c@x.test", phone: null, city: null, status: "active", type: "both" },
      { id: S5, tenant_id: T1, ref: "SUP-0005", name: "Retired Co", email: "r@x.test", phone: null, city: null, status: "inactive", type: "vendor" },
      { id: S9, tenant_id: T2, ref: "SUP-0001", name: "Their supplier", email: "t@x.test", phone: null, city: null, status: "active", type: "vendor" },
    ],
    opportunities: [
      { id: OPP, tenant_id: T1, ref: "OPP-2", title: "ARB-1 tender", account_id: ACC, stage: "estimating", outcome: "open", owner_id: "u1", team: [], amount: 0, currency: "SAR" },
      { id: OPP_STD, tenant_id: T1, ref: "OPP-1", title: "Ordinary deal", account_id: ACC, stage: "qualify", outcome: "open", owner_id: "u1", team: [], amount: 0 },
      { id: OPP_NOACC, tenant_id: T1, ref: "OPP-3", title: "Tender without a client", account_id: null, stage: "estimating", outcome: "open", owner_id: "u1", team: [], amount: 0 },
    ],
    opportunity_tenders: [
      { opportunity_id: OPP, tenant_id: T1, tender_no: "ARB-1", reminders_sent: [], addenda_count: 0 },
      { opportunity_id: OPP_NOACC, tenant_id: T1, tender_no: "ARB-3", reminders_sent: [], addenda_count: 0 },
    ],
    estimates: [{ id: EST, tenant_id: T1, ref: "EST-0001", name: "Pipe run", status: "draft", opportunity_id: OPP, standard_quote_id: null }],
    rfqs: [
      { id: RFQ_TENDER, tenant_id: T1, ref: "RFQ-0001", title: "Tender RFQ", status: "draft", origin_type: "opportunity", origin_id: OPP, package_id: null },
      { id: RFQ_STD, tenant_id: T1, ref: "RFQ-0002", title: "Standard deal RFQ", status: "draft", origin_type: "opportunity", origin_id: OPP_STD, package_id: null },
      { id: RFQ_PKG, tenant_id: T1, ref: "RFQ-0003", title: "Buy-out round", status: "sent", origin_type: "manual", origin_id: null, package_id: PKG },
    ],
    contract_projects: [{ id: PRJ, tenant_id: T1, ref: "CPR-0001", name: "Plant 4", account_id: ACC, source_opportunity_id: OPP }],
    project_buyout_packages: [{ id: PKG, tenant_id: T1, project_id: PRJ, ref: "PKG-0001", name: "Pipes", status: "out" }],
    supplier_groups: [{ id: G_T2, tenant_id: T2, name: "Theirs", account_id: ACC_T2, active: true, note: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" }],
    supplier_group_members: [{ group_id: G_T2, supplier_id: S9, tenant_id: T2 }],
  });
  state.db.unique("supplier_groups", (a, b) => a.tenant_id === b.tenant_id && !!a.account_id && a.account_id === b.account_id);
  state.changes = [];
  state.user = { id: ME, email: "me@t1.test" };
  state.suppliersEdit = true; state.suppliersView = true;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("managing a group", () => {
  it("makes a group with its client and members, lists it with the client's name and the member count, and logs it", async () => {
    const made = await makeGroup({ note: "Approved 2026" });
    expect(made.status).toBe(201);
    expect(made.json.group).toMatchObject({ name: "Aramco approved vendors", account_id: ACC, account_name: "Aramco", note: "Approved 2026", active: true, member_count: 2 });
    expect(made.json.group.supplier_ids.sort()).toEqual([S1, S2].sort());
    const stored = rows("supplier_groups").find((g) => g.name === "Aramco approved vendors")!;
    expect(stored).toMatchObject({ tenant_id: T1, created_by: ME });
    expect(rows("supplier_group_members").filter((m) => m.group_id === stored.id).every((m) => m.tenant_id === T1)).toBe(true);
    const list = await body(await groupsGet());
    expect(list.groups.map((g: any) => g.name)).toEqual(["Aramco approved vendors"]);
    expect(list.can_edit).toBe(true);
    expect(logged()).toContain("supplier_groups: name");
    expect(logged()).toContain("supplier_groups: suppliers added");
  });

  it("refuses a missing name, another workspace's client or supplier, a second list for the same client, and a repeated name", async () => {
    expect((await makeGroup({ name: "" })).status).toBe(422);
    expect((await makeGroup({ account_id: ACC_T2 })).status).toBe(404);
    expect((await makeGroup({ supplier_ids: [S9] })).status).toBe(404);
    expect(rows("supplier_groups").filter((g) => g.tenant_id === T1)).toHaveLength(0); // nothing half-made is left behind
    expect((await makeGroup()).status).toBe(201);
    const second = await makeGroup({ name: "Other list" });
    expect(second.status).toBe(409);
    expect(second.json.error).toContain("Aramco approved vendors");
    const dup = await makeGroup({ name: "ARAMCO approved VENDORS", account_id: ACC2 });
    expect(dup.status).toBe(409);
    expect((await makeGroup({ name: "SABIC list", account_id: ACC2 })).status).toBe(201);
  });

  it("changes the name, the client and the active switch; replaces the members; and logs who was added and removed", async () => {
    const g = (await makeGroup()).json.group.id as string;
    const patched = await groupPatch(json("PATCH", { name: "Aramco list 2027", active: false, account_id: ACC2 }), ctx(g));
    expect(patched.status).toBe(200);
    expect((await body(patched)).group).toMatchObject({ name: "Aramco list 2027", active: false, account_id: ACC2, account_name: "SABIC" });
    const unlinked = await groupPatch(json("PATCH", { account_id: null }), ctx(g));
    expect((await body(unlinked)).group.account_id).toBeNull();
    const put = await membersPut(json("PUT", { supplier_ids: [S2, S3] }), ctx(g));
    expect(put.status).toBe(200);
    expect(await body(put)).toMatchObject({ ok: true, added: [S3], removed: [S1], member_count: 2 });
    expect(rows("supplier_group_members").filter((m) => m.group_id === g).map((m) => m.supplier_id).sort()).toEqual([S2, S3].sort());
    expect(logged()).toContain("supplier_groups: suppliers removed");
    expect((await membersPut(json("PUT", { supplier_ids: [S9] }), ctx(g))).status).toBe(404);
    expect((await membersPut(json("PUT", { supplier_ids: "S1" }), ctx(g))).status).toBe(422);
    expect((await membersPut(json("PUT", { supplier_ids: [] }), ctx(g))).status).toBe(200);
    expect(rows("supplier_group_members").filter((m) => m.group_id === g)).toHaveLength(0);
  });

  it("removes a group; another workspace's group is a 404 for every verb and is never touched", async () => {
    const g = (await makeGroup()).json.group.id as string;
    expect((await groupDelete(json("DELETE"), ctx(g))).status).toBe(200);
    expect(rows("supplier_groups").some((x) => x.id === g)).toBe(false);
    expect(logged()).toContain("supplier_groups: name");
    expect((await groupGet(json("GET"), ctx(G_T2))).status).toBe(404);
    expect((await groupPatch(json("PATCH", { name: "Mine now" }), ctx(G_T2))).status).toBe(404);
    expect((await membersPut(json("PUT", { supplier_ids: [S1] }), ctx(G_T2))).status).toBe(404);
    expect((await groupDelete(json("DELETE"), ctx(G_T2))).status).toBe(404);
    expect(rows("supplier_groups").find((x) => x.id === G_T2)).toMatchObject({ name: "Theirs" });
    expect(rows("supplier_group_members").filter((m) => m.group_id === G_T2)).toHaveLength(1);
  });

  it("is invisible without the tender edition or the Suppliers module, view-only for someone who cannot edit Suppliers, and tells a pending migration plainly", async () => {
    state.features.gcc_tender = false;
    expect((await groupsGet()).status).toBe(404);
    state.features.gcc_tender = true; state.features.suppliers = false;
    expect((await groupsGet()).status).toBe(404);
    state.features.suppliers = true;
    state.suppliersEdit = false;
    expect((await groupsGet()).status).toBe(200);
    expect((await makeGroup()).status).toBe(403);
    state.suppliersEdit = true; state.suppliersView = false;
    expect((await groupsGet()).status).toBe(404);
    state.suppliersView = true;
    state.db.missing.add("supplier_groups");
    const pending = await groupsGet();
    expect(await body(pending)).toMatchObject({ groups: [], pending: true });
    expect((await makeGroup()).status).toBe(503);
  });

  it("GET /api/suppliers?group= returns that group's members only", async () => {
    const g = (await makeGroup()).json.group.id as string;
    const only = await suppliersGet(new NextRequest(new URL(`http://internal.invalid/x?group=${g}`)));
    expect((await only.json() as { name: string }[]).map((s) => s.name).sort()).toEqual(["Desert Supply", "Gulf Pipes"]);
    expect((await (await suppliersGet(new NextRequest(new URL(`http://internal.invalid/x?group=${G_T2}`)))).json())).toEqual([]);
    expect((await (await suppliersGet(new NextRequest(new URL("http://internal.invalid/x?group=nope")))).json())).toEqual([]);
    expect((await (await suppliersGet(new NextRequest(new URL("http://internal.invalid/x")))).json() as unknown[]).length).toBe(4);
  });
});

describe("the Costing composer's supplier list", () => {
  const picker = async (deal = OPP) => { const r = await costingSuppliersGet(json("GET"), ctx(deal)); return { status: r.status, json: await body(r) }; };

  it("a client with an approved list gets only its members; a client without one gets every active supplier and a note-able restricted:false", async () => {
    const none = await picker();
    expect(none.status).toBe(200);
    expect(none.json).toMatchObject({ restricted: false, group: null, account: { id: ACC, name: "Aramco" } });
    expect(none.json.suppliers.map((s: any) => s.name)).toEqual(["Desert Supply", "Gulf Pipes", "Outside Co"]);
    await makeGroup();
    const r = await picker();
    expect(r.json).toMatchObject({ restricted: true, group: { name: "Aramco approved vendors" } });
    expect(r.json.suppliers.map((s: any) => s.name)).toEqual(["Desert Supply", "Gulf Pipes"]);
    expect((await picker(OPP_NOACC)).json).toMatchObject({ restricted: false, account: null });
  });

  it("is a 404 for a deal that is not a tender, one of another workspace, and a workspace without the edition", async () => {
    expect((await picker(OPP_STD)).status).toBe(404);
    expect((await picker(id(999))).status).toBe(404);
    state.features.gcc_tender = false;
    expect((await picker()).status).toBe(404);
  });
});

describe("the approved list is held at the server for a tender RFQ, and only there", () => {
  it("creating a tender deal's RFQ with a supplier outside the list is a 422 naming them; with listed suppliers it is created", async () => {
    await makeGroup();
    const refused = await tenderRfq([S1, S3]);
    expect(refused.status).toBe(422);
    expect(refused.json.error).toContain("Outside Co");
    expect(refused.json.error).toContain("Aramco approved vendors");
    expect(refused.json).toMatchObject({ code: "outside_approved_list", not_allowed: [{ supplier_id: S3, name: "Outside Co" }] });
    expect(rows("rfqs").filter((r) => r.title === "Pipe")).toHaveLength(0);
    const ok = await tenderRfq([S1, S2]);
    expect(ok.status).toBe(201);
    expect(rows("rfq_suppliers").filter((s) => s.rfq_id === ok.json.id).map((s) => s.supplier_id).sort()).toEqual([S1, S2].sort());
  });

  it("an RFQ for an estimate made for the tender deal is held to the same list", async () => {
    await makeGroup();
    const est = await rfqPost(json("POST", { origin_type: "estimate", origin_id: EST, lines: [{ description: "Adhesive", qty: 1 }], supplier_ids: [S3] }));
    expect(est.status).toBe(422);
  });

  it("with no list, an inactive list, or a tender without a client account, anyone may be asked", async () => {
    expect((await tenderRfq([S3])).status).toBe(201);
    const g = (await makeGroup()).json.group.id as string;
    await groupPatch(json("PATCH", { active: false }), ctx(g));
    expect((await tenderRfq([S3])).status).toBe(201);
    await groupPatch(json("PATCH", { active: true }), ctx(g));
    expect((await tenderRfq([S3])).status).toBe(422);
    expect((await tenderRfq([S3], { origin_id: OPP_NOACC })).status).toBe(201);
  });

  it("standard RFQs are unchanged: an ordinary deal of the same client, a manual RFQ, and any workspace without the tender edition", async () => {
    await makeGroup();
    expect((await tenderRfq([S3], { origin_id: OPP_STD })).status).toBe(201);
    const manual = await rfqPost(json("POST", { lines: [{ description: "Bolts", qty: 1 }], supplier_ids: [S3] }));
    expect(manual.status).toBe(201);
    state.features.gcc_tender = false;
    state.db.rows("tenants").find((t) => t.id === T1)!.features = state.features;
    expect((await tenderRfq([S3])).status).toBe(201);
  });

  it("adding suppliers to an existing tender RFQ or a buy-out round is held to the list; a standard RFQ is not", async () => {
    await makeGroup();
    const denied = await addSuppliers(RFQ_TENDER, [S3]);
    expect(denied.status).toBe(422);
    expect(denied.json.error).toContain("Outside Co");
    expect(rows("rfq_suppliers").filter((s) => s.rfq_id === RFQ_TENDER)).toHaveLength(0);
    expect((await addSuppliers(RFQ_PKG, [S3])).status).toBe(422);
    expect((await addSuppliers(RFQ_TENDER, [S2])).status).toBe(200);
    expect((await addSuppliers(RFQ_PKG, [S1])).status).toBe(200);
    expect((await addSuppliers(RFQ_STD, [S3])).status).toBe(200);
  });

  it("another workspace's group never restricts this workspace, and this workspace's never reaches theirs", async () => {
    rows("supplier_groups").push({ id: id(52), tenant_id: T2, name: "Also theirs", account_id: ACC, active: true });
    rows("supplier_group_members").push({ group_id: id(52), supplier_id: S9, tenant_id: T2 });
    expect((await tenderRfq([S3])).status).toBe(201);
  });
});
