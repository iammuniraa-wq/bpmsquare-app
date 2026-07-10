"use client";

import { useState, useTransition, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { c, pillar } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { ROUTES } from "@/lib/constants";
import type { AnalyticsMetricId, TenantFeatures } from "@/lib/constants";
import type { AnalyticsData } from "@/lib/data/labels";

// ── Metric registry ───────────────────────────────────────────────────────────

const METRIC_META: Record<AnalyticsMetricId, { label: string; feature?: keyof TenantFeatures }> = {
  accounts:                { label: "Accounts" },
  contacts:                { label: "Contacts" },
  assets:                  { label: "Assets" },
  open_cases:              { label: "Open cases" },
  work_orders:             { label: "Work orders" },
  contracts:               { label: "AMC contracts", feature: "amc" },
  leads:                   { label: "Leads",         feature: "leads" },
  technicians:             { label: "Technicians" },
  accounts_by_type:        { label: "Accounts by type" },
  lead_funnel:             { label: "Lead funnel",   feature: "leads" },
  assets_by_kind:          { label: "Assets by kind" },
  quote_trend:             { label: "Quote trend" },
  case_status:             { label: "Case status" },
  work_order_status:       { label: "Work order status" },
  technician_availability: { label: "Technician availability" },
  revenue_overview:        { label: "Revenue overview" },
  invoices_by_status:      { label: "Invoices by status", feature: "invoices" },
  loaner_availability:     { label: "Loaner availability" },
  recent_activity:         { label: "Recent activity" },
};

const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

// ── Mini chart primitives ─────────────────────────────────────────────────────

function MiniHBar({ rows, colorFn }: {
  rows: { label: string; value: number; href?: string }[];
  colorFn?: (i: number) => string;
}) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.map((row, i) => {
        const color = colorFn ? colorFn(i) : c.accent;
        const pct = Math.round((row.value / max) * 100);
        const inner = (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
              <span style={{ fontSize: 10.5, color: c.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "75%" }}>{row.label}</span>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: c.ink, flexShrink: 0 }}>{row.value}</span>
            </div>
            <div style={{ height: 5, background: c.line, borderRadius: 3 }}>
              <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 3 }} />
            </div>
          </>
        );
        return row.href ? (
          <Link key={i} href={row.href} style={{ textDecoration: "none", display: "block" }}>{inner}</Link>
        ) : (
          <div key={i}>{inner}</div>
        );
      })}
    </div>
  );
}

