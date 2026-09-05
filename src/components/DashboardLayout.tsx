"use client";

import { useState, useTransition, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ServiceCase, Account, WorkOrder, Activity as ActivityRec } from "@/lib/types";
import { c, pillar, type PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { useUiTheme, useIsNextgen3Layer } from "@/lib/tenant-context";
import SilenceDetector from "@/components/SilenceDetector";
import LossIntelligence from "@/components/LossIntelligence";
import WfmSummaryWidget from "@/components/wfm/WfmSummaryWidget";
import { ROUTES } from "@/lib/constants";
import type { AnalyticsMetricId, TenantFeatures, DashLayoutItem } from "@/lib/constants";
import { AlertTriangle, Activity, CheckIcon, Package, Phone, Gear, Globe, Wrench, CalendarCheck, Zap, Clipboard, Battery, FileText, Clock } from "@/components/Icons";
import type { AnalyticsData } from "@/lib/data/labels";
import { ANALYTICS_META, isAnalyticsId } from "@/lib/analyticsMeta";

// ── Types ─────────────────────────────────────────────────────────────────────

type Kpis = {
  openCases: number; inRepair: number; awaitingApproval: number;
  activeContracts: number; openQuoteValue: number; activeWorkOrders: number;
};
type AttentionRow  = { serviceCase: ServiceCase; account: Account | null };
type WorkOrderRow  = { workOrder: WorkOrder; account: Account | null; tech: { name: string } | null };
type ActivityRow   = { activity: ActivityRec; account: Account | null };
type OverdueInvoiceRow = { id: string; ref: string; due_date: string; total: number; paid_amount: number; accountName: string };

interface Props {
  kpis: Kpis;
  attention: AttentionRow[];
  readyCases: AttentionRow[];
  workOrderRows: WorkOrderRow[];
  recentActivity: ActivityRow[];
  overdueInvoices: OverdueInvoiceRow[];
  analytics: AnalyticsData;
  features: TenantFeatures;
  dashLayout: DashLayoutItem[];
  isAdmin: boolean;
  /** True when the current layout came from the caller's own personal
   * override (rather than a role-derived or tenant-wide default) -- shown
   * so the personalize drawer can offer a "reset to my default" action. */
  hasPersonalOverride: boolean;
  /** First name for the greeting ("Good afternoon, Vani"); null = greeting only. */
  userName?: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SIDEBAR_IDS = new Set(["quick_create"]);

// `features` = show when ANY of these module flags is on (0067). Native
// blocks predate the core-module flags and were rendered unconditionally --
// a WFM-only tenant saw pipeline/case/work-order tiles for modules it
// never bought.
const NATIVE_META: Record<string, { label: string; sidebar?: boolean; features?: (keyof TenantFeatures)[] }> = {
  overview_strip:  { label: "Overview", features: ["quotations", "cases", "work_orders", "assets"] },
  revenue_card:    { label: "Revenue", features: ["quotations"] },
  invoice_budget:  { label: "Invoiced vs paid", features: ["invoices"] },
  overdue_tasks:   { label: "Overdue tasks", features: ["accounts", "cases", "quotations", "work_orders"] },
  tech_workload:   { label: "Work orders by technician", features: ["technicians", "work_orders"] },
  top_accounts:    { label: "Top accounts by revenue", features: ["accounts"] },
  quick_create:    { label: "Quick create", sidebar: true, features: ["accounts", "cases", "contacts", "quotations", "assets"] },
  // Not an analytics widget: it fetches /api/wfm/summary itself rather than
  // reading the precomputed analytics payload, which is why it lives here
  // and renders through the native switch below.
  wfm_summary:     { label: "Attendance summary (day + month)", features: ["wfm"] },
};

const DEFAULT_LAYOUT: DashLayoutItem[] = [
  { id: "overview_strip" },
  { id: "revenue_card" },
  { id: "invoice_budget" },
  { id: "overdue_tasks" },
  { id: "tech_workload" },
  { id: "top_accounts" },
  { id: "quick_create" },
];

// Standard per-object starter bundles -- one click adds a sensible combo of
// already-existing blocks (native or analytics) instead of hand-picking each
// one. Sizes are only specified where the block's own default isn't already
// right for the bundle; everything else falls back to blockSize()'s default.
type BundleBlock = { id: string; size?: "compact" | "half" | "full" };
const BUNDLES: { id: string; label: string; feature?: keyof TenantFeatures; blocks: BundleBlock[] }[] = [
  { id: "accounts",     label: "Accounts",      feature: "accounts", blocks: [
    { id: "accounts" }, { id: "accounts_by_type" }, { id: "top_accounts" }, { id: "account_news" },
  ] },
  { id: "contacts",     label: "Contacts",      feature: "contacts", blocks: [{ id: "contacts" }] },
  { id: "quotations",   label: "Quotations",    feature: "quotations", blocks: [
    { id: "quote_trend" }, { id: "revenue_card" }, { id: "quote_outcomes" },
    { id: "quote_overdue", size: "compact" }, { id: "quote_source", size: "half" },
  ] },
  { id: "cases",        label: "Cases",         feature: "cases", blocks: [{ id: "open_cases" }, { id: "case_status" }] },
  { id: "work_orders",  label: "Work orders",   feature: "work_orders", blocks: [
    { id: "work_orders" }, { id: "work_order_status" }, { id: "tech_workload" },
  ] },
  { id: "assets",       label: "Assets",        feature: "assets", blocks: [
    { id: "assets" }, { id: "assets_by_kind" }, { id: "loaner_availability", size: "half" },
  ] },
  { id: "contracts",    label: "AMC / Contracts", feature: "amc", blocks: [{ id: "contracts", size: "half" }] },
  { id: "leads",        label: "Leads",         feature: "leads", blocks: [{ id: "leads" }, { id: "lead_funnel" }] },
  { id: "technicians",  label: "Technicians",   feature: "technicians", blocks: [
    { id: "technicians" }, { id: "technician_availability" }, { id: "tech_workload" },
  ] },
  { id: "invoices",     label: "Invoices",      feature: "invoices", blocks: [
    { id: "invoice_budget" }, { id: "invoices_by_status" }, { id: "revenue_overview" },
  ] },
  { id: "wfm",          label: "Workforce",     feature: "wfm", blocks: [
    { id: "wfm_summary", size: "full" },
    { id: "wfm_attendance_today" }, { id: "wfm_corrections_queue" }, { id: "wfm_leave_requests_queue" },
    { id: "wfm_site_headcount" }, { id: "wfm_workforce_composition", size: "half" }, { id: "wfm_night_shift_cost", size: "compact" },
  ] },
  { id: "wfm_projects",  label: "Project costing", feature: "wfm_projects", blocks: [
    { id: "wfm_project_hours" }, { id: "wfm_project_budget" }, { id: "wfm_project_billing", size: "compact" },
  ] },
];

/** Central feature gate for a dashboard block: native blocks show when ANY
 * of their module flags is on, analytics widgets follow their own flag.
 * Applied at RENDER time (not just in the customize picker) so a saved or
 * default layout can never surface a module the tenant doesn't have. */
function blockAllowed(id: string, features: TenantFeatures): boolean {
  const native = NATIVE_META[id];
  if (native) return !native.features || native.features.some((f) => features[f] === true);
  if (isAnalyticsId(id)) {
    const feat = ANALYTICS_META[id].feature;
    return !feat || features[feat] === true;
  }
  return true;
}

function resolveLayout(saved: DashLayoutItem[], features: TenantFeatures): DashLayoutItem[] {
  if (!saved || saved.length === 0) return defaultLayoutFor(features);
  // Ensure native blocks that aren't in saved layout appear (as hidden) so user can un-hide them
  const savedIds = new Set(saved.map((b) => b.id));
  const missing = Object.keys(NATIVE_META).filter((id) => !savedIds.has(id));
  const merged = [...saved, ...missing.map((id) => ({ id, hidden: true }))];

  // A saved layout was never reconciled against the tenant's MODULES. A
  // workspace whose saved blocks all belong to modules it doesn't have --
  // a layout stamped at provisioning, or one left behind when modules
  // changed -- filtered down to nothing and opened on a blank screen, with
  // the module's own widgets sitting unused because defaultLayoutFor is
  // only consulted when nothing is saved at all.
  //
  // Deliberately keyed on feature-allowed, NOT on hidden: a user who hid
  // every block chose that, and is left alone (the empty state below
  // explains how to bring them back). This only rescues a layout that
  // cannot show anything no matter what the user un-hides.
  //
  // Checked against SAVED, not merged: the merge above injects every
  // native block as hidden, and on a scoped tenant those injected blocks
  // are feature-allowed -- which made this check always pass and the
  // rescue never fire, landing e.g. a WFM-only workspace with a stale
  // CRM-only saved layout on a blank dashboard instead of its defaults.
  if (!saved.some((b) => blockAllowed(b.id, features))) return defaultLayoutFor(features);
  return merged;
}

/** The default layout was written when every tenant had every module: all
 * six native CRM blocks. For a scoped tenant (e.g. WFM-only) those are all
 * feature-blocked, which used to resolve to an EMPTY dashboard. When that
 * happens, fall back to composing the default from the enabled modules'
 * starter bundles instead -- a Workforce-only tenant opens to the WFM
 * widgets with zero setup. Tenants with a saved layout are untouched. */
function defaultLayoutFor(features: TenantFeatures): DashLayoutItem[] {
  const nativeVisible = DEFAULT_LAYOUT.filter((b) => blockAllowed(b.id, features));
  if (nativeVisible.some((b) => !NATIVE_META[b.id]?.sidebar)) return DEFAULT_LAYOUT;
  const seen = new Set<string>();
  const fromBundles: DashLayoutItem[] = [];
  for (const bundle of BUNDLES) {
    if (bundle.feature && features[bundle.feature] !== true) continue;
    for (const b of bundle.blocks) {
      if (seen.has(b.id) || !blockAllowed(b.id, features)) continue;
      seen.add(b.id);
      fromBundles.push(b.size ? { id: b.id, size: b.size } : { id: b.id });
    }
  }
  return [...fromBundles, ...nativeVisible];
}

// Single/dual stat-tile widgets are narrow by nature -- default them to compact
// so they sit side by side in a wrapping row instead of each claiming a
// full-width row of mostly empty space. Users can still override via block.size.
const COMPACT_ANALYTICS_IDS = new Set<AnalyticsMetricId>([
  "accounts", "contacts", "assets", "open_cases", "work_orders", "leads", "technicians", "quote_overdue",
]);

function blockSize(block: DashLayoutItem): "compact" | "half" | "full" {
  if (block.size) return block.size;
  return isAnalyticsId(block.id) && COMPACT_ANALYTICS_IDS.has(block.id) ? "compact" : "full";
}

const SIZE_FLEX: Record<"compact" | "half" | "full", React.CSSProperties> = {
  // Compact tiles GROW to share the row evenly rather than leaving a ragged
  // gap on the right -- but maxWidth caps a lone tile so it can't stretch
  // absurdly wide when it's the only one on its row. (grow:0 previously left
  // a large dead zone whenever the tiles didn't happen to fill the width.)
  compact: { flex: "1 1 240px", minWidth: 200, maxWidth: 520 },
  half:    { flex: "1 1 calc(50% - 7px)", minWidth: 260 },
  full:    { flex: "1 1 100%", minWidth: 0 },
};

function blockLabel(id: string): string {
  if (id in NATIVE_META) return NATIVE_META[id].label;
  if (id in ANALYTICS_META) return ANALYTICS_META[id as AnalyticsMetricId].label;
  return id;
}

// ── Formatters ────────────────────────────────────────────────────────────────

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

const greet = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

const todayStr = () =>
  new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

const todayISO = () => new Date().toISOString().slice(0, 10);

const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);

const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

/** Tiny inline area sparkline -- nextgen KPI tiles. Pure SVG, no library. */
function Sparkline({ values, stroke }: { values: number[]; stroke: string }) {
  if (values.length < 2) return null;
  const w = 200, h = 30, pad = 2;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * w,
    pad + (1 - (v - min) / span) * (h - pad * 2),
  ]);
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: "block", width: "100%", height: 30, marginTop: 8 }}>
      <path d={line} fill="none" stroke={stroke} strokeWidth={2} />
      <path d={`${line} L${w},${h} L0,${h} Z`} fill={stroke} opacity={0.08} />
    </svg>
  );
}

