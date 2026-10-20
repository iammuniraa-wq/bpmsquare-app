// Pure rules behind the shared InfoTip ("i"): docs/design/ux-simplification.md §2a. Kept free of React so the
// limits, the sheet/popover choice and the placement arithmetic can be tested without a browser.

export const TIP_MAX_CHARS = 160;
export const TIP_MAX_SENTENCES = 2;
/** Below this width (or on a touch screen) a tip opens as a bottom sheet instead of a popover. */
export const TIP_SHEET_BREAKPOINT = 900;
const EDGE = 8;

/** Plain-words limits for a tip's text. Returns what is wrong, empty when it fits. Dynamic text is held to the same limit. */
export function tipTextProblems(text: string): string[] {
  const t = text.trim();
  const out: string[] = [];
  if (!t) out.push("empty");
  if (t.length > TIP_MAX_CHARS) out.push(`longer than ${TIP_MAX_CHARS} characters (${t.length})`);
  // A sentence ends at . ! ? followed by a space and a capital; a decimal like 2.5 does not count.
  const sentences = t.split(/(?<=[.!?])\s+(?=[A-Z“"'{(])/).filter(Boolean);
  if (sentences.length > TIP_MAX_SENTENCES) out.push(`more than ${TIP_MAX_SENTENCES} sentences (${sentences.length})`);
  if (/[\n\r]|^\s*[-*•]\s/m.test(t)) out.push("contains a list or line break");
  return out;
}

export function isSheetMode(viewportWidth: number, coarsePointer: boolean): boolean {
  return viewportWidth < TIP_SHEET_BREAKPOINT || coarsePointer;
}

/** The attributes the "i" button carries. The popover is a tooltip (described-by while open); the sheet is a dialog. */
export function tipButtonAria(label: string, open: boolean, popId: string, sheet: boolean): Record<string, string | boolean | undefined> {
  return {
    "aria-label": `About ${label}`,
    "aria-expanded": open,
    "aria-controls": popId,
    "aria-describedby": open && !sheet ? popId : undefined,
  };
}

export type Box = { left: number; right: number; top: number; bottom: number; width: number; height: number };

/**
 * Where the popover goes: centred under the "i", flipped above when it would run off the bottom (and there is
 * room above), and shifted sideways to stay 8 px inside the viewport. Returns viewport coordinates for position: fixed.
 */
export function placePopover(trigger: Box, pop: { width: number; height: number }, viewport: { width: number; height: number }, prefer: "below" | "above" = "below"): { top: number; left: number; above: boolean } {
  const gap = 8;
  const fitsBelow = trigger.bottom + gap + pop.height <= viewport.height - EDGE;
  const fitsAbove = trigger.top - gap - pop.height >= EDGE;
  const above = prefer === "above" ? fitsAbove || !fitsBelow : !fitsBelow && fitsAbove;
  const top = above ? trigger.top - gap - pop.height : trigger.bottom + gap;
  const centred = trigger.left + trigger.width / 2 - pop.width / 2;
  const left = Math.max(EDGE, Math.min(centred, viewport.width - EDGE - pop.width));
  return { top, left, above };
}

/**
 * Where "Learn more" points. GUIDE_LINKS holds section anchors; the base address of the published how-to guide is
 * a deployment setting, so until it is set no link is drawn rather than a broken one.
 */
export function guideHref(links: Record<string, string>, key: string | undefined, base: string | undefined): string | null {
  if (!key || !base) return null;
  const anchor = links[key];
  if (!anchor) return null;
  return `${base.replace(/\/+$/, "")}${anchor.startsWith("#") ? "" : "/"}${anchor}`;
}
