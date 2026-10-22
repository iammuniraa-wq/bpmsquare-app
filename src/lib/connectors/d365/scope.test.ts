import { describe, it, expect } from "vitest";
import { parseDataverseAttributes, parseDataverseOptions, parseLookupTargets, parseODataEnum, type ErpField } from "@/lib/middleware/metadata";
import {
  MAX_SCOPE_CONDITIONS, MAX_SCOPE_FILTER_CHARS, MAX_SCOPE_VALUES, buildScopeFilter, cleanScope, conditionId, kindOfField, scopeAttributes, scopeSignature, scopeSummary, scopeWords,
} from "./scope";
import type { ScopeCondition } from "./types";

const G = "11111111-2222-4333-8444-555555555555";
const G2 = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const cond = (over: Partial<ScopeCondition> & { attribute: string; kind: ScopeCondition["kind"]; values: string[] }): ScopeCondition => over as ScopeCondition;
const filterOf = (product: "dataverse" | "fo" | "bc", conditions: ScopeCondition[], entity: "customers" | "contacts" = "customers") => {
  const r = buildScopeFilter(product, { conditions }, entity);
  if (!r.ok) throw new Error(r.error);
  return r.filter;
};

describe("buildScopeFilter: Dataverse", () => {
  it("OR inside a condition, AND between conditions: class A, B, C and territory North", () => {
    expect(filterOf("dataverse", [
      cond({ attribute: "accountclassificationcode", kind: "option", values: ["1", "2", "3"] }),
      cond({ attribute: "territoryid", kind: "lookup", values: [G] }),
    ])).toBe(`(accountclassificationcode eq 1 or accountclassificationcode eq 2 or accountclassificationcode eq 3) and (_territoryid_value eq ${G})`);
  });

  it("option-set codes are bare integers, GUIDs are bare, strings are quoted with quotes doubled, yes/no is true or false, numbers are bare", () => {
    expect(filterOf("dataverse", [
      cond({ attribute: "statecode", kind: "option", values: ["0"] }),
      cond({ attribute: "address1_country", kind: "text", values: ["Cote d'Ivoire"] }),
      cond({ attribute: "donotemail", kind: "boolean", values: ["true"] }),
      cond({ attribute: "numberofemployees", kind: "number", values: ["-5", "12.5"] }),
    ])).toBe(`(statecode eq 0) and (address1_country eq 'Cote d''Ivoire') and (donotemail eq true) and (numberofemployees eq -5 or numberofemployees eq 12.5)`);
  });

  it("a contact's customer attribute goes through the customer navigation property", () => {
    expect(filterOf("dataverse", [
      cond({ attribute: "territoryid", kind: "lookup", values: [G], via: "customer" }),
      cond({ attribute: "address1_country", kind: "text", values: ["Qatar"], via: "customer" }),
    ], "contacts")).toBe(`(parentcustomerid_account/_territoryid_value eq ${G}) and (parentcustomerid_account/address1_country eq 'Qatar')`);
  });

  it("no condition, no filter", () => {
    expect(filterOf("dataverse", [])).toBeUndefined();
    expect(buildScopeFilter("dataverse", undefined)).toEqual({ ok: true, filter: undefined });
  });

  it("refuses a scope that would make a URL too long instead of sending half of it", () => {
    const values = Array.from({ length: MAX_SCOPE_VALUES }, (_, i) => `${"x".repeat(95)}${String(i).padStart(3, "0")}`);
    const r = buildScopeFilter("dataverse", { conditions: Array.from({ length: MAX_SCOPE_CONDITIONS }, (_, i) => cond({ attribute: `attr${i}`, kind: "text", values })) });
    expect(r.ok).toBe(false);
    expect(MAX_SCOPE_FILTER_CHARS).toBeGreaterThan(1000);
  });
});

describe("buildScopeFilter: Finance & Operations and Business Central", () => {
  it("F&O: a text attribute is quoted; an enum value carries its type", () => {
    expect(filterOf("fo", [
      cond({ attribute: "CustomerGroupId", kind: "text", values: ["10", "20"] }),
      cond({ attribute: "PartyType", kind: "option", values: ["Organization"], enum_type: "Microsoft.Dynamics.DataEntities.DirPartyType" }),
    ])).toBe(`(CustomerGroupId eq '10' or CustomerGroupId eq '20') and (PartyType eq Microsoft.Dynamics.DataEntities.DirPartyType'Organization')`);
  });

  it("BC: an option is its quoted name, yes/no is a boolean", () => {
    expect(filterOf("bc", [
      cond({ attribute: "type", kind: "option", values: ["Company"] }),
      cond({ attribute: "blocked", kind: "boolean", values: ["false"] }),
    ])).toBe(`(type eq 'Company') and (blocked eq false)`);
  });

  it("a lookup is Dataverse only", () => {
    expect(cleanScope([{ attribute: "x", kind: "lookup", values: [G] }], "fo", "customers").ok).toBe(false);
    expect(cleanScope([{ attribute: "x", kind: "lookup", values: [G] }], "bc", "customers").ok).toBe(false);
  });
});

