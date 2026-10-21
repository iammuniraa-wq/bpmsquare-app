import { describe, it, expect } from "vitest";
import {
  buildDataverseQuote, buildProjectBody, closeActionBody, validateOutboundMap, renderTyped, netRate, plainFailure, previewWords, stepsFor,
  ACTIVATE_BODY, QUOTE_PLACEHOLDERS, type QuoteForErp,
} from "./payload";
import { D365_OUTBOUND_PRESETS, outboundConfig } from "@/lib/connectors/d365/catalog";

const quote = (over: Partial<QuoteForErp> = {}): QuoteForErp => ({
  ref: "SQ-0001", title: "A. Datum perimeter fence", customer_name: "A. Datum Corporation", account_external_id: "acc-guid",
  description: ["Total in BPMSquare: 143.75 (tax 15%)"],
  lines: [
    { sl_no: "1", description: "Fence post", uom: "pcs", qty: 10, rate: 10, discount_pct: 0, amount: 100 },
    { sl_no: "2", description: "Gate", uom: "pcs", qty: 1, rate: 25, discount_pct: 20, amount: 20 },
  ],
  subtotal: 120, total: 138, valid_until: null, outcome: "awarded", ...over,
});
const cfg = { price_list_id: "pl-1", currency_id: "cur-1" };
const maps = D365_OUTBOUND_PRESETS.dataverse;

describe("Dataverse quote payload (live-verified facts only)", () => {
  const b = buildDataverseQuote(quote(), cfg, { quote: maps.quote.field_map, quote_line: maps.quote_line.field_map });

  it("carries name, customer, price list and currency binds", () => {
    expect(b.problems).toEqual([]);
    expect(b.body.name).toBe("SQ-0001 · A. Datum perimeter fence");
    expect(b.body["customerid_account@odata.bind"]).toBe("/accounts(acc-guid)");
    expect(b.body["pricelevelid@odata.bind"]).toBe("/pricelevels(pl-1)");
    expect(b.body["transactioncurrencyid@odata.bind"]).toBe("/transactioncurrencies(cur-1)");
  });

  it("puts the lines in the same POST as quote_details with write-in fields", () => {
    const lines = b.body.quote_details as Record<string, unknown>[];
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({ productdescription: "Fence post", quantity: 10, priceperunit: 10, isproductoverridden: true });
  });

  it("never sends a uomid on a write-in line, even if a custom map asks for one", () => {
    const custom = buildDataverseQuote(quote(), cfg, { quote: maps.quote.field_map, quote_line: { ...maps.quote_line.field_map, uomid: "{uom}", "uomid@odata.bind": "/uoms({uom})" } });
    for (const l of custom.body.quote_details as Record<string, unknown>[]) {
      expect(Object.keys(l).some((k) => k.toLowerCase().startsWith("uomid"))).toBe(false);
      expect(l.isproductoverridden).toBe(true);
    }
  });

  it("folds a line discount into the unit price so the ERP total equals the BPMSquare amount", () => {
    const lines = b.body.quote_details as { quantity: number; priceperunit: number }[];
    expect(lines[1].priceperunit).toBe(20);
    expect(lines.reduce((s, l) => s + l.quantity * l.priceperunit, 0)).toBe(120);
    expect(netRate({ rate: 25, discount_pct: 20, qty: 1, amount: 20 })).toBe(20);
  });

  it("keeps the BPMSquare ref visible in the name whatever a custom map says", () => {
    const custom = buildDataverseQuote(quote(), cfg, { quote: { name: "Fence for {customer_name}" }, quote_line: maps.quote_line.field_map });
    expect(String(custom.body.name).startsWith("SQ-0001")).toBe(true);
  });

  it("a custom map cannot drop a required bind", () => {
    const custom = buildDataverseQuote(quote(), cfg, { quote: { description: "{description}" }, quote_line: maps.quote_line.field_map });
    expect(custom.body["pricelevelid@odata.bind"]).toBe("/pricelevels(pl-1)");
    expect(custom.body["customerid_account@odata.bind"]).toBe("/accounts(acc-guid)");
  });

  it("says what is missing, in plain words, before anything is sent", () => {
    const x = buildDataverseQuote(quote({ account_external_id: null }), {}, { quote: maps.quote.field_map, quote_line: maps.quote_line.field_map });
    expect(x.problems.map((p) => p.code)).toEqual(["customer_not_linked", "no_price_list", "no_currency"]);
    expect(x.problems[0].fix).toMatch(/Sync customers/);
    expect(buildDataverseQuote(quote({ lines: [] }), cfg, { quote: maps.quote.field_map, quote_line: maps.quote_line.field_map }).problems.map((p) => p.code)).toContain("no_lines");
  });
});

