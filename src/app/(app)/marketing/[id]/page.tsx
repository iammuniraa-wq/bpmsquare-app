import Link from "next/link";
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
import { recipientStatusLabel, skipReason } from "@/lib/marketing/skipReasons";
import { loadComposeNewsletter } from "@/lib/newsletter/composeData";
import { loadCampaignEngagement } from "@/lib/newsletter/engagement";
import { languageDef } from "@/lib/newsletter/types";

const STATUS_TONE: Record<MarketingCampaignStatus, PillarKey> = {
  draft: "blue", sending: "amber", sent: "green", failed: "red",
};
const STATUS_LABEL: Record<MarketingCampaignStatus, string> = {
  draft: "Draft", sending: "Sending…", sent: "Sent", failed: "Failed",
};

const RECIPIENT_STATUS_TONE: Record<string, "green" | "red" | "amber" | "blue"> = {
  sent: "green", failed: "red", pending: "blue",
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
  // Only a campaign that sends a newsletter version, in a workspace that has the studio, carries any of this.
  const nl = campaign.newsletter_version_id && tenant ? await loadComposeNewsletter(tenant.id, campaign.newsletter_version_id) : null;
  const engagement = nl && !isDraft && tenant ? await loadCampaignEngagement(tenant.id, campaign.id, campaign.newsletter_version_id as string) : null;

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
        { label: "Left out", value: campaign.skipped_count },
        { label: "Leads", value: <span style={{ color: c.accent }}>{leadsGenerated}</span> },
      ]}
      basePath={ROUTES.marketingCampaign(campaign.id)}
      tabs={[
        {
          id: "overview",
          label: isDraft ? "Campaign" : "Recipients",
          content: isDraft ? (
            <MarketingCampaignDetail campaign={campaign} accounts={accounts} newsletter={nl} />
          ) : (
            <>
            {engagement && (
              <Card title="How it went, by language and by link">
                <div style={{ display: "grid", gap: 14 }}>
                  <div>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: c.muted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>Language</div>
                    {engagement.languages.length === 0 ? <span style={{ fontSize: 12.5, color: c.hint }}>Nothing was sent.</span> : engagement.languages.map((l) => (
                      <div key={l.lang} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: c.ink, padding: "3px 0" }}>
                        <span>{languageDef(l.lang)?.name ?? l.lang}</span>
                        <span style={{ color: c.muted }}>{l.sent} sent{l.failed ? ` · ${l.failed} failed` : ""}{l.skipped ? ` · ${l.skipped} skipped` : ""}</span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: c.muted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>Clicks per link</div>
                    {engagement.links.length === 0 ? <span style={{ fontSize: 12.5, color: c.hint }}>No links in this newsletter.</span> : engagement.links.map((l) => (
                      <div key={l.index} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.5, color: c.ink, padding: "3px 0" }}>
                        <span style={{ overflowWrap: "anywhere" }}>{l.label}</span>
                        <span style={{ color: c.muted, whiteSpace: "nowrap" }}>{l.clicks} click{l.clicks === 1 ? "" : "s"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            )}
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
                  {recipients.map((r) => {
                    const skipped = r.status.startsWith("skipped_");
                    const why = skipped ? skipReason(r.error || r.status, { accountId: r.account_id, email: r.email ?? r.manual_email }) : null;
                    return (
                      <div key={r.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: "9px 0", borderTop: `1px solid ${c.line}` }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 600, color: c.ink }}>{r.account_name ?? (r.manual_email ? "External contact" : "—")}</div>
                          <div style={{ fontSize: 11, color: c.hint, overflowWrap: "anywhere" }}>
                            {r.email ?? r.manual_email ?? "—"}
                            {why ? ` · ${why.why}` : r.error ? ` · ${r.error}` : ""}
                          </div>
                          {why?.fix && <Link href={why.fix.href} style={{ fontSize: 12, color: c.accent, fontWeight: 600 }}>{why.fix.label}</Link>}
                        </div>
                        <StatusPill label={recipientStatusLabel(r.status)} tone={skipped ? "amber" : (RECIPIENT_STATUS_TONE[r.status] ?? "blue")} />
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
            </>
          ),
        },
      ]}
    />
  );
}
