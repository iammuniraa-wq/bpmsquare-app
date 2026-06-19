import Link from "next/link";
import { getDashboardSummary, CASE_STATUS_LABEL } from "@/lib/data";
import type { ServiceCase, WorkOrder } from "@/lib/types";
import { c } from "@/lib/theme";
import type { PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import PageHeader from "@/components/PageHeader";
import Pill from "@/components/Pill";
import { ROUTES } from "@/lib/constants";

const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

const PILLAR_ACT: Record<string, PillarKey> = {
  marketing: "purple",
  sales:     "blue",
  service:   "teal",
  field:     "amber",
  finance:   "green",
};

const WO_STATUS_LABEL: Record<WorkOrder["status"], string> = {
  scheduled:   "Scheduled",
  in_progress: "In progress",
  completed:   "Completed",
  invoiced:    "Invoiced",
};

const ATTENTION_STATUS_INFO: Record<string, { label: string; tone: PillarKey; action: string }> = {
  report_sent: { label: "Report sent", tone: "purple", action: "Awaiting customer approval on inspection report" },
  quote_sent:  { label: "Quote sent",  tone: "amber",  action: "Awaiting customer approval on quotation" },
};

export default async function DashboardPage() {
  const { kpis, attention, workOrderRows, recentActivity } = await getDashboardSummary();

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Vikas Pioneers workspace · today's overview"
      />

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 16 }}>
        <KpiCard label="Open cases"         value={kpis.openCases}        sub="active service cases"          tone="teal"   />
        <KpiCard label="In repair"          value={kpis.inRepair}          sub="units in workshop"              tone="blue"   />
        <KpiCard label="Awaiting customer"  value={kpis.awaitingApproval}  sub="approval pending"               tone="amber"  />
        <KpiCard label="Active AMC contracts" value={kpis.activeContracts} sub="covered accounts"               tone="teal"   />
        <KpiCard label="Work orders active" value={kpis.activeWorkOrders}  sub="scheduled + in progress"        tone="amber"  />
        <KpiCard label="Open quote value"   value={inr(kpis.openQuoteValue)} sub="sent + approved quotes"       tone="blue" isText />
      </div>

      {/* Two-column middle section */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 12, marginBottom: 12 }}>

        {/* Cases needing attention */}
        <section style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: c.ink }}>Cases needing attention</h2>
            <Link href={ROUTES.cases} style={{ fontSize: 12, color: c.accent }}>All cases →</Link>
          </div>

          {attention.length === 0 ? (
            <p style={{ margin: 0, color: c.hint, fontSize: 13 }}>No cases awaiting customer response.</p>
          ) : (
            attention.map(({ serviceCase: sc, account }) => {
              const info = ATTENTION_STATUS_INFO[sc.status];
              return (
                <div
                  key={sc.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    padding: "10px 0",
                    borderTop: `1px solid ${c.line}`,
                    gap: 12,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                      <Link
                        href={ROUTES.case(sc.id)}
                        style={{ fontFamily: "monospace", fontSize: 12.5, fontWeight: 600, color: c.accent, textDecoration: "none" }}
                      >
                        {sc.ref}
                      </Link>
                      <Pill label={info?.label ?? CASE_STATUS_LABEL[sc.status]} tone={info?.tone ?? "blue"} />
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>{sc.equipment_label}</div>
                    <div style={{ fontSize: 12, color: c.muted }}>{account?.name}</div>
                    <div style={{ fontSize: 11.5, color: c.hint, marginTop: 3 }}>{info?.action}</div>
                  </div>
                  <Link
                    href={ROUTES.case(sc.id)}
                    style={{ fontSize: 12, color: c.accent, whiteSpace: "nowrap", flexShrink: 0 }}
                  >
                    View →
                  </Link>
                </div>
              );
            })
          )}
        </section>

        {/* Right panel — quick links + work orders */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Quick access */}
          <section style={cardStyle}>
            <h2 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 600, color: c.ink }}>Quick access</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <QuickLink href={ROUTES.accounts} label="Accounts"   count="8"         tone="blue"   />
              <QuickLink href={ROUTES.cases}    label="Cases"      count="3 open"    tone="teal"   />
              <QuickLink href={ROUTES.workOrders} label="Work orders" count="2 active" tone="amber" />
              <QuickLink href={ROUTES.quotations} label="Quotations" count={inr(kpis.openQuoteValue)} tone="blue" />
            </div>
          </section>

          {/* Active work orders */}
          {workOrderRows.length > 0 && (
            <section style={cardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: c.ink }}>Work orders</h2>
                <Link href={ROUTES.workOrders} style={{ fontSize: 12, color: c.accent }}>All →</Link>
              </div>
              {workOrderRows.map(({ workOrder: wo, account, tech }) => (
                <div key={wo.id} style={{ borderTop: `1px solid ${c.line}`, paddingTop: 8, marginTop: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 600, color: c.ink }}>{wo.ref}</span>
                    <Pill
                      label={WO_STATUS_LABEL[wo.status]}
                      tone={wo.status === "in_progress" ? "teal" : "amber"}
                    />
                  </div>
                  <div style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>{account?.name}</div>
                  {tech && <div style={{ fontSize: 11.5, color: c.hint }}>{tech.name}</div>}
                </div>
              ))}
            </section>
          )}
        </div>
      </div>

      {/* Recent activity */}
      <section style={cardStyle}>
        <h2 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600, color: c.ink }}>Recent activity</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {recentActivity.map(({ activity, account }) => (
            <div
              key={activity.id}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                padding: "9px 0",
                borderTop: `1px solid ${c.line}`,
              }}
            >
              <ActivityDot pillar={activity.pillar} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: c.ink }}>{activity.text}</div>
                <div style={{ fontSize: 11.5, color: c.hint, marginTop: 2 }}>
                  {account?.name} · {fmtDate(activity.at)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

const TONES = {
  blue:   { fg: "#0c447c", bg: "#e6f1fb", accent: "#378ADD" },
  teal:   { fg: "#04342c", bg: "#e1f5ee", accent: "#1d9e75" },
  amber:  { fg: "#633806", bg: "#faeeda", accent: "#ba7517" },
  green:  { fg: "#173404", bg: "#eaf3de", accent: "#639922" },
  purple: { fg: "#26215c", bg: "#eeedfe", accent: "#7f77dd" },
  red:    { fg: "#791f1f", bg: "#fcebeb", accent: "#a32d2d" },
} as const;

function KpiCard({
  label, value, sub, tone, isText,
}: {
  label: string; value: string | number; sub: string; tone: keyof typeof TONES; isText?: boolean;
}) {
  const p = TONES[tone];
  return (
    <div style={{ background: p.bg, borderRadius: 10, padding: "14px 16px" }}>
      <div style={{ fontSize: isText ? 18 : 26, fontWeight: 700, color: p.fg, lineHeight: 1.1 }}>
        {value}
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: p.fg, marginTop: 4 }}>{label}</div>
      <div style={{ fontSize: 11, color: p.fg, opacity: 0.65, marginTop: 1 }}>{sub}</div>
    </div>
  );
}

