import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type Row } from "@/lib/marketing/testFakeDb";
import { DEFAULT_OPPORTUNITY_STAGES } from "@/lib/constants";

let current: ReturnType<typeof fakeDb>;
const logged: { objectType: string; objectId: string; tenantId: string; changes?: { field: string; to: unknown }[] }[] = [];

vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: () => current.client }));
vi.mock("@/lib/changeLog", async () => {
  const real = await vi.importActual<typeof import("@/lib/changeLog")>("@/lib/changeLog");
  return { ...real, logChange: async (_s: unknown, e: (typeof logged)[number]) => { logged.push(e); } };
});

const { closeOpportunityAsWon, wonStage } = await import("./closeDeal");

const deal = (over: Row = {}): Row => ({
  id: "o1", tenant_id: "t1", ref: "OPP-1", title: "Plant", account_id: "a1", contact_id: null, stage: "propose", outcome: "open",
  probability: 50, probability_override: null, amount: 1000, ...over,
});
const events = () => current.tables.domain_event ?? [];
const actor = { id: "u1", email: "u@x.com" };

beforeEach(() => { logged.length = 0; });

describe("closeOpportunityAsWon", () => {
  it("closes an open deal as won: stage, outcome, closed_at, probability, change history and both events", async () => {
    current = fakeDb({ opportunities: [deal()] }, { copyReads: true });
    const r = await closeOpportunityAsWon(current.client, { tenantId: "t1", opportunityId: "o1", stages: DEFAULT_OPPORTUNITY_STAGES, actor, reason: "Quote SQ-1 accepted" });
    expect(r).toEqual({ status: "closed", stage: "won" });
    const row = current.tables.opportunities[0];
    expect(row).toMatchObject({ stage: "won", outcome: "won", probability: 100, loss_reason: null });
    expect(typeof row.closed_at).toBe("string");
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ tenantId: "t1", objectType: "opportunities", objectId: "o1" });
    expect(logged[0].changes?.[0]).toEqual({ field: "Closed as won", from: null, to: "Quote SQ-1 accepted" });
    expect(logged[0].changes).toEqual(expect.arrayContaining([{ field: "stage", from: "propose", to: "won" }, { field: "outcome", from: "open", to: "won" }]));
    expect(events().map((e) => e.name).sort()).toEqual(["opportunity.closed", "opportunity.stage_changed"]);
    expect(events().every((e) => e.tenant_id === "t1" && e.object_id === "o1")).toBe(true);
  });

  it("is idempotent: a second close changes nothing and emits nothing more", async () => {
    current = fakeDb({ opportunities: [deal()] });
    const args = { tenantId: "t1", opportunityId: "o1", stages: DEFAULT_OPPORTUNITY_STAGES, actor, reason: "r" };
    await closeOpportunityAsWon(current.client, args);
    const r2 = await closeOpportunityAsWon(current.client, args);
    expect(r2.status).toBe("already_closed");
    expect(logged).toHaveLength(1);
    expect(events()).toHaveLength(2);
  });

  it.each([["won", "won"], ["lost", "lost"], ["lost", "dropped"]])("never reopens or touches a deal that is already %s (outcome %s)", async (stage, outcome) => {
    current = fakeDb({ opportunities: [deal({ stage, outcome, closed_at: "2026-01-01T00:00:00Z", probability: 0 })] });
    const r = await closeOpportunityAsWon(current.client, { tenantId: "t1", opportunityId: "o1", stages: DEFAULT_OPPORTUNITY_STAGES, actor, reason: "r" });
    expect(r.status).toBe("already_closed");
    expect(current.tables.opportunities[0]).toMatchObject({ stage, outcome, closed_at: "2026-01-01T00:00:00Z", probability: 0 });
    expect(logged).toHaveLength(0);
    expect(events()).toHaveLength(0);
  });

  it("is tenant-scoped: another tenant's deal id matches nothing and is not changed", async () => {
    current = fakeDb({ opportunities: [deal({ tenant_id: "t2" })] });
    const r = await closeOpportunityAsWon(current.client, { tenantId: "t1", opportunityId: "o1", stages: DEFAULT_OPPORTUNITY_STAGES, actor, reason: "r" });
    expect(r.status).toBe("not_found");
    expect(current.tables.opportunities[0]).toMatchObject({ stage: "propose", outcome: "open" });
    expect(events()).toHaveLength(0);
  });

  it("uses the tenant's own won stage, and does nothing when it has none", async () => {
    const custom = [
      { value: "new", label: "New", color: "#000", is_initial: true },
      { value: "signed", label: "Signed", color: "#000", is_closed: true, outcome: "won" as const },
      { value: "gone", label: "Gone", color: "#000", is_closed: true, outcome: "lost" as const },
    ];
    expect(wonStage(custom)?.value).toBe("signed");
    current = fakeDb({ opportunities: [deal({ stage: "new" })] });
    expect((await closeOpportunityAsWon(current.client, { tenantId: "t1", opportunityId: "o1", stages: custom, actor, reason: "r" })).status).toBe("closed");
    expect(current.tables.opportunities[0].stage).toBe("signed");

    const noWon = [{ value: "new", label: "New", color: "#000", is_initial: true }, { value: "gone", label: "Gone", color: "#000", is_closed: true, outcome: "lost" as const }];
    current = fakeDb({ opportunities: [deal({ stage: "new" })] });
    expect((await closeOpportunityAsWon(current.client, { tenantId: "t1", opportunityId: "o1", stages: noWon, actor, reason: "r" })).status).toBe("no_won_stage");
    expect(current.tables.opportunities[0].outcome).toBe("open");
  });
});
