import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { sanitizeSegmentFilters, sanitizeMatch } from "@/lib/marketingSegmentation";
import { logChange } from "@/lib/changeLog";

export async function GET() {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { data, error } = await supabase
    .from("segments").select("*").eq("tenant_id", tenantId).order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  let supabase, tenantId, role, userId;
  try {
    ({ supabase, tenantId, role, userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const { code, name, filters, match, account_ids } = body as {
    code?: string; name?: string; filters?: unknown; match?: unknown; account_ids?: string[];
  };
  if (!code || typeof code !== "string" || !name || typeof name !== "string") {
    return NextResponse.json({ error: "code and name are required" }, { status: 400 });
  }

  const admin = createAdminSupabase();
  // account_ids are the tenant's own accounts only -- verify before writing
  // (MULTI_TENANT_GUARDRAILS.md: any foreign id from the request body must
  // be proven to belong to the tenant before it's used elsewhere).
  const accountIds = [...new Set((account_ids ?? []).filter((x): x is string => typeof x === "string"))];
  if (accountIds.length > 0) {
    const { data: rows } = await admin.from("accounts").select("id").eq("tenant_id", tenantId).in("id", accountIds);
    if (!rows || rows.length !== accountIds.length) {
      return NextResponse.json({ error: "One or more accounts were not found" }, { status: 404 });
    }
  }

  const { data: segment, error } = await admin
    .from("segments")
    .insert({
      tenant_id: tenantId, code, name,
      filters: sanitizeSegmentFilters(filters),
      match: sanitizeMatch(match),
      account_ids: accountIds,
    })
    .select("*").single();
  if (error) {
    const status = error.code === "23505" ? 409 : 500;
    return NextResponse.json({ error: status === 409 ? `Segment code "${code}" already exists` : error.message }, { status });
  }

  await logChange(supabase, {
    tenantId, objectType: "segments", objectId: segment.id, objectLabel: segment.name,
    action: "create", actorId: userId,
  });
  return NextResponse.json(segment, { status: 201 });
}
