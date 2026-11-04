import Link from "next/link";
import { getTenant } from "@/lib/tenant";
import { requireWorkcenterView } from "@/lib/permissions";
import { requireFeature } from "@/lib/tenant";
import { listMarketingCampaigns, listMarketingTargetGroups } from "@/lib/data";
import { marketingHomeCounts } from "@/lib/marketing/homeCounts";
import { ROUTES } from "@/lib/constants";
import { c } from "@/lib/theme";
import PageHeader from "@/components/PageHeader";
import Card from "@/components/ui/Card";
import OverviewPath, { type PathStep } from "@/components/marketing/OverviewPath";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Marketing Overview (docs/design/marketing-two-parts.md section 6): reach people in four steps, each with a number and one
 * button. The old campaign list lives at /marketing/email; this address used to be that list, so it still shows the latest emails.
 */
export default async function MarketingOverviewPage() {
  await requireWorkcenterView("marketing");
  await requireFeature("marketing");
  const tenant = await getTenant();
  const features = (tenant?.features ?? {}) as Record<string, boolean | undefined>;
  const [campaigns, groups, counts] = await Promise.all([
    listMarketingCampaigns(),
    listMarketingTargetGroups(),
    tenant ? marketingHomeCounts(tenant.id, features) : Promise.resolve({ liveJourneys: null, liveForms: null, events: null, whatsappTemplates: null }),
  ]);

  const drafts = campaigns.filter((x) => x.status === "draft");
  const sent = campaigns.filter((x) => x.status === "sent");
  const last = sent[0];

  const steps: PathStep[] = [
    { n: 1, label: "Audience", value: String(groups.length), text: groups.length ? "saved audiences. Pick one, or send to everyone we can email." : "No saved audience yet. Start with everyone we can email, or build one.", href: ROUTES.marketingSegments, action: "Audiences" },
    { n: 2, label: "Message", value: drafts.length ? plural(drafts.length, "draft") : null, text: drafts.length ? "waiting to be finished or sent." : "Write your first email.", href: drafts.length ? ROUTES.marketingEmail : ROUTES.marketingNew, action: drafts.length ? "Open Email" : "New email" },
    { n: 3, label: "Review and send", value: null, text: drafts[0] ? `"${drafts[0].name}" is ready to review. The count and the reasons are shown before it goes.` : "Nothing waiting to send.", href: drafts[0] ? ROUTES.marketingCampaign(drafts[0].id) : ROUTES.marketingEmail, action: drafts[0] ? "Review" : "Email", tone: drafts[0] ? "warn" : undefined },
    { n: 4, label: "What happened", value: last ? `${last.sent_count} sent` : null, text: last ? `${last.name}: ${last.skipped_count} left out, ${last.failed_count} failed.` : "Appears after the first send.", href: last ? ROUTES.marketingCampaign(last.id) : ROUTES.marketingEmail, action: last ? "Open" : "Email", tone: last ? "good" : undefined },
  ];

  const always: { label: string; href: string; chip: string | null; on: boolean }[] = [
    { label: "Journeys", href: ROUTES.marketingJourneys, chip: counts.liveJourneys === null ? null : `${counts.liveJourneys} running`, on: !!features.journeys },
    { label: "Forms", href: ROUTES.marketingForms, chip: counts.liveForms === null ? null : `${counts.liveForms} live`, on: !!features.marketing_forms },
    { label: "Events", href: ROUTES.marketingEvents, chip: counts.events === null ? null : plural(counts.events, "event"), on: !!features.marketing_events },
    { label: "WhatsApp", href: ROUTES.marketingWhatsapp, chip: counts.whatsappTemplates === null ? null : plural(counts.whatsappTemplates, "template"), on: !!features.whatsapp_marketing },
  ].filter((x) => x.on);

  return (
    <>
      <PageHeader title="Marketing" subtitle="Reach people" info="Pick who, write the message, review and send, then see what happened. Intelligence, next door, shows who is ready to buy." />
      <OverviewPath steps={steps} />
      {always.length > 0 && (
        <Card title="Always on" style={{ marginTop: 12 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {always.map((a) => (
              <Link key={a.label} href={a.href} style={{ border: `1px solid ${c.line}`, borderRadius: 999, padding: "0 14px", minHeight: 44, display: "inline-flex", alignItems: "center", gap: 8, color: c.ink, textDecoration: "none", fontSize: 13 }}>
                {a.label}{a.chip && <span style={{ fontSize: 11.5, color: c.muted }}>{a.chip}</span>}
              </Link>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
