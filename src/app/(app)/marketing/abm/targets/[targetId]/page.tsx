import { notFound, redirect } from "next/navigation";
import { ROUTES } from "@/lib/constants";
import { isUuid } from "@/lib/abm/server";
import { abmPage } from "../../pageData";

// A flat link for places that only know the target id (the Nova inbox): look the
// program up, tenant-filtered, and go to the real page.
export default async function AbmTargetRedirect({ params }: { params: Promise<{ targetId: string }> }) {
  const ctx = await abmPage();
  const { targetId } = await params;
  if (!isUuid(targetId)) notFound();
  const { data } = await ctx.supabase.from("abm_target_accounts").select("program_id").eq("id", targetId).eq("tenant_id", ctx.tenantId).maybeSingle();
  if (!data) notFound();
  redirect(ROUTES.marketingAbmTarget((data as { program_id: string }).program_id, targetId));
}
