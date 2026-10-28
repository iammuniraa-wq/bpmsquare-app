import { describe, expect, it } from "vitest";
import {
  BUNDLES, CURATED_LAYOUT, DEFAULT_LAYOUT, TENDER_BLOCKS, TENDER_BLOCK_IDS, TENDER_TILE_IDS, addBundleBlocks, blockAllowed, blockFlex, blockSize,
  curatedLayoutFor, defaultLayoutFor, isTenderBlockId, moveBlock, resolveLayout, setSizeAt, tenderLead, toggleAnalyticsPin, toggleHiddenAt, SIZE_FLEX,
} from "./dashboardBlocks";
import { ANALYTICS_META, isAnalyticsId } from "./analyticsMeta";
import type { DashLayoutItem, TenantFeatures } from "./constants";

const ids = (l: DashLayoutItem[]) => l.map((b) => b.id);
const CRM = { quotations: true, cases: true, accounts: true, pipeline: true } as TenantFeatures;
const TENDER = { ...CRM, gcc_tender: true } as TenantFeatures;
const WFM_ONLY = { wfm: true } as TenantFeatures;
const EXPECTED = [
  "tender_open_pipeline", "tender_weighted", "tender_closing_soon", "tender_win_rate", "tender_buyout_committed",
  "tender_by_stage", "tender_closing_list", "tender_won_lost", "tender_by_client", "tender_attention", "tender_trend",
  "tender_deadlines", "tender_buyout",
];

describe("the tender blocks as dashboard blocks", () => {
  it("are thirteen analytics blocks, each gated by the platform-admin flag gcc_tender and nothing else", () => {
    expect(ids(TENDER_BLOCKS)).toEqual(EXPECTED);
    for (const id of EXPECTED) {
      expect(isAnalyticsId(id)).toBe(true);
      expect(ANALYTICS_META[id as keyof typeof ANALYTICS_META].feature).toBe("gcc_tender");
      expect(blockAllowed(id, CRM)).toBe(false);
      expect(blockAllowed(id, { ...CRM, gcc_tender: false } as TenantFeatures)).toBe(false);
      expect(blockAllowed(id, TENDER)).toBe(true);
    }
  });

  it("have the sizes the design gives them: five small tiles, six halves, two full", () => {
    expect(TENDER_BLOCKS.map((b) => b.size)).toEqual(["compact", "compact", "compact", "compact", "compact", "half", "half", "half", "half", "half", "half", "full", "full"]);
    for (const b of TENDER_BLOCKS) expect(blockSize({ id: b.id })).toBe(b.size);
    expect([...TENDER_TILE_IDS]).toEqual(EXPECTED.slice(0, 5));
    expect(isTenderBlockId("tender_trend")).toBe(true);
    expect(isTenderBlockId("pipeline_open_value")).toBe(false);
    expect(TENDER_BLOCK_IDS.size).toBe(13);
  });

  it("a small tile is narrow enough for five to share a row; any other size, and a resized tile, keeps the standard box", () => {
    expect(blockFlex({ id: "tender_weighted" })).toEqual({ flex: "1 1 150px", minWidth: 140 });
    expect(blockFlex({ id: "tender_weighted", size: "compact" })).toEqual({ flex: "1 1 150px", minWidth: 140 });
    expect(blockFlex({ id: "tender_weighted", size: "half" })).toEqual(SIZE_FLEX.half);
    expect(blockFlex({ id: "tender_by_stage" })).toEqual(SIZE_FLEX.half);
    expect(blockFlex({ id: "tender_deadlines" })).toEqual(SIZE_FLEX.full);
    expect(blockFlex({ id: "accounts" })).toEqual(SIZE_FLEX.compact);
    expect(blockFlex({ id: "overview_strip" })).toEqual(SIZE_FLEX.full);
  });

  it("Adapt can offer them as one Tenders bundle, only to a workspace with the flag", () => {
    const bundle = BUNDLES.find((b) => b.id === "tenders");
    expect(bundle).toMatchObject({ label: "Tenders", feature: "gcc_tender" });
    expect(ids(bundle!.blocks as DashLayoutItem[])).toEqual(EXPECTED);
    expect(BUNDLES.filter((b) => !b.feature || TENDER[b.feature]).map((b) => b.id)).toContain("tenders");
    expect(BUNDLES.filter((b) => !b.feature || CRM[b.feature]).map((b) => b.id)).not.toContain("tenders");
  });
});

describe("a workspace without the tender edition is left exactly as it was", () => {
  it("opens on the same default layout, the same curated composition and the same saved layouts", () => {
    expect(defaultLayoutFor(CRM)).toBe(DEFAULT_LAYOUT);
    expect(curatedLayoutFor(CRM)).toBe(CURATED_LAYOUT);
    expect(tenderLead(CRM)).toEqual([]);
    expect(ids(defaultLayoutFor(WFM_ONLY))).not.toEqual([]);
    for (const id of ids(defaultLayoutFor(WFM_ONLY))) expect(isTenderBlockId(id)).toBe(false);
    expect(ids(resolveLayout([], CRM, undefined))).toEqual(ids(DEFAULT_LAYOUT));
    const saved: DashLayoutItem[] = [{ id: "accounts" }, { id: "overview_strip", hidden: true }, { id: "revenue_card", size: "half" }];
    const out = resolveLayout(saved, CRM, undefined);
    expect(out.slice(0, 3)).toEqual(saved);
    for (const b of out) expect(isTenderBlockId(b.id)).toBe(false);
  });

  it("does not seed tender blocks into a saved layout even if one names a tender block id while the flag is off", () => {
    const out = resolveLayout([{ id: "accounts" }], { ...CRM, gcc_tender: false } as TenantFeatures, undefined);
    expect(out.some((b) => isTenderBlockId(b.id))).toBe(false);
  });
});

