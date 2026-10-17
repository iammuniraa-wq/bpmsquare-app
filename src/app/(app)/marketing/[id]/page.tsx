import { notFound } from "next/navigation";
import { requireFeature, getTenant } from "@/lib/tenant";
import { requireWorkcenterView } from "@/lib/permissions";
import { getMarketingCampaign, listAccounts, countLeadsForCampaign } from "@/lib/data";
import { c, type PillarKey } from "@/lib/theme";
import StatusPill from "@/components/ui/StatusPill";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import ObjectRecordPage from "@/components/page/ObjectRecordPage";
import { ROUTES } from "@/lib/constants";
import type { MarketingCampaignStatus } from "@/lib/types";
import MarketingCampaignDetail from "./MarketingCampaignDetail";

const STATUS_TONE: Record<MarketingCampaignStatus, PillarKey> = {
  draft: "blue", sending: "amber", sent: "green", failed: "red",
};
const STATUS_LABEL: Record<MarketingCampaignStatus, string> = {
  draft: "Draft", sending: "Sending…", sent: "Sent", failed: "Failed",
};

const RECIPIENT_STATUS_LABEL: Record<string, string> = {
  sent: "Sent", failed: "Failed", skipped_opt_out: "Skipped (opted out)", skipped_no_email: "Skipped (no email)", pending: "Pending",
};
const RECIPIENT_STATUS_TONE: Record<string, "green" | "red" | "amber" | "blue"> = {
  sent: "green", failed: "red", skipped_opt_out: "amber", skipped_no_email: "amber", pending: "blue",
};

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireWorkcenterView("marketing");
  await requireFeature("marketing");
  const { id } = await params;
  const data = await getMarketingCampaign(id);
  if (!data) notFound();
  const { campaign, recipients } = data;
  const isDraft = campaign.status === "draft";

  const summaries = isDraft ? await listAccounts() : [];
  const accounts = summaries.map((s) => ({ id: s.account.id, name: s.account.name, type: s.account.type }));
  const tenant = await getTenant();
  const leadsGenerated = !isDraft && tenant ? await countLeadsForCampaign(id, tenant.id) : 0;

  return (
    <ObjectRecordPage
      backHref={ROUTES.marketing}
      backLabel="All campaigns"
      title={campaign.name}
      meta={campaign.subject || "No subject yet"}
      status={<StatusPill label={STATUS_LABEL[campaign.status]} tone={STATUS_TONE[campaign.status]} />}
      facts={isDraft ? [] : [
        { label: "Sent", value: <span style={{ color: "var(--teal)" }}>{campaign.sent_count}</span> },
        { label: "Failed", value: <span style={{ color: "var(--red)" }}>{campaign.failed_count}</span> },
        { label: "Skipped", value: campaign.skipped_count },
        { label: "Leads", value: <span style={{ color: c.accent }}>{leadsGenerated}</span> },
      ]}
      basePath={ROUTES.marketingCampaign(campaign.id)}
      tabs={[
        {
          id: "overview",
          label: isDraft ? "Campaign" : "Recipients",
          content: isDraft ? (
            <MarketingCampaignDetail campaign={campaign} accounts={accounts} />
          ) : (
            <Card
              title={`Recipients (${recipients.length})`}
              action={<span style={{ fontSize: 11, color: c.hint }}>
                {campaign.status === "sending" ? "Sending…" : campaign.sent_at ? `Sent ${new Date(campaign.sent_at).toLocaleString("en-IN")}` : ""}
              </span>}
            >
              {recipients.length === 0 ? (
                <EmptyState title="No recipients matched this campaign's targeting." />
              ) : (
                <div>
                  {recipients.map((r) => (
                    <div key={r.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: "9px 0", borderTop: `1px solid ${c.line}` }}>
                      <div>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: c.ink }}>{r.account_name ?? (r.manual_email ? "External contact" : "—")}</div>
                        <div style={{ fontSize: 11, color: c.hint }}>{r.email ?? r.manual_email ?? "—"}{r.error ? ` · ${r.error}` : ""}</div>
                      </div>
                      <StatusPill label={RECIPIENT_STATUS_LABEL[r.status] ?? r.status} tone={RECIPIENT_STATUS_TONE[r.status] ?? "blue"} />
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ),
        },
      ]}
    />
  );
}
