import { NAV, type NavItem } from "@/lib/constants";
import { NAV_GLYPHS, isItemViewable } from "@/components/Sidebar";
import { Gear, Monitor, FileText, Wrench, Zap, Package, Users, BarChart2, Coins } from "@/components/Icons";
import type { ViewableWorkcenters } from "@/lib/workcenters";

/**
 * "Spaces" -- Nova's icon-grid replacement for the classic expandable
 * sidebar tree. Unlike flattenNav() (Sidebar.tsx), which keeps a
 * parent-with-children as ONE collapsed row, this recurses into children
 * too -- every leaf module (Quotations, Cases, AMC, ...) gets its own
 * icon, matching the reference design's "15 modules compressed into a
 * glyph constellation" rather than a handful of category buckets.
 *
 * Every gating rule is the exact one Sidebar.tsx already enforces
 * (featureKey, workcenter visibility, supervisorOnly) -- Spaces must never
 * show a module the tenant hasn't bought or the user can't open.
 */

export type SpaceItem = { href: string; label: string; icon: React.ComponentType<{ size?: number; color?: string }> };

function leafAllowed(item: NavItem, features: Record<string, boolean>, viewable: ViewableWorkcenters, isWfmSupervisor: boolean): boolean {
  return (!item.featureKey || features?.[item.featureKey] === true)
    && isItemViewable(item, viewable)
    && (!item.supervisorOnly || isWfmSupervisor);
}

export function buildSpaces(features: Record<string, boolean>, viewable: ViewableWorkcenters, isWfmSupervisor: boolean): SpaceItem[] {
  const out: SpaceItem[] = [];
  const seen = new Set<string>();
  for (const group of NAV) {
    for (const item of group.items) {
      const children = item.children;
      if (children?.length) {
        for (const child of children) {
          if (!leafAllowed(child, features, viewable, isWfmSupervisor)) continue;
          if (seen.has(child.href)) continue;
          seen.add(child.href);
          out.push({ href: child.href, label: child.label, icon: NAV_GLYPHS[child.href] ?? Gear });
        }
      } else {
        if (!leafAllowed(item, features, viewable, isWfmSupervisor)) continue;
        if (seen.has(item.href)) continue;
        seen.add(item.href);
        out.push({ href: item.href, label: item.label, icon: NAV_GLYPHS[item.href] ?? Gear });
      }
    }
  }
  return out;
}

/**
 * Category view of the same data (owner direction 2026-08-23): instead of
 * one flat glyph grid -- which stops being guessable past ~10 unlabeled
 * icons -- the top bar shows one icon per NAV group ("Sales", "Service",
 * "Master data", ...) and clicking opens a flyout with that group's
 * modules, stacked and labeled. Same gating as buildSpaces; a group with
 * nothing visible disappears entirely, and a single-item group navigates
 * directly (no one-row flyout).
 */
export type SpaceGroup = {
  key: string;
  label: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
  items: SpaceItem[];
};

const GROUP_META: Record<string, { label: string; icon: SpaceGroup["icon"] }> = {
  "WORKSPACE": { label: "Home", icon: Monitor },
  "SALES & PROCUREMENT": { label: "Sales", icon: FileText },
  "SERVICE": { label: "Service", icon: Wrench },
  "MARKETING": { label: "Marketing", icon: Zap },
  "MASTER DATA": { label: "Master data", icon: Package },
  "WORKFORCE": { label: "Workforce", icon: Users },
  "PRICING": { label: "Pricing", icon: Coins },
  "ANALYTICS": { label: "Analytics", icon: BarChart2 },
  "ADMIN": { label: "Admin", icon: Gear },
};

export function buildSpaceGroups(features: Record<string, boolean>, viewable: ViewableWorkcenters, isWfmSupervisor: boolean): SpaceGroup[] {
  const out: SpaceGroup[] = [];
  const seen = new Set<string>();
  for (const group of NAV) {
    const items: SpaceItem[] = [];
    for (const item of group.items) {
      const leaves = item.children?.length ? item.children : [item];
      for (const leaf of leaves) {
        if (!leafAllowed(leaf, features, viewable, isWfmSupervisor)) continue;
        if (seen.has(leaf.href)) continue;
        seen.add(leaf.href);
        items.push({ href: leaf.href, label: leaf.label, icon: NAV_GLYPHS[leaf.href] ?? Gear });
      }
    }
    if (items.length === 0) continue;
    const meta = GROUP_META[group.group] ?? { label: group.group, icon: Gear };
    out.push({ key: group.group, label: meta.label, icon: meta.icon, items });
  }
  return out;
}

/** Which Space (by href prefix) a "needs you now" item's own href belongs
 * to -- drives the attention dot. Longest-prefix match so e.g. /wfm/leave
 * doesn't get swallowed by a hypothetical broader /wfm match ambiguity. */
export function spaceForHref(itemHref: string, spaces: SpaceItem[]): string | null {
  let best: string | null = null;
  for (const s of spaces) {
    if (itemHref === s.href || itemHref.startsWith(s.href + "/")) {
      if (!best || s.href.length > best.length) best = s.href;
    }
  }
  return best;
}
