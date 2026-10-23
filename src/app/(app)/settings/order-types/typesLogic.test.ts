import { describe, expect, it } from "vitest";
import { SETTINGS_MENU, visibleSettingsMenu } from "@/lib/settingsMenu";
import { type as orderType } from "@/components/salesOrders/fixtures";
import {
  blankDraft, draftFromType, draftProblem, moveBlock, normalizePrefix, ruleSummary, setBlockText, sortedTypes, toBody, toggleBlock, BLOCK_LABELS, CONTENT_HELP,
} from "./typesLogic";

describe("a new order type", () => {
  it("starts with the default design, internal pricing, and is the default only when none exists", () => {
    const d = blankDraft(false);
    expect(d).toMatchObject({ pricing_mode: "internal", is_default: true, prefix: "SO", active: true, rules: [] });
    expect(d.blocks.map((b) => b.type)).toContain("line_items");
    expect(blankDraft(true).is_default).toBe(false);
  });
  it("cleans the prefix to capitals and digits, six at most", () => {
    expect(normalizePrefix("so-1 x")).toBe("SO1X");
    expect(normalizePrefix("abcdefghi")).toBe("ABCDEF");
  });
  it("says what stops a save", () => {
    const ok = { ...blankDraft(false), name: "Standard" };
    expect(draftProblem(ok)).toBeNull();
    expect(draftProblem({ ...ok, name: " " })).toBe("Give the type a name");
    expect(draftProblem({ ...ok, prefix: "S" })).toBe("The prefix needs at least two letters or digits");
    expect(draftProblem({ ...ok, accent_color: "blue" })).toBe("The accent colour must look like #378ADD");
    expect(draftProblem({ ...ok, rules: [{ field: "region", equals: " " }] })).toBe("Finish or remove the empty selection rule");
  });
  it("sends the template block mechanism the server already knows (blocks, accent, logo position)", () => {
    const b = toBody({ ...blankDraft(false), name: "  Export order ", rules: [{ field: "region", equals: " GCC " }], accent_color: "#112233", logo_position: "right" });
    expect(b).toMatchObject({ name: "Export order", prefix: "SO", pricing_mode: "internal", is_default: true, rules: [{ field: "region", equals: "GCC" }] });
    expect(b.template).toMatchObject({ accent_color: "#112233", logo_position: "right" });
    expect(Array.isArray(b.template?.blocks)).toBe(true);
  });
});

describe("the design blocks", () => {
  const blocks = blankDraft(false).blocks;
  it("moves a block up or down and stops at the ends", () => {
    const moved = moveBlock(blocks, 1, -1);
    expect(moved[0].type).toBe(blocks[1].type);
    expect(moved[1].type).toBe(blocks[0].type);
    expect(moveBlock(blocks, 0, -1)).toBe(blocks);
    expect(moveBlock(blocks, blocks.length - 1, 1)).toBe(blocks);
  });
  it("hides an optional block but never a required one", () => {
    const sig = blocks.findIndex((b) => b.type === "signature");
    expect(toggleBlock(blocks, sig)[sig].visible).toBe(true);
    const lines = blocks.findIndex((b) => b.type === "line_items");
    expect(toggleBlock(blocks, lines)[lines].visible).toBe(true);
  });
  it("edits the text of a content block", () => {
    const i = blocks.findIndex((b) => b.type === "footer_text");
    expect(setBlockText(blocks, i, "Thank you")[i].content).toBe("Thank you");
  });
  it("labels every block type and tells what each text block takes", () => {
    for (const b of blocks) expect(BLOCK_LABELS[b.type]).toBeTruthy();
    for (const text of Object.values(CONTENT_HELP)) expect(text).toBeTruthy();
  });
});

describe("the list", () => {
  const t = (over: object) => ({ ...orderType(), ...over });
  it("shows the default first, then the others by name, switched-off types last", () => {
    const rows = sortedTypes([t({ id: "b", name: "Zeta", is_default: false }), t({ id: "off", name: "Old", is_default: false, active: false }), t({ id: "a", name: "Alpha", is_default: false }), t({ id: "d", name: "Standard", is_default: true })]);
    expect(rows.map((r) => r.id)).toEqual(["d", "a", "b", "off"]);
  });
  it("summarises rules in words", () => {
    expect(ruleSummary([])).toBe("—");
    expect(ruleSummary([{ field: "region", equals: "GCC" }, { field: "source_type", equals: "standard_quote" }])).toBe("Region = GCC; Made from = Standard quote");
  });
  it("reads a type from the server with an empty design as the default design", () => {
    const d = draftFromType(orderType({ template: { blocks: [], accent_color: null, logo_position: "left" } }));
    expect(d.blocks.length).toBeGreaterThan(0);
    expect(d.accent_color).toBe("#378ADD");
  });
});

describe("the Settings entry", () => {
  it("is one entry under Sales for admins of a workspace that has Sales Orders, and nowhere else", () => {
    const entry = SETTINGS_MENU.find((m) => m.id === "order-types");
    expect(entry).toMatchObject({ group: "sales", label: "Order types", href: "/settings/order-types", adminOnly: true, featureKey: "sales_orders" });
    const ids = (features: Record<string, boolean>, isAdmin = true) => visibleSettingsMenu({ isAdmin, canEdit: () => false, features }).flatMap((g) => g.items.map((i) => i.id));
    expect(ids({ sales_orders: true })).toContain("order-types");
    expect(ids({})).not.toContain("order-types");
    expect(ids({ sales_orders: true }, false)).not.toContain("order-types");
  });
});
