"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTenant, useViewableWorkcenters, useIsWfmSupervisor } from "@/lib/tenant-context";
import type { NovaStreamItem } from "@/lib/nova/stream";
import type { NovaFlow } from "@/lib/nova/flows";
import { buildSpaces, spaceForHref, type SpaceItem } from "@/lib/nova/spaces";
import { readNovaNavCache, fetchNovaNav } from "@/lib/nova/navClient";
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
export default function NovaSidebar({ onNavigate, showSpaces = false }: { onNavigate?: () => void; showSpaces?: boolean }) {
  const pathname = usePathname();
  const tenant = useTenant();
  const viewable = useViewableWorkcenters();
  const isWfmSupervisor = useIsWfmSupervisor();
  const [items, setItems] = useState<NovaStreamItem[]>([]);
  const [flows, setFlows] = useState<NovaFlow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [maximized, setMaximized] = useState<Section | null>(null);

  // Cache-first, then one shared network refresh (deduped with
  // NovaSpacesBar via navClient) -- the sections used to sit empty for the
  // whole cold-function round trip on every hard reload (owner-flagged:
  // "Needs You Now / Flows take time to load").
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

  // The top bar's "browse all modules" button raises this -- same classic
  // sidebar-in-the-rail view the rail's own Spaces maximize toggles.
  useEffect(() => {
    const onBrowseAll = () => setMaximized((cur) => (cur === "spaces" ? null : "spaces"));
    window.addEventListener("nova:browse-all", onBrowseAll);
    return () => window.removeEventListener("nova:browse-all", onBrowseAll);
  }, []);

  const features = (tenant?.features ?? {}) as Record<string, boolean>;
  const spaces: SpaceItem[] = buildSpaces(features, viewable, isWfmSupervisor);
  const attentionSpaces = new Set(items.map((it) => spaceForHref(it.href, spaces)).filter((h): h is string => h !== null));
  // 6 columns x 2 rows fits without scrolling; a tenant with more modules
  // than that scrolls the grid itself instead of it growing unbounded.
  const spacesScrollable = spaces.length > 12;

  function toggle(section: Section) {
    setMaximized((cur) => (cur === section ? null : section));
  }

  const showNeeds = maximized === null || maximized === "needs";
  const showFlows = maximized === null || maximized === "flows";
  // Desktop moved Spaces categories into the top bar (NovaSpacesBar); the
  // compact grid only renders inside the mobile drawer (showSpaces), where
  // there's no header row to hold them.
  const showSpacesRow = showSpaces && maximized === null;
  const spacesMaximized = maximized === "spaces";

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
        .nova-sb-space:hover { background: rgba(255,255,255,0.09); transform: translateY(-1px); }
        .nova-sb-expand:hover { background: rgba(255,255,255,0.08); color: var(--nova-ink) !important; }
        @media (prefers-reduced-motion: reduce) {
          .nova-sb-live-dot { animation: none !important; }
          .nova-sb-space:hover { transform: none !important; }
        }
      `}</style>

      <NovaHeader loaded={loaded} needCount={items.length} />
      <NovaCommandBar />

      {/* Spaces -- compact icon row, now first */}
      {showSpacesRow && spaces.length > 0 && (
        <div style={{ padding: "4px 16px 12px", borderBottom: "1px solid var(--nova-line-soft)" }}>
          <SectionHead
            label="Spaces"
            section="spaces"
            maximized={maximized}
            onToggle={toggle}
            right={
              <span style={{ fontSize: 9.5, color: "var(--nova-ink-faint)" }}>
                {spacesScrollable ? `${spaces.length} · scroll for more` : "hover to identify"}
              </span>
            }
          />
          {/* Capped to 2 rows so a tenant with many modules doesn't push
              Needs/Flows halfway down the rail -- scrolls internally past
              that instead of growing the section indefinitely. */}
          <div
            className={spacesScrollable ? "nova-sb-spaces-scroll" : undefined}
            style={{
              display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 6,
              ...(spacesScrollable ? { maxHeight: 76, overflowY: "auto", paddingRight: 2 } : {}),
            }}
          >
            {spaces.map((s) => {
              const Icon = s.icon;
              const active = pathname === s.href || pathname.startsWith(s.href + "/");
              const hasAttention = attentionSpaces.has(s.href);
              return (
                <Link
                  key={s.href}
                  href={s.href}
                  onClick={onNavigate}
                  title={s.label}
                  className="nova-sb-space"
                  style={{
                    position: "relative", aspectRatio: "1", display: "flex", alignItems: "center", justifyContent: "center",
                    borderRadius: 8, background: active ? "var(--nova-glass-border)" : "var(--nova-glass-bg)",
                    border: "1px solid var(--nova-glass-border)", textDecoration: "none", minWidth: 0,
                  }}
                >
                  <Icon size={15} color={active ? "var(--nova-ink)" : "var(--nova-ink-dim)"} />
                  {hasAttention && (
                    <span style={{ position: "absolute", top: 3, right: 3, width: 5, height: 5, borderRadius: "50%", background: "var(--nova-orange-soft)" }} />
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      )}

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
