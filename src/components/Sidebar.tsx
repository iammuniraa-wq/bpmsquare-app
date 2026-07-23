"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { NAV, ROUTES } from "@/lib/constants";
import type { NavItem } from "@/lib/constants";
import { g } from "@/lib/theme";
import Logo from "./Logo";
import { useSettings, ACCENT_PRESETS } from "@/lib/settings";
import { StarFilled, StarOutline, Gear } from "@/components/Icons";
import { useTenant } from "@/lib/tenant-context";
import { createBrowserSupabase } from "@/lib/supabase-browser";

// ── Nav order persistence ─────────────────────────────────────────────────────

const NAV_STATE_KEY = "vevey_nav_state_v2";
const SIDEBAR_COLLAPSED_KEY = "vevey_sidebar_collapsed_v1";

type NavState = {
  favs: string[];
  rest: string[];
};

type FlatItem = NavItem & { group: string };


function flattenNav(features?: Record<string, boolean>): FlatItem[] {
  return NAV.flatMap((grp) =>
    grp.items
      .filter((item) => !item.featureKey || features?.[item.featureKey] === true)
      .map((item) => ({ ...item, group: grp.group }))
  );
}

function defaultNavState(features?: Record<string, boolean>): NavState {
  return { favs: [], rest: flattenNav(features).map((i) => i.href) };
}

function loadNavState(features?: Record<string, boolean>): NavState {
  if (typeof window === "undefined") return defaultNavState(features);
  try {
    const raw = localStorage.getItem(NAV_STATE_KEY);
    if (!raw) return defaultNavState(features);
    const saved: NavState = JSON.parse(raw);
    const all = flattenNav(features).map((i) => i.href);
    const validFavs = saved.favs.filter((h) => all.includes(h));
    const validRest = saved.rest.filter((h) => all.includes(h));
    const known = new Set([...validFavs, ...validRest]);
    const fresh = all.filter((h) => !known.has(h));
    return { favs: validFavs, rest: [...validRest, ...fresh] };
  } catch {
    return defaultNavState();
  }
}

function saveNavState(s: NavState) {
  try { localStorage.setItem(NAV_STATE_KEY, JSON.stringify(s)); } catch {}
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
};

