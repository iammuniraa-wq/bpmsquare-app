import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDb } from "@/lib/inbox/testing/memoryDb";
import { messyWorkbook } from "@/lib/tender/boq/testing/workbooks";

vi.hoisted(() => {
  process.env.FIELD_ENCRYPTION_KEY = "ab".repeat(32);
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key-for-tests";
});

// Assistant actions step 4: the tender steps as cards. The REAL routes the Pipeline's buttons post to run against one in-memory
// database, so what is proved is that a pressed card goes through the same route code as the screen: its stage rules, its tenant
// filters, its change history ("via assistant"). A card lists the checks that are not a pass the way the screen's dialog does; the
// deal, the suppliers and the template are named by the person and resolved by the server inside this workspace.
const S = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  features: {} as Record<string, boolean>,
  userId: "",
  role: "member" as "admin" | "member",
  seq: 0,
}));

const T1 = "00000000-0000-4000-8000-0000000000a1";
const T2 = "00000000-0000-4000-8000-0000000000a2";
const ME = "11111111-1111-4111-8111-111111111111";
const BOSS = "33333333-3333-4333-8333-333333333333";
const id = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const D_DECIDE = id(1), D_BID = id(2), D_RFQ = id(3), D_BOQ = id(4), D_PLAIN = id(5), D_FOREIGN = id(6), D_EST = id(7);
const SUP_A = id(20), SUP_B = id(21), SUP_FOREIGN = id(22);
const TPL = id(30), TPL_OLD = id(31), TPL_FOREIGN = id(32);
const P_GATE = id(40);
const ACC = id(70);
const LB1 = id(51), LB2 = id(52), LB3 = id(53);
const LR1 = id(61), LR2 = id(62), LR3 = id(63);

vi.mock("@/lib/supabase-server", () => {
  const client = () => ({ from: (t: string) => S.db.from(t), auth: S.db.auth, storage: S.db.storage });
  return {
    createAdminSupabase: client,
    getAuthUser: async () => ({ id: S.userId, email: "me@kamco.test" }),
    requireTenantUser: async () => ({ tenantId: T1, userId: S.userId, role: S.role, supabase: client() }),
  };
});
vi.mock("@/lib/tenant", () => ({
  tenantHasFeature: async (_s: unknown, _t: string, key: string) => !!S.features[key],
  getTenant: async () => ({ id: T1, slug: "kamco", name: "KAMCO", custom_domain: "kamco.example.com", config: {}, features: S.features, company_info: null }),
}));
vi.mock("@/lib/permissions", async (orig) => ({ ...(await orig<typeof import("@/lib/permissions")>()), resolvePermissions: async () => ({ unrestricted: true, grants: new Map() }) }));
vi.mock("@/lib/objectFeatures", async (orig) => ({ ...(await orig<typeof import("@/lib/objectFeatures")>()), tenantOwnsObject: async () => true }));
vi.mock("@/lib/tenantClock", () => ({ tenantToday: async () => "2026-10-26", tenantTimezone: async () => "Asia/Riyadh" }));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
vi.mock("@/lib/events/emitters", () => ({
  emitOpportunityStageChanged: async () => {}, emitOpportunityClosed: async () => {}, emitOpportunityUpdated: async () => {}, emitOpportunityCreated: async () => {},
  emitTenderDecisionProposed: async () => {}, emitTenderDetailsChanged: async () => {}, emitRfqSent: async () => {}, emitRfqReplied: async () => {}, emitRfqAwarded: async () => {},
}));
vi.mock("@/lib/masterRef", () => ({
  insertWithMasterRef: async (admin: { from: (t: string) => { insert: (r: Record<string, unknown>) => { select: (s: string) => { single: () => Promise<unknown> } } } }, table: string, _tid: string, record: Record<string, unknown>, select: string) => {
    const ref = `EST-${String(++S.seq).padStart(4, "0")}`;
    const now = new Date().toISOString();
    return admin.from(table).insert({ ...record, ref, created_at: now, updated_at: now }).select(select).single();
  },
}));
vi.mock("@/lib/inbox/estimateLink", () => ({ linkEstimateToEmail: async () => {}, loadEstimatePrefill: async () => null }));
vi.mock("resend", () => ({ Resend: class { emails = { send: async () => ({ error: null }) }; } }));
vi.mock("@/lib/api/listSources", () => ({
  LIST_SOURCES: {
    opportunities: { label: "Deals", description: "deals", relatedWorkcenter: "pipeline", fields: [], load: async (tid: string) => S.db.rows("opportunities").filter((o) => o.tenant_id === tid) },
  },
}));
vi.mock("@/lib/ai/reportCompile", () => ({ compileAndRun: vi.fn() }));

import { resetViaColumnCache } from "@/lib/changeLog";
import type { PermissionSet } from "@/lib/permissions";
import type { ConfirmCard } from "@/lib/assistant/cards";
import { verbFor } from "./registry";
import { buildVerbCard, type VerbInput } from "./verbs";
import { executeCard, type ExecCtx } from "./execute";
import { askAssistant, type AssistantReply, type ChatTurn } from "@/lib/ai/assistant";
import { CURRENCIES } from "@/lib/currency";
import { EMPTY_BOQ } from "./verbs";
import { AssistantMeter } from "@/lib/assistant/meter";
import { pressCompetitorCard } from "@/lib/assistant/competitors/press";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ALL: PermissionSet = { unrestricted: true, grants: new Map() };
const ON = { ai_assistant: true, ai_assistant_actions: true, gcc_tender: true, pipeline: true, rfq: true, suppliers: true, estimator: true, products: true, accounts: true };