describe("cleanScope: nothing typed reaches a filter raw", () => {
  const ok = (c: unknown, product: "dataverse" | "fo" | "bc" = "dataverse") => cleanScope([c], product, "customers").ok;

  it("refuses attribute names that are not plain identifiers", () => {
    for (const bad of ["name; drop", "a b", "a)or(1 eq 1", "a/b", "$filter", "a'b", "", "1a", "x".repeat(101), "é"]) {
      expect(ok({ attribute: bad, kind: "text", values: ["x"] }), bad).toBe(false);
    }
  });

  it("refuses option codes that are not integers (Dataverse)", () => {
    for (const bad of ["1 or 1 eq 1", "1.5", "a", "1)", "99999999999", "-", "0x1"]) expect(ok({ attribute: "statecode", kind: "option", values: [bad] }), bad).toBe(false);
    expect(ok({ attribute: "statecode", kind: "option", values: ["-1", "0", "100000001"] })).toBe(true);
  });

  it("refuses ids that are not GUIDs, and accepts braces", () => {
    for (const bad of ["abc", `${G} or 1 eq 1`, `'${G}'`, G.slice(1)]) expect(ok({ attribute: "territoryid", kind: "lookup", values: [bad] }), bad).toBe(false);
    const r = cleanScope([{ attribute: "territoryid", kind: "lookup", values: [`{${G}}`, G.toUpperCase()] }], "dataverse", "customers");
    expect(r).toMatchObject({ ok: true, scope: { conditions: [{ values: [G] }] } });
  });

  it("refuses an enum member or type that could carry syntax (F&O)", () => {
    const base = { attribute: "PartyType", kind: "option", enum_type: "Microsoft.Dynamics.DataEntities.T" };
    for (const bad of ["x' or 1 eq 1", "a b", "a)", "a.b"]) expect(ok({ ...base, values: [bad] }, "fo"), bad).toBe(false);
    expect(ok({ ...base, enum_type: "T'(x", values: ["A"] }, "fo")).toBe(false);
    expect(ok({ attribute: "PartyType", kind: "option", values: ["A"] }, "fo")).toBe(false);
  });

  it("refuses numbers and booleans that are not plain", () => {
    for (const bad of ["1e9", "1 or 1", "--1", ".5", "1,5", "NaN"]) expect(ok({ attribute: "n", kind: "number", values: [bad] }), bad).toBe(false);
    for (const bad of ["yes", "TRUE", "1"]) expect(ok({ attribute: "b", kind: "boolean", values: [bad] }), bad).toBe(false);
  });

  it("quotes and operators in text stay inside the literal", () => {
    for (const attack of [`x') or (1 eq 1`, `x' or 'a'='a`, `'; drop`, "$filter=1", `\u0000x`]) {
      const f = filterOf("dataverse", [cond({ attribute: "name", kind: "text", values: [attack] })]) ?? "";
      const literal = /^\(name eq '((?:[^']|'')*)'\)$/.exec(f);
      expect(literal, attack).not.toBeNull();
    }
  });

  it("caps conditions at 5 and values at 50, and survives huge input", () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ attribute: `a${i}`, kind: "text", values: ["x"] }));
    expect(cleanScope(six, "dataverse", "customers").ok).toBe(false);
    expect(cleanScope(six.slice(0, 5), "dataverse", "customers").ok).toBe(true);
    const many = Array.from({ length: 51 }, (_, i) => `v${i}`);
    expect(ok({ attribute: "a", kind: "text", values: many })).toBe(false);
    expect(ok({ attribute: "a", kind: "text", values: many.slice(0, 50) })).toBe(true);
    expect(ok({ attribute: "a", kind: "text", values: ["x".repeat(100_000)] })).toBe(false);
    expect(ok({ attribute: "a", kind: "text", values: ["x".repeat(100)] })).toBe(true);
    expect(cleanScope(Array.from({ length: 10_000 }, () => ({})), "dataverse", "customers").ok).toBe(false);
  });

  it("refuses an empty row, an unknown kind, a repeated attribute and a non-list", () => {
    expect(ok({ attribute: "a", kind: "text", values: [] })).toBe(false);
    expect(ok({ attribute: "a", kind: "regex", values: ["x"] })).toBe(false);
    expect(cleanScope([{ attribute: "a", kind: "text", values: ["x"] }, { attribute: "a", kind: "text", values: ["y"] }], "dataverse", "customers").ok).toBe(false);
    expect(cleanScope("a", "dataverse", "customers").ok).toBe(false);
    expect(cleanScope(undefined, "dataverse", "customers")).toEqual({ ok: true, scope: { conditions: [] } });
  });

  it("a customer attribute is only for Dataverse contacts", () => {
    const c = { attribute: "territoryid", kind: "lookup", values: [G], via: "customer" };
    expect(cleanScope([c], "dataverse", "contacts").ok).toBe(true);
    expect(cleanScope([c], "dataverse", "customers").ok).toBe(false);
    expect(cleanScope([{ ...c, kind: "text", values: ["x"] }], "bc", "contacts").ok).toBe(false);
  });

  it("drops duplicate values and keeps one label per value", () => {
    const r = cleanScope([{ attribute: "statecode", kind: "option", values: ["1", "1", "2"], labels: ["A", "A", "B"] }], "dataverse", "customers");
    expect(r).toMatchObject({ ok: true, scope: { conditions: [{ values: ["1", "2"], labels: ["A", "B"] }] } });
  });
});