describe("a workspace with the tender edition opens on the tender blocks", () => {
  it("default layout: the five tiles first, then stage and closing, won/lost and clients, attention and trend, deadlines, buy-out, then the usual blocks without the Quick create rail", () => {
    const l = defaultLayoutFor(TENDER);
    expect(ids(l).slice(0, 13)).toEqual(EXPECTED);
    expect(l.slice(0, 13).map((b) => b.size)).toEqual(TENDER_BLOCKS.map((b) => b.size));
    expect(ids(l).slice(13)).toEqual(ids(DEFAULT_LAYOUT).filter((id) => id !== "quick_create"));
    expect(ids(l)).not.toContain("quick_create");
  });

  it("curated composition: the same lead, then the curated blocks without the rail", () => {
    const l = curatedLayoutFor(TENDER);
    expect(ids(l).slice(0, 13)).toEqual(EXPECTED);
    expect(ids(l).slice(13)).toEqual(ids(CURATED_LAYOUT).filter((id) => id !== "quick_create"));
  });

  it("a tender workspace with no CRM modules still gets the tender lead (and the bundle path does not repeat the tender blocks)", () => {
    const only = { gcc_tender: true, pipeline: true, wfm: true } as TenantFeatures;
    const l = ids(defaultLayoutFor(only));
    expect(l.slice(0, 13)).toEqual(EXPECTED);
    expect(l.filter((id) => isTenderBlockId(id))).toHaveLength(13);
  });

  it("a layout saved before the tender blocks existed gets them in front, once; a hidden or reordered set is the person's own and stays", () => {
    const before: DashLayoutItem[] = [{ id: "overview_strip" }, { id: "accounts", hidden: true }];
    const seeded = resolveLayout(before, TENDER, undefined);
    expect(ids(seeded).slice(0, 13)).toEqual(EXPECTED);
    expect(seeded.slice(13, 15)).toEqual(before);
    expect(seeded.some((b) => b.id === "quick_create" && b.hidden)).toBe(true);

    const own: DashLayoutItem[] = [{ id: "tender_by_stage", size: "full" }, { id: "tender_trend", hidden: true }, { id: "overview_strip" }];
    const kept = resolveLayout(own, TENDER, undefined);
    expect(kept.slice(0, 3)).toEqual(own);
    expect(kept.filter((b) => isTenderBlockId(b.id)).map((b) => b.id)).toEqual(["tender_by_stage", "tender_trend"]);
  });

  it("a saved layout holding only blocks the workspace cannot show falls back to the tender default", () => {
    const l = ids(resolveLayout([{ id: "wfm_summary" }], TENDER, undefined));
    expect(l.slice(0, 13)).toEqual(EXPECTED);
  });
});

describe("what Adapt does to the tender blocks", () => {
  const start: DashLayoutItem[] = [{ id: "overview_strip" }];

  it("Quick add Tenders appends all thirteen, with their sizes; added again, hidden ones come back", () => {
    const bundle = BUNDLES.find((b) => b.id === "tenders")!;
    const added = addBundleBlocks(start, bundle.blocks);
    expect(ids(added)).toEqual(["overview_strip", ...EXPECTED]);
    expect(added[1]).toEqual({ id: "tender_open_pipeline", size: "compact" });
    const hidden = toggleHiddenAt(added, 6);
    expect(hidden[6]).toMatchObject({ id: "tender_by_stage", hidden: true });
    const back = addBundleBlocks(hidden, bundle.blocks);
    expect(back[6].hidden).toBe(false);
    expect(back).toHaveLength(added.length);
  });

  it("hides, un-hides, resizes and moves a tender block, leaving the others as they were", () => {
    const l = tenderLead(TENDER);
    const hidden = toggleHiddenAt(l, 2);
    expect(hidden[2]).toMatchObject({ id: "tender_closing_soon", hidden: true });
    expect(hidden.filter((b) => b.hidden)).toHaveLength(1);
    expect(toggleHiddenAt(hidden, 2)[2].hidden).toBe(false);

    const resized = setSizeAt(l, 5, "full");
    expect(resized[5]).toEqual({ id: "tender_by_stage", size: "full" });
    expect(blockSize(resized[5])).toBe("full");
    expect(resized.filter((b, i) => i !== 5)).toEqual(l.filter((_, i) => i !== 5));

    const moved = moveBlock(l, 12, 0);
    expect(ids(moved).slice(0, 2)).toEqual(["tender_buyout", "tender_open_pipeline"]);
    expect(moved).toHaveLength(13);
    expect(moveBlock(l, 3, 3)).toBe(l);
  });

  it("the analytics picker pins and unpins one tender block", () => {
    const pinned = toggleAnalyticsPin(start, "tender_trend");
    expect(ids(pinned)).toEqual(["overview_strip", "tender_trend"]);
    expect(ids(toggleAnalyticsPin(pinned, "tender_trend"))).toEqual(["overview_strip"]);
  });
});
