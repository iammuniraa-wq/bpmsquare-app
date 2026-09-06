import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";

// "Copy items from previous quotes, with insights" (0118 add-line panel,
// docs/sales-engine-architecture.md §3.6): the last lines this tenant
// quoted -- to this account, or of this product to anyone -- each with
// its quote's ref, date and status, so a rep sees what was offered before
// and how it went. Read-only, tenant-scoped; account_id/product_id are
// filters on this tenant's own rows, never trusted as anything more.

export async function GET(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (!(await tenantHasFeature(supabase, tenantId, "standard_quotes"))) {
    return NextResponse.json({ error: "Standard Quotes isn't enabled for your workspace" }, { status: 403 });
  }

  const accountId = request.nextUrl.searchParams.get("account_id") || null;
  const productId = request.nextUrl.searchParams.get("product_id") || null;
  const scope = request.nextUrl.searchParams.get("scope") === "product" ? "product" : "account";
  if (scope === "account" && !accountId) return NextResponse.json({ items: [] });
  if (scope === "product" && !productId) return NextResponse.json({ items: [] });

  // Headers first (the filter that scopes the search), then their lines.
  let headers = supabase.from("standard_quotes")
    .select("id, ref, status, account_id, created_at, sent_at, accounts(name)")
    .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(scope === "account" ? 40 : 200);
  if (scope === "account") headers = headers.eq("account_id", accountId as string);
  const { data: quotes, error: qErr } = await headers;
  if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });
  const quoteById = new Map((quotes ?? []).map((q) => [q.id as string, q]));
  if (quoteById.size === 0) return NextResponse.json({ items: [] });

  let linesQ = supabase.from("standard_quote_lines")
    .select("id, standard_quote_id, sl_no, description, uom, qty, rate, discount_pct, amount, product_id, break_of, is_selected")
    .eq("tenant_id", tenantId).in("standard_quote_id", [...quoteById.keys()]);
  if (scope === "product") linesQ = linesQ.eq("product_id", productId as string);
  const { data: lines, error: lErr } = await linesQ;
  if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 });

  const items = (lines ?? [])
    .filter((l) => !l.break_of) // a break is a variant of its base line, not a separate item
    .map((l) => {
      const q = quoteById.get(l.standard_quote_id as string) as { ref: string; status: string; created_at: string; sent_at: string | null; accounts?: { name?: string } | { name?: string }[] | null } | undefined;
      const acc = Array.isArray(q?.accounts) ? q?.accounts[0] : q?.accounts;
      return {
        line_id: l.id, quote_ref: q?.ref ?? "", quote_status: q?.status ?? "", quoted_at: q?.sent_at ?? q?.created_at ?? null,
        account_name: acc?.name ?? null,
        description: l.description, uom: l.uom, qty: l.qty, rate: l.rate, discount_pct: l.discount_pct, amount: l.amount,
        product_id: l.product_id ?? null, was_chosen: l.is_selected !== false,
      };
    })
    .sort((a, b) => String(b.quoted_at ?? "").localeCompare(String(a.quoted_at ?? "")))
    .slice(0, 50);

  return NextResponse.json({ items });
}
