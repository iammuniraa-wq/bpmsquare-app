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

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireMarketingAccess(["marketing", "marketing_segments"], "view");
  if ("error" in guard) return guard.error;
  const { supabase, tenantId } = guard.auth;

  const { id } = await params;
  const { data, error } = await supabase.from("marketing_target_groups").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Target group not found" }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireMarketingAccess(["marketing_segments"], "edit");
  if ("error" in guard) return guard.error;
  const { supabase, tenantId } = guard.auth;

  const { id } = await params;
  const body = await request.json();
  const { name, account_types, include_account_ids, exclude_account_ids, manual_emails, filters, match } = body;

  const patch: Record<string, unknown> = {};
  if (name !== undefined) {
    if (!String(name).trim()) return NextResponse.json({ error: "name is required" }, { status: 400 });
    patch.name = String(name).trim();
  }
  if (Array.isArray(account_types)) patch.account_types = account_types;
  if (Array.isArray(include_account_ids)) patch.include_account_ids = include_account_ids;
  if (Array.isArray(exclude_account_ids)) patch.exclude_account_ids = exclude_account_ids;
  if (manual_emails !== undefined) patch.manual_emails = cleanEmails(manual_emails);
  if (filters !== undefined) patch.filters = sanitizeSegmentFilters(filters);
  if (match !== undefined) patch.match = sanitizeMatch(match);

  const { data, error } = await supabase.from("marketing_target_groups").update(patch).eq("id", id).eq("tenant_id", tenantId).select("*").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Target group not found" }, { status: 404 });
  return NextResponse.json(data);
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireMarketingAccess(["marketing_segments"], "edit");
  if ("error" in guard) return guard.error;
  const { supabase, tenantId } = guard.auth;

  const { id } = await params;
  const { error } = await supabase.from("marketing_target_groups").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
