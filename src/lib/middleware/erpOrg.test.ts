import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/encryption", () => ({ encrypt: (v: string | null) => v, decrypt: (v: string | null) => v, unsealSecret: (v: string) => v }));

import { resolveErpOrg } from "./erpOrg";
import {
  describeErpOrg, keyFromText, noMappingReason, orgKey, orgKeyLabel, orgKindsFor, parseOrgKey, parseSalesArea, pickOrgCode, salesAreaProblem, validateOrgRows,
  type OrgNames,
} from "./erpOrgPure";
import { validateListInput } from "./mapping/valueLists";
import { fakeAdmin, T1, T2, type Row } from "./testHarness";

const SEG_RETAIL = "aaaaaaaa-0000-4000-8000-000000000001";
const SEG_PROJECTS = "aaaaaaaa-0000-4000-8000-000000000002";
const OT_EXPORT = "bbbbbbbb-0000-4000-8000-000000000001";
const OT_STANDARD = "bbbbbbbb-0000-4000-8000-000000000002";
const SEG_OTHER_TENANT = "cccccccc-0000-4000-8000-000000000001";

const names: OrgNames = { segment: { [SEG_RETAIL]: "Saudi retail" }, order_type: { [OT_EXPORT]: "Export order" } };

describe("parseSalesArea", () => {
  it("splits ORG/CHANNEL/DIVISION and the optional group and office", () => {
    expect(parseSalesArea("1000/10/00")).toEqual({ salesOrganization: "1000", distributionChannel: "10", division: "00" });
    expect(parseSalesArea("1000/10/00/G01")).toEqual({ salesOrganization: "1000", distributionChannel: "10", division: "00", salesGroup: "G01" });
    expect(parseSalesArea(" 1000 / 10 / 00 / G01 / O01 ")).toEqual({ salesOrganization: "1000", distributionChannel: "10", division: "00", salesGroup: "G01", salesOffice: "O01" });
  });

  it("refuses what SAP would not take", () => {
    for (const bad of ["", "1000", "1000/10", "1000/10/00/G01/O01/X", "10000/10/00", "1000//00", "1000/10/0 0", "1000/10/00/", "1000/10/00//O01", "1000/10/00/G-1", "a b/10/00"]) {
      expect(parseSalesArea(bad), bad).toBeNull();
    }
  });

  it("gives a plain row error, and none for an empty code (an empty code only blocks the send)", () => {
    expect(salesAreaProblem("1000/10")).toMatch(/ORGANISATION\/CHANNEL\/DIVISION, for example 1000\/10\/00/);
    expect(salesAreaProblem("1000/10/00")).toBeNull();
    expect(salesAreaProblem("")).toBeNull();
    expect(salesAreaProblem("   ")).toBeNull();
  });
});

describe("the key scheme", () => {
  it("is segment:<uuid> or order_type:<uuid>, lower-cased", () => {
    expect(orgKey("segment", SEG_RETAIL.toUpperCase())).toBe(`segment:${SEG_RETAIL}`);
    expect(parseOrgKey(`order_type:${OT_EXPORT}`)).toEqual({ type: "order_type", id: OT_EXPORT });
    expect(parseOrgKey(`SEGMENT:${SEG_RETAIL}`)).toBeNull();
    for (const bad of ["Saudi retail", "segment:", "segment:123", `team:${SEG_RETAIL}`, "", null, 5]) expect(parseOrgKey(bad as never), String(bad)).toBeNull();
  });

  it("shows the CURRENT name, so a renamed coverage keeps its row", () => {
    const key = orgKey("segment", SEG_RETAIL);
    expect(orgKeyLabel(key, names)).toEqual({ label: "Saudi retail", group: "Coverage", removed: false });
    const renamed: OrgNames = { ...names, segment: { [SEG_RETAIL]: "KSA retail" } };
    expect(orgKeyLabel(key, renamed)).toMatchObject({ label: "KSA retail", removed: false });
  });

  it("shows a deleted target as removed instead of failing", () => {
    expect(orgKeyLabel(orgKey("segment", SEG_PROJECTS), names)).toEqual({ label: "(removed coverage)", group: "Coverage", removed: true });
    expect(orgKeyLabel(orgKey("order_type", OT_STANDARD), names)).toMatchObject({ label: "(removed order type)", removed: true });
    expect(orgKeyLabel("free text", names).removed).toBe(true);
  });

  it("reads a typed name back to its key, only when it is unambiguous", () => {
    expect(keyFromText("saudi RETAIL", names)).toEqual({ ok: true, key: orgKey("segment", SEG_RETAIL) });
    expect(keyFromText(`segment:${SEG_RETAIL}`, names)).toEqual({ ok: true, key: orgKey("segment", SEG_RETAIL) });
    expect(keyFromText("Nowhere", names)).toMatchObject({ ok: false });
    expect(keyFromText("", names)).toMatchObject({ ok: false });
    const clash: OrgNames = { segment: { [SEG_RETAIL]: "Export" }, order_type: { [OT_EXPORT]: "export" } };
    expect(keyFromText("Export", clash)).toMatchObject({ ok: false, message: expect.stringContaining("both a coverage and an order type") });
  });
});

