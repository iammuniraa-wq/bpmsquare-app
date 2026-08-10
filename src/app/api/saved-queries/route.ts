import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { parseConds, encodeConds } from "@/lib/advancedFilter";
import { isPilotObjectType } from "@/lib/fieldRegistry";

const MAX_SAVED_PER_OBJECT = 50;

// Session client throughout: RLS ("saved_queries: owner isolation") is the
// backstop, the explicit .eq filters are defense in depth per
// MULTI_TENANT_GUARDRAILS.md.

export async function GET(request: NextRequest) {
  let supabase, tenantId, userId;
  try {
    ({ supabase, tenantId, userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const objectKey = new URL(request.url).searchParams.get("object") ?? "";
  if (!isPilotObjectType(objectKey)) return NextResponse.json({ error: "Unknown object" }, { status: 400 });

  const { data, error } = await supabase
    .from("saved_queries")
    .select("id, name, conditions, created_at")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("object_key", objectKey)
    .order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ queries: data ?? [] });
}

export async function POST(request: NextRequest) {
  let supabase, tenantId, userId;
  try {
    ({ supabase, tenantId, userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const body = await request.json().catch(() => null) as { object?: string; name?: string; conditions?: unknown } | null;
  const objectKey = body?.object ?? "";
  const name = (body?.name ?? "").trim().slice(0, 60);
  if (!isPilotObjectType(objectKey)) return NextResponse.json({ error: "Unknown object" }, { status: 400 });
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  // Re-parse through the same validator the list pages use, so a saved query
  // can only ever contain conditions the evaluator understands.
  const conds = parseConds(typeof body?.conditions === "string" ? body.conditions : JSON.stringify(body?.conditions ?? []));
  if (conds.length === 0) return NextResponse.json({ error: "Nothing to save — add at least one condition" }, { status: 400 });

  const { count } = await supabase
    .from("saved_queries")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("object_key", objectKey);
  if ((count ?? 0) >= MAX_SAVED_PER_OBJECT) {
    return NextResponse.json({ error: `Limit of ${MAX_SAVED_PER_OBJECT} saved queries reached for this object` }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("saved_queries")
    .insert({ tenant_id: tenantId, user_id: userId, object_key: objectKey, name, conditions: JSON.parse(encodeConds(conds)) })
    .select("id, name, conditions, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ query: data });
}
