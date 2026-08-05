"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { NAV, ROUTES } from "@/lib/constants";
import type { NavItem } from "@/lib/constants";
import Logo from "./Logo";
import { useSettings, ACCENT_PRESETS } from "@/lib/settings";
import { StarFilled, StarOutline, Gear, Monitor, Globe, Phone, FileText, BarChart2, Clipboard, Activity, CalendarCheck, Wrench, MapPin, Mail, Package, Zap, LinkIcon, Clock, Users, CheckIcon } from "@/components/Icons";
import { useTenant, useUiTheme, useViewableWorkcenters } from "@/lib/tenant-context";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import type { ViewableWorkcenters, WorkcenterKey } from "@/lib/workcenters";

// ── Nav order persistence ─────────────────────────────────────────────────────

const NAV_STATE_KEY = "vevey_nav_state_v2";
const SIDEBAR_COLLAPSED_KEY = "vevey_sidebar_collapsed_v1";
const NAV_EXPANDED_KEY = "vevey_nav_expanded_v1";

function loadExpanded(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(NAV_EXPANDED_KEY) || "{}"); } catch { return {}; }
}
function saveExpanded(map: Record<string, boolean>) {
  try { localStorage.setItem(NAV_EXPANDED_KEY, JSON.stringify(map)); } catch {}
}

type NavState = {
  favs: string[];
  rest: string[];
};

type FlatItem = NavItem & { group: string };


// A parent "toggle" row (Sales/Service/Marketing/Master data -- anything
// with children) has no workcenterKey of its own; it's viewable whenever at
// least one child is. A leaf item with no workcenterKey at all (shouldn't
// happen for anything in NAV today) defaults to viewable, same as before
// this feature existed.
function isItemViewable(item: NavItem, viewable: ViewableWorkcenters): boolean {
  if (viewable === "all") return true;
  if (item.children?.length) return item.children.some((ch) => isItemViewable(ch, viewable));
  if (!item.workcenterKey) return true;
  return viewable.includes(item.workcenterKey as WorkcenterKey);
}

function flattenNav(features?: Record<string, boolean>, viewable: ViewableWorkcenters = "all"): FlatItem[] {
  return NAV.flatMap((grp) =>
    grp.items
      .filter((item) => (!item.featureKey || features?.[item.featureKey] === true) && isItemViewable(item, viewable))
      .map((item) => ({ ...item, group: grp.group }))
  );
}

function defaultNavState(features?: Record<string, boolean>, viewable: ViewableWorkcenters = "all"): NavState {
  return { favs: [], rest: flattenNav(features, viewable).map((i) => i.href) };
}

function loadNavState(features?: Record<string, boolean>, viewable: ViewableWorkcenters = "all"): NavState {
  if (typeof window === "undefined") return defaultNavState(features, viewable);
  try {
    const raw = localStorage.getItem(NAV_STATE_KEY);
    if (!raw) return defaultNavState(features, viewable);
    const saved: NavState = JSON.parse(raw);
    const all = flattenNav(features, viewable).map((i) => i.href);
    const validFavs = saved.favs.filter((h) => all.includes(h));
    const validRest = saved.rest.filter((h) => all.includes(h));
    const known = new Set([...validFavs, ...validRest]);
    const fresh = all.filter((h) => !known.has(h));
    return { favs: validFavs, rest: [...validRest, ...fresh] };
  } catch {
    return defaultNavState(features, viewable);
  }
}

function saveNavState(s: NavState) {
  try { localStorage.setItem(NAV_STATE_KEY, JSON.stringify(s)); } catch {}
}

// ── Nav glyphs ────────────────────────────────────────────────────────────────
// Under the "nextgen" theme the sidebar renders a real SVG icon per route
// instead of the unicode glyphs baked into NAV -- the single loudest
// dated-look signal in the old chrome. Other themes keep the text glyphs.

