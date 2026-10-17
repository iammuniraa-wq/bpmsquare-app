import { NAV, ROUTES, type NavItem } from "@/lib/constants";
import type { ViewableWorkcenters, WorkcenterKey } from "@/lib/workcenters";

/**
 * The one place that turns NAV (constants.ts) into "which groups, holding
 * which leaf modules, does THIS user get". The classic rail, the Spaces row
 * (Spectacular), Nova's rail and the mobile tab bar all read groups from NAV;
 * the gating rules below are shared so none of them can drift.
 */

// A parent "toggle" row (Sales/Service/Marketing/Master data -- anything with
// children) has no workcenterKey of its own; it's viewable whenever at least
// one child is. An adminOnly row (Settings) is for a member with unrestricted
// access only -- nothing in Settings is scoped to a workcenter, so a member
// restricted by a Business Role must not see it.
export function isItemViewable(item: NavItem, viewable: ViewableWorkcenters): boolean {
  if (item.adminOnly && viewable !== "all") return false;
  if (viewable === "all") return true;
  if (item.children?.length) return item.children.some((ch) => isItemViewable(ch, viewable));
  if (!item.workcenterKey) return true;
  return viewable.includes(item.workcenterKey as WorkcenterKey);
}

export function leafAllowed(item: NavItem, features: Record<string, boolean> | undefined, viewable: ViewableWorkcenters, isWfmSupervisor: boolean): boolean {
  return (!item.featureKey || features?.[item.featureKey] === true)
    && isItemViewable(item, viewable)
    && (!item.supervisorOnly || isWfmSupervisor);
}

/** Short names shown for each NAV group in Spaces / the mobile tab bar. */
export const NAV_GROUP_LABELS: Record<string, string> = {
  "WORKSPACE": "Home",
  "SALES & PROCUREMENT": "Sales",
  "SERVICE": "Service",
  "MARKETING": "Marketing",
  "MASTER DATA": "Master data",
  "WORKFORCE": "Workforce",
  "INSIGHTS": "Insights",
  "ADMIN": "Admin",
};

export type NavGroupLeaf = { href: string; label: string };
export type VisibleNavGroup = { key: string; label: string; items: NavGroupLeaf[] };

/** Every NAV group with only the leaves this user may open (a bundled parent
 * contributes its children; a group with none left is dropped; a href that
 * appears twice is listed once). `hidden` is the workspace's
 * nav_hidden_hrefs (Settings -> Navigation visibility): a leaf listed there
 * is left out, exactly as in the classic rail. Settings itself can never be
 * hidden, so nobody is locked out of the page that undoes it. */
export function buildNavGroups(features: Record<string, boolean> | undefined, viewable: ViewableWorkcenters, isWfmSupervisor: boolean, hidden: readonly string[] = []): VisibleNavGroup[] {
  const hiddenSet = new Set(hidden);
  const out: VisibleNavGroup[] = [];
  const seen = new Set<string>();
  for (const group of NAV) {
    const items: NavGroupLeaf[] = [];
    for (const item of group.items) {
      const leaves = item.children?.length ? item.children : [item];
      for (const leaf of leaves) {
        if (!leafAllowed(leaf, features, viewable, isWfmSupervisor)) continue;
        if (leaf.href !== ROUTES.settings && hiddenSet.has(leaf.href)) continue;
        if (seen.has(leaf.href)) continue;
        seen.add(leaf.href);
        items.push({ href: leaf.href, label: leaf.label });
      }
    }
    if (items.length === 0) continue;
    out.push({ key: group.group, label: NAV_GROUP_LABELS[group.group] ?? group.group, items });
  }
  return out;
}
