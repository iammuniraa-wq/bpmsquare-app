import Link from "next/link";
import { notFound } from "next/navigation";
import { getWorkOrder, CASE_STATUS_LABEL } from "@/lib/data";
import { c, pillar, type PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import PageHeader from "@/components/PageHeader";
import Pill from "@/components/Pill";
import WorkOrderActions from "./WorkOrderActions";
import { ROUTES } from "@/lib/constants";
import TabTitle from "@/components/TabTitle";
import CustomFieldsSection from "@/components/CustomFieldsSection";
import type { WorkOrderStatus } from "@/lib/types";
import { Zap, Gear, Droplet, Battery, Activity } from "@/components/Icons";

const STATUS_TONE: Record<WorkOrderStatus, PillarKey> = {
  scheduled: "blue", in_progress: "amber", completed: "green", invoiced: "teal",
};
const STATUS_LABEL: Record<WorkOrderStatus, string> = {
  scheduled: "Scheduled", in_progress: "In Progress", completed: "Completed", invoiced: "Invoiced",
};
const KIND_LABEL: Record<string, string> = {
  motor: "Motor", transformer: "Transformer", pump: "Pump", generator: "Generator", panel: "Panel",
};
const CASE_TONE: Record<string, PillarKey> = {
  intake: "blue", inspection: "teal",
  report_sent: "amber", report_approved: "green",
  quote_sent: "amber", quote_approved: "green",
  in_repair: "amber", qa: "teal",
  ready: "green", closed: "green", buyback: "purple", scrapped: "red",
};

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "5px 0", fontSize: 12.5, borderTop: `1px solid ${c.line}` }}>
      <span style={{ color: c.muted, flexShrink: 0 }}>{label}</span>
      <span style={{ textAlign: "right" }}>{value}</span>
    </div>
  );
}

