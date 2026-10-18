/** The collapsible sections under the working page, in their order. */
export const SECTION_IDS = ["price", "schedule", "bom", "erp", "details"] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export type TabTarget = { open?: SectionId; scroll?: string };

/**
 * Where an old `?tab=` link now lands. The tabs are gone: a section that used to
 * be a tab opens, and the parts that moved onto the main page are scrolled to.
 * Anything else is ignored.
 */
export function tabTarget(tab: string | null | undefined): TabTarget | null {
  switch (tab) {
    case "bom": return { open: "bom" };
    case "costing": return { open: "price" };
    case "simulation": return { open: "schedule" };
    case "overview": return { open: "details" };
    case "inputs": return { scroll: "about" };
    case "quote": return { scroll: "price-card" };
    case "activity": return { scroll: "activity" };
    default: return null;
  }
}

/** The element to bring into view once the page is up. */
export function scrollTargetFor(target: TabTarget | null, hasLine: boolean): string | null {
  if (hasLine && (!target || target.open === "schedule")) return "villa";
  return target ? target.scroll ?? target.open ?? null : null;
}
