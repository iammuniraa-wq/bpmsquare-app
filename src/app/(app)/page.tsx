import Link from "next/link";
import { getDashboardSummary, CASE_STATUS_LABEL } from "@/lib/data";
import type { WorkOrder } from "@/lib/types";
import { c, pillar } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import { ROUTES } from "@/lib/constants";
import {
  AlertTriangle, Phone, Gear, Activity, CheckIcon, Zap, Package,
  MapPin, Mail,
} from "@/components/Icons";

// ── Formatters ─────────────────────────────────────────────────────────────────

const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

const greet = () => {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
};

const todayFull = () =>
  new Date().toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

// ── Status config ──────────────────────────────────────────────────────────────

const WO_TONE: Record<WorkOrder["status"], keyof typeof pillar> = {
  scheduled: "blue", in_progress: "amber", completed: "green", invoiced: "teal",
};
const WO_LABEL: Record<WorkOrder["status"], string> = {
  scheduled: "Scheduled", in_progress: "In progress",
  completed: "Completed", invoiced: "Invoiced",
};

const ATTENTION_INFO: Record<string, { label: string; dot: string; msg: string }> = {
  report_sent: { label: "Report sent",  dot: "#7f77dd", msg: "Awaiting approval on inspection report" },
  quote_sent:  { label: "Quote sent",   dot: "#ba7517", msg: "Awaiting approval on quotation" },
};

const ACT_PILLAR: Record<string, { base: string; bg: string; initial: string }> = {
  marketing: { base: "#7f77dd", bg: "#eeedfe", initial: "M" },
  sales:     { base: "#378ADD", bg: "#e6f1fb", initial: "S" },
  service:   { base: "#1d9e75", bg: "#e1f5ee", initial: "SV" },
  field:     { base: "#ba7517", bg: "#faeeda", initial: "F" },
  finance:   { base: "#639922", bg: "#eaf3de", initial: "Fi" },
};

