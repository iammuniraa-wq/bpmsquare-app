import { describe, expect, it } from "vitest";
import { enrichFields, erpFieldToTarget, erpFieldType, parseLookupTargets, parsePicklists } from "./dataverse";
import type { ErpField } from "../metadata";

const f = (name: string, type: string, over: Partial<ErpField> = {}): ErpField => ({ name, label: name, type, required: false, creatable: true, ...over });

describe("Dataverse attribute types", () => {
  it("maps the attribute types to the engine's families", () => {
    expect(erpFieldType("String")).toBe("text");
    expect(erpFieldType("Memo")).toBe("text");
    expect(erpFieldType("Money")).toBe("number");
    expect(erpFieldType("BigInt")).toBe("integer");
    expect(erpFieldType("DateTime")).toBe("datetime");
    expect(erpFieldType("Lookup")).toBe("lookup");
    expect(erpFieldType("Picklist")).toBe("enum");
    expect(erpFieldType("Edm.Whatever")).toBe("text");
    expect(erpFieldType("Int32")).toBe("integer");
  });
});

describe("choice columns and lookups", () => {
  const picklists = parsePicklists({
    value: [
      { LogicalName: "statuscode", OptionSet: { Options: [{ Value: 1, Label: { UserLocalizedLabel: { Label: "Draft" } } }, { Value: 2, Label: { LocalizedLabels: [{ Label: "Active" }] } }, { Value: "x" }] } },
      { LogicalName: "empty", OptionSet: { Options: [] } }, { OptionSet: {} }, null,
    ],
  });
  const lookups = parseLookupTargets({ value: [{ LogicalName: "customerid", Targets: ["account", "contact"] }, { LogicalName: "bad", Targets: ["Bad Name"] }, { Targets: ["x"] }] });

  it("reads the codes with their labels and skips what is not a code", () => {
    expect(picklists).toEqual({ statuscode: { codes: ["1", "2"], labels: { "1": "Draft", "2": "Active" } } });
    expect(lookups).toEqual({ customerid: "account" });
  });

  it("adds them to the field list so a value list can be proposed and a lookup is never fed text", () => {
    const out = enrichFields([f("statuscode", "Status"), f("customerid", "Customer"), f("name", "String")], picklists, lookups);
    expect(erpFieldToTarget(out[0])).toMatchObject({ type: "enum", enum: ["1", "2"], enumLabels: { "1": "Draft", "2": "Active" } });
    expect(erpFieldToTarget(out[1])).toMatchObject({ type: "lookup", lookup: "account" });
    expect(erpFieldToTarget(out[2])).toEqual({ path: "name", label: "name", type: "text", required: false, creatable: true });
  });
});
