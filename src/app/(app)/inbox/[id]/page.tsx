import { notFound, redirect } from "next/navigation";
import { getTenant, requireFeature } from "@/lib/tenant";
import { requireWorkcenterView } from "@/lib/permissions";
import { ROUTES } from "@/lib/constants";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import NovaTimelineSlot from "@/components/NovaTimelineSlot";
import ThreadClient from "@/components/inbox/ThreadClient";
import { inboxAccess } from "@/lib/inbox/server";
import { loadDetail, markRead } from "@/lib/inbox/detail";

// One customer email and its conversation. A message of an address the person is not on the team of is a 404, the same
// as one that does not exist. Opening it marks it read.

export default async function EmailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireWorkcenterView("inbox");
  await requireFeature("inbox");
  const { id } = await params;
  let ctx;
  try {
    ctx = await inboxAccess(false);
  } catch {
    redirect(ROUTES.dashboard);
  }
  const detail = await loadDetail(ctx, id);
  if (!detail) notFound();
  await markRead(ctx, detail.email);

  const tenant = await getTenant();
  const days = Math.max(0, Math.ceil((Date.parse(detail.email.expires_at) - Date.now()) / 86_400_000));

  return (
    <>
      <TabTitle title={detail.email.subject || "Email"} />
      <PageHeader title={detail.email.subject || "(no subject)"} />
      <ThreadClient
        detail={detail}
        canEdit={ctx.canEdit}
        companyName={tenant?.name ?? "Our team"}
        linkFeatures={(tenant?.features ?? {}) as Record<string, boolean>}
        retentionDays={days}
        nowIso={new Date().toISOString()}
      />
      <NovaTimelineSlot objectType="inbound_emails" objectId={id} />
    </>
  );
}
