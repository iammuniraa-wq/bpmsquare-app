// Which home a person sees in a tender workspace (docs/design/tender-desk.md, "What is new"). PURE and client-safe, so the page, the
// Settings select, the switch and the cookie route share one reading of the two values and of who wins.

import type { TenderDeskStyle } from "./types";

export const TENDER_DESK_COOKIE = "bpm_tender_desk";
export const TENDER_DESK_STYLES = ["bold", "control"] as const satisfies readonly TenderDeskStyle[];
export const TENDER_DESK_DEFAULT_STYLE: TenderDeskStyle = "bold";

export const TENDER_DESK_STYLE_LABEL: Record<TenderDeskStyle, string> = { bold: "Bold tiles", control: "Control room" };

export const isTenderDeskStyle = (v: unknown): v is TenderDeskStyle => typeof v === "string" && (TENDER_DESK_STYLES as readonly string[]).includes(v);

/**
 * The effective style, or null when the workspace does not have the tender edition (the caller then renders the home it always had).
 * Otherwise the person's cookie wins, then the workspace default from Settings > Appearance, then "bold". Anything that is not one of the
 * two values is ignored.
 */
export function resolveTenderDeskStyle(args: { cookie?: string | null; tenantDefault?: string | null; flagOn: boolean }): TenderDeskStyle | null {
  if (!args.flagOn) return null;
  if (isTenderDeskStyle(args.cookie)) return args.cookie;
  if (isTenderDeskStyle(args.tenantDefault)) return args.tenantDefault;
  return TENDER_DESK_DEFAULT_STYLE;
}