// KPI tiles are narrow (minWidth 150) -- a lakhs/crores figure at the default
// 25px was overflowing its box instead of shrinking to fit. Scale the font
// down as the formatted string gets longer rather than fixing one size.
function kpiNumFontSize(text: string): number {
  const len = text.length;
  if (len >= 13) return 14;
  if (len >= 11) return 16;
  if (len >= 9)  return 19;
  if (len >= 7)  return 22;
  return 25;
}

// ── "Ledger" visual identity — dashboard-local, not the shared theme ────────────
// A forest-teal accent + serif numerals for money figures, giving the home
// dashboard a financial-statement feel. Scoped to this file (not theme.ts) so
// it doesn't change accent colours anywhere else in the app -- other pages keep
// c.accent/pillar as before.
const ledger = {
  accent: "#0f6b5c",
  accentSoft: "#e4efec",
  line: "#d8dee6",
};
const serifNum: React.CSSProperties = {
  fontFamily: 'Georgia, "Iowan Old Style", "Times New Roman", serif',
  fontVariantNumeric: "tabular-nums",
};

// News-card monogram themes -- cycled by row index (decorative variety, not an
// identity channel that needs to stay fixed to a specific source/account).
const NEWS_THEMES = [
  { thumb: "linear-gradient(135deg, #0f6b5c, var(--teal))", pillBg: "#e4efec", pillFg: "#0f6b5c" },
  { thumb: "linear-gradient(135deg, #a3651a, #d99a3e)", pillBg: "#fdf1e2", pillFg: "#a3651a" },
  { thumb: "linear-gradient(135deg, #2f5aa8, #5c86e6)", pillBg: "#e8edf9", pillFg: "#2f5aa8" },
  { thumb: "linear-gradient(135deg, #96385a, #c26b8e)", pillBg: "#f8e9ee", pillFg: "#96385a" },
  { thumb: "linear-gradient(135deg, #46505c, #6b7686)", pillBg: "#eceef1", pillFg: "#46505c" },
];

const NEWS_STOPWORDS = new Set(["the", "a", "an", "of", "and", "in", "on", "for"]);

function sourceInitials(source: string): string {
  const words = source.split(/\s+/).filter((w) => w && !NEWS_STOPWORDS.has(w.toLowerCase()));
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return "?";
}

// ── Mini analytics chart primitives ──────────────────────────────────────────

function MiniHBar({ rows, colorFn }: {
  rows: { label: string; value: number; href?: string; valueLabel?: string }[];
  colorFn?: (i: number) => string;
}) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
      {rows.map((row, i) => {
        const color = colorFn ? colorFn(i) : c.accent;
        const pct = row.value > 0 ? Math.max(3, Math.round((row.value / max) * 100)) : 0;
        const inner = (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{
              width: 92, flexShrink: 0, fontSize: 11, color: c.muted, textAlign: "right",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {row.label}
            </span>
            <div style={{ flex: 1, height: 10, background: c.panel2, borderRadius: 5 }}>
              <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: "0 5px 5px 0" }} />
            </div>
            <span style={{ ...serifNum, fontSize: 11.5, fontWeight: 700, color: c.ink, minWidth: 28, textAlign: "right", flexShrink: 0, whiteSpace: "nowrap" }}>
              {row.valueLabel ?? row.value}
            </span>
          </div>
        );
        return row.href
          ? <Link key={i} href={row.href} style={{ textDecoration: "none", display: "block" }}>{inner}</Link>
          : <div key={i}>{inner}</div>;
      })}
    </div>
  );
}

// One thin stacked bar showing parts of a whole -- the composition form.
// 2px gaps keep segments readable without outlines; zero-value segments are
// dropped so the gap count matches what's actually visible.
function SegmentBar({ segments, height = 10 }: {
  segments: { label: string; value: number; color: string }[]; height?: number;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (total === 0) return <div style={{ height, borderRadius: height / 2, background: c.panel2 }} />;
  return (
    <div style={{ display: "flex", gap: 2, height, borderRadius: height / 2, overflow: "hidden" }}>
      {segments.filter((s) => s.value > 0).map((s, i) => (
        <div key={i} title={`${s.label}: ${s.value}`} style={{ flex: s.value, background: s.color, minWidth: 4 }} />
      ))}
    </div>
  );
}

function LegendChips({ items }: { items: { label: string; value: number | string; color: string }[] }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "5px 14px" }}>
      {items.map((it, i) => (
        <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, color: c.muted, whiteSpace: "nowrap" }}>
          <span style={{ width: 7, height: 7, borderRadius: 2, background: it.color, flexShrink: 0 }} />
          {it.label}
          <span style={{ ...serifNum, fontWeight: 700, color: c.ink }}>{it.value}</span>
        </span>
      ))}
    </div>
  );
}

// Approval-queue widget: the actionable number (pending) is the headline; the
// disposition history (approved/rejected/...) is deliberately demoted to small
// legend chips. The icon chip carries state -- amber alert while anything is
// pending, green check when the queue is clear -- so an all-zero fresh tenant
// reads as "all clear", not as a broken empty chart.
function QueueGlance({ pending, noun, chips, href }: {
  pending: number; noun: string;
  chips: { label: string; value: number; color: string }[]; href: string;
}) {
  const modern = useUiTheme() !== "classic";
  const hot = pending > 0;
  return (
    <Link href={href} style={{ textDecoration: "none", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{
          width: 40, height: 40, borderRadius: modern ? 10 : 8, flexShrink: 0,
          background: hot ? pillar.amber.bg : pillar.green.bg,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {hot ? <AlertTriangle size={17} color={pillar.amber.fg} /> : <CheckIcon size={17} color={pillar.green.fg} />}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{
            ...(modern ? {} : serifNum),
            fontSize: 24, fontWeight: modern ? 800 : 700, lineHeight: 1.1,
            color: hot ? pillar.amber.fg : pillar.green.fg,
          }}>{pending}</div>
          <div style={{ fontSize: 10.5, color: c.hint, marginTop: 2 }}>
            {hot ? `pending ${noun} awaiting review` : `no pending ${noun} — all clear`}
          </div>
        </div>
      </div>
      {chips.some((ch) => ch.value > 0) && <LegendChips items={chips} />}
    </Link>
  );
}

function MiniDonut({ slices, size = 64 }: { slices: { label: string; value: number; color: string }[]; size?: number }) {
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  const r = size / 2 - 6;
  const cx = size / 2; const cy = size / 2;
  let angle = -Math.PI / 2;
  const paths = slices.map((sl) => {
    const sweep = (sl.value / total) * 2 * Math.PI;
    const x1 = cx + r * Math.cos(angle); const y1 = cy + r * Math.sin(angle);
    angle += sweep;
    const x2 = cx + r * Math.cos(angle); const y2 = cy + r * Math.sin(angle);
    return { d: `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${sweep > Math.PI ? 1 : 0} 1 ${x2} ${y2} Z`, color: sl.color, label: sl.label, value: sl.value };
  });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
        {paths.map((p, i) => <path key={i} d={p.d} fill={p.color} />)}
        <circle cx={cx} cy={cy} r={r * 0.55} fill="var(--card-bg,#fff)" />
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {paths.slice(0, 4).map((p, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 7, height: 7, borderRadius: 2, background: p.color, flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: c.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.label}</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: c.ink, marginLeft: "auto", flexShrink: 0 }}>{p.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── "Big" chart primitives — used when a donut/funnel widget is sized Half or
// Full, matching the richer treatment the Analytics workcenter (/reports) gives
// the same metrics. Slice colors stay the categorical palette (identity data);
// only chrome/typography follows the Ledger identity. ──────────────────────────

function BigDonut({ segments, size = 156, r = 52, sw = 20 }: {
  segments: { label: string; value: number; color: string; href?: string }[];
  size?: number; r?: number; sw?: number;
}) {
  const cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (!total) return null;
  let cumDash = 0;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} style={{ flexShrink: 0, display: "block" }}>
      <g transform={`rotate(-90 ${cx} ${cy})`}>
        {segments.map((seg, i) => {
          const dash = (seg.value / total) * circ;
          const offset = circ - cumDash;
          cumDash += dash;
          const el = (
            <circle key={i} cx={cx} cy={cy} r={r} fill="none"
              stroke={seg.color} strokeWidth={sw}
              strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={offset}
              style={{ cursor: seg.href ? "pointer" : "default" }}
            />
          );
          return seg.href ? <a key={i} href={seg.href}>{el}</a> : el;
        })}
      </g>
      <text x={cx} y={cy - 4} textAnchor="middle" fontSize={22} fontWeight={700} fill={ledger.accent} fontFamily='Georgia, "Iowan Old Style", "Times New Roman", serif'>{total}</text>
      <text x={cx} y={cy + 14} textAnchor="middle" fontSize={9.5} fill={c.hint}>total</text>
    </svg>
  );
}

function BigDonutLegend({ items }: { items: { label: string; value: number; color: string; href?: string }[] }) {
  const total = items.reduce((s, x) => s + x.value, 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, minWidth: 0 }}>
      {items.map((item, i) => {
        const inner = (
          <>
            <div style={{ width: 9, height: 9, borderRadius: 3, background: item.color, flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: c.ink, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</span>
            <span style={{ ...serifNum, fontSize: 12, fontWeight: 700, color: c.ink }}>{item.value}</span>
            <span style={{ fontSize: 10.5, color: c.hint, minWidth: 32, textAlign: "right" }}>
              {total > 0 ? `${Math.round((item.value / total) * 100)}%` : "—"}
            </span>
          </>
        );
        return item.href
          ? <Link key={i} href={item.href} style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>{inner}</Link>
          : <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>{inner}</div>;
      })}
    </div>
  );
}

// Funnel stages are one ordered process narrowing down, not unrelated
// categories -- a single-hue sequential ramp (light -> full accent) tells that
// story correctly, and ties the widget to the Ledger identity.
const FUNNEL_RAMP = ["#bfdfd7", "#7ebeae", "#3d9484", ledger.accent];

function BigFunnel({ stages }: { stages: { stage: string; count: number; href?: string }[] }) {
  const max = stages[0]?.count || 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {stages.map((s, i) => {
        const pct = Math.max(28, Math.round((s.count / max) * 100));
        const color = FUNNEL_RAMP[i % FUNNEL_RAMP.length];
        const bar = (
          <div style={{
            width: `${pct}%`, height: 36, borderRadius: 7, background: color,
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "0 14px", boxSizing: "border-box",
          }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: i >= 2 ? "#fff" : "#1c2733" }}>{s.stage}</span>
            <span style={{ ...serifNum, fontSize: 15, fontWeight: 700, color: i >= 2 ? "#fff" : "#1c2733" }}>{s.count}</span>
          </div>
        );
        return (
          <div key={s.stage} style={{ display: "flex" }}>
            {s.href ? <Link href={s.href} style={{ width: `${pct}%`, textDecoration: "none" }}>{bar}</Link> : bar}
          </div>
        );
      })}
    </div>
  );
}

