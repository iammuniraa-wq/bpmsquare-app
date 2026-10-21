import { describe, it, expect } from "vitest";
import {
  DEFAULT_DOCUMENT, documentSummary, documentView, legacyToDocument, mergeDocument, readDocument, rulesFromDocument, storeDocument,
  targetOptions, validateDocumentPatch, fenceFromInclude, estimateFromInclude,
} from "./documents";
import { includeContract, isPriceOnly, offeredTargets, resolveTarget, selectionContract } from "./contract";
import { parseRules, mergeRules } from "./rules";
import type { D365Product } from "@/lib/connectors/d365/types";

type Ctx = { product: D365Product | null; projectEntitySet: string | null; salesOrderEntitySet: string | null };

const ctxDv: Ctx = { product: "dataverse", projectEntitySet: null, salesOrderEntitySet: "salesorders" };
const ctxFo: Ctx = { product: "fo", projectEntitySet: "Projects", salesOrderEntitySet: null };

describe("the Quote document reads the older shape", () => {
  it("nothing stored: the defaults, unconfirmed", () => {
    const d = readDocument(undefined);
    expect(d).toMatchObject({ enabled: true, target: null, confirmed_at: null, include: { lines: true, summary: true, internal_costs: false } });
  });

  it("rules + fence + estimate become the document (and back, losing nothing)", () => {
    const old = {
      rules: { quote_awarded: { enabled: true, mode: "manual" }, quote_rejected: { enabled: false, mode: "auto" } },
      fence: { summary: false, quantity_lines: true, security_profile: true, drawing_link: true, notes_terms: false },
      estimate: { summary: false, quote_lines: true, bom: false, wbs: true, internal_costs: true },
      payload_capture: true,
    };
    const d = readDocument(old);
    expect(d.enabled).toBe(true);
    expect(d.when).toEqual({ awarded: true, rejected: false });
    expect(d.mode).toBe("manual");
    expect(d.include).toMatchObject({ summary: false, lines: true, security_profile: true, drawing_link: true, bom: false, wbs: true, internal_costs: true });
    const back = parseRules(old);
    expect(back.rules).toEqual(old.rules);
    expect(back.fence).toEqual(old.fence);
    expect(back.estimate).toEqual(old.estimate);
    expect(back.payload_capture).toBe(true);
  });

  it("an older workspace with both rules off reads as a switched-off document", () => {
    const d = readDocument({ rules: { quote_awarded: { enabled: false, mode: "auto" }, quote_rejected: { enabled: false, mode: "auto" } } });
    expect(d.enabled).toBe(false);
    expect(rulesFromDocument(d).quote_awarded.enabled).toBe(false);
  });

  it("a stored document wins over the older keys", () => {
    const stored = { rules: { quote_awarded: { enabled: false, mode: "auto" } }, documents: { quote: { ...DEFAULT_DOCUMENT, enabled: true, target: "sales_order", confirmed_at: "2026-10-21T10:00:00.000Z" } } };
    const d = readDocument(stored);
    expect(d).toMatchObject({ enabled: true, target: "sales_order", confirmed_at: "2026-10-21T10:00:00.000Z" });
    expect(parseRules(stored).rules.quote_awarded.enabled).toBe(true);
  });

  it("malformed values fall back to the defaults, never throw", () => {
    const d = readDocument({ documents: { quote: { enabled: "yes", target: "spaceship", include: { lines: "no", bom: 1 }, confirmed_at: "not a date" } } });
    expect(d).toMatchObject({ enabled: true, target: null, confirmed_at: null });
    expect(d.include.lines).toBe(true);
  });

  it("the older /rules save round-trips through the document: the same data both ways", () => {
    const current = { ...DEFAULT_DOCUMENT, target: "sales_order" as const, confirmed_at: "2026-10-21T10:00:00.000Z" };
    const rules = mergeRules(parseRules(storeDocument(undefined, current)), { rules: { quote_rejected: { enabled: false } }, estimate: { bom: false } });
    const next = legacyToDocument(rules, current);
    expect(next.target).toBe("sales_order");
    expect(next.confirmed_at).toBe("2026-10-21T10:00:00.000Z");
    expect(next.when).toEqual({ awarded: true, rejected: false });
    expect(next.include.bom).toBe(false);
    const stored = storeDocument(undefined, next, true);
    expect(stored.documents?.quote).toEqual(next);
    expect(stored.rules?.quote_rejected.enabled).toBe(false);
    expect(stored.estimate?.bom).toBe(false);
    expect(stored.payload_capture).toBe(true);
  });

  it("an older call that changes only one of two options feeding one item wins over the document", () => {
    const current = { ...DEFAULT_DOCUMENT, include: { ...DEFAULT_DOCUMENT.include, summary: false } };
    const rules = mergeRules(parseRules(storeDocument(undefined, current)), { fence: { summary: true } });
    expect(legacyToDocument(rules, current).include.summary).toBe(true);
  });

  it("include maps onto the fence and estimate selections", () => {
    const inc = { ...DEFAULT_DOCUMENT.include, lines: false, drawing_link: true };
    expect(fenceFromInclude(inc)).toMatchObject({ quantity_lines: false, drawing_link: true });
    expect(estimateFromInclude(inc)).toMatchObject({ quote_lines: false, bom: true });
  });
});

