export type MenuItem = {
  label: string;
  /** Client-side handler. Only available when the menu is built inside a client component. */
  onSelect?: () => void;
  href?: string;
  /** Open `href` in a new tab (always a plain anchor, never a client navigation). */
  newTab?: boolean;
  danger?: boolean;
  hidden?: boolean;
  /** A separator row; `label` is ignored. */
  divider?: boolean;
};

/** The stable guide id of a menu entry ("Print / PDF" -> "menu:print-pdf"); the assistant's manifests use the same one. */
export const menuGuideId = (label: string): string => `menu:${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

/**
 * Turns the caller's item list into what is actually drawn: hidden items gone,
 * danger items last behind a separator, and no separator at the start, the
 * end or twice in a row. Callers can therefore write `hidden: !allowed` on
 * every entry without worrying about orphaned dividers.
 */
export function normalizeMenuItems(items: MenuItem[]): MenuItem[] {
  const visible = items.filter((i) => !i.hidden);
  const normal = visible.filter((i) => i.divider || !i.danger);
  const danger = visible.filter((i) => !i.divider && i.danger);

  const merged: MenuItem[] = [...normal];
  if (danger.length > 0) {
    merged.push({ label: "", divider: true }, ...danger);
  }

  const out: MenuItem[] = [];
  for (const item of merged) {
    if (item.divider) {
      if (out.length === 0 || out[out.length - 1].divider) continue;
    }
    out.push(item);
  }
  while (out.length > 0 && out[out.length - 1].divider) out.pop();
  return out;
}