const line = (lid: string, opp: string, sl: string, description: string, qty: number, rate: number, over: Record<string, unknown> = {}) => ({
  id: lid, tenant_id: T1, opportunity_id: opp, sl_no: sl, description, uom: "Nos", qty, rate, discount_pct: 0, amount: qty * rate, product_id: null, group_id: null, group_type: null,
  break_of: null, is_selected: true, show_on_pdf: true, rfq_line_id: null, ...over,
});
const deal = (did: string, over: Record<string, unknown> = {}) => ({
  id: did, tenant_id: T1, ref: `OPP-${did.slice(-2)}`, title: `Deal ${did.slice(-2)}`, account_id: ACC, contact_id: null, stage: "estimating", outcome: "open", loss_reason: null, loss_note: null,
  probability: 25, probability_override: null, owner_id: ME, team: [], expected_close: null, amount: 0, currency: "SAR", competitor: null, custom_data: null,
  created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", closed_at: null, ...over,
});
const tender = (did: string, no: string, over: Record<string, unknown> = {}) => ({
  opportunity_id: did, tenant_id: T1, tender_no: no, issuer_name: "Aramco", portal: "ariba", closing_at: "2026-10-30T09:00:00.000Z", bid_bond_amount: null, bid_bond_currency: null,
  bid_bond_expiry: null, addenda_count: 0, decision: "go", decision_reason: null, decided_by: null, decided_at: null, source_email_id: null, custom_data: null, reminders_sent: [],
  bond_status: "held", bond_released_at: null, bond_released_by: null, award_value: null, winning_bidder: null, award_date: null, outcome_note: null,
  created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", ...over,
});

function world(features: Record<string, boolean> = ON) {
  S.features = features;
  S.db = new MemoryDb({
    tenants: [
      { id: T1, slug: "kamco", name: "KAMCO", is_demo: false, custom_domain: "kamco.example.com", features, config: { tax: { rate: 15 }, currency: "SAR" } },
      { id: T2, slug: "other", name: "Other", is_demo: false, custom_domain: null, features: ON, config: {} },
    ],
    tenant_users: [{ tenant_id: T1, user_id: ME, role: "member", display_name: "S. Khan" }, { tenant_id: T1, user_id: BOSS, role: "admin" }],
    opportunities: [
      deal(D_DECIDE, { stage: "bid_no_bid", title: "Pipes for Plant 4", ref: "OPP-0034" }),
      deal(D_BID, { title: "Valves for Plant 5", ref: "OPP-0035" }),
      deal(D_RFQ, { title: "Pumps for Plant 6", ref: "OPP-0036" }),
      deal(D_BOQ, { title: "Valves for Plant 7", ref: "OPP-0037" }),
      deal(D_EST, { title: "Pipe run job", ref: "OPP-0038" }),
      deal(D_PLAIN, { title: "Plain deal", ref: "OPP-0039", stage: "qualify" }),
      deal(D_FOREIGN, { tenant_id: T2, title: "Pipes for Plant 4", ref: "OPP-0034" }),
    ],
    opportunity_tenders: [
      tender(D_DECIDE, "ARB-1", { decision: null }), tender(D_BID, "ARB-2"), tender(D_RFQ, "ARB-3"), tender(D_BOQ, "ARB-4"), tender(D_EST, "ARB-5"),
      tender(D_FOREIGN, "ZZ-1", { tenant_id: T2 }),
    ],
    opportunity_lines: [
      line(LB1, D_BID, "1", "Gate valve 100mm", 4, 100), line(LB2, D_BID, "2", "Pipe 110mm", 100, 12), line(LB3, D_BID, "3", "Mobilisation", 1, 0, { uom: "lot" }),
      line(LR1, D_RFQ, "1.1", "Centrifugal pump 5kW", 2, 0), line(LR2, D_RFQ, "1.2", "Pump base plate", 2, 0), line(LR3, D_RFQ, "1.3", "Installation", 1, 900, { uom: "lot" }),
    ],
    accounts: [{ id: ACC, tenant_id: T1, name: "Saudi Aramco", ref: "ACC-0003" }],
    suppliers: [
      { id: SUP_A, tenant_id: T1, name: "Gulf Steel Trading", ref: "SUP-0001", email: "sales@gulfsteel.test", phone: "+966 1 555" },
      { id: SUP_B, tenant_id: T1, name: "Najd Valves", ref: "SUP-0002", email: null, phone: "+966 2 555" },
      { id: SUP_FOREIGN, tenant_id: T2, name: "Foreign Pumps", ref: "SUP-0001", email: "x@y.test", phone: null },
    ],
    products: [
      { id: P_GATE, tenant_id: T1, name: "Gate valve 100mm DN100", sku: "GV-100", uom: "Nos", cost_price: 412, list_price: 600, status: "active" },
    ],
    estimate_templates: [
      {
        id: TPL, tenant_id: T1, name: "Pipe run", description: "x", version: 1, is_active: true, quote_granularity: "group",
        inputs: [
          { key: "x", label: "Length", type: "number", default: 2, min: 1, max: 500, unit: "m" },
          { key: "grade", label: "Grade", type: "select", default: "a", options: [{ key: "a", label: "Grade A", value: 1 }, { key: "b", label: "Grade B", value: 2 }] },
        ],
        rates: [{ key: "r", label: "Rate", unit: "per m", value: 10 }],
        rules: [{ code: "a", group: "Supply", description: "Pipe", uom: "m", qty: "x * 2", component: "materials", cost: { kind: "rate", rate: "r" } }],
      },
      { id: TPL_OLD, tenant_id: T1, name: "Old pipe run", version: 1, is_active: false, inputs: [], rates: [], rules: [] },
      { id: TPL_FOREIGN, tenant_id: T2, name: "Foreign template", version: 1, is_active: true, inputs: [], rates: [], rules: [] },
    ],
    change_log: [], assistant_actions: [], approval_requests: [], tender_bid_versions: [],
  });
  S.db.unique("tender_bid_versions", (e, n) => e.opportunity_id === n.opportunity_id && e.version_no === n.version_no);
  S.userId = ME;
  S.role = "member";
  S.seq = 0;
}

const ctx = (over: Partial<ExecCtx> = {}): ExecCtx => ({
  supabase: { from: (t: string) => S.db.from(t) } as never, admin: { from: (t: string) => S.db.from(t) } as never, tenantId: T1, userId: ME, role: "member",
  perms: ALL, features: S.features, baseUrl: "https://kamco.example.com/api/ai/act", ...over,
});
const tryCard = (verb: string, input: VerbInput, pageRecordId?: string) =>
  buildVerbCard(
    { supabase: { from: (t: string) => S.db.from(t) } as never, tenantId: T1, userId: ME, perms: ALL, isWorkspaceAdmin: false, pageRecordId },
    verbFor(verb)!, { summary: "Do it.", ...input },
  );
