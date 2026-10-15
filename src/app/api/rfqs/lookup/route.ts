import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { tenantHasRfq, rfqLineStatuses } from "@/lib/rfq/server";

// GET ?line_ids=a,b,c -- where each RFQ line a document line points at
// stands, so a quote/deal editor can show "RFQ sent · 2/3 replied" or
// "Awarded — re-price" on a line after a reload. Any signed-in member of the
// tenant may ask (they can already see the document); the answer carries
// status and counts only -- never a supplier's price, which is the buyer's.

export async function GET(req: NextRequest) {
  let tenantId: string;
  try {
    ({ tenantId } = await requireTenantUser());
  } catch (e) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message ?? "Unauthorized" }, { status: err.status ?? 401 });
  }
  const admin = createAdminSupabase();
  if (!(await tenantHasRfq(admin, tenantId))) return NextResponse.json({ lines: {} });
  const ids = (req.nextUrl.searchParams.get("line_ids") ?? "").split(",").map((s) => s.trim()).filter((s) => /^[0-9a-f-]{36}$/i.test(s)).slice(0, 200);
  if (!ids.length) return NextResponse.json({ lines: {} });

  const out = await rfqLineStatuses(admin, tenantId, ids);
  return NextResponse.json({ lines: out });
}
