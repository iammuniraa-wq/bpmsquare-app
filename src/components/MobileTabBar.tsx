"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV, type NavItem } from "@/lib/constants";
import { useTenant, useViewableWorkcenters, useIsNextgen3Layer } from "@/lib/tenant-context";
import { NavGlyph } from "@/components/Sidebar";

/**
 * A bottom tab bar, because a hamburger is not a mobile pattern -- it is a
 * desktop sidebar folded up and hidden. Every destination costs two taps and
 * nothing on screen says where you are.
 *
 * The tabs are the FIRST FOUR destinations this particular user can reach,
 * taken from the same NAV the sidebar reads and filtered by the same feature
 * flags and workcenter grants -- so a Workforce-only workspace gets Workforce
 * tabs rather than a hardcoded CRM set, and nothing appears that its own
 * sidebar wouldn't show. "More" opens the existing drawer, which keeps the
 * full tree, favourites and reordering exactly where they were.
 *
 * Nova-gated: this changes how a phone navigates, and no existing client
 * should have that arrive unannounced.
 */

const MAX_TABS = 4;

/** Depth-first, so a group contributes its children rather than itself --
 *  "Workforce" is a heading, "My Workforce" is somewhere you can go. */
function reachable(items: NavItem[], features: Record<string, boolean>, viewable: string[] | "all"): NavItem[] {
  const out: NavItem[] = [];
  for (const item of items) {
    if (item.featureKey && features[item.featureKey] !== true) continue;
    if (item.children?.length) {
      out.push(...reachable(item.children, features, viewable));
      continue;
    }
    if (viewable !== "all" && item.workcenterKey && !viewable.includes(item.workcenterKey)) continue;
    out.push(item);
  }
  return out;
}

export default function MobileTabBar({ onMore }: { onMore: () => void }) {
  const nova = useIsNextgen3Layer();
  const tenant = useTenant();
  const viewable = useViewableWorkcenters();
  const pathname = usePathname();

  if (!nova) return null;

  const features = (tenant?.features ?? {}) as Record<string, boolean>;
  const all = reachable(NAV.flatMap((g) => g.items), features, viewable as string[] | "all");
  const tabs = all.slice(0, MAX_TABS);
  if (tabs.length === 0) return null;

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const cell: React.CSSProperties = {
    flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center",
    justifyContent: "center", gap: 3, padding: "7px 2px 3px", textDecoration: "none",
    background: "none", border: "none", cursor: "pointer", font: "inherit",
  };
  const label: React.CSSProperties = {
    fontSize: 10.5, fontWeight: 600, letterSpacing: "-0.01em",
    maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  };

  return (
    <nav
      aria-label="Main"
      style={{
        position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 96,
        display: "flex", alignItems: "stretch",
        // This bar is Nova-exclusive (returns null above when !nova), so it
        // reaches for Nova's own dark-glass tokens directly rather than the
        // app-wide --line/--accent/--muted family, which still resolves to
        // nextgen's light-mode defaults here (Nova never sets [data-mode=
        // "dark"] -- its DarkToggle is hidden by design). Same near-black
        // translucent treatment as the top identity bar (--sb-bar-bg's Nova
        // override), so the two chrome bars read as one system.
        background: "rgba(6, 8, 15, 0.92)",
        borderTop: "1px solid var(--nova-line-soft)",
        // Clears the home indicator; without it the last row of labels sits
        // under the bar iOS draws over the page.
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        boxShadow: "0 -1px 10px rgba(0,0,0,.35)",
      }}
    >
      {tabs.map((t) => {
        const on = isActive(t.href);
        return (
          <Link key={t.href} href={t.href} style={{ ...cell, color: on ? "var(--nova-pink)" : "var(--nova-ink-faint)" }}>
            <NavGlyph href={t.href} fallback={t.icon} size={21} />
            <span style={{ ...label, fontWeight: on ? 700 : 600 }}>{t.label}</span>
          </Link>
        );
      })}
      <button onClick={onMore} style={{ ...cell, color: "var(--nova-ink-faint)" }} aria-label="More">
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
        <span style={label}>More</span>
      </button>
    </nav>
  );
}
