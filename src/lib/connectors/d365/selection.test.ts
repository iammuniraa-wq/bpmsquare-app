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
    expect(parseSelection({ ids: [], since: "", text: "  ", active_only: false })).toEqual({ ok: true, select: undefined });
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

  it("normalises the date and refuses anything else", () => {
    expect(parseSelection({ since: "2026-10-01" })).toEqual({ ok: true, select: { since: "2026-10-01T00:00:00Z" } });
    expect(parseSelection({ since: "2026-10-01T08:30" })).toEqual({ ok: true, select: { since: "2026-10-01T08:30:00Z" } });
    expect(parseSelection({ since: "2026-10-01T08:30:15.123Z" })).toEqual({ ok: true, select: { since: "2026-10-01T08:30:15Z" } });
    for (const bad of ["yesterday", "2026-13-45", "2026-10-01 or 1 eq 1", "2026-10-01'", 20261001, "1; drop"]) {
      expect(parseSelection({ since: bad }).ok, String(bad)).toBe(false);
    }
  });

  it("limits text to 80 characters and strips control characters", () => {
    expect(parseSelection({ text: "  AG\tGmbH \n" })).toEqual({ ok: true, select: { text: "AG GmbH" } });
    expect(parseSelection({ text: "x".repeat(80) })).toMatchObject({ ok: true });
    expect(parseSelection({ text: "x".repeat(81) })).toMatchObject({ ok: false });
    expect(parseSelection({ text: "x".repeat(100_000) })).toMatchObject({ ok: false });
    expect(parseSelection({ text: 5 })).toMatchObject({ ok: false });
  });

  it("takes active_only only as a boolean", () => {
    expect(parseSelection({ active_only: true })).toEqual({ ok: true, select: { activeOnly: true } });
    expect(parseSelection({ active_only: "true" })).toMatchObject({ ok: false });
  });
});

describe("buildSelection: Dataverse", () => {
  const cust = ec("dataverse", "customers");

  it("reads GUIDs bare and numbers as strings, in one OR group", () => {
    const b = buildSelection("dataverse", cust, { ids: [G1, "C-0001", G2] });
    expect(b).toEqual({ filters: [`(accountid eq ${G1} or accountnumber eq 'C-0001' or accountid eq ${G2})`], unsupported: [], nothingUsable: false });
  });

  it("matches text against the name and the number, with quotes doubled", () => {
    const b = buildSelection("dataverse", cust, { text: "O'Brien" });
    expect(b.filters).toEqual([`(contains(name,'O''Brien') or contains(accountnumber,'O''Brien'))`]);
  });

  it("cannot be broken out of with quotes, brackets or operators in the text", () => {
    const attack = `x') or (1 eq 1`;
    const [f] = buildSelection("dataverse", cust, { text: attack }).filters;
    expect(f).toBe(`(contains(name,'x'') or (1 eq 1') or contains(accountnumber,'x'') or (1 eq 1'))`);
    // Every quote inside the literal is doubled, so the literal never ends early.
    const literal = f.match(/contains\(name,('(?:[^']|'')*')\)/);
    expect(literal?.[1]).toBe(`'x'') or (1 eq 1'`);
    for (const op of ["$filter", "$top", "$expand"]) expect(buildSelection("dataverse", cust, { text: op }).filters[0]).toContain(`'${op}'`);
  });

  it("copes with the largest text", () => {
    const text = "'".repeat(80);
    const [f] = buildSelection("dataverse", cust, { text }).filters;
    expect(f).toContain(`'${"''".repeat(80)}'`);
    expect(f.length).toBeLessThan(1000);
  });

  it("ANDs since, text and active, each in brackets", () => {
    const b = buildSelection("dataverse", cust, { since: "2026-10-01T00:00:00Z", text: "AG", activeOnly: true });
    expect(b.filters).toEqual([`(modifiedon ge 2026-10-01T00:00:00Z) and (contains(name,'AG') or contains(accountnumber,'AG')) and (statecode eq 0)`]);
    expect(b.unsupported).toEqual([]);
  });

  it("combines ids with the other filters and splits long lists into groups", () => {
    const ids = Array.from({ length: IDS_PER_REQUEST * 2 + 5 }, (_, i) => `C-${String(i).padStart(4, "0")}`);
    const b = buildSelection("dataverse", cust, { ids, activeOnly: true });
    expect(b.filters).toHaveLength(3);
    for (const f of b.filters) {
      expect(f.endsWith(" and (statecode eq 0)")).toBe(true);
      expect(f.length).toBeLessThan(900);
    }
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

  it("uses a name column only when it is a plain column", () => {
    const cust = ec("dataverse", "customers");
    const odd = { ...cust, field_map: { ...cust.field_map, name: "a.b/c" } };
    expect(buildSelection("dataverse", odd, { text: "x" }).filters).toEqual([`(contains(accountnumber,'x'))`]);
    const none = { ...odd, key_field: undefined };
    expect(buildSelection("dataverse", none, { text: "x" })).toMatchObject({ nothingUsable: true });
  });
});

describe("buildSelection: Finance & Operations and Business Central", () => {
  it("F&O: keys are text; no modified column and no active flag means those are reported, not guessed", () => {
    const c = ec("fo", "customers");
    expect(selectionSupport("fo", c)).toEqual({ since: false, text: true, active: false, numbers: true });
    const b = buildSelection("fo", c, { since: "2026-10-01T00:00:00Z", text: "AG", activeOnly: true });
    expect(b.filters).toEqual([`(contains(OrganizationName,'AG') or contains(CustomerAccount,'AG'))`]);
    expect(b.unsupported).toHaveLength(2);
    expect(b.unsupported.join(" ")).toContain("Changed since");
    expect(b.unsupported.join(" ")).toContain("Active only");
    expect(b.nothingUsable).toBe(false);
  });

  it("F&O: an id that looks like a GUID is still a text key", () => {
    expect(buildSelection("fo", ec("fo", "customers"), { ids: ["US-001", G1] }).filters).toEqual([`(CustomerAccount eq 'US-001' or CustomerAccount eq '${G1}')`]);
  });

  it("nothing left to apply is refused rather than widened", () => {
    const b = buildSelection("fo", ec("fo", "customers"), { since: "2026-10-01T00:00:00Z" });
    expect(b).toMatchObject({ filters: [], nothingUsable: true });
    expect(b.unsupported).toHaveLength(1);
  });

  it("Business Central: GUID by id, number by number, since by lastModifiedDateTime, no active flag", () => {
    const c = ec("bc", "customers");
    expect(selectionSupport("bc", c)).toEqual({ since: true, text: true, active: false, numbers: true });
    const b = buildSelection("bc", c, { ids: [G1, "C00010"], since: "2026-10-01T00:00:00Z", activeOnly: true });
    expect(b.filters).toEqual([`(id eq ${G1} or number eq 'C00010') and (lastModifiedDateTime ge 2026-10-01T00:00:00Z)`]);
    expect(b.unsupported).toEqual([expect.stringContaining("Business Central")]);
  });

  it("an entity that is not configured supports nothing", () => {
    expect(selectionSupport("fo", null)).toEqual({ since: false, text: false, active: false, numbers: false });
  });
});

describe("describeSelection", () => {
  it("says what was read in one line", () => {
    expect(describeSelection({ since: "2026-10-01T00:00:00Z", text: "AG", activeOnly: true })).toBe(`changed since 1 Oct 2026, contains "AG", active only`);
    expect(describeSelection({ ids: [G1] })).toBe("1 record by id or number");
  });
});