describe("win and close actions", () => {
  it("awarded: activate then WinQuote Status 4 with a QuoteClose subject", () => {
    expect(ACTIVATE_BODY).toEqual({ statecode: 1, statuscode: 2 });
    const a = closeActionBody("qid", "SQ-0001", "awarded");
    expect(a.action).toBe("WinQuote");
    expect(a.body).toEqual({ QuoteClose: { subject: "SQ-0001 awarded", "quoteid@odata.bind": "/quotes(qid)" }, Status: 4 });
  });

  it("rejected: CloseQuote Status 5", () => {
    const a = closeActionBody("qid", "SQ-0001", "rejected");
    expect(a.action).toBe("CloseQuote");
    expect(a.body.Status).toBe(5);
    expect((a.body.QuoteClose as { subject: string }).subject).toBe("SQ-0001 rejected");
  });
});

describe("project payload (Finance and Operations, Business Central)", () => {
  it("builds the header from the preset with the ref in the name", () => {
    const fo = outboundConfig({ product: "fo" });
    const b = buildProjectBody(quote({ account_external_id: "C0100" }), fo.project, { status: "awarded", dataArea: "usmf", isFo: true });
    expect(b.problems).toEqual([]);
    expect(b.body).toEqual({ ProjectName: "SQ-0001 · A. Datum perimeter fence", CustomerAccount: "C0100", dataAreaId: "usmf" });
    const bc = buildProjectBody(quote(), outboundConfig({ product: "bc" }).project, { status: "awarded", isFo: false });
    expect(bc.body).toEqual({ displayName: "SQ-0001 · A. Datum perimeter fence" });
  });

  it("flags an empty map or a missing target", () => {
    expect(buildProjectBody(quote(), { entity_set: "", field_map: {} }, { status: "awarded", isFo: false }).problems.map((p) => p.code)).toEqual(["no_project_target", "empty_project_map"]);
  });
});

describe("field maps: pick, don't type", () => {
  it("accepts offered placeholders and rejects unknown ones and bad field names", () => {
    expect(validateOutboundMap("quote", { description: "{ref} · {description}" }).ok).toBe(true);
    const bad = validateOutboundMap("quote", { "bad field": "{ref}", description: "{nope}", other: "{ref" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.map((e) => e.field)).toEqual(["bad field", "description", "other"]);
    expect(QUOTE_PLACEHOLDERS).toContain("customer_name");
  });

  it("refuses a uomid on a quote line map", () => {
    expect(validateOutboundMap("quote_line", { uomid: "{uom}" }).ok).toBe(false);
  });

  it("renders typed values: a lone placeholder keeps its type, true/false become booleans, empty drops the field", () => {
    expect(renderTyped("{qty}", { qty: 3 })).toBe(3);
    expect(renderTyped("true", {})).toBe(true);
    expect(renderTyped("{ref} · {title}", { ref: "A", title: "B" })).toBe("A · B");
    expect(renderTyped("{ref} · {title}", { ref: "A", title: "" })).toBeNull();
  });
});

describe("plain-language failures", () => {
  it("says what happened and the one thing to do", () => {
    expect(plainFailure({ status: 401 }).fix).toMatch(/Test connection/);
    expect(plainFailure({ status: 403 }, "create").headline).toMatch(/may not create quotes/);
    expect(plainFailure({ status: 400, message: "The price list is not valid" }).fix).toMatch(/price list/i);
    expect(plainFailure({ status: 503 }).headline).toMatch(/did not answer/);
    expect(plainFailure({ status: 404 }, "close").fix).toMatch(/Send again/);
    expect(plainFailure({ status: 409, message: "The quote is already Won in Dynamics, so it cannot be closed as Lost." }, "close").headline).toMatch(/already Won/);
  });

  it("words-first preview names the customer, lines, total and the steps", () => {
    const w = previewWords({ target: "quote", productLabel: "Dynamics 365 Sales", ref: "SQ-0001", customer: "A. Datum", lineCount: 2, total: 138, outcome: "awarded", steps: stepsFor("dataverse", "awarded") });
    expect(w[0]).toMatch(/SQ-0001 for A. Datum, with 2 lines, total 138/);
    expect(w.join(" ")).toMatch(/Won/);
    expect(stepsFor("dataverse", "rejected").join(" ")).toMatch(/Lost/);
  });
});
