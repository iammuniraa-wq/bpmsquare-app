import type { TabDef } from "@/components/ui/Tabs";

/** The estimate record's tabs, in their order. "estimate" is the working page (inputs, model, price) and the default. */
export const ESTIMATE_TAB_IDS = ["estimate", "materials", "schedule", "activity"] as const;
export type EstimateTabId = (typeof ESTIMATE_TAB_IDS)[number];

export const ESTIMATE_TAB_LABEL: Record<EstimateTabId, string> = {
  estimate: "Estimate",
  materials: "Materials",
  schedule: "Schedule & risk",
  activity: "Details & activity",
};

/**
 * The strip for an estimate. "Schedule & risk" exists only when the template has a schedule or a risk run (hasScheduleRiskTab). A new estimate has nothing saved yet,
 * so the two tabs that belong to a saved record (`needsSave`) are shown but cannot be chosen, with the reason behind their "i".
 */
export function estimateTabs(opts: { schedule: boolean; saved: boolean; needsSaveTip?: string }): TabDef[] {
  return ESTIMATE_TAB_IDS
    .filter((id) => id !== "schedule" || opts.schedule)
    .map((id) => {
      const locked = !opts.saved && (id === "materials" || id === "activity");
      return { id, label: ESTIMATE_TAB_LABEL[id], guide: `estimate.tab.${id}`, ...(locked ? { disabled: true, info: opts.needsSaveTip } : {}) };
    });
}

/** The tab a new (unsaved) estimate is really on: only the working page and the schedule exist before the first save. */
export function newEstimateTab(tab: string, schedule: boolean): EstimateTabId {
  return tab === "schedule" && schedule ? "schedule" : "estimate";
}

export type TabTarget = { tab: EstimateTabId; scroll?: string; openPrice?: boolean };

/**
 * Where an old `?tab=` link now lands: the tab its content moved to, and the part of the working page to bring into view. Today's own
 * tab ids need no translation (the tab strip reads them itself) and anything else is ignored.
 */
export function tabTarget(tab: string | null | undefined): TabTarget | null {
  switch (tab) {
    case "bom": return { tab: "materials" };
    case "costing": return { tab: "estimate", scroll: "price", openPrice: true };
    case "simulation": return { tab: "schedule" };
    case "overview": return { tab: "activity" };
    case "inputs": return { tab: "estimate", scroll: "about" };
    case "quote": return { tab: "estimate", scroll: "price-card" };
    default: return null;
  }
}

/** The element to bring into view once the page is up. A `?line=` link is about the model, which is on the working page. */
export function scrollTargetFor(target: TabTarget | null, hasLine: boolean): string | null {
  if (hasLine && (!target || target.tab === "estimate" || target.tab === "schedule")) return "villa";
  return target?.scroll ?? null;
}

/** The tab an old link lands on (null = leave the tab strip to read the URL itself). An old simulation link with a `?line=` was about the model. */
export function landingTab(target: TabTarget | null, hasLine: boolean): EstimateTabId | null {
  if (!target) return null;
  return hasLine && target.tab === "schedule" ? "estimate" : target.tab;
}