function MiniDonut({ slices, size = 64 }: {
  slices: { label: string; value: number; color: string }[];
  size?: number;
}) {
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  const r = size / 2 - 6;
  const cx = size / 2;
  const cy = size / 2;
  let angle = -Math.PI / 2;
  const paths = slices.map((sl) => {
    const frac = sl.value / total;
    const sweep = frac * 2 * Math.PI;
    const x1 = cx + r * Math.cos(angle);
    const y1 = cy + r * Math.sin(angle);
    angle += sweep;
    const x2 = cx + r * Math.cos(angle);
    const y2 = cy + r * Math.sin(angle);
    const large = sweep > Math.PI ? 1 : 0;
    return { d: `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`, color: sl.color, label: sl.label, value: sl.value };
  });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
        {paths.map((p, i) => <path key={i} d={p.d} fill={p.color} />)}
        <circle cx={cx} cy={cy} r={r * 0.55} fill="var(--card-bg, #fff)" />
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
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

// ── Widget renderers ──────────────────────────────────────────────────────────

function WidgetCard({ title, href, children }: { title: string; href: string; children: React.ReactNode }) {
  return (
    <div style={{ ...cardStyle, padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px 8px", borderBottom: `1px solid ${c.line}` }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: c.ink }}>{title}</span>
        <Link href={href} style={{ fontSize: 10, color: c.accent, textDecoration: "none" }}>Full view →</Link>
      </div>
      <div style={{ padding: "10px 12px", flex: 1 }}>{children}</div>
    </div>
  );
}

function renderWidget(id: AnalyticsMetricId, a: AnalyticsData): React.ReactNode {
  const COLORS = [pillar.blue.base, pillar.teal.base, pillar.amber.base, pillar.purple.base, pillar.green.base];

  switch (id) {
    case "accounts":
      return <WidgetCard title="Accounts" href={ROUTES.accounts}><StatTile value={a.totals.accounts} label="Total accounts" color={pillar.blue.base} href={ROUTES.accounts} /></WidgetCard>;
    case "contacts":
      return <WidgetCard title="Contacts" href={ROUTES.contacts}><StatTile value={a.totals.contacts} label="Total contacts" color={pillar.blue.base} href={ROUTES.contacts} /></WidgetCard>;
    case "assets":
      return <WidgetCard title="Assets" href={ROUTES.assets}><StatTile value={a.totals.customerAssets} label="Customer assets" color={pillar.green.base} href={ROUTES.assets} /></WidgetCard>;
    case "open_cases":
      return <WidgetCard title="Open cases" href={ROUTES.cases}><StatTile value={a.totals.openCases} label="Open cases" color={pillar.teal.base} href={ROUTES.cases} /></WidgetCard>;
    case "work_orders":
      return <WidgetCard title="Work orders" href={ROUTES.workOrders}><StatTile value={a.totals.workOrders} label="Total work orders" color={pillar.amber.base} href={ROUTES.workOrders} /></WidgetCard>;
    case "contracts":
      return <WidgetCard title="AMC contracts" href={ROUTES.amc}>
        <div style={{ display: "flex", gap: 0 }}>
          <StatTile value={a.contractStats.activeCount} label="Active" color={pillar.green.base} href={ROUTES.amc} />
          <StatTile value={inr(a.contractStats.totalValue)} label="Total value" color={pillar.green.base} href={ROUTES.amc} />
        </div>
      </WidgetCard>;
    case "leads":
      return <WidgetCard title="Leads" href={ROUTES.leads}><StatTile value={a.totals.leads} label="Total leads" color={pillar.purple.base} href={ROUTES.leads} /></WidgetCard>;
    case "technicians":
      return <WidgetCard title="Technicians" href={ROUTES.technicians}><StatTile value={a.totals.technicians} label="Total technicians" color={pillar.teal.base} href={ROUTES.technicians} /></WidgetCard>;
    case "accounts_by_type":
      return <WidgetCard title="Accounts by type" href={ROUTES.accounts}>
        <MiniDonut slices={a.accountsByType.map((x, i) => ({ label: x.label, value: x.count, color: COLORS[i % COLORS.length] }))} />
      </WidgetCard>;
    case "lead_funnel":
      return <WidgetCard title="Lead funnel" href={ROUTES.leads}>
        <MiniHBar rows={a.leadFunnel.map((x) => ({ label: x.stage, value: x.count }))} colorFn={(i) => COLORS[i % COLORS.length]} />
      </WidgetCard>;
    case "assets_by_kind":
      return <WidgetCard title="Assets by kind" href={ROUTES.assets}>
        <MiniHBar rows={a.assetsByKind.map((x) => ({ label: x.label, value: x.count, href: `${ROUTES.assets}?kind=${x.kind}` }))} colorFn={(i) => COLORS[i % COLORS.length]} />
      </WidgetCard>;
    case "quote_trend":
      return <WidgetCard title="Quote pipeline" href={ROUTES.quotations}>
        <MiniHBar rows={a.quotesByStatus.map((x) => ({ label: x.label, value: x.count, href: `${ROUTES.quotations}?status=${x.status}` }))} colorFn={(i) => COLORS[i % COLORS.length]} />
      </WidgetCard>;
    case "case_status":
      return <WidgetCard title="Case status" href={ROUTES.cases}>
        <MiniHBar rows={a.casesByStatus.map((x) => ({ label: x.label, value: x.count }))} colorFn={(i) => COLORS[i % COLORS.length]} />
      </WidgetCard>;
    case "work_order_status":
      return <WidgetCard title="Work order status" href={ROUTES.workOrders}>
        <MiniHBar rows={a.workOrdersByStatus.map((x) => ({ label: x.label, value: x.count, href: `${ROUTES.workOrders}?status=${x.status}` }))} colorFn={(i) => [pillar.amber.base, pillar.blue.base, pillar.teal.base][i % 3]} />
      </WidgetCard>;
    case "technician_availability":
      return <WidgetCard title="Technician availability" href={ROUTES.technicians}>
        <MiniHBar rows={a.techniciansByStatus.map((x) => ({ label: x.label, value: x.count, href: `${ROUTES.technicians}?status=${x.status}` }))} colorFn={(i) => [pillar.teal.base, pillar.amber.base, c.muted][i]} />
      </WidgetCard>;
    case "revenue_overview":
      return <WidgetCard title="Revenue overview" href={ROUTES.invoices}>
        <MiniHBar
          rows={[
            { label: "AMC contracts", value: a.contractStats.totalValue, href: ROUTES.amc },
            { label: "Quote pipeline", value: a.quotesByStatus.reduce((s, x) => s + x.value, 0), href: ROUTES.quotations },
            ...a.invoicesByStatus.map((inv) => ({ label: `Invoices (${inv.label})`, value: inv.value, href: `${ROUTES.invoices}?status=${inv.status}` })),
          ]}
          colorFn={(i) => [pillar.green.base, pillar.blue.base, pillar.purple.base, pillar.teal.base][i % 4]}
        />
      </WidgetCard>;
    case "invoices_by_status":
      return <WidgetCard title="Invoices by status" href={ROUTES.invoices}>
        <MiniHBar rows={a.invoicesByStatus.map((x) => ({ label: x.label, value: x.count, href: `${ROUTES.invoices}?status=${x.status}` }))} colorFn={(i) => COLORS[i % COLORS.length]} />
      </WidgetCard>;
    case "loaner_availability":
      return <WidgetCard title="Loaner availability" href={ROUTES.assets}>
        <div style={{ display: "flex", gap: 0 }}>
          <StatTile value={a.loanerStock.available} label="Available" color={pillar.green.base} href={ROUTES.assets} />
          <StatTile value={a.loanerStock.onLoan} label="On loan" color={pillar.amber.base} href={ROUTES.assets} />
        </div>
      </WidgetCard>;
    case "recent_activity":
      return <WidgetCard title="Recent activity" href={ROUTES.accounts}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {a.recentActivity.slice(0, 4).map((act, i) => (
            <div key={i} style={{ fontSize: 11, color: c.muted, borderLeft: `2px solid ${c.line}`, paddingLeft: 7, lineHeight: 1.4 }}>
              <div style={{ color: c.ink }}>{act.text}</div>
              <div style={{ fontSize: 10, color: c.hint }}>{act.accountName} · {new Date(act.at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</div>
            </div>
          ))}
        </div>
      </WidgetCard>;
    default:
      return null;
  }
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  analytics: AnalyticsData;
  pinnedWidgets: AnalyticsMetricId[];
  features: TenantFeatures;
  isAdmin: boolean;
}

export default function DashboardWidgets({ analytics, pinnedWidgets, features, isAdmin }: Props) {
  const router = useRouter();
  const [adaptOpen, setAdaptOpen] = useState(false);
  // order is the source of truth for both which widgets are pinned and their sequence
  const [order, setOrder] = useState<AnalyticsMetricId[]>(pinnedWidgets);
  const [saving, startSave] = useTransition();

  // drag state
  const dragIndex = useRef<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  // Only show metrics the tenant has access to
  const available = (Object.keys(METRIC_META) as AnalyticsMetricId[]).filter((id) => {
    const feat = METRIC_META[id].feature;
    return !feat || features[feat];
  });

  const pinnedSet = new Set(order);

  function togglePin(id: AnalyticsMetricId) {
    setOrder((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function persist(nextOrder: AnalyticsMetricId[]) {
    startSave(async () => {
      await fetch("/api/settings/entities", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dashboard_widgets: nextOrder }),
      });
      router.refresh();
    });
  }

  function saveAdapt() {
    persist(order);
    setAdaptOpen(false);
  }

  // ── Drag handlers ─────────────────────────────────────────────────────────

  function onDragStart(i: number) {
    dragIndex.current = i;
  }

  function onDragOver(e: React.DragEvent, i: number) {
    e.preventDefault();
    setOverIndex(i);
  }

  function onDrop(i: number) {
    const from = dragIndex.current;
    if (from === null || from === i) { setOverIndex(null); return; }
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(i, 0, moved);
    dragIndex.current = null;
    setOverIndex(null);
    setOrder(next);
    persist(next);
  }

  function onDragEnd() {
    dragIndex.current = null;
    setOverIndex(null);
  }

  const pinnedList = order.filter((id) => available.includes(id));

  return (
    <div style={{ marginTop: 20 }}>
      {/* Section header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 1 }}>
            Dashboard widgets
          </div>
          {pinnedList.length === 0 && (
            <div style={{ fontSize: 11, color: c.hint, marginTop: 2 }}>
              {isAdmin ? "Pin analytics reports here using Adapt Dashboard." : "No widgets pinned yet."}
            </div>
          )}
        </div>
        {isAdmin && (
          <button
            onClick={() => setAdaptOpen((o) => !o)}
            style={{
              fontSize: 11, fontWeight: 600, color: adaptOpen ? c.ink : c.accent,
              background: adaptOpen ? c.panel2 : "transparent",
              border: `1px solid ${adaptOpen ? c.line : c.accent}`,
              borderRadius: 7, padding: "5px 12px", cursor: "pointer",
            }}
          >
            {adaptOpen ? "✕ Close" : "⚙ Adapt dashboard"}
          </button>
        )}
      </div>

      {/* Adapt panel */}
      {adaptOpen && (
        <div style={{ ...cardStyle, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: c.ink, marginBottom: 4 }}>
            Choose widgets to pin to your dashboard
          </div>
          <div style={{ fontSize: 11, color: c.hint, marginBottom: 12 }}>
            Drag the ⠿ handle on any widget below to reorder.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 8, marginBottom: 16 }}>
            {available.map((id) => (
              <label key={id} style={{
                display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
                padding: "7px 10px", borderRadius: 7,
                background: pinnedSet.has(id) ? c.accentbg : c.panel2,
                border: `1px solid ${pinnedSet.has(id) ? c.accent : c.line}`,
                fontSize: 12, color: c.ink, fontWeight: pinnedSet.has(id) ? 600 : 400,
              }}>
                <input
                  type="checkbox"
                  checked={pinnedSet.has(id)}
                  onChange={() => togglePin(id)}
                  style={{ accentColor: c.accent, width: 13, height: 13, flexShrink: 0 }}
                />
                {METRIC_META[id].label}
              </label>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={saveAdapt}
              disabled={saving}
              style={{
                fontSize: 12, fontWeight: 600, color: "#fff", background: c.accent,
                border: "none", borderRadius: 7, padding: "7px 18px", cursor: saving ? "not-allowed" : "pointer",
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => { setOrder(pinnedWidgets); setAdaptOpen(false); }}
              style={{
                fontSize: 12, color: c.muted, background: "transparent",
                border: `1px solid ${c.line}`, borderRadius: 7, padding: "7px 14px", cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Pinned widget grid — draggable */}
      {pinnedList.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 14 }}>
          {pinnedList.map((id, i) => (
            <div
              key={id}
              draggable
              onDragStart={() => onDragStart(i)}
              onDragOver={(e) => onDragOver(e, i)}
              onDrop={() => onDrop(i)}
              onDragEnd={onDragEnd}
              style={{
                opacity: dragIndex.current === i ? 0.4 : 1,
                outline: overIndex === i && dragIndex.current !== i ? `2px dashed ${c.accent}` : "none",
                outlineOffset: 2,
                borderRadius: 10,
                transition: "opacity 0.15s, outline 0.1s",
              }}
            >
              {/* Drag handle row */}
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "flex-end",
                paddingBottom: 4, cursor: "grab", userSelect: "none",
              }}>
                <span style={{ fontSize: 14, color: c.hint, lineHeight: 1 }} title="Drag to reorder">⠿</span>
              </div>
              {renderWidget(id, analytics)}
            </div>
          ))}
        </div>
      )}

      <style>{`
        [draggable="true"] { cursor: grab; }
        [draggable="true"]:active { cursor: grabbing; }
      `}</style>
    </div>
  );
}
