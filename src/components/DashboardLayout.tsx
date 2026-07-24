"use client";

import { useState, useTransition, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ServiceCase, Account, WorkOrder, Activity as ActivityRec } from "@/lib/types";
import { c, pillar, type PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { ROUTES } from "@/lib/constants";
import type { AnalyticsMetricId, TenantFeatures, DashLayoutItem } from "@/lib/constants";
import { AlertTriangle, Activity, CheckIcon, Package, Phone, Gear, Globe, Wrench, CalendarCheck, Zap, Clipboard, Battery } from "@/components/Icons";
import type { AnalyticsData } from "@/lib/data/labels";

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
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SIDEBAR_IDS = new Set(["quick_create"]);

const NATIVE_META: Record<string, { label: string; sidebar?: boolean }> = {
  overview_strip:  { label: "Overview" },
  revenue_card:    { label: "Revenue" },
  invoice_budget:  { label: "Invoiced vs paid" },
  overdue_tasks:   { label: "Overdue tasks" },
  tech_workload:   { label: "Work orders by technician" },
  top_accounts:    { label: "Top accounts by revenue" },
  quick_create:    { label: "Quick create", sidebar: true },
};

const ANALYTICS_META: Record<AnalyticsMetricId, { label: string; feature?: keyof TenantFeatures }> = {
  accounts:                { label: "Accounts" },
  contacts:                { label: "Contacts" },
  assets:                  { label: "Assets" },
  open_cases:              { label: "Open cases" },
  work_orders:             { label: "Work orders" },
  contracts:               { label: "AMC contracts",    feature: "amc" },
  leads:                   { label: "Leads",            feature: "leads" },
  technicians:             { label: "Technicians" },
  accounts_by_type:        { label: "Accounts by type" },
  lead_funnel:             { label: "Lead funnel",      feature: "leads" },
  assets_by_kind:          { label: "Assets by kind" },
  quote_trend:             { label: "Quote pipeline" },
  case_status:             { label: "Case status" },
  work_order_status:       { label: "Work order status" },
  technician_availability: { label: "Technician availability" },
  revenue_overview:        { label: "Revenue overview" },
  invoices_by_status:      { label: "Invoices by status", feature: "invoices" },
  loaner_availability:     { label: "Loaner availability" },
  recent_activity:         { label: "Recent activity (analytics)" },
  account_news:            { label: "Client news" },
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
  { id: "accounts",     label: "Accounts",      blocks: [
    { id: "accounts" }, { id: "accounts_by_type" }, { id: "top_accounts" }, { id: "account_news" },
  ] },
  { id: "contacts",     label: "Contacts",      blocks: [{ id: "contacts" }] },
  { id: "quotations",   label: "Quotations",    blocks: [{ id: "quote_trend" }, { id: "revenue_card" }] },
  { id: "cases",        label: "Cases",         blocks: [{ id: "open_cases" }, { id: "case_status" }] },
  { id: "work_orders",  label: "Work orders",   blocks: [
    { id: "work_orders" }, { id: "work_order_status" }, { id: "tech_workload" },
  ] },
  { id: "assets",       label: "Assets",        blocks: [
    { id: "assets" }, { id: "assets_by_kind" }, { id: "loaner_availability", size: "half" },
  ] },
  { id: "contracts",    label: "AMC / Contracts", feature: "amc", blocks: [{ id: "contracts", size: "half" }] },
  { id: "leads",        label: "Leads",         feature: "leads", blocks: [{ id: "leads" }, { id: "lead_funnel" }] },
  { id: "technicians",  label: "Technicians",   blocks: [
    { id: "technicians" }, { id: "technician_availability" }, { id: "tech_workload" },
  ] },
  { id: "invoices",     label: "Invoices",      feature: "invoices", blocks: [
    { id: "invoice_budget" }, { id: "invoices_by_status" }, { id: "revenue_overview" },
  ] },
];

function resolveLayout(saved: DashLayoutItem[]): DashLayoutItem[] {
  if (!saved || saved.length === 0) return DEFAULT_LAYOUT;
  // Ensure native blocks that aren't in saved layout appear (as hidden) so user can un-hide them
  const savedIds = new Set(saved.map((b) => b.id));
  const missing = Object.keys(NATIVE_META).filter((id) => !savedIds.has(id));
  return [...saved, ...missing.map((id) => ({ id, hidden: true }))];
}

function isAnalyticsId(id: string): id is AnalyticsMetricId {
  return id in ANALYTICS_META;
}

// Single/dual stat-tile widgets are narrow by nature -- default them to compact
// so they sit side by side in a wrapping row instead of each claiming a
// full-width row of mostly empty space. Users can still override via block.size.
const COMPACT_ANALYTICS_IDS = new Set<AnalyticsMetricId>([
  "accounts", "contacts", "assets", "open_cases", "work_orders", "leads", "technicians",
]);

function blockSize(block: DashLayoutItem): "compact" | "half" | "full" {
  if (block.size) return block.size;
  return isAnalyticsId(block.id) && COMPACT_ANALYTICS_IDS.has(block.id) ? "compact" : "full";
}

const SIZE_FLEX: Record<"compact" | "half" | "full", React.CSSProperties> = {
  // flex-grow: 0 on compact/half so a block sitting alone on its row keeps its
  // intended width instead of stretching to fill the empty space beside it.
  compact: { flex: "0 1 220px", minWidth: 190 },
  half:    { flex: "0 1 calc(50% - 7px)", minWidth: 260 },
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
  { thumb: "linear-gradient(135deg, #0f6b5c, #1d9e75)", pillBg: "#e4efec", pillFg: "#0f6b5c" },
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
  rows: { label: string; value: number; href?: string }[];
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
            <span style={{ ...serifNum, fontSize: 11.5, fontWeight: 700, color: c.ink, minWidth: 28, textAlign: "right", flexShrink: 0 }}>
              {row.value}
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
            <span style={{ fontSize: 12, fontWeight: 600, color: i >= 2 ? "#fff" : c.ink }}>{s.stage}</span>
            <span style={{ ...serifNum, fontSize: 15, fontWeight: 700, color: i >= 2 ? "#fff" : c.ink }}>{s.count}</span>
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

function StatTile({ value, label, icon, href }: { value: number | string; label: string; icon: React.ReactNode; href: string }) {
  return (
    <Link href={href} style={{ textDecoration: "none", display: "flex", flexDirection: "column", gap: 12, flex: 1, padding: "14px 16px" }}>
      <div style={{ width: 28, height: 28, borderRadius: 7, background: ledger.accentSoft, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {icon}
      </div>
      <div>
        <div style={{ ...serifNum, fontSize: 27, fontWeight: 700, color: ledger.accent, lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: 11, color: c.hint, marginTop: 5 }}>{label}</div>
      </div>
    </Link>
  );
}

function AnalyticsCard({ title, href, children }: { title: string; href: string; children: React.ReactNode }) {
  return (
    <div style={{ ...cardStyle, padding: 0, overflow: "hidden", boxShadow: "0 1px 2px rgba(16,24,40,.04), 0 1px 6px rgba(16,24,40,.03)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 14px 9px", borderBottom: `1px solid ${ledger.line}` }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.6 }}>{title}</span>
        <Link href={href} style={{ fontSize: 10.5, color: ledger.accent, textDecoration: "none", fontWeight: 600 }}>Full view →</Link>
      </div>
      <div style={{ padding: "12px 14px" }}>{children}</div>
    </div>
  );
}

// ── Analytics widget renderer ─────────────────────────────────────────────────

function renderWidget(id: AnalyticsMetricId, a: AnalyticsData, size: "compact" | "half" | "full"): React.ReactNode {
  const COLORS = [pillar.blue.base, pillar.teal.base, pillar.amber.base, pillar.purple.base, pillar.green.base];
  const big = size !== "compact";
  switch (id) {
    case "accounts":        return <AnalyticsCard title="Accounts" href={ROUTES.accounts}><StatTile value={a.totals.accounts} label="Total accounts" icon={<Globe size={14} color={ledger.accent} />} href={ROUTES.accounts} /></AnalyticsCard>;
    case "contacts":        return <AnalyticsCard title="Contacts" href={ROUTES.contacts}><StatTile value={a.totals.contacts} label="Total contacts" icon={<Phone size={14} color={ledger.accent} />} href={ROUTES.contacts} /></AnalyticsCard>;
    case "assets":          return <AnalyticsCard title="Assets" href={ROUTES.assets}><StatTile value={a.totals.customerAssets} label="Customer assets" icon={<Gear size={14} color={ledger.accent} />} href={ROUTES.assets} /></AnalyticsCard>;
    case "open_cases":      return <AnalyticsCard title="Open cases" href={ROUTES.cases}><StatTile value={a.totals.openCases} label="Open cases" icon={<Activity size={14} color={ledger.accent} />} href={ROUTES.cases} /></AnalyticsCard>;
    case "work_orders":     return <AnalyticsCard title="Work orders" href={ROUTES.workOrders}><StatTile value={a.totals.workOrders} label="Total work orders" icon={<Wrench size={14} color={ledger.accent} />} href={ROUTES.workOrders} /></AnalyticsCard>;
    case "contracts":       return <AnalyticsCard title="AMC contracts" href={ROUTES.amc}><div style={{ display: "flex" }}><StatTile value={a.contractStats.activeCount} label="Active" icon={<CalendarCheck size={14} color={ledger.accent} />} href={ROUTES.amc} /><StatTile value={inr(a.contractStats.totalValue)} label="Total value" icon={<CalendarCheck size={14} color={ledger.accent} />} href={ROUTES.amc} /></div></AnalyticsCard>;
    case "leads":           return <AnalyticsCard title="Leads" href={ROUTES.leads}><StatTile value={a.totals.leads} label="Total leads" icon={<Zap size={14} color={ledger.accent} />} href={ROUTES.leads} /></AnalyticsCard>;
    case "technicians":     return <AnalyticsCard title="Technicians" href={ROUTES.technicians}><StatTile value={a.totals.technicians} label="Total technicians" icon={<Clipboard size={14} color={ledger.accent} />} href={ROUTES.technicians} /></AnalyticsCard>;
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
    case "quote_trend":      return <AnalyticsCard title="Quote pipeline" href={ROUTES.quotations}><MiniHBar rows={a.quotesByStatus.map((x) => ({ label: x.label, value: x.count, href: `${ROUTES.quotations}?status=${x.status}` }))} colorFn={(i) => COLORS[i % COLORS.length]} /></AnalyticsCard>;
    case "case_status":      return <AnalyticsCard title="Case status" href={ROUTES.cases}><MiniHBar rows={a.casesByStatus.map((x) => ({ label: x.label, value: x.count }))} colorFn={(i) => COLORS[i % COLORS.length]} /></AnalyticsCard>;
    case "work_order_status": return <AnalyticsCard title="Work order status" href={ROUTES.workOrders}><MiniHBar rows={a.workOrdersByStatus.map((x) => ({ label: x.label, value: x.count, href: `${ROUTES.workOrders}?status=${x.status}` }))} colorFn={(i) => [pillar.amber.base, pillar.blue.base, pillar.teal.base][i % 3]} /></AnalyticsCard>;
    case "technician_availability": return <AnalyticsCard title="Technician availability" href={ROUTES.technicians}><MiniHBar rows={a.techniciansByStatus.map((x) => ({ label: x.label, value: x.count, href: `${ROUTES.technicians}?status=${x.status}` }))} colorFn={(i) => [pillar.teal.base, pillar.amber.base, c.muted][i]} /></AnalyticsCard>;
    case "revenue_overview": return <AnalyticsCard title="Revenue overview" href={ROUTES.invoices}><MiniHBar rows={[{ label: "AMC contracts", value: a.contractStats.totalValue, href: ROUTES.amc }, { label: "Quote pipeline", value: a.quotesByStatus.reduce((s, x) => s + x.value, 0), href: ROUTES.quotations }, ...a.invoicesByStatus.map((inv) => ({ label: `Invoices (${inv.label})`, value: inv.value, href: `${ROUTES.invoices}?status=${inv.status}` }))]} colorFn={(i) => [pillar.green.base, pillar.blue.base, pillar.purple.base, pillar.teal.base][i % 4]} /></AnalyticsCard>;
    case "invoices_by_status": return <AnalyticsCard title="Invoices by status" href={ROUTES.invoices}><MiniHBar rows={a.invoicesByStatus.map((x) => ({ label: x.label, value: x.count, href: `${ROUTES.invoices}?status=${x.status}` }))} colorFn={(i) => COLORS[i % COLORS.length]} /></AnalyticsCard>;
    case "loaner_availability": return <AnalyticsCard title="Loaner availability" href={ROUTES.assets}><div style={{ display: "flex" }}><StatTile value={a.loanerStock.available} label="Available" icon={<Battery size={14} color={ledger.accent} />} href={ROUTES.assets} /><StatTile value={a.loanerStock.onLoan} label="On loan" icon={<Package size={14} color={ledger.accent} />} href={ROUTES.assets} /></div></AnalyticsCard>;
    case "recent_activity":  return <AnalyticsCard title="Recent activity" href={ROUTES.accounts}><div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{a.recentActivity.slice(0, 4).map((act, i) => (<div key={i} style={{ fontSize: 11, color: c.muted, borderLeft: `2px solid ${ledger.accentSoft}`, paddingLeft: 9 }}><div style={{ color: c.ink }}>{act.text}</div><div style={{ fontSize: 10, color: c.hint, marginTop: 1 }}>{act.accountName} · {fmtDate(act.at)}</div></div>))}</div></AnalyticsCard>;
    case "account_news":     return <AnalyticsCard title="Client news" href={ROUTES.accounts}>{a.accountNews.length === 0 ? (
        <div style={{ fontSize: 11.5, color: c.hint, textAlign: "center", padding: "10px 0" }}>No recent news for your top accounts</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {a.accountNews.map((n, i) => {
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
        </div>
      )}</AnalyticsCard>;
    default: return null;
  }
}

// ── Sidebar sub-components ────────────────────────────────────────────────────

function QCBtn({ href, label, icon, bg }: { href: string; label: string; icon: React.ReactNode; bg: string }) {
  return (
    <Link href={href} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 11px", borderRadius: 8, background: bg, border: `1px solid ${c.line}`, textDecoration: "none", fontSize: 12.5, color: c.ink, fontWeight: 600 }}>
      {icon}{label}
    </Link>
  );
}

// ── Adapt drawer ──────────────────────────────────────────────────────────────

interface DrawerProps {
  layout: DashLayoutItem[];
  features: TenantFeatures;
  onLayoutChange: (next: DashLayoutItem[]) => void;
  onClose: () => void;
  saving: boolean;
}

function AdaptDrawer({ layout, features, onLayoutChange, onClose, saving }: DrawerProps) {
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
        background: "#0e1a28", zIndex: 100, display: "flex", flexDirection: "column",
        boxShadow: "-4px 0 24px rgba(0,0,0,0.35)",
      }}>
        {/* header */}
        <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>Adapt dashboard</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginTop: 2 }}>Drag to reorder · click eye to hide</div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.5)", fontSize: 18, cursor: "pointer", lineHeight: 1, padding: "2px 6px" }}>✕</button>
        </div>

        {/* block list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 0" }}>
          {/* Quick add — per-object starter bundles */}
          <div style={{ padding: "0 12px 8px", borderBottom: "1px solid rgba(255,255,255,0.07)", marginBottom: 6 }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
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
                    color: "#bcd9f7",
                  }}
                >
                  + {bundle.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ padding: "0 12px 6px", fontSize: 9.5, fontWeight: 700, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 1 }}>
            Drag to reorder
          </div>
          {layout.map((block, i) => {
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
                  <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 14, flexShrink: 0, userSelect: "none" }}>⠿</span>
                  <span style={{
                    flex: 1, fontSize: 12, fontWeight: 500,
                    color: block.hidden ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.85)",
                    textDecoration: block.hidden ? "line-through" : "none",
                  }}>
                    {label}
                    {isAnalyticsId(block.id) && (
                      <span style={{ fontSize: 9.5, color: "rgba(255,255,255,0.25)", marginLeft: 5 }}>analytics</span>
                    )}
                  </span>
                  <button
                    onClick={() => toggleHidden(i)}
                    title={block.hidden ? "Show" : "Hide"}
                    style={{
                      background: "transparent", border: "none", cursor: "pointer", padding: "2px 4px",
                      fontSize: 14, lineHeight: 1, color: block.hidden ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.65)",
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
                          background: currentSize === sz ? "rgba(55,138,221,0.22)" : "rgba(255,255,255,0.05)",
                          border: `1px solid ${currentSize === sz ? "rgba(55,138,221,0.55)" : "rgba(255,255,255,0.08)"}`,
                          color: currentSize === sz ? "#bcd9f7" : "rgba(255,255,255,0.4)",
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
          <div style={{ padding: "14px 12px 6px", borderTop: "1px solid rgba(255,255,255,0.07)", marginTop: 6 }}>
            <button
              onClick={() => setAnalyticsOpen((o) => !o)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%",
                background: "transparent", border: "none", cursor: "pointer", padding: 0,
              }}
            >
              <span style={{ fontSize: 9.5, fontWeight: 700, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 1 }}>
                Analytics widgets
              </span>
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>{analyticsOpen ? "▴" : "▾"}</span>
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
                    background: pinned ? "rgba(55,138,221,0.15)" : "rgba(255,255,255,0.04)",
                    border: `1px solid ${pinned ? "rgba(55,138,221,0.4)" : "rgba(255,255,255,0.07)"}`,
                  }}>
                    <input
                      type="checkbox"
                      checked={pinned}
                      onChange={() => toggleAnalyticsPin(id)}
                      style={{ accentColor: c.accent, width: 12, height: 12, flexShrink: 0 }}
                    />
                    <span style={{ fontSize: 11.5, color: pinned ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.5)", fontWeight: pinned ? 600 : 400 }}>
                      {ANALYTICS_META[id].label}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* footer */}
        <div style={{ padding: "12px 14px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.3)", textAlign: "center" }}>
            {saving ? "Saving…" : "Changes saved automatically"}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function DashboardLayout({ kpis, attention, workOrderRows, overdueInvoices, analytics, features, dashLayout, isAdmin }: Props) {
  const router = useRouter();
  const [layout, setLayout] = useState<DashLayoutItem[]>(() => resolveLayout(dashLayout));
  const [adaptOpen, setAdaptOpen] = useState(false);
  const [saving, startSave] = useTransition();

  function saveLayout(next: DashLayoutItem[]) {
    setLayout(next);
    startSave(async () => {
      await fetch("/api/settings/entities", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dashboard_layout: next }),
      });
      router.refresh();
    });
  }

  // Split layout into main (left col) and sidebar (right col)
  const visibleBlocks = layout.filter((b) => !b.hidden);
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

  // ── Block renderers ────────────────────────────────────────────────────────

  function renderOverviewStrip() {
    const tiles: { label: string; href?: string; content: React.ReactNode }[] = [
      {
        label: "Open pipeline",
        href: ROUTES.quotations,
        content: (
          <>
            <div style={{ ...serifNum, fontSize: 25, fontWeight: 700, color: ledger.accent, lineHeight: 1 }}>{inr(kpis.openQuoteValue)}</div>
            <div style={{ fontSize: 11, color: c.hint, marginTop: 6 }}>{kpis.awaitingApproval} awaiting response</div>
          </>
        ),
      },
      {
        label: "Case resolution",
        href: ROUTES.cases,
        content: (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <ProgressRing pct={resolutionRate} color={ledger.accent} size={42} stroke={5} />
            <div style={{ fontSize: 11, color: c.hint, lineHeight: 1.3 }}>{resolvedCases} of {totalCases}<br />resolved</div>
          </div>
        ),
      },
      {
        label: "Overdue",
        content: (
          <>
            <div style={{ ...serifNum, fontSize: 25, fontWeight: 700, color: overdueItems.length > 0 ? "#b5451f" : ledger.accent, lineHeight: 1 }}>{overdueItems.length}</div>
            <div style={{ fontSize: 11, color: c.hint, marginTop: 6 }}>{overdueItems.length > 0 ? "need attention" : "all caught up"}</div>
          </>
        ),
      },
      {
        label: "Active work orders",
        href: ROUTES.workOrders,
        content: (
          <>
            <div style={{ ...serifNum, fontSize: 25, fontWeight: 700, color: ledger.accent, lineHeight: 1 }}>{kpis.activeWorkOrders}</div>
            <div style={{ fontSize: 11, color: c.hint, marginTop: 6 }}>{kpis.inRepair} in repair</div>
          </>
        ),
      },
    ];
    return (
      <section style={{ ...cardStyle, padding: 14 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {tiles.map((t) => {
            const box = (
              <div style={{ padding: "13px 16px", borderRadius: 8, border: `1px solid ${ledger.line}`, background: c.panel2 }}>
                <div style={{ fontSize: 10.5, fontWeight: 600, color: c.hint, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 8 }}>{t.label}</div>
                {t.content}
              </div>
            );
            return t.href
              ? <Link key={t.label} href={t.href} style={{ textDecoration: "none", display: "block", flex: "1 1 150px", minWidth: 150 }}>{box}</Link>
              : <div key={t.label} style={{ flex: "1 1 150px", minWidth: 150 }}>{box}</div>;
          })}
        </div>
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${ledger.line}`, display: "flex", gap: 22, flexWrap: "wrap" }}>
          {CASE_STAGE_TILES.map((s) => (
            <Link key={s.status} href={`${ROUTES.cases}?status=${s.status}`} style={{ display: "flex", alignItems: "center", gap: 6, textDecoration: "none" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
              <span style={{ fontSize: 11.5, color: c.muted }}>{s.label}</span>
              <span style={{ ...serifNum, fontSize: 12, fontWeight: 700, color: c.ink }}>{caseStatusCount(s.status)}</span>
            </Link>
          ))}
        </div>
      </section>
    );
  }

  function renderRevenueCard() {
    return (
      <section style={cardStyle}>
        <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 }}>Revenue</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 8 }}>
          <span style={{ ...serifNum, fontSize: 25, fontWeight: 700, color: ledger.accent }}>{inr(revenueValue)}</span>
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
        <div style={{ fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Quick create</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <QCBtn href={ROUTES.caseNew}      label="New case"       icon={<Activity size={13} color={pillar.teal.base} />}  bg={pillar.teal.bg} />
          <QCBtn href={ROUTES.contactNew}   label="New contact"    icon={<Phone size={13} color={pillar.blue.base} />}     bg={pillar.blue.bg} />
          <QCBtn href={ROUTES.quotationNew} label="New quotation"  icon={<Package size={13} color={pillar.amber.base} />}  bg={pillar.amber.bg} />
          <QCBtn href={ROUTES.assetNew}     label="New asset"      icon={<Gear size={13} color={pillar.green.base} />}     bg={pillar.green.bg} />
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
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: c.ink, lineHeight: 1.2 }}>{greet()}</h1>
        </div>
        {isAdmin && (
          <button
            onClick={() => setAdaptOpen(true)}
            className="desk-only"
            style={{
              fontSize: 11.5, fontWeight: 600, color: c.accent,
              background: "transparent", border: `1px solid ${c.accent}`,
              borderRadius: 7, padding: "6px 14px", cursor: "pointer", flexShrink: 0, marginTop: 4,
            }}
          >
            ⚙ Adapt dashboard
          </button>
        )}
      </div>

      {/* Two-column layout */}
      <div className="dash-outer" style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 14, alignItems: "start" }}>
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

      {/* Adapt drawer */}
      {adaptOpen && (
        <AdaptDrawer
          layout={layout}
          features={features}
          onLayoutChange={saveLayout}
          onClose={() => setAdaptOpen(false)}
          saving={saving}
        />
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