describe("the words of a scope", () => {
  const scope = { conditions: [
    cond({ attribute: "accountclassificationcode", kind: "option", values: ["1", "2", "3"], labels: ["A", "B", "C"], attribute_label: "Class" }),
    cond({ attribute: "territoryid", kind: "lookup", values: [G], labels: ["North"], attribute_label: "Territory" }),
  ] };

  it("short and plain: Class A, B, C · Territory North", () => {
    expect(scopeWords(scope)).toBe("Class A, B, C · Territory North");
    expect(scopeSummary(scope, "Customers")).toBe("Class A, B, C · Territory North");
  });
  it("no scope reads as all", () => {
    expect(scopeSummary(undefined, "Customers")).toBe("All customers");
    expect(scopeSummary({ conditions: [] }, "vendors")).toBe("All vendors");
    expect(scopeWords({ conditions: [] })).toBe("");
  });
  it("long value lists are cut after three", () => {
    const c = cond({ attribute: "x", kind: "text", values: ["a", "b", "c", "d", "e"], attribute_label: "Group" });
    expect(scopeWords({ conditions: [c] })).toBe("Group a, b, c +2");
  });
  it("two scopes that read the same records have the same signature", () => {
    const flipped = { conditions: [...scope.conditions].reverse().map((c) => ({ ...c, values: [...c.values].reverse(), labels: undefined })) };
    expect(scopeSignature(flipped)).toBe(scopeSignature(scope));
    expect(scopeSignature({ conditions: [{ ...scope.conditions[0], values: ["1"] }] })).not.toBe(scopeSignature(scope));
  });
});

