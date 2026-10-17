import { describe, it, expect } from "vitest";
import { validateTemplate, resolveParams, defaultParams, MAX_RULES } from "./template";
import { PRECAST_VILLA_STARTER, STARTER_TEMPLATES } from "./starterTemplates";
import type { EstimateTemplateBody, TemplateRule } from "./types";
import { groupSlug } from "./types";

const rule = (over: Partial<TemplateRule> & { code: string }): TemplateRule => ({
  group: "Structure",
  description: "A line",
  uom: "m3",
  qty: "1",
  component: "materials",
  cost: { kind: "rate", rate: "r" },
  ...over,
});

const base = (rules: TemplateRule[], extra: Partial<EstimateTemplateBody> = {}): EstimateTemplateBody => ({
  inputs: [{ key: "x", label: "X", type: "number", default: 2 }],
  rates: [{ key: "r", label: "R", unit: "per m3", value: 10 }],
  rules,
  ...extra,
});

const issuesOf = (t: unknown) => validateTemplate(t).issues.map((i) => `${i.path}: ${i.message}`);

describe("starter templates", () => {
  it("every starter validates with no issues and no warnings", () => {
    for (const t of STARTER_TEMPLATES) {
      const v = validateTemplate(t);
      expect(v.issues, t.name).toEqual([]);
      expect(v.warnings, t.name).toEqual([]);
      expect(v.ok).toBe(true);
    }
  });

  it("the precast villa starter is labelled illustrative", () => {
    expect(PRECAST_VILLA_STARTER.name).toBe("Precast villa (illustrative)");
    expect(PRECAST_VILLA_STARTER.description.toLowerCase()).toContain("illustrative");
  });

  it("returns a cleaned copy that round-trips", () => {
    const v = validateTemplate(PRECAST_VILLA_STARTER);
    expect(v.template?.rules).toHaveLength(PRECAST_VILLA_STARTER.rules.length);
    expect(validateTemplate(v.template).ok).toBe(true);
  });
});

