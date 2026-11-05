import { describe, expect, it } from "vitest";
import {
  parseAccountsView, meshFor, initialsOf, countChips, listHref, typeChips, telHref, mailHref, toRichRow,
} from "./richAccounts";

describe("parseAccountsView", () => {
  it("keeps the three views and falls back to Rows for anything else", () => {
    expect(parseAccountsView("cards")).toBe("cards");
    expect(parseAccountsView("table")).toBe("table");
    expect(parseAccountsView("rows")).toBe("rows");
    expect(parseAccountsView(null)).toBe("rows");
    expect(parseAccountsView("grid")).toBe("rows");
    expect(parseAccountsView(undefined)).toBe("rows");
  });
});

describe("meshFor and initialsOf", () => {
  it("paints the same mesh for the same name, always one of a-f", () => {
    expect(meshFor("Acme Foods")).toBe(meshFor("Acme Foods"));
    for (const n of ["", "A", "Vikas Pioneers", "مؤسسة"]) expect(meshFor(n)).toMatch(/^[a-f]$/);
  });
  it("takes up to two initials and never returns an empty tile", () => {
    expect(initialsOf("acme foods pvt")).toBe("AF");
    expect(initialsOf("  Solo ")).toBe("S");
    expect(initialsOf("")).toBe("?");
  });
});

describe("countChips", () => {
  it("lists only real, non-zero counts with the right singular or plural", () => {
    expect(countChips({ contacts: 0, cases: 0, assets: 0, contracts: 0 })).toEqual([]);
    expect(countChips({ contacts: 3, cases: 1, assets: 0, contracts: 2 }).map((c) => c.label)).toEqual(["3 contacts", "1 case", "2 AMCs"]);
  });
});

describe("listHref and typeChips", () => {
  it("drops empty params", () => {
    expect(listHref("/accounts", { q: "ace", type: undefined, af: "" })).toBe("/accounts?q=ace");
    expect(listHref("/accounts", {})).toBe("/accounts");
  });
  it("keeps the search and sort when a type is picked, and marks the active chip", () => {
    const chips = typeChips({
      base: "/accounts",
      types: [{ value: "oem", label: "OEM" }, { value: "direct", label: "Direct" }],
      current: "oem",
      params: { q: "ace", type: "oem", sort: "name", dir: "asc" },
    });
    expect(chips.map((c) => c.label)).toEqual(["All", "OEM", "Direct"]);
    expect(chips[0]).toMatchObject({ active: false, href: "/accounts?q=ace&sort=name&dir=asc" });
    expect(chips[1].active).toBe(true);
    expect(chips[2].href).toBe("/accounts?q=ace&sort=name&dir=asc&type=direct");
  });
  it("marks All active when no type is chosen", () => {
    expect(typeChips({ base: "/accounts", types: [{ value: "oem", label: "OEM" }], current: undefined, params: {} })[0].active).toBe(true);
  });
});

describe("telHref and mailHref", () => {
  it("builds a call or mail target only from usable data", () => {
    expect(telHref("+91 80 4000-0000")).toBe("tel:+918040000000");
    expect(telHref("n/a")).toBeNull();
    expect(telHref(null)).toBeNull();
    expect(mailHref(" a@b.co ")).toBe("mailto:a@b.co");
    expect(mailHref("a@b.co, c@d.co")).toBeNull();
    expect(mailHref("not an email")).toBeNull();
  });
});

describe("toRichRow", () => {
  const src = {
    account: { id: "a1", name: "Acme Foods", type: "oem", city: " Pune ", phone: "+91 20 1234 5678", email: "hi@acme.test" },
    referredBy: { name: "Parent Co" },
    counts: { contacts: 2, cases: 0, assets: 1, contracts: 0 },
  };
  it("shapes a row from existing data only", () => {
    const r = toRichRow(src, { href: "/accounts/a1", typeLabel: "OEM", typeTone: "purple", quoteHref: null });
    expect(r).toMatchObject({ id: "a1", initials: "AF", line: "Pune · via Parent Co", tel: "tel:+912012345678", mail: "mailto:hi@acme.test", quoteHref: null });
    expect(r.chips.map((c) => c.label)).toEqual(["2 contacts", "1 asset"]);
  });
  it("leaves out what the record does not have", () => {
    const r = toRichRow(
      { account: { ...src.account, city: null, phone: null, email: null }, referredBy: null, counts: { contacts: 0, cases: 0, assets: 0, contracts: 0 } },
      { href: "/accounts/a1", typeLabel: "OEM", typeTone: "purple", quoteHref: "/quotations/new?account_id=a1" },
    );
    expect(r.line).toBe("");
    expect(r.tel).toBeNull();
    expect(r.mail).toBeNull();
    expect(r.chips).toEqual([]);
    expect(r.quoteHref).toBe("/quotations/new?account_id=a1");
  });
});
