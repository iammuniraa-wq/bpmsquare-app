import { notFound } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import { loadBundle, PENDING_MESSAGE } from "@/lib/newsletter/server";
import NewsletterStudio from "../NewsletterStudio";
import { studioPage, studioProps } from "../pageData";

export default async function NewsletterPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await studioPage();
  const { id } = await params;
  const r = await loadBundle(ctx, id);
  if (r.missing) {
    return (
      <>
        <PageHeader title="Newsletters" />
        <Card padding={0}><EmptyState title="The Newsletter Studio is waiting for a database update" text={PENDING_MESSAGE} /></Card>
      </>
    );
  }
  // Another workspace's newsletter answers exactly like a missing one.
  if (!r.data) notFound();
  const { newsletter: n, languages, versions } = r.data;
  const props = await studioProps(ctx);

  return (
    <NewsletterStudio
      {...props}
      initial={{
        id: n.id, ref: n.ref, name: n.name, category: n.category, topic: n.topic, status: n.status, isTemplate: n.is_template,
        blocks: n.blocks, languages, versions, templateOriginId: n.template_origin_id, builtInOrigin: n.built_in_origin, createdAt: n.created_at,
      }}
    />
  );
}
