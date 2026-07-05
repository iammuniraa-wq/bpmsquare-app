"use client";

import Link from "next/link";
import type { ServiceCase, Account, WorkOrder, Activity as ActivityRec } from "@/lib/types";
import { c, pillar } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { ROUTES } from "@/lib/constants";
import { AlertTriangle, Activity, CheckIcon, Package, Phone, Gear, Wrench } from "@/components/Icons";

// ── Props ─────────────────────────────────────────────────────────────────────

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

const daysSince = (iso: string) => {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / 86400000);
};

const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

// ── Priority item config ───────────────────────────────────────────────────────

type PriorityKind = "call" | "ready" | "qa" | "dispatch";

const PRIORITY_CONFIG: Record<PriorityKind, {
  label: string; color: string; bg: string; action: string; order: number;
}> = {
  call:     { label: "Call customer", color: pillar.amber.base, bg: pillar.amber.bg, action: "Awaiting response",  order: 0 },
  ready:    { label: "Notify pickup", color: pillar.green.base, bg: pillar.green.bg, action: "Equipment ready",    order: 1 },
  qa:       { label: "Run QA",        color: pillar.blue.base,  bg: pillar.blue.bg,  action: "Needs quality check", order: 2 },
  dispatch: { label: "Going out",     color: pillar.teal.base,  bg: pillar.teal.bg,  action: "Work order today",   order: 3 },
};