export default async function WorkOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getWorkOrder(id);
  if (!data) notFound();

  const { workOrder: wo, account, asset, technician, serviceCase, quote, contract, loanerAsset } = data;

  return (
    <>
      <TabTitle title={wo.ref} />
      <div style={{ marginBottom: 10 }}>
        <Link href={ROUTES.workOrders} style={{ fontSize: 12, color: c.muted, textDecoration: "none" }}>
          ← All work orders
        </Link>
      </div>

      <PageHeader
        title={wo.ref}
        subtitle={`Field Service · Work Order · ${account?.name ?? ""}`}
      />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <Pill label={STATUS_LABEL[wo.status]} tone={STATUS_TONE[wo.status]} />
        <Pill label={wo.authorized_by.kind === "quote" ? "Billable" : "AMC"} tone={wo.authorized_by.kind === "quote" ? "blue" : "teal"} />
        <div style={{ marginLeft: "auto" }}>
          <WorkOrderActions id={wo.id} status={wo.status} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 12 }} className="hub-grid">

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          {wo.description && (
            <section style={cardStyle}>
              <h3 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 10px" }}>Scope of work</h3>
              <p style={{ fontSize: 13, color: c.ink, lineHeight: 1.65, margin: 0 }}>{wo.description}</p>
            </section>
          )}

          {asset && (
            <section style={cardStyle}>
              <h3 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 10px" }}>Asset under service</h3>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{
                  width: 42, height: 42, borderRadius: 10, flexShrink: 0,
                  background: pillar.green.bg, color: pillar.green.fg,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {asset.kind === "motor" ? <Zap size={20} color={pillar.green.fg} /> : asset.kind === "transformer" ? <Gear size={20} color={pillar.green.fg} /> : asset.kind === "pump" ? <Droplet size={20} color={pillar.green.fg} /> : asset.kind === "generator" ? <Battery size={20} color={pillar.green.fg} /> : <Activity size={20} color={pillar.green.fg} />}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: c.ink }}>{asset.name}</div>
                  <div style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>
                    {KIND_LABEL[asset.kind] ?? asset.kind}{asset.rating ? " · " + asset.rating : ""}
                  </div>
                  {asset.serial && (
                    <div style={{ fontSize: 11, color: c.hint, marginTop: 2, fontFamily: "monospace" }}>S/N {asset.serial}</div>
                  )}
                </div>
              </div>
            </section>
          )}

          {loanerAsset && (
            <section style={{ ...cardStyle, borderLeft: `3px solid ${pillar.amber.base}`, background: pillar.amber.bg }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: pillar.amber.base }}>
                  Loaner dispatched
                </span>
                <Pill label="On Loan" tone="amber" />
              </div>
              <div style={{ fontWeight: 600, fontSize: 13, color: c.ink }}>{loanerAsset.name}</div>
              {loanerAsset.rating && (
                <div style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>{loanerAsset.rating}</div>
              )}
              {loanerAsset.serial && (
                <div style={{ fontSize: 11, color: c.hint, marginTop: 2, fontFamily: "monospace" }}>S/N {loanerAsset.serial}</div>
              )}
              <div style={{ fontSize: 11.5, color: pillar.amber.base, marginTop: 8, fontWeight: 500 }}>
                Return loaner on delivery of repaired unit
              </div>
            </section>
          )}

          {wo.notes && (
            <section style={cardStyle}>
              <h3 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 8px" }}>Technician notes</h3>
              <p style={{ fontSize: 12.5, color: c.muted, lineHeight: 1.6, margin: 0 }}>{wo.notes}</p>
            </section>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          <section style={cardStyle}>
            <h3 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 6px" }}>Assignment</h3>
            {account && (
              <Detail label="Account" value={
                <Link href={ROUTES.account(account.id)} style={{ color: c.accent, textDecoration: "none" }}>{account.name}</Link>
              } />
            )}
            {technician && <Detail label="Technician" value={technician.name} />}
            {technician?.skills && <Detail label="Skills" value={<span style={{ fontSize: 11.5, color: c.muted }}>{technician.skills}</span>} />}
            {wo.scheduled_for && <Detail label="Scheduled" value={fmtDate(wo.scheduled_for)} />}
          </section>

          <section style={cardStyle}>
            <h3 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 6px" }}>Authorization</h3>
            {quote && (
              <>
                <Detail label="Type" value={<Pill label="Billable" tone="blue" />} />
                <Detail label="Quote" value={
                  <Link href={ROUTES.quotation(quote.id)} style={{ color: c.accent, fontFamily: "monospace", textDecoration: "none" }}>{quote.ref}</Link>
                } />
                <Detail label="Value" value={`₹${quote.total.toLocaleString("en-IN")}`} />
              </>
            )}
            {contract && (
              <>
                <Detail label="Type" value={<Pill label="AMC" tone="teal" />} />
                <Detail label="Contract" value={<span style={{ fontFamily: "monospace", fontSize: 12 }}>{contract.ref}</span>} />
                {contract.value && <Detail label="AMC value" value={`₹${contract.value.toLocaleString("en-IN")}`} />}
              </>
            )}
          </section>

          {serviceCase && (
            <section style={cardStyle}>
              <h3 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 8px" }}>Service case</h3>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <Link
                  href={ROUTES.case(serviceCase.id)}
                  style={{ fontSize: 12.5, fontWeight: 600, color: c.accent, fontFamily: "monospace", textDecoration: "none" }}
                >
                  {serviceCase.ref}
                </Link>
                <Pill label={CASE_STATUS_LABEL[serviceCase.status]} tone={CASE_TONE[serviceCase.status] ?? "blue"} />
              </div>
              <div style={{ fontSize: 12, color: c.muted, marginTop: 6, lineHeight: 1.4 }}>
                {serviceCase.equipment_label}
              </div>
              <Link
                href={ROUTES.case(serviceCase.id)}
                style={{
                  display: "inline-block", marginTop: 10, fontSize: 11, fontWeight: 600,
                  color: c.accent, background: c.accentbg, borderRadius: 6, padding: "3px 8px",
                  textDecoration: "none",
                }}
              >
                View case
              </Link>
            </section>
          )}
        </div>
      </div>

      <CustomFieldsSection
        objectType="work_order"
        recordId={wo.id}
        customData={(wo as Record<string, unknown>).custom_data as Record<string, unknown> | null}
        patchUrl={`/api/work-orders/${wo.id}`}
      />
    </>
  );
}
