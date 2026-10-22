import { describe, it, expect } from "vitest";
import { D365_DEFAULTS } from "./catalog";
import { buildSelection, describeSelection, parseSelection, selectionSupport, IDS_PER_REQUEST, MAX_SELECT_IDS } from "./selection";
import type { D365EntityConfig, D365EntityKey, D365Product } from "./types";

const ec = (product: D365Product, key: D365EntityKey): D365EntityConfig => D365_DEFAULTS[product][key]!;
const G1 = "11111111-1111-4111-8111-111111111111";
const G2 = "22222222-2222-4222-8222-222222222222";

describe("parseSelection", () => {
  it("asks for nothing when nothing is set", () => {
    expect(parseSelection({})).toEqual({ ok: true, select: undefined });
    expect(parseSelection({ ids: [] })).toEqual({ ok: true, select: undefined });
  });

  it("cleans ids: trims, drops braces and duplicates", () => {
    expect(parseSelection({ ids: [` {${G1}} `, G1, "C-0001", "C-0001"] })).toEqual({ ok: true, select: { ids: [G1, "C-0001"] } });
  });

  it("refuses an id that could carry filter syntax", () => {
    for (const bad of ["x' or 1 eq 1", "a b", "a)or(b", "x;drop", "x%27", "'", "..\\x", "a=b", "$filter", "x\ny", "é"]) {
      const r = parseSelection({ ids: [bad] });
      expect(r.ok, bad).toBe(false);
    }
  });

  it("caps ids at 100 and ignores non-strings", () => {
    const many = Array.from({ length: MAX_SELECT_IDS + 1 }, (_, i) => `N${i}`);
    expect(parseSelection({ ids: many })).toMatchObject({ ok: false });
    expect(parseSelection({ ids: many.slice(0, MAX_SELECT_IDS) })).toMatchObject({ ok: true });
    expect(parseSelection({ ids: [1, null, "A1"] })).toEqual({ ok: true, select: { ids: ["A1"] } });
    expect(parseSelection({ ids: "A1" })).toMatchObject({ ok: false });
  });

  it("no longer takes name, date or active filters: the old text, since and active fields are ignored", () => {
    expect(parseSelection({ text: "AG", since: "2026-10-01", active_only: true } as never)).toEqual({ ok: true, select: undefined });
  });
});

describe("buildSelection: Dataverse", () => {
  const cust = ec("dataverse", "customers");

  it("reads GUIDs bare and numbers as strings, in one OR group", () => {
    const b = buildSelection("dataverse", cust, { ids: [G1, "C-0001", G2] });
    expect(b).toEqual({ filters: [`(accountid eq ${G1} or accountnumber eq 'C-0001' or accountid eq ${G2})`], unsupported: [], nothingUsable: false });
  });

  it("quotes inside a number are doubled, so the literal never ends early", () => {
    // parseSelection refuses a quote; buildSelection still holds if one ever got past it.
    const [f] = buildSelection("dataverse", cust, { ids: ["a') or (1 eq 1"] }).filters;
    expect(f).toBe(`(accountnumber eq 'a'') or (1 eq 1')`);
  });

  it("splits long lists into groups", () => {
    const ids = Array.from({ length: IDS_PER_REQUEST * 2 + 5 }, (_, i) => `C-${String(i).padStart(4, "0")}`);
    const b = buildSelection("dataverse", cust, { ids });
    expect(b.filters).toHaveLength(3);
    for (const f of b.filters) expect(f.length).toBeLessThan(900);
    expect(b.filters.join(" ").match(/accountnumber eq/g)).toHaveLength(ids.length);
  });

  it("contacts have no number: numbers are refused, GUIDs work", () => {
    const contacts = ec("dataverse", "contacts");
    expect(selectionSupport("dataverse", contacts).numbers).toBe(false);
    const onlyNumbers = buildSelection("dataverse", contacts, { ids: ["K-1", "K-2"] });
    expect(onlyNumbers).toMatchObject({ filters: [], nothingUsable: true });
    expect(onlyNumbers.unsupported[0]).toContain("K-1, K-2");
    const mixed = buildSelection("dataverse", contacts, { ids: [G1, "K-2"] });
    expect(mixed.filters).toEqual([`(contactid eq ${G1})`]);
    expect(mixed.unsupported).toHaveLength(1);
  });

  it("asking for nothing reads nothing", () => {
    expect(buildSelection("dataverse", cust, {})).toMatchObject({ filters: [], nothingUsable: true });
  });
});

describe("buildSelection: Finance & Operations and Business Central", () => {
  it("F&O: keys are text, so even a GUID-looking id is quoted", () => {
    const c = ec("fo", "customers");
    expect(selectionSupport("fo", c)).toEqual({ numbers: true });
    expect(buildSelection("fo", c, { ids: ["US-001", G1] }).filters).toEqual([`(CustomerAccount eq 'US-001' or CustomerAccount eq '${G1}')`]);
  });

  it("Business Central: GUID by id, number by number", () => {
    const c = ec("bc", "customers");
    expect(selectionSupport("bc", c)).toEqual({ numbers: true });
    expect(buildSelection("bc", c, { ids: [G1, "C00010"] }).filters).toEqual([`(id eq ${G1} or number eq 'C00010')`]);
  });

  it("an entity that is not configured supports nothing", () => {
    expect(selectionSupport("fo", null)).toEqual({ numbers: false });
  });
});

describe("describeSelection", () => {
  it("says what was read in one line", () => {
    expect(describeSelection({ ids: [G1] })).toBe("1 record by id or number");
    expect(describeSelection({ ids: [G1, G2] })).toBe("2 records by id or number");
  });
});
