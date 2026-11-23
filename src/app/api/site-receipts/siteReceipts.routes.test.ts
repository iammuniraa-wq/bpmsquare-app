import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDb } from "@/lib/inbox/testing/memoryDb";

// Site receipts against an in-memory database: the phone's idempotent create with its count and photos, the required reasons and photos, every
// foreign id verified against the workspace, the computed outcome (never read from the body), who may cancel, and received value per package.

const state = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  user: { id: "u-site", email: "site@t1.test" },
  role: "member" as "admin" | "member",
  changes: [] as { objectType: string; objectId: string; action: string; changes?: { field: string; from: unknown; to: unknown }[] }[],
}));

const T1 = "t1";
const T2 = "t2";
const SITE = "11111111-1111-4111-8111-111111111111";
const PM = "22222222-2222-4222-8222-222222222222";
const COST = "33333333-3333-4333-8333-333333333333";
const OTHER = "55555555-5555-4555-8555-555555555555";
const P1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const P_T2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const K1 = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const K_T2 = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2";
const PKG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const PKG_T2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const cid = (n: number) => `eeeeeeee-eeee-4eee-8eee-${String(n).padStart(12, "0")}`;

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => state.db,
  getAuthUser: async () => state.user,
  requireTenantUser: async () => ({ tenantId: T1, userId: state.user.id, role: state.role, supabase: {} }),
}));
vi.mock("@/lib/changeLog", () => ({
  diffForLog: (_t: string, b: Record<string, unknown>, a: Record<string, unknown>) => Object.entries(a).filter(([k, v]) => JSON.stringify(b[k] ?? null) !== JSON.stringify(v ?? null)).map(([field, to]) => ({ field, from: b[field] ?? null, to })),
  logChange: async (_c: unknown, p: (typeof state.changes)[number]) => { state.changes.push(p); },
}));