const NAV_GLYPHS: Record<string, React.ComponentType<{ size?: number; color?: string }>> = {
  [ROUTES.dashboard]: Monitor,
  [ROUTES.accounts]: Globe,
  [ROUTES.contacts]: Phone,
  [ROUTES.quotations]: FileText,
  [ROUTES.pipeline]: BarChart2,
  [ROUTES.invoices]: Clipboard,
  [ROUTES.cases]: Activity,
  [ROUTES.amc]: CalendarCheck,
  [ROUTES.workOrders]: Wrench,
  [ROUTES.dispatch]: MapPin,
  [ROUTES.technicians]: Gear,
  [ROUTES.marketing]: Mail,
  [ROUTES.marketingSegments]: Package,
  [ROUTES.leads]: Zap,
  [ROUTES.partners]: LinkIcon,
  [ROUTES.assets]: Gear,
  [ROUTES.suppliers]: Globe,
  [ROUTES.inventory]: Package,
  [ROUTES.purchaseOrders]: Clipboard,
  [ROUTES.reports]: BarChart2,
  [ROUTES.dataWorkbench]: Clipboard,
  [ROUTES.wfmLiveBoard]: Clock,
  [ROUTES.wfmEmployees]: Users,
  [ROUTES.wfmCorrections]: CheckIcon,
};

function NavGlyph({ href, fallback, size = 14 }: { href: string; fallback: string; size?: number }) {
  const nextgen = useUiTheme() === "nextgen";
  const Icon = NAV_GLYPHS[href];
  if (nextgen && Icon) return <Icon size={size} color="currentColor" />;
  return <>{fallback}</>;
}

// ── Drop line ─────────────────────────────────────────────────────────────────

function DropLine({ accent }: { accent: string }) {
  return (
    <div style={{
      height: 2, borderRadius: 2, margin: "2px 6px",
      background: accent,
      boxShadow: `0 0 8px ${accent}88`,
    }} />
  );
}

// ── Draggable section ─────────────────────────────────────────────────────────

type SectionProps = {
  items: FlatItem[];
  isFavSection: boolean;
  isActive: (href: string) => boolean;
  onToggleFav: (href: string) => void;
  onReorder: (items: FlatItem[]) => void;
  onNavigate?: () => void;
  accent: string;
  compact: boolean;
  features?: Record<string, boolean>;
  viewable: ViewableWorkcenters;
  hidden: Set<string>;
  expanded: Record<string, boolean>;
  onToggleExpand: (href: string) => void;
};

