import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";

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
  let supabase, tenantId, role;
  try {
    ({ supabase, tenantId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  // Change History is an admin-only surface -- the /administration page
  // already redirects non-admins, but that's UI-only; this route needs its
  // own gate, same as every other admin-scoped API route in this codebase
  // (e.g. /api/settings/api-key). Without it, any tenant member could read
  // the full audit trail -- including other users' actions -- directly.
  if (role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!(await tenantHasFeature(supabase, tenantId, "change_history"))) {
    return NextResponse.json({ error: "Change History isn't enabled for your workspace" }, { status: 403 });
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
