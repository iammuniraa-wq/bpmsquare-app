import Link from "next/link";
import { requireFeature, getTenant } from "@/lib/tenant";
import { requireWorkcenterView } from "@/lib/permissions";
import { listLeadsLive } from "@/lib/data/live";
import { listAccounts } from "@/lib/data";
import { c, type PillarKey } from "@/lib/theme";
import StatusPill from "@/components/ui/StatusPill";
import ObjectListPage, { type ListColumn } from "@/components/page/ObjectListPage";
import { paginate } from "@/lib/paginate";
import { ROUTES } from "@/lib/constants";
import NewLeadButton from "./NewLeadButton";
import ConvertLeadButton from "./ConvertLeadButton";

type LeadStatus = "new" | "inspecting" | "quoted" | "won" | "lost" | "converted";
type LeadSource = "oem_referral" | "amc" | "direct" | "campaign";

const STATUS_TONE: Record<LeadStatus, PillarKey> = {
  new: "blue", inspecting: "teal", quoted: "amber", won: "green", lost: "red", converted: "green",
};
const STATUS_LABEL: Record<LeadStatus, string> = {
  new: "New", inspecting: "Inspecting", quoted: "Quoted", won: "Won", lost: "Lost", converted: "Converted to deal",
};
const SOURCE_LABEL: Record<LeadSource, string> = {
  oem_referral: "OEM Referral", amc: "AMC", direct: "Direct", campaign: "Campaign",
};

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

const ALL_STATUSES: LeadStatus[] = ["new", "inspecting", "quoted", "won", "lost"];

type LeadRow = Awaited<ReturnType<typeof listLeadsLive>>[number];

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
  const pipelineOn = (await getTenant())?.features?.pipeline === true;
  const summaries = await listAccounts();
  const accounts = summaries.map((s) => ({ id: s.account.id, name: s.account.name }));

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

  const chips = [
    ...ALL_STATUSES.map((s) => ({
      id: s,
      label: `${STATUS_LABEL[s]} (${leads.filter((l) => l.status === s).length})`,
      href: statusFilter === s ? ROUTES.leads : `${ROUTES.leads}?status=${s}`,
      active: statusFilter === s,
    })),
  ];

  const columns: ListColumn<LeadRow>[] = [
    { id: "title", label: "Name", card: "title", cellStyle: { fontWeight: 600 }, render: (lead) => lead.title ?? "—" },
    { id: "account", label: "Account", render: (lead) => lead.account_name ?? "—" },
    {
      id: "source", label: "Source", cellStyle: { color: c.muted },
      render: (lead) => (
        lead.source === "campaign" && lead.campaign_name ? (
          lead.source_campaign_id ? (
            <Link href={ROUTES.marketingCampaign(lead.source_campaign_id)} style={{ color: c.accent, textDecoration: "none" }}>
              {lead.campaign_name}
            </Link>
          ) : lead.campaign_name
        ) : (
          SOURCE_LABEL[lead.source as LeadSource] ?? lead.source ?? "—"
        )
      ),
    },
    {
      id: "status", label: "Status",
      render: (lead) => <StatusPill label={STATUS_LABEL[lead.status as LeadStatus] ?? lead.status} tone={STATUS_TONE[lead.status as LeadStatus] ?? "blue"} />,
    },
    { id: "created", label: "Created", cellStyle: { color: c.muted }, render: (lead) => (lead.created_at ? fmtDate(lead.created_at) : "—") },
    ...(pipelineOn ? [{
      id: "convert", label: "", cellStyle: { textAlign: "right" as const },
      render: (lead: LeadRow) => (lead.status !== "converted" && lead.status !== "lost" ? <ConvertLeadButton leadId={lead.id} /> : null),
    }] : []),
  ];

  return (
    <ObjectListPage
      title="Leads"
      subtitle={`${filtered.length}${statusFilter ? ` ${STATUS_LABEL[statusFilter as LeadStatus] ?? statusFilter}` : ""} of ${leads.length} total · Marketing & enquiries`}
      newAction={<NewLeadButton accounts={accounts} />}
      chips={chips}
      search={{
        value: q,
        placeholder: "Search lead title or account…",
        hiddenParams: { status: statusFilter },
      }}
      columns={columns}
      rows={pageRows}
      rowKey={(lead) => lead.id}
      total={filtered.length}
      page={page}
      baseHref={ROUTES.leads}
      linkParams={{ status: statusFilter, q }}
      filtered={!!(needle || statusFilter)}
      empty={{
        title: "No leads yet",
        text: "Add your first enquiry to start tracking.",
        filteredTitle: "No leads match these filters.",
      }}
    />
  );
}
