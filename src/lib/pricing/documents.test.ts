import { describe, it, expect } from "vitest";
import { buildPricingDocumentRow, pricingRetentionDays, retentionCutoff, DEFAULT_PRICING_RETENTION_DAYS } from "./documents";
import type { PriceResult } from "@/lib/pricing-core";

const result: PriceResult = {
  pricing_date: "2026-09-06",
  currency: "INR",
  totals: { net: 1234.567, subtotals: { NET_1: 1100 } },
  lines: [
    {
      line_no: 10, net: 1234.567, subtotals: { NET_1: 1100 }, components: { LIST_PRICE: 1000, TAX: 234.567 },
      trace: [{ step: 10, component: "LIST_PRICE", status: "APPLIED", result: 1000 }],
    },
  ],
};

describe("buildPricingDocumentRow", () => {
  it("captures context, result and trace with the call's provenance", () => {
    const row = buildPricingDocumentRow({
      tenantId: "t1", area: "default", configVersion: 3, procedure: "PRICE_LIST",
      document: { attributes: { document_type: "quote" }, lines: [{ line_no: 10, quantity: 2 }] },
      result, calcMs: 4,
      meta: { source: "quote", sourceId: "q1", apiKeyId: null, actorId: "u1" },
    });
    expect(row.source).toBe("quote");
    expect(row.source_id).toBe("q1");
    expect(row.created_by).toBe("u1");
    expect(row.api_key_id).toBeNull();
    expect(row.replay_of).toBeNull();
    expect(row.pricing_date).toBe("2026-09-06");
    expect(row.net_total).toBe(1234.57);
    expect(row.line_count).toBe(1);
    expect(row.result.lines[0]).toEqual({ line_no: 10, net: 1234.567, subtotals: { NET_1: 1100 }, components: { LIST_PRICE: 1000, TAX: 234.567 } });
    expect(row.trace[0].steps[0].component).toBe("LIST_PRICE");
    // The trace is not duplicated inside result: one copy, one place.
    expect((row.result.lines[0] as Record<string, unknown>).trace).toBeUndefined();
  });
});

describe("pricingRetentionDays", () => {
  it("defaults when unset or nonsense", () => {
    expect(pricingRetentionDays(null)).toBe(DEFAULT_PRICING_RETENTION_DAYS);
    expect(pricingRetentionDays({})).toBe(DEFAULT_PRICING_RETENTION_DAYS);
    expect(pricingRetentionDays({ pricing: { retention_days: "soon" } })).toBe(DEFAULT_PRICING_RETENTION_DAYS);
  });
  it("clamps to the allowed window", () => {
    expect(pricingRetentionDays({ pricing: { retention_days: 1 } })).toBe(7);
    expect(pricingRetentionDays({ pricing: { retention_days: 99999 } })).toBe(3650);
    expect(pricingRetentionDays({ pricing: { retention_days: 365.9 } })).toBe(365);
  });
});

describe("retentionCutoff", () => {
  it("is exactly N days before now", () => {
    const now = new Date("2026-09-06T00:00:00.000Z");
    expect(retentionCutoff(180, now)).toBe("2026-03-10T00:00:00.000Z");
  });
});