function QuickLink({
  href, label, count, tone,
}: {
  href: string; label: string; count: string; tone: keyof typeof TONES;
}) {
  const p = TONES[tone];
  return (
    <Link
      href={href}
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "7px 10px",
        borderRadius: 7,
        background: p.bg,
        textDecoration: "none",
        fontSize: 13,
        color: p.fg,
        fontWeight: 500,
      }}
    >
      <span>{label}</span>
      <span style={{ fontSize: 11.5, opacity: 0.7 }}>{count}</span>
    </Link>
  );
}

const ACT_DOT: Record<string, { bg: string; fg: string }> = {
  marketing: { bg: "#eeedfe", fg: "#7f77dd" },
  sales:     { bg: "#e6f1fb", fg: "#378ADD" },
  service:   { bg: "#e1f5ee", fg: "#1d9e75" },
  field:     { bg: "#faeeda", fg: "#ba7517" },
  finance:   { bg: "#eaf3de", fg: "#639922" },
};

function ActivityDot({ pillar }: { pillar: string }) {
  const { bg, fg } = ACT_DOT[pillar] ?? ACT_DOT.service;
  return (
    <div style={{
      width: 28, height: 28, borderRadius: "50%", background: bg,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 11, color: fg, fontWeight: 700, flexShrink: 0,
    }}>
      {pillar.slice(0, 1).toUpperCase()}
    </div>
  );
}