describe("shape validation", () => {
  it("accepts a minimal valid template", () => {
    const v = validateTemplate(base([rule({ code: "a", qty: "x * 2" })]));
    expect(v.ok).toBe(true);
  });

  it("rejects non-objects and missing rules", () => {
    expect(validateTemplate(null).ok).toBe(false);
    expect(validateTemplate([]).ok).toBe(false);
    expect(validateTemplate("x").ok).toBe(false);
    expect(issuesOf({ inputs: [], rates: [] }).join()).toMatch(/rules must be a list/);
    expect(issuesOf({ inputs: [], rates: [], rules: [] }).join()).toMatch(/at least one rule/);
  });

  it("rejects bad keys, reserved words and prefixes", () => {
    const t = base([rule({ code: "a" })], {
      inputs: [
        { key: "Bad Key", label: "x", type: "number", default: 1 },
        { key: "and", label: "x", type: "number", default: 1 },
        { key: "if", label: "x", type: "number", default: 1 },
        { key: "qty_foo", label: "x", type: "number", default: 1 },
        { key: "sub_foo", label: "x", type: "number", default: 1 },
      ],
    });
    const msgs = issuesOf(t);
    expect(msgs.filter((m) => m.startsWith("inputs["))).toHaveLength(5);
    expect(msgs.join("\n")).toMatch(/reserved word/);
    expect(msgs.join("\n")).toMatch(/qty_/);
  });

  it("rejects an input and a rate sharing a key, and duplicate inputs", () => {
    const t = base([rule({ code: "a" })], {
      inputs: [
        { key: "r", label: "x", type: "number", default: 1 },
        { key: "r", label: "dup", type: "number", default: 1 },
      ],
    });
    const msgs = issuesOf(t).join("\n");
    expect(msgs).toMatch(/already used/);
  });

  it("validates number input bounds and defaults", () => {
    const mk = (input: unknown) => issuesOf(base([rule({ code: "a" })], { inputs: [input as never] })).join("\n");
    expect(mk({ key: "n", label: "N", type: "number", default: 5, min: 10 })).toMatch(/below the minimum/);
    expect(mk({ key: "n", label: "N", type: "number", default: 50, max: 10 })).toMatch(/above the maximum/);
    expect(mk({ key: "n", label: "N", type: "number", default: 5, min: 10, max: 1 })).toMatch(/min cannot be greater/);
    expect(mk({ key: "n", label: "N", type: "number", default: "5" })).toMatch(/numeric default/);
    expect(mk({ key: "n", label: "", type: "number", default: 5 })).toMatch(/label/);
    expect(mk({ key: "n", label: "N", type: "text", default: 5 })).toMatch(/type must be/);
  });

  it("validates select and boolean inputs", () => {
    const mk = (input: unknown) => issuesOf(base([rule({ code: "a" })], { inputs: [input as never] })).join("\n");
    const opts = [{ key: "a", label: "A", value: 1 }, { key: "b", label: "B", value: 2 }];
    expect(mk({ key: "s", label: "S", type: "select", default: "a", options: opts })).toBe("");
    expect(mk({ key: "s", label: "S", type: "select", default: "z", options: opts })).toMatch(/default must be the key/);
    expect(mk({ key: "s", label: "S", type: "select", default: "a", options: [] })).toMatch(/at least one option/);
    expect(mk({ key: "s", label: "S", type: "select", default: "a", options: [opts[0], opts[0]] })).toMatch(/Duplicate option/);
    expect(mk({ key: "s", label: "S", type: "select", default: "a", options: [{ key: "a", label: "A" }] })).toMatch(/numeric value/);
    expect(mk({ key: "b", label: "B", type: "boolean", default: true })).toBe("");
    expect(mk({ key: "b", label: "B", type: "boolean", default: 1 })).toMatch(/true or false/);
  });

  it("validates rates", () => {
    const mk = (rate: unknown) => issuesOf(base([rule({ code: "a", cost: { kind: "rate", rate: "r" } })], { rates: [rate as never, { key: "r", label: "R", unit: "", value: 1 }] })).join("\n");
    expect(mk({ key: "k", label: "K", unit: "per m", value: 3 })).toBe("");
    expect(mk({ key: "k", label: "K", unit: "per m", value: Number.NaN })).toMatch(/finite number/);
    expect(mk({ key: "k", label: "K", unit: "per m", value: "3" })).toMatch(/finite number/);
    expect(mk({ key: "k", label: "", unit: "per m", value: 3 })).toMatch(/label/);
  });

  it("validates rule fields", () => {
    const m = (over: Record<string, unknown>) => issuesOf(base([{ ...rule({ code: "a" }), ...over } as never])).join("\n");
    expect(m({ code: "A-1" })).toMatch(/Rule code/);
    expect(m({ group: "" })).toMatch(/group/);
    expect(m({ group: "&&&" })).toMatch(/letter or digit/);
    expect(m({ description: "" })).toMatch(/description/);
    expect(m({ uom: "" })).toMatch(/unit of measure/);
    expect(m({ qty: "" })).toMatch(/quantity formula/);
    expect(m({ component: "magic" })).toMatch(/Component must be/);
    expect(m({ waste_pct: -1 })).toMatch(/between 0 and 100/);
    expect(m({ waste_pct: 101 })).toMatch(/between 0 and 100/);
    expect(m({ waste_pct: 5 })).toBe("");
    expect(m({ cost: { kind: "rate", rate: "nope" } })).toMatch(/not one of the template's rates/);
    expect(m({ cost: { kind: "product", sku: "" } })).toMatch(/SKU/);
    expect(m({ cost: { kind: "product", sku: "PNL-200" } })).toBe("");
    expect(m({ cost: { kind: "magic" } })).toMatch(/Cost kind/);
    expect(m({ cost: undefined })).toMatch(/cost source/);
    expect(m({ element_type: "Wall Panel" })).toMatch(/Element type/);
  });

  it("rejects duplicate rule codes and duplicate element types", () => {
    expect(issuesOf(base([rule({ code: "a" }), rule({ code: "a" })])).join("\n")).toMatch(/Duplicate rule code "a"/);
    expect(
      issuesOf(base([rule({ code: "a", element_type: "slab" }), rule({ code: "b", element_type: "slab" })])).join("\n")
    ).toMatch(/already used by another rule/);
  });

  it("limits the number of rules", () => {
    const many = Array.from({ length: MAX_RULES + 1 }, (_, i) => rule({ code: `r${i}` }));
    expect(issuesOf(base(many)).join("\n")).toMatch(/at most/);
  });
});

describe("formula references and ordering", () => {
  it("allows an earlier rule's quantity and a complete earlier group's subtotal", () => {
    const v = validateTemplate(base([
      rule({ code: "a", group: "One", qty: "x" }),
      rule({ code: "b", group: "Two", qty: "qty_a * 2 + sub_one" }),
    ]));
    expect(v.issues).toEqual([]);
  });

  it("rejects a forward reference with the fix in the message", () => {
    const msgs = issuesOf(base([
      rule({ code: "a", qty: "qty_b" }),
      rule({ code: "b", qty: "x" }),
    ])).join("\n");
    expect(msgs).toMatch(/refers to a later line/);
    expect(msgs).toMatch(/move "b" above "a"/);
  });

  it("rejects a self reference", () => {
    expect(issuesOf(base([rule({ code: "a", qty: "qty_a + 1" })])).join("\n")).toMatch(/refers to the line itself/);
  });

  it("rejects a cycle (each side points at the other)", () => {
    const msgs = issuesOf(base([
      rule({ code: "a", qty: "qty_b" }),
      rule({ code: "b", qty: "qty_a" }),
    ]));
    // b -> a is fine (a is above); a -> b is the forward reference that closes the loop.
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatch(/rules\[0\]\.qty.*later line/);
  });

  it("rejects references to rules and groups that do not exist", () => {
    const msgs = issuesOf(base([rule({ code: "a", qty: "qty_ghost + sub_nobody" })])).join("\n");
    expect(msgs).toMatch(/rule "ghost" that does not exist/);
    expect(msgs).toMatch(/group that does not exist/);
  });

  it("rejects the rule's own group subtotal and an incomplete group's subtotal", () => {
    const own = issuesOf(base([
      rule({ code: "a", group: "G", qty: "x" }),
      rule({ code: "b", group: "G", qty: "sub_g" }),
    ])).join("\n");
    expect(own).toMatch(/rule's own group/);

    const incomplete = issuesOf(base([
      rule({ code: "a", group: "G", qty: "x" }),
      rule({ code: "b", group: "H", qty: "sub_g" }),
      rule({ code: "c", group: "G", qty: "x" }),
    ])).join("\n");
    expect(incomplete).toMatch(/not complete at this point/);
  });

  it("rejects unknown names and syntax errors with the rule code and position", () => {
    const msgs = issuesOf(base([
      rule({ code: "a", qty: "x + nonsense" }),
      rule({ code: "b", qty: "x +" }),
      rule({ code: "c", qty: "x / ", waste_pct: "1 +" }),
    ])).join("\n");
    expect(msgs).toMatch(/a: unknown name "nonsense"/);
    expect(msgs).toMatch(/b: The formula ends unexpectedly at position/);
    expect(msgs).toMatch(/rules\[2\]\.waste_pct/);
  });

  it("checks a waste formula against the same scope", () => {
    expect(issuesOf(base([rule({ code: "a", waste_pct: "r / 10" })]))).toEqual([]);
    expect(issuesOf(base([rule({ code: "a", waste_pct: "qty_a" })])).join()).toMatch(/itself/);
  });

  it("rejects two group names with the same identifier", () => {
    const msgs = issuesOf(base([
      rule({ code: "a", group: "Stairs & ancillary" }),
      rule({ code: "b", group: "Stairs ancillary" }),
    ])).join("\n");
    expect(msgs).toMatch(/same identifier \(sub_stairs_ancillary\)/);
  });

  it("warns about unused inputs and rates without failing", () => {
    const v = validateTemplate(base([rule({ code: "a", qty: "1", cost: { kind: "product", sku: "S" } })]));
    expect(v.ok).toBe(true);
    expect(v.warnings.map((w) => w.message).join()).toMatch(/Input "x" is not used/);
    expect(v.warnings.map((w) => w.message).join()).toMatch(/Rate "r" is not used/);
  });
});

describe("groupSlug", () => {
  it("makes identifier-safe slugs", () => {
    expect(groupSlug("Structure")).toBe("structure");
    expect(groupSlug("Stairs & ancillary")).toBe("stairs_ancillary");
    expect(groupSlug("Transport & erection")).toBe("transport_erection");
    expect(groupSlug("  Boundary  wall! ")).toBe("boundary_wall");
    expect(groupSlug("%%")).toBe("");
  });
});

describe("resolveParams", () => {
  const inputs = PRECAST_VILLA_STARTER.inputs;

  it("defaultParams gives every input its default", () => {
    const d = defaultParams(inputs);
    expect(d.floors).toBe(2);
    expect(d.include_stairs).toBe(true);
    expect(d.finish_level).toBe("standard");
  });

  it("uses defaults for missing values and turns select/boolean into numbers", () => {
    const r = resolveParams(inputs, {});
    expect(r.ok).toBe(true);
    expect(r.scope.floors).toBe(2);
    expect(r.scope.finish_level).toBe(2);
    expect(r.scope.include_stairs).toBe(1);
    expect(r.params.finish_level).toBe("standard");
  });

  it("accepts numeric strings and boolean-ish values from a form", () => {
    const r = resolveParams(inputs, { floors: "3", include_stairs: "false", finish_level: "premium" });
    expect(r.ok).toBe(true);
    expect(r.scope.floors).toBe(3);
    expect(r.scope.include_stairs).toBe(0);
    expect(r.scope.finish_level).toBe(3);
  });

  it("reports out-of-range, non-numeric and unknown-option values instead of clamping", () => {
    const r = resolveParams(inputs, { floors: 9, wall_height_m: "tall", finish_level: "gold", include_stairs: "maybe" });
    expect(r.ok).toBe(false);
    const msgs = r.issues.map((i) => i.message).join("\n");
    expect(msgs).toMatch(/Number of floors cannot be above 4/);
    expect(msgs).toMatch(/must be a number/);
    expect(msgs).toMatch(/must be one of: basic, standard, premium/);
    expect(msgs).toMatch(/must be yes or no/);
  });

  it("ignores supplied keys that are not inputs, including prototype names", () => {
    const r = resolveParams(inputs, { __proto__: 5, constructor: 1, nope: 2 } as Record<string, unknown>);
    expect(r.ok).toBe(true);
    expect(Object.keys(r.params).sort()).toEqual(inputs.map((i) => i.key).sort());
  });

  it("handles null/undefined supplied", () => {
    expect(resolveParams(inputs, null).ok).toBe(true);
    expect(resolveParams(inputs, undefined).ok).toBe(true);
  });
});