// ── Page ───────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const { kpis, attention, workOrderRows, recentActivity } = await getDashboardSummary();

  return (
    <div style={{ marginTop: -24 }}>

      {/* ── Hero strip ─────────────────────────────────────────────────────── */}
      <div style={{
        background: "linear-gradient(135deg, #152233 0%, #0e1a28 60%, #0a1830 100%)",
        borderRadius: "0 0 20px 20px",
        padding: "28px 28px 32px",
        marginBottom: 20,
        position: "relative",
        overflow: "hidden",
      }}>
        {/* background glow orb */}
        <div style={{
          position: "absolute", top: -60, right: -60,
          width: 240, height: 240, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(55,138,221,0.12) 0%, transparent 70%)",
          pointerEvents: "none",
        }} />
        <div style={{
          position: "absolute", bottom: -40, left: 80,
          width: 180, height: 180, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(29,158,117,0.08) 0%, transparent 70%)",
          pointerEvents: "none",
        }} />

        {/* greeting + date */}
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#4a7096", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 6 }}>
            {todayFull()}
          </div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#e2e7ee", lineHeight: 1.2 }}>
            {greet()}, Vikas Pioneers
          </h1>
          <p style={{ margin: "5px 0 0", fontSize: 13, color: "#7a9ab8" }}>
            {kpis.openCases} cases in progress
            {kpis.awaitingApproval > 0 && (
              <span style={{ color: "#f6b23c" }}> · {kpis.awaitingApproval} awaiting customer</span>
            )}
            {kpis.activeWorkOrders > 0 && (
              <span style={{ color: "#9db3c4" }}> · {kpis.activeWorkOrders} work orders active</span>
            )}
          </p>
        </div>

        {/* hero KPI row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }} className="fg2">
          <HeroKpi
            label="Open cases" value={kpis.openCases}
            sub={`${kpis.inRepair} in repair`}
            accent="#1d9e75" href={ROUTES.cases}
          />
          <HeroKpi
            label="Pipeline value" value={inr(kpis.openQuoteValue)}
            sub="sent & approved quotes"
            accent="#378ADD" href={ROUTES.quotations}
          />
          <HeroKpi
            label="Work orders" value={kpis.activeWorkOrders}
            sub={`${kpis.activeContracts} AMC contracts`}
            accent="#ba7517" href={ROUTES.workOrders}
          />
        </div>
      </div>

      {/* ── Stat row ──────────────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }} className="kpi-grid">
        <StatTile href={ROUTES.cases}      label="In repair"         value={kpis.inRepair}         color="#378ADD" />
        <StatTile href={ROUTES.cases}      label="Awaiting approval" value={kpis.awaitingApproval} color="#ba7517" alert={kpis.awaitingApproval > 0} />
        <StatTile href={ROUTES.amc}        label="Active AMC"        value={kpis.activeContracts}  color="#1d9e75" />
        <StatTile href={ROUTES.quotations} label="Open quotes"       value={inr(kpis.openQuoteValue)} color="#378ADD" isText />
      </div>

      {/* ── Main two-col ──────────────────────────────────────────────────────── */}
      <div className="hub-grid" style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 14, marginBottom: 14 }}>

        {/* Left: action queue */}
        <section style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "16px 20px 14px",
            borderBottom: `1px solid ${c.line}`,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 28, height: 28, borderRadius: 7, background: "#faeeda",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <AlertTriangle size={14} color="#ba7517" />
              </div>
              <div>
                <h2 style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: c.ink }}>Needs action</h2>
                <div style={{ fontSize: 11, color: c.hint, marginTop: 1 }}>Cases waiting for customer response</div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {attention.length > 0 && (
                <span style={{
                  fontSize: 11, fontWeight: 700, background: "#faeeda", color: "#633806",
                  borderRadius: 20, padding: "2px 8px", minWidth: 20, textAlign: "center",
                }}>
                  {attention.length}
                </span>
              )}
              <Link href={ROUTES.cases} style={{ fontSize: 11.5, color: c.accent, textDecoration: "none", fontWeight: 600 }}>
                All cases
              </Link>
            </div>
          </div>

          {attention.length === 0 ? (
            <div style={{ padding: "32px 20px", textAlign: "center" }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: "#e1f5ee", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 10px" }}>
                <CheckIcon size={18} color="#1d9e75" />
              </div>
              <div style={{ fontSize: 13, color: c.ink, fontWeight: 600 }}>All clear</div>
              <div style={{ fontSize: 12, color: c.hint, marginTop: 3 }}>No cases awaiting customer response</div>
            </div>
          ) : (
            attention.map(({ serviceCase: sc, account }, i) => {
              const info = ATTENTION_INFO[sc.status];
              return (
                <Link
                  key={sc.id}
                  href={ROUTES.case(sc.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 14, padding: "13px 20px",
                    borderTop: i === 0 ? "none" : `1px solid ${c.line}`,
                    textDecoration: "none",
                    background: "transparent",
                    transition: "background 0.12s",
                  }}
                  className="dash-row"
                >
                  {/* status dot */}
                  <div style={{
                    width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                    background: info?.dot ?? c.hint,
                    boxShadow: `0 0 0 3px ${info?.dot ?? c.hint}22`,
                  }} />

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                      <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: c.accent }}>{sc.ref}</span>
                      <span style={{
                        fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4,
                        color: info?.dot ?? c.hint,
                        background: `${info?.dot ?? c.hint}18`,
                        borderRadius: 4, padding: "1px 6px",
                      }}>
                        {info?.label ?? CASE_STATUS_LABEL[sc.status]}
                      </span>
                    </div>
                    {account && (
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: c.ink, marginBottom: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {account.name}
                      </div>
                    )}
                    <div style={{ fontSize: 11.5, color: c.hint }}>{info?.msg}</div>
                  </div>

                  <div style={{ fontSize: 11.5, color: c.accent, fontWeight: 600, flexShrink: 0 }}>
                    Open →
                  </div>
                </Link>
              );
            })
          )}
        </section>

        {/* Right: work orders + quick create */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Quick create */}
          <section style={{ ...cardStyle, padding: "16px 16px 14px" }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
              Quick create
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <QuickCreate href={ROUTES.caseNew}       label="New case"       icon="case" />
              <QuickCreate href={ROUTES.contactNew}    label="New contact"    icon="contact" />
              <QuickCreate href={ROUTES.quotationNew}  label="New quotation"  icon="quote" />
              <QuickCreate href={ROUTES.assetNew}      label="New asset"      icon="asset" />
            </div>
          </section>

          {/* Work orders */}
          {workOrderRows.length > 0 ? (
            <section style={{ ...cardStyle, padding: 0, overflow: "hidden", flex: 1 }}>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "14px 16px 12px",
                borderBottom: `1px solid ${c.line}`,
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: c.ink }}>Work orders</div>
                <Link href={ROUTES.workOrders} style={{ fontSize: 11.5, color: c.accent, textDecoration: "none", fontWeight: 600 }}>All</Link>
              </div>
              {workOrderRows.slice(0, 5).map(({ workOrder: wo, account, tech }, i) => (
                <Link
                  key={wo.id}
                  href={ROUTES.workOrder(wo.id)}
                  style={{
                    display: "flex", alignItems: "flex-start", gap: 10, padding: "11px 16px",
                    borderTop: i === 0 ? "none" : `1px solid ${c.line}`,
                    textDecoration: "none",
                  }}
                  className="dash-row"
                >
                  <div style={{
                    width: 3, alignSelf: "stretch", borderRadius: 2, flexShrink: 0, minHeight: 36,
                    background: pillar[WO_TONE[wo.status]].base,
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                      <span style={{ fontFamily: "monospace", fontSize: 11.5, fontWeight: 700, color: c.ink }}>{wo.ref}</span>
                      <Pill label={WO_LABEL[wo.status]} tone={WO_TONE[wo.status]} />
                    </div>
                    {account && (
                      <div style={{ fontSize: 12, color: c.muted, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {account.name}
                      </div>
                    )}
                    {tech && (
                      <div style={{ fontSize: 11, color: c.hint, marginTop: 1 }}>
                        {tech.name}{wo.scheduled_for ? " · " + fmtDate(wo.scheduled_for) : ""}
                      </div>
                    )}
                  </div>
                </Link>
              ))}
            </section>
          ) : (
            <section style={{ ...cardStyle, padding: "20px 16px", textAlign: "center" }}>
              <div style={{ fontSize: 12.5, color: c.hint }}>No active work orders</div>
              <Link href={ROUTES.workOrders} style={{ fontSize: 12, color: c.accent, textDecoration: "none", display: "inline-block", marginTop: 8, fontWeight: 600 }}>
                View all
              </Link>
            </section>
          )}
        </div>
      </div>

      {/* ── Activity timeline ─────────────────────────────────────────────────── */}
      <section style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 20px 14px",
          borderBottom: `1px solid ${c.line}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 7, background: c.accentbg,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Activity size={14} color={c.accent} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: c.ink }}>Recent activity</h2>
              <div style={{ fontSize: 11, color: c.hint, marginTop: 1 }}>Latest actions across accounts</div>
            </div>
          </div>
          <Link href={ROUTES.accounts} style={{ fontSize: 11.5, color: c.accent, textDecoration: "none", fontWeight: 600 }}>
            All accounts
          </Link>
        </div>

        <div style={{ padding: "4px 0 8px" }}>
          {recentActivity.length === 0 ? (
            <div style={{ padding: "24px 20px", textAlign: "center", fontSize: 12.5, color: c.hint }}>
              No recent activity
            </div>
          ) : (
            recentActivity.map(({ activity, account }, i) => {
              const p = ACT_PILLAR[activity.pillar] ?? ACT_PILLAR.service;
              return (
                <div
                  key={activity.id}
                  style={{
                    display: "flex", alignItems: "flex-start", gap: 14,
                    padding: "10px 20px",
                    position: "relative",
                  }}
                >
                  {/* timeline line */}
                  {i < recentActivity.length - 1 && (
                    <div style={{
                      position: "absolute", left: 33, top: 38, bottom: 0,
                      width: 1, background: c.line,
                      zIndex: 0,
                    }} />
                  )}

                  {/* pillar dot */}
                  <div style={{
                    width: 28, height: 28, borderRadius: "50%",
                    background: p.bg, flexShrink: 0, zIndex: 1,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 10, fontWeight: 700, color: p.base,
                    border: `1.5px solid ${p.base}30`,
                  }}>
                    {activity.pillar.slice(0, 2).toUpperCase()}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, color: c.ink, lineHeight: 1.45 }}>{activity.text}</div>
                    <div style={{ fontSize: 11.5, color: c.hint, marginTop: 3, display: "flex", gap: 10, alignItems: "center" }}>
                      {account && (
                        <Link href={ROUTES.account(account.id)} style={{ color: c.accent, textDecoration: "none", fontWeight: 500 }}>
                          {account.name}
                        </Link>
                      )}
                      <span>{fmtDate(activity.at)}</span>
                    </div>
                  </div>

                  {/* pillar badge */}
                  <span style={{
                    fontSize: 9.5, fontWeight: 700, textTransform: "uppercase",
                    letterSpacing: 0.4, color: p.base,
                    background: p.bg, border: `1px solid ${p.base}30`,
                    borderRadius: 4, padding: "2px 6px", flexShrink: 0,
                    alignSelf: "flex-start",
                  }}>
                    {activity.pillar}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* hover row highlight */}
      <style>{`
        .dash-row:hover { background: ${c.panel2} !important; }
        @media (max-width: 768px) {
          .kpi-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
      `}</style>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function HeroKpi({ label, value, sub, accent, href }: {
  label: string; value: string | number; sub: string;
  accent: string; href: string;
}) {
  return (
    <Link href={href} style={{ textDecoration: "none" }}>
      <div style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: 12,
        padding: "16px 18px",
        backdropFilter: "blur(4px)",
        transition: "background 0.15s",
      }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#4a7096", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 }}>
          {label}
        </div>
        <div style={{ fontSize: 28, fontWeight: 700, color: "#e2e7ee", lineHeight: 1, marginBottom: 5 }}>
          {value}
        </div>
        <div style={{ fontSize: 11.5, color: accent, fontWeight: 500 }}>{sub}</div>
      </div>
    </Link>
  );
}

function StatTile({ href, label, value, color, alert, isText }: {
  href: string; label: string; value: string | number;
  color: string; alert?: boolean; isText?: boolean;
}) {
  return (
    <Link href={href} style={{ textDecoration: "none" }}>
      <div style={{
        background: c.panel,
        border: `1px solid ${c.line}`,
        borderTop: `3px solid ${alert ? "#ba7517" : color}`,
        borderRadius: 10,
        padding: "14px 16px",
        display: "flex", flexDirection: "column",
        gap: 4,
        transition: "box-shadow 0.15s",
      }}>
        <div style={{ fontSize: isText ? 17 : 26, fontWeight: 700, color: alert ? "#ba7517" : c.ink, lineHeight: 1.1 }}>
          {value}
        </div>
        <div style={{ fontSize: 11.5, color: c.muted, fontWeight: 500 }}>{label}</div>
      </div>
    </Link>
  );
}

function QuickCreate({ href, label, icon }: { href: string; label: string; icon: string }) {
  const iconMap: Record<string, React.ReactNode> = {
    case:    <Activity  size={15} color={pillar.teal.base}  />,
    contact: <Phone     size={15} color={pillar.blue.base}  />,
    quote:   <Package   size={15} color={pillar.amber.base} />,
    asset:   <Gear      size={15} color={pillar.green.base} />,
  };
  const bgMap: Record<string, string> = {
    case:    pillar.teal.bg,
    contact: pillar.blue.bg,
    quote:   pillar.amber.bg,
    asset:   pillar.green.bg,
  };
  return (
    <Link href={href} style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "9px 10px", borderRadius: 8,
      background: bgMap[icon] ?? c.panel2,
      border: `1px solid ${c.line}`,
      textDecoration: "none", fontSize: 12.5, color: c.ink, fontWeight: 500,
    }}>
      {iconMap[icon]}
      <span>{label}</span>
    </Link>
  );
}
