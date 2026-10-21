import { notFound } from "next/navigation";
import { requireFeature } from "@/lib/tenant";
import { requireWorkcenterView } from "@/lib/permissions";
import PageHeader from "@/components/PageHeader";
import { signalsAccess } from "@/lib/signals/access";
import { loadWorkspace } from "@/lib/signals/queries";
import SignalsWorkspace, { type CampaignOption } from "./SignalsWorkspace";

export default async function BuyingSignalsPage() {
  await requireWorkcenterView("signals");
  await requireFeature("marketing");
  await requireFeature("buying_signals");
  let ctx;
  try {
    ctx = await signalsAccess("view");
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 404 || status === 403) notFound();
    throw e;
  }

  const [workspace, camps] = await Promise.all([
    loadWorkspace(ctx),
    ctx.admin.from("marketing_campaigns").select("id, name, sent_at").eq("tenant_id", ctx.tenantId)
      .not("sent_at", "is", null).order("sent_at", { ascending: false }).limit(50),
  ]);
  const campaigns = ((camps.data ?? []) as { id: string; name: string; sent_at: string }[]);
  const options: CampaignOption[] = campaigns.map((c) => ({ id: c.id, name: c.name, sent_at: c.sent_at }));

  return (
    <>
      <PageHeader title="Who is in market" />
      <SignalsWorkspace workspace={workspace} campaigns={options} canEdit={ctx.can.edit} isAdmin={ctx.role === "admin" && ctx.can.edit} />
    </>
  );
}
