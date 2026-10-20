import { notFound } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import { topicsOf } from "@/lib/marketing/config";
import { pendingMessage } from "@/lib/marketing/moduleAccess";
import { WHATSAPP_SPEC, loadTemplate } from "@/lib/marketing/whatsapp/server";
import type { TemplateCategory } from "@/lib/marketing/whatsapp/template";
import TemplateStudio from "../TemplateStudio";
import { whatsappPage } from "../pageData";

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await whatsappPage();
  const { id } = await params;
  const r = await loadTemplate(ctx, id);
  if (r.missing) {
    return (
      <>
        <PageHeader title="WhatsApp" />
        <Card padding={0}><EmptyState title="WhatsApp is waiting for a database update" text={pendingMessage(WHATSAPP_SPEC)} /></Card>
      </>
    );
  }
  // Another workspace's template answers exactly like a missing one.
  if (!r.data) notFound();
  const t = r.data;
  const { count } = await ctx.supabase.from("whatsapp_messages").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenantId).eq("template_id", t.id).eq("direction", "out");

  return (
    <TemplateStudio
      initial={{
        id: t.id, ref: t.ref, name: t.name, language: t.language, category: t.category as TemplateCategory, body: t.body, topic: t.topic,
        provider_template_name: t.provider_template_name ?? "", status: t.status, rejection_reason: t.rejection_reason, sent: count ?? 0,
      }}
      topics={topicsOf(ctx.tenant.config).map((x) => ({ key: x.key, label: x.label }))}
      companyName={ctx.tenant.name}
      canEdit={ctx.can.edit}
      canDelete={ctx.can.delete}
      isAdmin={ctx.role === "admin"}
    />
  );
}
