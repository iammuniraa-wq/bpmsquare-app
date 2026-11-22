import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDb } from "@/lib/inbox/testing/memoryDb";

// Won quote to contract project (docs/design/won-quote-to-project.md), against an in-memory database: an accepted standard quote, a won
// quotation and an estimate each become a project, once; another workspace's ids, a quote that is not accepted and the migration still
// pending are refused; and the screens that belong to a tender (Buy-out, the tender's costs, winning-bid payment terms) stay off for it.

const state = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  features: {} as Record<string, boolean>,
  touched: [] as string[],
  changes: [] as { objectType: string; objectId: string; action: string; changes?: { field: string; from: unknown; to: unknown }[] }[],
  user: { id: "u1", email: "me@t1.test" },
  role: "member" as "admin" | "member",
  view: true,
  edit: true,
  seq: 0,
}));

const T1 = "00000000-0000-4000-8000-0000000000a1";
const T2 = "00000000-0000-4000-8000-0000000000a2";
const ASKER = "11111111-1111-4111-8111-111111111111";
const BOSS = "22222222-2222-4222-8222-222222222222";
const OTHER_USER = "99999999-9999-4999-8999-999999999999";
const ACC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const ACC_T2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const DEAL = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const DEAL_T2 = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const TENDER = "cccccccc-cccc-4ccc-8ccc-ccccccccccc4";
const SQ = "51000000-0000-4000-8000-000000000001";
const SQ_SENT = "51000000-0000-4000-8000-000000000002";
const SQ_T2 = "51000000-0000-4000-8000-000000000003";
const SQ_FROM_EST = "51000000-0000-4000-8000-000000000004";
const QN = "52000000-0000-4000-8000-000000000001";
const QN_OPEN = "52000000-0000-4000-8000-000000000002";
const QN_OLD = "52000000-0000-4000-8000-000000000003";
const EST = "53000000-0000-4000-8000-000000000001";
const EST_NO_QUOTE = "53000000-0000-4000-8000-000000000002";
const EST_T2 = "53000000-0000-4000-8000-000000000003";

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => ({ from: (t: string) => { state.touched.push(t); return state.db.from(t); }, auth: state.db.auth }),
  getAuthUser: async () => state.user,
  requireTenantUser: async () => ({ tenantId: T1, userId: state.user.id, role: state.role, supabase: {} }),
}));
vi.mock("@/lib/tenant", () => ({
  tenantHasFeature: async (_s: unknown, _t: string, key: string) => !!state.features[key],
  getTenant: async () => ({ config: {}, features: state.features }),
}));
vi.mock("@/lib/permissions", () => ({
  resolvePermissions: async () => ({}),
  canViewWorkcenter: () => state.view,
  canEditWorkcenter: () => state.edit,
}));
vi.mock("@/lib/changeLog", () => ({
  diffForLog: (_t: string, b: Record<string, unknown>, a: Record<string, unknown>) =>
    Object.entries(a).filter(([k, v]) => JSON.stringify(b[k] ?? null) !== JSON.stringify(v ?? null)).map(([field, to]) => ({ field, from: b[field] ?? null, to })),
  logChange: async (_c: unknown, p: (typeof state.changes)[number]) => { state.changes.push(p); },
}));
vi.mock("@/lib/masterRef", () => ({
  insertWithMasterRef: async (admin: { from: (t: string) => { insert: (r: Record<string, unknown>) => { select: (s: string) => { single: () => Promise<unknown> } } } }, table: string, _tid: string, record: Record<string, unknown>, select: string) => {
    const ref = `CPR-${String(++state.seq).padStart(4, "0")}`;
    const now = new Date().toISOString();
    return admin.from(table).insert({ ...record, ref, created_at: now, updated_at: now }).select(select).single();
  },
}));

import { NextRequest } from "next/server";
import { GET as listGet, POST as createPost } from "./route";
import { GET as oneGet } from "./[id]/route";
import { GET as buyoutGet } from "./[id]/buyout/route";
import { POST as fillPost } from "./[id]/allocation/fill/route";
import { POST as copyTerms } from "./[id]/milestones/copy-terms/route";

