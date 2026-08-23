"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTenant, useViewableWorkcenters, useIsWfmSupervisor } from "@/lib/tenant-context";
import { buildSpaceGroups, spaceForHref, type SpaceGroup, type SpaceItem } from "@/lib/nova/spaces";
import { readNovaNavCache, fetchNovaNav } from "@/lib/nova/navClient";

/**
 * Spaces as top-bar categories (owner direction 2026-08-23): one bigger
 * icon per NAV group in the header, and clicking a category opens a
 * glass flyout with that group's modules stacked and labeled -- the same
 * card language as the Constellation's deal popover. Replaces the flat
 * 30-glyph grid that used to sit in the rail on desktop (unlabeled icons
 * stop being guessable past ~10; the flyout gives every module its label
 * back). The rail keeps the grid only inside the mobile drawer, where
 * there is no header row to hold categories.
 *
 * The "browse all" button at the end raises the same classic-sidebar
 * experience the rail's Spaces-maximize used to -- NovaSidebar listens
 * for the event, so the favourites/drag-reorder tree stays one click
 * away.
 */
export default function NovaSpacesBar() {
  const pathname = usePathname();
  const router = useRouter();
  const tenant = useTenant();
  const viewable = useViewableWorkcenters();
  const isWfmSupervisor = useIsWfmSupervisor();
  const [open, setOpen] = useState<string | null>(null);
  const [attention, setAttention] = useState<Set<string>>(new Set());
  const wrapRef = useRef<HTMLDivElement>(null);

  const features = (tenant?.features ?? {}) as Record<string, boolean>;
  const groups: SpaceGroup[] = buildSpaceGroups(features, viewable, isWfmSupervisor);
  const allItems: SpaceItem[] = groups.flatMap((g) => g.items);

  // Attention dots come from the same payload the rail shows -- cache-first,
  // then one shared network refresh (navClient dedupes with NovaSidebar).
  useEffect(() => {
    let cancelled = false;
    const apply = (hrefs: string[]) => {
      if (cancelled) return;
      setAttention(new Set(hrefs));
    };
    const toHrefs = (items: { href: string }[]) =>
      items.map((it) => spaceForHref(it.href, allItems)).filter((h): h is string => h !== null);
    const cached = readNovaNavCache();
    if (cached) apply(toHrefs(cached.items));
    fetchNovaNav().then((data) => { if (data) apply(toHrefs(data.items)); });
    return () => { cancelled = true; };
    // allItems is derived from stable context values; keying on its length
    // avoids re-running for a same-content new array every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allItems.length]);

  // Close on route change, outside click, and Escape.
  useEffect(() => { setOpen(null); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  if (groups.length === 0) return null;

  const groupActive = (g: SpaceGroup) =>
    g.items.some((it) => pathname === it.href || pathname.startsWith(it.href + "/"));
  const groupAttention = (g: SpaceGroup) => g.items.some((it) => attention.has(it.href));

  return (
    <div ref={wrapRef} style={{ display: "flex", alignItems: "center", gap: 4, flex: 1, minWidth: 0, overflow: "visible" }}>
      <style>{`
        .nova-space-cat { transition: background .15s ease, transform .15s ease; }
        .nova-space-cat:hover { background: rgba(255,255,255,0.09) !important; transform: translateY(-1px); }
        .nova-space-fly-row { transition: background .12s ease; }
        .nova-space-fly-row:hover { background: rgba(255,255,255,0.07); }
        @media (prefers-reduced-motion: reduce) { .nova-space-cat:hover { transform: none !important; } }
      `}</style>
      {groups.map((g) => {
        const Icon = g.icon;
        const active = groupActive(g);
        const isOpen = open === g.key;
        const single = g.items.length === 1;
        return (
          <div key={g.key} style={{ position: "relative", flexShrink: 0 }}>
            <button
              type="button"
              title={g.label}
              aria-label={g.label}
              aria-expanded={single ? undefined : isOpen}
              onClick={() => {
                if (single) { router.push(g.items[0].href); setOpen(null); return; }
                setOpen((cur) => (cur === g.key ? null : g.key));
              }}
              className="nova-space-cat"
              style={{
                position: "relative", width: 38, height: 38, borderRadius: 9,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: active || isOpen ? "var(--nova-glass-border)" : "transparent",
                border: `1px solid ${isOpen ? "rgba(232,67,147,0.45)" : active ? "var(--nova-glass-border)" : "transparent"}`,
                cursor: "pointer",
              }}
            >
              <Icon size={19} color={active || isOpen ? "var(--nova-ink)" : "var(--nova-ink-dim)"} />
              {groupAttention(g) && (
                <span style={{ position: "absolute", top: 4, right: 4, width: 6, height: 6, borderRadius: "50%", background: "var(--nova-orange-soft)" }} />
              )}
              {active && (
                <span style={{ position: "absolute", left: 9, right: 9, bottom: 2, height: 2, borderRadius: 2, background: "var(--nova-pink)" }} />
              )}
            </button>

            {isOpen && !single && (
              <div
                role="menu"
                aria-label={g.label}
                style={{
                  position: "absolute", top: "calc(100% + 10px)", left: 0, zIndex: 130,
                  minWidth: 224, maxHeight: "min(480px, 70vh)", overflowY: "auto",
                  background: "rgba(10, 15, 30, 0.96)", backdropFilter: "blur(16px)",
                  border: "1px solid var(--nova-glass-border)", borderRadius: 14,
                  boxShadow: "0 12px 60px rgba(0,0,0,0.5)", padding: 6,
                }}
              >
                <div style={{ fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--nova-ink-faint)", padding: "8px 10px 6px" }}>
                  {g.label}
                </div>
                {g.items.map((it) => {
                  const ItemIcon = it.icon;
                  const itemActive = pathname === it.href || pathname.startsWith(it.href + "/");
                  return (
                    <Link
                      key={it.href}
                      href={it.href}
                      role="menuitem"
                      onClick={() => setOpen(null)}
                      className="nova-space-fly-row"
                      style={{
                        display: "flex", alignItems: "center", gap: 10, padding: "9px 10px",
                        borderRadius: 9, textDecoration: "none",
                        background: itemActive ? "var(--nova-glass-bg)" : "transparent",
                      }}
                    >
                      <ItemIcon size={15} color={itemActive ? "var(--nova-pink-soft)" : "var(--nova-ink-dim)"} />
                      <span style={{ flex: 1, fontSize: 13, color: itemActive ? "var(--nova-ink)" : "var(--nova-ink-dim)", whiteSpace: "nowrap" }}>{it.label}</span>
                      {attention.has(it.href) && (
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--nova-orange-soft)", flexShrink: 0 }} />
                      )}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      <button
        type="button"
        title="Browse all modules"
        aria-label="Browse all modules"
        onClick={() => { setOpen(null); window.dispatchEvent(new CustomEvent("nova:browse-all")); }}
        className="nova-space-cat"
        style={{
          width: 38, height: 38, borderRadius: 9, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "transparent", border: "1px solid transparent", cursor: "pointer",
        }}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--nova-ink-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="5" cy="5" r="1.6" /><circle cx="12" cy="5" r="1.6" /><circle cx="19" cy="5" r="1.6" />
          <circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" />
          <circle cx="5" cy="19" r="1.6" /><circle cx="12" cy="19" r="1.6" /><circle cx="19" cy="19" r="1.6" />
        </svg>
      </button>
    </div>
  );
}