function ProgressRing({ pct, color, size = 84, stroke = 9 }: { pct: number; color: string; size?: number; stroke?: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const r = size / 2 - stroke / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - clamped / 100);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0, transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={c.line} strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
      />
      <text
        x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="central"
        transform={`rotate(90 ${size / 2} ${size / 2})`}
        style={{ fontSize: size * 0.24, fontWeight: 800, fill: c.ink }}
      >
        {Math.round(clamped)}%
      </text>
    </svg>
  );
}

function VBarTriplet({ bars, height = 90 }: { bars: { label: string; value: number; color: string }[]; height?: number }) {
  const max = Math.max(...bars.map((b) => b.value), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 18, height }}>
      {bars.map((b, i) => (
        <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, flex: 1 }}>
          <div style={{ ...serifNum, fontSize: 11, fontWeight: 700, color: c.ink }}>{inr(b.value)}</div>
          <div style={{ width: "100%", maxWidth: 46, height: Math.max(4, (b.value / max) * (height - 34)), background: b.color, borderRadius: "5px 5px 2px 2px" }} />
          <div style={{ fontSize: 10, color: c.hint, textAlign: "center" }}>{b.label}</div>
        </div>
      ))}
    </div>
  );
}

function StatTile({ value, label, icon, href, tone }: { value: number | string; label: string; icon: React.ReactNode; href: string; tone?: PillarKey }) {
  const modern = useUiTheme() !== "classic";
  return (
    <Link href={href} style={{ textDecoration: "none", display: "flex", flexDirection: "column", gap: 12, flex: 1, padding: "14px 16px", minWidth: 0 }}>
      <div style={{
        width: 28, height: 28, borderRadius: modern ? 8 : 7,
        background: tone ? pillar[tone].bg : (modern ? "var(--modern-accent-bg)" : ledger.accentSoft),
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>
        {icon}
      </div>
      <div>
        <div style={{
          ...(modern ? {} : serifNum),
          fontSize: kpiNumFontSize(String(value)) + 2, fontWeight: modern ? 800 : 700,
          color: tone ? pillar[tone].fg : (modern ? "var(--modern-accent)" : ledger.accent),
          letterSpacing: modern ? "-0.01em" : undefined,
          lineHeight: 1.15, whiteSpace: "nowrap",
        }}>{value}</div>
        <div style={{ fontSize: 11, color: c.hint, marginTop: 5 }}>{label}</div>
      </div>
    </Link>
  );
}

function AnalyticsCard({ title, href, children }: { title: string; href: string; children: React.ReactNode }) {
  const modern = useUiTheme() !== "classic";
  return (
    <div
      className={modern ? "modern-lift-gold" : undefined}
      style={{
        ...cardStyle, padding: 0, overflow: "hidden",
        // box-shadow is owned by .modern-lift-gold in modern mode (base +
        // hover + the gold edge all live there) -- leaving it inline here
        // too would silently cancel the class's :hover rule, since an
        // inline style always beats a stylesheet rule for the same element.
        boxShadow: modern ? undefined : "0 1px 2px rgba(16,24,40,.04), 0 1px 6px rgba(16,24,40,.03)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: modern ? "12px 16px 10px" : "11px 14px 9px", borderBottom: `1px solid ${modern ? "var(--line)" : ledger.line}` }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: modern ? "var(--modern-accent)" : c.hint, textTransform: "uppercase", letterSpacing: 0.6 }}>{title}</span>
        <Link href={href} style={{ fontSize: 10.5, color: modern ? "var(--modern-accent)" : ledger.accent, textDecoration: "none", fontWeight: 600 }}>Full view →</Link>
      </div>
      <div style={{ padding: modern ? "14px 16px" : "12px 14px" }}>{children}</div>
    </div>
  );
}

const NEWS_COLLAPSED_COUNT = 5;

function AccountNewsList({ items }: { items: AnalyticsData["accountNews"] }) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) {
    return <div style={{ fontSize: 11.5, color: c.hint, textAlign: "center", padding: "10px 0" }}>No recent news for your top accounts</div>;
  }
  const visible = expanded ? items : items.slice(0, NEWS_COLLAPSED_COUNT);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {visible.map((n, i) => {
        const theme = NEWS_THEMES[i % NEWS_THEMES.length];
        return (
          <a key={i} href={n.url} target="_blank" rel="noopener noreferrer" style={{ display: "flex", gap: 12, alignItems: "flex-start", textDecoration: "none" }}>
            <div style={{
              width: 44, height: 44, borderRadius: 9, flexShrink: 0, background: theme.thumb,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 13, fontWeight: 700, color: "#fff", letterSpacing: 0.2,
            }}>
              {sourceInitials(n.source)}
            </div>
            <div style={{ minWidth: 0, paddingTop: 1 }}>
              <div style={{ fontSize: 11.5, color: c.ink, fontWeight: 600, lineHeight: 1.35 }}>{n.title}</div>
              <div style={{ fontSize: 10, color: c.hint, marginTop: 4, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 20, background: theme.pillBg, color: theme.pillFg }}>{n.accountName}</span>
                {n.source} · {fmtDate(n.publishedAt)}
              </div>
            </div>
          </a>
        );
      })}
      {items.length > NEWS_COLLAPSED_COUNT && (
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{
            alignSelf: "flex-start", background: "transparent", border: "none", cursor: "pointer",
            fontSize: 11, fontWeight: 600, color: ledger.accent, padding: 0, marginTop: 2,
          }}
        >
          {expanded ? "Show less" : `Show ${items.length - NEWS_COLLAPSED_COUNT} more`}
        </button>
      )}
    </div>
  );
}

// ── Analytics widget renderer ─────────────────────────────────────────────────

// Each count/stat tile gets a stable identity hue from the pillar palette, so
// the dashboard reads as a set of distinct cards rather than a wall of one
// accent colour. Assigned by MEANING (money = green, people = teal, alerts =
// amber/red...), not at random, and stable per widget so a tile keeps its
// colour across renders. Widgets not listed keep the default accent.
const WIDGET_TONE: Partial<Record<string, PillarKey>> = {
  accounts: "blue", contacts: "teal", assets: "purple", open_cases: "amber",
  work_orders: "purple", leads: "green", technicians: "teal",
  quote_overdue: "red", quote_source: "blue",
  wfm_night_shift_cost: "amber", wfm_site_headcount: "teal",
  wfm_attendance_today: "blue", wfm_workforce_composition: "purple",
  wfm_leave_taken_by_type: "green",
  wfm_project_hours: "blue", wfm_project_budget: "amber", wfm_project_billing: "green",
};

