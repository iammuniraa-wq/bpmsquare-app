"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import type { ServiceCase, Account, WorkOrder, Activity as ActivityRec, LayoutSection } from "@/lib/types";
import { c, pillar } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import { ROUTES } from "@/lib/constants";
import {
  AlertTriangle, Activity, CheckIcon, Package,
  Phone, Gear, Wrench, XIcon,
} from "@/components/Icons";

// ── Props ───────────────────────────────────────────────────────────────────────

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
  workOrderRows: WorkOrderRow[];
  recentActivity: ActivityRow[];
}

// ── Widget catalog — order/visibility persisted; spans + span live in code ───────

const DASHBOARD_DEFAULT: LayoutSection[] = [
  { id: "kpis",         kind: "builtin", label: "Key metrics",     field_keys: [] },
  { id: "attention",    kind: "builtin", label: "Needs action",    field_keys: [] },
  { id: "work_orders",  kind: "builtin", label: "Work orders",     field_keys: [] },
  { id: "quick_create", kind: "builtin", label: "Quick create",    field_keys: [] },
  { id: "activity",     kind: "builtin", label: "Recent activity", field_keys: [] },
];

// 12-col grid span per widget
const WIDGET_SPAN: Record<string, number> = {
  kpis: 12, attention: 6, work_orders: 6, quick_create: 4, activity: 8,
};

// ── Formatters & status config ───────────────────────────────────────────────────

const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

const greet = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};
const todayStr = () =>
  new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

const WO_TONE: Record<WorkOrder["status"], keyof typeof pillar> = {
  scheduled: "blue", in_progress: "amber", completed: "green", invoiced: "teal",
};
const WO_LABEL: Record<WorkOrder["status"], string> = {
  scheduled: "Scheduled", in_progress: "In progress", completed: "Completed", invoiced: "Invoiced",
};
const ATTENTION_INFO: Record<string, { label: string; color: string; msg: string }> = {
  report_sent: { label: "Report sent", color: pillar.purple.base, msg: "Awaiting approval on report" },
  quote_sent:  { label: "Quote sent",  color: pillar.amber.base,  msg: "Awaiting approval on quotation" },
};
const ACT_PILLAR: Record<string, { base: string; bg: string }> = {
  marketing: { base: "#7f77dd", bg: "#eeedfe" },
  sales:     { base: "#378ADD", bg: "#e6f1fb" },
  service:   { base: "#1d9e75", bg: "#e1f5ee" },
  field:     { base: "#ba7517", bg: "#faeeda" },
  finance:   { base: "#639922", bg: "#eaf3de" },
};

// ── Merge stored layout with defaults (append any newly-added widgets) ───────────

function reconcile(stored: LayoutSection[]): LayoutSection[] {
  const known = new Set(DASHBOARD_DEFAULT.map((w) => w.id));
  const kept = stored.filter((w) => known.has(w.id));
  const seen = new Set(kept.map((w) => w.id));
  const missing = DASHBOARD_DEFAULT.filter((w) => !seen.has(w.id));
  return [...kept, ...missing];
}

// ── Component ─────────────────────────────────────────────────────────────────────