describe("validation of an organisation list", () => {
  const seg = orgKey("segment", SEG_RETAIL);
  const ot = orgKey("order_type", OT_EXPORT);

  it("accepts picked keys and a well-formed sales area, and lower-cases the key", () => {
    const r = validateListInput([{ bpm: seg.toUpperCase().replace("SEGMENT", "segment"), erp: "1000/10/00" }, { bpm: ot, erp: "2000/20/10/G01" }], null, "sales_area");
    expect(r.ok && r.rows.map((x) => x.bpm)).toEqual([seg, ot]);
    expect(r.ok && r.default_in).toBeNull();
  });

  it("refuses typed text on the BPMSquare side, with a row error", () => {
    const r = validateListInput([{ bpm: "Saudi retail", erp: "1000/10/00" }], null, "sales_area");
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.errors[0]).toMatchObject({ row: 0, message: "Pick a coverage or an order type for this row." });
  });

  it("refuses a sales area that is not ORG/CHANNEL/DIVISION, naming the row", () => {
    const r = validateListInput([{ bpm: seg, erp: "1000/10/00" }, { bpm: ot, erp: "2000-20-10" }], null, "sales_area");
    expect(!r.ok && r.errors).toHaveLength(1);
    expect(!r.ok && r.errors[0]).toMatchObject({ row: 1 });
    expect(!r.ok && r.errors[0].message).toMatch(/not a sales area/);
  });

  it("an ERP company code is any text, an empty code saves, and there is no unknown-inbound default", () => {
    expect(validateListInput([{ bpm: seg, erp: "USMF" }, { bpm: ot, erp: "" }], "whatever", "erp_company")).toMatchObject({ ok: true, default_in: null });
    expect(validateOrgRows("erp_company", [{ bpm: seg, erp: "not/a/sales/area/at/all" }])).toEqual([]);
  });

  it("keeps the ordinary rules: one row per coverage, one inbound answer per code", () => {
    expect(validateListInput([{ bpm: seg, erp: "1000/10/00" }, { bpm: seg, erp: "2000/10/00" }], null, "sales_area")).toMatchObject({ ok: false });
    const two = validateListInput([{ bpm: seg, erp: "1000/10/00" }, { bpm: ot, erp: "1000/10/00" }], null, "sales_area");
    expect(two).toMatchObject({ ok: false });
    expect(validateListInput([{ bpm: seg, erp: "1000/10/00", inbound: true }, { bpm: ot, erp: "1000/10/00" }], null, "sales_area")).toMatchObject({ ok: true });
  });

  it("other kinds are untouched", () => {
    expect(validateListInput([{ bpm: "Mtr", erp: "M" }], "Mtr", "unit")).toMatchObject({ ok: true, default_in: "Mtr" });
  });
});