const hm = (min: number) => `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, "0")}m`;
export function renderWidget(id: AnalyticsMetricId, a: AnalyticsData, size: "compact" | "half" | "full"): React.ReactNode {
  const COLORS = [pillar.blue.base, pillar.teal.base, pillar.amber.base, pillar.purple.base, pillar.green.base];
  const tone = WIDGET_TONE[id];
  const iconColor = tone ? pillar[tone].base : ledger.accent;
  const big = size !== "compact";
  switch (id) {
    case "accounts":        return <AnalyticsCard title="Accounts" href={ROUTES.accounts}><StatTile tone={tone} value={a.totals.accounts} label="Total accounts" icon={<Globe size={14} color={iconColor} />} href={ROUTES.accounts} /></AnalyticsCard>;
    case "contacts":        return <AnalyticsCard title="Contacts" href={ROUTES.contacts}><StatTile tone={tone} value={a.totals.contacts} label="Total contacts" icon={<Phone size={14} color={iconColor} />} href={ROUTES.contacts} /></AnalyticsCard>;
    case "assets":          return <AnalyticsCard title="Assets" href={ROUTES.assets}><StatTile tone={tone} value={a.totals.customerAssets} label="Customer assets" icon={<Gear size={14} color={iconColor} />} href={ROUTES.assets} /></AnalyticsCard>;
    case "open_cases":      return <AnalyticsCard title="Open cases" href={ROUTES.cases}><StatTile tone={tone} value={a.totals.openCases} label="Open cases" icon={<Activity size={14} color={iconColor} />} href={ROUTES.cases} /></AnalyticsCard>;
    case "work_orders":     return <AnalyticsCard title="Work orders" href={ROUTES.workOrders}><StatTile tone={tone} value={a.totals.workOrders} label="Total work orders" icon={<Wrench size={14} color={iconColor} />} href={ROUTES.workOrders} /></AnalyticsCard>;
    case "contracts":       return <AnalyticsCard title="AMC contracts" href={ROUTES.amc}><div style={{ display: "flex" }}><StatTile tone={tone} value={a.contractStats.activeCount} label="Active" icon={<CalendarCheck size={14} color={iconColor} />} href={ROUTES.amc} /><StatTile tone={tone} value={inr(a.contractStats.totalValue)} label="Total value" icon={<CalendarCheck size={14} color={iconColor} />} href={ROUTES.amc} /></div></AnalyticsCard>;
    case "leads":           return <AnalyticsCard title="Leads" href={ROUTES.leads}><StatTile tone={tone} value={a.totals.leads} label="Total leads" icon={<Zap size={14} color={iconColor} />} href={ROUTES.leads} /></AnalyticsCard>;
    case "products":        return <AnalyticsCard title="Products" href={ROUTES.products}><StatTile tone={tone} value={a.totals.products} label="Active products" icon={<Package size={14} color={iconColor} />} href={ROUTES.products} /></AnalyticsCard>;
    case "technicians":     return <AnalyticsCard title="Technicians" href={ROUTES.technicians}><StatTile tone={tone} value={a.totals.technicians} label="Total technicians" icon={<Clipboard size={14} color={iconColor} />} href={ROUTES.technicians} /></AnalyticsCard>;
    case "accounts_by_type": {
      const segs = a.accountsByType.map((x, i) => ({ label: x.label, value: x.count, color: COLORS[i % COLORS.length], href: `${ROUTES.accounts}?type=${x.type}` }));
      return <AnalyticsCard title="Accounts by type" href={ROUTES.accounts}>{big
        ? <div style={{ display: "flex", alignItems: "center", gap: 22, maxWidth: 460 }}><BigDonut segments={segs} /><BigDonutLegend items={segs} /></div>
        : <MiniDonut slices={segs} />}</AnalyticsCard>;
    }
    case "lead_funnel": {
      const stages = a.leadFunnel.map((x, i) => ({
        stage: x.stage, count: x.count,
        href: i === 0 ? ROUTES.leads : `${ROUTES.leads}?status=${i === 3 ? "won" : i === 1 ? "inspecting" : "quoted"}`,
      }));
      return <AnalyticsCard title="Lead funnel" href={ROUTES.leads}>{big
        ? <BigFunnel stages={stages} />
        : <MiniHBar rows={a.leadFunnel.map((x) => ({ label: x.stage, value: x.count }))} colorFn={(i) => COLORS[i % COLORS.length]} />}</AnalyticsCard>;
    }
    case "assets_by_kind": {
      const segs = a.assetsByKind.map((x, i) => ({ label: x.label, value: x.count, color: COLORS[i % COLORS.length], href: `${ROUTES.assets}?kind=${x.kind}` }));
      return <AnalyticsCard title="Assets by kind" href={ROUTES.assets}>{big
        ? <div style={{ display: "flex", alignItems: "center", gap: 22, maxWidth: 460 }}><BigDonut segments={segs} /><BigDonutLegend items={segs} /></div>
        : <MiniHBar rows={segs} colorFn={(i) => COLORS[i % COLORS.length]} />}</AnalyticsCard>;
    }
    case "quote_trend":      return <AnalyticsCard title="Quote pipeline" href={ROUTES.quotations}><MiniHBar rows={a.quotesByStatus.map((x) => ({ label: x.label, value: x.value, valueLabel: inr(x.value), href: `${ROUTES.quotations}?status=${x.status}` }))} colorFn={(i) => COLORS[i % COLORS.length]} /></AnalyticsCard>;
    case "case_status":      return <AnalyticsCard title="Case status" href={ROUTES.cases}><MiniHBar rows={a.casesByStatus.map((x) => ({ label: x.label, value: x.count }))} colorFn={(i) => COLORS[i % COLORS.length]} /></AnalyticsCard>;
    case "work_order_status": return <AnalyticsCard title="Work order status" href={ROUTES.workOrders}><MiniHBar rows={a.workOrdersByStatus.map((x) => ({ label: x.label, value: x.count, href: `${ROUTES.workOrders}?status=${x.status}` }))} colorFn={(i) => [pillar.amber.base, pillar.blue.base, pillar.teal.base][i % 3]} /></AnalyticsCard>;
    case "technician_availability": return <AnalyticsCard title="Technician availability" href={ROUTES.technicians}><MiniHBar rows={a.techniciansByStatus.map((x) => ({ label: x.label, value: x.count, href: `${ROUTES.technicians}?status=${x.status}` }))} colorFn={(i) => [pillar.teal.base, pillar.amber.base, c.muted][i]} /></AnalyticsCard>;
    case "revenue_overview": {
      const rows = [
        { label: "AMC contracts", value: a.contractStats.totalValue, href: ROUTES.amc },
        { label: "Quote pipeline", value: a.quotesByStatus.reduce((s, x) => s + x.value, 0), href: ROUTES.quotations },
        ...a.invoicesByStatus.map((inv) => ({ label: `Invoices (${inv.label})`, value: inv.value, href: `${ROUTES.invoices}?status=${inv.status}` })),
      ].map((r) => ({ ...r, valueLabel: inr(r.value) }));
      return <AnalyticsCard title="Revenue overview" href={ROUTES.invoices}><MiniHBar rows={rows} colorFn={(i) => [pillar.green.base, pillar.blue.base, pillar.purple.base, pillar.teal.base][i % 4]} /></AnalyticsCard>;
    }
    case "invoices_by_status": return <AnalyticsCard title="Invoices by status" href={ROUTES.invoices}><MiniHBar rows={a.invoicesByStatus.map((x) => ({ label: x.label, value: x.count, href: `${ROUTES.invoices}?status=${x.status}` }))} colorFn={(i) => COLORS[i % COLORS.length]} /></AnalyticsCard>;
    case "loaner_availability": return <AnalyticsCard title="Loaner availability" href={ROUTES.assets}><div style={{ display: "flex" }}><StatTile tone={tone} value={a.loanerStock.available} label="Available" icon={<Battery size={14} color={iconColor} />} href={ROUTES.assets} /><StatTile tone={tone} value={a.loanerStock.onLoan} label="On loan" icon={<Package size={14} color={iconColor} />} href={ROUTES.assets} /></div></AnalyticsCard>;
    case "recent_activity":  return <AnalyticsCard title="Recent activity" href={ROUTES.accounts}><div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{a.recentActivity.slice(0, 4).map((act, i) => (<div key={i} style={{ fontSize: 11, color: c.muted, borderLeft: `2px solid ${ledger.accentSoft}`, paddingLeft: 9 }}><div style={{ color: c.ink }}>{act.text}</div><div style={{ fontSize: 10, color: c.hint, marginTop: 1 }}>{act.accountName} · {fmtDate(act.at)}</div></div>))}</div></AnalyticsCard>;
    case "account_news":     return <AnalyticsCard title="Client news" href={ROUTES.accounts}><AccountNewsList items={a.accountNews} /></AnalyticsCard>;
    case "quote_outcomes": {
      const { open, won, lost, dropped } = a.quoteOutcomeTotals;
      const rows = [
        { label: "Won",     value: won,     valueLabel: inr(won) },
        { label: "Lost",    value: lost,    valueLabel: inr(lost) },
        { label: "Dropped", value: dropped, valueLabel: inr(dropped) },
        { label: "Open",    value: open,    valueLabel: inr(open) },
      ];
      return <AnalyticsCard title="Quote outcome value" href={ROUTES.quotations}><MiniHBar rows={rows} colorFn={(i) => [pillar.green.base, pillar.red.base, pillar.amber.base, pillar.blue.base][i]} /></AnalyticsCard>;
    }
    case "quote_overdue": return <AnalyticsCard title="Quote overdue" href={ROUTES.quotations}><StatTile tone={tone} value={a.quoteOverdueCount} label="Overdue quotes" icon={<AlertTriangle size={14} color={iconColor} />} href={ROUTES.quotations} /></AnalyticsCard>;
    case "quote_source": return <AnalyticsCard title="Quote source" href={ROUTES.quotations}><div style={{ display: "flex" }}><StatTile tone={tone} value={a.quoteSource.caseLinked.count} label="From cases" icon={<Wrench size={14} color={iconColor} />} href={ROUTES.quotations} /><StatTile tone={tone} value={a.quoteSource.standalone.count} label="Standalone" icon={<FileText size={14} color={iconColor} />} href={ROUTES.quotations} /></div></AnalyticsCard>;
    case "wfm_attendance_today": {
      const onTime = a.wfmAttendanceBySite.reduce((s, x) => s + x.onTime, 0);
      const late = a.wfmAttendanceBySite.reduce((s, x) => s + x.late, 0);
      const absent = a.wfmAttendanceBySite.reduce((s, x) => s + x.absent, 0);
      const expected = onTime + late + absent;
      const present = onTime + late;
      return <AnalyticsCard title="Attendance today" href={ROUTES.wfmLiveBoard}>
        {expected === 0
          ? <div style={{ fontSize: 12, color: c.hint, textAlign: "center", padding: "12px 0" }}>No attendance expected today.</div>
          : <Link href={ROUTES.wfmLiveBoard} style={{ textDecoration: "none", display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                <span style={{ ...serifNum, fontSize: 24, fontWeight: 700, lineHeight: 1.1, color: ledger.accent }}>{present}</span>
                <span style={{ fontSize: 11, color: c.hint }}>of {expected} in today</span>
              </div>
              <SegmentBar segments={[
                { label: "On time", value: onTime, color: pillar.green.base },
                { label: "Late",    value: late,   color: pillar.amber.base },
                { label: "Absent",  value: absent, color: pillar.red.base },
              ]} />
              <LegendChips items={[
                { label: "On time", value: onTime, color: pillar.green.base },
                { label: "Late",    value: late,   color: pillar.amber.base },
                { label: "Absent",  value: absent, color: pillar.red.base },
              ]} />
            </Link>}
      </AnalyticsCard>;
    }
    case "wfm_night_shift_cost": return <AnalyticsCard title="Night shift cost" href={ROUTES.wfmLiveBoard}><StatTile tone={tone} value={inr(a.wfmNightShiftCost.amount)} label={`${a.wfmNightShiftCost.count} on night shift today`} icon={<Clock size={14} color={iconColor} />} href={ROUTES.wfmLiveBoard} /></AnalyticsCard>;
    case "wfm_corrections_queue": {
      const m = new Map(a.wfmCorrectionsByStatus.map((x) => [x.status, x.count]));
      return <AnalyticsCard title="Corrections queue" href={ROUTES.wfmCorrections}>
        <QueueGlance pending={m.get("pending") ?? 0} noun="corrections" href={ROUTES.wfmCorrections} chips={[
          { label: "Approved", value: m.get("approved") ?? 0, color: pillar.green.base },
          { label: "Rejected", value: m.get("rejected") ?? 0, color: pillar.red.base },
        ]} />
      </AnalyticsCard>;
    }
    case "wfm_leave_requests_queue": {
      const m = new Map(a.wfmLeaveRequestsByStatus.map((x) => [x.status, x.count]));
      return <AnalyticsCard title="Leave requests" href={ROUTES.wfmLeave}>
        <QueueGlance pending={m.get("pending") ?? 0} noun="leave requests" href={ROUTES.wfmLeave} chips={[
          { label: "Approved", value: m.get("approved") ?? 0, color: pillar.green.base },
          { label: "Rejected", value: m.get("rejected") ?? 0, color: pillar.red.base },
        ]} />
      </AnalyticsCard>;
    }
    case "wfm_recheck_queue": {
      const m = new Map(a.wfmRecheckByStatus.map((x) => [x.status, x.count]));
      return <AnalyticsCard title="Flagged for review" href={ROUTES.wfmCorrections}>
        <QueueGlance pending={m.get("pending") ?? 0} noun="rechecks" href={ROUTES.wfmCorrections} chips={[
          { label: "Responded", value: m.get("responded") ?? 0, color: pillar.blue.base },
          { label: "Resolved",  value: m.get("resolved") ?? 0,  color: pillar.green.base },
          { label: "Dismissed", value: m.get("dismissed") ?? 0, color: c.hint },
        ]} />
      </AnalyticsCard>;
    }
    case "wfm_project_hours": {
      const rows = a.wfmProjectHours.slice(0, 6);
      const total = a.wfmProjectHours.reduce((s, x) => s + x.minutes, 0);
      return <AnalyticsCard title="Hours by project" href={ROUTES.wfmProjects}>{rows.length === 0
        ? <div style={{ fontSize: 12, color: c.hint, textAlign: "center", padding: "12px 0" }}>No hours booked this month yet.</div>
        : <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 11, color: c.hint }}><span style={{ ...serifNum, fontSize: 13, fontWeight: 700, color: c.ink }}>{hm(total)}</span> this month</div>
            <MiniHBar
              rows={rows.map((x) => ({ label: x.name, value: x.minutes, valueLabel: hm(x.minutes), href: x.id ? ROUTES.wfmProject(x.id) : ROUTES.wfmRoster }))}
              colorFn={(i) => (rows[i].id ? ledger.accent : pillar.amber.base)}
            />
          </div>}</AnalyticsCard>;
    }
    case "wfm_project_budget": {
      const rows = a.wfmProjectBudget.slice(0, 6);
      const over = a.wfmProjectBudget.filter((x) => x.pct > 100).length;
      return <AnalyticsCard title="Budget burn" href={ROUTES.wfmProjects}>{rows.length === 0
        ? <div style={{ fontSize: 12, color: c.hint, textAlign: "center", padding: "12px 0" }}>No project with a budget and hours yet.</div>
        : <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 11, color: over ? pillar.red.fg : c.hint }}>
              <span style={{ ...serifNum, fontSize: 13, fontWeight: 700, color: over ? pillar.red.fg : c.ink }}>{over}</span> over budget
            </div>
            <MiniHBar
              rows={rows.map((x) => ({ label: x.name, value: Math.min(x.pct, 100), valueLabel: `${x.pct}% of ${x.budgetHours}h`, href: ROUTES.wfmProject(x.id) }))}
              colorFn={(i) => (rows[i].pct > 100 ? pillar.red.base : rows[i].pct > 80 ? pillar.amber.base : pillar.green.base)}
            />
          </div>}</AnalyticsCard>;
    }
    case "wfm_project_billing": {
      const b = a.wfmProjectBilling;
      return <AnalyticsCard title="Project billing" href={ROUTES.wfmProjects}>
        <div style={{ display: "flex" }}>
          <StatTile tone={tone} value={inr(b.invoicedAmount)} label={`${b.invoicedCount} invoice${b.invoicedCount === 1 ? "" : "s"} raised this month`} icon={<FileText size={14} color={iconColor} />} href={ROUTES.invoices} />
          <StatTile tone={b.unbilledMinutes > 0 ? "amber" : tone} value={hm(b.unbilledMinutes)} label={`unbilled on ${b.unbilledProjects} project${b.unbilledProjects === 1 ? "" : "s"}`} icon={<Clock size={14} color={iconColor} />} href={ROUTES.wfmProjects} />
        </div>
      </AnalyticsCard>;
    }
    case "wfm_site_headcount": {
      const rows = [...a.wfmHeadcountBySite].sort((x, y) => y.count - x.count);
      const total = rows.reduce((s, x) => s + x.count, 0);
      return <AnalyticsCard title="Headcount by site" href={ROUTES.wfmEmployees}>{rows.length === 0
        ? <div style={{ fontSize: 12, color: c.hint, textAlign: "center", padding: "12px 0" }}>No active employees yet.</div>
        : <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 11, color: c.hint }}><span style={{ ...serifNum, fontSize: 13, fontWeight: 700, color: c.ink }}>{total}</span> active employees</div>
            <MiniHBar rows={rows.map((x) => ({ label: x.site, value: x.count }))} colorFn={() => ledger.accent} />
          </div>}</AnalyticsCard>;
    }
    case "wfm_workforce_composition": {
      const { totalActive, supervisors, fullTime, contractors } = a.wfmWorkforceComposition;
      const other = Math.max(0, totalActive - fullTime - contractors);
      const segs = [
        { label: "Full-time",   value: fullTime,    color: pillar.blue.base },
        { label: "Contractors", value: contractors, color: pillar.teal.base },
        ...(other > 0 ? [{ label: "Other", value: other, color: c.hint }] : []),
      ];
      return <AnalyticsCard title="Workforce composition" href={ROUTES.wfmEmployees}>
        {totalActive === 0
          ? <div style={{ fontSize: 12, color: c.hint, textAlign: "center", padding: "12px 0" }}>No active employees yet.</div>
          : <Link href={ROUTES.wfmEmployees} style={{ textDecoration: "none", display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                <span style={{ ...serifNum, fontSize: 24, fontWeight: 700, lineHeight: 1.1, color: ledger.accent }}>{totalActive}</span>
                <span style={{ fontSize: 11, color: c.hint }}>active · {supervisors} supervisor{supervisors === 1 ? "" : "s"}</span>
              </div>
              <SegmentBar segments={segs} />
              <LegendChips items={segs} />
            </Link>}
      </AnalyticsCard>;
    }
    case "wfm_leave_taken_by_type": {
      const sorted = [...a.wfmLeaveTakenByType].sort((x, y) => y.days - x.days);
      const otherDays = sorted.slice(3).reduce((s, x) => s + x.days, 0);
      const fmtD = (d: number) => (Number.isInteger(d) ? d : Math.round(d * 10) / 10);
      const slices = [
        ...sorted.slice(0, 3).map((x, i) => ({ label: x.type, value: fmtD(x.days), color: COLORS[i] })),
        ...(otherDays > 0 ? [{ label: "Other", value: fmtD(otherDays), color: c.hint }] : []),
      ];
      const totalDays = fmtD(sorted.reduce((s, x) => s + x.days, 0));
      return <AnalyticsCard title="Leave taken (YTD)" href={ROUTES.wfmLeave}>{sorted.length === 0
        ? <div style={{ fontSize: 12, color: c.hint, textAlign: "center", padding: "12px 0" }}>No leave recorded this year.</div>
        : <Link href={ROUTES.wfmLeave} style={{ textDecoration: "none", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 11, color: c.hint }}><span style={{ ...serifNum, fontSize: 13, fontWeight: 700, color: c.ink }}>{totalDays}</span> days this year</div>
            <MiniDonut slices={slices} />
          </Link>}</AnalyticsCard>;
    }
    default: return null;
  }
}