async function card(verb: string, input: VerbInput, pageRecordId?: string) {
  const built = await tryCard(verb, input, pageRecordId);
  if (!built.ok) throw new Error(built.reason);
  return built.card;
}
const reason = async (verb: string, input: VerbInput, pageRecordId?: string) => { const b = await tryCard(verb, input, pageRecordId); return b.ok ? "" : b.reason; };
const valuesOf = (c: ConfirmCard) => Object.fromEntries(c.fields.map((f) => [f.key, f.value]));
const press = (c: ConfirmCard, values?: Record<string, unknown>, over: Partial<ExecCtx> = {}) =>
  executeCard(ctx(over), { card_id: c.id, token: c.token, values: values ?? valuesOf(c) });
const rows = (t: string) => S.db.rows(t);
const dealRow = (did: string) => rows("opportunities").find((o) => o.id === did)!;

beforeEach(() => {
  resetViaColumnCache();
  vi.spyOn(console, "error").mockImplementation(() => {});
  world();
});
afterEach(() => { vi.restoreAllMocks(); });

describe("which deal: the server resolves it, in this workspace, tender deals only", () => {
  it("by reference, tender number or exact name; the open page's deal is the default", async () => {
    for (const deal of ["OPP-0034", "opp-0034", "ARB-1", "Pipes for Plant 4"]) {
      expect((await card("decision", { deal, decision: "go", reason: "Good fit" })).title, deal).toBe("Propose bid decision: OPP-0034 Pipes for Plant 4");
    }
    expect((await card("decision", { decision: "go", reason: "Good fit" }, D_DECIDE)).title).toContain("OPP-0034");
  });

  it("a deal that is not exactly one is a question, a plain deal and another workspace's deal are not found", async () => {
    expect(await reason("decision", { deal: "Plant", decision: "go" })).toMatch(/Closest|Several/);
    expect(await reason("decision", { deal: "Nowhere", decision: "go" })).toMatch(/No tender deal matched/);
    expect(await reason("decision", { deal: "OPP-0039", decision: "go" })).toMatch(/No tender deal matched/);
    expect(await reason("decision", { deal: "ZZ-1", decision: "go" })).toMatch(/No tender deal matched/);
    expect(await reason("decision", { deal: D_FOREIGN, decision: "go" })).toMatch(/No tender deal matched/);
    expect(await reason("decision", { decision: "go" })).toMatch(/Which tender deal/);
    expect(await reason("decision", { decision: "go" }, D_PLAIN)).toMatch(/Which tender deal/);
  });
});

describe("(a) propose the bid decision", () => {
  it("shows the facts, takes the person's own reason, and posts to the approval route", async () => {
    const c = await card("decision", { deal: "OPP-0034", decision: "go", reason: "Good fit, we have capacity" });
    expect(c).toMatchObject({ action: "verb", object: "decision", primaryLabel: "Propose decision", risk: "write" });
    expect(c.facts).toEqual([{ label: "Stage", value: "Bid no bid" }, { label: "Asked to approve", value: "1 person" }]);
    expect(c.fields.map((f) => [f.key, f.value, f.required])).toEqual([["decision", "go", true], ["reason", "Good fit, we have capacity", true]]);
    expect(c.fields[0].options).toEqual([{ value: "go", label: "Go: bid" }, { value: "no_go", label: "No-go: do not bid" }]);
    expect(c.info).toMatch(/approve/);

    const out = await press(c);
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ ok: true, message: "Proposed go for OPP-0034 Pipes for Plant 4", record: { id: D_DECIDE, href: `/pipeline/${D_DECIDE}` } });
    expect(rows("approval_requests")).toHaveLength(1);
    expect(rows("approval_requests")[0]).toMatchObject({ tenant_id: T1, object_id: D_DECIDE, proposed_value: "go", reason: "Good fit, we have capacity", requested_by: ME, status: "pending" });
    expect(rows("change_log").find((r) => r.object_type === "opportunity_tenders")).toMatchObject({ tenant_id: T1, action: "update", via: "assistant" });
    expect(rows("assistant_actions")[0]).toMatchObject({ id: c.id, kind: "verb", action_key: "tender_decision", route: `/api/opportunities/${D_DECIDE}/tender/approval`, status: "done" });
  });

  it("the reason is the person's: without one the card asks, and the press refuses an empty one", async () => {
    const c = await card("decision", { deal: "OPP-0034", decision: "no-go" });
    expect(c.fields.find((f) => f.key === "decision")!.value).toBe("no_go");
    expect(c.fields.find((f) => f.key === "reason")).toMatchObject({ value: "", required: true });
    expect(await press(c)).toMatchObject({ status: 422, body: { code: "missing" } });
    expect((await press(c, { decision: "no_go", reason: "Out of our scope" })).status).toBe(200);
    expect(rows("approval_requests")[0]).toMatchObject({ proposed_value: "no_go", reason: "Out of our scope" });
  });

  it("no card when the screen would refuse: wrong stage, a proposal already waiting, nobody to approve, a closed tender", async () => {
    expect(await reason("decision", { deal: "OPP-0035", decision: "go", reason: "x" })).toMatch(/Received or Bid\/No-bid/);
    rows("approval_requests").push({ id: id(90), tenant_id: T1, object_type: "opportunity_tenders", object_id: D_DECIDE, kind: "tender_bid_decision", proposed_value: "go", reason: "x", requested_by: BOSS, status: "pending", created_at: "2026-10-20T00:00:00Z" });
    expect(await reason("decision", { deal: "OPP-0034", decision: "go", reason: "x" })).toMatch(/already waiting/);
    rows("approval_requests").length = 0;
    rows("tenant_users").splice(1, 1);
    expect(await reason("decision", { deal: "OPP-0034", decision: "go", reason: "x" })).toMatch(/No one else can approve/);
    expect(await reason("decision", { deal: "OPP-0034", reason: "x" })).toMatch(/go .* or no-go/);
  });
});

