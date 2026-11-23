import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDb } from "@/lib/inbox/testing/memoryDb";

// Site expenses against an in-memory database: the phone's idempotent create (with its photos), every foreign id verified against the workspace,
// who may approve (the project manager within the limit, a cost approver above it, never the person who entered it), the allowlists, who may
// see an expense, the register, and a pending migration. The question behind each: if a tenant-A user sent this with a tenant-B id, what stops it?

const state = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  user: { id: "u-site", email: "site@t1.test" },
  role: "member" as "admin" | "member",
  changes: [] as { objectType: string; objectId: string; action: string; changes?: { field: string; from: unknown; to: unknown }[] }[],
}));

const T1 = "t1";
const T2 = "t2";
const SITE = "11111111-1111-4111-8111-111111111111";
const SITE2 = "11111111-1111-4111-8111-111111111112";
const PM = "22222222-2222-4222-8222-222222222222";
const COST = "33333333-3333-4333-8333-333333333333";
const ADMIN = "44444444-4444-4444-8444-444444444444";
const OTHER = "55555555-5555-4555-8555-555555555555";
const P1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const P_T2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const P_OFF = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const C1 = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const C_T2 = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const K1 = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const K_T2 = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2";
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
import { GET as oneGet, PATCH as onePatch } from "./[id]/route";
import { POST as approvePost } from "./[id]/approve/route";
import { POST as rejectPost } from "./[id]/reject/route";
import { POST as cancelPost } from "./[id]/cancel/route";
import { GET as registerGet, POST as registerPost } from "./register/route";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1]);
const photo = (name = "r.jpg") => new File([JPEG], name, { type: "image/jpeg" });
const form = (payload: Record<string, unknown>, photos: File[] = [photo()]) => {
  const f = new FormData();
  f.append("payload", JSON.stringify(payload));
  for (const p of photos) f.append("photos", p);
  return new NextRequest(new URL("http://internal.invalid/api/site-expenses"), { method: "POST", body: f });
};
const json = (method: string, body?: unknown) => new NextRequest(new URL("http://internal.invalid/x"), { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const today = new Date().toISOString().slice(0, 10);
const valid = (n: number, over: Record<string, unknown> = {}) => ({ client_id: cid(n), project_id: P1, category_id: C1, expense_date: today, amount: 412.85, vendor_text: "Eastern Crane Rental", ...over });
const as = (id: string, role: "admin" | "member" = "member") => { state.user = { id, email: `${id.slice(0, 2)}@t1.test` }; state.role = role; };
const expenses = () => state.db.rows("site_expenses");

beforeEach(() => {
  const features = { contract_projects: true, site_expenses: true, site_receipts: true };
  state.db = new MemoryDb({
    tenants: [{ id: T1, slug: "pcbs", name: "PCBS", is_demo: false, features, config: { tender: { approvers: [COST] }, site: { pm_limit: 1000 } }, custom_domain: "pcbs.example.com" }, { id: T2, slug: "other", name: "Other", is_demo: false, features, config: {}, custom_domain: null }],
    tenant_users: [
      { tenant_id: T1, user_id: SITE, role: "member" }, { tenant_id: T1, user_id: SITE2, role: "member" }, { tenant_id: T1, user_id: PM, role: "member" },
      { tenant_id: T1, user_id: COST, role: "member" }, { tenant_id: T1, user_id: ADMIN, role: "admin" }, { tenant_id: T2, user_id: OTHER, role: "admin" },
    ],
    contract_projects: [
      { id: P1, tenant_id: T1, ref: "CPR-0001", name: "Al-Noor Phase 2", status: "active", currency: "SAR", manager_id: PM, site_entry: true },
      { id: P_OFF, tenant_id: T1, ref: "CPR-0002", name: "Switched off", status: "active", currency: "SAR", manager_id: PM, site_entry: false },
      { id: P_T2, tenant_id: T2, ref: "CPR-0001", name: "Other tenant", status: "active", currency: "SAR", manager_id: OTHER, site_entry: true },
    ],
    site_expense_categories: [
      { id: C1, tenant_id: T1, name: "Equipment rental", resource_code: "21", limit_amount: null, active: true, sort_order: 0 },
      { id: C_T2, tenant_id: T2, name: "Equipment rental", resource_code: "21", limit_amount: null, active: true, sort_order: 0 },
    ],
    project_budget_revisions: [{ id: "rev1", tenant_id: T1, project_id: P1, rev_no: 0, status: "approved", total: 100000 }],
    project_budget_lines: [
      { id: "l1", tenant_id: T1, project_id: P1, revision_id: "rev1", line_key: K1, line_no: 1, description: "Crane hire, Building B", amount: 180000, committed: null, actual: null, reserve: false },
      { id: "l2", tenant_id: T2, project_id: P_T2, revision_id: "rev2", line_key: K_T2, line_no: 1, description: "Other tenant line", amount: 1, committed: null, actual: null, reserve: false },
    ],
  });
  state.db.unique("site_expenses", (e, i) => e.tenant_id === i.tenant_id && e.client_id === i.client_id);
  state.changes = [];
  as(SITE);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("create", () => {
  it("makes a SEX- expense with its photo in the workspace's folder, stamped with the session user, and logs it", async () => {
    const res = await createPost(form(valid(1)));
    expect(res.status).toBe(201);
    const row = expenses()[0];
    expect(row).toMatchObject({ tenant_id: T1, status: "submitted", submitted_by: SITE, ref: "SEX-0001", project_id: P1, amount: 412.85, currency: "SAR", amount_project_ccy: 412.85 });
    const files = state.db.rows("site_files");
    expect(files).toHaveLength(1);
    expect(String(files[0].storage_path).startsWith(`${T1}/site_expense/${row.id}/`)).toBe(true);
    expect(state.db.objectsIn("site-evidence")).toHaveLength(1);
    expect(state.changes[0]).toMatchObject({ objectType: "site_expenses", action: "create" });
  });

  it("sending the same capture twice (the offline queue) makes one expense", async () => {
    expect((await createPost(form(valid(2)))).status).toBe(201);
    const again = await createPost(form(valid(2)));
    expect(again.status).toBe(200);
    expect((await again.json()).duplicate_request).toBe(true);
    expect(expenses()).toHaveLength(1);
    expect(state.db.rows("site_files")).toHaveLength(1);
  });

  it("another person's capture id is a conflict, never their record", async () => {
    await createPost(form(valid(3)));
    as(SITE2);
    expect((await createPost(form(valid(3)))).status).toBe(409);
  });

  it("refuses another workspace's project, category and cost line, and a project with Site entry off", async () => {
    expect((await createPost(form(valid(4, { project_id: P_T2 })))).status).toBe(422);
    expect((await createPost(form(valid(5, { project_id: P_OFF })))).status).toBe(422);
    expect((await createPost(form(valid(6, { category_id: C_T2 })))).status).toBe(422);
    expect((await createPost(form(valid(7, { line_key: K_T2 })))).status).toBe(422);
    expect((await createPost(form(valid(8, { line_key: K1 })))).status).toBe(201);
    expect(expenses()).toHaveLength(1);
  });

  it("needs the photo unless the invoice is to follow, and reads a file by its bytes, not its name", async () => {
    expect((await createPost(form(valid(9), []))).status).toBe(422);
    expect((await createPost(form(valid(10, { document_state: "invoice_to_follow" }), []))).status).toBe(201);
    const fake = new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], "receipt.jpg", { type: "image/jpeg" });
    expect((await createPost(form(valid(11), [fake]))).status).toBe(422);
  });

  it("never reads the tenant, status, submitter or ERP state from the body", async () => {
    await createPost(form(valid(12, { tenant_id: T2, status: "approved", submitted_by: PM, erp_state: "posted", posted_amount: 1, approved_by: PM })));
    expect(expenses()[0]).toMatchObject({ tenant_id: T1, status: "submitted", submitted_by: SITE, erp_state: "not_sent" });
    expect(expenses()[0].posted_amount ?? null).toBeNull();
  });

  it("warns, and never blocks, on a duplicate and an amount over the limit", async () => {
    await createPost(form(valid(13)));
    const r = await createPost(form(valid(14, { amount: 412.85 }), [photo("again.jpg")]));
    expect(r.status).toBe(201);
    expect(expenses()[1].flags).toContain("duplicate");
    await createPost(form(valid(15, { amount: 5000, vendor_text: "Other vendor" })));
    expect(expenses()[2].flags).toEqual(expect.arrayContaining(["over_limit"]));
  });

  it("module off for the workspace is a plain 404, and a missing table says a database update is needed", async () => {
    state.db.rows("tenants")[0].features = { contract_projects: true, site_expenses: false };
    expect((await createPost(form(valid(16)))).status).toBe(404);
    state.db.rows("tenants")[0].features = { contract_projects: true, site_expenses: true };
    state.db.missing.add("site_expenses");
    const res = await createPost(form(valid(17)));
    expect(res.status).toBe(503);
    expect((await res.json()).needsDatabaseUpdate).toBe(true);
  });
});

describe("who may decide", () => {
  const make = async (n = 20, over: Record<string, unknown> = {}) => {
    as(SITE);
    const r = await createPost(form(valid(n, over)));
    return (await r.json()).expense.id as string;
  };

  it("the project manager approves within the limit; it then counts as recorded and the line's Actual is untouched", async () => {
    const id = await make();
    as(PM);
    const res = await approvePost(json("POST", { line_key: K1 }), ctx(id));
    expect(res.status).toBe(200);
    expect(expenses()[0]).toMatchObject({ status: "approved", approved_by: PM, line_key: K1 });
    expect(state.db.rows("project_budget_lines").find((l) => l.line_key === K1)?.actual).toBeNull();
  });

  it("the person who entered it cannot approve it, nor a colleague who may not see it", async () => {
    const id = await make();
    expect((await approvePost(json("POST", {}), ctx(id))).status).toBe(403);
    as(SITE2);
    expect((await approvePost(json("POST", {}), ctx(id))).status).toBe(404);
    expect(expenses()[0].status).toBe("submitted");
  });

  it("above the manager's limit only a cost approver may; an admin always may", async () => {
    const id = await make(21, { amount: 5000 });
    as(PM);
    expect((await approvePost(json("POST", {}), ctx(id))).status).toBe(403);
    as(COST);
    expect((await approvePost(json("POST", {}), ctx(id))).status).toBe(200);
    const id2 = await make(22, { amount: 6000, vendor_text: "x" });
    as(ADMIN, "admin");
    expect((await approvePost(json("POST", {}), ctx(id2))).status).toBe(200);
  });

  it("a manager's own expense needs another approver; the workspace switch allows self-approval", async () => {
    as(PM);
    const id = (await (await createPost(form(valid(23)))).json()).expense.id as string;
    expect((await approvePost(json("POST", {}), ctx(id))).status).toBe(403);
    state.db.rows("tenants")[0].config = { tender: { approvers: [COST], allow_self_approval: true }, site: { pm_limit: 1000 } };
    expect((await approvePost(json("POST", {}), ctx(id))).status).toBe(200);
  });

  it("a foreign-currency expense needs the project-currency amount from the approver", async () => {
    const id = await make(24, { currency: "USD", amount: 100 });
    as(PM);
    expect((await approvePost(json("POST", {}), ctx(id))).status).toBe(422);
    expect((await approvePost(json("POST", { amount_project_ccy: 375 }), ctx(id))).status).toBe(200);
    expect(expenses()[0]).toMatchObject({ status: "approved", amount_project_ccy: 375 });
  });

  it("the approver cannot set a line of another workspace", async () => {
    const id = await make(25);
    as(PM);
    expect((await approvePost(json("POST", { line_key: K_T2 }), ctx(id))).status).toBe(422);
  });

  it("returning needs a reason; the person then corrects it and sends it again; nothing but the allowlisted fields changes", async () => {
    const id = await make(26);
    as(PM);
    expect((await rejectPost(json("POST", { reason: "no" }), ctx(id))).status).toBe(422);
    expect((await rejectPost(json("POST", { reason: "Wrong job, please check" }), ctx(id))).status).toBe(200);
    expect(expenses()[0]).toMatchObject({ status: "rejected", reject_reason: "Wrong job, please check" });
    as(SITE);
    const res = await onePatch(json("PATCH", { amount: 400, note: "Fixed", status: "approved", tenant_id: T2, submitted_by: PM, erp_state: "posted", project_id: P_OFF }), ctx(id));
    expect(res.status).toBe(200);
    expect(expenses()[0]).toMatchObject({ status: "submitted", amount: 400, note: "Fixed", tenant_id: T1, submitted_by: SITE, erp_state: "not_sent", project_id: P1 });
    expect(expenses()[0].reject_reason).toBeNull();
  });

  it("an approved expense cannot be edited, and only custom fields (cf_) pass through PATCH for a manager", async () => {
    const id = await make(27);
    as(PM);
    await approvePost(json("POST", {}), ctx(id));
    as(SITE);
    expect((await onePatch(json("PATCH", { amount: 1 }), ctx(id))).status).toBe(409);
    as(PM);
    expect((await onePatch(json("PATCH", { custom_data: { cf_site: "B2", evil: "x" } }), ctx(id))).status).toBe(200);
    expect(expenses()[0].custom_data).toEqual({ cf_site: "B2" });
    expect(expenses()[0].amount).toBe(412.85);
  });

  it("cancel: the submitter while it waits; a decider with a reason until the ERP has it", async () => {
    const id = await make(28);
    expect((await cancelPost(json("POST", {}), ctx(id))).status).toBe(200);
    const id2 = await make(29, { vendor_text: "y" });
    as(PM);
    await approvePost(json("POST", {}), ctx(id2));
    expect((await cancelPost(json("POST", {}), ctx(id2))).status).toBe(422);
    expect((await cancelPost(json("POST", { reason: "Entered on the wrong project" }), ctx(id2))).status).toBe(200);
    expenses().find((e) => e.id === id2)!.status = "approved";
    expenses().find((e) => e.id === id2)!.erp_state = "sent";
    expect((await cancelPost(json("POST", { reason: "Too late for this" }), ctx(id2))).status).toBe(409);
  });
});

describe("who sees what", () => {
  it("a site person sees their own expenses and no budget figure; the manager sees the project's; another workspace sees nothing", async () => {
    const id = (await (await createPost(form(valid(30, { line_key: K1 })))).json()).expense.id as string;
    as(SITE2);
    await createPost(form(valid(31, { vendor_text: "Mine", amount: 90 })));
    expect((await (await listGet(new NextRequest("http://x/api/site-expenses"))).json()).rows).toHaveLength(1);
    expect((await oneGet(json("GET"), ctx(id))).status).toBe(404);
    as(SITE);
    const mine = await (await oneGet(json("GET"), ctx(id))).json();
    expect(mine.standing).toBeNull();
    expect(mine.can_see_budget).toBe(false);
    as(PM);
    expect((await (await listGet(new NextRequest("http://x/api/site-expenses"))).json()).rows).toHaveLength(2);
    const seen = await (await oneGet(json("GET"), ctx(id))).json();
    expect(seen.standing).toMatchObject({ budget: 180000, label: "Crane hire, Building B" });
  });

  it("a user of another workspace cannot reach this workspace's expense by id", async () => {
    const id = (await (await createPost(form(valid(32)))).json()).expense.id as string;
    state.db.rows("site_expenses").find((e) => e.id === id)!.tenant_id = T2;
    as(ADMIN, "admin");
    expect((await oneGet(json("GET"), ctx(id))).status).toBe(404);
  });
});

describe("the register for finance", () => {
  it("is for cost approvers only, lists approved expenses, and marking sent changes nothing else", async () => {
    as(SITE);
    const id = (await (await createPost(form(valid(40)))).json()).expense.id as string;
    expect((await registerGet(new NextRequest("http://x/api/site-expenses/register"))).status).toBe(403);
    as(PM);
    await approvePost(json("POST", {}), ctx(id));
    expect((await registerGet(new NextRequest("http://x/api/site-expenses/register"))).status).toBe(403);
    as(COST);
    const file = await registerGet(new NextRequest("http://x/api/site-expenses/register"));
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toContain("spreadsheetml");
    expect((await registerPost(json("POST", { ids: [] }))).status).toBe(400);
    expect((await (await registerPost(json("POST", { ids: [id] }))).json()).marked).toBe(1);
    expect(expenses()[0]).toMatchObject({ erp_state: "sent", status: "approved", amount: 412.85 });
    expect((await (await registerPost(json("POST", { ids: [id] }))).json()).marked).toBe(0);
  });

  it("never marks a waiting expense as sent", async () => {
    as(SITE);
    const id = (await (await createPost(form(valid(41)))).json()).expense.id as string;
    as(COST);
    expect((await (await registerPost(json("POST", { ids: [id] }))).json()).marked).toBe(0);
    expect(expenses()[0].erp_state).toBe("not_sent");
  });
});