describe("the attributes a scope can use", () => {
  const field = (name: string, type: string, extra: Partial<ErpField> = {}): ErpField => ({ name, label: name.toUpperCase(), type, required: false, creatable: true, ...extra });
  const dv = [
    field("name", "String"), field("territoryid", "Lookup"), field("accountclassificationcode", "Picklist"), field("statecode", "State"),
    field("address1_country", "String"), field("createdon", "DateTime"), field("accountid", "Uniqueidentifier"), field("donotemail", "Boolean"),
    field("hidden", "String", { filterable: false }), field("revenue", "Money"),
  ];

  it("Dataverse: common attributes first, in the preset order; the rest after, sorted; dates, ids and unfilterable columns left out", () => {
    const a = scopeAttributes("dataverse", "customers", dv);
    expect(a.slice(0, 4).map((x) => x.name)).toEqual(["accountclassificationcode", "territoryid", "address1_country", "statecode"]);
    expect(a.slice(0, 4).every((x) => x.common)).toBe(true);
    const rest = a.slice(4).map((x) => x.name);
    expect(rest).toEqual(expect.arrayContaining(["name", "donotemail", "revenue"]));
    expect(rest).not.toEqual(expect.arrayContaining(["createdon", "accountid", "hidden"]));
    expect(a.every((x, i) => (i < 4 ? x.common : !x.common))).toBe(true);
  });

  it("kinds come from the system's own types", () => {
    const k = Object.fromEntries(scopeAttributes("dataverse", "customers", dv).map((x) => [x.name, x.kind]));
    expect(k).toMatchObject({ accountclassificationcode: "option", statecode: "option", territoryid: "lookup", address1_country: "text", donotemail: "boolean", revenue: "number" });
  });

  it("a preset the system does not have is not offered", () => {
    const names = scopeAttributes("dataverse", "customers", [field("name", "String")]).map((x) => x.name);
    expect(names).toEqual(["name"]);
  });

  it("when the system's field list cannot be read, only the presets are offered", () => {
    const a = scopeAttributes("dataverse", "customers", null);
    expect(a.map((x) => x.name)).toContain("territoryid");
    expect(a.every((x) => x.common)).toBe(true);
  });

  it("Dataverse contacts also offer the contact's customer", () => {
    const a = scopeAttributes("dataverse", "contacts", [field("statecode", "State")], dv);
    const viaCustomer = a.filter((x) => x.via === "customer");
    expect(viaCustomer.map((x) => x.id)).toContain("customer:territoryid");
    expect(a.find((x) => x.id === "statecode")?.via).toBeUndefined();
    expect(scopeAttributes("dataverse", "customers", dv).some((x) => x.via)).toBe(false);
    expect(scopeAttributes("bc", "contacts", [field("type", "String")], dv).some((x) => x.via)).toBe(false);
    expect(conditionId({ attribute: "territoryid", via: "customer" })).toBe("customer:territoryid");
  });

  it("F&O and Business Central: Edm types and enums; an enum keeps its type", () => {
    expect(kindOfField("fo", field("CustomerGroupId", "String"))).toBe("text");
    expect(kindOfField("fo", field("Credit", "Decimal"))).toBe("number");
    expect(kindOfField("bc", field("blocked", "Boolean"))).toBe("boolean");
    expect(kindOfField("fo", field("PartyType", "Microsoft.Dynamics.DataEntities.DirPartyType"))).toBe("option");
    expect(kindOfField("fo", field("Start", "DateTimeOffset"))).toBeNull();
    expect(kindOfField("fo", field("Many", "Collection(Edm.String)"))).toBeNull();
    const a = scopeAttributes("fo", "customers", [field("CustomerGroupId", "String"), field("PartyType", "Microsoft.Dynamics.DataEntities.DirPartyType")]);
    expect(a.find((x) => x.name === "PartyType")).toMatchObject({ kind: "option", enum_type: "Microsoft.Dynamics.DataEntities.DirPartyType", common: true });
  });

  it("every preset entity of every product has a list", () => {
    for (const product of ["dataverse", "fo", "bc"] as const) {
      for (const entity of ["customers", "vendors", "products", "projects"] as const) {
        expect(scopeAttributes(product, entity, null).length, `${product} ${entity}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("what the system says about a pick-list", () => {
  it("Dataverse options: code and label, sorted by label; yes/no with its own words", () => {
    const options = parseDataverseOptions({ OptionSet: { Options: [
      { Value: 3, Label: { UserLocalizedLabel: { Label: "Class C" } } },
      { Value: 1, Label: { UserLocalizedLabel: { Label: "Class A" } } },
      { Value: "x", Label: null },
    ] } });
    expect(options).toEqual([{ value: "1", label: "Class A" }, { value: "3", label: "Class C" }]);
    expect(parseDataverseOptions({ OptionSet: { TrueOption: { Value: 1, Label: { UserLocalizedLabel: { Label: "Allow" } } }, FalseOption: { Value: 0, Label: null } } }))
      .toEqual([{ value: "true", label: "Allow" }, { value: "false", label: "No" }]);
    expect(parseDataverseOptions(null)).toEqual([]);
  });
  it("lookup targets: plain table names only", () => {
    expect(parseLookupTargets({ Targets: ["systemuser", "team", "x'y"] })).toEqual(["systemuser", "team"]);
    expect(parseLookupTargets({})).toEqual([]);
  });
  it("OData enum members", () => {
    const xml = `<Schema><EnumType Name="DirPartyType"><Member Name="Person" Value="1"/><Member Name="Organization" Value="2"/><Member Name="_x0020_" Value="0"/></EnumType></Schema>`;
    expect(parseODataEnum(xml, "Microsoft.Dynamics.DataEntities.DirPartyType")).toEqual([{ value: "Person", label: "Person" }, { value: "Organization", label: "Organization" }]);
    expect(parseODataEnum(xml, "Nope")).toEqual([]);
  });
  it("a Dataverse column the system says cannot be searched is marked", () => {
    const f = parseDataverseAttributes({ value: [{ LogicalName: "a", AttributeType: "String", IsValidForAdvancedFind: { Value: false }, AttributeOf: null }, { LogicalName: "b", AttributeType: "String", IsValidForAdvancedFind: { Value: true }, AttributeOf: null }] });
    expect(f.find((x) => x.name === "a")?.filterable).toBe(false);
    expect(f.find((x) => x.name === "b")).not.toHaveProperty("filterable");
  });
});
