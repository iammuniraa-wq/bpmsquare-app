import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: vi.fn() }));

import { effectiveLeadStage, legacyStatusForStage, stageForLegacyStatus, LEAD_STAGES } from "./leadStages";
import { ensureLeadStatusProfile, setLeadStage } from "./leadStatus";
import { fakeDb } from "./testFakeDb";

describe("lead stages vs today's six values", () => {
  it("maps the six legacy values onto the eight stages", () => {
    expect(stageForLegacyStatus("new")).toBe("new");
    expect(stageForLegacyStatus("inspecting")).toBe("working");
    expect(stageForLegacyStatus("quoted")).toBe("working");
    expect(stageForLegacyStatus("converted")).toBe("deal");
    expect(stageForLegacyStatus("won")).toBe("customer");
    expect(stageForLegacyStatus("lost")).toBe("not_now");
    expect(stageForLegacyStatus("something-else")).toBe("new");
  });

  it("keeps leads.status to a value the existing screens know, for every stage", () => {
    const known = ["new", "inspecting", "quoted", "won", "lost", "converted"];
    for (const s of LEAD_STAGES) expect(known).toContain(legacyStatusForStage(s.key));
  });

  it("a stored stage stands while the old column agrees, and the old column wins once an older screen moved it", () => {
    expect(effectiveLeadStage({ status: "new" }, "ready")).toBe("ready");
    expect(effectiveLeadStage({ status: "converted" }, "ready")).toBe("deal");
    expect(effectiveLeadStage({ status: "quoted" }, "working")).toBe("working");
  });
});

const seed = (features: Record<string, boolean>) => ({
  tenants: [{ id: "t1", features }],
  leads: [{ id: "l1", tenant_id: "t1", account_id: "a1", contact_id: null, status: "new", custom_status_id: null }, { id: "l2", tenant_id: "t2", account_id: "a2", status: "new" }],
  status_profile: [] as Record<string, unknown>[],
  custom_status: [] as Record<string, unknown>[],
  status_transition_rule: [] as Record<string, unknown>[],
  status_history: [] as Record<string, unknown>[],
  domain_event: [] as Record<string, unknown>[],
});

describe("ensureLeadStatusProfile", () => {
  it("creates the profile, eight stages and rules once, and is idempotent", async () => {
    const { client, tables } = fakeDb(seed({}));
    const a = await ensureLeadStatusProfile(client, "t1");
    const b = await ensureLeadStatusProfile(client, "t1");
    expect(a?.size).toBe(8);
    expect(b?.size).toBe(8);
    expect(tables.status_profile).toHaveLength(1);
    expect(tables.custom_status).toHaveLength(8);
    expect(tables.status_transition_rule).toHaveLength(8);
    expect(tables.custom_status.every((s) => s.tenant_id === "t1" && s.entity_type === "leads")).toBe(true);
  });
});

describe("setLeadStage", () => {
  const on = { marketing: true, marketing_scoring: true };
  const move = (client: ReturnType<typeof fakeDb>["client"], over: Partial<Parameters<typeof setLeadStage>[0]> = {}) =>
    setLeadStage({ tenantId: "t1", leadId: "l1", to: "ready", userId: "u1", role: "admin", client, ...over });

  it("is refused outright when the flag is off, and writes nothing", async () => {
    const { client, tables } = fakeDb(seed({ marketing: true }));
    const r = await move(client);
    expect(r).toMatchObject({ ok: false, status: 404 });
    expect(tables.status_profile).toHaveLength(0);
    expect(tables.leads[0].custom_status_id).toBeNull();
  });

  it("moves the lead, keeps leads.status valid, records history and emits lead.stage_changed", async () => {
    const { client, tables } = fakeDb(seed(on));
    const r = await move(client, { to: "working" });
    expect(r).toEqual({ ok: true, stage: "working", from: "new" });
    expect(tables.leads[0].status).toBe("inspecting");
    expect(tables.leads[0].custom_status_id).toBeTruthy();
    expect(tables.status_history).toHaveLength(1);
    expect(tables.status_history[0]).toMatchObject({ entity_type: "leads", system_status_code_after: "WORKING" });
    expect(tables.domain_event[0]).toMatchObject({ name: "lead.stage_changed", tenant_id: "t1" });
  });

  it("starts from the stage the old status implies", async () => {
    const s = seed(on);
    s.leads[0].status = "quoted";
    const r = await move(fakeDb(s).client, { to: "deal" });
    expect(r).toMatchObject({ ok: true, from: "working", stage: "deal" });
  });

  it("a lead from another tenant is not found", async () => {
    const { client } = fakeDb(seed(on));
    expect(await move(client, { leadId: "l2" })).toMatchObject({ ok: false, status: 404 });
  });

  it("is a no-op when already there", async () => {
    const { client, tables } = fakeDb(seed(on));
    expect(await move(client, { to: "new" })).toMatchObject({ ok: true, from: "new", stage: "new" });
    expect(tables.status_history).toHaveLength(0);
  });

  it("answers 503, not a crash, while 0140 is pending", async () => {
    const { client } = fakeDb(seed(on), { missingTables: ["status_profile"] });
    expect(await move(client)).toMatchObject({ ok: false, status: 503 });
  });
});