const ACT_PILLAR: Record<string, { base: string; bg: string }> = {
  marketing: { base: "#7f77dd", bg: "#eeedfe" },
  sales:     { base: "#378ADD", bg: "#e6f1fb" },
  service:   { base: "#1d9e75", bg: "#e1f5ee" },
  field:     { base: "#ba7517", bg: "#faeeda" },
  finance:   { base: "#639922", bg: "#eaf3de" },
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function DashboardLayout({ kpis, attention, readyCases, workOrderRows, recentActivity }: Props) {
  const today = todayISO();
  const todaysWorkOrders = workOrderRows.filter((r) => r.workOrder.scheduled_for === today);

  // Build unified priority queue
  type PriorityItem =
    | { kind: "call" | "ready" | "qa"; caseRow: AttentionRow; days: number }
    | { kind: "dispatch"; woRow: WorkOrderRow };

  const queue: PriorityItem[] = [
    ...attention.map((r) => ({
      kind: "call" as const,
      caseRow: r,
      days: r.serviceCase.intake_at ? daysSince(r.serviceCase.intake_at) : 0,
    })),
    ...readyCases
      .filter((r) => r.serviceCase.status === "ready")
      .map((r) => ({
        kind: "ready" as const,
        caseRow: r,
        days: r.serviceCase.intake_at ? daysSince(r.serviceCase.intake_at) : 0,
      })),
    ...readyCases
      .filter((r) => r.serviceCase.status === "qa")
      .map((r) => ({
        kind: "qa" as const,
        caseRow: r,
        days: r.serviceCase.intake_at ? daysSince(r.serviceCase.intake_at) : 0,
      })),
    ...todaysWorkOrders.map((r) => ({ kind: "dispatch" as const, woRow: r })),
  ].sort((a, b) => {
    const oa = PRIORITY_CONFIG[a.kind].order;
    const ob = PRIORITY_CONFIG[b.kind].order;
    return oa !== ob ? oa - ob : 0;
  });

  const totalAction = attention.length + readyCases.filter((r) => r.serviceCase.status === "ready").length;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 11, color: c.hint, fontWeight: 500, marginBottom: 3 }}>{todayStr()}</div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: c.ink, lineHeight: 1.2 }}>{greet()}, Vikas Pioneers</h1>
      </div>

      {/* Two-column layout */}
      <div className="dash-outer" style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 14, alignItems: "start" }}>

        {/* LEFT — priority queue + activity */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Priority queue */}
          <section style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "14px 16px 12px", borderBottom: `1px solid ${c.line}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  width: 26, height: 26, borderRadius: 7,
                  background: totalAction > 0 ? pillar.amber.bg : pillar.green.bg,
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                }}>
                  {totalAction > 0
                    ? <AlertTriangle size={13} color={pillar.amber.base} />
                    : <CheckIcon size={13} color={pillar.green.base} />}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: c.ink }}>Priority queue</div>
                  <div style={{ fontSize: 11, color: c.hint }}>
                    {queue.length === 0
                      ? "Nothing needs action — all clear"
                      : `${queue.length} item${queue.length !== 1 ? "s" : ""} need attention today`}
                  </div>
                </div>
              </div>
              <Link href={ROUTES.cases} style={{ fontSize: 11.5, color: c.accent, textDecoration: "none", fontWeight: 600 }}>All cases →</Link>
            </div>

            {queue.length === 0 ? (
              <div style={{ padding: "32px 20px", textAlign: "center" }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 12, background: pillar.green.bg,
                  display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 10px",
                }}>
                  <CheckIcon size={18} color={pillar.green.base} />
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>All clear</div>
                <div style={{ fontSize: 12, color: c.hint, marginTop: 3 }}>No cases awaiting action, no work orders today</div>
              </div>
            ) : (
              queue.map((item, i) => {
                const cfg = PRIORITY_CONFIG[item.kind];
                const isFirst = i === 0;
                const border = isFirst ? "none" : `1px solid ${c.line}`;

                if (item.kind === "dispatch") {
                  const { workOrder: wo, account, tech } = item.woRow;
                  return (
                    <Link key={wo.id} href={ROUTES.workOrder(wo.id)} className="dash-row" style={{
                      display: "flex", alignItems: "center", gap: 14, padding: "13px 16px",
                      borderTop: border, textDecoration: "none",
                    }}>
                      <div style={{ width: 4, alignSelf: "stretch", borderRadius: 2, flexShrink: 0, minHeight: 36, background: cfg.color }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                          <span style={{ fontFamily: "monospace", fontSize: 11.5, fontWeight: 700, color: c.ink }}>{wo.ref}</span>
                          <span style={{
                            fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3,
                            color: cfg.color, background: cfg.bg, borderRadius: 4, padding: "1px 5px",
                          }}>{cfg.label}</span>
                        </div>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: c.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {account?.name ?? "—"}
                        </div>
                        <div style={{ fontSize: 11, color: c.hint, marginTop: 1 }}>
                          {tech?.name ?? "Unassigned"}{wo.scheduled_for ? " · " + fmtDate(wo.scheduled_for) : ""}
                        </div>
                      </div>
                      <span style={{ fontSize: 11, color: c.accent, fontWeight: 600, flexShrink: 0 }}>View →</span>
                    </Link>
                  );
                }

                const { serviceCase: sc, account } = item.caseRow;
                const isOld = item.days >= 3 && (item.kind === "call");
                return (
                  <Link key={sc.id} href={ROUTES.case(sc.id)} className="dash-row" style={{
                    display: "flex", alignItems: "center", gap: 14, padding: "13px 16px",
                    borderTop: border, textDecoration: "none",
                  }}>
                    <div style={{ width: 4, alignSelf: "stretch", borderRadius: 2, flexShrink: 0, minHeight: 36, background: isOld ? "#dc2626" : cfg.color }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                        <span style={{ fontFamily: "monospace", fontSize: 11.5, fontWeight: 700, color: c.accent }}>{sc.ref}</span>
                        <span style={{
                          fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3,
                          color: isOld ? "#dc2626" : cfg.color,
                          background: isOld ? "#fef2f2" : cfg.bg,
                          borderRadius: 4, padding: "1px 5px",
                        }}>{isOld ? `${item.days}d waiting` : cfg.label}</span>
                      </div>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: c.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {account?.name ?? "—"}
                      </div>
                      <div style={{ fontSize: 11, color: c.hint, marginTop: 1 }}>
                        {cfg.action}{sc.equipment_label ? " · " + sc.equipment_label : ""}
                      </div>
                    </div>
                    <span style={{ fontSize: 11, color: c.accent, fontWeight: 600, flexShrink: 0 }}>Open →</span>
                  </Link>
                );
              })
            )}
          </section>

          {/* Dispatch strip — all active work orders (not just today) */}
          {workOrderRows.length > 0 && (
            <section style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "12px 16px 10px", borderBottom: `1px solid ${c.line}`,
              }}>
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
                {workOrderRows.slice(0, 8).map(({ workOrder: wo, account, tech }, i) => (
                  <Link key={wo.id} href={ROUTES.workOrder(wo.id)} className="dash-row" style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
                    borderRight: `1px solid ${c.line}`, borderBottom: `1px solid ${c.line}`,
                    textDecoration: "none",
                  }}>
                    <div style={{ width: 3, alignSelf: "stretch", borderRadius: 2, flexShrink: 0, minHeight: 28, background: wo.status === "in_progress" ? pillar.amber.base : pillar.teal.base }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 1 }}>
                        <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: c.ink }}>{wo.ref}</span>
                        <span style={{
                          fontSize: 9, fontWeight: 700, textTransform: "uppercase",
                          color: wo.status === "in_progress" ? pillar.amber.base : pillar.teal.base,
                          background: wo.status === "in_progress" ? pillar.amber.bg : pillar.teal.bg,
                          borderRadius: 3, padding: "1px 4px",
                        }}>{wo.status === "in_progress" ? "In progress" : "Scheduled"}</span>
                      </div>
                      <div style={{ fontSize: 11.5, color: c.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{account?.name ?? "—"}</div>
                      <div style={{ fontSize: 10.5, color: c.hint }}>
                        {tech?.name ?? "Unassigned"}{wo.scheduled_for ? " · " + fmtDate(wo.scheduled_for) : ""}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Recent activity */}
          {recentActivity.length > 0 && (
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
                    <div key={activity.id} style={{
                      display: "flex", alignItems: "flex-start", gap: 10, padding: "11px 16px",
                      borderRight: `1px solid ${c.line}`, borderBottom: `1px solid ${c.line}`,
                    }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: "50%", flexShrink: 0, background: p.bg,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 9.5, fontWeight: 700, color: p.base,
                      }}>{activity.pillar.slice(0, 2).toUpperCase()}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: c.ink, lineHeight: 1.4 }}>{activity.text}</div>
                        <div style={{ fontSize: 10.5, color: c.hint, marginTop: 3, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                          {account && (
                            <Link href={ROUTES.account(account.id)} style={{ color: c.accent, textDecoration: "none", fontWeight: 500 }}>{account.name}</Link>
                          )}
                          <span>{fmtDate(activity.at)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>

        {/* RIGHT — quick create + pipeline */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Quick create */}
          <section style={{ ...cardStyle, padding: "14px 14px 12px" }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Quick create</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <QCBtn href={ROUTES.caseNew}      label="New case"       icon={<Activity size={13} color={pillar.teal.base} />}  bg={pillar.teal.bg} />
              <QCBtn href={ROUTES.contactNew}   label="New contact"    icon={<Phone size={13} color={pillar.blue.base} />}     bg={pillar.blue.bg} />
              <QCBtn href={ROUTES.quotationNew} label="New quotation"  icon={<Package size={13} color={pillar.amber.base} />}  bg={pillar.amber.bg} />
              <QCBtn href={ROUTES.assetNew}     label="New asset"      icon={<Gear size={13} color={pillar.green.base} />}     bg={pillar.green.bg} />
            </div>
          </section>

          {/* Pipeline snapshot */}
          <section style={{ ...cardStyle, padding: "14px 14px 12px" }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Pipeline</div>
            <PipelineStat label="Open cases"    value={kpis.openCases}        color={pillar.teal.base}  href={ROUTES.cases} />
            <PipelineStat label="In repair"     value={kpis.inRepair}          color={pillar.blue.base}  href={ROUTES.cases} />
            <PipelineStat label="Needs response" value={kpis.awaitingApproval} color={pillar.amber.base} href={ROUTES.cases} warn={kpis.awaitingApproval > 0} />
            <PipelineStat label="AMC contracts"  value={kpis.activeContracts}  color={pillar.green.base} href={ROUTES.amc} />
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${c.line}` }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11.5, color: c.muted }}>Quote pipeline</span>
                <Link href={ROUTES.quotations} style={{ fontSize: 13, fontWeight: 700, color: c.ink, textDecoration: "none" }}>
                  {inr(kpis.openQuoteValue)}
                </Link>
              </div>
            </div>
          </section>
        </div>
      </div>

      <style>{`
        .dash-row:hover { background: ${c.panel2} !important; }
        @media (max-width: 860px) {
          .dash-outer { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function QCBtn({ href, label, icon, bg }: { href: string; label: string; icon: React.ReactNode; bg: string }) {
  return (
    <Link href={href} style={{
      display: "flex", alignItems: "center", gap: 9, padding: "8px 11px", borderRadius: 8,
      background: bg, border: `1px solid ${c.line}`, textDecoration: "none", fontSize: 12.5, color: c.ink, fontWeight: 600,
    }}>
      {icon}{label}
    </Link>
  );
}

function PipelineStat({ label, value, color, href, warn }: {
  label: string; value: number; color: string; href: string; warn?: boolean;
}) {
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
