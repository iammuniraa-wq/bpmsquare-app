"use client";

import Link from "next/link";
import { ROUTES, type TenantFeatures } from "@/lib/constants";
import type { NovaStreamItem, NovaWinItem } from "@/lib/nova/stream";
import { Package, Activity as ActivityIcon, Users, FileText, CheckIcon } from "@/components/Icons";

const ACCENT: Record<NovaStreamItem["accent"], { color: string; bg: string; glow: string }> = {
  orange: { color: "var(--nova-orange-soft)", bg: "var(--nova-orange-bg)", glow: "rgba(255,107,53,0.22)" },
  pink:   { color: "var(--nova-pink-soft)",   bg: "var(--nova-pink-bg)",   glow: "rgba(232,67,147,0.22)" },
  purple: { color: "var(--nova-purple-softer)", bg: "var(--nova-purple-bg)", glow: "rgba(155,89,245,0.22)" },
  teal:   { color: "var(--nova-teal-soft)",   bg: "var(--nova-teal-bg)",   glow: "rgba(20,200,180,0.22)" },
};

const CTA_LABEL: Record<NovaStreamItem["kind"], string> = {
  quote_pending: "Follow up",
  contract_lapsing: "Renew",
  product_unquoted: "Quote it",
  wfm_approval: "Review",
};

type Kpis = {
  openPipeline: number;
  openCases: number;
  activeContracts: number;
  overdueCount: number;
  overdueTotal: number;
};

const money = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

function openPalette() {
  window.dispatchEvent(new CustomEvent("nova:open-palette"));
}

