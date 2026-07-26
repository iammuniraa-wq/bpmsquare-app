import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { resolveMarketingRecipients } from "@/lib/data";

// Live "-> N recipients" preview while composing -- takes the targeting rule
// straight from the request body (not the saved campaign row) so the UI can
// preview before the draft is even saved.
export async function POST(request: NextRequest) {
  let tenantId;
  try {
    ({ tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const body = await request.json();
  const rule = {
    account_types: Array.isArray(body.account_types) ? body.account_types : [],
    include_account_ids: Array.isArray(body.include_account_ids) ? body.include_account_ids : [],
    exclude_account_ids: Array.isArray(body.exclude_account_ids) ? body.exclude_account_ids : [],
    manual_emails: Array.isArray(body.manual_emails) ? body.manual_emails : [],
  };

  const candidates = await resolveMarketingRecipients(tenantId, rule);
  const willReceive = candidates.filter((c) => !c.marketing_opt_out && c.email);
  const optedOut = candidates.filter((c) => c.marketing_opt_out);
  const noEmail = candidates.filter((c) => !c.marketing_opt_out && !c.email);

  return NextResponse.json({
    total: candidates.length,
    will_receive: willReceive.length,
    opted_out: optedOut.length,
    no_email: noEmail.length,
    accounts: candidates.map((c) => ({ id: c.account_id, name: c.account_name, will_receive: !c.marketing_opt_out && !!c.email })),
  });
}