describe("targets are adapter capabilities", () => {
  it("what each product offers, with its default", () => {
    expect(offeredTargets("dataverse")).toEqual(["quote", "sales_order"]);
    expect(offeredTargets("fo")).toEqual(["project", "sales_order"]);
    expect(resolveTarget("dataverse", null)).toBe("quote");
    expect(resolveTarget("bc", null)).toBe("project");
    expect(resolveTarget("dataverse", "sales_order")).toBe("sales_order");
    // a stored choice the product does not offer falls back to the default
    expect(resolveTarget("dataverse", "project")).toBe("quote");
  });

  it("Dataverse: quote and sales order are both verified and available", () => {
    expect(targetOptions(ctxDv)).toEqual([
      { key: "quote", label: "Quote", available: true, hint: null, verified: true },
      { key: "sales_order", label: "Sales Order", available: true, hint: null, verified: true },
    ]);
  });

  it("F&O / Business Central: a sales order is preset-only and unavailable until the entity set is set", () => {
    const t = targetOptions(ctxFo);
    expect(t.find((x) => x.key === "project")).toMatchObject({ available: true, verified: true });
    expect(t.find((x) => x.key === "sales_order")).toEqual({ key: "sales_order", label: "Sales Order", available: false, hint: "Needs the entity set in Mapping", verified: false });
    expect(targetOptions({ ...ctxFo, salesOrderEntitySet: "SalesOrderHeadersV2" }).find((x) => x.key === "sales_order")).toMatchObject({ available: true, verified: false });
  });

  it("no ERP connected: every target is unavailable and says to connect", () => {
    for (const t of targetOptions({ product: null, projectEntitySet: null, salesOrderEntitySet: null })) expect(t).toMatchObject({ available: false, hint: "Connect an ERP first" });
  });
});

describe("include: allowed and hint per target", () => {
  it("a Quote and a Sales Order are price-only documents; internal costs never go in them", () => {
    for (const t of ["quote", "sales_order"] as const) {
      const c = includeContract(t);
      expect(isPriceOnly(t)).toBe(true);
      expect(c.lines.allowed).toBe(true);
      expect(c.summary.allowed).toBe(true);
      for (const k of ["bom", "wbs"] as const) expect(c[k]).toEqual({ allowed: false, hint: "Prices only here" });
      expect(c.internal_costs).toEqual({ allowed: false, hint: "Internal, never sent" });
    }
  });

  it("a Project takes tasks and the bill of materials but no price lines", () => {
    const c = includeContract("project");
    expect(c.bom.allowed && c.wbs.allowed && c.internal_costs.allowed).toBe(true);
    expect(c.lines).toEqual({ allowed: false, hint: "Not on projects" });
  });

  it("every hint is three words or fewer", () => {
    for (const t of ["quote", "sales_order", "project"] as const) for (const c of Object.values(includeContract(t))) if (c.hint) expect(c.hint.split(/\s+/).length).toBeLessThanOrEqual(3);
  });

  it("the older contract treats a sales order like a quote", () => {
    expect(selectionContract("sales_order").estimate.bom.allowed).toBe(false);
    expect(selectionContract("sales_order").estimate.bom.hint).toMatch(/sales order/);
  });

  it("the view reports only what the target allows as ticked", () => {
    const v = documentView(DEFAULT_DOCUMENT, ctxDv);
    expect(v.include.find((i) => i.key === "bom")).toMatchObject({ on: false, allowed: false, hint: "Prices only here" });
    expect(v.include.find((i) => i.key === "lines")).toMatchObject({ on: true, allowed: true });
    const fo = documentView(DEFAULT_DOCUMENT, ctxFo);
    expect(fo.include.find((i) => i.key === "bom")).toMatchObject({ on: true, allowed: true });
    expect(fo.include.find((i) => i.key === "internal_costs")).toMatchObject({ on: false, allowed: true });
  });
});