function DraggableSection({
  items, isFavSection, isActive, onToggleFav, onReorder, onNavigate, accent, compact,
}: SectionProps) {
  const [dropAt, setDropAt]   = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const dragIdx               = useRef<number | null>(null);

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
      <div style={{ padding: "5px 10px 8px", fontSize: 11, color: "#3a5166", fontStyle: "italic" }}>
        Hover an item below · click <StarOutline size={10} color="#f6b23c" /> to pin
      </div>
    );
  }

  const py = compact ? "6px" : "8px";

  return (
    <div onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      {items.map((item, idx) => {
        const on         = isActive(item.href);
        const isDragging = dragIdx.current === idx;
        const showHover  = hovered === idx;

        return (
          <div
            key={item.href}
            draggable
            onDragStart={(e) => onDragStart(e, idx)}
            onDragOver={(e) => onDragOver(e, idx)}
            onDragEnd={onDragEnd}
            onMouseEnter={() => setHovered(idx)}
            onMouseLeave={() => setHovered(null)}
          >
            {dropAt === idx && <DropLine accent={accent} />}

            <Link
              href={item.href}
              onClick={onNavigate}
              style={{
                display: "flex", alignItems: "center", gap: 9,
                padding: `${py} 10px`,
                borderRadius: 8, fontSize: 13, marginBottom: 1,
                color: on ? "#fff" : "#cdd8e6",
                background: on ? accent : "transparent",
                opacity: isDragging ? 0.35 : 1,
                textDecoration: "none",
                userSelect: "none",
                transition: "background 0.12s",
                cursor: "default",
              }}
            >
              <span style={{ width: 16, textAlign: "center", fontSize: 14, flexShrink: 0 }}>
                {item.icon}
              </span>
              <span style={{ flex: 1 }}>{item.label}</span>
              {(isFavSection || showHover) && (
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
              <span style={{
                fontSize: 14, flexShrink: 0, cursor: "grab", lineHeight: 1,
                color: showHover ? "rgba(255,255,255,.3)" : "transparent",
                transition: "color 0.1s",
              }}>⠿</span>
            </Link>
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
        color: active ? "#fff" : "#aebccd",
        background: active ? accent : "transparent",
        textDecoration: "none", fontSize: 15,
      }}
    >
      {item.icon}
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
      borderBottom: "1px solid rgba(255,255,255,.07)",
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
            fontSize: 11, color: "#8aa0b8",
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
          color: "#4a6070", cursor: "pointer",
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
  const pathname = usePathname();
  const { settings } = useSettings();
  const tenant = useTenant();

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

  const [navState, setNavState] = useState<NavState>(() => defaultNavState(features));
  useEffect(() => { setNavState(loadNavState(features)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const allMap  = new Map(flattenNav(features).map((i) => [i.href, i]));
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
      background: g.sidebar,
      flexShrink: 0,
      padding: collapsed ? "16px 8px" : "16px 12px",
      color: "#aebccd",
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
        borderBottom: "1px solid rgba(255,255,255,.08)",
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
              <div style={{ fontWeight: 600, color: "#fff", fontSize: 14 }}>
                {tenant?.name ?? <span>Vevey<span style={{ color: "#7fb4ec" }}>CRM</span></span>}
              </div>
              <div style={{
                fontSize: 11, color: "#8aa0b8",
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
              background: "rgba(255,255,255,.06)", border: "none",
              color: "#8aa0b8", cursor: "pointer", fontSize: 11, lineHeight: 1,
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
            background: "rgba(255,255,255,.06)", border: "none",
            color: "#8aa0b8", cursor: "pointer", fontSize: 11, lineHeight: 1,
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
          <div style={{ borderTop: "1px solid rgba(255,255,255,.08)", margin: "8px 4px" }} />
          <Link
            href={ROUTES.settings}
            onClick={onNavigate}
            title="Settings"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 36, height: 36, margin: "0 auto", borderRadius: 8,
              background: isActive(ROUTES.settings) ? accent : "transparent",
              textDecoration: "none",
            }}
          >
            <Gear size={14} color={isActive(ROUTES.settings) ? "#fff" : "#9db3c4"} />
          </Link>
        </nav>
      ) : (
      <nav>
        {/* Favourites */}
        <div style={{
          fontSize: 9.5, letterSpacing: 1.1, fontWeight: 700,
          color: "#f6b23c", paddingLeft: 10, marginBottom: 3,
        }}>
          <StarFilled size={9} color="#f6b23c" style={{ marginRight: 4 }} /> FAVOURITES
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
        />

        {/* Divider */}
        <div style={{ borderTop: "1px solid rgba(255,255,255,.08)", margin: "10px 4px" }} />

        {/* All items */}
        <div style={{
          fontSize: 9.5, letterSpacing: 1.1, fontWeight: 600,
          color: "#7a9ab8", paddingLeft: 10, marginBottom: 3,
        }}>
          ALL · drag · <StarOutline size={9} color="#7a9ab8" /> to pin
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
        />

        {/* Settings link + reset */}
        <div style={{ borderTop: "1px solid rgba(255,255,255,.06)", marginTop: 10, paddingTop: 8 }}>
          <Link
            href={ROUTES.settings}
            onClick={onNavigate}
            style={{
              display: "flex", alignItems: "center", gap: 8, width: "100%",
              padding: "7px 10px", borderRadius: 8, fontSize: 12.5,
              color: isActive(ROUTES.settings) ? "#dce9f6" : "#cdd8e6",
              background: isActive(ROUTES.settings) ? accent : "transparent",
              textDecoration: "none",
              transition: "background 0.12s",
            }}
          >
            <Gear size={14} color={isActive(ROUTES.settings) ? "#fff" : "#9db3c4"} />
            <span>Settings</span>
          </Link>
          <button
            onClick={resetNav}
            style={{
              background: "transparent", border: "none",
              color: "#7a9ab8", fontSize: 11, cursor: "pointer",
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