function DraggableSection({
  items, isFavSection, isActive, onToggleFav, onReorder, onNavigate, accent, compact, features, viewable, hidden, expanded, onToggleExpand,
}: SectionProps) {
  const [dropAt, setDropAt]   = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const dragIdx               = useRef<number | null>(null);
  // Shell only passes onNavigate when this Sidebar renders inside the mobile
  // drawer -- desktop reordering relies on the wrapper's draggable=true, but
  // on a touch device that same attribute makes the browser treat a tap as an
  // ambiguous drag-vs-tap gesture (worse the deeper a link sits, which is
  // exactly why nested children under an expanded group were the least
  // reliable to tap): a normal tap can get silently swallowed instead of
  // navigating. There's no drag-to-reorder UI on mobile anyway, so it's
  // switched off there entirely rather than tuned.
  const isMobile = !!onNavigate;

  const onDragStart = (e: React.DragEvent, idx: number) => {
    dragIdx.current = idx;
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    e.dataTransfer.setDragImage(c, 0, 0);
    e.dataTransfer.effectAllowed = "move";
  };

  const onDragOver = (e: React.DragEvent<HTMLDivElement>, idx: number) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    setDropAt(e.clientY < rect.top + rect.height / 2 ? idx : idx + 1);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const from = dragIdx.current;
    const to   = dropAt;
    dragIdx.current = null;
    if (from === null || to === null || from === to || from + 1 === to) {
      setDropAt(null);
      return;
    }
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(from < to ? to - 1 : to, 0, moved);
    onReorder(next);
    setDropAt(null);
  };

  const onDragEnd = () => { dragIdx.current = null; setDropAt(null); };

  if (items.length === 0 && isFavSection) {
    return (
      <div style={{ padding: "5px 10px 8px", fontSize: 11, color: "var(--sb-text-faint)", fontStyle: "italic" }}>
        Hover an item below · click <StarOutline size={10} color="#f6b23c" /> to pin
      </div>
    );
  }

  const py = compact ? "6px" : "8px";

  return (
    <div onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      {items.map((item, idx) => {
        const hasChildren = !!item.children?.length;
        const childActive = hasChildren && item.children!.some((ch) => isActive(ch.href));
        const on         = isActive(item.href) || childActive;
        const isDragging = dragIdx.current === idx;
        const showHover  = hovered === idx;
        const isOpen     = expanded[item.href] !== false; // default expanded

        const rowContent = (
          <>
            <span style={{ width: 16, textAlign: "center", fontSize: 14, flexShrink: 0, display: "inline-flex", justifyContent: "center" }}>
              <NavGlyph href={item.href} fallback={item.icon} />
            </span>
            <span style={{ flex: 1 }}>{item.label}</span>
            {/* A "bundled" nav item (Sales, Service, Marketing, Master data --
                anything with children) can be favourited as a whole just like
                any leaf item; stopPropagation keeps the click from also
                toggling expand/collapse (its own row-level onClick) or, for a
                leaf item, triggering the Link's navigation. On mobile,
                showHover never becomes true (no mouse) -- always show the
                star there, or the "All" list's favorite toggle is
                permanently unreachable on touch. */}
            {(isFavSection || showHover || isMobile) && (
              <span
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleFav(item.href); }}
                title={isFavSection ? "Remove from favourites" : "Add to favourites"}
                style={{
                  fontSize: 13, flexShrink: 0, cursor: "pointer", lineHeight: 1,
                  color: isFavSection ? "#f6b23c" : "#f6b23c99",
                }}
              >
                {isFavSection ? <StarFilled size={12} color="#f6b23c" /> : <StarOutline size={12} color="#f6b23c99" />}
              </span>
            )}
            {hasChildren && (
              <span style={{ fontSize: 10, flexShrink: 0, color: on ? "var(--sb-active-ink, #fff)" : "var(--sb-text-dim)", transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 0.12s" }}>▸</span>
            )}
            {!hasChildren && (
              <span style={{
                fontSize: 14, flexShrink: 0, cursor: "grab", lineHeight: 1,
                color: showHover ? "var(--sb-text-dim)" : "transparent",
                transition: "color 0.1s",
              }}>⠿</span>
            )}
          </>
        );

        const rowStyle: React.CSSProperties = {
          display: "flex", alignItems: "center", gap: 9,
          padding: `${py} 10px`,
          borderRadius: 8, fontSize: 13, marginBottom: 1,
          color: on ? "var(--sb-active-ink, #fff)" : "var(--sb-text)",
          background: on ? `var(--sb-active-bg, ${accent})` : "transparent",
          opacity: isDragging ? 0.35 : 1,
          textDecoration: "none",
          userSelect: "none",
          transition: "background 0.12s",
          cursor: hasChildren ? "pointer" : "default",
        };

        return (
          <div
            key={item.href}
            draggable={!isMobile}
            onDragStart={isMobile ? undefined : (e) => onDragStart(e, idx)}
            onDragOver={isMobile ? undefined : (e) => onDragOver(e, idx)}
            onDragEnd={isMobile ? undefined : onDragEnd}
            onMouseEnter={() => setHovered(idx)}
            onMouseLeave={() => setHovered(null)}
          >
            {dropAt === idx && <DropLine accent={accent} />}

            {hasChildren ? (
              <div onClick={() => onToggleExpand(item.href)} style={rowStyle}>{rowContent}</div>
            ) : (
              <Link href={item.href} onClick={onNavigate} style={rowStyle}>{rowContent}</Link>
            )}

            {hasChildren && isOpen && (
              <div style={{ marginLeft: 10 }}>
                {item.children!
                  .filter((ch) => (!ch.featureKey || features?.[ch.featureKey] === true) && isItemViewable(ch, viewable) && !hidden.has(ch.href))
                  .map((ch) => {
                    const childOn = isActive(ch.href);
                    return (
                      <Link
                        key={ch.href}
                        href={ch.href}
                        onClick={onNavigate}
                        style={{
                          display: "flex", alignItems: "center", gap: 8,
                          padding: `${py} 10px`,
                          borderRadius: 8, fontSize: 12.5, marginBottom: 1,
                          color: childOn ? "var(--sb-active-ink, #fff)" : "var(--sb-text)",
                          background: childOn ? `var(--sb-active-bg, ${accent})` : "transparent",
                          textDecoration: "none",
                          transition: "background 0.12s",
                        }}
                      >
                        <span style={{ width: 14, textAlign: "center", fontSize: 12, flexShrink: 0, display: "inline-flex", justifyContent: "center" }}><NavGlyph href={ch.href} fallback={ch.icon} size={12} /></span>
                        <span>{ch.label}</span>
                      </Link>
                    );
                  })}
              </div>
            )}
          </div>
        );
      })}
      {dropAt === items.length && <DropLine accent={accent} />}
    </div>
  );
}

