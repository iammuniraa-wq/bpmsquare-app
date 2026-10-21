import { describe, it, expect } from "vitest";
import { DEFAULT_RULES, parseRules, validateRulesInput, mergeRules, ruleFor, autoAction } from "./rules";
import { selectionContract, targetFor, QUOTE_PRICES_ONLY } from "./contract";
import { outcomeForStatus } from "./types";

describe("rules: defaults and parsing", () => {
  it("starts automatic on awarded, rejected closes the quote, fence = summary + quantity lines", () => {
    const r = parseRules(undefined);
    expect(r.rules.quote_awarded).toEqual({ enabled: true, mode: "auto" });
    expect(r.rules.quote_rejected).toEqual({ enabled: true, mode: "auto" });
    expect(r.fence).toEqual({ summary: true, quantity_lines: true, security_profile: false, drawing_link: false, notes_terms: false });
    expect(r.payload_capture).toBe(false);
  });

  it("estimate defaults: summary and quote lines on, bom and wbs on, internal costs OFF", () => {
    expect(parseRules({}).estimate).toEqual({ summary: true, quote_lines: true, bom: true, wbs: true, internal_costs: false });
  });

  it("falls back to the default for anything malformed, never throws", () => {
    const r = parseRules({ rules: { quote_awarded: { enabled: "yes", mode: "sometimes" }, quote_rejected: 5 }, fence: { summary: "no" }, estimate: [], payload_capture: "true" });
    expect(r).toEqual(DEFAULT_RULES);
    expect(parseRules(null)).toEqual(DEFAULT_RULES);
    expect(parseRules("x")).toEqual(DEFAULT_RULES);
  });

  it("keeps what was stored", () => {
    const r = parseRules({ rules: { quote_awarded: { enabled: true, mode: "manual" } }, fence: { drawing_link: true }, estimate: { internal_costs: true }, payload_capture: true });
    expect(r.rules.quote_awarded.mode).toBe("manual");
    expect(r.fence.drawing_link).toBe(true);
    expect(r.estimate.internal_costs).toBe(true);
    expect(r.payload_capture).toBe(true);
    expect(r.rules.quote_rejected).toEqual({ enabled: true, mode: "auto" });
  });
});

describe("rules: validation of a submitted change", () => {
  it("accepts a partial, valid change", () => {
    expect(validateRulesInput({ rules: { quote_rejected: { mode: "manual" } }, estimate: { bom: false } }).ok).toBe(true);
  });

  it("names the field of every unknown key and wrong type", () => {
    const r = validateRulesInput({ rules: { quote_won: {}, quote_awarded: { mode: "later", enabled: 1 } }, fence: { glitter: true, summary: "x" }, estimate: { magic: true }, payload_capture: "on", extra: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const fields = r.errors.map((e) => e.field);
      expect(fields).toEqual(expect.arrayContaining(["extra", "rules.quote_won", "rules.quote_awarded.mode", "rules.quote_awarded.enabled", "fence.glitter", "fence.summary", "estimate.magic", "payload_capture"]));
    }
  });

  it("rejects a body that is not an object", () => {
    expect(validateRulesInput(null).ok).toBe(false);
    expect(validateRulesInput([]).ok).toBe(false);
  });

  it("merges a partial change over what is stored", () => {
    const cur = parseRules({ fence: { drawing_link: true } });
    const next = mergeRules(cur, { rules: { quote_awarded: { mode: "manual" } }, estimate: { wbs: false } });
    expect(next.rules.quote_awarded).toEqual({ enabled: true, mode: "manual" });
    expect(next.fence.drawing_link).toBe(true);
    expect(next.estimate.wbs).toBe(false);
    expect(next.estimate.bom).toBe(true);
  });
});

describe("rules: what a status change does", () => {
  it("maps Standard Quote status to the awarded / rejected vocabulary", () => {
    expect(outcomeForStatus("accepted")).toBe("awarded");
    expect(outcomeForStatus("rejected")).toBe("rejected");
    expect(outcomeForStatus("sent")).toBeNull();
    expect(outcomeForStatus("draft")).toBeNull();
    expect(outcomeForStatus(undefined)).toBeNull();
  });

  it("send / wait / none", () => {
    expect(autoAction({ enabled: true, mode: "auto" })).toBe("send");
    expect(autoAction({ enabled: true, mode: "manual" })).toBe("wait");
    expect(autoAction({ enabled: false, mode: "auto" })).toBe("none");
    expect(ruleFor(DEFAULT_RULES, "rejected")).toBe(DEFAULT_RULES.rules.quote_rejected);
  });
});

describe("selection contract: what the connected product can take", () => {
  it("a Quote target (Dataverse) greys BOM, WBS and internal costs with the plain hint", () => {
    expect(targetFor("dataverse")).toBe("quote");
    const c = selectionContract("quote");
    for (const part of ["bom", "wbs", "internal_costs"] as const) {
      expect(c.estimate[part]).toEqual({ allowed: false, hint: QUOTE_PRICES_ONLY });
    }
    expect(c.estimate.summary.allowed).toBe(true);
    expect(c.estimate.quote_lines.allowed).toBe(true);
    expect(c.fence.quantity_lines.allowed).toBe(true);
  });

  it("a Project target (F&O, Business Central) takes tasks and BOM but has no price lines", () => {
    expect(targetFor("fo")).toBe("project");
    expect(targetFor("bc")).toBe("project");
    const c = selectionContract("project");
    expect(c.estimate.bom.allowed && c.estimate.wbs.allowed && c.estimate.internal_costs.allowed).toBe(true);
    expect(c.estimate.quote_lines.allowed).toBe(false);
    expect(c.estimate.quote_lines.hint).toBeTruthy();
    expect(c.fence.quantity_lines.allowed).toBe(false);
  });

  it("with no ERP connected nothing is greyed out", () => {
    const c = selectionContract(targetFor(null));
    expect(c.target).toBeNull();
    expect(Object.values(c.estimate).every((o) => o.allowed && o.hint === null)).toBe(true);
    expect(Object.values(c.fence).every((o) => o.allowed)).toBe(true);
  });
});
