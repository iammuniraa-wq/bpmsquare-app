import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MemoryDb } from "@/lib/inbox/testing/memoryDb";
import { opportunityStages } from "@/lib/sales/opportunity";
import { suggestedTenderTitle } from "@/lib/tender/rules";
import { refreshOpportunityDerived } from "./opportunityServer";

const T = "t1";
const DEAL = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";

function db(opts: { tender: boolean; amount: number; lines?: Record<string, unknown>[] }) {
  return new MemoryDb({
    opportunities: [{ id: DEAL, tenant_id: T, stage: opts.tender ? "received" : "qualify", outcome: "open", amount: opts.amount, probability: 10, probability_override: null }],
    opportunity_lines: opts.lines ?? [],
    standard_quotes: [], quotes: [],
    opportunity_tenders: opts.tender ? [{ opportunity_id: DEAL, tenant_id: T }] : [],
  });
}
const amountOf = (d: MemoryDb) => d.rows("opportunities")[0].amount;
const run = (d: MemoryDb) => refreshOpportunityDerived(d as unknown as SupabaseClient, T, DEAL, opportunityStages(null));

describe("a deal's amount while it has no lines or quotes", () => {
  it("a tender keeps the expected value it was made with", async () => {
    const d = db({ tender: true, amount: 250000 });
    const r = await run(d);
    expect(r?.amount).toBe(250000);
    expect(amountOf(d)).toBe(250000);
  });

  it("a standard deal still goes back to 0, as before", async () => {
    const d = db({ tender: false, amount: 250000 });
    const r = await run(d);
    expect(r?.amount).toBe(0);
    expect(amountOf(d)).toBe(0);
  });

  it("a tender with priced lines takes the lines total, replacing the expected value", async () => {
    const d = db({
      tender: true, amount: 250000,
      lines: [{ id: "l1", tenant_id: T, opportunity_id: DEAL, sl_no: "1", description: "Pipe", uom: "Nos", qty: 2, rate: 100, discount_pct: 0, amount: 200, is_selected: true, show_on_pdf: true }],
    });
    const r = await run(d);
    expect(r?.amount).toBe(200);
  });
});

describe("the title the New tender form suggests", () => {
  it("is the issuer, else the account, with 'tender' after it", () => {
    expect(suggestedTenderTitle({ issuer: "Saudi Aramco", accountName: "Acme" })).toBe("Saudi Aramco tender");
    expect(suggestedTenderTitle({ issuer: "  ", accountName: "Acme" })).toBe("Acme tender");
    expect(suggestedTenderTitle({ issuer: "", accountName: "" })).toBe("");
  });
});
