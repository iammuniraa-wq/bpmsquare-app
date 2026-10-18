import { describe, it, expect } from "vitest";
import {
  parseEstimateCreate, parseEstimatePatch, parseListParams, parseManualLine, parseTemplateHeader,
  sanitizeSearch, cfOnly, isUuid, parseMargin, parsePreviewRequest, MAX_PAGE_SIZE,
} from "./requests";

const ID = "3f2b8c1e-8a4d-4c55-9b0e-1a2b3c4d5e6f";
const ID2 = "4f2b8c1e-8a4d-4c55-9b0e-1a2b3c4d5e6f";

describe("isUuid / parseMargin / cfOnly", () => {
  it("validates ids", () => {
    expect(isUuid(ID)).toBe(true);
    expect(isUuid("abc")).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(`${ID}; drop table`)).toBe(false);
  });
  it("bounds the margin", () => {
    expect(parseMargin("18.555")).toBe(18.56);
    expect(parseMargin(-1)).toBeNull();
    expect(parseMargin(1001)).toBeNull();
    expect(parseMargin("x")).toBeNull();
  });
  it("keeps only cf_ custom data", () => {
    expect(cfOnly({ cf_a: 1, tenant_id: "x", status: "won" })).toEqual({ cf_a: 1 });
    expect(cfOnly(null)).toEqual({});
    expect(cfOnly([1])).toEqual({});
  });
});

describe("parseEstimateCreate", () => {
  it("accepts a minimal body and defaults the rest", () => {
    const r = parseEstimateCreate({ name: " Villa ", template_id: ID });
    expect(r).toEqual({ ok: true, value: { name: "Villa", account_id: null, contact_id: null, template_id: ID, params: {}, margin_pct: 0, notes: null, custom_data: {} } });
  });
  it("carries ids, params, margin and cf_ data only", () => {
    const r = parseEstimateCreate({ name: "V", template_id: ID, account_id: ID2, contact_id: "", params: { floors: 3 }, margin_pct: 12, tenant_id: "evil", custom_data: { cf_x: "1", other: 2 } });
    if (!r.ok) throw new Error(r.error);
    expect(r.value).toMatchObject({ account_id: ID2, contact_id: null, params: { floors: 3 }, margin_pct: 12, custom_data: { cf_x: "1" } });
    expect(r.value).not.toHaveProperty("tenant_id");
  });
  it("rejects bad input", () => {
    for (const body of [null, [], { template_id: ID }, { name: "x" }, { name: "x", template_id: "nope" }, { name: "x", template_id: ID, account_id: "nope" },
      { name: "x", template_id: ID, margin_pct: 5000 }, { name: "x", template_id: ID, params: "no" }, { name: "x".repeat(201), template_id: ID }]) {
      expect(parseEstimateCreate(body).ok, JSON.stringify(body)).toBe(false);
    }
  });
});

describe("parseEstimatePatch", () => {
  it("allow-lists columns and flags what needs a recompute", () => {
    const r = parseEstimatePatch({ name: "N", notes: "", status: "won", tenant_id: "x", ref: "EST-1", standard_quote_id: ID, totals: {} });
    if (!r.ok) throw new Error(r.error);
    expect(r.patch).toEqual({ name: "N", notes: null, status: "won" });
    expect(r.recompute).toBe(false);
  });
  it("margin and params trigger a recompute", () => {
    const m = parseEstimatePatch({ margin_pct: 20 });
    if (!m.ok) throw new Error(m.error);
    expect(m.recompute).toBe(true);
    const p = parseEstimatePatch({ params: { floors: 2 } });
    if (!p.ok) throw new Error(p.error);
    expect(p.recompute).toBe(true);
    expect(p.params).toEqual({ floors: 2 });
  });
  it("lists foreign ids for verification and lets them be cleared", () => {
    const r = parseEstimatePatch({ account_id: ID, contact_id: null });
    if (!r.ok) throw new Error(r.error);
    expect(r.verify).toEqual({ account_id: ID });
    expect(r.patch).toEqual({ account_id: ID, contact_id: null });
  });
  it("will not set quoted by hand, and refuses an empty patch", () => {
    expect(parseEstimatePatch({ status: "quoted" }).ok).toBe(false);
    expect(parseEstimatePatch({ status: "bogus" }).ok).toBe(false);
    expect(parseEstimatePatch({}).ok).toBe(false);
    expect(parseEstimatePatch({ name: "" }).ok).toBe(false);
    expect(parseEstimatePatch({ account_id: "nope" }).ok).toBe(false);
  });
});

