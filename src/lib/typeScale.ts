import type { CSSProperties } from "react";

/**
 * The one type scale (ui-restructure-spec 13.2). The values live as CSS
 * variables and `.bpm-t-*` classes in globals.css; these style objects point
 * at the same variables for the few places that need an inline style (a
 * shared const used by several controls). Prefer the class.
 *
 *   title    page title             22 / 700  ink
 *   section  card / section heading  16 / 700  ink
 *   label    field label             13 / 600  ink
 *   body     running text          13.5 / 400  ink
 *   help     description, hint      12.5 / 400  muted
 *
 * Inter 400/600/700 only. A heading is told from its description by size AND
 * weight AND colour, and from a field label by size, so none of the three can
 * be mistaken for another.
 */
const w = (v: string) => v as unknown as number;

export const typeTitle: CSSProperties = { fontSize: "var(--ts-title)", fontWeight: w("var(--tw-title)"), color: "var(--ink)", lineHeight: 1.25 };
export const typeSection: CSSProperties = { fontSize: "var(--ts-section)", fontWeight: w("var(--tw-section)"), color: "var(--ink)", lineHeight: 1.3 };
export const typeLabel: CSSProperties = { fontSize: "var(--ts-label)", fontWeight: w("var(--tw-label)"), color: "var(--ink)", lineHeight: 1.35 };
export const typeBody: CSSProperties = { fontSize: "var(--ts-body)", fontWeight: w("var(--tw-body)"), color: "var(--ink)", lineHeight: 1.5 };
export const typeHelp: CSSProperties = { fontSize: "var(--ts-help)", fontWeight: w("var(--tw-help)"), color: "var(--muted)", lineHeight: 1.5 };
