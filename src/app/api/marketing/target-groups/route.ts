import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
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
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { data, error } = await supabase
    .from("marketing_target_groups")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  let supabase, tenantId, userId;
  try {
    ({ supabase, tenantId, userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

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
