import { NAV_GLYPHS } from "@/components/Sidebar";
import { Gear, Monitor, FileText, Wrench, Zap, Package, Users, BarChart2 } from "@/components/Icons";
import { buildNavGroups } from "@/lib/navGroups";
import type { ViewableWorkcenters } from "@/lib/workcenters";

/**
 * "Spaces" -- Nova's icon-grid replacement for the classic expandable
 * sidebar tree. The grouping and every gating rule (featureKey, workcenter
 * visibility, supervisorOnly, adminOnly) live in lib/navGroups.ts, derived
 * from NAV -- this file only adds the glyph per module and per group, so the
 * classic rail, Spaces and the mobile tab bar can never disagree on what
 * belongs where.
 *
 * `hidden` (the workspace's nav_hidden_hrefs, Settings -> Navigation
 * visibility) is applied here too, so a hidden item vanishes from Spaces, the
 * Nova rail and the mobile tab bar exactly as it does from the classic rail
 * (owner decision 2026-10-17).
 */

export type SpaceItem = { href: string; label: string; icon: React.ComponentType<{ size?: number; color?: string }> };

export function buildSpaces(features: Record<string, boolean>, viewable: ViewableWorkcenters, isWfmSupervisor: boolean, hidden: readonly string[] = []): SpaceItem[] {
  return buildSpaceGroups(features, viewable, isWfmSupervisor, hidden).flatMap((g) => g.items);
}

/**
 * Category view of the same data (owner direction 2026-08-23): the top bar
 * shows one icon per NAV group ("Sales", "Service", "Master data", ...) and
 * clicking opens a flyout with that group's modules, stacked and labeled. A
 * group with nothing visible disappears entirely.
 */
export type SpaceGroup = {
  key: string;
  label: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
  items: SpaceItem[];
};

const GROUP_ICON: Record<string, SpaceGroup["icon"]> = {
  "WORKSPACE": Monitor,
  "SALES & PROCUREMENT": FileText,
  "SERVICE": Wrench,
  "MARKETING": Zap,
  "MASTER DATA": Package,
  "WORKFORCE": Users,
  "INSIGHTS": BarChart2,
  "ADMIN": Gear,
};

export function buildSpaceGroups(features: Record<string, boolean>, viewable: ViewableWorkcenters, isWfmSupervisor: boolean, hidden: readonly string[] = []): SpaceGroup[] {
  return buildNavGroups(features, viewable, isWfmSupervisor, hidden).map((g) => ({
    key: g.key,
    label: g.label,
    icon: GROUP_ICON[g.key] ?? Gear,
    items: g.items.map((i) => ({ href: i.href, label: i.label, icon: NAV_GLYPHS[i.href] ?? Gear })),
  }));
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
