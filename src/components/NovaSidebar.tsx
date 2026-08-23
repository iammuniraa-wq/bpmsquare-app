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

function openPalette() {
  window.dispatchEvent(new CustomEvent("nova:open-palette"));
}

function ProgressRing({ percent, color }: { percent: number; color: string }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.min(100, Math.max(0, percent)) / 100);
  return (
    <svg width={36} height={36} viewBox="0 0 36 36" style={{ flexShrink: 0, transform: "rotate(-90deg)" }}>
      <circle cx={18} cy={18} r={r} fill="none" stroke="var(--nova-line)" strokeWidth={3} />
      <circle
        cx={18} cy={18} r={r} fill="none" stroke={color} strokeWidth={3}
        strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
        style={{ transition: "stroke-dashoffset .4s ease" }}
      />
      <text x={18} y={18} textAnchor="middle" dominantBaseline="central" fontSize={10} fill={color} transform="rotate(90 18 18)" fontWeight={700}>
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
 */
export default function NovaSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const tenant = useTenant();
  const viewable = useViewableWorkcenters();
  const isWfmSupervisor = useIsWfmSupervisor();
  const [items, setItems] = useState<NovaStreamItem[]>([]);
  const [flows, setFlows] = useState<NovaFlow[]>([]);
  const [loaded, setLoaded] = useState(false);

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

  return (
    <div style={{ width: 264, flexShrink: 0, height: "100%", position: "sticky", top: 0, background: "var(--nova-bg)", borderRight: "1px solid var(--nova-line)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <style>{`
        @keyframes nova-sb-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
        .nova-sb-live-dot { animation: nova-sb-blink 1.6s ease-in-out infinite; }
        .nova-sb-row { transition: background .15s ease; }
        .nova-sb-row:hover { background: rgba(255,255,255,0.06); }
        .nova-sb-space { transition: background .15s ease, transform .15s ease; }
        .nova-sb-space:hover { background: rgba(255,255,255,0.09); transform: translateY(-1px); }
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

      <div style={{ flex: 1, overflowY: "auto", padding: "8px 0 16px" }}>
        {/* Needs You Now */}
        {items.length > 0 && (
          <div style={{ padding: "12px 16px 4px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <span className="nova-sb-live-dot" style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--nova-orange-soft)" }} />
              <span style={{ fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--nova-ink-faint)", flex: 1 }}>Needs you now</span>
              <span style={{ fontSize: 10, color: "var(--nova-ink-faint)" }}>live</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {items.slice(0, 4).map((it) => (
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
        {flows.length > 0 && (
          <div style={{ padding: "16px 16px 4px" }}>
            <div style={{ fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--nova-ink-faint)", marginBottom: 8 }}>Flows</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {flows.map((f) => (
                <Link key={f.id} href={f.href} onClick={onNavigate} className="nova-sb-row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: 8, textDecoration: "none", color: "inherit" }}>
                  <ProgressRing percent={f.percent} color={FLOW_COLOR[f.id]} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, color: "var(--nova-ink)" }}>{f.label}</div>
                    <div style={{ fontSize: 10.5, color: "var(--nova-ink-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.detail}</div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Spaces */}
      <div style={{ borderTop: "1px solid var(--nova-line-soft)", padding: "12px 16px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--nova-ink-faint)" }}>Spaces</span>
          <span style={{ fontSize: 9.5, color: "var(--nova-ink-faint)" }}>hover to identify</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 6 }}>
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
                  border: "1px solid var(--nova-glass-border)", textDecoration: "none",
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
    </div>
  );
}
