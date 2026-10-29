import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDb } from "@/lib/inbox/testing/memoryDb";

// Payment-term templates (migration 0240), against an in-memory database: the Bid tab chooses one of the workspace's templates for a tender,
// the submitted bid version keeps a copy, and the project's billing schedule copies the winning bid's terms. The questions asked: the gate
// (flag, a standard deal, another workspace, view-only), a template id from another workspace, the copy of a template that is edited later,
// the schedule that is not empty, the terms read tenant-scoped from the PROJECT's own tender, and the migration still pending.

const state = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  features: {} as Record<string, boolean>,
  config: {} as Record<string, unknown>,
  touched: [] as string[],
  changes: [] as { objectType: string; objectId: string; action: string; changes?: { field: string; from: unknown; to: unknown }[] }[],
  user: { id: "u1", email: "me@t1.test" },
  role: "member" as "admin" | "member",
  edit: true,
}));

const T1 = "t1";
const T2 = "t2";
const ME = "11111111-1111-4111-8111-111111111111";
const OPP = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const OPP_T2 = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const OPP_STD = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const PROJECT = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const PROJECT_T2 = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2";
const TPL_A = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
const TPL_B = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2";
const TPL_T2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee9";

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => ({ from: (t: string) => { state.touched.push(t); return state.db.from(t); }, auth: state.db.auth }),
  getAuthUser: async () => state.user,
  requireTenantUser: async () => ({ tenantId: T1, userId: state.user.id, role: state.role, supabase: {} }),
}));
vi.mock("@/lib/tenant", () => ({
  tenantHasFeature: async (_s: unknown, _t: string, key: string) => !!state.features[key],
  getTenant: async () => ({ config: state.config, features: state.features }),
}));
vi.mock("@/lib/permissions", () => ({
  resolvePermissions: async () => ({ unrestricted: true, grants: new Map() }),
  canViewWorkcenter: () => true,
  canEditWorkcenter: () => state.edit,
}));
vi.mock("@/lib/changeLog", () => ({
  diffForLog: (_t: string, b: Record<string, unknown>, a: Record<string, unknown>) =>
    Object.entries(a).filter(([k, v]) => JSON.stringify(b[k] ?? null) !== JSON.stringify(v ?? null)).map(([field, to]) => ({ field, from: b[field] ?? null, to })),
  logChange: async (_c: unknown, p: (typeof state.changes)[number]) => { state.changes.push(p); },
}));

import { NextRequest } from "next/server";
import { GET as termsGet, PATCH as termsPatch } from "../opportunities/[id]/tender/payment-terms/route";
import { POST as copyPost } from "./[id]/milestones/copy-terms/route";
import { saveVersionTerms } from "@/lib/contractProjects/paymentTermsServer";

