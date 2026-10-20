import { notFound } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import { journeyPage, PENDING_MESSAGE } from "@/lib/marketing/journeys/access";
import { loadJourneyRow } from "@/lib/marketing/journeys/store";
import JourneyStudio from "../JourneyStudio";

export default async function JourneyPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await journeyPage("view");
  const { id } = await params;
  let journey;
  try {
    journey = await loadJourneyRow(ctx.admin, ctx.tenantId, id);
  } catch {
    journey = null;
  }
  // Another workspace's journey answers exactly like a missing one: the tenant filter finds nothing.
  if (!journey) {
    const probe = await ctx.admin.from("journeys").select("id").eq("tenant_id", ctx.tenantId).limit(1);
    if (probe.error) {
      return (
        <>
          <PageHeader title="Journeys" />
          <Card padding={0}><EmptyState title="Journeys are waiting for a database update" text={PENDING_MESSAGE} /></Card>
        </>
      );
    }
    notFound();
  }
  // Templates for the WhatsApp step, only when the workspace has the module (null hides the step everywhere).
  let whatsappTemplates: { id: string; label: string }[] | null = null;
  if (ctx.env.features.whatsapp_marketing === true) {
    const t = await ctx.admin.from("whatsapp_templates").select("id, name, language, status").eq("tenant_id", ctx.tenantId).neq("status", "archived").order("name").limit(100);
    whatsappTemplates = t.error ? [] : ((t.data ?? []) as { id: string; name: string; language: string; status: string }[]).map((x) => ({ id: x.id, label: `${x.name} (${x.language.toUpperCase()}${x.status === "approved" ? "" : `, ${x.status}`})` }));
  }
  const runs = await ctx.admin.from("journey_runs").select("id").eq("tenant_id", ctx.tenantId).eq("journey_id", id).limit(1);

  return (
    <JourneyStudio
      journey={{ id: journey.id, ref: journey.ref, name: journey.name, status: journey.status, definition: journey.definition, hasRuns: !runs.error && (runs.data ?? []).length > 0 }}
      topics={ctx.env.topics}
      limits={ctx.env.limits}
      timezone={ctx.env.timezone}
      studioOn={ctx.env.features.newsletter_studio === true}
      whatsappTemplates={whatsappTemplates}
      canEdit={ctx.can.edit}
    />
  );
}
