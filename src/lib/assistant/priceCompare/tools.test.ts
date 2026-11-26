import { describe, expect, it } from "vitest";
import type { PermissionSet } from "@/lib/permissions";
import { filterSuppliers, normaliseRef } from "./load";
import { AWARD_TOOL, CHECK_TOOL, COMPARE_TOOL, PRICE_COMPARE_PROMPT_RULE, PRICE_TOOL_NAMES, parseAwardInput, parseCheckInput, parseCompareInput, priceAccess, priceTools } from "./tools";
import { SUPPLIERS } from "./fixture";

const grant = (...wc: string[]): PermissionSet => ({
  unrestricted: false,
  grants: new Map(wc.map((w) => [w, { workcenter: w, canView: true, canCreate: false, canEdit: false, canDelete: false }])) as never,
});
const ALL: PermissionSet = { unrestricted: true, grants: new Map() };

describe("references", () => {
  it("RFQ-14, rfq-0014 and RFQ-0014 are one reference; anything else is not a reference", () => {
    expect(normaliseRef("RFQ-14")).toEqual({ prefix: "RFQ", ref: "RFQ-0014" });
    expect(normaliseRef(" rfq-0014 ")).toEqual({ prefix: "RFQ", ref: "RFQ-0014" });
    expect(normaliseRef("OPP-34")).toEqual({ prefix: "OPP", ref: "OPP-0034" });
    expect(normaliseRef("RFQ-123456")).toEqual({ prefix: "RFQ", ref: "RFQ-123456" });
    for (const bad of ["civil package", "RFQ0014", "RFQ-", "-0014", "", null, 14, "RFQ-0014; drop table"]) expect(normaliseRef(bad), String(bad)).toBeNull();
  });
});

describe("naming suppliers", () => {
  it("keeps the ones the person named, and says which names matched nobody", () => {
    expect(filterSuppliers(SUPPLIERS, ["alpha", "Beta Trading"]).kept.map((s) => s.name)).toEqual(["Alpha Supply", "Beta Trading"]);
    expect(filterSuppliers(SUPPLIERS, ["Delta"])).toEqual({ kept: [], unmatched: ["delta"] });
    expect(filterSuppliers(SUPPLIERS, []).kept).toHaveLength(3);
    expect(filterSuppliers(SUPPLIERS, ["al"]).kept).toEqual([]); // two letters match no supplier by accident
  });
});

describe("what a person has", () => {
  const on = { rfq: true, ai_assistant: true };
  it("compare: the RFQ module and the RFQs view", () => {
    expect(priceAccess({ features: on, perms: ALL })).toEqual({ compare: true, check: false, award: false });
    expect(priceAccess({ features: { ai_assistant: true }, perms: ALL }).compare).toBe(false);
    expect(priceAccess({ features: on, perms: grant("accounts") }).compare).toBe(false);
    expect(priceAccess({ features: on, perms: grant("rfqs") }).compare).toBe(true);
  });
  it("check: the tender edition, Pipeline on, and the Pipeline view", () => {
    expect(priceAccess({ features: { gcc_tender: true, pipeline: true }, perms: ALL }).check).toBe(true);
    expect(priceAccess({ features: { gcc_tender: true }, perms: ALL }).check).toBe(false);
    expect(priceAccess({ features: { pipeline: true }, perms: ALL }).check).toBe(false);
    expect(priceAccess({ features: { gcc_tender: true, pipeline: true }, perms: grant("rfqs") }).check).toBe(false);
  });
  it("award: also the assistant's actions flag with Nova on, a signed-in person and the right to edit RFQs", () => {
    const actions = { ...on, ai_assistant_actions: true, next_experience: true };
    expect(priceAccess({ features: actions, perms: ALL, userId: "u" }).award).toBe(true);
    expect(priceAccess({ features: actions, perms: ALL }).award).toBe(false);
    expect(priceAccess({ features: on, perms: ALL, userId: "u" }).award).toBe(false);
    expect(priceAccess({ features: { ...actions, next_experience: false }, perms: ALL, userId: "u" }).award).toBe(false);
    expect(priceAccess({ features: actions, perms: grant("rfqs"), userId: "u" }).award).toBe(false);
    const edit: PermissionSet = { unrestricted: false, grants: new Map([["rfqs", { workcenter: "rfqs", canView: true, canCreate: false, canEdit: true, canDelete: false }]]) as never };
    expect(priceAccess({ features: actions, perms: edit, userId: "u" }).award).toBe(true);
  });
});

describe("the tool definitions", () => {
  const all = { compare: true, check: true, award: true };
  it("each exists only with its access, and the award is dropped while a web answer is in the chat", () => {
    expect(priceTools({ compare: true, check: false, award: false }).map((t) => t.name)).toEqual([COMPARE_TOOL]);
    expect(priceTools(all).map((t) => t.name)).toEqual([COMPARE_TOOL, CHECK_TOOL, AWARD_TOOL]);
    expect(priceTools(all, { webHistory: true }).map((t) => t.name)).toEqual([COMPARE_TOOL, CHECK_TOOL]);
    expect(priceTools({ compare: false, check: false, award: false })).toEqual([]);
    expect([...PRICE_TOOL_NAMES].sort()).toEqual([AWARD_TOOL, CHECK_TOOL, COMPARE_TOOL].sort());
  });
  it("the award tool says it awards nothing, and the prompt rule says never to claim it did", () => {
    const award = priceTools(all).find((t) => t.name === AWARD_TOOL)!;
    expect(award.description).toContain("It awards nothing");
    expect(PRICE_COMPARE_PROMPT_RULE).toContain("never say it was awarded");
  });
  it("none of them asks the model for a workspace, a person or an id", () => {
    for (const t of priceTools(all)) {
      const keys = Object.keys((t.input_schema as { properties: Record<string, unknown> }).properties);
      expect(keys.filter((k) => /tenant|user|workspace|_id$|^id$/i.test(k)), t.name).toEqual([]);
    }
  });
});

describe("reading the model's input", () => {
  it("keeps only the named fields, cleaned and clipped", () => {
    expect(parseCompareInput({ reference: "  RFQ-0014 <b>\n", suppliers: ["Alpha", "", 5, "x".repeat(200)], tenant_id: "t2" })).toEqual({ reference: "RFQ-0014 b", suppliers: ["Alpha", "x".repeat(79) + "…"] });
    expect(parseCompareInput(null)).toEqual({ reference: "", suppliers: [] });
    expect(parseCompareInput({ suppliers: Array.from({ length: 30 }, (_, i) => `S${i}`) }).suppliers).toHaveLength(10);
    expect(parseAwardInput({ reference: "RFQ-0014", mode: "split", supplier: "Beta", user_id: "u" })).toEqual({ reference: "RFQ-0014", mode: "split", supplier: "Beta" });
    expect(parseAwardInput({ reference: "RFQ-0014", mode: "everything" }).mode).toBe("single");
    expect(parseCheckInput({ deal: "OPP-0034`" })).toEqual({ deal: "OPP-0034" });
  });
});
