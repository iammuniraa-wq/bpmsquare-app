"use client";

import { useState, useTransition, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ServiceCase, Account, WorkOrder, Activity as ActivityRec } from "@/lib/types";
import { c, pillar, type PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { ROUTES } from "@/lib/constants";
import type { AnalyticsMetricId, TenantFeatures, DashLayoutItem } from "@/lib/constants";
import { AlertTriangle, Activity, CheckIcon, Package, Phone, Gear, Wrench } from "@/components/Icons";
import type { AnalyticsData } from "@/lib/data/labels";

// ── Types ─────────────────────────────────────────────────────────────────────

type Kpis = {
  openCases: number; inRepair: number; awaitingApproval: number;
  activeContracts: number; openQuoteValue: number; activeWorkOrders: number;
};
type AttentionRow  = { serviceCase: ServiceCase; account: Account | null };
type WorkOrderRow  = { workOrder: WorkOrder; account: Account | null; tech: { name: string } | null };
type ActivityRow   = { activity: ActivityRec; account: Account | null };

interface Props {
  kpis: Kpis;
  attention: AttentionRow[];
  readyCases: AttentionRow[];
  workOrderRows: WorkOrderRow[];
  recentActivity: ActivityRow[];
  analytics: AnalyticsData;
  features: TenantFeatures;
  dashLayout: DashLayoutItem[];
  isAdmin: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SIDEBAR_IDS = new Set(["quick_create", "pipeline"]);

const NATIVE_META: Record<string, { label: string; sidebar?: boolean }> = {
  priority_queue:  { label: "Priority queue" },
  dispatch:        { label: "Active work orders" },
  recent_activity: { label: "Recent activity" },
  quick_create:    { label: "Quick create", sidebar: true },
  pipeline:        { label: "Pipeline", sidebar: true },
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
};

const DEFAULT_LAYOUT: DashLayoutItem[] = [
  { id: "priority_queue" },
  { id: "dispatch" },
  { id: "recent_activity" },
  { id: "quick_create" },
  { id: "pipeline" },
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

// ── Priority config ───────────────────────────────────────────────────────────

type PriorityKind = "call" | "ready" | "qa" | "dispatch";
const PRIORITY_CONFIG: Record<PriorityKind, { label: string; color: string; bg: string; action: string; order: number }> = {
  call:     { label: "Call customer", color: pillar.amber.base, bg: pillar.amber.bg, action: "Awaiting response",   order: 0 },
  ready:    { label: "Notify pickup", color: pillar.green.base, bg: pillar.green.bg, action: "Equipment ready",     order: 1 },
  qa:       { label: "Run QA",        color: pillar.blue.base,  bg: pillar.blue.bg,  action: "Needs quality check", order: 2 },
  dispatch: { label: "Going out",     color: pillar.teal.base,  bg: pillar.teal.bg,  action: "Work order today",    order: 3 },
};

const ACT_PILLAR: Record<string, { base: string; bg: string }> = {
  marketing: { base: "#7f77dd", bg: "#eeedfe" },
  sales:     { base: "#378ADD", bg: "#e6f1fb" },
  service:   { base: "#1d9e75", bg: "#e1f5ee" },
  field:     { base: "#ba7517", bg: "#faeeda" },
  finance:   { base: "#639922", bg: "#eaf3de" },
};

// ── Mini analytics chart primitives ──────────────────────────────────────────

function MiniHBar({ rows, colorFn }: {
  rows: { label: string; value: number; href?: string }[];
  colorFn?: (i: number) => string;
}) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.map((row, i) => {
        const color = colorFn ? colorFn(i) : c.accent;
        const inner = (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
              <span style={{ fontSize: 10.5, color: c.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "75%" }}>{row.label}</span>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: c.ink }}>{row.value}</span>
            </div>
            <div style={{ height: 5, background: c.line, borderRadius: 3 }}>
              <div style={{ height: "100%", width: `${Math.round((row.value / max) * 100)}%`, background: color, borderRadius: 3 }} />
            </div>
          </>
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

function StatTile({ value, label, color, href }: { value: number | string; label: string; color: string; href: string }) {
  return (
    <Link href={href} style={{ textDecoration: "none", display: "block", flex: 1, textAlign: "center", padding: "10px 8px" }}>
      <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 10, color: c.hint, marginTop: 2 }}>{label}</div>
    </Link>
  );
}

function AnalyticsCard({ title, href, children }: { title: string; href: string; children: React.ReactNode }) {
  return (
    <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px 8px", borderBottom: `1px solid ${c.line}` }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: c.ink }}>{title}</span>
        <Link href={href} style={{ fontSize: 10, color: c.accent, textDecoration: "none" }}>Full view →</Link>
      </div>
      <div style={{ padding: "10px 12px" }}>{children}</div>
    </div>
  );
}

// ── Analytics widget renderer ─────────────────────────────────────────────────

function renderWidget(id: AnalyticsMetricId, a: AnalyticsData): React.ReactNode {
  const COLORS = [pillar.blue.base, pillar.teal.base, pillar.amber.base, pillar.purple.base, pillar.green.base];
  switch (id) {
    case "accounts":        return <AnalyticsCard title="Accounts" href={ROUTES.accounts}><StatTile value={a.totals.accounts} label="Total accounts" color={pillar.blue.base} href={ROUTES.accounts} /></AnalyticsCard>;
    case "contacts":        return <AnalyticsCard title="Contacts" href={ROUTES.contacts}><StatTile value={a.totals.contacts} label="Total contacts" color={pillar.blue.base} href={ROUTES.contacts} /></AnalyticsCard>;
    case "assets":          return <AnalyticsCard title="Assets" href={ROUTES.assets}><StatTile value={a.totals.customerAssets} label="Customer assets" color={pillar.green.base} href={ROUTES.assets} /></AnalyticsCard>;
    case "open_cases":      return <AnalyticsCard title="Open cases" href={ROUTES.cases}><StatTile value={a.totals.openCases} label="Open cases" color={pillar.teal.base} href={ROUTES.cases} /></AnalyticsCard>;
    case "work_orders":     return <AnalyticsCard title="Work orders" href={ROUTES.workOrders}><StatTile value={a.totals.workOrders} label="Total work orders" color={pillar.amber.base} href={ROUTES.workOrders} /></AnalyticsCard>;
    case "contracts":       return <AnalyticsCard title="AMC contracts" href={ROUTES.amc}><div style={{ display: "flex" }}><StatTile value={a.contractStats.activeCount} label="Active" color={pillar.green.base} href={ROUTES.amc} /><StatTile value={inr(a.contractStats.totalValue)} label="Total value" color={pillar.green.base} href={ROUTES.amc} /></div></AnalyticsCard>;
    case "leads":           return <AnalyticsCard title="Leads" href={ROUTES.leads}><StatTile value={a.totals.leads} label="Total leads" color={pillar.purple.base} href={ROUTES.leads} /></AnalyticsCard>;
    case "technicians":     return <AnalyticsCard title="Technicians" href={ROUTES.technicians}><StatTile value={a.totals.technicians} label="Total technicians" color={pillar.teal.base} href={ROUTES.technicians} /></AnalyticsCard>;
    case "accounts_by_type": return <AnalyticsCard title="Accounts by type" href={ROUTES.accounts}><MiniDonut slices={a.accountsByType.map((x, i) => ({ label: x.label, value: x.count, color: COLORS[i % COLORS.length] }))} /></AnalyticsCard>;
    case "lead_funnel":      return <AnalyticsCard title="Lead funnel" href={ROUTES.leads}><MiniHBar rows={a.leadFunnel.map((x) => ({ label: x.stage, value: x.count }))} colorFn={(i) => COLORS[i % COLORS.length]} /></AnalyticsCard>;
    case "assets_by_kind":   return <AnalyticsCard title="Assets by kind" href={ROUTES.assets}><MiniHBar rows={a.assetsByKind.map((x) => ({ label: x.label, value: x.count, href: `${ROUTES.assets}?kind=${x.kind}` }))} colorFn={(i) => COLORS[i % COLORS.length]} /></AnalyticsCard>;
    case "quote_trend":      return <AnalyticsCard title="Quote pipeline" href={ROUTES.quotations}><MiniHBar rows={a.quotesByStatus.map((x) => ({ label: x.label, value: x.count, href: `${ROUTES.quotations}?status=${x.status}` }))} colorFn={(i) => COLORS[i % COLORS.length]} /></AnalyticsCard>;
    case "case_status":      return <AnalyticsCard title="Case status" href={ROUTES.cases}><MiniHBar rows={a.casesByStatus.map((x) => ({ label: x.label, value: x.count }))} colorFn={(i) => COLORS[i % COLORS.length]} /></AnalyticsCard>;
    case "work_order_status": return <AnalyticsCard title="Work order status" href={ROUTES.workOrders}><MiniHBar rows={a.workOrdersByStatus.map((x) => ({ label: x.label, value: x.count, href: `${ROUTES.workOrders}?status=${x.status}` }))} colorFn={(i) => [pillar.amber.base, pillar.blue.base, pillar.teal.base][i % 3]} /></AnalyticsCard>;
    case "technician_availability": return <AnalyticsCard title="Technician availability" href={ROUTES.technicians}><MiniHBar rows={a.techniciansByStatus.map((x) => ({ label: x.label, value: x.count, href: `${ROUTES.technicians}?status=${x.status}` }))} colorFn={(i) => [pillar.teal.base, pillar.amber.base, c.muted][i]} /></AnalyticsCard>;
    case "revenue_overview": return <AnalyticsCard title="Revenue overview" href={ROUTES.invoices}><MiniHBar rows={[{ label: "AMC contracts", value: a.contractStats.totalValue, href: ROUTES.amc }, { label: "Quote pipeline", value: a.quotesByStatus.reduce((s, x) => s + x.value, 0), href: ROUTES.quotations }, ...a.invoicesByStatus.map((inv) => ({ label: `Invoices (${inv.label})`, value: inv.value, href: `${ROUTES.invoices}?status=${inv.status}` }))]} colorFn={(i) => [pillar.green.base, pillar.blue.base, pillar.purple.base, pillar.teal.base][i % 4]} /></AnalyticsCard>;
    case "invoices_by_status": return <AnalyticsCard title="Invoices by status" href={ROUTES.invoices}><MiniHBar rows={a.invoicesByStatus.map((x) => ({ label: x.label, value: x.count, href: `${ROUTES.invoices}?status=${x.status}` }))} colorFn={(i) => COLORS[i % COLORS.length]} /></AnalyticsCard>;
    case "loaner_availability": return <AnalyticsCard title="Loaner availability" href={ROUTES.assets}><div style={{ display: "flex" }}><StatTile value={a.loanerStock.available} label="Available" color={pillar.green.base} href={ROUTES.assets} /><StatTile value={a.loanerStock.onLoan} label="On loan" color={pillar.amber.base} href={ROUTES.assets} /></div></AnalyticsCard>;
    case "recent_activity":  return <AnalyticsCard title="Recent activity" href={ROUTES.accounts}><div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{a.recentActivity.slice(0, 4).map((act, i) => (<div key={i} style={{ fontSize: 11, color: c.muted, borderLeft: `2px solid ${c.line}`, paddingLeft: 7 }}><div style={{ color: c.ink }}>{act.text}</div><div style={{ fontSize: 10, color: c.hint }}>{act.accountName} · {fmtDate(act.at)}</div></div>))}</div></AnalyticsCard>;
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

function PipelineStat({ label, value, color, href, warn }: { label: string; value: number; color: string; href: string; warn?: boolean }) {
  return (
    <Link href={href} style={{ textDecoration: "none", display: "block", marginBottom: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: c.muted }}>{label}</span>
        </div>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: warn ? color : c.ink }}>{value}</span>
      </div>
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

  function toggleHidden(idx: number) {
    const next = layout.map((b, i) => i === idx ? { ...b, hidden: !b.hidden } : b);
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
          <div style={{ padding: "0 12px 6px", fontSize: 9.5, fontWeight: 700, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 1 }}>
            Drag to reorder
          </div>
          {layout.map((block, i) => {
            const label = blockLabel(block.id);
            const isOver = overIdx === i && dragIdx.current !== i;
            return (
              <div
                key={block.id}
                draggable
                onDragStart={() => onDragStart(i)}
                onDragOver={(e) => onDragOver(e, i)}
                onDrop={() => onDrop(i)}
                onDragEnd={onDragEnd}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "9px 12px", cursor: "grab",
                  opacity: dragIdx.current === i ? 0.4 : 1,
                  borderTop: isOver ? `2px solid ${c.accent}` : "2px solid transparent",
                  transition: "border-color 0.1s, opacity 0.15s",
                }}
              >
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

export default function DashboardLayout({ kpis, attention, readyCases, workOrderRows, recentActivity, analytics, features, dashLayout, isAdmin }: Props) {
  const router = useRouter();
  const today = todayISO();
  const todaysWorkOrders = workOrderRows.filter((r) => r.workOrder.scheduled_for === today);
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

  // Build priority queue
  type PriorityItem =
    | { kind: "call" | "ready" | "qa"; caseRow: AttentionRow; days: number }
    | { kind: "dispatch"; woRow: WorkOrderRow };

  const queue: PriorityItem[] = [
    ...attention.map((r) => ({ kind: "call" as const, caseRow: r, days: r.serviceCase.intake_at ? daysSince(r.serviceCase.intake_at) : 0 })),
    ...readyCases.filter((r) => r.serviceCase.status === "ready").map((r) => ({ kind: "ready" as const, caseRow: r, days: r.serviceCase.intake_at ? daysSince(r.serviceCase.intake_at) : 0 })),
    ...readyCases.filter((r) => r.serviceCase.status === "qa").map((r) => ({ kind: "qa" as const, caseRow: r, days: r.serviceCase.intake_at ? daysSince(r.serviceCase.intake_at) : 0 })),
    ...todaysWorkOrders.map((r) => ({ kind: "dispatch" as const, woRow: r })),
  ].sort((a, b) => PRIORITY_CONFIG[a.kind].order - PRIORITY_CONFIG[b.kind].order);

  const totalAction = attention.length + readyCases.filter((r) => r.serviceCase.status === "ready").length;

  // Split layout into main (left col) and sidebar (right col)
  const visibleBlocks = layout.filter((b) => !b.hidden);
  const mainBlocks = visibleBlocks.filter((b) => !SIDEBAR_IDS.has(b.id));
  const sidebarBlocks = visibleBlocks.filter((b) => SIDEBAR_IDS.has(b.id));

  // ── Block renderers ────────────────────────────────────────────────────────

  function renderPriorityQueue() {
    return (
      <section style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 12px", borderBottom: `1px solid ${c.line}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 26, height: 26, borderRadius: 7, background: totalAction > 0 ? pillar.amber.bg : pillar.green.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              {totalAction > 0 ? <AlertTriangle size={13} color={pillar.amber.base} /> : <CheckIcon size={13} color={pillar.green.base} />}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: c.ink }}>Priority queue</div>
              <div style={{ fontSize: 11, color: c.hint }}>{queue.length === 0 ? "Nothing needs action — all clear" : `${queue.length} item${queue.length !== 1 ? "s" : ""} need attention today`}</div>
            </div>
          </div>
          <Link href={ROUTES.cases} style={{ fontSize: 11.5, color: c.accent, textDecoration: "none", fontWeight: 600 }}>All cases →</Link>
        </div>
        {queue.length === 0 ? (
          <div style={{ padding: "32px 20px", textAlign: "center" }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: pillar.green.bg, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 10px" }}>
              <CheckIcon size={18} color={pillar.green.base} />
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>All clear</div>
            <div style={{ fontSize: 12, color: c.hint, marginTop: 3 }}>No cases awaiting action, no work orders today</div>
          </div>
        ) : queue.map((item, i) => {
          const cfg = PRIORITY_CONFIG[item.kind];
          const border = i === 0 ? "none" : `1px solid ${c.line}`;
          if (item.kind === "dispatch") {
            const { workOrder: wo, account, tech } = item.woRow;
            return (
              <Link key={wo.id} href={ROUTES.workOrder(wo.id)} className="dash-row" style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 16px", borderTop: border, textDecoration: "none" }}>
                <div style={{ width: 4, alignSelf: "stretch", borderRadius: 2, flexShrink: 0, minHeight: 36, background: cfg.color }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                    <span style={{ fontFamily: "monospace", fontSize: 11.5, fontWeight: 700, color: c.ink }}>{wo.ref}</span>
                    <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3, color: cfg.color, background: cfg.bg, borderRadius: 4, padding: "1px 5px" }}>{cfg.label}</span>
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: c.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{account?.name ?? "—"}</div>
                  <div style={{ fontSize: 11, color: c.hint, marginTop: 1 }}>{tech?.name ?? "Unassigned"}{wo.scheduled_for ? " · " + fmtDate(wo.scheduled_for) : ""}</div>
                </div>
                <span style={{ fontSize: 11, color: c.accent, fontWeight: 600, flexShrink: 0 }}>View →</span>
              </Link>
            );
          }
          const { serviceCase: sc, account } = item.caseRow;
          const isOld = item.days >= 3 && item.kind === "call";
          return (
            <Link key={sc.id} href={ROUTES.case(sc.id)} className="dash-row" style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 16px", borderTop: border, textDecoration: "none" }}>
              <div style={{ width: 4, alignSelf: "stretch", borderRadius: 2, flexShrink: 0, minHeight: 36, background: isOld ? "#dc2626" : cfg.color }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                  <span style={{ fontFamily: "monospace", fontSize: 11.5, fontWeight: 700, color: c.accent }}>{sc.ref}</span>
                  <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3, color: isOld ? "#dc2626" : cfg.color, background: isOld ? "#fef2f2" : cfg.bg, borderRadius: 4, padding: "1px 5px" }}>{isOld ? `${item.days}d waiting` : cfg.label}</span>
                </div>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: c.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{account?.name ?? "—"}</div>
                <div style={{ fontSize: 11, color: c.hint, marginTop: 1 }}>{cfg.action}{sc.equipment_label ? " · " + sc.equipment_label : ""}</div>
              </div>
              <span style={{ fontSize: 11, color: c.accent, fontWeight: 600, flexShrink: 0 }}>Open →</span>
            </Link>
          );
        })}
      </section>
    );
  }

  function renderDispatch() {
    if (workOrderRows.length === 0) return null;
    return (
      <section style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px 10px", borderBottom: `1px solid ${c.line}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 24, height: 24, borderRadius: 6, background: pillar.teal.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Wrench size={12} color={pillar.teal.base} />
            </div>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: c.ink }}>Active work orders</div>
              <div style={{ fontSize: 11, color: c.hint }}>{kpis.activeWorkOrders} scheduled or in progress</div>
            </div>
          </div>
          <Link href={ROUTES.workOrders} style={{ fontSize: 11.5, color: c.accent, textDecoration: "none", fontWeight: 600 }}>All →</Link>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
          {workOrderRows.slice(0, 8).map(({ workOrder: wo, account, tech }) => (
            <Link key={wo.id} href={ROUTES.workOrder(wo.id)} className="dash-row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRight: `1px solid ${c.line}`, borderBottom: `1px solid ${c.line}`, textDecoration: "none" }}>
              <div style={{ width: 3, alignSelf: "stretch", borderRadius: 2, flexShrink: 0, minHeight: 28, background: wo.status === "in_progress" ? pillar.amber.base : pillar.teal.base }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 1 }}>
                  <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: c.ink }}>{wo.ref}</span>
                  <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", color: wo.status === "in_progress" ? pillar.amber.base : pillar.teal.base, background: wo.status === "in_progress" ? pillar.amber.bg : pillar.teal.bg, borderRadius: 3, padding: "1px 4px" }}>{wo.status === "in_progress" ? "In progress" : "Scheduled"}</span>
                </div>
                <div style={{ fontSize: 11.5, color: c.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{account?.name ?? "—"}</div>
                <div style={{ fontSize: 10.5, color: c.hint }}>{tech?.name ?? "Unassigned"}{wo.scheduled_for ? " · " + fmtDate(wo.scheduled_for) : ""}</div>
              </div>
            </Link>
          ))}
        </div>
      </section>
    );
  }

  function renderRecentActivity() {
    if (recentActivity.length === 0) return null;
    return (
      <section style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px 10px", borderBottom: `1px solid ${c.line}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 24, height: 24, borderRadius: 6, background: c.accentbg, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Activity size={12} color={c.accent} />
            </div>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: c.ink }}>Recent activity</span>
          </div>
          <Link href={ROUTES.accounts} style={{ fontSize: 11.5, color: c.accent, textDecoration: "none", fontWeight: 600 }}>All accounts →</Link>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
          {recentActivity.map(({ activity, account }) => {
            const p = ACT_PILLAR[activity.pillar] ?? ACT_PILLAR.service;
            return (
              <div key={activity.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "11px 16px", borderRight: `1px solid ${c.line}`, borderBottom: `1px solid ${c.line}` }}>
                <div style={{ width: 28, height: 28, borderRadius: "50%", flexShrink: 0, background: p.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9.5, fontWeight: 700, color: p.base }}>{activity.pillar.slice(0, 2).toUpperCase()}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: c.ink, lineHeight: 1.4 }}>{activity.text}</div>
                  <div style={{ fontSize: 10.5, color: c.hint, marginTop: 3, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    {account && <Link href={ROUTES.account(account.id)} style={{ color: c.accent, textDecoration: "none", fontWeight: 500 }}>{account.name}</Link>}
                    <span>{fmtDate(activity.at)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
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

  function renderPipeline() {
    return (
      <section style={{ ...cardStyle, padding: "14px 14px 12px" }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Pipeline</div>
        <PipelineStat label="Open cases"     value={kpis.openCases}        color={pillar.teal.base}  href={ROUTES.cases} />
        <PipelineStat label="In repair"      value={kpis.inRepair}          color={pillar.blue.base}  href={ROUTES.cases} />
        <PipelineStat label="Needs response" value={kpis.awaitingApproval} color={pillar.amber.base} href={ROUTES.cases} warn={kpis.awaitingApproval > 0} />
        <PipelineStat label="AMC contracts"  value={kpis.activeContracts}  color={pillar.green.base} href={ROUTES.amc} />
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${c.line}` }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 11.5, color: c.muted }}>Quote pipeline</span>
            <Link href={ROUTES.quotations} style={{ fontSize: 13, fontWeight: 700, color: c.ink, textDecoration: "none" }}>{inr(kpis.openQuoteValue)}</Link>
          </div>
        </div>
      </section>
    );
  }

  function renderMainBlock(block: DashLayoutItem) {
    if (isAnalyticsId(block.id)) {
      return <div key={block.id}>{renderWidget(block.id, analytics)}</div>;
    }
    switch (block.id) {
      case "priority_queue":  return <div key={block.id}>{renderPriorityQueue()}</div>;
      case "dispatch":        return <div key={block.id}>{renderDispatch()}</div>;
      case "recent_activity": return <div key={block.id}>{renderRecentActivity()}</div>;
      default: return null;
    }
  }

  function renderSidebarBlock(block: DashLayoutItem) {
    switch (block.id) {
      case "quick_create": return <div key={block.id}>{renderQuickCreate()}</div>;
      case "pipeline":     return <div key={block.id}>{renderPipeline()}</div>;
      default: return null;
    }
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 22, display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 11, color: c.hint, fontWeight: 500, marginBottom: 3 }}>{todayStr()}</div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: c.ink, lineHeight: 1.2 }}>{greet()}, Vikas Pioneers</h1>
        </div>
        {isAdmin && (
          <button
            onClick={() => setAdaptOpen(true)}
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
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {mainBlocks.map((b) => renderMainBlock(b))}
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
