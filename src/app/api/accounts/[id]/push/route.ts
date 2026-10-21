import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { pushAccountToErp } from "@/lib/accountPush";

// On-demand push of one account to the tenant's configured external endpoint
// (see lib/webhookPush.ts) -- a rep clicking "Push to ERP" on the account
// page, not an automatic trigger. The work lives in lib/accountPush.ts so the
// integration middleware's "Send a record" does exactly the same thing.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId, userId;
  try {
    ({ supabase, tenantId, userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;
  const result = await pushAccountToErp(supabase, tenantId, id, userId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
