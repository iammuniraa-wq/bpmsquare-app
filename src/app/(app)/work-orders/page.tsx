import Link from "next/link";
import { listWorkOrders } from "@/lib/data";
import { c, pillar, type PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import PageHeader from "@/components/PageHeader";
import Pill from "@/components/Pill";
import ViewToggle from "@/components/ViewToggle";
import { ROUTES } from "@/lib/constants";
import type { WorkOrderStatus } from "@/lib/types";
import { Zap, Gear, Droplet, Battery, Monitor, Activity } from "@/components/Icons";

const STATUS_TONE: Record<WorkOrderStatus, PillarKey> = {
  scheduled: "blue", in_progress: "amber", completed: "green", invoiced: "teal",
};
const STATUS_LABEL: Record<WorkOrderStatus, string> = {
  scheduled: "Scheduled", in_progress: "In Progress", completed: "Completed", invoiced: "Invoiced",
};

function KindIcon({ kind, size = 14, color }: { kind: string; size?: number; color?: string }) {
  const p = { size, color: color ?? "currentColor" };
  switch (kind) {
    case "motor":       return <Zap {...p} />;
    case "transformer": return <Gear {...p} />;
    case "pump":        return <Droplet {...p} />;
    case "generator":   return <Battery {...p} />;
    case "panel":       return <Monitor {...p} />;
    default:            return <Activity {...p} />;
  }
}

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export default async function WorkOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; view?: string }>;
}) {
  const { status: statusFilter, view } = await searchParams;
  const isCard = view !== "list";
  const vp = view ? `&view=${view}` : "";

  const all = await listWorkOrders();
  const cnt = (s: WorkOrderStatus) => all.filter((r) => r.workOrder.status === s).length;
  const active = cnt("in_progress"), scheduled = cnt("scheduled"), done = cnt("completed") + cnt("invoiced");
  const rows = statusFilter ? all.filter((r) => r.workOrder.status === statusFilter) : all;

  const tabStyle = (active: boolean): React.CSSProperties => ({
    fontSize: 12.5, fontWeight: active ? 600 : 400,
    color: active ? c.accent : c.muted,
    background: active ? c.accentbg : "transparent",
    borderRadius: 6, padding: "5px 11px",
    textDecoration: "none", whiteSpace: "nowrap",
  });

  return (
    <>
      <PageHeader
        title="Work Orders"
        subtitle={`${all.length} total · ${active} in progress · ${scheduled} scheduled`}
        action={<ViewToggle />}
      />

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 14 }} className="hub-grid">
        {[
          { label: "In Progress", n: active,    tone: pillar.amber },
          { label: "Scheduled",   n: scheduled, tone: pillar.blue  },
          { label: "Completed",   n: done,      tone: pillar.green },
        ].map(({ label, n, tone }) => (
          <div key={label} style={{ ...cardStyle, textAlign: "center", padding: "14px 10px" }}>
            <div style={{ fontSize: 26, fontWeight: 700, color: n > 0 ? tone.base : c.hint }}>{n}</div>
            <div style={{ fontSize: 11.5, color: c.muted, marginTop: 2, fontWeight: 500 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Filter tabs — preserve view param */}
      <div style={{ ...cardStyle, padding: "7px 10px", marginBottom: 10, display: "flex", gap: 2, flexWrap: "wrap", alignItems: "center" }}>
        <Link href={`${ROUTES.workOrders}${view ? `?view=${view}` : ""}`}                           style={tabStyle(!statusFilter)}>All ({all.length})</Link>
        <Link href={`${ROUTES.workOrders}?status=scheduled${vp}`}    style={tabStyle(statusFilter === "scheduled")}>Scheduled ({cnt("scheduled")})</Link>
        <Link href={`${ROUTES.workOrders}?status=in_progress${vp}`}  style={tabStyle(statusFilter === "in_progress")}>In Progress ({cnt("in_progress")})</Link>
        <Link href={`${ROUTES.workOrders}?status=completed${vp}`}    style={tabStyle(statusFilter === "completed")}>Completed ({cnt("completed")})</Link>
        <Link href={`${ROUTES.workOrders}?status=invoiced${vp}`}     style={tabStyle(statusFilter === "invoiced")}>Invoiced ({cnt("invoiced")})</Link>
      </div>

      {rows.length === 0 ? (
        <p style={{ color: c.muted, fontSize: 13 }}>No work orders match this filter.</p>
      ) : isCard ? (
        // ── Card grid ──────────────────────────────────────────────────────────
        <div className="card-grid">
          {rows.map(({ workOrder: wo, account, asset, technician, authKind, serviceCase }) => {
            const tone = STATUS_TONE[wo.status];
            const p = pillar[tone];
            return (
              <Link
                key={wo.id}
                href={ROUTES.workOrder(wo.id)}
                style={{
                  ...cardStyle, textDecoration: "none",
                  borderTop: `3px solid ${p.base}`,
                  display: "flex", flexDirection: "column", gap: 8,
                  transition: "box-shadow .15s",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                  <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: c.ink }}>
                    {wo.ref}
                  </span>
                  <Pill label={STATUS_LABEL[wo.status]} tone={tone} />
                </div>

                <div style={{ fontSize: 13, fontWeight: 600, color: c.accent }}>{account.name}</div>

                {asset && (
                  <div style={{ fontSize: 12, color: c.muted }}>
                    <KindIcon kind={asset.kind} size={12} /> {asset.name}
                  </div>
                )}

                <div style={{ marginTop: "auto", paddingTop: 8, borderTop: `1px solid ${c.line}`, display: "flex", justifyContent: "space-between", fontSize: 11, color: c.hint }}>
                  <span>
                    {authKind === "contract" ? "▥ AMC" : "₹ Billable"}
                    {serviceCase ? ` · ${serviceCase.ref}` : ""}
                  </span>
                  <span>{wo.scheduled_for ? fmtDate(wo.scheduled_for) : ""}</span>
                </div>

                {technician && (
                  <div style={{ fontSize: 11, fontWeight: 600, background: p.bg, color: p.fg, borderRadius: 4, padding: "2px 7px", alignSelf: "flex-start" }}>
                    {technician.name}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      ) : (
        // ── Detailed list ──────────────────────────────────────────────────────
        <section style={cardStyle}>
          {rows.map(({ workOrder: wo, account, asset, technician, authRef, authKind, serviceCase }, i) => (
            <div
              key={wo.id}
              style={{
                display: "flex", alignItems: "flex-start", gap: 12,
                padding: "13px 0", borderTop: i === 0 ? "none" : `1px solid ${c.line}`,
              }}
            >
              <div style={{
                width: 3, alignSelf: "stretch", borderRadius: 2, flexShrink: 0,
                background: pillar[STATUS_TONE[wo.status]].base, minHeight: 44,
              }} />

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginBottom: 5 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "monospace", color: c.ink }}>{wo.ref}</span>
                  <Pill label={STATUS_LABEL[wo.status]} tone={STATUS_TONE[wo.status]} />
                  <Pill label={authKind === "quote" ? "Billable" : "AMC"} tone={authKind === "quote" ? "blue" : "teal"} />
                </div>

                <div style={{ fontSize: 13, marginBottom: 4 }}>
                  <Link href={ROUTES.account(account.id)} style={{ color: c.accent, fontWeight: 600, textDecoration: "none" }}>{account.name}</Link>
                  {asset && (
                    <span style={{ color: c.muted, fontSize: 12.5 }}>
                      {" · "}<KindIcon kind={asset.kind} size={12} /> {asset.name}
                    </span>
                  )}
                </div>

                {wo.description && (
                  <div style={{ fontSize: 12, color: c.muted, lineHeight: 1.45, marginBottom: 5 }}>
                    {wo.description.length > 110 ? wo.description.slice(0, 110) + "…" : wo.description}
                  </div>
                )}

                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11, color: c.hint, alignItems: "center" }}>
                  {technician && (
                    <span style={{ background: pillar.blue.bg, color: pillar.blue.fg, borderRadius: 4, padding: "1px 6px", fontSize: 10, fontWeight: 600 }}>
                      {technician.name}
                    </span>
                  )}
                  {wo.scheduled_for && <span>{fmtDate(wo.scheduled_for)}</span>}
                  <span style={{ color: authKind === "contract" ? pillar.teal.base : c.hint }}>
                    {authKind === "contract" ? "▥" : "₹"} {authRef}
                  </span>
                  {serviceCase && (
                    <Link href={ROUTES.case(serviceCase.id)} style={{ color: pillar.teal.base, textDecoration: "none", fontWeight: 500 }}>
                      {serviceCase.ref}
                    </Link>
                  )}
                </div>
              </div>

              <Link href={ROUTES.workOrder(wo.id)} style={{
                fontSize: 11, fontWeight: 600, color: c.accent, textDecoration: "none",
                background: c.accentbg, borderRadius: 6, padding: "4px 10px",
                flexShrink: 0, whiteSpace: "nowrap", alignSelf: "flex-start",
              }}>
                Open →
              </Link>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