describe("(b) submit a bid version", () => {
  it("version 1: lists every check that is not a pass, takes no reason, and posts to the bids route", async () => {
    const c = await card("submit_bid", { deal: "OPP-0035", note: "First submission" });
    expect(c).toMatchObject({ action: "verb", primaryLabel: "Submit bid", title: "Submit bid: OPP-0035 Valves for Plant 5" });
    expect(c.facts).toEqual([{ label: "Version", value: "1" }, { label: "Lines", value: "3" }, { label: "Total", value: "SAR 1,600" }]);
    expect(c.checks).toEqual(["1 line has no price.", "No approved go decision."]);
    expect(c.fields.map((f) => [f.key, f.required])).toEqual([["revision_reason", false], ["note", false]]);

    const out = await press(c);
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ ok: true, message: "Bid version 1 submitted for OPP-0035 Valves for Plant 5" });
    expect(out.body.details).toEqual(["3 lines · SAR 1,600"]);
    expect(rows("tender_bid_versions")).toHaveLength(1);
    expect(rows("tender_bid_versions")[0]).toMatchObject({ tenant_id: T1, opportunity_id: D_BID, version_no: 1, total: 1600, note: "First submission", submitted_by: ME });
    expect(dealRow(D_BID).stage).toBe("submitted");
    expect(rows("change_log").filter((r) => r.object_type === "opportunity_tenders").every((r) => r.via === "assistant")).toBe(true);
    expect(rows("assistant_actions")[0]).toMatchObject({ kind: "verb", action_key: "tender_submit_bid", status: "done" });
  });

  it("an approved go and a guarantee marked Submitted leave nothing to warn about", async () => {
    rows("approval_requests").push({ id: id(91), tenant_id: T1, object_type: "opportunity_tenders", object_id: D_BID, kind: "tender_bid_decision", proposed_value: "go", reason: "x", requested_by: ME, status: "approved", decided_by: BOSS, decided_at: "2026-10-21T00:00:00Z", created_at: "2026-10-20T00:00:00Z" });
    rows("opportunity_lines").find((l) => l.id === LB3)!.rate = 5000;
    const c = await card("submit_bid", { deal: "OPP-0035" });
    expect(c.checks).toEqual([]);
  });

  it("a revision needs its reason on the card; a submitted tender gets no card (the Bid tab revises)", async () => {
    expect((await press(await card("submit_bid", { deal: "OPP-0035" }))).status).toBe(200);
    expect(await reason("submit_bid", { deal: "OPP-0035" })).toMatch(/already submitted/);
    dealRow(D_BID).stage = "estimating";
    const c = await card("submit_bid", { deal: "OPP-0035", revision_reason: "Client changed the quantities" });
    expect(c.facts![0]).toEqual({ label: "Version", value: "2" });
    expect(c.fields[0]).toMatchObject({ key: "revision_reason", required: true, value: "Client changed the quantities" });
    expect(await press(c, { revision_reason: "", note: "" })).toMatchObject({ status: 422, body: { code: "missing" } });
    expect((await press(c)).status).toBe(200);
    expect(rows("tender_bid_versions").map((v) => v.version_no)).toEqual([1, 2]);
  });

  it("a version submitted since the card was shown makes the card stale and writes nothing more", async () => {
    const c = await card("submit_bid", { deal: "OPP-0035" });
    rows("tender_bid_versions").push({ id: id(95), tenant_id: T1, opportunity_id: D_BID, version_no: 1, total: 1, line_count: 1, lines: [], submitted_at: "2026-10-25T00:00:00Z" });
    expect(await press(c)).toMatchObject({ status: 409, body: { code: "stale_record" } });
    expect(rows("tender_bid_versions")).toHaveLength(1);
  });

  it("no card for a closed tender, an empty one or a stage the bid cannot be submitted from", async () => {
    dealRow(D_BID).outcome = "lost";
    expect(await reason("submit_bid", { deal: "OPP-0035" })).toMatch(/closed/);
    dealRow(D_BID).outcome = "open";
    dealRow(D_BID).stage = "received";
    expect(await reason("submit_bid", { deal: "OPP-0035" })).toMatch(/Estimating or Clarifications/);
  });
});

describe("(c) create an RFQ from the unpriced lines", () => {
  it("names the suppliers it resolved and the lines it will send, and makes a DRAFT through the RFQ route", async () => {
    const c = await card("rfq", { deal: "OPP-0036", suppliers: ["Gulf Steel Trading", "SUP-0002"] });
    expect(c).toMatchObject({ action: "verb", primaryLabel: "Create RFQ", title: "Create RFQ: OPP-0036 Pumps for Plant 6" });
    expect(c.facts).toEqual([{ label: "Suppliers", value: "Gulf Steel Trading, Najd Valves" }, { label: "Lines without a price", value: "2" }]);
    expect(c.checks).toEqual(["Najd Valves has no email address, so the RFQ cannot be emailed to them until you add one."]);
    expect(c.fields.map((f) => f.key)).toEqual(["title", "respond_by"]);
    expect(c.fields.every((f) => !f.required)).toBe(true);

    const out = await press(c, { title: "Pumps and base plates", respond_by: "2026-11-10" });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ ok: true, record: { label: "RFQ-0001" } });
    expect(out.body.message).toBe("Created RFQ-0001: 2 lines for 2 suppliers");
    expect(out.body.details).toEqual(["It is a draft. Nothing has been sent to the suppliers."]);
    const rfq = rows("rfqs")[0];
    expect(rfq).toMatchObject({ tenant_id: T1, title: "Pumps and base plates", origin_type: "opportunity", origin_id: D_RFQ, status: "draft", respond_by: "2026-11-10" });
    expect(rows("rfq_lines").map((l) => l.description).sort()).toEqual(["Centrifugal pump 5kW", "Pump base plate"]);
    expect(rows("rfq_suppliers").map((s) => s.supplier_id).sort()).toEqual([SUP_A, SUP_B].sort());
    expect(rows("rfq_lines").every((l) => l.tenant_id === T1)).toBe(true);
    expect(rows("assistant_actions")[0]).toMatchObject({ kind: "verb", action_key: "tender_rfq", status: "done" });
    expect(rows("email_log") ?? []).toHaveLength(0);
  });

  it("only the unpriced lines go: a priced line, a line already on an RFQ and a non-tender deal's lines stay out", async () => {
    rows("opportunity_lines").find((l) => l.id === LR2)!.rfq_line_id = id(99);
    const c = await card("rfq", { deal: "OPP-0036", suppliers: ["SUP-0001"] });
    expect(c.facts![1]).toEqual({ label: "Lines without a price", value: "1" });
    expect((await press(c)).status).toBe(200);
    expect(rows("rfq_lines").map((l) => l.description)).toEqual(["Centrifugal pump 5kW"]);
  });

  it("a supplier is named, never guessed: an unknown or partial name asks, and another workspace's supplier is not found", async () => {
    expect(await reason("rfq", { deal: "OPP-0036", suppliers: ["Gulf"] })).toMatch(/No supplier is called exactly "Gulf"\. Closest: SUP-0001 · Gulf Steel Trading/);
    expect(await reason("rfq", { deal: "OPP-0036", suppliers: ["Foreign Pumps"] })).toMatch(/No supplier matched "Foreign Pumps"/);
    expect(await reason("rfq", { deal: "OPP-0036", suppliers: [SUP_FOREIGN] })).toMatch(/No supplier matched/);
    expect(await reason("rfq", { deal: "OPP-0036", suppliers: [] })).toMatch(/Which suppliers/);
  });

  it("no card when every line already has a price", async () => {
    rows("opportunity_lines").filter((l) => l.opportunity_id === D_RFQ).forEach((l) => { l.rate = 10; });
    expect(await reason("rfq", { deal: "OPP-0036", suppliers: ["SUP-0001"] })).toMatch(/already has a price or is on an RFQ/);
  });

  it("a supplier deleted since the card was shown refuses the press", async () => {
    const c = await card("rfq", { deal: "OPP-0036", suppliers: ["SUP-0001"] });
    S.db.tables.suppliers = rows("suppliers").filter((s) => s.id !== SUP_A);
    expect(await press(c)).toMatchObject({ status: 422, body: { code: "ref" } });
    expect(rows("rfqs")).toHaveLength(0);
  });
});

