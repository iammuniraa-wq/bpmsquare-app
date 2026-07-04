import Link from "next/link";
import { getDashboardSummary, CASE_STATUS_LABEL } from "@/lib/data";
import type { WorkOrder } from "@/lib/types";
import { c, pillar } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import { ROUTES } from "@/lib/constants";
import {
  AlertTriangle, Activity, CheckIcon, Zap, Package,
  Phone, Gear, Wrench, CalendarCheck,
} from "@/components/Icons";

const inr = (n: number) =>
  "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

const greet = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

const todayStr = () =>
  new Date().toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

const WO_TONE: Record<WorkOrder["status"], keyof typeof pillar> = {
  scheduled: "blue", in_progress: "amber", completed: "green", invoiced: "teal",
};
const WO_LABEL: Record<WorkOrder["status"], string> = {
  scheduled: "Scheduled", in_progress: "In progress",
  completed: "Completed", invoiced: "Invoiced",
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

export default async function DashboardPage() {
  const { kpis, attention, workOrderRows, recentActivity } = await getDashboardSummary();

  return (
    <div>
      {/* ── Header ────────────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "flex-start", justifyContent: "space-between",
        gap: 20, marginBottom: 20, flexWrap: "wrap",
      }}>
        {/* Greeting */}
        <div>
          <div style={{ fontSize: 11, color: c.hint, fontWeight: 500, marginBottom: 3 }}>
            {todayStr()}
          </div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: c.ink, lineHeight: 1.2 }}>
            {greet()}, Vikas Pioneers
          </h1>
          {kpis.awaitingApproval > 0 && (
            <div style={{
              marginTop: 8, display: "inline-flex", alignItems: "center", gap: 6,
              background: pillar.amber.bg, border: `1px solid ${pillar.amber.base}40`,
              borderRadius: 8, padding: "5px 10px",
              fontSize: 12, color: pillar.amber.base, fontWeight: 600,
            }}>
              <AlertTriangle size={12} color={pillar.amber.base} />
              {kpis.awaitingApproval} case{kpis.awaitingApproval > 1 ? "s" : ""} waiting for customer response
            </div>
          )}
        </div>

        {/* KPI chips */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <KpiChip href={ROUTES.cases}      label="Open cases"   value={kpis.openCases}         dot={pillar.teal.base} />
          <KpiChip href={ROUTES.cases}      label="In repair"    value={kpis.inRepair}           dot={pillar.blue.base} />
          <KpiChip href={ROUTES.workOrders} label="Work orders"  value={kpis.activeWorkOrders}   dot={pillar.amber.base} />
          <KpiChip href={ROUTES.amc}        label="AMC active"   value={kpis.activeContracts}    dot={pillar.green.base} />
          <KpiChip href={ROUTES.quotations} label="Pipeline"     value={inr(kpis.openQuoteValue)} dot={pillar.blue.base} isText />
        </div>
      </div>

      {/* ── Three-column bento ────────────────────────────────────────────────── */}
      <div className="dash-bento" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 260px", gap: 12, marginBottom: 12 }}>

        {/* Col 1: Needs action */}
        <section style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
          <SectionHead
            icon={<AlertTriangle size={13} color={pillar.amber.base} />}
            iconBg={pillar.amber.bg}
            title="Needs action"
            sub="Awaiting customer"
            badge={attention.length > 0 ? attention.length : undefined}
            href={ROUTES.cases}
            linkLabel="All cases"
          />
          {attention.length === 0 ? (
            <EmptyState icon={<CheckIcon size={16} color={pillar.green.base} />} iconBg={pillar.green.bg} label="All clear" sub="No cases awaiting response" />
          ) : (
            attention.map(({ serviceCase: sc, account }, i) => {
              const info = ATTENTION_INFO[sc.status];
              return (
                <Link key={sc.id} href={ROUTES.case(sc.id)} className="dash-row" style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
                  borderTop: i === 0 ? "none" : `1px solid ${c.line}`,
                  textDecoration: "none",
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
                      }}>{info?.label ?? CASE_STATUS_LABEL[sc.status]}</span>
                    </div>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: c.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {account?.name ?? "—"}
                    </div>
                    <div style={{ fontSize: 11, color: c.hint, marginTop: 1 }}>{info?.msg}</div>
                  </div>
                  <span style={{ fontSize: 11, color: c.accent, fontWeight: 600, flexShrink: 0 }}>Open →</span>
                </Link>
              );
            })
          )}
        </section>

        {/* Col 2: Work orders */}
        <section style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
          <SectionHead
            icon={<Wrench size={13} color={pillar.amber.base} />}
            iconBg={pillar.amber.bg}
            title="Work orders"
            sub={`${kpis.activeWorkOrders} active`}
            href={ROUTES.workOrders}
            linkLabel="All"
          />
          {workOrderRows.length === 0 ? (
            <EmptyState icon={<CheckIcon size={16} color={pillar.green.base} />} iconBg={pillar.green.bg} label="All done" sub="No active work orders" />
          ) : (
            workOrderRows.slice(0, 6).map(({ workOrder: wo, account, tech }, i) => (
              <Link key={wo.id} href={ROUTES.workOrder(wo.id)} className="dash-row" style={{
                display: "flex", alignItems: "center", gap: 12, padding: "11px 16px",
                borderTop: i === 0 ? "none" : `1px solid ${c.line}`,
                textDecoration: "none",
              }}>
                <div style={{
                  width: 4, alignSelf: "stretch", borderRadius: 2, flexShrink: 0, minHeight: 32,
                  background: pillar[WO_TONE[wo.status]].base,
                }} />
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
            ))
          )}
        </section>

        {/* Col 3: Quick create */}
        <section style={{ ...cardStyle, padding: "16px 14px 14px" }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
            Quick create
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <QCBtn href={ROUTES.caseNew}      label="New case"      icon={<Activity size={14} color={pillar.teal.base} />}  bg={pillar.teal.bg} />
            <QCBtn href={ROUTES.contactNew}   label="New contact"   icon={<Phone size={14} color={pillar.blue.base} />}     bg={pillar.blue.bg} />
            <QCBtn href={ROUTES.quotationNew} label="New quotation" icon={<Package size={14} color={pillar.amber.base} />}  bg={pillar.amber.bg} />
            <QCBtn href={ROUTES.assetNew}     label="New asset"     icon={<Gear size={14} color={pillar.green.base} />}     bg={pillar.green.bg} />
          </div>

          {/* Mini pipeline strip */}
          <div style={{
            marginTop: 18, paddingTop: 14, borderTop: `1px solid ${c.line}`,
          }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
              Pipeline
            </div>
            <MiniStat label="Open cases"   value={kpis.openCases}         color={pillar.teal.base} />
            <MiniStat label="In repair"    value={kpis.inRepair}           color={pillar.blue.base} />
            <MiniStat label="Awaiting"     value={kpis.awaitingApproval}   color={pillar.amber.base} warn={kpis.awaitingApproval > 0} />
            <MiniStat label="AMC active"   value={kpis.activeContracts}    color={pillar.green.base} />
          </div>
        </section>
      </div>

      {/* ── Activity timeline ─────────────────────────────────────────────────── */}
      <section style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
        <SectionHead
          icon={<Activity size={13} color={c.accent} />}
          iconBg={c.accentbg}
          title="Recent activity"
          sub="Latest actions across accounts"
          href={ROUTES.accounts}
          linkLabel="All accounts"
        />
        {recentActivity.length === 0 ? (
          <div style={{ padding: "24px 20px", textAlign: "center", fontSize: 12.5, color: c.hint }}>
            No recent activity
          </div>
        ) : (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
            gap: 0,
          }}>
            {recentActivity.map(({ activity, account }) => {
              const p = ACT_PILLAR[activity.pillar] ?? ACT_PILLAR.service;
              return (
                <div key={activity.id} style={{
                  display: "flex", alignItems: "flex-start", gap: 12,
                  padding: "12px 20px",
                  borderRight: `1px solid ${c.line}`,
                  borderBottom: `1px solid ${c.line}`,
                }}>
                  <div style={{
                    width: 30, height: 30, borderRadius: "50%", flexShrink: 0,
                    background: p.bg,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 10, fontWeight: 700, color: p.base,
                  }}>
                    {activity.pillar.slice(0, 2).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, color: c.ink, lineHeight: 1.45 }}>{activity.text}</div>
                    <div style={{ fontSize: 11, color: c.hint, marginTop: 3, display: "flex", gap: 8, alignItems: "center" }}>
                      {account && (
                        <Link href={ROUTES.account(account.id)} style={{ color: c.accent, textDecoration: "none", fontWeight: 500 }}>
                          {account.name}
                        </Link>
                      )}
                      <span>{fmtDate(activity.at)}</span>
                    </div>
                  </div>
                  <span style={{
                    fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4,
                    color: p.base, background: p.bg, border: `1px solid ${p.base}30`,
                    borderRadius: 4, padding: "2px 6px", flexShrink: 0, alignSelf: "flex-start",
                  }}>
                    {activity.pillar}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <style>{`
        .dash-row:hover { background: ${c.panel2} !important; }
        @media (max-width: 860px) {
          .dash-bento { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function KpiChip({ href, label, value, dot, isText }: {
  href: string; label: string; value: string | number; dot: string; isText?: boolean;
}) {
  return (
    <Link href={href} style={{ textDecoration: "none" }}>
      <div style={{
        ...cardStyle,
        padding: "8px 14px",
        display: "flex", flexDirection: "column", gap: 2,
        borderTop: `2px solid ${dot}`,
        minWidth: 90,
      }}>
        <div style={{ fontSize: isText ? 14 : 20, fontWeight: 700, color: c.ink, lineHeight: 1.1 }}>{value}</div>
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
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "14px 16px 12px", borderBottom: `1px solid ${c.line}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{
          width: 26, height: 26, borderRadius: 7, background: iconBg,
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          {icon}
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: c.ink }}>{title}</div>
          <div style={{ fontSize: 11, color: c.hint }}>{sub}</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {badge != null && (
          <span style={{
            fontSize: 11, fontWeight: 700, background: pillar.amber.bg, color: pillar.amber.base,
            borderRadius: 20, padding: "1px 7px",
          }}>{badge}</span>
        )}
        <Link href={href} style={{ fontSize: 11.5, color: c.accent, textDecoration: "none", fontWeight: 600 }}>{linkLabel}</Link>
      </div>
    </div>
  );
}

function EmptyState({ icon, iconBg, label, sub }: { icon: React.ReactNode; iconBg: string; label: string; sub: string }) {
  return (
    <div style={{ padding: "28px 20px", textAlign: "center" }}>
      <div style={{
        width: 36, height: 36, borderRadius: 10, background: iconBg,
        display: "flex", alignItems: "center", justifyContent: "center",
        margin: "0 auto 8px",
      }}>{icon}</div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: c.ink }}>{label}</div>
      <div style={{ fontSize: 11.5, color: c.hint, marginTop: 2 }}>{sub}</div>
    </div>
  );
}

function QCBtn({ href, label, icon, bg }: { href: string; label: string; icon: React.ReactNode; bg: string }) {
  return (
    <Link href={href} style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "9px 12px", borderRadius: 9,
      background: bg, border: `1px solid ${c.line}`,
      textDecoration: "none", fontSize: 12.5, color: c.ink, fontWeight: 600,
    }}>
      {icon}
      {label}
    </Link>
  );
}

function MiniStat({ label, value, color, warn }: {
  label: string; value: number; color: string; warn?: boolean;
}) {
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