export default function DashboardLayout({ kpis, attention, workOrderRows, recentActivity }: Props) {
  const [layout, setLayout]       = useState<LayoutSection[]>(DASHBOARD_DEFAULT);
  const [adaptMode, setAdaptMode] = useState(false);
  const [saving, setSaving]       = useState(false);

  const dragId     = useRef<string | null>(null);
  const dragOverId = useRef<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/layouts/dashboard")
      .then((r) => r.json())
      .then((data: LayoutSection[]) => {
        if (Array.isArray(data) && data.length) setLayout(reconcile(data));
      })
      .catch(() => {});
  }, []);

  const handleDragEnd = () => {
    const from = dragId.current, to = dragOverId.current;
    setDragging(null); dragId.current = null; dragOverId.current = null;
    if (!from || !to || from === to) return;
    setLayout((prev) => {
      const next = [...prev];
      const fi = next.findIndex((s) => s.id === from);
      const ti = next.findIndex((s) => s.id === to);
      const [m] = next.splice(fi, 1);
      next.splice(ti, 0, m);
      return next;
    });
  };

  const toggleHidden = (id: string) =>
    setLayout((prev) => prev.map((s) => (s.id === id ? { ...s, hidden: !s.hidden } : s)));

  const save = async () => {
    setSaving(true);
    await fetch("/api/layouts/dashboard", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layout }),
    }).catch(() => {});
    setSaving(false);
    setAdaptMode(false);
  };

  // ── Widget renderers ────────────────────────────────────────────────────────────
  const renderWidget = (id: string): React.ReactNode => {
    switch (id) {
      case "kpis":
        return (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <KpiChip href={ROUTES.cases}      label="Open cases"  value={kpis.openCases}          dot={pillar.teal.base} />
            <KpiChip href={ROUTES.cases}      label="In repair"   value={kpis.inRepair}           dot={pillar.blue.base} />
            <KpiChip href={ROUTES.cases}      label="Awaiting"    value={kpis.awaitingApproval}   dot={pillar.amber.base} warn={kpis.awaitingApproval > 0} />
            <KpiChip href={ROUTES.workOrders} label="Work orders" value={kpis.activeWorkOrders}    dot={pillar.amber.base} />
            <KpiChip href={ROUTES.amc}        label="AMC active"  value={kpis.activeContracts}    dot={pillar.green.base} />
            <KpiChip href={ROUTES.quotations} label="Pipeline"    value={inr(kpis.openQuoteValue)} dot={pillar.blue.base} isText />
          </div>
        );

      case "attention":
        return (
          <section style={{ ...cardStyle, padding: 0, overflow: "hidden", height: "100%" }}>
            <SectionHead
              icon={<AlertTriangle size={13} color={pillar.amber.base} />} iconBg={pillar.amber.bg}
              title="Needs action" sub="Awaiting customer"
              badge={attention.length || undefined} href={ROUTES.cases} linkLabel="All cases"
            />
            {attention.length === 0 ? (
              <EmptyState icon={<CheckIcon size={16} color={pillar.green.base} />} iconBg={pillar.green.bg} label="All clear" sub="No cases awaiting response" />
            ) : attention.map(({ serviceCase: sc, account }, i) => {
              const info = ATTENTION_INFO[sc.status];
              return (
                <Link key={sc.id} href={ROUTES.case(sc.id)} className="dash-row" style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
                  borderTop: i === 0 ? "none" : `1px solid ${c.line}`, textDecoration: "none",
                }}>
                  <div style={{
                    width: 34, height: 34, borderRadius: 9, flexShrink: 0,
                    background: `${info?.color ?? c.hint}18`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <AlertTriangle size={14} color={info?.color ?? c.hint} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                      <span style={{ fontFamily: "monospace", fontSize: 11.5, fontWeight: 700, color: c.accent }}>{sc.ref}</span>
                      <span style={{
                        fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3,
                        color: info?.color ?? c.hint, background: `${info?.color ?? c.hint}18`,
                        borderRadius: 4, padding: "1px 5px",
                      }}>{info?.label ?? sc.status}</span>
                    </div>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: c.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {account?.name ?? "—"}
                    </div>
                    <div style={{ fontSize: 11, color: c.hint, marginTop: 1 }}>{info?.msg}</div>
                  </div>
                  <span style={{ fontSize: 11, color: c.accent, fontWeight: 600, flexShrink: 0 }}>Open →</span>
                </Link>
              );
            })}
          </section>
        );

      case "work_orders":
        return (
          <section style={{ ...cardStyle, padding: 0, overflow: "hidden", height: "100%" }}>
            <SectionHead
              icon={<Wrench size={13} color={pillar.amber.base} />} iconBg={pillar.amber.bg}
              title="Work orders" sub={`${kpis.activeWorkOrders} active`}
              href={ROUTES.workOrders} linkLabel="All"
            />
            {workOrderRows.length === 0 ? (
              <EmptyState icon={<CheckIcon size={16} color={pillar.green.base} />} iconBg={pillar.green.bg} label="All done" sub="No active work orders" />
            ) : workOrderRows.slice(0, 6).map(({ workOrder: wo, account, tech }, i) => (
              <Link key={wo.id} href={ROUTES.workOrder(wo.id)} className="dash-row" style={{
                display: "flex", alignItems: "center", gap: 12, padding: "11px 16px",
                borderTop: i === 0 ? "none" : `1px solid ${c.line}`, textDecoration: "none",
              }}>
                <div style={{ width: 4, alignSelf: "stretch", borderRadius: 2, flexShrink: 0, minHeight: 32, background: pillar[WO_TONE[wo.status]].base }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
                    <span style={{ fontFamily: "monospace", fontSize: 11.5, fontWeight: 700, color: c.ink }}>{wo.ref}</span>
                    <Pill label={WO_LABEL[wo.status]} tone={WO_TONE[wo.status]} />
                  </div>
                  <div style={{ fontSize: 12, color: c.muted, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {account?.name ?? "—"}
                  </div>
                  {tech && (
                    <div style={{ fontSize: 11, color: c.hint, marginTop: 1 }}>
                      {tech.name}{wo.scheduled_for ? " · " + fmtDate(wo.scheduled_for) : ""}
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </section>
        );

      case "quick_create":
        return (
          <section style={{ ...cardStyle, padding: "16px 14px 14px", height: "100%" }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Quick create</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <QCBtn href={ROUTES.caseNew}      label="New case"      icon={<Activity size={14} color={pillar.teal.base} />}  bg={pillar.teal.bg} />
              <QCBtn href={ROUTES.contactNew}   label="New contact"   icon={<Phone size={14} color={pillar.blue.base} />}     bg={pillar.blue.bg} />
              <QCBtn href={ROUTES.quotationNew} label="New quotation" icon={<Package size={14} color={pillar.amber.base} />}  bg={pillar.amber.bg} />
              <QCBtn href={ROUTES.assetNew}     label="New asset"     icon={<Gear size={14} color={pillar.green.base} />}     bg={pillar.green.bg} />
            </div>
            <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${c.line}` }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Pipeline</div>
              <MiniStat label="Open cases" value={kpis.openCases}       color={pillar.teal.base} />
              <MiniStat label="In repair"  value={kpis.inRepair}         color={pillar.blue.base} />
              <MiniStat label="Awaiting"   value={kpis.awaitingApproval} color={pillar.amber.base} warn={kpis.awaitingApproval > 0} />
              <MiniStat label="AMC active" value={kpis.activeContracts}  color={pillar.green.base} />
            </div>
          </section>
        );

      case "activity":
        return (
          <section style={{ ...cardStyle, padding: 0, overflow: "hidden", height: "100%" }}>
            <SectionHead
              icon={<Activity size={13} color={c.accent} />} iconBg={c.accentbg}
              title="Recent activity" sub="Latest actions across accounts"
              href={ROUTES.accounts} linkLabel="All accounts"
            />
            {recentActivity.length === 0 ? (
              <div style={{ padding: "24px 20px", textAlign: "center", fontSize: 12.5, color: c.hint }}>No recent activity</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
                {recentActivity.map(({ activity, account }) => {
                  const p = ACT_PILLAR[activity.pillar] ?? ACT_PILLAR.service;
                  return (
                    <div key={activity.id} style={{
                      display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 20px",
                      borderRight: `1px solid ${c.line}`, borderBottom: `1px solid ${c.line}`,
                    }}>
                      <div style={{
                        width: 30, height: 30, borderRadius: "50%", flexShrink: 0, background: p.bg,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 10, fontWeight: 700, color: p.base,
                      }}>{activity.pillar.slice(0, 2).toUpperCase()}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, color: c.ink, lineHeight: 1.45 }}>{activity.text}</div>
                        <div style={{ fontSize: 11, color: c.hint, marginTop: 3, display: "flex", gap: 8, alignItems: "center" }}>
                          {account && (
                            <Link href={ROUTES.account(account.id)} style={{ color: c.accent, textDecoration: "none", fontWeight: 500 }}>{account.name}</Link>
                          )}
                          <span>{fmtDate(activity.at)}</span>
                        </div>
                      </div>
                      <span style={{
                        fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4,
                        color: p.base, background: p.bg, border: `1px solid ${p.base}30`,
                        borderRadius: 4, padding: "2px 6px", flexShrink: 0, alignSelf: "flex-start",
                      }}>{activity.pillar}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );

      default:
        return null;
    }
  };

  const visible = layout.filter((w) => !w.hidden);

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, marginBottom: 20, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11, color: c.hint, fontWeight: 500, marginBottom: 3 }}>{todayStr()}</div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: c.ink, lineHeight: 1.2 }}>{greet()}, Vikas Pioneers</h1>
        </div>
        {!adaptMode ? (
          <button onClick={() => setAdaptMode(true)} style={{
            display: "inline-flex", alignItems: "center", gap: 6, background: c.panel2, color: c.muted,
            border: `1px solid ${c.line}`, borderRadius: 8, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
          }}>
            <Gear size={13} color={c.muted} /> Customize
          </button>
        ) : (
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={save} disabled={saving} style={{
              background: c.accent, color: "#fff", border: "none", borderRadius: 8,
              padding: "7px 18px", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
            }}>{saving ? "Saving…" : "Save layout"}</button>
            <button onClick={() => { setAdaptMode(false); setLayout((p) => reconcile(p)); }} style={{
              background: c.panel2, color: c.muted, border: `1px solid ${c.line}`,
              borderRadius: 8, padding: "7px 14px", fontSize: 12.5, cursor: "pointer",
            }}>Cancel</button>
          </div>
        )}
      </div>

      {/* Widget editor (adapt mode) */}
      {adaptMode && (
        <div style={{ ...cardStyle, marginBottom: 16, padding: "14px 16px", background: "#f4f8fd", border: `1px solid ${pillar.blue.base}40` }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#0c447c", marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
            <Gear size={13} color="#0c447c" /> Customize dashboard
          </div>
          <div style={{ fontSize: 11.5, color: c.muted, marginBottom: 12 }}>Drag to reorder · toggle to show or hide widgets</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {layout.map((w) => (
              <div
                key={w.id}
                draggable
                onDragStart={() => { dragId.current = w.id; setDragging(w.id); }}
                onDragEnter={() => { dragOverId.current = w.id; }}
                onDragOver={(e) => e.preventDefault()}
                onDragEnd={handleDragEnd}
                style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "9px 12px",
                  background: c.panel, borderRadius: 8, border: `1px solid ${c.line}`,
                  opacity: dragging === w.id ? 0.45 : 1,
                }}
              >
                <span style={{ cursor: "grab", color: pillar.blue.base, fontSize: 15, userSelect: "none" }}>⠿</span>
                <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: w.hidden ? c.hint : c.ink }}>{w.label}</span>
                <span style={{ fontSize: 10.5, color: c.hint }}>{WIDGET_SPAN[w.id] === 12 ? "full width" : WIDGET_SPAN[w.id] >= 6 ? "wide" : "narrow"}</span>
                <button onClick={() => toggleHidden(w.id)} style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  background: w.hidden ? c.panel2 : pillar.green.bg,
                  color: w.hidden ? c.hint : pillar.green.base,
                  border: `1px solid ${w.hidden ? c.line : pillar.green.base + "40"}`,
                  borderRadius: 6, padding: "4px 10px", fontSize: 11.5, fontWeight: 600, cursor: "pointer",
                }}>
                  {w.hidden ? <><XIcon size={11} color={c.hint} /> Hidden</> : <><CheckIcon size={11} color={pillar.green.base} /> Shown</>}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Widget grid — 12-col bento */}
      <div className="dash-grid" style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 12, gridAutoFlow: "dense" }}>
        {visible.map((w) => (
          <div key={w.id} className="dash-cell" style={{ gridColumn: `span ${WIDGET_SPAN[w.id] ?? 12}` }}>
            {renderWidget(w.id)}
          </div>
        ))}
      </div>

      <style>{`
        .dash-row:hover { background: ${c.panel2} !important; }
        @media (max-width: 860px) {
          .dash-cell { grid-column: span 12 !important; }
        }
      `}</style>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function KpiChip({ href, label, value, dot, isText, warn }: {
  href: string; label: string; value: string | number; dot: string; isText?: boolean; warn?: boolean;
}) {
  return (
    <Link href={href} style={{ textDecoration: "none" }}>
      <div style={{ ...cardStyle, padding: "8px 14px", display: "flex", flexDirection: "column", gap: 2, borderTop: `2px solid ${dot}`, minWidth: 90 }}>
        <div style={{ fontSize: isText ? 14 : 20, fontWeight: 700, color: warn ? pillar.amber.base : c.ink, lineHeight: 1.1 }}>{value}</div>
        <div style={{ fontSize: 10.5, color: c.hint, fontWeight: 500 }}>{label}</div>
      </div>
    </Link>
  );
}

function SectionHead({ icon, iconBg, title, sub, badge, href, linkLabel }: {
  icon: React.ReactNode; iconBg: string; title: string; sub: string;
  badge?: number; href: string; linkLabel: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 12px", borderBottom: `1px solid ${c.line}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 26, height: 26, borderRadius: 7, background: iconBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{icon}</div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: c.ink }}>{title}</div>
          <div style={{ fontSize: 11, color: c.hint }}>{sub}</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {badge != null && (
          <span style={{ fontSize: 11, fontWeight: 700, background: pillar.amber.bg, color: pillar.amber.base, borderRadius: 20, padding: "1px 7px" }}>{badge}</span>
        )}
        <Link href={href} style={{ fontSize: 11.5, color: c.accent, textDecoration: "none", fontWeight: 600 }}>{linkLabel}</Link>
      </div>
    </div>
  );
}

function EmptyState({ icon, iconBg, label, sub }: { icon: React.ReactNode; iconBg: string; label: string; sub: string }) {
  return (
    <div style={{ padding: "28px 20px", textAlign: "center" }}>
      <div style={{ width: 36, height: 36, borderRadius: 10, background: iconBg, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 8px" }}>{icon}</div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: c.ink }}>{label}</div>
      <div style={{ fontSize: 11.5, color: c.hint, marginTop: 2 }}>{sub}</div>
    </div>
  );
}

function QCBtn({ href, label, icon, bg }: { href: string; label: string; icon: React.ReactNode; bg: string }) {
  return (
    <Link href={href} style={{
      display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 9,
      background: bg, border: `1px solid ${c.line}`, textDecoration: "none", fontSize: 12.5, color: c.ink, fontWeight: 600,
    }}>
      {icon}{label}
    </Link>
  );
}

function MiniStat({ label, value, color, warn }: { label: string; value: number; color: string; warn?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0 }} />
        <span style={{ fontSize: 12, color: c.muted }}>{label}</span>
      </div>
      <span style={{ fontSize: 13, fontWeight: 700, color: warn ? color : c.ink }}>{value}</span>
    </div>
  );
}
