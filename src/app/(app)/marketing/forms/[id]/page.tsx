import { notFound } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import { tenantOrigin } from "@/lib/constants";
import { confirmByEmailDefault, topicsOf } from "@/lib/marketing/config";
import { listWorkspacePeople, personLabel } from "@/lib/marketing/leads/people";
import { PENDING_MESSAGE, loadForm, recentSubmissions } from "@/lib/marketing/forms/server";
import FormStudio from "../FormStudio";
import { formsPage } from "../pageData";

export default async function FormPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await formsPage();
  const { id } = await params;
  const r = await loadForm(ctx, id);
  if (r.missing) {
    return (
      <>
        <PageHeader title="Forms" />
        <Card padding={0}><EmptyState title="Forms are waiting for a database update" text={PENDING_MESSAGE} /></Card>
      </>
    );
  }
  // Another workspace's form answers exactly like a missing one.
  if (!r.data) notFound();
  const f = r.data;
  const submissions = await recentSubmissions(ctx, f.id);
  const people = (await listWorkspacePeople(ctx.admin, ctx.tenantId)).map((p) => ({ id: p.user_id, label: personLabel(p) }));

  return (
    <FormStudio
      initial={{
        id: f.id, ref: f.ref, name: f.name, slug: f.slug, status: f.status, title: f.title ?? "", intro: f.intro ?? "", button_label: f.button_label ?? "Send",
        fields: f.fields, consent: f.consent, after_submit: f.after_submit, createdAt: f.created_at,
      }}
      topics={topicsOf(ctx.config).map((t) => ({ key: t.key, label: t.label }))}
      origin={ctx.customDomain || ctx.isDemo ? tenantOrigin(ctx.customDomain) : ""}
      redirectHost={ctx.customDomain ?? ""}
      brand={{ name: ctx.tenantName, logoUrl: null }}
      submissions={submissions.map((s) => ({ id: s.id, created_at: s.created_at, name: s.name, email: s.email, company: s.company, message: s.message, consent_given: s.consent_given, outcome: s.outcome }))}
      canEdit={ctx.can.edit}
      canDelete={ctx.can.delete}
      people={people}
      confirmDefault={confirmByEmailDefault(ctx.config)}
    />
  );
}
