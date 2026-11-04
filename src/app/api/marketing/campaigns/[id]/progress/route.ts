import { NextResponse, type NextRequest } from "next/server";
import { requireMarketingAccess } from "@/lib/marketingAccess";
import { resolveMarketingRecipients } from "@/lib/data";
import { countStatuses } from "@/lib/marketing/sendProgress";

// How far a send has got, for the campaign page while its status is "sending". Cheap on purpose: the status, the counts
// of what has been recorded so far and, once, how many people the send will go through (`?total=1`).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireMarketingAccess(["marketing"], "view");
  if ("error" in guard) return guard.error;
  const { supabase, tenantId } = guard.auth;
  const { id } = await params;

  const { data: campaign } = await supabase
    .from("marketing_campaigns")
    .select("status, account_types, include_account_ids, exclude_account_ids, manual_emails, filters, match")
    .eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  const { data: rows } = await supabase.from("marketing_campaign_recipients").select("status").eq("campaign_id", id).eq("tenant_id", tenantId);
  const counts = countStatuses(rows ?? []);

  let total: number | null = null;
  if (new URL(request.url).searchParams.get("total") === "1") {
    const candidates = await resolveMarketingRecipients(tenantId, {
      account_types: campaign.account_types ?? [], include_account_ids: campaign.include_account_ids ?? [], exclude_account_ids: campaign.exclude_account_ids ?? [],
      manual_emails: campaign.manual_emails ?? [], filters: campaign.filters ?? [], match: campaign.match ?? "all",
    });
    total = candidates.length;
  }
  return NextResponse.json({ status: campaign.status, done: (rows ?? []).length, ...counts, total });
}
