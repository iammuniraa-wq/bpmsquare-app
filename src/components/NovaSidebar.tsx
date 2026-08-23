"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTenant, useViewableWorkcenters, useIsWfmSupervisor } from "@/lib/tenant-context";
import type { NovaStreamItem } from "@/lib/nova/stream";
import type { NovaFlow } from "@/lib/nova/flows";
import { buildSpaces, spaceForHref, type SpaceItem } from "@/lib/nova/spaces";

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
 *  - Needs You Now: the same real signals getNovaStreamItems() computes for
 *    the Stream home screen, just always-visible instead of home-only.
 *  - Flows: 4 outcome trackers (getNovaFlows()) with a real, explainable
 *    percent -- never an invented AI confidence score.
 *  - Spaces: every module the tenant/user can actually open, as an icon
 *    grid instead of an expandable tree -- same gating Sidebar.tsx already
 *    enforces (feature flags, workcenter visibility, WFM supervisor-only).
 *
 * Each section's header carries an expand toggle: maximizing one fills the
 * whole rail with it (more rows, bigger Spaces grid) and hides the other
 * two; toggling again (or the same button, now a "restore" glyph) returns
 * to the normal three-section view.
 */
export default function NovaSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const tenant = useTenant();
  const viewable = useViewableWorkcenters();
  const isWfmSupervisor = useIsWfmSupervisor();
  const [items, setItems] = useState<NovaStreamItem[]>([]);
  const [flows, setFlows] = useState<NovaFlow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [maximized, setMaximized] = useState<Section | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/nova/nav")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setItems(data.items ?? []);
        setFlows(data.flows ?? []);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  const features = (tenant?.features ?? {}) as Record<string, boolean>;
  const spaces: SpaceItem[] = buildSpaces(features, viewable, isWfmSupervisor);
  const attentionSpaces = new Set(items.map((it) => spaceForHref(it.href, spaces)).filter((h): h is string => h !== null));

  function toggle(section: Section) {
    setMaximized((cur) => (cur === section ? null : section));
  }

  const showNeeds = maximized === null || maximized === "needs";
  const showFlows = maximized === null || maximized === "flows";
  const showSpaces = maximized === null || maximized === "spaces";

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

      {/* Header */}
      <div style={{ padding: "16px 16px 12px", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid var(--nova-line-soft)" }}>
        <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--nova-gradient)", flexShrink: 0, boxShadow: "0 0 12px rgba(255,107,53,0.4)" }} />
        <div style={{ minWidth: 0 }}>
          <div className="nova-display" style={{ fontSize: 15 }}>Nova</div>
          <div style={{ fontSize: 11, color: "var(--nova-ink-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {loaded ? `${items.length} need${items.length === 1 ? "s" : ""} you` : "…"}
          </div>
        </div>
      </div>

      {/* Command bar */}
      <div style={{ padding: "12px 16px 4px" }}>
        <button
          type="button"
          onClick={openPalette}
          style={{
            width: "100%", display: "flex", alignItems: "center", gap: 8,
            background: "var(--nova-glass-bg)", border: "1px solid var(--nova-glass-border)",
            borderRadius: 8, padding: "8px 10px", cursor: "pointer", textAlign: "left",
            fontFamily: "var(--nova-font-body)", fontSize: 12.5, color: "var(--nova-ink-faint)",
          }}
        >
          Ask or act…
          <span style={{ marginLeft: "auto", fontSize: 10, background: "rgba(255,255,255,0.06)", borderRadius: 5, padding: "2px 6px", flexShrink: 0 }}>⌘K</span>
        </button>
      </div>

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

      {/* Spaces */}
      {showSpaces && (
        <div style={{ borderTop: "1px solid var(--nova-line-soft)", padding: "12px 16px 16px", display: "flex", flexDirection: "column", flex: maximized === "spaces" ? 1 : undefined, minHeight: maximized === "spaces" ? 0 : undefined, overflowY: maximized === "spaces" ? "auto" : undefined }}>
          <SectionHead
            label="Spaces"
            section="spaces"
            maximized={maximized}
            onToggle={toggle}
            right={maximized !== "spaces" && <span style={{ fontSize: 9.5, color: "var(--nova-ink-faint)" }}>hover to identify</span>}
          />
          <div style={{ display: "grid", gridTemplateColumns: maximized === "spaces" ? "repeat(4, 1fr)" : "repeat(6, 1fr)", gap: maximized === "spaces" ? 10 : 6 }}>
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
                    position: "relative", display: "flex", flexDirection: maximized === "spaces" ? "column" : "row", alignItems: "center", justifyContent: "center", gap: maximized === "spaces" ? 6 : 0,
                    aspectRatio: maximized === "spaces" ? undefined : "1", padding: maximized === "spaces" ? "14px 6px" : 0,
                    borderRadius: 8, background: active ? "var(--nova-glass-border)" : "var(--nova-glass-bg)",
                    border: "1px solid var(--nova-glass-border)", textDecoration: "none",
                  }}
                >
                  <Icon size={maximized === "spaces" ? 18 : 15} color={active ? "var(--nova-ink)" : "var(--nova-ink-dim)"} />
                  {maximized === "spaces" && (
                    <span style={{ fontSize: 10.5, color: "var(--nova-ink-dim)", textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>{s.label}</span>
                  )}
                  {hasAttention && (
                    <span style={{ position: "absolute", top: 3, right: 3, width: 5, height: 5, borderRadius: "50%", background: "var(--nova-orange-soft)" }} />
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