describe("parseListParams", () => {
  it("defaults and clamps", () => {
    const p = parseListParams(new URLSearchParams(""));
    expect(p).toMatchObject({ q: "", status: null, sort: "created_at", dir: "desc", page: 1, page_size: 20 });
    const big = parseListParams(new URLSearchParams("page=-3&page_size=100000&sort=totals&dir=asc&status=nope"));
    expect(big).toMatchObject({ page: 1, page_size: MAX_PAGE_SIZE, sort: "created_at", dir: "asc", status: null });
  });
  it("reads valid filters", () => {
    const p = parseListParams(new URLSearchParams(`status=won&sort=name&account_id=${ID}&template_id=junk&page=3&page_size=10`));
    expect(p).toMatchObject({ status: "won", sort: "name", account_id: ID, template_id: null, page: 3, page_size: 10 });
  });
  it("neutralises filter-grammar characters in the search term", () => {
    expect(sanitizeSearch("a,b)c(d%e*f_g")).toBe("a b c d e f g");
    expect(parseListParams(new URLSearchParams("q=x),status.eq.won")).q).toBe("x status.eq.won");
  });
});

describe("parseManualLine", () => {
  it("fills defaults", () => {
    const r = parseManualLine({ description: "Crane hire" });
    expect(r).toEqual({ ok: true, value: { description: "Crane hire", group: "Manual items", uom: null, qty: 1, waste_pct: 0, unit_cost: null, component: "other", product_id: null, wbs_code: null } });
  });
  it("takes the editable fields", () => {
    const r = parseManualLine({ description: "Plate", group: "Fixings", qty: "4", unit_cost: 12.5, component: "materials", uom: "nr", waste_pct: 2, product_id: ID, wbs_code: "9.1" });
    if (!r.ok) throw new Error(r.error);
    expect(r.value).toMatchObject({ group: "Fixings", qty: 4, unit_cost: 12.5, component: "materials", uom: "nr", waste_pct: 2, product_id: ID, wbs_code: "9.1" });
  });
  it("rejects bad lines", () => {
    for (const body of [null, {}, { description: " " }, { description: "x", qty: -1 }, { description: "x", component: "nope" }, { description: "x", product_id: "nope" }, { description: "x", group: "!!!" }]) {
      expect(parseManualLine(body).ok, JSON.stringify(body)).toBe(false);
    }
  });
});

describe("parseTemplateHeader", () => {
  it("requires a name on create and reads the header fields", () => {
    expect(parseTemplateHeader({}, { requireName: true }).ok).toBe(false);
    const r = parseTemplateHeader({ name: " T ", description: "d", trade: "precast", is_active: false, quote_granularity: "line", geometry: "precast_villa" }, { requireName: true });
    expect(r).toEqual({ ok: true, header: { name: "T", description: "d", trade: "precast", is_active: false, quote_granularity: "line", geometry: "precast_villa" } });
  });
  it("only returns keys that were sent on patch", () => {
    expect(parseTemplateHeader({ is_active: true }, { requireName: false })).toEqual({ ok: true, header: { is_active: true } });
  });
  it("rejects bad values", () => {
    expect(parseTemplateHeader({ name: "x", quote_granularity: "page" }, { requireName: true }).ok).toBe(false);
    expect(parseTemplateHeader({ is_active: "yes" }, { requireName: false }).ok).toBe(false);
    expect(parseTemplateHeader({ name: "x".repeat(121) }, { requireName: true }).ok).toBe(false);
  });
});

describe("parsePreviewRequest", () => {
  it("takes a template id, inputs and margin, and nothing else", () => {
    const r = parsePreviewRequest({ template_id: ID, params: { floors: 2 }, margin_pct: "18", tenant_id: "x", account_id: ID2 });
    expect(r).toEqual({ ok: true, value: { template_id: ID, params: { floors: 2 }, margin_pct: 18 } });
  });
  it("defaults inputs and margin", () => {
    expect(parsePreviewRequest({ template_id: ID })).toEqual({ ok: true, value: { template_id: ID, params: {}, margin_pct: 0 } });
  });
  it("refuses a bad id, bad params or a margin out of range", () => {
    expect(parsePreviewRequest({ template_id: "nope" }).ok).toBe(false);
    expect(parsePreviewRequest({ template_id: ID, params: [1] }).ok).toBe(false);
    expect(parsePreviewRequest({ template_id: ID, margin_pct: 5000 }).ok).toBe(false);
    expect(parsePreviewRequest(null).ok).toBe(false);
  });
});