describe("the document the screen reads (round 2: awarded only)", () => {
  it("has no per-outcome ticks, no mode and no rejected note", () => {
    const v = documentView(DEFAULT_DOCUMENT, ctxDv) as unknown as Record<string, unknown>;
    for (const k of ["when", "mode", "rejectedNote"]) expect(k in v).toBe(false);
    expect(v).toMatchObject({ key: "quote", label: "Quote", source: "standard_quote", enabled: true, confirmed: false });
  });

  it("the summary names the awarded outcome and the destination", () => {
    expect(documentSummary(DEFAULT_DOCUMENT, "dataverse", "sales_order")).toBe("Awarded → Dynamics 365 Sales Order");
    expect(documentSummary(DEFAULT_DOCUMENT, "dataverse", "quote")).toBe("Awarded → Dynamics 365 Quote");
    expect(documentSummary(DEFAULT_DOCUMENT, "bc", "project")).toBe("Awarded → Business Central Project");
    expect(documentSummary(DEFAULT_DOCUMENT, null, "quote")).toMatch(/^Awarded → Quote/);
  });

  it("the fallback price list shows only for a Dynamics Quote or Sales Order", () => {
    expect(documentView(DEFAULT_DOCUMENT, { ...ctxDv, fallbackPriceListId: "pl-1" })).toMatchObject({ showFallbackPriceList: true, fallbackPriceListId: "pl-1" });
    expect(documentView({ ...DEFAULT_DOCUMENT, target: "sales_order" }, ctxDv).showFallbackPriceList).toBe(true);
    expect(documentView(DEFAULT_DOCUMENT, ctxFo).showFallbackPriceList).toBe(false);
    expect(documentView(DEFAULT_DOCUMENT, ctxDv).fallbackPriceListId).toBeNull();
  });
});

describe("saving the document", () => {
  const v = (raw: unknown, ctx: Ctx = ctxDv, current = DEFAULT_DOCUMENT) => validateDocumentPatch(raw, { product: ctx.product, targets: targetOptions(ctx), current });

  it("accepts the four settings", () => {
    expect(v({ enabled: false, target: "sales_order", include: { lines: false }, fallbackPriceListId: "6c1f0a52-3b7e-4c1a-9d3e-0a1b2c3d4e5f" })).toMatchObject({ ok: true });
    expect(v({ fallbackPriceListId: null })).toEqual({ ok: true, value: { fallbackPriceListId: null } });
  });

  it("rejects what round 2 removed, an unknown key and wrong types, naming the field", () => {
    const r = v({ when: { awarded: true }, mode: "auto", colour: 1, enabled: "yes", include: { nope: true, lines: "x" }, fallbackPriceListId: "pl" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const fields = r.errors.map((e) => e.field);
      expect(fields).toEqual(expect.arrayContaining(["when", "mode", "colour", "enabled", "include.nope", "include.lines", "fallbackPriceListId"]));
    }
  });

  it("a target the system cannot create, or cannot create yet, is refused with the hint", () => {
    const r1 = v({ target: "project" }, ctxDv);
    expect(r1.ok).toBe(false);
    const r2 = v({ target: "sales_order" }, ctxFo);
    expect(r2.ok && r2).toBe(false);
    if (!r2.ok) expect(r2.errors[0]).toMatchObject({ field: "target", message: expect.stringContaining("Needs the entity set in Mapping") });
  });

  it("ticking an item the chosen target cannot carry is refused; unticking is fine", () => {
    const bad = v({ include: { internal_costs: true } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors[0]).toMatchObject({ field: "include.internal_costs" });
    expect(v({ include: { internal_costs: false, bom: false } }).ok).toBe(true);
    // checked against the target in the same request
    expect(v({ target: "project", include: { internal_costs: true } }, ctxFo).ok).toBe(true);
    expect(v({ target: "project", include: { lines: true } }, ctxFo).ok).toBe(false);
  });

  it("the first save confirms; the new panel settles awarded-only, automatic", () => {
    const old = readDocument({ rules: { quote_awarded: { enabled: true, mode: "manual" }, quote_rejected: { enabled: true, mode: "auto" } } });
    expect(old.confirmed_at).toBeNull();
    const now = new Date("2026-10-21T12:00:00Z");
    const saved = mergeDocument(old, { target: "sales_order" }, now);
    expect(saved).toMatchObject({ target: "sales_order", confirmed_at: now.toISOString(), mode: "auto", when: { awarded: true, rejected: false } });
    expect("mode_rejected" in saved).toBe(false);
    // a later save keeps the first confirmation
    expect(mergeDocument(saved, { enabled: false }, new Date("2027-01-01T00:00:00Z")).confirmed_at).toBe(now.toISOString());
  });
});
