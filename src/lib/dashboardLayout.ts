import type { DashLayoutItem } from "./constants";

/**
 * Unions several saved dashboard layouts (e.g. every Business Role a member
 * is assigned that defines one) into a single layout -- the first layout to
 * mention a block id wins that block's hidden/size, later layouts only
 * contribute ids not already present. Order follows the input order, so the
 * caller decides which role "wins" ties by the order it passes them in.
 */
export function mergeDashLayouts(layouts: DashLayoutItem[][]): DashLayoutItem[] {
  const seen = new Set<string>();
  const merged: DashLayoutItem[] = [];
  for (const layout of layouts) {
    for (const item of layout) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      merged.push(item);
    }
  }
  return merged;
}