describe("(d) create an estimate from a named template", () => {
  it("takes the template's own inputs by label, shows only the ones given, and creates it on the deal", async () => {
    const c = await card("estimate", { deal: "OPP-0038", template: "pipe run", inputs: { Length: "3", "Grade": "Grade B" }, margin_pct: "10" });
    expect(c).toMatchObject({ action: "verb", primaryLabel: "Create estimate", title: "Create estimate: Pipe run" });
    expect(c.fields.map((f) => [f.key, f.label, f.value])).toEqual([
      ["name", "Name", "Pipe run · OPP-0038 Pipe run job"], ["margin_pct", "Margin (%)", "10"], ["in_x", "Length (m)", "3"], ["in_grade", "Grade", "b"],
    ]);
    expect(c.fields.find((f) => f.key === "in_grade")!.options).toEqual([{ value: "a", label: "Grade A" }, { value: "b", label: "Grade B" }]);
    expect(c.facts).toEqual([{ label: "Template", value: "Pipe run" }, { label: "For", value: "OPP-0038 Pipe run job" }]);

    const out = await press(c, { ...valuesOf(c), name: "Pipe run, route 4" });
    expect(out.body.error).toBeUndefined();
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ ok: true, message: "Created estimate EST-0001 on OPP-0038 Pipe run job", record: { label: "EST-0001" } });
    const est = rows("estimates")[0];
    expect(est).toMatchObject({ tenant_id: T1, name: "Pipe run, route 4", template_id: TPL, opportunity_id: D_EST, margin_pct: 10, account_id: ACC });
    expect(est.params).toMatchObject({ x: 3, grade: "b" });
    expect(rows("estimate_lines").map((l) => l.cost_total)).toEqual([60]);
    expect(rows("change_log").find((r) => r.object_type === "estimates")).toMatchObject({ action: "create", via: "assistant" });
    expect(rows("assistant_actions")[0]).toMatchObject({ kind: "verb", action_key: "tender_estimate", status: "done" });
  });

  it("an input that is not the template's, or out of range, is a note on the card, never a silent drop", async () => {
    const c = await card("estimate", { deal: "OPP-0038", template: "Pipe run", inputs: { Length: "9000", Colour: "red", Grade: "Grade Z" } });
    expect(c.fields.map((f) => f.key)).toEqual(["name", "margin_pct"]);
    expect(c.notices.join(" ")).toContain("Length cannot be above 500");
    expect(c.notices.join(" ")).toContain('"Colour" is not an input of this template');
    expect(c.notices.join(" ")).toContain('Grade: "Grade Z" is not one of the options');
  });

  it("the template is named, never guessed: inactive, partial, unknown and another workspace's are not used", async () => {
    expect(await reason("estimate", { deal: "OPP-0038", template: "Pipe" })).toBe("");
    expect(await reason("estimate", { deal: "OPP-0038", template: "Old pipe run" })).toMatch(/No estimate template is called "Old pipe run"/);
    expect(await reason("estimate", { deal: "OPP-0038", template: "Foreign template" })).toMatch(/Templates: Pipe run/);
    expect(await reason("estimate", { deal: "OPP-0038", template: "Nope" })).toMatch(/No estimate template/);
    expect(await reason("estimate", { deal: "OPP-0038" })).toMatch(/Which estimate template/);
  });

  it("a field that is not on the card is refused, and an input outside the template's range is refused by the route's own maths", async () => {
    const c = await card("estimate", { deal: "OPP-0038", template: "Pipe run", inputs: { Length: "3" } });
    expect(await press(c, { ...valuesOf(c), in_grade: "b" })).toMatchObject({ status: 422, body: { code: "unknown_field" } });
    expect(await press(c, { ...valuesOf(c), in_x: "9000" })).toMatchObject({ status: 422 });
    expect(rows("estimates")).toHaveLength(0);
  });
});

