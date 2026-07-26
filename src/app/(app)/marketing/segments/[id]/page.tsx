import { notFound } from "next/navigation";
import { requireFeature } from "@/lib/tenant";
import { getMarketingTargetGroup, listAccounts } from "@/lib/data";
import PageHeader from "@/components/PageHeader";
import SegmentBuilder from "@/components/marketing/SegmentBuilder";

export default async function EditSegmentPage({ params }: { params: Promise<{ id: string }> }) {
  await requireFeature("marketing");
  const { id } = await params;
  const group = await getMarketingTargetGroup(id);
  if (!group) notFound();

  const summaries = await listAccounts();
  const accounts = summaries.map((s) => ({ id: s.account.id, name: s.account.name, type: s.account.type }));

  return (
    <>
      <PageHeader title={group.name} subtitle="Edit this target group's rule" />
      <SegmentBuilder accounts={accounts} initial={group} />
    </>
  );
}