// ── Icon-only rail row (collapsed sidebar) ─────────────────────────────────────

function IconRailItem({ item, active, accent, onNavigate }: {
  item: FlatItem; active: boolean; accent: string; onNavigate?: () => void;
}) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      title={item.label}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: 36, height: 36, margin: "0 auto 4px", borderRadius: 8,
        color: active ? "var(--sb-active-ink, #fff)" : "var(--sb-text)",
        background: active ? `var(--sb-active-bg, ${accent})` : "transparent",
        textDecoration: "none", fontSize: 15,
      }}
    >
      <NavGlyph href={item.href} fallback={item.icon} size={15} />
    </Link>
  );
}

// ── Main sidebar ──────────────────────────────────────────────────────────────

function UserFooter({ accent, collapsed }: { accent: string; collapsed?: boolean }) {
  const [email, setEmail] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    createBrowserSupabase().auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
    });
  }, []);

  async function signOut() {
    await createBrowserSupabase().auth.signOut();
    router.push("/login");
  }

  if (!email) return null;

  const initials = email.slice(0, 2).toUpperCase();

  return (
    <div style={{
      borderBottom: "1px solid var(--sb-line)",
      paddingBottom: 10, marginBottom: 10,
      display: "flex", flexDirection: collapsed ? "column" : "row", alignItems: "center", gap: 8,
    }}>
      <div title={email} style={{
        width: 30, height: 30, borderRadius: "50%", flexShrink: 0,
        background: accent, color: "#fff",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 11, fontWeight: 700,
      }}>
        {initials}
      </div>
      {!collapsed && (
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 11, color: "var(--sb-text-dimmer)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {email}
          </div>
        </div>
      )}
      <button
        onClick={signOut}
        title="Sign out"
        style={{
          background: "transparent", border: "none",
          color: "var(--sb-text-faint)", cursor: "pointer",
          fontSize: 14, padding: 4, borderRadius: 4,
          flexShrink: 0,
        }}
      >
        ⏻
      </button>
    </div>
  );
}