const req = (method: string, body?: unknown) => new NextRequest(new URL("http://internal.invalid/x"), { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const tender = (id = OPP) => state.db.rows("opportunity_tenders").find((t) => t.opportunity_id === id)!;
const milestones = (project = PROJECT) => state.db.rows("contract_project_milestones").filter((m) => m.project_id === project);

const tpl = (id: string, name: string, ms: unknown[]) => ({ id, name, milestones: ms });
const ms = (title: string, percent: number, trigger: string) => ({ title, basis: "percent", percent, fixed_amount: null, trigger });
const TEMPLATES = [
  tpl(TPL_A, "30 / 60 / 10", [ms("Advance", 30, "On award"), ms("Delivery", 60, "On delivery"), ms("Retention", 10, "After 12 months")]),
  tpl(TPL_B, "50 / 50", [ms("Advance", 50, "On award"), { title: "Final", basis: "fixed", percent: null, fixed_amount: 25000, trigger: "On handover" }]),
];

const oppRow = (id: string, over: Record<string, unknown> = {}) => ({
  id, tenant_id: T1, ref: `OPP-${id.slice(-1)}`, title: "Valves for Plant 4", account_id: "acc", stage: "awarded", outcome: "won", owner_id: ME, team: [], amount: 100000, currency: "SAR",
  created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", ...over,
});
const tenderFor = (opportunity_id: string, tenant_id = T1, custom_data: Record<string, unknown> | null = null) => ({
  opportunity_id, tenant_id, tender_no: "ARB-1", issuer_name: "Aramco", portal: "ariba", closing_at: null, addenda_count: 0, decision: "go", custom_data, reminders_sent: [],
  bond_status: "held", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
});
const projectRow = (id: string, tenant_id: string, source: string | null, over: Record<string, unknown> = {}) => ({
  id, tenant_id, ref: "CPR-1", name: "Valves", account_id: "acc", source_opportunity_id: source, status: "active", contract_value: 100000, currency: "SAR",
  created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", ...over,
});

beforeEach(() => {
  state.db = new MemoryDb({
    tenants: [{ id: T1, slug: "kamco", name: "KAMCO", is_demo: false, config: {}, custom_domain: "kamco.example.com" }, { id: T2, slug: "other", name: "Other", is_demo: false, config: {}, custom_domain: null }],
    tenant_users: [{ tenant_id: T1, user_id: ME, role: "member" }],
    opportunities: [oppRow(OPP_STD, { stage: "qualify", outcome: "open" }), oppRow(OPP), oppRow(OPP_T2, { tenant_id: T2 })],
    opportunity_tenders: [tenderFor(OPP), tenderFor(OPP_T2, T2)],
    opportunity_lines: [],
    contract_projects: [projectRow(PROJECT, T1, OPP), projectRow(PROJECT_T2, T2, OPP_T2)],
    contract_project_milestones: [],
    tender_bid_versions: [],
    tender_bid_version_terms: [],
  });
  state.features = { pipeline: true, gcc_tender: true, contract_projects: true };
  state.config = { contract_projects: { payment_term_templates: TEMPLATES } };
  state.touched = []; state.changes = [];
  state.edit = true;
  state.role = "member";
  state.user = { id: ME, email: "me@t1.test" };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the tender's payment terms (Bid tab)", () => {
  it("lists the workspace's templates and what is chosen (nothing at first)", async () => {
    const res = await termsGet(req("GET"), ctx(OPP));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ templates: [{ id: TPL_A, name: "30 / 60 / 10", milestones: 3 }, { id: TPL_B, name: "50 / 50", milestones: 2 }], chosen: null });
  });

  it("choosing saves a COPY on the tender, next to its other custom data, and logs it", async () => {
    tender().custom_data = { cf_site: "Plant 4" };
    const res = await termsPatch(req("PATCH", { template_id: TPL_A }), ctx(OPP));
    expect(res.status).toBe(200);
    const saved = tender().custom_data as Record<string, { template_id: string; name: string; milestones: unknown[] }>;
    expect((tender().custom_data as Record<string, unknown>).cf_site).toBe("Plant 4");
    expect(saved.payment_terms).toMatchObject({ template_id: TPL_A, name: "30 / 60 / 10" });
    expect(saved.payment_terms.milestones).toHaveLength(3);
    expect(state.changes[0]).toMatchObject({ objectType: "opportunity_tenders", objectId: OPP });
    expect(state.changes[0].changes![0]).toMatchObject({ field: "payment_terms", from: null, to: "30 / 60 / 10" });
    // A later edit of the template does not change what the tender chose.
    state.config = { contract_projects: { payment_term_templates: [tpl(TPL_A, "Renamed", [ms("Only", 100, "")])] } };
    const again = await termsGet(req("GET"), ctx(OPP));
    expect((await again.json()).chosen).toMatchObject({ name: "30 / 60 / 10" });
  });

  it("null clears the choice; an id that is not one of this workspace's templates is a 404 and writes nothing", async () => {
    await termsPatch(req("PATCH", { template_id: TPL_B }), ctx(OPP));
    expect((await termsPatch(req("PATCH", { template_id: null }), ctx(OPP))).status).toBe(200);
    expect(tender().custom_data).not.toHaveProperty("payment_terms");
    const before = JSON.stringify(tender().custom_data);
    expect((await termsPatch(req("PATCH", { template_id: TPL_T2 }), ctx(OPP))).status).toBe(404);
    expect((await termsPatch(req("PATCH", {}), ctx(OPP))).status).toBe(400);
    expect((await termsPatch(req("PATCH", { template_id: 7 }), ctx(OPP))).status).toBe(400);
    expect(JSON.stringify(tender().custom_data)).toBe(before);
  });

  it("the gate: flag off, a standard deal, another workspace and a view-only person", async () => {
    state.features = { pipeline: true };
    expect((await termsGet(req("GET"), ctx(OPP))).status).toBe(404);
    state.features = { pipeline: true, gcc_tender: true };
    expect((await termsGet(req("GET"), ctx(OPP_STD))).status).toBe(404);
    expect((await termsGet(req("GET"), ctx(OPP_T2))).status).toBe(404);
    expect((await termsPatch(req("PATCH", { template_id: TPL_A }), ctx(OPP_T2))).status).toBe(404);
    expect(tender(OPP_T2).custom_data).toBeNull();
    state.edit = false;
    expect((await termsGet(req("GET"), ctx(OPP))).status).toBe(200);
    expect((await termsPatch(req("PATCH", { template_id: TPL_A }), ctx(OPP))).status).toBe(403);
  });
});

describe("keeping the terms with the submitted bid version", () => {
  it("saves a copy of what the tender chose, once per version; nothing chosen means nothing saved", async () => {
    const admin = { from: (t: string) => state.db.from(t) } as never;
    expect(await saveVersionTerms(admin, T1, OPP, 1, tender().custom_data as Record<string, unknown> | null)).toBe("none");
    await termsPatch(req("PATCH", { template_id: TPL_A }), ctx(OPP));
    expect(await saveVersionTerms(admin, T1, OPP, 1, tender().custom_data as Record<string, unknown> | null)).toBe("saved");
    const kept = state.db.rows("tender_bid_version_terms");
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ tenant_id: T1, opportunity_id: OPP, version_no: 1 });
  });
});

