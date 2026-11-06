"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTenant, useViewableWorkcenters, useIsWfmSupervisor } from "@/lib/tenant-context";
import { buildSpaceGroups, type SpaceGroup } from "@/lib/nova/spaces";
import Logo from "./Logo";

/**
 * The floating icon rail of the Rich look (docs/design/rich-ui.md). It lists the same Spaces categories as NovaSidebar and
 * MobileTabBar (buildSpaceGroups: same feature, workcenter, supervisor and hidden-menu gating), so every nav item stays reachable:
 * a one-module category navigates directly, a bigger one opens a labelled flyout. Names show on hover and on keyboard focus.
 * Only mounted when Rich is on and the person chose "Rail"; all styling is in src/styles/rich.css under [data-rich="true"].
 *
 * The name tip is one fixed element driven from state, not a pseudo-element: the icon list scrolls on a short screen, and a
 * scroll container clips anything drawn outside it.
 */
export default function RichRail() {
  const pathname = usePathname();
  const tenant = useTenant();
  const viewable = useViewableWorkcenters();
  const isWfmSupervisor = useIsWfmSupervisor();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [anchorY, setAnchorY] = useState(96);
  const [flyTop, setFlyTop] = useState<number | null>(null);
  const [tip, setTip] = useState<{ label: string; y: number } | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const flyRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setOpenKey(null); }, [pathname]);
  useEffect(() => {
    if (!openKey) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (navRef.current?.contains(t) || flyRef.current?.contains(t)) return;
      setOpenKey(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenKey(null); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [openKey]);

  // The flyout opens level with the icon that opened it and is pulled up just enough to stay on screen, whatever its length.
  useLayoutEffect(() => {
    if (!openKey || !flyRef.current) { setFlyTop(null); return; }
    const h = flyRef.current.offsetHeight;
    setFlyTop(Math.max(16, Math.min(anchorY - 24, window.innerHeight - h - 16)));
  }, [openKey, anchorY]);

  const features = (tenant?.features ?? {}) as Record<string, boolean>;
  const groups: SpaceGroup[] = buildSpaceGroups(features, viewable, isWfmSupervisor, tenant?.config?.nav_hidden_hrefs ?? []);
  const isOn = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/"));
  const openG = groups.find((g) => g.key === openKey) ?? null;

  const showTip = (label: string) => (e: React.SyntheticEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ label, y: r.top + r.height / 2 });
  };
  const hideTip = () => setTip(null);
  const tipProps = (label: string) => ({ onMouseEnter: showTip(label), onFocus: showTip(label), onMouseLeave: hideTip, onBlur: hideTip });

  return (
    <>
      <nav ref={navRef} className="rich-rail" aria-label="Main" onScroll={hideTip}>
        <Link href="/" className="rich-rail__brand" aria-label={tenant?.name ?? "Home"} {...tipProps(tenant?.name ?? "Home")}>
          {tenant?.logo_url ? <img src={tenant.logo_url} alt="" /> : <Logo size={36} />}
        </Link>
        <button
          type="button" className="rich-rail__btn" aria-label="Search" {...tipProps("Search  Ctrl K")}
          onClick={() => window.dispatchEvent(new Event("nova:open-palette"))}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
        </button>
        <div className="rich-rail__list" onScroll={hideTip}>
          {groups.map((g) => {
            const Icon = g.icon;
            const on = g.items.some((it) => isOn(it.href));
            if (g.items.length === 1) {
              return (
                <Link key={g.key} href={g.items[0].href} className="rich-rail__btn" aria-label={g.label} aria-current={on ? "page" : undefined} {...tipProps(g.label)}>
                  <Icon size={22} color="currentColor" />
                </Link>
              );
            }
            return (
              <button
                key={g.key} type="button" className="rich-rail__btn" aria-label={g.label}
                aria-haspopup="menu" aria-expanded={openKey === g.key} aria-current={on ? "page" : undefined} {...tipProps(g.label)}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setAnchorY(rect.top + rect.height / 2);
                  setFlyTop(null);
                  setTip(null);
                  setOpenKey((cur) => (cur === g.key ? null : g.key));
                }}
              >
                <Icon size={22} color="currentColor" />
              </button>
            );
          })}
        </div>
      </nav>
      {tip && !openG && <div className="rich-rail__tip" role="tooltip" style={{ top: tip.y }}>{tip.label}</div>}
      {openG && (
        <div
          ref={flyRef} role="menu" aria-label={openG.label} className="rich-rail__fly"
          style={{ top: flyTop ?? anchorY, visibility: flyTop === null ? "hidden" : "visible" }}
        >
          <div className="rich-rail__flyhead">{openG.label}</div>
          {openG.items.map((it) => {
            const ItemIcon = it.icon;
            return (
              <Link key={it.href} href={it.href} role="menuitem" className="rich-rail__item" aria-current={isOn(it.href) ? "page" : undefined} onClick={() => setOpenKey(null)}>
                <ItemIcon size={18} color="currentColor" />
                <span>{it.label}</span>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
