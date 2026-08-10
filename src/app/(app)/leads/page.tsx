import Link from "next/link";
import { requireFeature } from "@/lib/tenant";
import { requireWorkcenterView } from "@/lib/permissions";
import { listLeadsLive } from "@/lib/data/live";
import { listAccounts } from "@/lib/data";
import { c, pillar, type PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import PageHeader from "@/components/PageHeader";
import ListFilterBar from "@/components/ListFilterBar";
import Pill from "@/components/Pill";
import PagerLink from "@/components/PagerLink";
import { paginate, DEFAULT_PAGE_SIZE } from "@/lib/paginate";
import { ROUTES } from "@/lib/constants";
import NewLeadButton from "./NewLeadButton";

type LeadStatus = "new" | "inspecting" | "quoted" | "won" | "lost";
type LeadSource = "oem_referral" | "amc" | "direct" | "campaign";

const STATUS_TONE: Record<LeadStatus, PillarKey> = {
  new: "blue", inspecting: "teal", quoted: "amber", won: "green", lost: "red",
};
const STATUS_LABEL: Record<LeadStatus, string> = {
  new: "New", inspecting: "Inspecting", quoted: "Quoted", won: "Won", lost: "Lost",
};
const SOURCE_LABEL: Record<LeadSource, string> = {
  oem_referral: "OEM Referral", amc: "AMC", direct: "Direct", campaign: "Campaign",
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
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  await requireWorkcenterView("leads");
  await requireFeature("leads");
  const { status: statusFilter, q, page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const leads = await listLeadsLive();
  const summaries = await listAccounts();
  const accounts = summaries.map((s) => ({ id: s.account.id, name: s.account.name }));

  const byStatus = ALL_STATUSES.map((s) => ({
    status: s,
    count: leads.filter((l) => l.status === s).length,
  }));

  const needle = (q ?? "").trim().toLowerCase();
  const filtered = leads.filter((l) => {
    if (statusFilter && l.status !== statusFilter) return false;
    if (!needle) return true;
    return (
      (l.title ?? "").toLowerCase().includes(needle) ||
      (l.account_name ?? "").toLowerCase().includes(needle)
    );
  });
  const pageRows = paginate(filtered, page);

  return (
    <>
      <PageHeader
        title="Leads"
        subtitle={`${filtered.length}${statusFilter ? ` ${STATUS_LABEL[statusFilter as LeadStatus] ?? statusFilter}` : ""} of ${leads.length} total · Marketing & enquiries`}
        action={<NewLeadButton accounts={accounts} />}
      />

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

      <ListFilterBar
        searchValue={q}
        searchPlaceholder="Search lead title or account…"
        hiddenParams={{ status: statusFilter }}
        clearHref={ROUTES.leads}
      />

      {filtered.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: "center", padding: "48px 24px", color: c.muted }}>
          No leads yet. Add your first enquiry to start tracking.
        </div>
      ) : (
        <div style={{ ...cardStyle, overflowX: "auto" }}>
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
              {pageRows.map((lead) => (
                <tr key={lead.id}>
                  <td style={{ ...td, fontWeight: 600 }}>{lead.title ?? "—"}</td>
                  <td style={td}>{lead.account_name ?? "—"}</td>
                  <td style={{ ...td, color: c.muted }}>
                    {lead.source === "campaign" && lead.campaign_name ? (
                      lead.source_campaign_id ? (
                        <Link href={ROUTES.marketingCampaign(lead.source_campaign_id)} style={{ color: c.accent, textDecoration: "none" }}>
                          {lead.campaign_name}
                        </Link>
                      ) : lead.campaign_name
                    ) : (
                      SOURCE_LABEL[lead.source as LeadSource] ?? lead.source ?? "—"
                    )}
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
          <PagerLink
            page={page}
            total={filtered.length}
            pageSize={DEFAULT_PAGE_SIZE}
            baseHref={ROUTES.leads}
            hiddenParams={{ status: statusFilter, q }}
          />
        </div>
      )}
    </>
  );
}