export default function NovaStream({
  items,
  wins,
  userName,
  greeting,
  dateLabel,
  kpis,
  features,
}: {
  items: NovaStreamItem[];
  wins: NovaWinItem[];
  userName: string | null;
  greeting: string;
  dateLabel: string;
  kpis: Kpis;
  features: TenantFeatures;
}) {
  const name = userName ? `, ${userName}` : "";

  const statTiles: { label: string; value: string; accent: NovaStreamItem["accent"] }[] = [
    { label: "Open pipeline", value: money(kpis.openPipeline), accent: "orange" },
    { label: "Open cases", value: String(kpis.openCases), accent: "teal" },
    { label: "Active AMC", value: String(kpis.activeContracts), accent: "purple" },
    {
      label: "Overdue",
      value: kpis.overdueCount > 0 ? `${money(kpis.overdueTotal)} · ${kpis.overdueCount}` : "Nothing",
      accent: "pink",
    },
  ];

  const quickActions: { href: string; label: string; icon: React.ReactNode; accent: NovaStreamItem["accent"] }[] = [
    { href: ROUTES.quotationNew, label: "New quote", icon: <Package size={14} />, accent: "orange" },
    { href: ROUTES.caseNew, label: "New case", icon: <ActivityIcon size={14} />, accent: "teal" },
    { href: ROUTES.accountNew, label: "New account", icon: <Users size={14} />, accent: "purple" },
    ...(features?.invoices ? [{ href: ROUTES.invoiceNew, label: "New invoice", icon: <FileText size={14} />, accent: "pink" as const }] : []),
  ];

  return (
    <div style={{ flex: 1, padding: "48px 24px 80px", maxWidth: 860, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
      <style>{`
        @keyframes nova-stream-pulse {
          0%, 100% { box-shadow: 0 0 0 rgba(232,67,147,0); }
          50% { box-shadow: 0 0 26px rgba(232,67,147,0.18); }
        }
        .nova-command-bar { animation: nova-stream-pulse 5s ease-in-out infinite; transition: border-color .2s ease, background .2s ease; }
        .nova-command-bar:hover { background: rgba(255,255,255,0.07); border-color: rgba(232,67,147,0.55) !important; }
        .nova-stat-tile, .nova-action-card, .nova-quick-action, .nova-win-chip {
          transition: transform .15s ease, box-shadow .15s ease, background .15s ease;
        }
        .nova-stat-tile:hover { transform: translateY(-2px); }
        .nova-action-card:hover { background: rgba(255,255,255,0.075); transform: translateX(2px); }
        .nova-quick-action:hover { background: rgba(255,255,255,0.09); transform: translateY(-1px); }
        .nova-win-chip:hover { background: rgba(255,255,255,0.08); }
        @media (prefers-reduced-motion: reduce) {
          .nova-command-bar { animation: none !important; }
          .nova-stat-tile:hover, .nova-action-card:hover, .nova-quick-action:hover { transform: none !important; }
        }
        @media (max-width: 640px) {
          .nova-stat-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
      `}</style>

      <div style={{ marginBottom: 8, fontSize: 13, color: "var(--nova-ink-faint)" }}>{dateLabel}</div>
      <h1 className="nova-display" style={{ fontSize: 34, margin: "0 0 6px" }}>
        {greeting}{name}.
      </h1>
      <p style={{ fontSize: 15, fontWeight: 300, color: "var(--nova-ink-dim)", margin: "0 0 24px", maxWidth: 560 }}>
        Your stream is ranked by what needs you most — overdue follow-ups, lapsing renewals, and approvals waiting on
        your call.
      </p>

      {/* ── Command bar ── */}
      <button
        type="button"
        onClick={openPalette}
        className="nova-command-bar"
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 12,
          background: "var(--nova-glass-bg)",
          border: "1px solid rgba(232,67,147,0.35)",
          borderRadius: 12,
          padding: "13px 16px",
          marginBottom: 28,
          cursor: "pointer",
          textAlign: "left",
          fontFamily: "var(--nova-font-body)",
        }}
      >
        <span style={{ fontSize: 14, color: "var(--nova-pink-soft)", opacity: 0.8 }}>⌘</span>
        <span style={{ flex: 1, fontSize: 13.5, color: "var(--nova-ink-faint)" }}>
          Ask Nova anything — try &quot;prep me for my next call with Vertex Industrial&quot;
        </span>
        <span style={{ fontSize: 11, color: "var(--nova-ink-faint)", background: "rgba(255,255,255,0.06)", borderRadius: 6, padding: "3px 8px", flexShrink: 0 }}>
          ⌘K
        </span>
      </button>

      {/* ── KPI strip ── */}
      <div className="nova-stat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 20 }}>
        {statTiles.map((tile) => {
          const accent = ACCENT[tile.accent];
          return (
            <div
              key={tile.label}
              className="nova-stat-tile"
              style={{
                background: "var(--nova-glass-bg)",
                border: "1px solid var(--nova-glass-border)",
                borderRadius: 12,
                padding: "14px 14px",
                boxShadow: `0 0 20px ${accent.glow}`,
              }}
            >
              <div className="nova-display" style={{ fontSize: 18, color: accent.color }}>{tile.value}</div>
              <div style={{ fontSize: 11, color: "var(--nova-ink-faint)", marginTop: 3 }}>{tile.label}</div>
            </div>
          );
        })}
      </div>

      {/* ── Quick actions ── */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 28 }}>
        {quickActions.map((a) => {
          const accent = ACCENT[a.accent];
          return (
            <Link
              key={a.href}
              href={a.href}
              className="nova-quick-action"
              style={{
                display: "flex", alignItems: "center", gap: 7,
                fontSize: 12.5, fontWeight: 500, color: accent.color,
                background: accent.bg, border: "1px solid var(--nova-glass-border)",
                borderRadius: "var(--nova-radius-pill)", padding: "8px 14px 8px 12px",
                textDecoration: "none",
              }}
            >
              {a.icon}
              {a.label}
            </Link>
          );
        })}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <span style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--nova-ink-faint)" }}>
          Predictive action stream
        </span>
        <span style={{ fontSize: 11, color: "var(--nova-teal-soft)", background: "var(--nova-teal-bg)", borderRadius: "var(--nova-radius-pill)", padding: "3px 10px", whiteSpace: "nowrap" }}>
          {items.length} pending
        </span>
      </div>

      {items.length === 0 ? (
        <div style={{ border: "1px solid var(--nova-line)", borderRadius: "var(--nova-radius-card)", padding: "28px 20px", textAlign: "center", color: "var(--nova-ink-dim)", fontSize: 14 }}>
          You&apos;re all caught up. Nothing is waiting on you right now.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {items.map((item) => {
            const accent = ACCENT[item.accent];
            return (
              <Link
                key={item.id}
                href={item.href}
                className="nova-action-card"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  background: "var(--nova-glass-bg)",
                  border: "1px solid var(--nova-glass-border)",
                  borderLeft: `2.5px solid ${accent.color}`,
                  borderRadius: 12,
                  padding: "13px 16px",
                  textDecoration: "none",
                  color: "inherit",
                  boxShadow: `0 0 18px ${accent.glow}`,
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: accent.color,
                    background: accent.bg,
                    borderRadius: 6,
                    padding: "3px 8px",
                    minWidth: 22,
                    textAlign: "center",
                    flexShrink: 0,
                  }}
                >
                  {item.score}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: "var(--nova-ink)", opacity: 0.88, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.title}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--nova-ink-faint)", marginTop: 2 }}>{item.detail}</div>
                </div>
                <span style={{ fontSize: 12, color: accent.color, flexShrink: 0 }}>{CTA_LABEL[item.kind]} →</span>
              </Link>
            );
          })}
        </div>
      )}

      {/* ── Recent wins ── */}
      {wins.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--nova-ink-faint)", marginBottom: 12 }}>
            Recent wins
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {wins.map((w) => (
              <Link
                key={w.id}
                href={w.href}
                className="nova-win-chip"
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  background: "var(--nova-teal-bg)", border: "1px solid rgba(20,200,180,0.35)",
                  borderRadius: "var(--nova-radius-pill)", padding: "7px 14px 7px 10px",
                  textDecoration: "none", color: "inherit", fontSize: 12.5,
                }}
              >
                <CheckIcon size={13} color="var(--nova-teal-soft)" />
                <span style={{ color: "var(--nova-ink)" }}>{w.title}</span>
                <span style={{ color: "var(--nova-ink-faint)" }}>· {w.detail}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
