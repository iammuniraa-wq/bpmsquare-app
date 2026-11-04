import { NextResponse, type NextRequest } from "next/server";
import { requireMarketingAccess } from "@/lib/marketingAccess";
import { resolveMarketingRecipients } from "@/lib/data";
import { createAdminSupabase } from "@/lib/supabase-server";
import { planPlainAudience } from "@/lib/marketing/plainAudiencePlan";
import { sanitizeSegmentFilters, sanitizeMatch } from "@/lib/marketingSegmentation";

// Live "-> N recipients" preview while composing and the numbers behind Review and send. Takes the
// targeting rule straight from the request body (not the saved campaign row) so the UI can preview before the
// draft is even saved. The count is the send's own: the same per-person consent decisions, nothing written.
export async function POST(request: NextRequest) {
  const guard = await requireMarketingAccess(["marketing", "marketing_segments"], "view");
  if ("error" in guard) return guard.error;
  const { tenantId } = guard.auth;

  const body = await request.json();
  const rule = {
    account_types: Array.isArray(body.account_types) ? body.account_types : [],
    include_account_ids: Array.isArray(body.include_account_ids) ? body.include_account_ids : [],
    exclude_account_ids: Array.isArray(body.exclude_account_ids) ? body.exclude_account_ids : [],
    manual_emails: Array.isArray(body.manual_emails) ? body.manual_emails : [],
    filters: sanitizeSegmentFilters(body.filters),
    match: sanitizeMatch(body.match),
  };
  const topic = typeof body.topic === "string" && body.topic ? body.topic : null;

  const candidates = await resolveMarketingRecipients(tenantId, rule);
  const plan = await planPlainAudience({ admin: createAdminSupabase(), tenantId, topic, candidates });
  const byCode = (code: string) => plan.byCode.find((r) => r.code === code)?.count ?? 0;

  return NextResponse.json({
    total: plan.total,
    will_receive: plan.willReceive,
    left_out: plan.total - plan.willReceive,
    reasons: plan.byCode,
    people: plan.leftOut,
    // Kept for the callers that read the older shape.
    opted_out: byCode("account_opted_out"),
    no_email: byCode("no_email"),
    no_contact: byCode("no_contact"),
    accounts: candidates.map((c) => ({ id: c.account_id, name: c.account_name, will_receive: !plan.leftOut.some((l) => l.name === c.account_name && l.email === c.email) })),
  });
}
