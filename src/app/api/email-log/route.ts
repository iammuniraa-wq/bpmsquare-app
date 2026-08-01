import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";

const MAX_ROWS = 5000;

/**
 * GET /api/email-log[?kind=quote|campaign][&related_object_id=...][&limit=...]
 *
 * Tenant-wide outbound email audit -- every quote email and campaign send
 * BPMSquare has attempted, success or failure. kind narrows to one channel;
 * related_object_id narrows to a single source record's (a quote's, a
 * campaign's) sends. Neither is required -- omitted, returns the tenant's
 * most recent sends across every channel, capped at MAX_ROWS.
 */
export async function GET(request: NextRequest) {
  let supabase, tenantId, role;
  try {
    ({ supabase, tenantId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  // Outbound Emails is an admin-only surface, same as Change History -- the
  // /administration page redirects non-admins, but that's UI-only; this
  // route needs its own gate so a non-admin can't read every recipient
  // address and message the tenant has ever emailed via a bare fetch.
  if (role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const kind = searchParams.get("kind");
  if (kind && kind !== "quote" && kind !== "campaign") {
    return NextResponse.json({ error: "kind must be 'quote' or 'campaign'" }, { status: 400 });
  }
  const relatedObjectId = searchParams.get("related_object_id");

  const limitParam = Number(searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_ROWS) : MAX_ROWS;

  let query = supabase
    .from("email_log")
    .select("id, kind, to_email, subject, status, error, related_object_type, related_object_id, related_object_label, actor_email, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (kind) query = query.eq("kind", kind);
  if (relatedObjectId) query = query.eq("related_object_id", relatedObjectId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ rows: data ?? [] });
}