export default function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const nextgen = useUiTheme() === "nextgen";
  const pathname = usePathname();
  const { settings } = useSettings();
  const tenant = useTenant();
  const viewable = useViewableWorkcenters();

  // Per-browser preference to fully collapse the sidebar to an icon-only rail,
  // separate from the tenant-wide "compact" width setting (which just narrows it
  // while keeping labels). Read from localStorage after mount only, to avoid an
  // SSR/client hydration mismatch -- the server always renders expanded.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try { setCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1"); } catch {}
  }, []);
  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0"); } catch {}
      return next;
    });
  };

  const features   = tenant?.features as Record<string, boolean> | undefined;
  const appearance = tenant?.config?.appearance;
  // tenant.accent_color is the single source of truth for brand colour — editable
  // by both platform admin and tenant admin (Settings → Appearance). The local
  // preset is only a pre-tenant-load fallback.
  const accent  = tenant?.accent_color || ACCENT_PRESETS[settings.accentPreset].color;
  const compact = appearance?.compact_sidebar ?? settings.compactSidebar;

  const [navState, setNavState] = useState<NavState>(() => defaultNavState(features, viewable));
  useEffect(() => { setNavState(loadNavState(features, viewable)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({});
  useEffect(() => { setExpandedMap(loadExpanded()); }, []);
  const toggleExpand = (href: string) => {
    setExpandedMap((prev) => {
      const next = { ...prev, [href]: !(prev[href] !== false) };
      saveExpanded(next);
      return next;
    });
  };

  const allMap  = new Map(flattenNav(features, viewable).map((i) => [i.href, i]));
  // Tenant-wide hidden nav items (Settings → General), not a per-browser preference.
  const hidden  = new Set(tenant?.config?.nav_hidden_hrefs ?? settings.hiddenNavHrefs);

  const favItems  = navState.favs
    .filter((h) => !hidden.has(h))
    .map((h) => allMap.get(h)).filter((i): i is FlatItem => !!i);

  const restItems = navState.rest
    .filter((h) => !hidden.has(h))
    .map((h) => allMap.get(h)).filter((i): i is FlatItem => !!i);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

  const toggleFav = (href: string) => {
    const isFav = navState.favs.includes(href);
    const next: NavState = isFav
      ? { favs: navState.favs.filter((h) => h !== href), rest: [href, ...navState.rest] }
      : { favs: [...navState.favs, href],                rest: navState.rest.filter((h) => h !== href) };
    setNavState(next);
    saveNavState(next);
  };

  const reorderFavs = (items: FlatItem[]) => {
    const next = { ...navState, favs: items.map((i) => i.href) };
    setNavState(next);
    saveNavState(next);
  };

  const reorderRest = (items: FlatItem[]) => {
    const next = { ...navState, rest: items.map((i) => i.href) };
    setNavState(next);
    saveNavState(next);
  };

  const resetNav = () => {
    const fresh = defaultNavState();
    setNavState(fresh);
    saveNavState(fresh);
  };

  return (
    <aside style={{
      width: collapsed ? 56 : compact ? 210 : 236,
      background: "var(--sidebar-grad)",
      flexShrink: 0,
      padding: collapsed ? "16px 8px" : "16px 12px",
      color: "var(--sb-text)",
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      transition: "width 0.2s",
    }}>

      {/* Logo + collapse toggle */}
      <div style={{
        display: "flex", alignItems: "center", gap: 9,
        justifyContent: collapsed ? "center" : "space-between",
        padding: "4px 6px 14px",
        borderBottom: "1px solid var(--sb-line)",
        marginBottom: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
          {tenant?.logo_url ? (
            <img
              src={tenant.logo_url}
              alt={tenant.name}
              style={{ width: 34, height: 34, borderRadius: 8, objectFit: "contain", flexShrink: 0 }}
            />
          ) : (
            <Logo size={34} />
          )}
          {!collapsed && (
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, color: "var(--sb-strong)", fontSize: 14 }}>
                {tenant?.name ?? <span>BPM<span style={{ color: "#7fb4ec" }}>Square</span></span>}
              </div>
              <div style={{
                fontSize: 11, color: "var(--sb-text-dimmer)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {tenant ? "workspace" : settings.workspaceName}
              </div>
            </div>
          )}
        </div>
        {!collapsed && (
          <button
            onClick={toggleCollapsed}
            title="Collapse sidebar"
            style={{
              flexShrink: 0, width: 22, height: 22, borderRadius: 6,
              background: "var(--sb-hover)", border: "none",
              color: "var(--sb-text-dimmer)", cursor: "pointer", fontSize: 11, lineHeight: 1,
            }}
          >
            ◀
          </button>
        )}
      </div>

      {collapsed && (
        <button
          onClick={toggleCollapsed}
          title="Expand sidebar"
          style={{
            width: 32, height: 22, borderRadius: 6, margin: "-6px auto 10px",
            background: "var(--sb-hover)", border: "none",
            color: "var(--sb-text-dimmer)", cursor: "pointer", fontSize: 11, lineHeight: 1,
          }}
        >
          ▶
        </button>
      )}

      <UserFooter accent={accent} collapsed={collapsed} />

      {collapsed ? (
        <nav style={{ overflowY: "auto" }}>
          {[...favItems, ...restItems].map((item) => (
            <IconRailItem key={item.href} item={item} active={isActive(item.href)} accent={accent} onNavigate={onNavigate} />
          ))}
          {viewable === "all" && (
            <>
              <div style={{ borderTop: "1px solid var(--sb-line)", margin: "8px 4px" }} />
              <Link
                href={ROUTES.settings}
                onClick={onNavigate}
                title="Settings"
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 36, height: 36, margin: "0 auto", borderRadius: 8,
                  background: isActive(ROUTES.settings) ? `var(--sb-active-bg, ${accent})` : "transparent",
                  textDecoration: "none",
                }}
              >
                <Gear size={14} color={isActive(ROUTES.settings) ? "var(--sb-active-ink, #fff)" : "var(--sb-icon-muted)"} />
              </Link>
            </>
          )}
        </nav>
      ) : (
      <nav>
        {/* Favourites */}
        <div style={{
          fontSize: 9.5, letterSpacing: 1.1, fontWeight: 700,
          color: "#f6b23c", paddingLeft: 10, marginBottom: 3,
        }}>
          <StarFilled size={9} color="#f6b23c" style={{ marginRight: 4 }} /> {nextgen ? "Favourites" : "FAVOURITES"}
        </div>
        <DraggableSection
          items={favItems}
          isFavSection={true}
          isActive={isActive}
          onToggleFav={toggleFav}
          onReorder={reorderFavs}
          onNavigate={onNavigate}
          accent={accent}
          compact={compact}
          features={features}
          viewable={viewable}
          hidden={hidden}
          expanded={expandedMap}
          onToggleExpand={toggleExpand}
        />

        {/* Divider */}
        <div style={{ borderTop: "1px solid var(--sb-line)", margin: "10px 4px" }} />

        {/* All items */}
        <div style={{
          fontSize: 9.5, letterSpacing: 1.1, fontWeight: 600,
          color: "var(--sb-text-dim)", paddingLeft: 10, marginBottom: 3,
        }}>
          {nextgen ? "All" : "ALL"} · drag · <StarOutline size={9} color="var(--sb-text-dim)" /> to pin
        </div>
        <DraggableSection
          items={restItems}
          isFavSection={false}
          isActive={isActive}
          onToggleFav={toggleFav}
          onReorder={reorderRest}
          onNavigate={onNavigate}
          accent={accent}
          compact={compact}
          features={features}
          viewable={viewable}
          hidden={hidden}
          expanded={expandedMap}
          onToggleExpand={toggleExpand}
        />

        {/* Settings link + reset -- Settings itself is hidden for a member
            restricted to specific workcenters by a Business Role (nothing
            in it is scoped to any workcenter, so it was previously shown
            to everyone regardless of restriction); "Reset nav order" is
            just a personal nav-layout preference, so it stays available
            either way. */}
        <div style={{ borderTop: "1px solid var(--sb-line)", marginTop: 10, paddingTop: 8 }}>
          {viewable === "all" && (
            <Link
              href={ROUTES.settings}
              onClick={onNavigate}
              style={{
                display: "flex", alignItems: "center", gap: 8, width: "100%",
                padding: "7px 10px", borderRadius: 8, fontSize: 12.5,
                color: isActive(ROUTES.settings) ? "#dce9f6" : "var(--sb-text)",
                background: isActive(ROUTES.settings) ? `var(--sb-active-bg, ${accent})` : "transparent",
                textDecoration: "none",
                transition: "background 0.12s",
              }}
            >
              <Gear size={14} color={isActive(ROUTES.settings) ? "var(--sb-active-ink, #fff)" : "var(--sb-icon-muted)"} />
              <span>Settings</span>
            </Link>
          )}
          <button
            onClick={resetNav}
            style={{
              background: "transparent", border: "none",
              color: "var(--sb-text-dim)", fontSize: 11, cursor: "pointer",
              padding: "4px 10px", borderRadius: 5,
              textAlign: "left", width: "100%",
              marginTop: 2,
            }}
          >
            ↺ Reset nav order
          </button>
        </div>
      </nav>
      )}
    </aside>
  );
}
