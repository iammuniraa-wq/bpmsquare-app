"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTenant, useViewableWorkcenters, useIsWfmSupervisor, useIsNextgen3Layer } from "@/lib/tenant-context";
import { buildSpaceGroups, type SpaceGroup } from "@/lib/nova/spaces";

/**
 * A bottom tab bar, because a hamburger is not a mobile pattern -- it is a
 * desktop sidebar folded up and hidden.
 *
 * The tabs are Spaces CATEGORIES (Sales, Service, Marketing, Workforce, ...)
 * -- the same grouping the rail's Spaces section uses (owner direction
 * 2026-08-24: "on mobile also show the header sales service marketing
 * wfm"), not a flat list of the first four individual modules. A
 * single-module category (Home -> Dashboard) still navigates directly on
 * tap; a category with several modules opens a bottom sheet listing them,
 * labeled -- the same "tap to reveal the stacked list" idea as the rail's
 * side flyout, just anchored to the bottom on a screen with no room beside
 * a rail. "More" still opens the full drawer (favourites, drag-reorder,
 * everything else).
 *
 * Nova-gated: this changes how a phone navigates, and no existing client
 * should have that arrive unannounced.
 */

const MAX_TABS = 4;

export default function MobileTabBar({ onMore }: { onMore: () => void }) {
  const nova = useIsNextgen3Layer();
  const tenant = useTenant();
  const viewable = useViewableWorkcenters();
  const isWfmSupervisor = useIsWfmSupervisor();
  const pathname = usePathname();
  const [openCat, setOpenCat] = useState<string | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setOpenCat(null); }, [pathname]);
  useEffect(() => {
    if (!openCat) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenCat(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openCat]);

  if (!nova) return null;

  const features = (tenant?.features ?? {}) as Record<string, boolean>;
  const groups: SpaceGroup[] = buildSpaceGroups(features, viewable, isWfmSupervisor);
  const tabs = groups.slice(0, MAX_TABS);
  if (tabs.length === 0) return null;

  const isActive = (g: SpaceGroup) => g.items.some((it) => it.href === "/" ? pathname === "/" : pathname.startsWith(it.href));
  const openG = tabs.find((g) => g.key === openCat) ?? null;

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
    <>
      {openG && (
        <div
          onClick={() => setOpenCat(null)}
          style={{ position: "fixed", inset: 0, zIndex: 97, background: "rgba(0,0,0,0.5)" }}
        />
      )}
      {openG && (
        <div
          ref={sheetRef}
          role="menu"
          aria-label={openG.label}
          style={{
            position: "fixed", left: 0, right: 0, bottom: "calc(58px + env(safe-area-inset-bottom, 0px))", zIndex: 98,
            maxHeight: "50vh", overflowY: "auto",
            background: "rgba(10, 15, 30, 0.97)", backdropFilter: "blur(16px)",
            borderTop: "1px solid var(--nova-glass-border)",
            borderTopLeftRadius: 16, borderTopRightRadius: 16,
            boxShadow: "0 -12px 40px rgba(0,0,0,0.5)", padding: "6px 6px 10px",
          }}
        >
          <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--nova-ink-faint)", padding: "10px 12px 6px" }}>
            {openG.label}
          </div>
          {openG.items.map((it) => {
            const ItemIcon = it.icon;
            const itemActive = it.href === "/" ? pathname === "/" : pathname.startsWith(it.href);
            return (
              <Link
                key={it.href}
                href={it.href}
                role="menuitem"
                onClick={() => setOpenCat(null)}
                style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "12px 14px",
                  borderRadius: 10, textDecoration: "none",
                  background: itemActive ? "var(--nova-glass-bg)" : "transparent",
                }}
              >
                <ItemIcon size={17} color={itemActive ? "var(--nova-pink-soft)" : "var(--nova-ink-dim)"} />
                <span style={{ fontSize: 14, color: itemActive ? "var(--nova-ink)" : "var(--nova-ink-dim)" }}>{it.label}</span>
              </Link>
            );
          })}
        </div>
      )}

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
        {tabs.map((g) => {
          const Icon = g.icon;
          const on = isActive(g) || openCat === g.key;
          const single = g.items.length === 1;
          if (single) {
            return (
              <Link key={g.key} href={g.items[0].href} style={{ ...cell, color: on ? "var(--nova-pink)" : "var(--nova-ink-faint)" }}>
                <Icon size={21} />
                <span style={{ ...label, fontWeight: on ? 700 : 600 }}>{g.label}</span>
              </Link>
            );
          }
          return (
            <button
              key={g.key}
              type="button"
              onClick={() => setOpenCat((cur) => (cur === g.key ? null : g.key))}
              aria-expanded={openCat === g.key}
              style={{ ...cell, color: on ? "var(--nova-pink)" : "var(--nova-ink-faint)" }}
            >
              <Icon size={21} />
              <span style={{ ...label, fontWeight: on ? 700 : 600 }}>{g.label}</span>
            </button>
          );
        })}
        <button onClick={onMore} style={{ ...cell, color: "var(--nova-ink-faint)" }} aria-label="More">
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
          <span style={label}>More</span>
        </button>
      </nav>
    </>
  );
}
