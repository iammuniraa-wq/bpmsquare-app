import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";

const MAX_ROWS = 5000;

/**
 * GET /api/change-log?object_type=quotes[&object_id=...][&limit=...]
 *
 * object_type is required -- this always scopes to one object family, never
 * "give me the whole tenant's history in one call". object_id narrows to a
 * single record's full timeline; omitted, it returns the object type's most
 * recent changes (bulk/CSV-style pull), capped at MAX_ROWS.
 */
export async function GET(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { searchParams } = new URL(request.url);
  const objectType = searchParams.get("object_type");
  const objectId = searchParams.get("object_id");
  if (!objectType) {
    return NextResponse.json({ error: "object_type is required" }, { status: 400 });
  }

  const limitParam = Number(searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_ROWS) : MAX_ROWS;

  let query = supabase
    .from("change_log")
    .select("id, object_type, object_id, object_label, action, changes, actor_id, actor_email, created_at")
    .eq("tenant_id", tenantId)
    .eq("object_type", objectType)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (objectId) query = query.eq("object_id", objectId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ rows: data ?? [] });
}
