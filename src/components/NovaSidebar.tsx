"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTenant, useViewableWorkcenters, useIsWfmSupervisor } from "@/lib/tenant-context";
import type { NovaStreamItem } from "@/lib/nova/stream";
import type { NovaFlow } from "@/lib/nova/flows";
import { buildSpaceGroups, spaceForHref, type SpaceGroup } from "@/lib/nova/spaces";
import { readNovaNavCache, fetchNovaNav } from "@/lib/nova/navClient";
import NovaAccountMarketSignals from "@/components/NovaAccountMarketSignals";
import { MOBILE_BREAKPOINT } from "@/lib/constants";
import Sidebar from "./Sidebar";
import Logo from "./Logo";

const TONE_COLOR: Record<NovaStreamItem["accent"], string> = {
  orange: "var(--nova-orange-soft)",
  pink: "var(--nova-pink-soft)",
  purple: "var(--nova-purple-softer)",
  teal: "var(--nova-teal-soft)",
};

const FLOW_COLOR: Record<NovaFlow["id"], string> = {
  pipeline: "var(--nova-orange-soft)",
  cases: "var(--nova-teal-soft)",
  contracts: "var(--nova-purple-softer)",
  cash: "var(--nova-pink-soft)",
};

type Section = "needs" | "flows" | "spaces";

// Base routes that carry individual records -- classic Sidebar gives a
// record page room by defaulting to its icon-only rail everywhere; Nova's
// panel had no equivalent at all, so a record page was stuck fighting a
// fixed 264px rail for width. Narrowing specifically on these (owner request
// 2026-08-31: "narrow to hide the whole nav when I go in any object") gets
// the same effect without touching classic's own always-collapsed default.
const RECORD_ROUTE_PREFIXES = [
  "/accounts", "/contacts", "/quotations", "/standard-quotes", "/cases",
  "/work-orders", "/technicians", "/assets", "/invoices", "/suppliers",
  "/products", "/inventory", "/purchase-orders", "/leads", "/partners",
];

// True once the path goes a level deeper than the object's own list page --
// /accounts is the list (full nav stays), /accounts/[id] (or /new, /edit,
// /print, ...) is "inside" a specific record (nav narrows).
function isRecordDetailPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return RECORD_ROUTE_PREFIXES.some((base) => {
    if (!pathname.startsWith(base)) return false;
    const rest = pathname.slice(base.length);
    return rest.startsWith("/") && rest.length > 1;
  });
}

function openPalette() {
  window.dispatchEvent(new CustomEvent("nova:open-palette"));
}

function ExpandIcon({ maximized }: { maximized: boolean }) {
  // Corners pointing outward (maximize) or inward (minimize) -- a plain
  // SVG toggle, no icon library entry needed for a two-state glyph this small.
  return maximized ? (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3H3v6M15 21h6v-6M3 15v6h6M21 9V3h-6" />
    </svg>
  ) : (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9V3h6M21 15v6h-6M21 9V3h-6M3 15v6h6" />
    </svg>
  );
}

function SectionHead({ label, section, maximized, onToggle, right }: {
  label: string; section: Section; maximized: Section | null; onToggle: (s: Section) => void; right?: React.ReactNode;
}) {
  const isMax = maximized === section;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
      <span style={{ fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--nova-ink-faint)", flex: 1 }}>{label}</span>
      {right}
      <button
        type="button"
        onClick={() => onToggle(section)}
        title={isMax ? "Restore" : "Expand"}
        className="nova-sb-expand"
        style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, borderRadius: 5, background: "transparent", border: "none", color: "var(--nova-ink-faint)", cursor: "pointer", flexShrink: 0 }}
      >
        <ExpandIcon maximized={isMax} />
      </button>
    </div>
  );
}

function ProgressRing({ percent, color, size = 36 }: { percent: number; color: string; size?: number }) {
  const r = size * 0.42;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.min(100, Math.max(0, percent)) / 100);
  const center = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0, transform: "rotate(-90deg)" }}>
      <circle cx={center} cy={center} r={r} fill="none" stroke="var(--nova-line)" strokeWidth={3} />
      <circle
        cx={center} cy={center} r={r} fill="none" stroke={color} strokeWidth={3}
        strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
        style={{ transition: "stroke-dashoffset .4s ease" }}
      />
      <text x={center} y={center} textAnchor="middle" dominantBaseline="central" fontSize={size * 0.28} fill={color} transform={`rotate(90 ${center} ${center})`} fontWeight={700}>
        {percent}
      </text>
    </svg>
  );
}

