// Which sidebar items a workspace has switched off.
//
// tenants.config.nav_hidden_hrefs is a flat list of hrefs. A parent row that
// bundles children (Sales, Service, Marketing, Master data, Workforce) shares
// its href with its FIRST child -- the parent is only a toggle, it links
// nowhere of its own -- so that one string cannot also mean "the whole group".
// The rule is therefore: a parent has no visibility of its own. It is shown
// while at least one of its children is, and its switch acts on all of them.

export type NavState = "on" | "off" | "mixed";

type Row<C extends { href: string }> = { href: string; children?: C[] };

const asSet = (hidden: Iterable<string>): ReadonlySet<string> => (hidden instanceof Set ? hidden : new Set(hidden));

/** `eligible` narrows a parent's children to the ones this workspace actually has (module on, screen viewable). */
type Eligible<C> = (child: C) => boolean;

function eligibleChildren<C extends { href: string }>(item: Row<C>, eligible?: Eligible<C>) {
  const all = item.children ?? [];
  return eligible ? all.filter(eligible) : all;
}

/** A leaf is on or off; a parent is off only when every eligible child is hidden, mixed when some are. */
export function navState<C extends { href: string }>(hidden: Iterable<string>, item: Row<C>, eligible?: Eligible<C>): NavState {
  const set = asSet(hidden);
  if (!item.children?.length) return set.has(item.href) ? "off" : "on";
  const kids = eligibleChildren(item, eligible);
  if (kids.length === 0) return set.has(item.href) ? "off" : "on";
  const hiddenCount = kids.filter((k) => set.has(k.href)).length;
  return hiddenCount === 0 ? "on" : hiddenCount === kids.length ? "off" : "mixed";
}

/** Should the sidebar leave this row out? */
export function isNavItemHidden<C extends { href: string }>(hidden: Iterable<string>, item: Row<C>, eligible?: Eligible<C>): boolean {
  return navState(hidden, item, eligible) === "off";
}

/**
 * The list after flipping one row's switch. A leaf toggles its own href. A
 * parent turned off hides EVERY child it has (not just the eligible ones, so a
 * module bought later does not reappear inside a group that was switched off);
 * a parent turned on shows them all again. A mixed parent reads as on, so the
 * next click switches it off.
 */
export function toggleNavItem<C extends { href: string }>(hidden: readonly string[], item: Row<C>, eligible?: Eligible<C>): string[] {
  if (!item.children?.length) {
    return hidden.includes(item.href) ? hidden.filter((h) => h !== item.href) : [...hidden, item.href];
  }
  const kids = new Set(item.children.map((k) => k.href));
  if (navState(hidden, item, eligible) === "off") return hidden.filter((h) => !kids.has(h));
  const next = hidden.filter((h) => !kids.has(h));
  return [...next, ...kids];
}