describe("(e) match to products and (f) price all", () => {
  async function withBoq() {
    const file = await messyWorkbook({
      rows: [
        ["1.1", "Supply and install gate valve 100mm DN100", "no", 4, "cc1"],
        ["1.2", "Mobilisation", "lot", 1, "cc4"],
      ],
    });
    const { POST } = await import("@/app/api/opportunities/[id]/boq/route");
    const form = new FormData();
    form.set("file", new File([new Uint8Array(file)], "client boq.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const { NextRequest } = await import("next/server");
    const res = await POST(new NextRequest(new URL("http://internal.invalid/x"), { method: "POST", body: form }), { params: Promise.resolve({ id: D_BOQ }) });
    expect(res.status).toBe(200);
  }

  it("match: counts the lines without a product and the strong matches, links only those, and says what it left", async () => {
    await withBoq();
    const c = await card("match", { deal: "OPP-0037" });
    expect(c).toMatchObject({ action: "verb", primaryLabel: "Match to products", fields: [] });
    expect(c.facts).toEqual([{ label: "Lines without a product", value: "2" }, { label: "Strong matches to link", value: "1" }, { label: "Left for you to pick", value: "1" }]);
    const out = await press(c);
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ ok: true, message: "Linked 1 line to products" });
    const linked = rows("opportunity_lines").filter((l) => l.opportunity_id === D_BOQ && l.product_id);
    expect(linked.map((l) => l.product_id)).toEqual([P_GATE]);
    expect(rows("change_log").find((r) => JSON.stringify(r.changes).includes("BOQ product"))).toMatchObject({ via: "assistant", tenant_id: T1 });
    expect(await reason("match", { deal: "OPP-0037" })).toMatch(/None of the 1 lines/);
  });

  it("match: lines that moved since the card was shown are refused by the route and nothing is linked", async () => {
    await withBoq();
    const c = await card("match", { deal: "OPP-0037" });
    rows("opportunity_lines").filter((l) => l.opportunity_id === D_BOQ)[0].qty = 99;
    expect(await press(c)).toMatchObject({ status: 409, body: { code: "route_refused" } });
    expect(rows("opportunity_lines").filter((l) => l.opportunity_id === D_BOQ && l.product_id)).toHaveLength(0);
    expect(rows("assistant_actions")[0]).toMatchObject({ status: "failed" });
  });

  it("match: no Products module, no BOQ, or a deal outside this workspace gives no card", async () => {
    await withBoq();
    S.features = { ...ON, products: false };
    expect(await reason("match", { deal: "OPP-0037" })).toMatch(/Products module is not on/);
    S.features = ON;
    expect(await reason("match", { deal: "OPP-0036" })).toBeTruthy();
    expect(await reason("match", { deal: D_FOREIGN })).toMatch(/No tender deal matched/);
  });

  it("price all: shows the unpriced count and the workspace's markup, takes the person's, and prices through the BOQ route", async () => {
    await withBoq();
    rows("opportunity_lines").find((l) => l.opportunity_id === D_BOQ && String(l.description).startsWith("Supply and install"))!.product_id = P_GATE;
    rows("products").find((p) => p.id === P_GATE)!.cost_price_as_of = "2026-10-20";
    const c = await card("price", { deal: "OPP-0037", markup_pct: "20" });
    expect(c).toMatchObject({ action: "verb", primaryLabel: "Price all" });
    expect(c.fields).toMatchObject([{ key: "markup_pct", label: "Markup on cost (%)", value: "20", required: true, widget: "number" }]);
    expect(c.facts).toEqual([{ label: "Lines without a price", value: "2" }, { label: "Lines in the BOQ", value: "2" }]);
    const out = await press(c, { markup_pct: "25" });
    expect(out.status).toBe(200);
    expect(String(out.body.message)).toMatch(/^Priced \d+ lines?$/);
    expect(rows("change_log").find((r) => String(r.changes && JSON.stringify(r.changes)).includes("BOQ price all"))).toMatchObject({ via: "assistant", tenant_id: T1 });
    expect(rows("assistant_actions")[0]).toMatchObject({ kind: "verb", action_key: "tender_price", status: "done" });
  });

  it("price all: the default markup when none is given, a note when it is out of range, and no card when every line has a price", async () => {
    await withBoq();
    const dflt = await card("price", { deal: "OPP-0037" });
    expect(dflt.fields[0].value).toBe("15");
    const bad = await card("price", { deal: "OPP-0037", markup_pct: "5000" });
    expect(bad.fields[0].value).toBe("15");
    expect(bad.notices.join(" ")).toMatch(/between 0 and 1000/);
    expect(await reason("price", { deal: "OPP-0036" })).toMatch(/BOQ is empty\. Upload it on the BOQ tab first/);
    rows("opportunity_lines").filter((l) => l.opportunity_id === D_BOQ).forEach((l) => { l.rate = 10; });
    expect(await reason("price", { deal: "OPP-0037" })).toMatch(/already has a price/);
  });
});

describe("what every tender step shares", () => {
  it("one press, the signed record, and the checks at the press: flag, modules, edit grant", async () => {
    const c = await card("decision", { deal: "OPP-0034", decision: "go", reason: "Good fit" });
    expect(await press(c, undefined, { userId: "user-2" })).toMatchObject({ status: 403, body: { code: "token" } });
    expect(await press(c, undefined, { tenantId: T2 })).toMatchObject({ status: 403, body: { code: "token" } });
    for (const features of [{ ...ON, ai_assistant_actions: false }, { ...ON, ai_assistant: false }, { ...ON, gcc_tender: false }, { ...ON, pipeline: false }, {}]) {
      expect(await press(c, undefined, { features }), JSON.stringify(features)).toMatchObject({ status: 403, body: { code: "not_allowed" } });
    }
    const viewOnly: PermissionSet = { unrestricted: false, grants: new Map([["pipeline", { workcenter: "pipeline", canView: true, canCreate: true, canEdit: false, canDelete: false }]]) };
    expect(await press(c, undefined, { perms: viewOnly })).toMatchObject({ status: 403, body: { code: "not_allowed" } });
    expect(rows("approval_requests")).toHaveLength(0);

    expect((await press(c, undefined, { features: { ai_assistant: true, ai_assistant_actions: true, gcc_tender: true, pipeline: true } })).status).toBe(200);
    const again = await press(c);
    expect(again).toMatchObject({ status: 409, body: { code: "already_done" } });
    expect(rows("approval_requests")).toHaveLength(1);
  });

  it("an RFQ or estimate step needs the RFQ or Estimates grant as well as Pipeline", async () => {
    const c = await card("rfq", { deal: "OPP-0036", suppliers: ["SUP-0001"] });
    const pipelineOnly: PermissionSet = { unrestricted: false, grants: new Map([["pipeline", { workcenter: "pipeline", canView: true, canCreate: true, canEdit: true, canDelete: false }]]) };
    expect(await press(c, undefined, { perms: pipelineOnly })).toMatchObject({ status: 403, body: { code: "not_allowed" } });
    expect(await press(c, undefined, { features: { ...ON, rfq: false } })).toMatchObject({ status: 403, body: { code: "not_allowed" } });
    expect(rows("rfqs")).toHaveLength(0);
  });

  it("a deal that left this workspace's tenders since the card was shown is refused", async () => {
    const c = await card("decision", { deal: "OPP-0034", decision: "go", reason: "Good fit" });
    S.db.tables.opportunity_tenders = rows("opportunity_tenders").filter((t) => t.opportunity_id !== D_DECIDE);
    expect(await press(c)).toMatchObject({ status: 422, body: { code: "record" } });
  });

  it("the card carries no id the model supplied: a deal id in the input is just a name that must resolve in this workspace", async () => {
    expect(await reason("decision", { deal: D_FOREIGN, decision: "go", reason: "x" })).toMatch(/No tender deal matched/);
    const c = await card("decision", { deal: D_DECIDE, decision: "go", reason: "x" });
    expect(c.title).toContain("OPP-0034");
  });

  it("the ledger rows hold names and values the person confirmed, never an id the model chose", async () => {
    const c = await card("rfq", { deal: "OPP-0036", suppliers: ["SUP-0001"] });
    await press(c, { title: "Pumps", respond_by: "" });
    const audit = JSON.stringify(rows("assistant_actions"));
    expect(audit).not.toContain(SUP_FOREIGN);
    expect(rows("assistant_actions")[0].params).toMatchObject({ id: D_RFQ, values: { title: "Pumps" } });
  });
});