/**
 * Nova's own left rail -- replaces the classic expandable Sidebar entirely
 * for identityInTopBar tenants (see Shell.tsx). Three sections, from the
 * shared reference design:
 *  - Spaces: every module the tenant/user can actually open, as a compact
 *    icon row up top -- same gating Sidebar.tsx already enforces (feature
 *    flags, workcenter visibility, WFM supervisor-only).
 *  - Needs You Now: the same real signals getNovaStreamItems() computes for
 *    the Stream home screen, just always-visible instead of home-only.
 *  - Flows: 4 outcome trackers (getNovaFlows()) with a real, explainable
 *    percent -- never an invented AI confidence score.
 *
 * Each section's header carries an expand toggle: maximizing Needs You Now
 * or Flows fills the rail with more of the same content and hides the
 * other two. Maximizing Spaces is different by design (owner call): it
 * swaps in the full classic <Sidebar> -- the real expandable nav tree with
 * favourites and drag-reorder -- rather than a bigger icon grid, since
 * that's the richer, already-proven way to browse every module. Toggling
 * again (or the same button, now a "restore" glyph) returns to normal.
 */
export default function NovaSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const tenant = useTenant();
  const viewable = useViewableWorkcenters();
  const isWfmSupervisor = useIsWfmSupervisor();
  const [items, setItems] = useState<NovaStreamItem[]>([]);
  const [flows, setFlows] = useState<NovaFlow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [maximized, setMaximized] = useState<Section | null>(null);
  // Narrow-on-record-page: auto-hides the full panel down to a slim rail
  // whenever the URL is inside a specific record. A manual "show nav" click
  // pins it open for THIS page only -- landing on the next record resets to
  // narrow again, same "default collapsed, expand is a session convenience"
  // spirit as classic Sidebar's own rail. The mobile drawer (onNavigate set)
  // is exempt -- it only exists already-opened, so narrowing it further
  // would just make it useless, exactly like classic's own exemption.
  const isRecordPage = !onNavigate && isRecordDetailPath(pathname);
  const [pinnedOpen, setPinnedOpen] = useState(false);
  useEffect(() => { setPinnedOpen(false); }, [pathname]);
  // Spaces flyout: which category is open, and where its panel anchors
  // vertically (from the clicked button's own screen position).
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [anchorTop, setAnchorTop] = useState(120);
  const [anchorMaxWidth, setAnchorMaxWidth] = useState(320);
  const [isMobile, setIsMobile] = useState(false);
  const spacesRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= MOBILE_BREAKPOINT);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Close the flyout on route change, outside click, and Escape.
  useEffect(() => { setOpenGroup(null); }, [pathname]);
  useEffect(() => {
    if (!openGroup) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (spacesRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpenGroup(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenGroup(null); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [openGroup]);

  // Cache-first, then one shared network refresh (navClient) -- the
  // sections used to sit empty for the whole cold-function round trip on
  // every hard reload (owner-flagged: "Needs You Now / Flows take time to
  // load").
  useEffect(() => {
    let cancelled = false;
    const apply = (data: { items: NovaStreamItem[]; flows: NovaFlow[] } | null, fromNetwork: boolean) => {
      if (cancelled || !data) return;
      setItems(data.items);
      setFlows(data.flows);
      if (fromNetwork || data.items.length || data.flows.length) setLoaded(true);
    };
    apply(readNovaNavCache(), false);
    fetchNovaNav().then((data) => { apply(data, true); if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  const features = (tenant?.features ?? {}) as Record<string, boolean>;
  const groups: SpaceGroup[] = buildSpaceGroups(features, viewable, isWfmSupervisor);
  const allSpaceItems = groups.flatMap((g) => g.items);
  const attentionHrefs = new Set(items.map((it) => spaceForHref(it.href, allSpaceItems)).filter((h): h is string => h !== null));

  function toggle(section: Section) {
    setMaximized((cur) => (cur === section ? null : section));
  }

  const showNeeds = maximized === null || maximized === "needs";
  const showFlows = maximized === null || maximized === "flows";
  const showSpacesRow = maximized === null;
  const spacesMaximized = maximized === "spaces";

  const openG = groups.find((g) => g.key === openGroup) ?? null;

  function onCategoryClick(g: SpaceGroup, e: React.MouseEvent<HTMLButtonElement>) {
    if (g.items.length === 1) {
      setOpenGroup(null);
      onNavigate?.();
      router.push(g.items[0].href);
      return;
    }
    if (openGroup === g.key) { setOpenGroup(null); return; }
    // Anchor the side panel near the clicked button, clamped so a category
    // low in the rail can't push the panel past the bottom of the screen --
    // and clamp its width against the viewport too (2026-08-26 lock audit:
    // the panel had no horizontal ceiling, so a long item label on a narrow
    // desktop window just above the mobile breakpoint could push its right
    // edge off-screen).
    const rect = e.currentTarget.getBoundingClientRect();
    setAnchorTop(Math.max(8, Math.min(rect.top - 6, window.innerHeight - 440)));
    setAnchorMaxWidth(Math.max(180, window.innerWidth - 272 - 12));
    setOpenGroup(g.key);
  }

  if (isRecordPage && !pinnedOpen) {
    return (
      <div style={{ width: 44, flexShrink: 0, height: "100%", position: "sticky", top: 0, background: "var(--nova-bg)", borderRight: "1px solid var(--nova-line)", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "16px 0" }}>
        <style>{`.nova-sb-narrow-btn:hover { background: rgba(255,255,255,0.08) !important; }`}</style>
        <Link href="/" title={tenant?.name ?? "Home"} style={{ display: "flex" }}>
          {tenant?.logo_url ? (
            <img src={tenant.logo_url} alt={tenant.name} style={{ width: 26, height: 26, borderRadius: 6, objectFit: "contain" }} />
          ) : (
            <Logo size={26} />
          )}
        </Link>
        <button
          type="button"
          onClick={() => setPinnedOpen(true)}
          title="Show navigation"
          className="nova-sb-narrow-btn"
          style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 7, background: "transparent", border: "1px solid var(--nova-line)", color: "var(--nova-ink-faint)", cursor: "pointer" }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
        </button>
        <button
          type="button"
          onClick={openPalette}
          title="Ask or act (⌘K)"
          className="nova-sb-narrow-btn"
          style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 7, background: "transparent", border: "1px solid var(--nova-line)", color: "var(--nova-ink-faint)", cursor: "pointer" }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
        </button>
      </div>
    );
  }

  if (spacesMaximized) {
    // The full classic nav experience, exactly as requested -- favourites,
    // drag-reorder, expand/collapse groups -- not a bigger version of the
    // compact icon grid. Still inside Nova's own header/command bar/toggle
    // chrome so "restore" is always reachable.
    return (
      <div style={{ width: 264, flexShrink: 0, height: "100%", position: "sticky", top: 0, background: "var(--nova-bg)", borderRight: "1px solid var(--nova-line)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <style>{`.nova-sb-expand:hover { background: rgba(255,255,255,0.08); color: var(--nova-ink) !important; }`}</style>
        <NovaHeader loaded={loaded} needCount={items.length} />
        <NovaCommandBar />
        <div style={{ padding: "4px 16px 8px" }}>
          <SectionHead label="Spaces" section="spaces" maximized={maximized} onToggle={toggle} />
        </div>
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          <Sidebar onNavigate={onNavigate} hideHeader />
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: 264, flexShrink: 0, height: "100%", position: "sticky", top: 0, background: "var(--nova-bg)", borderRight: "1px solid var(--nova-line)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <style>{`
        @keyframes nova-sb-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
        .nova-sb-live-dot { animation: nova-sb-blink 1.6s ease-in-out infinite; }
        .nova-sb-row { transition: background .15s ease; }
        .nova-sb-row:hover { background: rgba(255,255,255,0.06); }
        .nova-sb-space { transition: background .15s ease, transform .15s ease; }
        .nova-sb-space:hover { background: rgba(255,255,255,0.09) !important; transform: translateY(-1px); }
        .nova-sb-fly-row { transition: background .12s ease; }
        .nova-sb-fly-row:hover { background: rgba(255,255,255,0.07); }
        .nova-sb-expand:hover { background: rgba(255,255,255,0.08); color: var(--nova-ink) !important; }
        .nova-sb-narrow-btn:hover { background: rgba(255,255,255,0.08) !important; color: var(--nova-ink) !important; }
        @media (prefers-reduced-motion: reduce) {
          .nova-sb-live-dot { animation: none !important; }
          .nova-sb-space:hover { transform: none !important; }
        }
      `}</style>

      <NovaHeader loaded={loaded} needCount={items.length} />
      <NovaCommandBar />

      {/* Only reachable by pinning the nav open on a record page (see
          isRecordPage above) -- lets it go back to narrow without having
          to navigate away first. */}
      {isRecordPage && pinnedOpen && (
        <div style={{ padding: "0 16px 8px" }}>
          <button
            type="button"
            onClick={() => setPinnedOpen(false)}
            className="nova-sb-narrow-btn"
            style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", padding: "6px 8px", borderRadius: 7, background: "transparent", border: "1px solid var(--nova-line)", color: "var(--nova-ink-faint)", cursor: "pointer", fontSize: 11.5 }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            Narrow navigation
          </button>
        </div>
      )}

      {/* Spaces -- one bigger icon per main area (Sales, Service, Master
          data, Workforce, ...), where the flat 30-glyph grid used to be
          (owner direction 2026-08-23: categories here, and the module list
          opens in a panel NEXT TO the rail, Constellation-popover style --
          not in the top bar). Unlabeled leaf glyphs stopped being guessable
          past ~10; eight category icons with a labeled flyout scale
          indefinitely as modules ship. */}
      {showSpacesRow && groups.length > 0 && (
        <div ref={spacesRef} style={{ padding: "4px 16px 12px", borderBottom: "1px solid var(--nova-line-soft)" }}>
          <SectionHead label="Spaces" section="spaces" maximized={maximized} onToggle={toggle} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
            {groups.map((g) => {
              const Icon = g.icon;
              const active = g.items.some((it) => pathname === it.href || pathname.startsWith(it.href + "/"));
              const isOpen = openGroup === g.key;
              const hasAttention = g.items.some((it) => attentionHrefs.has(it.href));
              return (
                <button
                  key={g.key}
                  type="button"
                  title={g.label}
                  aria-label={g.label}
                  aria-expanded={g.items.length > 1 ? isOpen : undefined}
                  onClick={(e) => onCategoryClick(g, e)}
                  className="nova-sb-space"
                  style={{
                    position: "relative", aspectRatio: "1", display: "flex", alignItems: "center", justifyContent: "center",
                    borderRadius: 9, background: active || isOpen ? "var(--nova-glass-border)" : "var(--nova-glass-bg)",
                    border: `1px solid ${isOpen ? "rgba(232,67,147,0.45)" : "var(--nova-glass-border)"}`,
                    cursor: "pointer", minWidth: 0, padding: 0,
                  }}
                >
                  <Icon size={19} color={active || isOpen ? "var(--nova-ink)" : "var(--nova-ink-dim)"} />
                  {hasAttention && (
                    <span style={{ position: "absolute", top: 4, right: 4, width: 6, height: 6, borderRadius: "50%", background: "var(--nova-orange-soft)" }} />
                  )}
                  {active && (
                    <span style={{ position: "absolute", left: 10, right: 10, bottom: 3, height: 2, borderRadius: 2, background: "var(--nova-pink)" }} />
                  )}
                </button>
              );
            })}
          </div>

          {/* Mobile drawer: no room beside the rail, so the list expands
              inline under the icon row instead of flying out. */}
          {isMobile && openG && (
            <div style={{ marginTop: 8, background: "var(--nova-glass-bg)", border: "1px solid var(--nova-glass-border)", borderRadius: 12, padding: 4 }}>
              {openG.items.map((it) => {
                const ItemIcon = it.icon;
                const itemActive = pathname === it.href || pathname.startsWith(it.href + "/");
                return (
                  <Link key={it.href} href={it.href} onClick={() => { setOpenGroup(null); onNavigate?.(); }} className="nova-sb-row"
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 8, textDecoration: "none" }}>
                    <ItemIcon size={15} color={itemActive ? "var(--nova-pink-soft)" : "var(--nova-ink-dim)"} />
                    <span style={{ flex: 1, fontSize: 13, color: itemActive ? "var(--nova-ink)" : "var(--nova-ink-dim)" }}>{it.label}</span>
                    {attentionHrefs.has(it.href) && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--nova-orange-soft)", flexShrink: 0 }} />}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Desktop: the category's modules in a glass panel beside the rail
          (position: fixed escapes the rail's overflow: hidden; the mobile
          drawer can't use this -- its translateX transform would make
          "fixed" position against the drawer, hence the inline list above). */}
      {!isMobile && openG && showSpacesRow && (
        <div
          ref={panelRef}
          role="menu"
          aria-label={openG.label}
          style={{
            position: "fixed", left: 272, top: anchorTop, zIndex: 130,
            minWidth: 224, maxWidth: anchorMaxWidth, maxHeight: "min(480px, 80vh)", overflowY: "auto",
            background: "rgba(10, 15, 30, 0.96)", backdropFilter: "blur(16px)",
            border: "1px solid var(--nova-glass-border)", borderRadius: 14,
            boxShadow: "0 12px 60px rgba(0,0,0,0.5)", padding: 6,
          }}
        >
          <div style={{ fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--nova-ink-faint)", padding: "8px 10px 6px" }}>
            {openG.label}
          </div>
          {openG.items.map((it) => {
            const ItemIcon = it.icon;
            const itemActive = pathname === it.href || pathname.startsWith(it.href + "/");
            return (
              <Link
                key={it.href}
                href={it.href}
                role="menuitem"
                onClick={() => { setOpenGroup(null); onNavigate?.(); }}
                className="nova-sb-fly-row"
                style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "9px 10px",
                  borderRadius: 9, textDecoration: "none",
                  background: itemActive ? "var(--nova-glass-bg)" : "transparent",
                }}
              >
                <ItemIcon size={15} color={itemActive ? "var(--nova-pink-soft)" : "var(--nova-ink-dim)"} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: itemActive ? "var(--nova-ink)" : "var(--nova-ink-dim)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.label}</span>
                {attentionHrefs.has(it.href) && (
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--nova-orange-soft)", flexShrink: 0 }} />
                )}
              </Link>
            );
          })}
        </div>
      )}

      {/* Market signals -- account-contextual (owner request 2026-08-25:
          moved out of the account page body into the rail here). Renders
          nothing on its own when no account is in view, or while a section
          above is maximized, so it never leaves stray blank space. */}
      {showSpacesRow && <NovaAccountMarketSignals />}

      <div style={{ flex: 1, overflowY: "auto", padding: "8px 0 16px", display: "flex", flexDirection: "column", minHeight: 0 }}>
        {/* Needs You Now */}
        {items.length > 0 && showNeeds && (
          <div style={{ padding: "12px 16px 4px", display: "flex", flexDirection: "column", flex: maximized === "needs" ? 1 : undefined, minHeight: 0 }}>
            <SectionHead
              label="Needs you now"
              section="needs"
              maximized={maximized}
              onToggle={toggle}
              right={<span className="nova-sb-live-dot" style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--nova-orange-soft)" }} />}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 2, overflowY: maximized === "needs" ? "auto" : undefined }}>
              {(maximized === "needs" ? items : items.slice(0, 4)).map((it) => (
                <Link key={it.id} href={it.href} onClick={onNavigate} className="nova-sb-row" style={{ display: "flex", gap: 8, padding: "7px 8px", borderRadius: 8, textDecoration: "none", color: "inherit" }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: TONE_COLOR[it.accent], flexShrink: 0, marginTop: 5 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, color: "var(--nova-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.title}</div>
                    <div style={{ fontSize: 11, color: "var(--nova-ink-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.detail}</div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Flows */}
        {flows.length > 0 && showFlows && (
          <div style={{ padding: "16px 16px 4px", display: "flex", flexDirection: "column", flex: maximized === "flows" ? 1 : undefined, minHeight: 0 }}>
            <SectionHead label="Flows" section="flows" maximized={maximized} onToggle={toggle} />
            <div style={{ display: "flex", flexDirection: "column", gap: maximized === "flows" ? 10 : 2, overflowY: maximized === "flows" ? "auto" : undefined }}>
              {flows.map((f) => (
                <Link key={f.id} href={f.href} onClick={onNavigate} className="nova-sb-row" style={{ display: "flex", alignItems: "center", gap: 10, padding: maximized === "flows" ? "10px" : "6px 8px", borderRadius: 8, textDecoration: "none", color: "inherit" }}>
                  <ProgressRing percent={f.percent} color={FLOW_COLOR[f.id]} size={maximized === "flows" ? 48 : 36} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: maximized === "flows" ? 14 : 12.5, color: "var(--nova-ink)" }}>{f.label}</div>
                    <div style={{ fontSize: maximized === "flows" ? 12 : 10.5, color: "var(--nova-ink-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.detail}</div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Tenant identity, not the "Nova" experience name -- this is the same
// logo/name a user sees in the classic sidebar and top bar, just Nova's
// own header treatment. Nova is the name of the surface, not a rebrand of
// which workspace the tenant is looking at.
function NovaHeader({ loaded, needCount }: { loaded: boolean; needCount: number }) {
  const tenant = useTenant();
  return (
    <div style={{ padding: "16px 16px 12px", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid var(--nova-line-soft)" }}>
      {tenant?.logo_url ? (
        <img src={tenant.logo_url} alt={tenant.name} style={{ width: 28, height: 28, borderRadius: 7, objectFit: "contain", flexShrink: 0 }} />
      ) : (
        <Logo size={28} />
      )}
      <div style={{ minWidth: 0 }}>
        <div className="nova-display" style={{ fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={tenant?.name}>
          {tenant?.name ?? <span>BPM<span style={{ color: "var(--nova-orange-soft)" }}>Square</span></span>}
        </div>
        <div style={{ fontSize: 11, color: "var(--nova-ink-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {loaded ? `${needCount} need${needCount === 1 ? "s" : ""} you` : "…"}
        </div>
      </div>
    </div>
  );
}

// The command bar's backlit, gently sweeping highlight -- same "alive"
// language as NovaStream's own command bar (nova-stream-pulse), scaled to
// the rail's width and always present here since it's the one control
// visible no matter which section is maximized.
function NovaCommandBar() {
  return (
    <div style={{ padding: "12px 16px 4px" }}>
      <style>{`
        @keyframes nova-sb-cmd-glow {
          0%, 100% { box-shadow: 0 0 0 rgba(232,67,147,0), inset 0 0 0 rgba(155,89,245,0); }
          50% { box-shadow: 0 0 18px rgba(232,67,147,0.28), inset 0 0 12px rgba(155,89,245,0.08); }
        }
        @keyframes nova-sb-cmd-sweep {
          0% { transform: translateX(-130%); }
          100% { transform: translateX(230%); }
        }
        .nova-sb-cmd { position: relative; overflow: hidden; animation: nova-sb-cmd-glow 4.5s ease-in-out infinite; }
        .nova-sb-cmd:hover { background: rgba(255,255,255,0.07) !important; border-color: rgba(232,67,147,0.55) !important; }
        .nova-sb-cmd::after {
          content: ""; position: absolute; top: 0; bottom: 0; width: 45%;
          background: linear-gradient(90deg, transparent, rgba(232,67,147,0.22), rgba(155,89,245,0.16), transparent);
          animation: nova-sb-cmd-sweep 3.6s ease-in-out infinite;
          pointer-events: none;
        }
        @media (prefers-reduced-motion: reduce) {
          .nova-sb-cmd { animation: none !important; }
          .nova-sb-cmd::after { animation: none !important; display: none; }
        }
      `}</style>
      <button
        type="button"
        onClick={openPalette}
        className="nova-sb-cmd"
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 8,
          background: "var(--nova-glass-bg)", border: "1px solid rgba(232,67,147,0.35)",
          borderRadius: 8, padding: "8px 10px", cursor: "pointer", textAlign: "left",
          fontFamily: "var(--nova-font-body)", fontSize: 12.5, color: "var(--nova-ink-faint)",
        }}
      >
        <span style={{ position: "relative", zIndex: 1 }}>Ask or act…</span>
        <span style={{ position: "relative", zIndex: 1, marginLeft: "auto", fontSize: 10, background: "rgba(255,255,255,0.06)", borderRadius: 5, padding: "2px 6px", flexShrink: 0 }}>⌘K</span>
      </button>
    </div>
  );
}
