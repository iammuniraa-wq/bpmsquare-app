import type { Tab } from "@/lib/tabs-context";

/**
 * When the strip is full, the oldest tab that is not the page you are on (and not the Dashboard) is closed to make
 * room for the new one, instead of silently refusing to open it. Only the current page can hold unsaved changes, and it
 * is never the one closed, so nothing is lost. `closed` is null when every tab is protected (the old message then applies).
 */
export function makeRoom(tabs: Tab[], keepHref: string, max: number, dashboardHref: string): { tabs: Tab[]; closed: Tab | null } {
  if (tabs.length < max) return { tabs, closed: null };
  const victim = tabs.find((t) => t.href !== keepHref && t.href !== dashboardHref);
  if (!victim) return { tabs, closed: null };
  return { tabs: tabs.filter((t) => t !== victim), closed: victim };
}
