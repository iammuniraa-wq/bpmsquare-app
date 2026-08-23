import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { sanitizeSegmentFilters, sanitizeMatch } from "@/lib/marketingSegmentation";
import { diffForLog, logChange } from "@/lib/changeLog";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let supabase, tenantId, role, userId;
  try {
    ({ supabase, tenantId, role, userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminSupabase();
  const { data: before } = await admin.from("segments").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json();
  const { code, name, filters, match, account_ids } = body as {
    code?: string; name?: string; filters?: unknown; match?: unknown; account_ids?: string[];
  };

  const patch: Record<string, unknown> = {};
  if (typeof code === "string") patch.code = code;
  if (typeof name === "string") patch.name = name;
  if (filters !== undefined) patch.filters = sanitizeSegmentFilters(filters);
  if (match !== undefined) patch.match = sanitizeMatch(match);
  if (account_ids !== undefined) {
    const accountIds = [...new Set((account_ids ?? []).filter((x): x is string => typeof x === "string"))];
    if (accountIds.length > 0) {
      const { data: rows } = await admin.from("accounts").select("id").eq("tenant_id", tenantId).in("id", accountIds);
      if (!rows || rows.length !== accountIds.length) {
        return NextResponse.json({ error: "One or more accounts were not found" }, { status: 404 });
      }
    }
    patch.account_ids = accountIds;
  }

  const { data: segment, error } = await admin
    .from("segments").update(patch).eq("id", id).eq("tenant_id", tenantId).select("*").single();
  if (error) {
    const status = error.code === "23505" ? 409 : 500;
    return NextResponse.json({ error: status === 409 ? `Segment code "${patch.code}" already exists` : error.message }, { status });
  }

  const changes = diffForLog("segments", before, patch);
  if (changes.length > 0) {
    await logChange(supabase, {
      tenantId, objectType: "segments", objectId: id, objectLabel: segment.name,
      action: "update", actorId: userId, changes,
    });
  }
  return NextResponse.json(segment);
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let supabase, tenantId, role, userId;
  try {
    ({ supabase, tenantId, role, userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminSupabase();
  const { data: before } = await admin.from("segments").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { error } = await admin.from("segments").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logChange(supabase, {
    tenantId, objectType: "segments", objectId: id, objectLabel: before.name,
    action: "delete", actorId: userId,
  });
  return NextResponse.json({ ok: true });
}