describe("which row answers", () => {
  const seg = orgKey("segment", SEG_RETAIL);
  const ot = orgKey("order_type", OT_EXPORT);

  it("the order type's row wins over the coverage's", () => {
    const rows = [{ bpm: seg, erp: "1000/10/00" }, { bpm: ot, erp: "2000/20/10" }];
    expect(pickOrgCode(rows, { orderTypeKey: ot, coverageKey: seg })).toEqual({ code: "2000/20/10", via: "order_type", key: ot });
  });

  it("falls back to the coverage, and a row with no code does not answer", () => {
    const rows = [{ bpm: seg, erp: " 1000/10/00 " }, { bpm: ot, erp: "  " }];
    expect(pickOrgCode(rows, { orderTypeKey: ot, coverageKey: seg })).toEqual({ code: "1000/10/00", via: "coverage", key: seg });
    expect(pickOrgCode([], { orderTypeKey: ot, coverageKey: seg })).toBeNull();
    expect(pickOrgCode(rows, { orderTypeKey: null, coverageKey: null })).toBeNull();
  });

  it("says in one sentence what was looked for", () => {
    expect(noMappingReason("sales_area", { coverageName: "Saudi retail" })).toMatch(/^No sales area is mapped for coverage 'Saudi retail' on this ERP\./);
    expect(noMappingReason("sales_area", { orderTypeName: "Export", coverageName: "Saudi retail" })).toContain("order type 'Export' or coverage 'Saudi retail'");
    expect(noMappingReason("erp_company", { orderTypeName: "Export" })).toContain("this customer has no coverage");
    expect(noMappingReason("sales_area", { listEmpty: true })).toMatch(/No sales area is mapped on this ERP yet/);
    expect(noMappingReason("sales_area", { hadAccount: false })).toMatch(/no customer/);
  });

  it("describes a result for the order's ERP tab", () => {
    expect(describeErpOrg({ ok: true, code: "1000/10/00", via: "coverage", key: seg, via_label: "Saudi retail" })).toEqual({ ok: true, text: "Sales area 1000/10/00 (from coverage Saudi retail)" });
    expect(describeErpOrg({ ok: true, code: "USMF", via: "order_type", key: ot, via_label: "Export order" }, "erp_company").text).toBe("ERP company USMF (from order type Export order)");
    expect(describeErpOrg({ ok: false, reason: "No sales area is mapped." })).toEqual({ ok: false, text: "No sales area is mapped." });
  });

  it("offers each org list on the connection that uses it", () => {
    expect(orgKindsFor("sap_s4")).toEqual(["sales_area"]);
    expect(orgKindsFor("dynamics365")).toEqual(["erp_company"]);
    expect(orgKindsFor("webhook:abc")).toEqual([]);
  });
});

// ── resolveErpOrg ─────────────────────────────────────────────────────────────

const list = (tenant: string, connection: string, kind: string, rows: { bpm: string; erp: string }[]): Row => ({
  tenant_id: tenant, connection_id: connection, kind, label: kind, rows: rows.map((r) => ({ ...r, inbound: true })), default_in: null, unknown_in: [],
});

function world(over: { rows?: { bpm: string; erp: string }[]; connection?: string; kind?: string; segments?: Row[] } = {}) {
  return fakeAdmin({
    segments: over.segments ?? [
      { id: SEG_RETAIL, tenant_id: T1, name: "Saudi retail", code: "KSA-R" },
      { id: SEG_PROJECTS, tenant_id: T1, name: "Projects", code: "PRJ" },
      { id: SEG_OTHER_TENANT, tenant_id: T2, name: "Other tenant market", code: "OT" },
    ],
    sales_order_types: [
      { id: OT_EXPORT, tenant_id: T1, name: "Export order", active: true, sort_order: 1 },
      { id: OT_STANDARD, tenant_id: T1, name: "Standard order", active: true, sort_order: 0 },
    ],
    accounts: [{ id: "acc-1", tenant_id: T1, name: "Gulf Steel" }, { id: "acc-2", tenant_id: T2, name: "Foreign" }],
    integration_value_lists: [
      list(T1, over.connection ?? "sap_s4", over.kind ?? "sales_area", over.rows ?? [
        { bpm: orgKey("segment", SEG_RETAIL), erp: "1000/10/00" },
        { bpm: orgKey("order_type", OT_EXPORT), erp: "2000/20/10" },
      ]),
    ],
  });
}