describe("the tester's sentences with a tender open: one card from tender_action, or the reason, with no model", () => {
  const modelCalls = vi.fn(async () => { throw new Error("the model must not be asked"); });
  const say = (history: ChatTurn[] | string, open: string | null = D_BOQ): Promise<AssistantReply> => askAssistant(
    typeof history === "string" ? [{ role: "user", text: history }] : history,
    {
      supabase: { from: (t: string) => S.db.from(t) } as never, tenantId: T1, userId: ME, perms: ALL, currency: CURRENCIES.SAR, features: S.features, isAdmin: true,
      route: open ? `/pipeline/${open}` : "/", meter: { allowed: false, open: async () => ({ allowed: false }) } as never,
      anthropic: { messages: { create: modelCalls } } as never, screenDeps: { loadFields: async () => [] as never },
    },
  );
  const MATCH = "Match the BOQ to products.";
  const PRICE = "Price all lines with 12 percent markup.";
  const RFQ = "Raise an RFQ to Gulf Steel Trading and Najd Valves for the geotextile lines.";

  const addBoqSuppliers = () => rows("suppliers").push({ id: id(23), tenant_id: T1, name: "Tihama Geosynthetics", ref: "SUP-0003", email: "t@x.test", phone: null }, { id: id(24), tenant_id: T1, name: "Arkan Waterproofing Systems", ref: "SUP-0004", email: "a@x.test", phone: null });

  async function upload(lines: (string | number)[][]) {
    const file = await messyWorkbook({ rows: lines });
    const { POST } = await import("@/app/api/opportunities/[id]/boq/route");
    const form = new FormData();
    form.set("file", new File([new Uint8Array(file)], "client boq.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const { NextRequest } = await import("next/server");
    expect((await POST(new NextRequest(new URL("http://internal.invalid/x"), { method: "POST", body: form }), { params: Promise.resolve({ id: D_BOQ }) })).status).toBe(200);
  }
  const BOQ = [
    ["1.1", "Supply and install gate valve 100mm DN100", "no", 4, "cc1"],
    ["1.2", "Non-woven geotextile 300 gsm", "m2", 900, "cc2"],
    ["1.3", "Mobilisation", "lot", 1, "cc4"],
  ];

  beforeEach(() => { modelCalls.mockClear(); addBoqSuppliers(); });

  it("'Match the BOQ to products.' shows the match card, not a link, and writes nothing", async () => {
    await upload(BOQ);
    const r = await say(MATCH);
    expect(r.card).toMatchObject({ action: "verb", object: "match", primaryLabel: "Match to products", title: "Match to products: OPP-0037 Valves for Plant 7" });
    expect(r.cards).toBeUndefined();
    expect(rows("opportunity_lines").filter((l) => l.opportunity_id === D_BOQ && l.product_id)).toHaveLength(0);
    expect(modelCalls).not.toHaveBeenCalled();
    expect((await press(r.card!)).status).toBe(200);
  });

  it("'Price all lines with 12 percent markup.' shows the price card with 12, never an unknown-screen answer", async () => {
    await upload(BOQ);
    const r = await say(PRICE);
    expect(r.card).toMatchObject({ object: "price", primaryLabel: "Price all" });
    expect(valuesOf(r.card!)).toEqual({ markup_pct: "12" });
    expect(r.answer).not.toMatch(/screen/i);
    expect(modelCalls).not.toHaveBeenCalled();
  });

  it("an RFQ for the geotextile lines holds only those lines, on the card and after the press", async () => {
    await upload(BOQ);
    const r = await say("Raise an RFQ to Tihama Geosynthetics and Arkan Waterproofing Systems for the geotextile lines.");
    expect(r.card!.facts).toEqual([
      { label: "Suppliers", value: "Tihama Geosynthetics, Arkan Waterproofing Systems" }, { label: "Lines without a price", value: "1" },
      { label: "Only these lines", value: "1.2 Non-woven geotextile 300 gsm" },
    ]);
    expect(r.card!.summary).toContain('matching "geotextile" that have no price');
    expect(modelCalls).not.toHaveBeenCalled();
    expect((await press(r.card!)).status).toBe(200);
    expect(rows("rfq_lines").map((l) => l.description)).toEqual(["Non-woven geotextile 300 gsm"]);
    expect(rows("change_log").find((x) => x.object_type === "rfqs")).toMatchObject({ action: "create", via: "assistant" });
  });

  it("a BOQ with no geotextile line says which words matched nothing and what is there; no card", async () => {
    await upload([BOQ[0], BOQ[2]]);
    const r = await say(RFQ);
    expect(r.card).toBeUndefined();
    expect(r.answer).toBe('No line on this tender\'s BOQ matches "geotextile". Its lines include: 1.1 Supply and install gate valve 100mm DN100; 1.3 Mobilisation.');
    expect(modelCalls).not.toHaveBeenCalled();
  });

  it("an empty BOQ: match, price and RFQ each say so, every time, with no card", async () => {
    for (const sentence of [MATCH, PRICE, RFQ, "Raise an RFQ to Gulf Steel Trading for the geotextile lines."]) {
      const r = await say(sentence);
      expect(r.answer, sentence).toBe(EMPTY_BOQ);
      expect(r.card, sentence).toBeUndefined();
      expect(r.cards, sentence).toBeUndefined();
    }
    const twice = await say([{ role: "user", text: MATCH }, { role: "assistant", text: EMPTY_BOQ }, { role: "user", text: PRICE }]);
    expect(twice.answer).toBe(EMPTY_BOQ);
    expect(modelCalls).not.toHaveBeenCalled();
  });

  it("with no tender open it asks which one in one line, and the reference typed next gives the card", async () => {
    await upload(BOQ);
    const first = await say(PRICE, null);
    expect(first.card).toBeUndefined();
    expect(first.answer).toBe("Which tender is this for? Give its reference (for example OPP-0034), or open the tender and ask again.");
    const second = await say([{ role: "user", text: PRICE }, { role: "assistant", text: first.answer }, { role: "user", text: "OPP-0037" }], null);
    expect(second.card).toMatchObject({ object: "price", title: "Price all: OPP-0037 Valves for Plant 7" });
    expect((await say(PRICE, D_PLAIN)).answer).toBe(first.answer);
    expect((await say("Match the BOQ to products on OPP-0037", null)).card).toMatchObject({ object: "match" });
    expect(modelCalls).not.toHaveBeenCalled();
  });

  it("a supplier name that is not exact is asked back with the closest ones", async () => {
    await upload(BOQ);
    const r = await say("Raise an RFQ to Tihama for the geotextile lines");
    expect(r.card).toBeUndefined();
    expect(r.answer).toBe('No supplier is called exactly "Tihama". Closest: SUP-0003 · Tihama Geosynthetics. Which one do you mean?');
  });

  it("another workspace's deal is never found, and without the actions flag the sentence is left to the model", async () => {
    expect((await say("Price all lines on OPP-9999", null)).answer).toBe('I found no tender deal matching "OPP-9999" in this workspace.');
    S.features = { ...ON, ai_assistant_actions: false };
    expect((await say(PRICE)).overBudget).toBe(true);
  });
});

describe("when the model is asked: a screen it names never replaces a tender step, and a typed name is kept", () => {
  type Block = Record<string, unknown>;
  const turn = (...content: Block[]) => ({ content, stop_reason: content.some((c) => c.type === "tool_use") ? "tool_use" : "end_turn", usage: { input_tokens: 10, output_tokens: 10 } });
  const use = (name: string, input: unknown, tid: string) => ({ type: "tool_use", id: tid, name, input });
  const words = (t: string) => ({ type: "text", text: t });

  async function run(question: string, replies: unknown[], features: Record<string, boolean> = ON) {
    S.features = features;
    const create = vi.fn(async () => replies.shift());
    const meter = new AssistantMeter({ tenantId: T1, userId: ME, budget: 1_000_000 }, {
      allowanceFor: vi.fn(async () => ({ allowed: true, used: 0, budget: 1_000_000, remaining: 1_000_000 })), logUsage: vi.fn(async () => {}) as never,
    });
    const reply = await askAssistant([{ role: "user", text: question }], {
      supabase: { from: (t: string) => S.db.from(t) } as never, tenantId: T1, userId: ME, perms: ALL, currency: CURRENCIES.SAR, features, isAdmin: true,
      route: `/pipeline/${D_RFQ}`, meter, anthropic: { messages: { create } } as never, screenDeps: { loadFields: async () => [] as never },
    });
    return { reply, create };
  }
  const NAV = use("navigate", { target: "none", asked_for: "Bill of quantities" }, "n1");
  const STEP = use("tender_action", { verb: "rfq", summary: "Ask for prices.", suppliers: ["SUP-0001"] }, "s1");

  it.each([
    ["navigate before the step, in one turn", [turn(NAV, STEP), turn(words("Check the card."))]],
    ["navigate after the card, in a later turn", [turn(STEP), turn(NAV), turn(words("Check the card."))]],
  ])("%s: the card is kept and nothing says the screen is unknown", async (_n, replies) => {
    const { reply } = await run("get prices from Gulf Steel for what is still open here", [...replies]);
    expect(reply.card).toMatchObject({ object: "rfq" });
    expect(reply.answer).toBe("Check the card.");
  });

  it("an empty BOQ is answered in the server's words, whatever the model would have added", async () => {
    const { reply, create } = await run("what about pricing this one for me", [turn(use("tender_action", { verb: "price", summary: "Price." }, "s1")), turn(words("All lines are priced."))]);
    expect(reply.answer).toBe(EMPTY_BOQ);
    expect(reply.card).toBeUndefined();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("'Delta Contracting [qa]' keeps its suffix when the model drops it, and the pressed card is marked 'via assistant'", async () => {
    S.db.tables.opportunity_competitors = [];
    const { reply } = await run("Add Delta Contracting [qa] as a competitor", [turn(use("propose_competitor", { name: "Delta Contracting" }, "c1")), turn(words("Check the card."))]);
    const c = reply.card!;
    expect(c.fields.find((f) => f.key === "name")!.value).toBe("Delta Contracting [qa]");
    const out = await pressCompetitorCard(
      { supabase: { from: (t: string) => S.db.from(t) } as never, admin: { from: (t: string) => S.db.from(t) } as never, tenantId: T1, userId: ME, perms: ALL, features: ON, baseUrl: "https://kamco.example.com/api/ai/act/competitor" },
      { card_id: c.id, token: c.token, values: valuesOf(c) },
    );
    expect(out.body).toMatchObject({ ok: true });
    expect(rows("opportunity_competitors").map((x) => x.name)).toEqual(["Delta Contracting [qa]"]);
    expect(rows("change_log").find((x) => x.object_type === "opportunity_competitors")).toMatchObject({ tenant_id: T1, via: "assistant" });
  });
});
