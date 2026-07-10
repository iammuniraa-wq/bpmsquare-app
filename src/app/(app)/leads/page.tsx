import Link from "next/link";
import { requireFeature } from "@/lib/tenant";
import { listLeadsLive } from "@/lib/data/live";
import { c, pillar, type PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import PageHeader from "@/components/PageHeader";
import Pill from "@/components/Pill";
import { ROUTES } from "@/lib/constants";

type LeadStatus = "new" | "inspecting" | "quoted" | "won" | "lost";
type LeadSource = "oem_referral" | "amc" | "direct";

const STATUS_TONE: Record<LeadStatus, PillarKey> = {
  new: "blue", inspecting: "teal", quoted: "amber", won: "green", lost: "red",
};
const STATUS_LABEL: Record<LeadStatus, string> = {
  new: "New", inspecting: "Inspecting", quoted: "Quoted", won: "Won", lost: "Lost",
};
const SOURCE_LABEL: Record<LeadSource, string> = {
  oem_referral: "OEM Referral", amc: "AMC", direct: "Direct",
};

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

const th: React.CSSProperties = {
  textAlign: "left", color: c.hint, fontWeight: 500,
  padding: "9px 12px", borderBottom: `1px solid ${c.line}`, fontSize: 11.5,
};
const td: React.CSSProperties = {
  padding: "10px 12px", borderBottom: `1px solid ${c.line}`,
  fontSize: 12.5, verticalAlign: "middle",
};

const ALL_STATUSES: LeadStatus[] = ["new", "inspecting", "quoted", "won", "lost"];

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireFeature("leads");
  const { status: statusFilter } = await searchParams;
  const leads = await listLeadsLive();

  const byStatus = ALL_STATUSES.map((s) => ({
    status: s,
    count: leads.filter((l) => l.status === s).length,
  }));

  const filtered = statusFilter
    ? leads.filter((l) => l.status === statusFilter)
    : leads;

  return (
    <>
      <PageHeader title="Leads" subtitle={`${filtered.length}${statusFilter ? ` ${STATUS_LABEL[statusFilter as LeadStatus] ?? statusFilter}` : ""} of ${leads.length} total · Marketing & enquiries`} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 16 }}>
        {byStatus.map(({ status, count }) => (
          <Link key={status} href={statusFilter === status ? ROUTES.leads : `${ROUTES.leads}?status=${status}`} style={{ textDecoration: "none" }}>
            <div style={{
              ...cardStyle, textAlign: "center",
              borderColor: statusFilter === status ? pillar[STATUS_TONE[status]].base : undefined,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
                {STATUS_LABEL[status]}
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: pillar[STATUS_TONE[status]].base }}>{count}</div>
            </div>
          </Link>
        ))}
      </div>

      {statusFilter && (
        <div style={{ marginBottom: 12 }}>
          <Link href={ROUTES.leads} style={{ fontSize: 12, color: c.hint, textDecoration: "none" }}>
            ← Show all leads
          </Link>
        </div>
      )}

      {filtered.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: "center", padding: "48px 24px", color: c.muted }}>
          No leads yet. Add your first enquiry to start tracking.
        </div>
      ) : (
        <div style={cardStyle}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Name</th>
                <th style={th}>Account</th>
                <th style={th}>Source</th>
                <th style={th}>Status</th>
                <th style={th}>Created</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((lead) => (
                <tr key={lead.id}>
                  <td style={{ ...td, fontWeight: 600 }}>{lead.title ?? "—"}</td>
                  <td style={td}>{lead.account_name ?? "—"}</td>
                  <td style={{ ...td, color: c.muted }}>
                    {SOURCE_LABEL[lead.source as LeadSource] ?? lead.source ?? "—"}
                  </td>
                  <td style={td}>
                    <Pill
                      label={STATUS_LABEL[lead.status as LeadStatus] ?? lead.status}
                      tone={STATUS_TONE[lead.status as LeadStatus] ?? "blue"}
                    />
                  </td>
                  <td style={{ ...td, color: c.muted }}>
                    {lead.created_at ? fmtDate(lead.created_at) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
