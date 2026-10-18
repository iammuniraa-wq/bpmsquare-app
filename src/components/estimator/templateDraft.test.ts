import { describe, it, expect } from "vitest";
import { toDraft, toBody, moveItem, issuesUnder, templateIdentifiers } from "./templateDraft";
import { PRECAST_VILLA_STARTER } from "@/lib/estimator/starterTemplates";
import { validateTemplate } from "@/lib/estimator/template";

const starter = () => ({
  name: PRECAST_VILLA_STARTER.name, description: PRECAST_VILLA_STARTER.description, trade: PRECAST_VILLA_STARTER.trade,
  quote_granularity: PRECAST_VILLA_STARTER.quote_granularity, geometry: PRECAST_VILLA_STARTER.geometry ?? null,
  inputs: PRECAST_VILLA_STARTER.inputs, rates: PRECAST_VILLA_STARTER.rates, rules: PRECAST_VILLA_STARTER.rules,
});

describe("template draft", () => {
  it("round-trips the starter into a template that still validates with no issues", () => {
    const body = toBody(toDraft(starter()));
    const v = validateTemplate(body);
    expect(v.issues).toEqual([]);
    expect(v.template?.rules.length).toBe(PRECAST_VILLA_STARTER.rules.length);
    expect(v.template?.inputs.length).toBe(PRECAST_VILLA_STARTER.inputs.length);
  });

  it("leaves empty optional boxes out and keeps a waste formula as text", () => {
    const d = toDraft(starter());
    d.rules[0].waste_pct = "wastage_pct";
    d.inputs[0].min = "";
    const b = toBody(d);
    expect(b.rules[0].waste_pct).toBe("wastage_pct");
    expect("min" in b.inputs[0]).toBe(false);
  });

  it("sends a non-number as NaN so the validator can name it", () => {
    const d = toDraft(starter());
    d.rates[0].value = "abc";
    expect(Number.isNaN(toBody(d).rates[0].value)).toBe(true);
  });

  it("lists the identifiers a formula may use", () => {
    const ids = templateIdentifiers(toDraft(starter()));
    expect(ids.inputs.length).toBeGreaterThan(0);
    expect(ids.lines[0]).toMatch(/^qty_/);
    expect(ids.groups[0]).toMatch(/^sub_/);
  });

  it("moves items and stops at the ends", () => {
    expect(moveItem([1, 2, 3], 1, -1)).toEqual([2, 1, 3]);
    expect(moveItem([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
    expect(moveItem([1, 2, 3], 2, 1)).toEqual([1, 2, 3]);
  });

  it("finds the issues under a row", () => {
    const issues = [{ path: "rules[2].qty", message: "a" }, { path: "rules[20].qty", message: "b" }, { path: "rules[2]", message: "c" }];
    expect(issuesUnder(issues, "rules[2]")).toEqual([{ field: "qty", message: "a" }, { field: "", message: "c" }]);
  });
});
