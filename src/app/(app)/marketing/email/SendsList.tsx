import Link from "next/link";
import { requireFeature } from "@/lib/tenant";
import { requireWorkcenterView } from "@/lib/permissions";
import { listMarketingCampaigns } from "@/lib/data";
import { c, type PillarKey } from "@/lib/theme";
import Button from "@/components/ui/Button";
import StatusPill from "@/components/ui/StatusPill";
import ObjectListPage, { type ListColumn, type ListChip } from "@/components/page/ObjectListPage";
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

/** The Sends view of Email: every campaign record, plain or newsletter. */
export default async function SendsList({ q, page: pageParam, viewChips, studio }: { q?: string; page?: string; viewChips?: ListChip[]; studio: boolean }) {
  await requireWorkcenterView("marketing");
  await requireFeature("marketing");
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
    { id: "type", label: "Type", card: "hidden", render: (camp) => <span style={{ color: c.muted }}>{camp.newsletter_version_id ? "Newsletter" : "Plain"}</span> },
    { id: "subject", label: "Subject", cellStyle: { color: c.muted, maxWidth: 260 }, render: (camp) => (
      <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{camp.subject || "—"}</span>
    ) },
    { id: "status", label: "Status", render: (camp) => <StatusPill label={STATUS_LABEL[camp.status]} tone={STATUS_TONE[camp.status]} /> },
    { id: "sent", label: "Sent", render: (camp) => camp.sent_count },
    { id: "failed", label: "Failed", render: (camp) => camp.failed_count },
    { id: "skipped", label: "Left out", render: (camp) => camp.skipped_count },
    { id: "created", label: "Created", cellStyle: { color: c.muted }, render: (camp) => fmtDate(camp.created_at) },
  ];

  return (
    <ObjectListPage
      title="Email"
      subtitle={`${campaigns.length} send${campaigns.length === 1 ? "" : "s"}`}
      newLabel="Email"
      newHref={ROUTES.marketingNew}
      newAction={studio ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button href={ROUTES.marketingNew} variant="primary">+ New email</Button>
          <Button href={ROUTES.marketingNewsletterNew}>+ New newsletter</Button>
        </div>
      ) : undefined}
      chips={viewChips}
      search={{ value: q, placeholder: "Search by name or subject…", hiddenParams: { view: viewChips ? "sends" : undefined } }}
      columns={columns}
      rows={pageRows}
      rowKey={(camp) => camp.id}
      rowHref={(camp) => ROUTES.marketingCampaign(camp.id)}
      total={filtered.length}
      page={page}
      baseHref={ROUTES.marketingEmail}
      linkParams={{ q, view: viewChips ? "sends" : undefined }}
      filtered={!!needle}
      empty={{
        title: "No emails yet",
        text: "Send your first festival greeting or promo to your accounts.",
        filteredTitle: `No emails match "${q}".`,
      }}
    />
  );
}
