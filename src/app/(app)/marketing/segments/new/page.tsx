import { requireFeature } from "@/lib/tenant";
import { listAccounts } from "@/lib/data";
import PageHeader from "@/components/PageHeader";
import SegmentBuilder from "@/components/marketing/SegmentBuilder";

export default async function NewSegmentPage() {
  await requireFeature("marketing");
  const summaries = await listAccounts();
  const accounts = summaries.map((s) => ({ id: s.account.id, name: s.account.name, type: s.account.type }));

  return (
    <>
      <PageHeader title="New target group" subtitle="Drag attributes onto the canvas to build a rule" />
      <SegmentBuilder accounts={accounts} />
    </>
  );
}