import { NextRequest } from "next/server";
import { GET as listGet, POST as createPost } from "./route";
import { GET as oneGet } from "./[id]/route";
import { POST as cancelPost } from "./[id]/cancel/route";
import { loadReceivedValues } from "@/lib/site/receiptsServer";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1]);
const photo = () => new File([JPEG], "p.jpg", { type: "image/jpeg" });
const form = (payload: Record<string, unknown>, photos: File[] = []) => {
  const f = new FormData();
  f.append("payload", JSON.stringify(payload));
  for (const p of photos) f.append("photos", p);
  return new NextRequest(new URL("http://internal.invalid/api/site-receipts"), { method: "POST", body: f });
};
const json = (method: string, body?: unknown) => new NextRequest(new URL("http://internal.invalid/x"), { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const as = (id: string, role: "admin" | "member" = "member") => { state.user = { id, email: `${id.slice(0, 2)}@t1.test` }; state.role = role; };
const receipts = () => state.db.rows("site_receipts");
const line = (over: Record<string, unknown> = {}) => ({ description: "Hollow-core slab", element_code: "HCS-B2-014", building: "B2", qty_expected: 8, qty_received: 8, ...over });
const valid = (n: number, lines: unknown[] = [line()], over: Record<string, unknown> = {}) => ({ client_id: cid(n), project_id: P1, delivery_note_ref: "DN-24817", handed_by: "Faisal", vehicle: "4417", lines, ...over });

beforeEach(() => {
  const features = { contract_projects: true, site_expenses: true, site_receipts: true };
  state.db = new MemoryDb({
    tenants: [{ id: T1, slug: "pcbs", name: "PCBS", is_demo: false, features, config: { tender: { approvers: [COST] }, site: { notify_receipts: [COST] } }, custom_domain: null }, { id: T2, slug: "other", name: "Other", is_demo: false, features, config: {}, custom_domain: null }],
    tenant_users: [{ tenant_id: T1, user_id: SITE, role: "member" }, { tenant_id: T1, user_id: PM, role: "member" }, { tenant_id: T1, user_id: COST, role: "member" }, { tenant_id: T2, user_id: OTHER, role: "admin" }],
    contract_projects: [
      { id: P1, tenant_id: T1, ref: "CPR-0001", name: "Al-Noor Phase 2", status: "active", currency: "SAR", manager_id: PM, site_entry: true },
      { id: P_T2, tenant_id: T2, ref: "CPR-0001", name: "Other tenant", status: "active", currency: "SAR", manager_id: OTHER, site_entry: true },
    ],
    project_budget_lines: [
      { id: "l1", tenant_id: T1, project_id: P1, revision_id: "rev1", line_key: K1, line_no: 1, description: "Hollow-core slab", qty: 10, unit: "pcs" },
      { id: "l2", tenant_id: T2, project_id: P_T2, revision_id: "rev2", line_key: K_T2, line_no: 1, description: "Other", qty: 1, unit: "pcs" },
    ],
    project_buyout_packages: [
      { id: PKG, tenant_id: T1, project_id: P1, ref: "PKG-0001", name: "Slabs", status: "awarded", awarded_rfq_id: "rfq1", awarded_supplier_id: null, committed_amount: 1000, currency: "SAR", created_at: "2026-11-01T00:00:00Z" },
      { id: PKG_T2, tenant_id: T2, project_id: P_T2, ref: "PKG-0001", name: "Other", status: "awarded", created_at: "2026-11-01T00:00:00Z" },
    ],
    project_buyout_package_lines: [{ id: "pl1", tenant_id: T1, project_id: P1, package_id: PKG, line_key: K1, sort_order: 0 }],
    rfqs: [{ id: "rfq1", tenant_id: T1, ref: "RFQ-1", status: "awarded", package_id: PKG, created_at: "2026-11-02T00:00:00Z" }],
    rfq_lines: [{ id: "rl1", tenant_id: T1, rfq_id: "rfq1", sl_no: 1, qty: 10, status: "awarded", package_line_id: "pl1", description: "Slab", uom: "pcs", awarded_unit_cost: 100 }],
    rfq_suppliers: [],
  });
  state.db.users.set(PM, { email: "pm@t1.test" });
  state.db.users.set(COST, { email: "cost@t1.test" });
  state.db.unique("site_receipts", (e, i) => e.tenant_id === i.tenant_id && e.client_id === i.client_id);
  state.changes = [];
  as(SITE);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("create", () => {
  it("a clean delivery is Complete, numbered SRC-, with its items and the session user as the receiver", async () => {
    const res = await createPost(form(valid(1, [line({ line_key: K1 })])));
    expect(res.status).toBe(201);
    expect(receipts()[0]).toMatchObject({ tenant_id: T1, ref: "SRC-0001", status: "confirmed", outcome: "complete", received_by: SITE, project_id: P1 });
    expect(state.db.rows("site_receipt_lines")).toHaveLength(1);
    expect(state.db.rows("site_receipt_lines")[0]).toMatchObject({ qty_accepted: 8, qty_rejected: 0, element_code: "HCS-B2-014", tenant_id: T1 });
    expect(state.changes[0]).toMatchObject({ objectType: "site_receipts", action: "create" });
  });

  it("is idempotent on the capture id and refuses another person's", async () => {
    expect((await createPost(form(valid(2)))).status).toBe(201);
    const again = await createPost(form(valid(2)));
    expect(again.status).toBe(200);
    expect(receipts()).toHaveLength(1);
    as(PM);
    expect((await createPost(form(valid(2)))).status).toBe(409);
  });

  it("the outcome is computed from the lines, never taken from the body", async () => {
    await createPost(form(valid(3, [line({ qty_received: 6, reason_code: "not_delivered" })], { outcome: "complete", status: "cancelled", received_by: PM })));
    expect(receipts()[0]).toMatchObject({ outcome: "partial", status: "confirmed", received_by: SITE });
  });

  it("needs a reason for anything short, damaged or rejected, and a photo for rejected or damaged pieces", async () => {
    expect((await createPost(form(valid(4, [line({ qty_received: 6 })])))).status).toBe(422);
    expect((await createPost(form(valid(5, [line({ qty_accepted: 0, qty_rejected: 8, reason_code: "wrong_element" })])))).status).toBe(422);
    const ok = await createPost(form(valid(6, [line({ qty_accepted: 0, qty_rejected: 8, reason_code: "wrong_element" })]), [photo()]));
    expect(ok.status).toBe(201);
    expect(receipts()[0].outcome).toBe("rejected");
    expect(state.db.rows("site_files")).toHaveLength(1);
    expect(state.db.rows("site_files")[0].object_type).toBe("site_receipt");
  });

  it("accepted plus rejected must equal what arrived", async () => {
    expect((await createPost(form(valid(7, [line({ qty_accepted: 5, qty_rejected: 1, reason_code: "cracked" })]), [photo()]))).status).toBe(422);
  });

  it("works with no element code at all (the element master may not exist yet)", async () => {
    const res = await createPost(form(valid(8, [{ description: "Loose item", qty_received: 3 }])));
    expect(res.status).toBe(201);
    expect(state.db.rows("site_receipt_lines")[0]).toMatchObject({ element_code: null, building: null, line_key: null });
  });

  it("refuses another workspace's project, package and budget line", async () => {
    expect((await createPost(form(valid(9, [line()], { project_id: P_T2 })))).status).toBe(422);
    expect((await createPost(form(valid(10, [line()], { package_id: PKG_T2 })))).status).toBe(422);
    expect((await createPost(form(valid(11, [line({ line_key: K_T2 })])))).status).toBe(422);
    expect((await createPost(form(valid(12, [line({ line_key: K1 })], { package_id: PKG })))).status).toBe(201);
    expect(receipts()).toHaveLength(1);
  });

  it("a delivery with a problem tells the project manager and the people chosen in Settings", async () => {
    await createPost(form(valid(13, [line({ qty_received: 6, reason_code: "not_delivered" })])));
    const notes = state.db.rows("record_comments");
    expect(notes.length).toBeGreaterThan(0);
    expect(notes[0]).toMatchObject({ tenant_id: T1, object_type: "contract_projects", object_id: P1 });
    expect((notes[0].mentions as string[]).sort()).toEqual(["cost@t1.test", "pm@t1.test"]);
  });

  it("module off is a plain 404; a missing table says a database update is needed", async () => {
    state.db.rows("tenants")[0].features = { contract_projects: true, site_receipts: false };
    expect((await createPost(form(valid(14)))).status).toBe(404);
    state.db.rows("tenants")[0].features = { contract_projects: true, site_receipts: true };
    state.db.missing.add("site_receipts");
    expect((await createPost(form(valid(15)))).status).toBe(503);
  });
});

describe("cancel and read", () => {
  const make = async (n = 20) => (await (await createPost(form(valid(n)))).json()).receipt.id as string;

  it("a site person cannot cancel; the project manager can, with a reason, and the receipt stays", async () => {
    const id = await make();
    expect((await cancelPost(json("POST", { reason: "Wrong truck" }), ctx(id))).status).toBe(403);
    as(PM);
    expect((await cancelPost(json("POST", {}), ctx(id))).status).toBe(422);
    expect((await cancelPost(json("POST", { reason: "Wrong truck" }), ctx(id))).status).toBe(200);
    expect(receipts()[0]).toMatchObject({ status: "cancelled", cancel_reason: "Wrong truck", cancelled_by: PM });
    expect((await cancelPost(json("POST", { reason: "Again please" }), ctx(id))).status).toBe(409);
  });

  it("another workspace's receipt id is a plain 404", async () => {
    const id = await make();
    receipts()[0].tenant_id = T2;
    expect((await oneGet(json("GET"), ctx(id))).status).toBe(404);
    expect((await cancelPost(json("POST", { reason: "Wrong truck" }), ctx(id))).status).toBe(404);
  });

  it("lists the receipts of the workspace only", async () => {
    await make(21);
    receipts().push({ id: "foreign", tenant_id: T2, ref: "SRC-0001", project_id: P_T2, status: "confirmed", outcome: "complete", received_at: new Date().toISOString(), received_by: OTHER });
    const rows = (await (await listGet(new NextRequest("http://x/api/site-receipts"))).json()).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].tenant_id).toBe(T1);
  });
});

describe("received value per buy-out package", () => {
  it("is the accepted quantity times the awarded rate; a cancelled receipt counts for nothing", async () => {
    await createPost(form(valid(30, [line({ line_key: K1, qty_received: 6, reason_code: "not_delivered" })], { package_id: PKG })));
    const second = (await (await createPost(form(valid(31, [line({ line_key: K1, qty_expected: 2, qty_received: 2 })], { package_id: PKG })))).json()).receipt.id as string;
    let rows = await loadReceivedValues(state.db as never, T1, P1);
    expect(rows[0]).toMatchObject({ committed: 1000, received_value: 800, still_to_receive: 200 });
    as(PM);
    await cancelPost(json("POST", { reason: "Counted twice" }), ctx(second));
    rows = await loadReceivedValues(state.db as never, T1, P1);
    expect(rows[0]).toMatchObject({ received_value: 600, still_to_receive: 400 });
  });
});
