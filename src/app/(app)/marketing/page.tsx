import Link from "next/link";
import { requireFeature } from "@/lib/tenant";
import { requireWorkcenterView } from "@/lib/permissions";
import { listMarketingCampaigns } from "@/lib/data";
import { c, type PillarKey } from "@/lib/theme";
import StatusPill from "@/components/ui/StatusPill";
import ObjectListPage, { type ListColumn } from "@/components/page/ObjectListPage";
import { paginate } from "@/lib/paginate";
import { ROUTES } from "@/lib/constants";
import type { MarketingCampaignStatus } from "@/lib/types";

type Campaign = Awaited<ReturnType<typeof listMarketingCampaigns>>[number];

const STATUS_TONE: Record<MarketingCampaignStatus, PillarKey> = {
  draft: "blue", sending: "amber", sent: "green", failed: "red",
};
const STATUS_LABEL: Record<MarketingCampaignStatus, string> = {
  draft: "Draft", sending: "Sending…", sent: "Sent", failed: "Failed",
};

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export default async function MarketingPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  await requireWorkcenterView("marketing");
  await requireFeature("marketing");
  const { q, page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const campaigns = await listMarketingCampaigns();

  const needle = (q ?? "").trim().toLowerCase();
  const filtered = campaigns.filter((camp) => !needle || `${camp.name} ${camp.subject ?? ""}`.toLowerCase().includes(needle));
  const pageRows = paginate(filtered, page);

  const columns: ListColumn<Campaign>[] = [
    {
      id: "name", label: "Name", card: "title",
      render: (camp) => <Link href={ROUTES.marketingCampaign(camp.id)} style={{ color: c.ink, textDecoration: "none", fontWeight: 600 }}>{camp.name}</Link>,
    },
    { id: "subject", label: "Subject", cellStyle: { color: c.muted, maxWidth: 260 }, render: (camp) => (
      <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{camp.subject || "—"}</span>
    ) },
    { id: "status", label: "Status", render: (camp) => <StatusPill label={STATUS_LABEL[camp.status]} tone={STATUS_TONE[camp.status]} /> },
    { id: "sent", label: "Sent", render: (camp) => camp.sent_count },
    { id: "failed", label: "Failed", render: (camp) => camp.failed_count },
    { id: "skipped", label: "Skipped", render: (camp) => camp.skipped_count },
    { id: "created", label: "Created", cellStyle: { color: c.muted }, render: (camp) => fmtDate(camp.created_at) },
  ];

  return (
    <ObjectListPage
      title="Marketing campaigns"
      subtitle={`${campaigns.length} campaign${campaigns.length === 1 ? "" : "s"}`}
      newLabel="Campaign"
      newHref={ROUTES.marketingNew}
      search={{ value: q, placeholder: "Search by campaign name or subject…" }}
      columns={columns}
      rows={pageRows}
      rowKey={(camp) => camp.id}
      rowHref={(camp) => ROUTES.marketingCampaign(camp.id)}
      total={filtered.length}
      page={page}
      baseHref={ROUTES.marketing}
      linkParams={{ q }}
      filtered={!!needle}
      empty={{
        title: "No campaigns yet",
        text: "Send your first festival greeting or promo to your accounts.",
        filteredTitle: `No campaigns match "${q}".`,
      }}
    />
  );
}