const ownerOf = (segmentId: string, name: string) => async () => ({ owner: { segment: { id: segmentId, name }, coverage: {}, team: {} } as never });
const noCoverage = async () => ({ owner: null });

describe("resolveErpOrg", () => {
  beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); });
  const args = (over: Partial<{ accountId: string | null; orderTypeId: string | null; kind: "sales_area" | "erp_company"; connectorId: string }> = {}) =>
    ({ connectorId: "sap_s4", kind: "sales_area" as const, accountId: "acc-1", orderTypeId: null, ...over });

  it("an order type that has a row wins over the account's coverage", async () => {
    const db = world();
    const r = await resolveErpOrg(db.client, T1, args({ orderTypeId: OT_EXPORT }), { resolveCoverage: ownerOf(SEG_RETAIL, "Saudi retail") });
    expect(r).toEqual({ ok: true, code: "2000/20/10", via: "order_type", key: orgKey("order_type", OT_EXPORT), via_label: "Export order" });
  });

  it("falls back to the owner coverage when the order type has no row", async () => {
    const db = world();
    const r = await resolveErpOrg(db.client, T1, args({ orderTypeId: OT_STANDARD }), { resolveCoverage: ownerOf(SEG_RETAIL, "Saudi retail") });
    expect(r).toEqual({ ok: true, code: "1000/10/00", via: "coverage", key: orgKey("segment", SEG_RETAIL), via_label: "Saudi retail" });
  });

  it("with no order type at all, the coverage answers", async () => {
    const r = await resolveErpOrg(world().client, T1, args(), { resolveCoverage: ownerOf(SEG_RETAIL, "Saudi retail") });
    expect(r).toMatchObject({ ok: true, code: "1000/10/00", via: "coverage" });
  });

  it("names the coverage in the reason when nothing is mapped for it", async () => {
    const r = await resolveErpOrg(world().client, T1, args(), { resolveCoverage: ownerOf(SEG_PROJECTS, "Projects") });
    expect(r).toEqual({ ok: false, reason: expect.stringMatching(/^No sales area is mapped for coverage 'Projects' on this ERP\./) });
  });

  it("names the order type too, and says when the customer has no coverage", async () => {
    const db = world();
    const both = await resolveErpOrg(db.client, T1, args({ orderTypeId: OT_STANDARD }), { resolveCoverage: ownerOf(SEG_PROJECTS, "Projects") });
    expect(!both.ok && both.reason).toContain("order type 'Standard order' or coverage 'Projects'");
    const none = await resolveErpOrg(db.client, T1, args({ orderTypeId: OT_STANDARD }), { resolveCoverage: noCoverage });
    expect(!none.ok && none.reason).toContain("this customer has no coverage");
  });

  it("an empty list is said plainly and the coverage engine is not even asked", async () => {
    const resolveCoverage = vi.fn(noCoverage);
    const db = world({ rows: [] });
    const r = await resolveErpOrg(db.client, T1, args(), { resolveCoverage });
    expect(r).toEqual({ ok: false, reason: expect.stringContaining("No sales area is mapped on this ERP yet") });
    expect(resolveCoverage).not.toHaveBeenCalled();
  });

  it("lists belong to one connector: SAP's rows are not Dynamics' answer", async () => {
    const db = world();
    const r = await resolveErpOrg(db.client, T1, args({ connectorId: "dynamics365", kind: "erp_company" }), { resolveCoverage: ownerOf(SEG_RETAIL, "Saudi retail") });
    expect(r.ok).toBe(false);
    const d = world({ connection: "dynamics365", kind: "erp_company", rows: [{ bpm: orgKey("segment", SEG_RETAIL), erp: "USMF" }] });
    expect(await resolveErpOrg(d.client, T1, args({ connectorId: "dynamics365", kind: "erp_company" }), { resolveCoverage: ownerOf(SEG_RETAIL, "Saudi retail") })).toMatchObject({ ok: true, code: "USMF" });
  });

  it("another workspace finds nothing: its lists, its order type and its account are not read", async () => {
    const db = world();
    expect(await resolveErpOrg(db.client, T2, args({ accountId: "acc-2" }), { resolveCoverage: ownerOf(SEG_OTHER_TENANT, "Other tenant market") })).toMatchObject({ ok: false });
    // T1 asking with T2's account id: the account is not loaded, so there is no coverage to resolve.
    const resolveCoverage = vi.fn(ownerOf(SEG_RETAIL, "Saudi retail"));
    const r = await resolveErpOrg(db.client, T1, args({ accountId: "acc-2" }), { resolveCoverage });
    expect(r.ok).toBe(false);
    expect(resolveCoverage).not.toHaveBeenCalled();
    // T2's order type id under T1: not found, so the order type is ignored rather than trusted.
    db.tables.sales_order_types.push({ id: "dddddddd-0000-4000-8000-000000000001", tenant_id: T2, name: "Foreign type", active: true });
    const foreign = await resolveErpOrg(db.client, T1, args({ orderTypeId: "dddddddd-0000-4000-8000-000000000001" }), { resolveCoverage: ownerOf(SEG_RETAIL, "Saudi retail") });
    expect(foreign).toMatchObject({ ok: true, via: "coverage" });
  });

  it("another workspace's coverage id saved in a row finds no name and never matches that tenant's account", async () => {
    const db = world({ rows: [{ bpm: orgKey("segment", SEG_OTHER_TENANT), erp: "9999/99/99" }] });
    const r = await resolveErpOrg(db.client, T1, args(), { resolveCoverage: ownerOf(SEG_RETAIL, "Saudi retail") });
    expect(r.ok).toBe(false);
  });

  it("a renamed coverage still answers, under its new name", async () => {
    const db = world();
    db.tables.segments[0].name = "KSA retail";
    const r = await resolveErpOrg(db.client, T1, args(), { resolveCoverage: ownerOf(SEG_RETAIL, "Saudi retail") });
    expect(r).toMatchObject({ ok: true, code: "1000/10/00", via_label: "KSA retail" });
  });

  it("a deleted coverage leaves a dead row that nothing resolves to, and the reason is plain", async () => {
    const db = world();
    db.tables.segments = db.tables.segments.filter((s) => s.id !== SEG_RETAIL);
    const r = await resolveErpOrg(db.client, T1, args(), { resolveCoverage: noCoverage });
    expect(r.ok).toBe(false);
    const list = (db.tables.integration_value_lists[0].rows as { bpm: string }[]);
    expect(orgKeyLabel(list[0].bpm, { segment: {}, order_type: {} })).toMatchObject({ removed: true });
  });

  it("a stored sales area that is not the right form is a reason, not a bad send", async () => {
    const db = world({ rows: [{ bpm: orgKey("segment", SEG_RETAIL), erp: "1000-10" }] });
    const r = await resolveErpOrg(db.client, T1, args(), { resolveCoverage: ownerOf(SEG_RETAIL, "Saudi retail") });
    expect(!r.ok && r.reason).toMatch(/not usable/);
  });

  it("a coverage that cannot be worked out is a reason, not a crash", async () => {
    const r = await resolveErpOrg(world().client, T1, args(), { resolveCoverage: async () => { throw new Error("boom"); } });
    expect(r.ok).toBe(false);
  });

  it("a missing lists table reads as no mapping", async () => {
    const db = fakeAdmin({}, { missing: ["integration_value_lists"] });
    expect(await resolveErpOrg(db.client, T1, args(), { resolveCoverage: noCoverage })).toMatchObject({ ok: false });
  });
});