const json = (method: string, body?: unknown) => new NextRequest(new URL("http://internal.invalid/x"), { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const get = () => new NextRequest(new URL("http://internal.invalid/x"));
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const rows = (t: string) => state.db.rows(t);
const mine = (t: string) => rows(t).filter((r) => r.tenant_id === T1);
const NEW_TABLES = ["contract_projects", "project_budget_revisions", "project_budget_lines"];

function seed() {
  return new MemoryDb({
    tenants: [{ id: T1, slug: "pcbs", name: "PCBS", is_demo: false, config: {}, custom_domain: null }, { id: T2, slug: "other", name: "Other", is_demo: false, config: {}, custom_domain: null }],
    tenant_users: [{ tenant_id: T1, user_id: ASKER, role: "member" }, { tenant_id: T1, user_id: BOSS, role: "admin" }, { tenant_id: T2, user_id: OTHER_USER, role: "admin" }],
    accounts: [{ id: ACC, tenant_id: T1, name: "Acme Precast" }, { id: ACC_T2, tenant_id: T2, name: "Other client" }],
    opportunities: [
      { id: DEAL, tenant_id: T1, ref: "OPP-1", title: "Acme walls", account_id: ACC, stage: "won", outcome: "won", amount: 1000, currency: "SAR" },
      { id: DEAL_T2, tenant_id: T2, ref: "OPP-9", title: "Theirs", account_id: ACC_T2, stage: "won", outcome: "won", amount: 1, currency: "SAR" },
      { id: TENDER, tenant_id: T1, ref: "OPP-4", title: "A tender", account_id: ACC, stage: "awarded", outcome: "won", amount: 5000, currency: "SAR" },
    ],
    opportunity_lines: [{ id: "tl1", tenant_id: T1, opportunity_id: TENDER, sl_no: "1", description: "Fence", uom: "m", qty: 10, rate: 10, discount_pct: 0, amount: 100, is_selected: true, break_of: null }],
    opportunity_tenders: [{ opportunity_id: TENDER, tenant_id: T1, tender_no: "T-1", issuer_name: "Acme", portal: "email", bond_status: "held", reminders_sent: [], addenda_count: 0 }],
    standard_quotes: [
      // subtotal 1000 + header discount + 15 % tax + shipping: the contract value is the subtotal.
      { id: SQ, tenant_id: T1, ref: "SQ-0041", account_id: ACC, status: "accepted", opportunity_id: DEAL, subtotal: 1000, total: 1205, header_discount_pct: 10, tax_pct: 15, shipping_amount: 50 },
      { id: SQ_SENT, tenant_id: T1, ref: "SQ-0042", account_id: ACC, status: "sent", opportunity_id: null, subtotal: 10, total: 10 },
      { id: SQ_T2, tenant_id: T2, ref: "SQ-9001", account_id: ACC_T2, status: "accepted", opportunity_id: null, subtotal: 1, total: 1 },
      { id: SQ_FROM_EST, tenant_id: T1, ref: "SQ-0043", account_id: ACC, status: "accepted", opportunity_id: null, subtotal: 300, total: 300 },
    ],
    standard_quote_lines: [
      { id: "sl1", tenant_id: T1, standard_quote_id: SQ, sl_no: "1", description: "Wall panel 2.4m", uom: "ea", qty: 10, rate: 80, discount_pct: 0, amount: 800, is_selected: true, group_id: null, group_type: null, break_of: null },
      { id: "sl2", tenant_id: T1, standard_quote_id: SQ, sl_no: "2", description: "Erection", uom: "day", qty: 4, rate: 50, discount_pct: 0, amount: 200, is_selected: true, group_id: null, group_type: null, break_of: null },
      { id: "sl3", tenant_id: T1, standard_quote_id: SQ, sl_no: "3", description: "Option B not chosen", uom: "ea", qty: 1, rate: 99, discount_pct: 0, amount: 99, is_selected: false, group_id: "g2", group_type: "alternative", break_of: null },
      { id: "sl4", tenant_id: T1, standard_quote_id: SQ, sl_no: "4", description: "Option A chosen", uom: "ea", qty: 1, rate: 0, discount_pct: 0, amount: 0, is_selected: true, group_id: "g1", group_type: "alternative", break_of: null },
      { id: "sl5", tenant_id: T1, standard_quote_id: SQ_FROM_EST, sl_no: "1", description: "Beams", uom: "ea", qty: 3, rate: 100, discount_pct: 0, amount: 300, is_selected: true, group_id: null, group_type: null, break_of: null },
      { id: "sl9", tenant_id: T2, standard_quote_id: SQ_T2, sl_no: "1", description: "Secret", uom: "ea", qty: 1, rate: 1, discount_pct: 0, amount: 1, is_selected: true, group_id: null, group_type: null, break_of: null },
    ],
    quotes: [
      { id: QN, tenant_id: T1, ref: "QT-0007", account_id: ACC, status: "approved", outcome: "won", opportunity_id: null, total: 590, superseded_by: null, selected_option_id: null },
      { id: QN_OPEN, tenant_id: T1, ref: "QT-0008", account_id: ACC, status: "sent", outcome: "open", opportunity_id: null, total: 5, superseded_by: null },
      { id: QN_OLD, tenant_id: T1, ref: "QT-0006", account_id: ACC, status: "approved", outcome: "won", opportunity_id: null, total: 5, superseded_by: QN },
    ],
    quote_lines: [
      { id: "ql1", tenant_id: T1, quote_id: QN, sl_no: "1", description: "Pipe supports", uom: "ea", qty: 5, rate: 100, discount_pct: 10, amount: 450, is_selected: true, group_id: null, group_type: null, break_of: null },
      { id: "ql2", tenant_id: T1, quote_id: QN, sl_no: "2", description: "Freight", uom: "lot", qty: 1, rate: 140, discount_pct: 0, amount: 140, is_selected: true, group_id: null, group_type: null, break_of: null },
    ],
    estimates: [
      { id: EST, tenant_id: T1, ref: "EST-1", name: "Beams", standard_quote_id: SQ_FROM_EST, status: "won" },
      { id: EST_NO_QUOTE, tenant_id: T1, ref: "EST-2", name: "No quote yet", standard_quote_id: null, status: "draft" },
      { id: EST_T2, tenant_id: T2, ref: "EST-9", name: "Theirs", standard_quote_id: SQ_T2, status: "won" },
    ],
  });
}

beforeEach(() => {
  state.db = seed();
  state.db.users.set(ASKER, { email: "asker@pcbs.test", name: "S. Khan" });
  state.db.users.set(BOSS, { email: "boss@pcbs.test", name: "A. Nasser" });
  state.db.unique("contract_projects", (a, b) => a.tenant_id === b.tenant_id && !!a.source_id && a.source_type === b.source_type && a.source_id === b.source_id);
  state.db.unique("contract_projects", (a, b) => a.tenant_id === b.tenant_id && !!a.source_opportunity_id && a.source_opportunity_id === b.source_opportunity_id && (!a.source_type || a.source_type === "tender") && (!b.source_type || b.source_type === "tender"));
  state.features = { contract_projects: true, standard_quotes: true, quotations: true, estimator: true };
  state.touched = []; state.changes = []; state.seq = 0;
  state.view = true; state.edit = true; state.role = "member";
  state.user = { id: ASKER, email: "asker@pcbs.test" };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const make = (body: Record<string, unknown>) => createPost(json("POST", body));

describe("from an accepted standard quote", () => {
  it("makes the project with the quote's lines as the contract, the subtotal as its value, and the source stored", async () => {
    const res = await make({ standard_quote_id: SQ });
    expect(res.status).toBe(201);
    const j = await res.json();
    expect(j).toMatchObject({ ref: "CPR-0001", source_type: "standard_quote", lines: 3, skipped: 1 });
    const project = mine("contract_projects")[0];
    expect(project).toMatchObject({
      name: "Acme Precast - SQ-0041", account_id: ACC, status: "draft", contract_value: 1000, source_type: "standard_quote", source_id: SQ, source_opportunity_id: DEAL, created_by: ASKER,
    });
    const revs = mine("project_budget_revisions");
    expect(revs).toHaveLength(1);
    expect(revs[0]).toMatchObject({ rev_no: 0, status: "draft", total: 0 });
    const lines = mine("project_budget_lines");
    expect(lines.map((l) => l.description)).toEqual(["Wall panel 2.4m", "Erection", "Option A chosen"]);
    // The contract, with no cost: nothing is guessed.
    expect(lines[0]).toMatchObject({ qty: 10, unit: "ea", client_rate: 80, client_amount: 800, allocated: false, unit_cost: 0, amount: 0, source_line_id: "sl1", resource_code: "11" });
  });

  it("a line's own discount is taken off the client's rate", async () => {
    await make({ quotation_id: QN });
    const pipe = mine("project_budget_lines").find((l) => l.description === "Pipe supports")!;
    expect(pipe).toMatchObject({ client_rate: 90, client_amount: 450 });
  });

  it("takes the name, manager and planned start from the confirm", async () => {
    const res = await make({ standard_quote_id: SQ, name: "Acme walls phase 1", manager_id: BOSS, planned_start: "2026-12-01" });
    expect(res.status).toBe(201);
    expect(mine("contract_projects")[0]).toMatchObject({ name: "Acme walls phase 1", manager_id: BOSS, planned_start: "2026-12-01" });
  });

  it("is logged with the quote named as the source", async () => {
    const res = await make({ standard_quote_id: SQ });
    const c = state.changes.find((x) => x.objectType === "contract_projects" && x.action === "create");
    expect(c?.objectId).toBe((await res.json()).id);
    expect(c?.changes?.[0]).toMatchObject({ field: "Created from standard quote", to: "SQ-0041" });
  });

  it("is refused when the quote is not accepted, and nothing is made", async () => {
    const res = await make({ standard_quote_id: SQ_SENT });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("accepted");
    expect(mine("contract_projects")).toHaveLength(0);
    expect(mine("project_budget_revisions")).toHaveLength(0);
  });

  it("a second press answers 409 with the first project's id, so the screen can open it", async () => {
    const first = await (await make({ standard_quote_id: SQ })).json();
    const again = await make({ standard_quote_id: SQ });
    expect(again.status).toBe(409);
    const j = await again.json();
    expect(j).toMatchObject({ already_exists: true, project_id: first.id });
    expect(j.error).toContain("SQ-0041");
    expect(mine("contract_projects")).toHaveLength(1);
  });

  it("the unique index is the backstop when two creates race", async () => {
    await make({ standard_quote_id: SQ });
    const direct = await state.db.from("contract_projects").insert({ tenant_id: T1, source_type: "standard_quote", source_id: SQ, name: "dup" });
    expect(direct.error?.code).toBe("23505");
  });

  it("two accepted quotes of one deal each get their own project", async () => {
    rows("standard_quotes").find((q) => q.id === SQ_FROM_EST)!.opportunity_id = DEAL;
    expect((await make({ standard_quote_id: SQ })).status).toBe(201);
    expect((await make({ standard_quote_id: SQ_FROM_EST })).status).toBe(201);
    expect(mine("contract_projects")).toHaveLength(2);
  });

  it("another workspace's quote, a made-up id and a quote that is not a quote are refused", async () => {
    expect((await make({ standard_quote_id: SQ_T2 })).status).toBe(404);
    expect((await make({ standard_quote_id: "nope" })).status).toBe(404);
    expect((await make({ standard_quote_id: QN })).status).toBe(404);
    expect(mine("contract_projects")).toHaveLength(0);
    expect(rows("project_budget_lines").some((l) => l.description === "Secret")).toBe(false);
  });

  it("a deal id on the quote that belongs to another workspace is not kept as the back link", async () => {
    rows("standard_quotes").find((q) => q.id === SQ)!.opportunity_id = DEAL_T2;
    expect((await make({ standard_quote_id: SQ })).status).toBe(201);
    expect(mine("contract_projects")[0].source_opportunity_id).toBeNull();
  });

  it("a manager who is not in the workspace is refused", async () => {
    expect((await make({ standard_quote_id: SQ, manager_id: OTHER_USER })).status).toBe(404);
    expect(mine("contract_projects")).toHaveLength(0);
  });

  it("needs the standard quotes module and the right to open them, and the right to change projects", async () => {
    state.features = { contract_projects: true, standard_quotes: false };
    expect((await make({ standard_quote_id: SQ })).status).toBe(404);
    state.features = { contract_projects: true, standard_quotes: true };
    state.edit = false;
    expect((await make({ standard_quote_id: SQ })).status).toBe(403);
    expect(mine("contract_projects")).toHaveLength(0);
  });

  it("works in a workspace that has no tender edition", async () => {
    state.features = { contract_projects: true, standard_quotes: true };
    expect((await make({ standard_quote_id: SQ })).status).toBe(201);
    expect((await listGet(get())).status).toBe(200);
  });
});

describe("from a won quotation", () => {
  it("makes the project from the quotation's charged lines", async () => {
    const res = await make({ quotation_id: QN });
    expect(res.status).toBe(201);
    expect(mine("contract_projects")[0]).toMatchObject({ name: "Acme Precast - QT-0007", source_type: "quotation", source_id: QN, contract_value: 590, account_id: ACC });
    expect(mine("project_budget_lines")).toHaveLength(2);
    expect(state.changes[0].changes?.[0]).toMatchObject({ field: "Created from quotation", to: "QT-0007" });
  });

  it("an open quotation, a superseded version and another workspace's id are refused", async () => {
    expect((await make({ quotation_id: QN_OPEN })).status).toBe(409);
    expect((await make({ quotation_id: QN_OLD })).status).toBe(409);
    expect((await make({ quotation_id: SQ })).status).toBe(404);
    expect(mine("contract_projects")).toHaveLength(0);
  });

  it("needs the quotations module", async () => {
    state.features = { contract_projects: true, quotations: false };
    expect((await make({ quotation_id: QN })).status).toBe(404);
  });
});

describe("from an estimate", () => {
  it("resolves to the standard quote made from it, and one project serves both", async () => {
    const res = await make({ estimate_id: EST });
    expect(res.status).toBe(201);
    expect(mine("contract_projects")[0]).toMatchObject({ source_type: "standard_quote", source_id: SQ_FROM_EST, contract_value: 300 });
    const again = await make({ standard_quote_id: SQ_FROM_EST });
    expect(again.status).toBe(409);
    expect(mine("contract_projects")).toHaveLength(1);
  });

  it("says so clearly when the estimate has no quote yet, and refuses another workspace's estimate", async () => {
    const none = await make({ estimate_id: EST_NO_QUOTE });
    expect(none.status).toBe(409);
    expect((await none.json()).error).toContain("no standard quote");
    expect((await make({ estimate_id: EST_T2 })).status).toBe(404);
    expect(mine("contract_projects")).toHaveLength(0);
  });

  it("needs the estimator module", async () => {
    state.features = { contract_projects: true, standard_quotes: true, estimator: false };
    expect((await make({ estimate_id: EST })).status).toBe(404);
  });
});

describe("while migration 0248 is pending", () => {
  beforeEach(() => { state.db.missingColumns.contract_projects = new Set(["source_type", "source_id"]); });

  it("making a project from a quote answers 503 with the bundle, and creates nothing", async () => {
    const res = await make({ standard_quote_id: SQ });
    expect(res.status).toBe(503);
    const j = await res.json();
    expect(j).toMatchObject({ needsDatabaseUpdate: true, bundle: "scripts/run-bundle-52-contract-project-source-2026-11-22.sql" });
    expect(j.error).toContain("0248");
    expect(mine("contract_projects")).toHaveLength(0);
    expect(mine("project_budget_revisions")).toHaveLength(0);
    expect(mine("project_budget_lines")).toHaveLength(0);
  });

  it("a tender still becomes a project, without the two columns, and reads as a tender", async () => {
    state.features = { contract_projects: true, gcc_tender: true };
    const res = await make({ opportunity_id: TENDER });
    expect(res.status).toBe(201);
    const project = mine("contract_projects")[0];
    expect(project.source_opportunity_id).toBe(TENDER);
    expect(project.source_type).toBeUndefined();
    const view = await (await oneGet(get(), ctx(project.id as string))).json();
    expect(view.project.source_type).toBe("tender");
  });

  it("a project of a tender saved before the migration is a tender project, one with no deal is by hand", async () => {
    state.db.missingColumns.contract_projects = new Set();
    rows("contract_projects").push(
      { id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1", tenant_id: T1, ref: "CPR-0100", name: "Old tender", account_id: ACC, source_opportunity_id: TENDER, status: "draft", contract_value: 1 },
      { id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd5", tenant_id: T1, ref: "CPR-0101", name: "Old by hand", account_id: ACC, source_opportunity_id: null, status: "draft", contract_value: 1 },
    );
    const list = await (await listGet(get())).json();
    const type = (n: string) => list.rows.find((r: { name: string }) => r.name === n).source_type;
    expect(type("Old tender")).toBe("tender");
    expect(type("Old by hand")).toBe("manual");
  });
});

describe("the tender-only screens are keyed on the source type, not on the deal link", () => {
  async function quoteProjectOnATenderDeal() {
    // The quote's deal is a tender deal: source_opportunity_id is set, yet the project is not a tender project.
    rows("standard_quotes").find((q) => q.id === SQ)!.opportunity_id = TENDER;
    const made = await (await make({ standard_quote_id: SQ })).json();
    state.features = { contract_projects: true, gcc_tender: true, standard_quotes: true };
    return made.id as string;
  }

  it("Buy-out does not open, even with the tender edition on", async () => {
    const id = await quoteProjectOnATenderDeal();
    expect(mine("contract_projects")[0].source_opportunity_id).toBe(TENDER);
    expect((await buyoutGet(get(), ctx(id))).status).toBe(404);
  });

  it("there are no tender costs to copy, and no winning-bid payment terms", async () => {
    const id = await quoteProjectOnATenderDeal();
    const fill = await fillPost(json("POST", {}), ctx(id));
    expect(fill.status).toBe(409);
    expect((await fill.json()).error).toContain("no tender");
    const terms = await copyTerms(json("POST", {}), ctx(id));
    expect(terms.status).toBe(409);
    expect((await terms.json()).error).toContain("did not come from a tender");
  });

  it("the tender project's own project is found by its deal; a quote project on the same deal is not mistaken for it", async () => {
    await quoteProjectOnATenderDeal();
    const { loadProjectBySource } = await import("@/lib/contractProjects/server");
    const admin = { from: (t: string) => state.db.from(t) } as never;
    expect(await loadProjectBySource(admin, T1, TENDER)).toBeNull();
    expect(await loadProjectBySource(admin, T1, { type: "standard_quote", id: SQ })).toMatchObject({ ref: "CPR-0001" });
  });

  it("Buy-out and fill stay off in a workspace without the tender edition, and a quote project opens anyway", async () => {
    const id = await quoteProjectOnATenderDeal();
    state.features = { contract_projects: true, standard_quotes: true };
    expect((await buyoutGet(get(), ctx(id))).status).toBe(404);
    const view = await oneGet(get(), ctx(id));
    expect(view.status).toBe(200);
    expect((await view.json()).project).toMatchObject({ source_type: "standard_quote", source_id: SQ });
  });
});
