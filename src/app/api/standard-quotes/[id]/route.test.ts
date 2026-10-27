import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type Row } from "@/lib/marketing/testFakeDb";

let current: ReturnType<typeof fakeDb>;
const logged: { objectType: string; objectId: string }[] = [];
let features: Record<string, boolean> = { standard_quotes: true, pipeline: true };

vi.mock("@/lib/supabase-server", () => ({
  requireTenantUser: async () => ({ supabase: current.client, tenantId: "t1", userId: "u1", role: "admin" }),
  createAdminSupabase: () => current.client,
  getAuthUser: async () => ({ id: "u1", email: "u@x.test" }),
}));
vi.mock("@/lib/tenant", () => ({
  tenantHasFeature: async (_s: unknown, _t: string, key: string) => features[key] === true,
  getTenant: async () => ({ config: {}, features }),
}));
vi.mock("@/lib/changeLog", async () => {
  const real = await vi.importActual<typeof import("@/lib/changeLog")>("@/lib/changeLog");
  return { ...real, logChange: async (_s: unknown, e: (typeof logged)[number]) => { logged.push(e); } };
});
vi.mock("@/lib/middleware/schedule", () => ({ scheduleQuoteDispatch: vi.fn() }));

const route = await import("./route");

const sq = (over: Row = {}): Row => ({
  id: "sq1", tenant_id: "t1", ref: "SQ-1", status: "sent", account_id: "a1", contact_id: null, opportunity_id: "o1",
  subtotal: 100, total: 100, header_discount_pct: 0, tax_pct: 0, shipping_amount: 0, closed_at: null, sent_at: "2026-10-01T00:00:00Z", ...over,
});
const deal = (over: Row = {}): Row => ({
  id: "o1", tenant_id: "t1", ref: "OPP-1", title: "Plant", account_id: "a1", contact_id: null, stage: "propose", outcome: "open",
  probability: 50, probability_override: null, amount: 0, ...over,
});
const patch = (status: string) => route.PATCH(new Request("http://x/api/standard-quotes/sq1", { method: "PATCH", body: JSON.stringify({ status }) }) as never, { params: Promise.resolve({ id: "sq1" }) });
const names = () => (current.tables.domain_event ?? []).map((e) => e.name);

function seed(quote: Row = sq(), opp: Row = deal()) {
  current = fakeDb({
    tenants: [{ id: "t1", features }],
    standard_quotes: [quote],
    standard_quote_lines: [],
    opportunities: [opp],
  }, { copyReads: true });
}

beforeEach(() => {
  logged.length = 0;
  features = { standard_quotes: true, pipeline: true };
});

describe("PATCH /api/standard-quotes/[id] -- accepted wins the deal", () => {
  it("closes its open deal as won, with a change-history entry on the deal, and emits quote.accepted", async () => {
    seed();
    const res = await patch("accepted");
    expect(res.status).toBe(200);
    expect(current.tables.opportunities[0]).toMatchObject({ stage: "won", outcome: "won", probability: 100 });
    expect(logged.filter((l) => l.objectType === "opportunities")).toHaveLength(1);
    expect(names()).toContain("quote.accepted");
    expect(names()).toContain("opportunity.closed");
    expect(names().filter((n) => n === "quote.accepted")).toHaveLength(1);
    const accepted = (current.tables.domain_event ?? []).find((e) => e.name === "quote.accepted")!;
    expect(accepted).toMatchObject({ tenant_id: "t1", object_type: "standard_quote", object_id: "sq1" });
  });

  it("is idempotent: accepting again changes nothing more", async () => {
    seed();
    await patch("accepted");
    const events = names().length;
    const closes = logged.length;
    await patch("accepted");
    expect(names()).toHaveLength(events);
    expect(logged).toHaveLength(closes);
    expect(current.tables.opportunities[0].stage).toBe("won");
  });

  it("rejected changes nothing on the deal", async () => {
    seed();
    await patch("rejected");
    expect(current.tables.opportunities[0]).toMatchObject({ stage: "propose", outcome: "open" });
    expect(names()).not.toContain("quote.accepted");
  });

  it.each([["lost", "lost"], ["won", "won"], ["lost", "dropped"]])("never touches a deal that is already %s (%s)", async (stage, outcome) => {
    seed(sq(), deal({ stage, outcome, probability: 0, closed_at: "2026-02-02T00:00:00Z" }));
    await patch("accepted");
    expect(current.tables.opportunities[0]).toMatchObject({ stage, outcome, closed_at: "2026-02-02T00:00:00Z" });
  });

  it("a quote with no deal just accepts", async () => {
    seed(sq({ opportunity_id: null }));
    const res = await patch("accepted");
    expect(res.status).toBe(200);
    expect(current.tables.opportunities[0].outcome).toBe("open");
    expect(names()).toContain("quote.accepted");
  });

  it("a deal that belongs to another tenant is not closed", async () => {
    seed(sq(), deal({ tenant_id: "t2" }));
    await patch("accepted");
    expect(current.tables.opportunities[0]).toMatchObject({ stage: "propose", outcome: "open" });
  });

  it("without Pipeline the deal is left alone", async () => {
    features = { standard_quotes: true, pipeline: false };
    seed();
    current.tables.tenants[0].features = features;
    await patch("accepted");
    expect(current.tables.opportunities[0].outcome).toBe("open");
  });
});
