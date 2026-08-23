import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { fetchAccountMarketIntel, MarketIntelError } from "@/lib/nova/marketIntel";

/**
 * GET /api/nova/market-intel?account_id=X -- real, live web search about an
 * account's company (owner request 2026-08-25). Nova-only, same shape as
 * every other src/app/api/nova/* route. Explicit user action only (the
 * account page's own fetch button) -- never auto-run in bulk, since each
 * call is a real, billed multi-search Claude request.
 *
 * account_id is read from the query string, so -- per MULTI_TENANT_
 * GUARDRAILS.md -- it's verified against tenant_id before its NAME is ever
 * handed to an external search, or a cross-tenant id would leak another
 * tenant's account name into this tenant's search.
 */
export async function GET(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (!(await tenantHasFeature(supabase, tenantId, "next_experience"))) {
    return NextResponse.json({ error: "Nova isn't enabled for your workspace" }, { status: 403 });
  }

  const accountId = request.nextUrl.searchParams.get("account_id");
  if (!accountId) {
    return NextResponse.json({ error: "account_id is required" }, { status: 400 });
  }

  const { data: account, error } = await supabase
    .from("accounts")
    .select("name, industry, city")
    .eq("id", accountId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const meta = [account.industry, account.city].filter(Boolean).join(", ");

  try {
    const result = await fetchAccountMarketIntel(account.name, meta);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof MarketIntelError) {
      return NextResponse.json({ error: e.message }, { status: 502 });
    }
    console.error("[market-intel] unexpected error", e);
    return NextResponse.json({ error: "Market signals failed to load. Try again." }, { status: 500 });
  }
}