// ── Sidebar sub-components ────────────────────────────────────────────────────

function QCBtn({ href, label, icon, tint }: { href: string; label: string; icon: React.ReactNode; tint: { fg: string; bg: string; base: string } }) {
  const uiTheme = useUiTheme();
  const modern = uiTheme !== "classic";
  const nextgen = uiTheme === "nextgen";
  return (
    <Link
      className={modern ? "modern-lift" : undefined}
      href={href}
      style={{
        display: "flex", alignItems: "center", gap: 9, padding: modern ? "9px 12px" : "8px 11px",
        borderRadius: modern ? "var(--card-radius)" : 8,
        background: nextgen ? "var(--card-bg)" : tint.bg,
        border: `1px solid ${nextgen ? "var(--line)" : modern ? `${tint.base}55` : c.line}`,
        textDecoration: "none", fontSize: 12.5, color: nextgen ? c.ink : modern ? tint.fg : c.ink, fontWeight: nextgen ? 550 : modern ? 700 : 600,
      }}
    >
      {icon}{label}
    </Link>
  );
}

// ── Adapt drawer ──────────────────────────────────────────────────────────────

export interface DrawerProps {
  layout: DashLayoutItem[];
  features: TenantFeatures;
  onLayoutChange: (next: DashLayoutItem[]) => void;
  onClose: () => void;
  saving: boolean;
  title?: string;
  subtitle?: string;
  /** Shown as a footer action when provided -- e.g. clearing a personal
   * override back to whatever role/tenant default would otherwise apply. */
  onReset?: () => void;
  resetLabel?: string;
}

