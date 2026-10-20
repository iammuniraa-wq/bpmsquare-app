import { NextResponse, type NextRequest } from "next/server";
import { requireMarketingAccess } from "@/lib/marketingAccess";
import { sanitizeSegmentFilters, sanitizeMatch } from "@/lib/marketingSegmentation";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanEmails(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const email = String(raw).trim().toLowerCase();
    if (email && EMAIL_RE.test(email) && !seen.has(email)) { seen.add(email); out.push(email); }
  }
  return out;
}

export async function GET() {
  const guard = await requireMarketingAccess(["marketing", "marketing_segments"], "view");
  if ("error" in guard) return guard.error;
  const { supabase, tenantId } = guard.auth;

  const { data, error } = await supabase
    .from("marketing_target_groups")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const guard = await requireMarketingAccess(["marketing_segments"], "edit");
  if ("error" in guard) return guard.error;
  const { supabase, tenantId, userId } = guard.auth;

  const body = await request.json();
  const { name, account_types, include_account_ids, exclude_account_ids, manual_emails, filters, match } = body;

  if (!name?.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const { data, error } = await supabase
    .from("marketing_target_groups")
    .insert({
      tenant_id: tenantId,
      name: name.trim(),
      account_types: Array.isArray(account_types) ? account_types : [],
      include_account_ids: Array.isArray(include_account_ids) ? include_account_ids : [],
      exclude_account_ids: Array.isArray(exclude_account_ids) ? exclude_account_ids : [],
      manual_emails: cleanEmails(manual_emails),
      filters: sanitizeSegmentFilters(filters),
      match: sanitizeMatch(match),
      created_by: userId,
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