describe("Copy the tender's payment terms (billing schedule)", () => {
  const bidWith = (versionNo: number, terms: unknown | null) => {
    state.db.rows("tender_bid_versions").push({ id: `v${versionNo}`, tenant_id: T1, opportunity_id: OPP, version_no: versionNo });
    if (terms) state.db.rows("tender_bid_version_terms").push({ id: `t${versionNo}`, tenant_id: T1, opportunity_id: OPP, version_no: versionNo, terms });
  };
  const choice = (t: (typeof TEMPLATES)[number]) => ({ template_id: t.id, name: t.name, milestones: t.milestones, chosen_at: "2026-10-20T00:00:00.000Z" });

  it("makes one planned milestone per term of the WINNING bid, trigger text as the note, and logs once", async () => {
    bidWith(1, choice(TEMPLATES[1]));
    bidWith(2, choice(TEMPLATES[0]));
    const res = await copyPost(req("POST"), ctx(PROJECT));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ created: 3, template: "30 / 60 / 10" });
    const made = milestones();
    expect(made.map((m) => [m.title, m.basis, m.percent, m.note, m.status, m.tenant_id])).toEqual([
      ["Advance", "percent", 30, "On award", "planned", T1], ["Delivery", "percent", 60, "On delivery", "planned", T1], ["Retention", "percent", 10, "After 12 months", "planned", T1],
    ]);
    expect(state.changes).toHaveLength(1);
    expect(state.changes[0].changes![0].field).toBe("Payment terms copied from the tender");
  });

  it("a fixed amount stays a fixed amount", async () => {
    bidWith(1, choice(TEMPLATES[1]));
    await copyPost(req("POST"), ctx(PROJECT));
    expect(milestones().map((m) => [m.basis, m.percent, m.fixed_amount])).toEqual([["percent", 50, null], ["fixed", null, 25000]]);
  });

  it("falls back to the tender's own choice when the bid version kept none", async () => {
    bidWith(1, null);
    tender().custom_data = { payment_terms: choice(TEMPLATES[1]) };
    const res = await copyPost(req("POST"), ctx(PROJECT));
    expect(res.status).toBe(201);
    expect((await res.json()).template).toBe("50 / 50");
  });

  it("refuses a schedule that already has milestones, a closed project, a project without a tender and a tender with no terms", async () => {
    bidWith(1, choice(TEMPLATES[0]));
    state.db.rows("contract_project_milestones").push({ id: "m1", tenant_id: T1, project_id: PROJECT, title: "Hand made", basis: "percent", percent: 100, status: "planned", sort_order: 10 });
    expect((await copyPost(req("POST"), ctx(PROJECT))).status).toBe(409);
    state.db.rows("contract_project_milestones").length = 0;
    state.db.rows("contract_projects").find((p) => p.id === PROJECT)!.status = "closed";
    expect((await copyPost(req("POST"), ctx(PROJECT))).status).toBe(409);
    state.db.rows("contract_projects").find((p) => p.id === PROJECT)!.status = "active";
    state.db.rows("contract_projects").find((p) => p.id === PROJECT)!.source_opportunity_id = null;
    expect((await copyPost(req("POST"), ctx(PROJECT))).status).toBe(409);
    state.db.rows("contract_projects").find((p) => p.id === PROJECT)!.source_opportunity_id = OPP;
    state.db.rows("tender_bid_version_terms").length = 0;
    expect((await copyPost(req("POST"), ctx(PROJECT))).status).toBe(404);
    expect(milestones()).toHaveLength(0);
  });

  it("never reads another workspace's terms: a project of another workspace is a 404, and its tender's terms are not in reach", async () => {
    state.db.rows("tender_bid_versions").push({ id: "vx", tenant_id: T2, opportunity_id: OPP_T2, version_no: 1 });
    state.db.rows("tender_bid_version_terms").push({ id: "tx", tenant_id: T2, opportunity_id: OPP_T2, version_no: 1, terms: { template_id: TPL_T2, name: "Secret", milestones: TEMPLATES[0].milestones, chosen_at: "" } });
    expect((await copyPost(req("POST"), ctx(PROJECT_T2))).status).toBe(404);
    // Pointing OUR project at their tender finds nothing either: every read is scoped to this workspace.
    state.db.rows("contract_projects").find((p) => p.id === PROJECT)!.source_opportunity_id = OPP_T2;
    expect((await copyPost(req("POST"), ctx(PROJECT))).status).toBe(404);
    expect(milestones(PROJECT)).toHaveLength(0);
    expect(milestones(PROJECT_T2)).toHaveLength(0);
  });

  it("is a write: a view-only person gets a 403", async () => {
    bidWith(1, choice(TEMPLATES[0]));
    state.edit = false;
    expect((await copyPost(req("POST"), ctx(PROJECT))).status).toBe(403);
    expect(milestones()).toHaveLength(0);
  });
});