export function AdaptDrawer({
  layout, features, onLayoutChange, onClose, saving,
  title = "Adapt dashboard", subtitle = "Drag to reorder · click eye to hide",
  onReset, resetLabel = "Reset to default",
}: DrawerProps) {
  const dragIdx = useRef<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);

  const pinnedAnalyticsIds = new Set(layout.filter((b) => isAnalyticsId(b.id)).map((b) => b.id));

  const availableAnalytics = (Object.keys(ANALYTICS_META) as AnalyticsMetricId[]).filter((id) => {
    const feat = ANALYTICS_META[id].feature;
    return !feat || features[feat];
  });

  const availableBundles = BUNDLES.filter((b) => !b.feature || features[b.feature]);

  function addBundle(blocks: BundleBlock[]) {
    const next = [...layout];
    for (const b of blocks) {
      const idx = next.findIndex((x) => x.id === b.id);
      if (idx >= 0) {
        next[idx] = { ...next[idx], hidden: false, ...(b.size ? { size: b.size } : {}) };
      } else {
        next.push({ id: b.id, ...(b.size ? { size: b.size } : {}) });
      }
    }
    onLayoutChange(next);
  }

  function toggleHidden(idx: number) {
    const next = layout.map((b, i) => i === idx ? { ...b, hidden: !b.hidden } : b);
    onLayoutChange(next);
  }

  function setSize(idx: number, size: "compact" | "half" | "full") {
    const next = layout.map((b, i) => i === idx ? { ...b, size } : b);
    onLayoutChange(next);
  }

  function toggleAnalyticsPin(id: AnalyticsMetricId) {
    if (pinnedAnalyticsIds.has(id)) {
      onLayoutChange(layout.filter((b) => b.id !== id));
    } else {
      onLayoutChange([...layout, { id }]);
    }
  }

  function onDragStart(i: number) { dragIdx.current = i; }
  function onDragOver(e: React.DragEvent, i: number) { e.preventDefault(); setOverIdx(i); }
  function onDragEnd() { dragIdx.current = null; setOverIdx(null); }
  function onDrop(i: number) {
    const from = dragIdx.current;
    if (from === null || from === i) { setOverIdx(null); return; }
    const next = [...layout];
    const [moved] = next.splice(from, 1);
    next.splice(i, 0, moved);
    dragIdx.current = null;
    setOverIdx(null);
    onLayoutChange(next);
  }

  return (
    <>
      {/* backdrop */}
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", zIndex: 99 }} />

      {/* drawer */}
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 300,
        background: "var(--drawer-bg)", zIndex: 100, display: "flex", flexDirection: "column",
        boxShadow: "-4px 0 24px rgba(0,0,0,0.35)",
      }}>
        {/* header */}
        <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid var(--drawer-line)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--drawer-text)" }}>{title}</div>
            <div style={{ fontSize: 11, color: "var(--drawer-text-dim)", marginTop: 2 }}>{subtitle}</div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "var(--drawer-text-dim)", fontSize: 18, cursor: "pointer", lineHeight: 1, padding: "2px 6px" }}>✕</button>
        </div>

        {/* block list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 0" }}>
          {/* Quick add — per-object starter bundles */}
          <div style={{ padding: "0 12px 8px", borderBottom: "1px solid var(--drawer-line)", marginBottom: 6 }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--drawer-hint)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
              Quick add
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {availableBundles.map((bundle) => (
                <button
                  key={bundle.id}
                  onClick={() => addBundle(bundle.blocks)}
                  title={`Add ${bundle.blocks.map((b) => blockLabel(b.id)).join(", ")}`}
                  style={{
                    fontSize: 11, fontWeight: 600, padding: "5px 10px", borderRadius: 20, cursor: "pointer",
                    background: "rgba(55,138,221,0.12)", border: "1px solid rgba(55,138,221,0.35)",
                    color: "var(--modern-accent, #bcd9f7)",
                  }}
                >
                  + {bundle.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ padding: "0 12px 6px", fontSize: 9.5, fontWeight: 700, color: "var(--drawer-hint)", textTransform: "uppercase", letterSpacing: 1 }}>
            Drag to reorder
          </div>
          {layout.map((block, i) => {
            // Feature-blocked blocks can't render, so don't offer them for
            // reordering/unhiding either. Returning null (not filtering the
            // array) keeps `i` aligned with `layout` for the drag handlers.
            if (!blockAllowed(block.id, features)) return null;
            const label = blockLabel(block.id);
            const isOver = overIdx === i && dragIdx.current !== i;
            const resizable = !block.hidden && !NATIVE_META[block.id]?.sidebar;
            const currentSize = blockSize(block);
            return (
              <div
                key={block.id}
                draggable
                onDragStart={() => onDragStart(i)}
                onDragOver={(e) => onDragOver(e, i)}
                onDrop={() => onDrop(i)}
                onDragEnd={onDragEnd}
                style={{
                  padding: "9px 12px", cursor: "grab",
                  opacity: dragIdx.current === i ? 0.4 : 1,
                  borderTop: isOver ? `2px solid ${c.accent}` : "2px solid transparent",
                  transition: "border-color 0.1s, opacity 0.15s",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ color: "var(--drawer-hint)", fontSize: 14, flexShrink: 0, userSelect: "none" }}>⠿</span>
                  <span style={{
                    flex: 1, fontSize: 12, fontWeight: 500,
                    color: block.hidden ? "var(--drawer-hint)" : "var(--drawer-text)",
                    textDecoration: block.hidden ? "line-through" : "none",
                  }}>
                    {label}
                    {isAnalyticsId(block.id) && (
                      <span style={{ fontSize: 9.5, color: "var(--drawer-hint-faint)", marginLeft: 5 }}>analytics</span>
                    )}
                  </span>
                  <button
                    onClick={() => toggleHidden(i)}
                    title={block.hidden ? "Show" : "Hide"}
                    style={{
                      background: "transparent", border: "none", cursor: "pointer", padding: "2px 4px",
                      fontSize: 14, lineHeight: 1, color: block.hidden ? "var(--drawer-hint-faint)" : "var(--drawer-text-dim)",
                    }}
                  >
                    {block.hidden ? "⊘" : "◉"}
                  </button>
                </div>
                {resizable && (
                  <div style={{ display: "flex", gap: 4, marginLeft: 24, marginTop: 6 }}>
                    {(["compact", "half", "full"] as const).map((sz) => (
                      <button
                        key={sz}
                        onClick={() => setSize(i, sz)}
                        style={{
                          fontSize: 9.5, fontWeight: 600, padding: "3px 8px", borderRadius: 5, cursor: "pointer",
                          textTransform: "capitalize",
                          background: currentSize === sz ? "rgba(55,138,221,0.22)" : "var(--drawer-card)",
                          border: `1px solid ${currentSize === sz ? "rgba(55,138,221,0.55)" : "var(--drawer-line-strong)"}`,
                          color: currentSize === sz ? "var(--modern-accent, #bcd9f7)" : "var(--drawer-text-dim)",
                        }}
                      >
                        {sz === "compact" ? "Small" : sz}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* analytics picker */}
          <div style={{ padding: "14px 12px 6px", borderTop: "1px solid var(--drawer-line)", marginTop: 6 }}>
            <button
              onClick={() => setAnalyticsOpen((o) => !o)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%",
                background: "transparent", border: "none", cursor: "pointer", padding: 0,
              }}
            >
              <span style={{ fontSize: 9.5, fontWeight: 700, color: "var(--drawer-hint)", textTransform: "uppercase", letterSpacing: 1 }}>
                Analytics widgets
              </span>
              <span style={{ fontSize: 12, color: "var(--drawer-hint)" }}>{analyticsOpen ? "▴" : "▾"}</span>
            </button>
          </div>

          {analyticsOpen && (
            <div style={{ padding: "6px 12px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
              {availableAnalytics.map((id) => {
                const pinned = pinnedAnalyticsIds.has(id);
                return (
                  <label key={id} style={{
                    display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
                    padding: "6px 8px", borderRadius: 6,
                    background: pinned ? "rgba(55,138,221,0.15)" : "var(--drawer-card)",
                    border: `1px solid ${pinned ? "rgba(55,138,221,0.4)" : "var(--drawer-line-strong)"}`,
                  }}>
                    <input
                      type="checkbox"
                      checked={pinned}
                      onChange={() => toggleAnalyticsPin(id)}
                      style={{ accentColor: c.accent, width: 12, height: 12, flexShrink: 0 }}
                    />
                    <span style={{ fontSize: 11.5, color: pinned ? "var(--drawer-text)" : "var(--drawer-text-dim)", fontWeight: pinned ? 600 : 400 }}>
                      {ANALYTICS_META[id].label}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* footer */}
        <div style={{ padding: "12px 14px", borderTop: "1px solid var(--drawer-line)", display: "flex", flexDirection: "column", gap: 8 }}>
          {onReset && (
            <button
              onClick={onReset}
              style={{
                fontSize: 11, fontWeight: 600, color: "var(--drawer-text-dim)",
                background: "transparent", border: `1px solid var(--drawer-line-strong)`,
                borderRadius: 7, padding: "6px 10px", cursor: "pointer",
              }}
            >
              {resetLabel}
            </button>
          )}
          <div style={{ fontSize: 10.5, color: "var(--drawer-hint)", textAlign: "center" }}>
            {saving ? "Saving…" : "Changes saved automatically"}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function DashboardLayout({ kpis, attention, workOrderRows, overdueInvoices, analytics, features, dashLayout, isAdmin, hasPersonalOverride, userName }: Props) {
  const router = useRouter();
  const uiTheme = useUiTheme();
  const modern = uiTheme !== "classic";
  const nextgen = uiTheme === "nextgen";
  const threeLayer = useIsNextgen3Layer();
  const [layout, setLayout] = useState<DashLayoutItem[]>(() => resolveLayout(dashLayout, features));
  const [adaptOpen, setAdaptOpen] = useState(false);
  const [personalizeOpen, setPersonalizeOpen] = useState(false);
  const [saving, startSave] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);

  // Shared by both save paths. The layout is applied optimistically, but a
  // failed PATCH must NOT leave the screen showing a card that was never
  // persisted -- that reads as "it worked" until the next refresh silently
  // loses it (an expired mobile session was exactly this: the card appeared,
  // the 401 was swallowed, the refresh asked to add a widget again). On
  // failure the layout reverts and the reason is shown.
  function persistLayout(next: DashLayoutItem[], url: string, body: unknown) {
    const prev = layout;
    setLayout(next);
    setSaveError(null);
    startSave(async () => {
      try {
        const res = await fetch(url, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({} as { error?: string }));
          setLayout(prev);
          setSaveError(
            res.status === 401
              ? "Your session has expired — reload the page and sign in again, then retry."
              : `Could not save the layout (${j?.error ?? res.status}).`
          );
          return;
        }
        router.refresh();
      } catch {
        setLayout(prev);
        setSaveError("Could not reach the server — the layout was not saved.");
      }
    });
  }

  // Tenant-wide default -- admin-only, unchanged from before role-based
  // dashboards existed.
  function saveTenantLayout(next: DashLayoutItem[]) {
    persistLayout(next, "/api/settings/entities", { dashboard_layout: next });
  }

  // The caller's own personal tweaks, layered on top of whichever default
  // (a Business Role's dashboard, or the tenant-wide one) would otherwise
  // apply -- available to every user, not just admins.
  function savePersonalLayout(next: DashLayoutItem[]) {
    persistLayout(next, "/api/dashboard/layout", { layout: next });
  }

  function resetPersonalLayout() {
    setPersonalizeOpen(false);
    startSave(async () => {
      await fetch("/api/dashboard/layout", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layout: null }),
      });
      router.refresh();
    });
  }

  // Split layout into main (left col) and sidebar (right col)
  const visibleBlocks = layout.filter((b) => !b.hidden && blockAllowed(b.id, features));
  const mainBlocks = visibleBlocks.filter((b) => !SIDEBAR_IDS.has(b.id));
  const sidebarBlocks = visibleBlocks.filter((b) => SIDEBAR_IDS.has(b.id));

  // ── Derived data for the new widgets ──────────────────────────────────────

  const CASE_STAGE_TILES: { status: string; label: string; color: string }[] = [
    { status: "intake",     label: "Intake",     color: pillar.blue.base },
    { status: "inspection", label: "Inspection", color: pillar.teal.base },
    { status: "in_repair",  label: "In repair",  color: pillar.amber.base },
    { status: "ready",      label: "Ready",      color: pillar.green.base },
  ];
  const caseStatusCount = (status: string) => analytics.casesByStatus.find((s) => s.status === status)?.count ?? 0;
  const totalCases = analytics.casesByStatus.reduce((s, x) => s + x.count, 0);
  const resolvedCases = ["closed", "buyback", "scrapped"].reduce((s, st) => s + caseStatusCount(st), 0);
  const resolutionRate = totalCases > 0 ? (resolvedCases / totalCases) * 100 : 0;

  const revenueTarget = kpis.openQuoteValue;
  const revenueValue = analytics.invoiceTotals.invoiced;
  const revenuePct = revenueTarget > 0 ? Math.round((revenueValue / revenueTarget) * 100) : 0;

  // Overdue items merged across cases, work orders and invoices
  type OverdueItem = { id: string; task: string; account: string; deadline: string; days: number; href: string };
  const overdueCases: OverdueItem[] = attention
    .map((r) => ({ r, days: r.serviceCase.intake_at ? daysSince(r.serviceCase.intake_at) : 0 }))
    .filter(({ days }) => days >= 3)
    .map(({ r, days }) => ({
      id: `case-${r.serviceCase.id}`,
      task: `${r.serviceCase.ref} awaiting response`,
      account: r.account?.name ?? "—",
      deadline: r.serviceCase.intake_at!,
      days,
      href: ROUTES.case(r.serviceCase.id),
    }));
  const overdueWorkOrders: OverdueItem[] = workOrderRows
    .filter((r) => r.workOrder.scheduled_for && r.workOrder.scheduled_for < todayISO())
    .map((r) => ({
      id: `wo-${r.workOrder.id}`,
      task: `${r.workOrder.ref} — ${r.tech?.name ?? "unassigned"}`,
      account: r.account?.name ?? "—",
      deadline: r.workOrder.scheduled_for!,
      days: daysSince(r.workOrder.scheduled_for!),
      href: ROUTES.workOrder(r.workOrder.id),
    }));
  const overdueInvoiceItems: OverdueItem[] = overdueInvoices.map((inv) => ({
    id: `inv-${inv.id}`,
    task: `${inv.ref} — ${inr(Math.max(0, inv.total - inv.paid_amount))} due`,
    account: inv.accountName,
    deadline: inv.due_date,
    days: daysSince(inv.due_date),
    href: ROUTES.invoice(inv.id),
  }));
  const overdueItems = [...overdueCases, ...overdueWorkOrders, ...overdueInvoiceItems]
    .sort((a, b) => b.days - a.days)
    .slice(0, 8);

  // Work orders by technician (from currently active work orders)
  const techCounts = new Map<string, number>();
  workOrderRows.forEach((r) => {
    const name = r.tech?.name ?? "Unassigned";
    techCounts.set(name, (techCounts.get(name) ?? 0) + 1);
  });
  const techWorkload = [...techCounts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  // ── Next-gen AI brief ──────────────────────────────────────────────────────
  // Rule-based v1, computed from data already on the page -- honest and free.
  // A real LLM summary can replace the sentence later without changing the UI.
  function renderNextgenBrief() {
    // Module-aware: each chip source is gated by its module flag, and WFM
    // tenants get their own chips (pending corrections/leave) -- previously
    // this strip only knew CRM, so a WFM-only workspace was told "all caught
    // up" no matter how many approvals were actually waiting.
    const chips: { text: string; color: string; href: string }[] = [];
    if (features.quotations === true && analytics.quoteOverdueCount > 0) {
      chips.push({ text: `${analytics.quoteOverdueCount} quote${analytics.quoteOverdueCount > 1 ? "s" : ""} past validity`, color: "var(--nextgen-warn, #a16207)", href: ROUTES.quotations });
    }
    if (features.invoices === true && overdueInvoiceItems.length > 0) {
      const due = overdueInvoices.reduce((s, i) => s + Math.max(0, i.total - i.paid_amount), 0);
      chips.push({ text: `${overdueInvoiceItems.length} overdue invoice${overdueInvoiceItems.length > 1 ? "s" : ""} · ${inr(due)}`, color: "var(--nextgen-bad, #c2402f)", href: ROUTES.invoices });
    }
    if (features.quotations === true && kpis.awaitingApproval > 0) {
      chips.push({ text: `${kpis.awaitingApproval} quote${kpis.awaitingApproval > 1 ? "s" : ""} awaiting response`, color: "var(--modern-accent, #2e6be6)", href: ROUTES.quotations });
    }
    if (features.work_orders === true && overdueWorkOrders.length > 0) {
      chips.push({ text: `${overdueWorkOrders.length} work order${overdueWorkOrders.length > 1 ? "s" : ""} past schedule`, color: "var(--nextgen-bad, #c2402f)", href: ROUTES.workOrders });
    }
    if (features.wfm === true) {
      const pendingOf = (rows: Array<{ status: string; count: number }>) =>
        rows.filter((r) => r.status === "pending").reduce((s, r) => s + r.count, 0);
      const corr = pendingOf(analytics.wfmCorrectionsByStatus) + pendingOf(analytics.wfmRecheckByStatus);
      const leave = pendingOf(analytics.wfmLeaveRequestsByStatus);
      if (corr > 0) chips.push({ text: `${corr} correction${corr > 1 ? "s" : ""} awaiting review`, color: "var(--nextgen-warn, #a16207)", href: ROUTES.wfmCorrections });
      if (leave > 0) chips.push({ text: `${leave} leave request${leave > 1 ? "s" : ""} pending`, color: "var(--modern-accent, #2e6be6)", href: ROUTES.wfmLeave });
    }
    const headline = chips.length > 0
      ? `${chips.length} thing${chips.length > 1 ? "s" : ""} need${chips.length > 1 ? "" : "s"} your attention today.`
      : "You're all caught up — nothing needs attention right now.";

    return (
      <div style={{
        display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 16,
        background: "linear-gradient(120deg, var(--nextgen-ai-soft, #f2efff), transparent 70%)",
        border: "1px solid color-mix(in srgb, var(--nextgen-ai, #7a5cff) 22%, transparent)",
        borderRadius: "var(--card-radius)", padding: "14px 16px",
      }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: "var(--nextgen-ai, #7a5cff)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2L12 3z" />
          </svg>
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, color: c.ink }}><b style={{ fontWeight: 600 }}>{headline}</b></div>
          {chips.length > 0 && (
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              {chips.map((ch) => (
                <Link key={ch.text} href={ch.href} style={{
                  display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 550,
                  border: "1px solid var(--line)", background: "var(--card-bg)", borderRadius: 20,
                  padding: "4px 11px", color: c.ink, textDecoration: "none",
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: ch.color, flexShrink: 0 }} />
                  {ch.text}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Block renderers ────────────────────────────────────────────────────────

  function renderOverviewStrip() {
    // Modern: each tile gets a pillar tint (soft coloured card + matching
    // number/label ink) instead of uniform white -- classic keeps the flat
    // dark-green ledger numbers unchanged.
    const overduePillar = overdueItems.length > 0 ? pillar.red : pillar.green;
    // nextgen: neutral ink numbers, semantic colour only where it means something
    const numColor = (p: { fg: string }, classicColor: string) => (nextgen ? c.ink : modern ? p.fg : classicColor);
    const tiles: { label: string; href?: string; tint: { fg: string; bg: string; base: string }; content: React.ReactNode }[] = [
      {
        label: "Open pipeline",
        href: ROUTES.quotations,
        tint: pillar.blue,
        content: (
          <>
            <div style={{ ...(modern ? {} : serifNum), fontSize: kpiNumFontSize(inr(kpis.openQuoteValue)), fontWeight: 700, color: numColor(pillar.blue, ledger.accent), lineHeight: 1.15, whiteSpace: "nowrap" }}>{inr(kpis.openQuoteValue)}</div>
            <div style={{ fontSize: 11, color: modern ? c.muted : c.hint, marginTop: 6 }}>{kpis.awaitingApproval} awaiting response</div>
            {nextgen && analytics.quoteTrend.length > 1 && (
              <Sparkline values={analytics.quoteTrend.map((t) => t.cumulative)} stroke="var(--modern-accent, #2e6be6)" />
            )}
          </>
        ),
      },
      {
        label: "Case resolution",
        href: ROUTES.cases,
        tint: pillar.teal,
        content: (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <ProgressRing pct={resolutionRate} color={nextgen ? "var(--nextgen-good, #148a5b)" : modern ? pillar.teal.base : ledger.accent} size={42} stroke={5} />
            <div style={{ fontSize: 11, color: modern ? c.muted : c.hint, lineHeight: 1.3 }}>{resolvedCases} of {totalCases}<br />resolved</div>
          </div>
        ),
      },
      {
        label: "Overdue",
        tint: overduePillar,
        content: (
          <>
            <div style={{ ...(modern ? {} : serifNum), fontSize: 25, fontWeight: 700, color: nextgen ? (overdueItems.length > 0 ? "var(--nextgen-bad, #c2402f)" : c.ink) : modern ? overduePillar.fg : overdueItems.length > 0 ? "#b5451f" : ledger.accent, lineHeight: 1 }}>{overdueItems.length}</div>
            <div style={{ fontSize: 11, color: modern ? c.muted : c.hint, marginTop: 6 }}>{overdueItems.length > 0 ? "need attention" : "all caught up"}</div>
          </>
        ),
      },
      {
        label: "Active work orders",
        href: ROUTES.workOrders,
        tint: pillar.purple,
        content: (
          <>
            <div style={{ ...(modern ? {} : serifNum), fontSize: 25, fontWeight: 700, color: numColor(pillar.purple, ledger.accent), lineHeight: 1 }}>{kpis.activeWorkOrders}</div>
            <div style={{ fontSize: 11, color: modern ? c.muted : c.hint, marginTop: 6 }}>{kpis.inRepair} in repair</div>
          </>
        ),
      },
    ];
    // Modern: each tile is its own elevated, hover-lifting card (real
    // structural difference, not just a recolor) -- classic keeps every tile
    // nested inside one flat bordered strip, unchanged.
    const tileBoxStyle: React.CSSProperties = modern
      ? { padding: nextgen ? "16px 16px 12px" : "16px 18px", borderRadius: "var(--card-radius)", border: "1px solid var(--line)", background: "var(--card-bg)" }
      : { padding: "13px 16px", borderRadius: 8, border: `1px solid ${ledger.line}`, background: c.panel2 };
    const tileLabelStyle: React.CSSProperties = nextgen
      ? { fontSize: 12.5, fontWeight: 550, color: c.muted, marginBottom: 6 }
      : modern
      ? { fontSize: 10.5, fontWeight: 700, color: "var(--modern-accent)", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 }
      : { fontSize: 10.5, fontWeight: 600, color: c.hint, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 8 };

    const tilesRow = (
      <div style={{ display: "flex", flexWrap: "wrap", gap: modern ? 14 : 10 }}>
        {tiles.map((t) => {
          const box = (
            <div
              className={modern ? "modern-lift-gold" : undefined}
              style={{
                ...tileBoxStyle,
                ...(modern && !nextgen ? { background: t.tint.bg, borderColor: `${t.tint.base}55` } : {}),
              }}
            >
              <div style={{ ...tileLabelStyle, ...(modern && !nextgen ? { color: t.tint.fg } : {}) }}>{t.label}</div>
              {t.content}
            </div>
          );
          return t.href
            ? <Link key={t.label} href={t.href} style={{ textDecoration: "none", display: "block", flex: modern ? "1 1 180px" : "1 1 150px", minWidth: modern ? 180 : 150 }}>{box}</Link>
            : <div key={t.label} style={{ flex: modern ? "1 1 180px" : "1 1 150px", minWidth: modern ? 180 : 150 }}>{box}</div>;
        })}
      </div>
    );

    const stageRowContent = (
      <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
        {CASE_STAGE_TILES.map((s) => (
          <Link key={s.status} href={`${ROUTES.cases}?status=${s.status}`} style={{ display: "flex", alignItems: "center", gap: 6, textDecoration: "none" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
            <span style={{ fontSize: 11.5, color: c.muted }}>{s.label}</span>
            <span style={{ ...(modern ? {} : serifNum), fontSize: 12, fontWeight: 700, color: c.ink }}>{caseStatusCount(s.status)}</span>
          </Link>
        ))}
      </div>
    );

    if (modern) {
      return (
        <>
          {tilesRow}
          <div style={{ ...cardStyle, marginTop: 12, padding: "12px 16px" }}>{stageRowContent}</div>
        </>
      );
    }

    return (
      <section style={{ ...cardStyle, padding: 14 }}>
        {tilesRow}
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${ledger.line}` }}>{stageRowContent}</div>
      </section>
    );
  }

  function renderRevenueCard() {
    return (
      <section style={cardStyle}>
        <div style={nextgen ? { fontSize: 13, fontWeight: 620, color: c.ink, marginBottom: 10 } : { fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 }}>Revenue</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
          <span style={{ ...serifNum, fontSize: kpiNumFontSize(inr(revenueValue)), fontWeight: 700, color: ledger.accent, whiteSpace: "nowrap" }}>{inr(revenueValue)}</span>
          {revenueTarget > 0 && <span style={{ fontSize: 12, color: c.hint }}>of {inr(revenueTarget)} pipeline</span>}
        </div>
        <div style={{ height: 6, background: ledger.accentSoft, borderRadius: 3, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${Math.min(100, revenuePct)}%`, background: ledger.accent, borderRadius: 3 }} />
        </div>
        <div style={{ fontSize: 11, color: c.hint, marginTop: 6 }}>{revenuePct}% of open pipeline invoiced</div>
      </section>
    );
  }

  function renderInvoiceBudget() {
    const { invoiced, paid, outstanding } = analytics.invoiceTotals;
    if (invoiced === 0) return null;
    return (
      <section style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.6 }}>Invoiced vs paid</div>
          <Link href={ROUTES.invoices} style={{ fontSize: 11, color: ledger.accent, textDecoration: "none", fontWeight: 600 }}>All invoices →</Link>
        </div>
        <VBarTriplet bars={[
          { label: "Invoiced", value: invoiced, color: ledger.line },
          { label: "Paid", value: paid, color: ledger.accent },
          { label: "Outstanding", value: outstanding, color: outstanding > 0 ? "#b5451f" : ledger.line },
        ]} />
      </section>
    );
  }

  function renderOverdueTasks() {
    return (
      <section style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px 10px", borderBottom: `1px solid ${ledger.line}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 24, height: 24, borderRadius: 6, background: overdueItems.length > 0 ? "#fbeee7" : ledger.accentSoft, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {overdueItems.length > 0 ? <AlertTriangle size={12} color="#b5451f" /> : <CheckIcon size={12} color={ledger.accent} />}
            </div>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: c.ink }}>Overdue tasks</span>
          </div>
        </div>
        {overdueItems.length === 0 ? (
          <div style={{ padding: "24px 16px", textAlign: "center", color: c.hint, fontSize: 12.5 }}>Nothing overdue — all caught up</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "6px 16px 8px", fontSize: 10, color: c.hint, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, borderBottom: `1px solid ${ledger.line}` }}>Overdue</th>
                <th style={{ textAlign: "left", padding: "6px 12px 8px", fontSize: 10, color: c.hint, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, borderBottom: `1px solid ${ledger.line}` }}>Task</th>
                <th style={{ textAlign: "left", padding: "6px 12px 8px", fontSize: 10, color: c.hint, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, borderBottom: `1px solid ${ledger.line}` }}>Deadline</th>
                <th style={{ textAlign: "left", padding: "6px 16px 8px", fontSize: 10, color: c.hint, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, borderBottom: `1px solid ${ledger.line}` }}>Account</th>
              </tr>
            </thead>
            <tbody>
              {overdueItems.map((item) => (
                <tr key={item.id} className="dash-row" style={{ borderTop: `1px solid ${ledger.line}` }}>
                  <td style={{ padding: "9px 16px" }}>
                    <span style={{ ...serifNum, fontSize: 11.5, fontWeight: 700, color: "#b5451f" }}>{item.days} day{item.days !== 1 ? "s" : ""}</span>
                  </td>
                  <td style={{ padding: "9px 12px" }}>
                    <Link href={item.href} style={{ fontSize: 12.5, color: c.ink, textDecoration: "none", fontWeight: 500 }}>{item.task}</Link>
                  </td>
                  <td style={{ padding: "9px 12px", fontSize: 12, color: c.muted }}>{fmtDate(item.deadline)}</td>
                  <td style={{ padding: "9px 16px", fontSize: 12, color: c.muted }}>{item.account}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    );
  }

  function renderTechWorkload() {
    if (techWorkload.length === 0) return null;
    return (
      <section style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.6 }}>Work orders by technician</div>
          <Link href={ROUTES.technicians} style={{ fontSize: 11, color: ledger.accent, textDecoration: "none", fontWeight: 600 }}>All →</Link>
        </div>
        <MiniHBar rows={techWorkload} colorFn={() => ledger.accent} />
      </section>
    );
  }

  function renderTopAccounts() {
    if (analytics.topAccountsByRevenue.length === 0) return null;
    return (
      <section style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.6 }}>Top accounts by revenue</div>
          <Link href={ROUTES.accounts} style={{ fontSize: 11, color: ledger.accent, textDecoration: "none", fontWeight: 600 }}>All →</Link>
        </div>
        <MiniHBar rows={analytics.topAccountsByRevenue.map((a) => ({ label: a.name, value: a.value, href: ROUTES.account(a.accountId) }))} colorFn={() => ledger.accent} />
      </section>
    );
  }

  function renderQuickCreate() {
    return (
      <section style={{ ...cardStyle, padding: "14px 14px 12px" }}>
        <div style={nextgen ? { fontSize: 13, fontWeight: 620, color: c.ink, marginBottom: 10 } : { fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Quick create</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {features.accounts === true && <QCBtn href={ROUTES.accountNew}   label="New account"    icon={<Globe size={13} color={pillar.purple.base} />}   tint={pillar.purple} />}
          {features.cases === true && <QCBtn href={ROUTES.caseNew}      label="New case"       icon={<Activity size={13} color={pillar.teal.base} />}  tint={pillar.teal} />}
          {features.contacts === true && <QCBtn href={ROUTES.contactNew}   label="New contact"    icon={<Phone size={13} color={pillar.blue.base} />}     tint={pillar.blue} />}
          {features.quotations === true && <QCBtn href={ROUTES.quotationNew} label="New quotation"  icon={<Package size={13} color={pillar.amber.base} />}  tint={pillar.amber} />}
          {features.assets === true && <QCBtn href={ROUTES.assetNew}     label="New asset"      icon={<Gear size={13} color={pillar.green.base} />}     tint={pillar.green} />}
        </div>
      </section>
    );
  }

  function renderMainBlock(block: DashLayoutItem) {
    if (isAnalyticsId(block.id)) {
      return <div key={block.id}>{renderWidget(block.id, analytics, blockSize(block))}</div>;
    }
    switch (block.id) {
      case "overview_strip": return <div key={block.id}>{renderOverviewStrip()}</div>;
      case "revenue_card":   return <div key={block.id}>{renderRevenueCard()}</div>;
      case "invoice_budget": return <div key={block.id}>{renderInvoiceBudget()}</div>;
      case "overdue_tasks":  return <div key={block.id}>{renderOverdueTasks()}</div>;
      case "tech_workload":  return <div key={block.id}>{renderTechWorkload()}</div>;
      case "top_accounts":   return <div key={block.id}>{renderTopAccounts()}</div>;
      case "wfm_summary":    return <div key={block.id}><WfmSummaryWidget /></div>;
      default: return null;
    }
  }

  function renderSidebarBlock(block: DashLayoutItem) {
    switch (block.id) {
      case "quick_create": return <div key={block.id}>{renderQuickCreate()}</div>;
      default: return null;
    }
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 22, display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 11, color: c.hint, fontWeight: 500, marginBottom: 3 }}>{todayStr()}</div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: c.ink, lineHeight: 1.2 }}>{greet()}{userName ? `, ${userName}` : ""}</h1>
        </div>
        {/* Not desk-only: on a phone the only way into the layout drawers used
            to be the empty-state button -- so a mobile user could ADD their
            first card but never manage the layout again after that. */}
        <div style={{ display: "flex", gap: 8, flexShrink: 0, marginTop: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {isAdmin && (
            <button
              onClick={() => setAdaptOpen(true)}
              style={{
                fontSize: 11.5, fontWeight: 600, color: c.accent,
                background: "transparent", border: `1px solid ${c.accent}`,
                borderRadius: 7, padding: "6px 14px", cursor: "pointer",
              }}
            >
              ⚙ Adapt dashboard
            </button>
          )}
          <button
            onClick={() => setPersonalizeOpen(true)}
            style={{
              fontSize: 11.5, fontWeight: 600, color: c.hint,
              background: "transparent", border: `1px solid ${c.line}`,
              borderRadius: 7, padding: "6px 14px", cursor: "pointer",
            }}
          >
            🧑 My layout
          </button>
        </div>
      </div>

      {nextgen && renderNextgenBrief()}

      {/* Engagement layer (3-layer theme): accounts drifting past their own
          ordering rhythm, and what the lost quotes are saying. Both render
          nothing until the tenant has real data behind them. */}
      {threeLayer && features.quotations === true && <SilenceDetector />}
      {threeLayer && features.quotations === true && <LossIntelligence />}

      {/* Two-column layout */}
      {/* Only reserve the 280px right rail when there is actually something to
          put in it. A tenant with no sidebar widgets (e.g. a WFM-only
          dashboard) was left with a dead 280px column down the right edge. */}
      {/* A dashboard with nothing on it reads as broken, not as empty. This
          is reachable honestly -- every block hidden by choice -- so it says
          what happened and how to undo it, rather than leaving a void. */}
      {visibleBlocks.length === 0 && (
        <div style={{ ...cardStyle, textAlign: "center", padding: "34px 20px" }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: c.ink }}>Your dashboard is empty</div>
          <div style={{ fontSize: 12.5, color: c.muted, marginTop: 6, lineHeight: 1.6, maxWidth: 420, margin: "6px auto 0" }}>
            Every card is currently hidden. Use{" "}
            <b>{isAdmin ? "Adapt dashboard" : "My layout"}</b> above to bring back the ones you want —
            or reach the workcenters you use from the menu.
          </div>
          <button
            onClick={() => (isAdmin ? setAdaptOpen(true) : setPersonalizeOpen(true))}
            style={{
              marginTop: 14, padding: "9px 18px", borderRadius: 8, cursor: "pointer", font: "inherit",
              fontSize: 13, fontWeight: 650, border: "none", background: c.accent, color: "#fff",
            }}
          >
            Choose cards
          </button>
        </div>
      )}

      <div className="dash-outer" style={{ display: "grid", gridTemplateColumns: sidebarBlocks.length > 0 ? "1fr 280px" : "1fr", gap: 14, alignItems: "start" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
          {mainBlocks.map((b) => (
            <div key={b.id} style={SIZE_FLEX[blockSize(b)]}>
              {renderMainBlock(b)}
            </div>
          ))}
        </div>
        {sidebarBlocks.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {sidebarBlocks.map((b) => renderSidebarBlock(b))}
          </div>
        )}
      </div>

      {/* Adapt drawer -- tenant-wide default, admin-only */}
      {adaptOpen && (
        <AdaptDrawer
          layout={layout}
          features={features}
          onLayoutChange={saveTenantLayout}
          onClose={() => setAdaptOpen(false)}
          saving={saving}
        />
      )}

      {/* Personalize drawer -- the caller's own layer on top of whichever
          default (role-derived or tenant-wide) would otherwise apply */}
      {personalizeOpen && (
        <AdaptDrawer
          layout={layout}
          features={features}
          onLayoutChange={savePersonalLayout}
          onClose={() => setPersonalizeOpen(false)}
          saving={saving}
          title="My dashboard"
          subtitle="Personal changes — only you see these"
          onReset={hasPersonalOverride ? resetPersonalLayout : undefined}
          resetLabel="Reset to my default"
        />
      )}

      {/* A failed save must be seen -- above the drawer (zIndex 100), since
          that's where the action that failed just happened. */}
      {saveError && (
        <div
          role="alert"
          style={{
            position: "fixed", left: 12, right: 12, bottom: "calc(16px + env(safe-area-inset-bottom, 0px))",
            zIndex: 200, display: "flex", alignItems: "center", gap: 10,
            maxWidth: 480, margin: "0 auto", padding: "11px 14px", borderRadius: 10,
            background: "#3b1219", border: "1px solid #e5484d", color: "#ffd1d4",
            fontSize: 12.5, fontWeight: 600, boxShadow: "0 8px 24px rgba(0,0,0,.35)",
          }}
        >
          <span style={{ flex: 1 }}>{saveError}</span>
          <button
            onClick={() => setSaveError(null)}
            aria-label="Dismiss"
            style={{ background: "none", border: "none", color: "#ffd1d4", fontSize: 15, cursor: "pointer", padding: "2px 4px", lineHeight: 1 }}
          >
            ✕
          </button>
        </div>
      )}

      <style>{`
        .dash-row:hover { background: ${c.panel2} !important; }
        @media (max-width: 860px) {
          .dash-outer { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
