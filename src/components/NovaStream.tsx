"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ROUTES, type TenantFeatures, type DashLayoutItem } from "@/lib/constants";
import type { NovaWinItem } from "@/lib/nova/stream";
import type { NovaRankings, NovaRankingRow } from "@/lib/nova/rankings";
import type { AnalyticsData } from "@/lib/data/labels";
import { Package, Activity as ActivityIcon, Users, FileText, CheckIcon } from "@/components/Icons";
import { renderWidget } from "@/components/DashboardLayout";
import { isAnalyticsId } from "@/lib/analyticsMeta";
import { isNovaNativeId, type NovaBlockId } from "@/lib/nova/streamLayout";
import { listCachedMarketIntel } from "@/lib/nova/marketIntelClient";
import NovaAdaptDrawer from "@/components/NovaAdaptDrawer";

const SIGNAL_TONE_COLOR: Record<"positive" | "neutral" | "risk", string> = {
  positive: "var(--nova-teal-soft)", neutral: "var(--nova-ink-faint)", risk: "var(--nova-orange-soft)",
};

// Rollup of whatever Market Signals this tab has already fetched per-account
// (see NovaAccountMarketSignals) -- purely client-cache, no server props, so
// it's its own small component rather than a prop threaded through the page.
function NovaMarketSignalsBlock() {
  const [entries, setEntries] = useState<ReturnType<typeof listCachedMarketIntel>>([]);
  useEffect(() => { setEntries(listCachedMarketIntel()); }, []);

  if (entries.length === 0) {
    return (
      <div>
        <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--nova-ink-faint)", marginBottom: 12 }}>Market signals</div>
        <div style={{ border: "1px dashed var(--nova-glass-border)", borderRadius: "var(--nova-radius-card)", padding: "16px 18px", fontSize: 12.5, color: "var(--nova-ink-faint)" }}>
          Open an account and check its Market signals to see real news, funding and leadership changes roll up here.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--nova-ink-faint)", marginBottom: 12 }}>Market signals</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {entries.slice(0, 4).map((e) => {
          const top = e.data.signals[0];
          return (
            <Link key={e.accountId} href={ROUTES.account(e.accountId)} className="nova-rank-row" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: "inherit", background: "var(--nova-glass-bg)", border: "1px solid var(--nova-glass-border)", borderRadius: 10, padding: "10px 14px" }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12.5, color: "var(--nova-ink)", fontWeight: 500 }}>{e.accountName}</div>
                <div style={{ fontSize: 11.5, color: top ? SIGNAL_TONE_COLOR[top.tone] : "var(--nova-ink-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {top ? top.headline : "No notable signals found"}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

type Accent = "orange" | "pink" | "purple" | "teal";

const ACCENT: Record<Accent, { color: string; bg: string; glow: string }> = {
  orange: { color: "var(--nova-orange-soft)", bg: "var(--nova-orange-bg)", glow: "rgba(255,107,53,0.22)" },
  pink:   { color: "var(--nova-pink-soft)",   bg: "var(--nova-pink-bg)",   glow: "rgba(232,67,147,0.22)" },
  purple: { color: "var(--nova-purple-softer)", bg: "var(--nova-purple-bg)", glow: "rgba(155,89,245,0.22)" },
  teal:   { color: "var(--nova-teal-soft)",   bg: "var(--nova-teal-bg)",   glow: "rgba(20,200,180,0.22)" },
};

type Kpis = {
  openPipeline: number;
  openCases: number;
  activeContracts: number;
  overdueCount: number;
  overdueTotal: number;
};

const money = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

// Only analytics widgets are individually resizable -- Nova's own 4 native
// sections (KPI strip, quick actions, rankings, wins) are each a compound,
// multi-item row designed to read at full width; there's no "compact"/"half"
// rendering for them the way a single-stat analytics widget has. Mirrors
// classic dashboard's SIZE_FLEX (DashboardLayout.tsx) so a tile at a given
// size occupies the same proportion of the row either place.
const NOVA_SIZE_FLEX: Record<"compact" | "half" | "full", React.CSSProperties> = {
  compact: { flex: "1 1 240px", minWidth: 200, maxWidth: 520 },
  half:    { flex: "1 1 calc(50% - 10px)", minWidth: 260 },
  full:    { flex: "1 1 100%", minWidth: 0 },
};
function blockDisplaySize(block: DashLayoutItem): "compact" | "half" | "full" {
  return block.size ?? "full";
}

function openPalette() {
  window.dispatchEvent(new CustomEvent("nova:open-palette"));
}

export default function NovaStream({
  rankings,
  wins,
  userName,
  greeting,
  dateLabel,
  kpis,
  features,
  analytics,
  dashLayout,
  isAdmin,
  hasPersonalOverride,
}: {
  rankings: NovaRankings;
  wins: NovaWinItem[];
  userName: string | null;
  greeting: string;
  dateLabel: string;
  kpis: Kpis;
  features: TenantFeatures;
  analytics: AnalyticsData | null;
  dashLayout: DashLayoutItem[];
  isAdmin: boolean;
  hasPersonalOverride: boolean;
}) {
  const router = useRouter();
  const name = userName ? `, ${userName}` : "";
  const [layout, setLayout] = useState<DashLayoutItem[]>(dashLayout);
  const [adaptOpen, setAdaptOpen] = useState(false);
  const [personalizeOpen, setPersonalizeOpen] = useState(false);
  const [saving, startSave] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);

  function persistLayout(next: DashLayoutItem[], url: string, body: unknown) {
    const prev = layout;
    setLayout(next);
    setSaveError(null);
    startSave(async () => {
      try {
        const res = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (!res.ok) {
          const j = await res.json().catch(() => ({} as { error?: string }));
          setLayout(prev);
          setSaveError(res.status === 401 ? "Your session has expired — reload and sign in again." : `Could not save (${j?.error ?? res.status}).`);
          return;
        }
        router.refresh();
      } catch {
        setLayout(prev);
        setSaveError("Could not reach the server — the layout was not saved.");
      }
    });
  }
  function saveTenantLayout(next: DashLayoutItem[]) {
    persistLayout(next, "/api/settings/entities", { dashboard_layout: next });
  }
  function savePersonalLayout(next: DashLayoutItem[]) {
    persistLayout(next, "/api/dashboard/layout", { layout: next });
  }
  function resetPersonalLayout() {
    setPersonalizeOpen(false);
    startSave(async () => {
      await fetch("/api/dashboard/layout", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ layout: null }) });
      router.refresh();
    });
  }

  const visibleBlocks = layout.filter((b) => !b.hidden);

  const statTiles: { label: string; value: string; accent: Accent }[] = [
    { label: "Open pipeline", value: money(kpis.openPipeline), accent: "orange" },
    { label: "Open cases", value: String(kpis.openCases), accent: "teal" },
    { label: "Active AMC", value: String(kpis.activeContracts), accent: "purple" },
    {
      label: "Overdue",
      value: kpis.overdueCount > 0 ? `${money(kpis.overdueTotal)} · ${kpis.overdueCount}` : "Nothing",
      accent: "pink",
    },
  ];

  const quickActions: { href: string; label: string; icon: React.ReactNode; accent: Accent }[] = [
    { href: ROUTES.quotationNew, label: "New quote", icon: <Package size={14} />, accent: "orange" },
    { href: ROUTES.caseNew, label: "New case", icon: <ActivityIcon size={14} />, accent: "teal" },
    { href: ROUTES.accountNew, label: "New account", icon: <Users size={14} />, accent: "purple" },
    ...(features?.invoices ? [{ href: ROUTES.invoiceNew, label: "New invoice", icon: <FileText size={14} />, accent: "pink" as const }] : []),
  ];

  function renderBlock(block: DashLayoutItem): React.ReactNode {
    if (isAnalyticsId(block.id)) {
      if (!analytics) return null;
      // renderWidget is the classic dashboard's own widget renderer, reused
      // as-is (see streamLayout.ts) -- it was never exercised inside a Nova
      // page before, and a saved layout carried over from before this
      // tenant had Nova turned on can surface an id here that classic never
      // hit either. One bad widget must not take the whole Stream down.
      try {
        return <div key={block.id}>{renderWidget(block.id, analytics, blockDisplaySize(block))}</div>;
      } catch (e) {
        console.error(`[NovaStream] widget "${block.id}" failed to render`, e);
        return null;
      }
    }
    switch (block.id as NovaBlockId) {
      case "nova_kpis":
        return (
          <div key={block.id} className="nova-stat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10 }}>
            {statTiles.map((tile) => {
              const accent = ACCENT[tile.accent];
              return (
                <div key={tile.label} className="nova-stat-tile" style={{ background: "var(--nova-glass-bg)", border: "1px solid var(--nova-glass-border)", borderRadius: 12, padding: 14, boxShadow: `0 0 20px ${accent.glow}` }}>
                  <div className="nova-display" style={{ fontSize: 18, color: accent.color }}>{tile.value}</div>
                  <div style={{ fontSize: 11, color: "var(--nova-ink-faint)", marginTop: 3 }}>{tile.label}</div>
                </div>
              );
            })}
          </div>
        );
      case "nova_quick_actions":
        return (
          <div key={block.id} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {quickActions.map((a) => {
              const accent = ACCENT[a.accent];
              return (
                <Link key={a.href} href={a.href} className="nova-quick-action" style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 500, color: accent.color, background: accent.bg, border: "1px solid var(--nova-glass-border)", borderRadius: "var(--nova-radius-pill)", padding: "8px 14px 8px 12px", textDecoration: "none" }}>
                  {a.icon}
                  {a.label}
                </Link>
              );
            })}
          </div>
        );
      case "nova_rankings": {
        const boards: { title: string; rows: NovaRankingRow[]; accent: Accent }[] = [
          { title: "Top customers", rows: rankings.topCustomers, accent: "orange" },
          { title: "Best-selling products", rows: rankings.topProducts, accent: "teal" },
          { title: "Most repaired", rows: rankings.mostRepaired, accent: "purple" },
        ];
        const anyData = boards.some((b) => b.rows.length > 0);
        if (!anyData) return null;
        return (
          <div key={block.id}>
            <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--nova-ink-faint)", marginBottom: 14 }}>Rankings</div>
            <div className="nova-rankings-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}>
              {boards.filter((b) => b.rows.length > 0).map((board) => {
                const accent = ACCENT[board.accent];
                return (
                  <div key={board.title} style={{ background: "var(--nova-glass-bg)", border: "1px solid var(--nova-glass-border)", borderRadius: 12, padding: "14px 16px", boxShadow: `0 0 18px ${accent.glow}` }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: accent.color, marginBottom: 10 }}>{board.title}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {board.rows.map((row, i) => (
                        <Link key={row.id} href={row.href} className="nova-rank-row" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none", color: "inherit", borderRadius: 6, padding: "3px 4px" }}>
                          <span style={{ fontSize: 11, color: "var(--nova-ink-faint)", width: 14, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{i + 1}</span>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 12.5, color: "var(--nova-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.label}</div>
                            <div style={{ fontSize: 11, color: "var(--nova-ink-faint)" }}>{row.detail}</div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      }
      case "nova_recent_wins":
        if (wins.length === 0) return null;
        return (
          <div key={block.id}>
            <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--nova-ink-faint)", marginBottom: 12 }}>Recent wins</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {wins.map((w) => (
                <Link key={w.id} href={w.href} className="nova-win-chip" style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--nova-teal-bg)", border: "1px solid rgba(20,200,180,0.35)", borderRadius: "var(--nova-radius-pill)", padding: "7px 14px 7px 10px", textDecoration: "none", color: "inherit", fontSize: 12.5 }}>
                  <CheckIcon size={13} color="var(--nova-teal-soft)" />
                  <span style={{ color: "var(--nova-ink)" }}>{w.title}</span>
                  <span style={{ color: "var(--nova-ink-faint)" }}>· {w.detail}</span>
                </Link>
              ))}
            </div>
          </div>
        );
      case "nova_market_signals":
        return <NovaMarketSignalsBlock key={block.id} />;
      default:
        return null;
    }
  }

  return (
    // Fluid, not fixed: the old maxWidth 860 was a laptop-sized column that
    // left growing dead margins on every wider screen (owner-flagged
    // 2026-08-23 with red boxes). The Stream now fills the viewport up to a
    // wide ceiling -- 1680 keeps 1fr grid tiles from stretching absurd on a
    // 4K/ultrawide, where truly unbounded rows stop being readable -- with
    // side padding that scales with the viewport ON TOP of the 20px/24px
    // Shell's <main> already puts around every page (which is why the top
    // pad here is small -- 48px before + main's 20 was the dead band under
    // the tab strip). Reading-length text (the subtitle) keeps its own
    // narrow cap; data blocks use the full width.
    <div style={{ flex: 1, padding: "8px clamp(0px, 2vw, 32px) 60px", maxWidth: 1680, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
      <style>{`
        @keyframes nova-stream-pulse {
          0%, 100% { box-shadow: 0 0 0 rgba(232,67,147,0); }
          50% { box-shadow: 0 0 26px rgba(232,67,147,0.18); }
        }
        .nova-command-bar { animation: nova-stream-pulse 5s ease-in-out infinite; transition: border-color .2s ease, background .2s ease; }
        .nova-command-bar:hover { background: rgba(255,255,255,0.07); border-color: rgba(232,67,147,0.55) !important; }
        .nova-stat-tile, .nova-quick-action, .nova-win-chip, .nova-rank-row {
          transition: transform .15s ease, box-shadow .15s ease, background .15s ease;
        }
        .nova-stat-tile:hover { transform: translateY(-2px); }
        .nova-quick-action:hover { background: rgba(255,255,255,0.09); transform: translateY(-1px); }
        .nova-win-chip:hover { background: rgba(255,255,255,0.08); }
        .nova-rank-row:hover { background: rgba(255,255,255,0.06); }
        @media (prefers-reduced-motion: reduce) {
          .nova-command-bar { animation: none !important; }
          .nova-stat-tile:hover, .nova-quick-action:hover { transform: none !important; }
        }
        @media (max-width: 640px) {
          .nova-stat-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .nova-rankings-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
        <div style={{ fontSize: 13, color: "var(--nova-ink-faint)" }}>{dateLabel}</div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          {isAdmin && (
            <button type="button" onClick={() => setAdaptOpen(true)} style={{ fontSize: 11.5, fontWeight: 600, color: "var(--nova-pink-soft)", background: "transparent", border: "1px solid rgba(232,67,147,0.4)", borderRadius: 7, padding: "6px 14px", cursor: "pointer" }}>
                ⚙ Adapt Stream
            </button>
          )}
          <button type="button" onClick={() => setPersonalizeOpen(true)} style={{ fontSize: 11.5, fontWeight: 600, color: "var(--nova-ink-dim)", background: "transparent", border: "1px solid var(--nova-glass-border)", borderRadius: 7, padding: "6px 14px", cursor: "pointer" }}>
            My Stream
          </button>
        </div>
      </div>

      <h1 className="nova-display" style={{ fontSize: "clamp(30px, 2.2vw, 40px)", margin: "0 0 6px" }}>
        {greeting}{name}.
      </h1>
      <p style={{ fontSize: 15, fontWeight: 300, color: "var(--nova-ink-dim)", margin: "0 0 24px", maxWidth: 640 }}>
        What needs you now lives in the rail on the left. Here&apos;s the bigger picture — pipeline health and who&apos;s
        actually driving the business.
      </p>

      {saveError && (
        <div style={{ fontSize: 12, color: "var(--nova-orange-soft)", background: "var(--nova-orange-bg)", border: "1px solid rgba(255,107,53,0.4)", borderRadius: 8, padding: "8px 12px", marginBottom: 16 }}>
          {saveError}
        </div>
      )}

      {/* ── Command bar ── */}
      <button
        type="button"
        onClick={openPalette}
        className="nova-command-bar"
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 12,
          background: "var(--nova-glass-bg)", border: "1px solid rgba(232,67,147,0.35)",
          borderRadius: 12, padding: "13px 16px", marginBottom: 28,
          cursor: "pointer", textAlign: "left", fontFamily: "var(--nova-font-body)",
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

      {isAdmin && hasPersonalOverride && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "var(--nova-ink-dim)", background: "var(--nova-glass-bg)", border: "1px solid var(--nova-glass-border)", borderRadius: 8, padding: "8px 12px", marginBottom: 16 }}>
          <span style={{ flex: 1 }}>
            You have a personal Stream layout — it overrides <strong>Adapt Stream</strong>&apos;s shared default for you, so changes made there won&apos;t visibly change what you see below until you reset it.
          </span>
          <button type="button" onClick={resetPersonalLayout} style={{ flexShrink: 0, fontSize: 11.5, fontWeight: 600, color: "var(--nova-pink-soft)", background: "transparent", border: "1px solid rgba(232,67,147,0.4)", borderRadius: 6, padding: "5px 10px", cursor: "pointer" }}>
            Reset to shared default
          </button>
        </div>
      )}

      {visibleBlocks.length === 0 ? (
        <div style={{ border: "1px solid var(--nova-line)", borderRadius: "var(--nova-radius-card)", padding: "28px 20px", textAlign: "center", color: "var(--nova-ink-dim)", fontSize: 14 }}>
          Your Stream is empty — every widget is hidden. Use <strong>{isAdmin ? "Adapt Stream" : "My Stream"}</strong> above to bring some back.
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start" }}>
          {visibleBlocks.map((block) => {
            const node = renderBlock(block);
            if (!node) return null;
            return (
              <div key={block.id} style={NOVA_SIZE_FLEX[blockDisplaySize(block)]}>
                {node}
              </div>
            );
          })}
        </div>
      )}

      {adaptOpen && (
        <NovaAdaptDrawer
          layout={layout}
          features={features}
          onLayoutChange={saveTenantLayout}
          onClose={() => setAdaptOpen(false)}
          saving={saving}
        />
      )}
      {personalizeOpen && (
        <NovaAdaptDrawer
          layout={layout}
          features={features}
          onLayoutChange={savePersonalLayout}
          onClose={() => setPersonalizeOpen(false)}
          saving={saving}
          title="My Stream"
          subtitle="Personal changes — only you see these"
          onReset={hasPersonalOverride ? resetPersonalLayout : undefined}
          resetLabel="Reset to my default"
        />
      )}
    </div>
  );
}
