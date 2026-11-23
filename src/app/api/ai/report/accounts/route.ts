import { NextResponse, type NextRequest } from "next/server";
import { resolveAnalysisAccess } from "@/lib/analysis/access";
import { analysisAccess } from "@/lib/analysis/gate";
import { commentAllowed } from "@/lib/analysis/report/save";
import { ROUTES, type TenantFeatures } from "@/lib/constants";

// GET /api/ai/report/accounts?q=najd -- the picker under "Save to an account" for a company that is not in the CRM. Accounts of THIS
// workspace whose name holds the words typed, read with the person's own session (the tenant filter and the row policy both apply),
// at most eight. Only a person who could save the brief to an account (the module, the Accounts view, the timeline) gets any.

const MAX_RESULTS = 8;

export async function GET(request: NextRequest) {
  const access = await resolveAnalysisAccess();
  if (access instanceof NextResponse) return access;
  const gate = analysisAccess(access);
  if (!gate.ok) return NextResponse.json({ error: gate.error, code: gate.code }, { status: gate.status });
  if (!commentAllowed(access.features as Partial<TenantFeatures>, access.perms, "account")) return NextResponse.json({ accounts: [] });

  // Quote and filter characters are not part of a company name, and the `%` and `_` of a LIKE pattern are not wildcards here.
  const q = (request.nextUrl.searchParams.get("q") ?? "").replace(/[%_,()"'\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  if (q.length < 2) return NextResponse.json({ accounts: [] });

  const { data, error } = await access.supabase.from("accounts").select("id, name, city, country")
    .eq("tenant_id", access.tenantId).ilike("name", `%${q}%`).order("name").limit(MAX_RESULTS);
  if (error) return NextResponse.json({ accounts: [] });
  const accounts = ((data ?? []) as { id: string; name: string; city: string | null; country: string | null }[])
    .map((a) => ({ id: a.id, name: a.name, place: [a.city, a.country].filter(Boolean).join(", ") || null, href: ROUTES.account(a.id) }));
  return NextResponse.json({ accounts }, { headers: { "Cache-Control": "no-store" } });
}
