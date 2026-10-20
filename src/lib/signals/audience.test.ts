import { describe, expect, it } from "vitest";
import { fakeDb } from "@/lib/marketing/testFakeDb";
import { matchesAllFilters, sanitizeSegmentFilters, SEGMENT_FIELDS } from "@/lib/marketingSegmentation";
import { loadAudienceValues, QUIET_VALUES } from "./audience";

const T = "tenant-a";
const NOW = new Date("2026-10-20T12:00:00Z");

const db = (features: Record<string, unknown>) => fakeDb({
  tenants: [{ id: T, features }],
  account_intent: [
    { tenant_id: T, account_id: "a1", score: 42, stage: "comparing", stage_changed_at: "2026-10-18T12:00:00Z", topics: ["Precast", "Fire safety"] },
    { tenant_id: T, account_id: "a2", score: 12, stage: "looking", stage_changed_at: "2026-09-01T00:00:00Z", topics: [] },
    { tenant_id: "other", account_id: "a9", score: 99, stage: "deciding", stage_changed_at: null, topics: ["Precast"] },
  ],
});

describe("the Buying signals audience fields", () => {
  it("are registered for marketing audiences only, behind the module", () => {
    const keys = ["buying_stage", "intent_score", "days_in_stage", "signal_topic"];
    for (const k of keys) expect(SEGMENT_FIELDS.find((f) => f.key === k)?.audience?.feature).toBe("buying_signals");
  });

  it("read the stored row: days in stage, score and topics", async () => {
    const { client } = db({ marketing: true, buying_signals: true });
    const m = await loadAudienceValues(T, client, NOW);
    expect(m?.get("a1")).toEqual({ buying_stage: "comparing", intent_score: 42, days_in_stage: 2, signal_topic: "Precast, Fire safety" });
    expect(m?.has("a9")).toBe(false); // another tenant's row never appears
  });

  it("make 'everyone Comparing on Precast' a working target group", async () => {
    const { client } = db({ marketing: true, buying_signals: true });
    const m = (await loadAudienceValues(T, client, NOW))!;
    const filters = sanitizeSegmentFilters([
      { id: "1", field: "buying_stage", operator: "equals", value: "comparing" },
      { id: "2", field: "signal_topic", operator: "contains", value: "precast" },
    ]);
    expect(filters).toHaveLength(2);
    expect(matchesAllFilters({ ...m.get("a1") }, filters, "all")).toBe(true);
    expect(matchesAllFilters({ ...m.get("a2") }, filters, "all")).toBe(false);
    expect(matchesAllFilters({ ...QUIET_VALUES }, filters, "all")).toBe(false);
  });

  it("support score and days in stage as numbers", async () => {
    const { client } = db({ marketing: true, buying_signals: true });
    const m = (await loadAudienceValues(T, client, NOW))!;
    const f = sanitizeSegmentFilters([
      { id: "1", field: "intent_score", operator: "gt", value: "30" },
      { id: "2", field: "days_in_stage", operator: "lt", value: "7" },
    ]);
    expect(matchesAllFilters({ ...m.get("a1") }, f, "all")).toBe(true);
    expect(matchesAllFilters({ ...m.get("a2") }, f, "all")).toBe(false);
  });

  it("cannot be answered when the module is off or its table is pending", async () => {
    expect(await loadAudienceValues(T, db({ marketing: true }).client, NOW)).toBeNull();
    const pending = fakeDb({ tenants: [{ id: T, features: { marketing: true, buying_signals: true } }] }, { missingTables: ["account_intent"] });
    expect(await loadAudienceValues(T, pending.client, NOW)).toBeNull();
  });
});
