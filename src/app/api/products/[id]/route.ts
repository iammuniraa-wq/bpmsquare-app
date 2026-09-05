import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { diffForLog, logChange } from "@/lib/changeLog";
import { parseCostSheet } from "@/lib/pricing/costSheet";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;
  const body = await request.json();

  const allowed = ["name", "sku", "category", "sub_category", "uom", "description", "list_price", "cost_price", "tax_percent", "status", "custom_data", "available_segment_ids", "cost_sheet", "cost_price_as_of"];
  const patch: Record<string, unknown> = {};
  for (const key of allowed) if (key in body) patch[key] = body[key];
  patch.updated_at = new Date().toISOString();

  // Cost sheet (0113): only well-formed rows survive; an empty sheet is
  // stored as null ("one bought-in part at cost_price").
  if ("cost_sheet" in patch) {
    const rows = patch.cost_sheet === null ? [] : parseCostSheet(patch.cost_sheet);
    if (patch.cost_sheet !== null && !Array.isArray(patch.cost_sheet)) return NextResponse.json({ error: "cost_sheet must be an array" }, { status: 400 });
    patch.cost_sheet = rows.length > 0 ? rows : null;
  }
  if ("cost_price_as_of" in patch) {
    const v = patch.cost_price_as_of;
    if (v !== null && v !== "" && !(typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v))) {
      return NextResponse.json({ error: "cost_price_as_of must be yyyy-mm-dd" }, { status: 400 });
    }
    patch.cost_price_as_of = v === "" ? null : v;
  }

  // available_segment_ids (Coverage) are foreign ids from the request body --
  // verify each belongs to this tenant before writing (MULTI_TENANT_GUARDRAILS.md).
  if (Array.isArray(patch.available_segment_ids)) {
    const segIds = [...new Set((patch.available_segment_ids as unknown[]).filter((x): x is string => typeof x === "string"))];
    if (segIds.length > 0) {
      const { data: segRows } = await supabase.from("segments").select("id").eq("tenant_id", tenantId).in("id", segIds);
      if (!segRows || segRows.length !== segIds.length) {
        return NextResponse.json({ error: "One or more segments were not found" }, { status: 404 });
      }
    }
    patch.available_segment_ids = segIds;
  }

  const { data: before } = await supabase
    .from("products")
    .select("*")
    .eq("id", id).eq("tenant_id", tenantId).maybeSingle();

  const { data, error } = await supabase
    .from("products")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const user = await getAuthUser();
  const changes = diffForLog("products", (before as Record<string, unknown>) ?? {}, patch);
  if (changes.length > 0) {
    await logChange(supabase, {
      tenantId, objectType: "products", objectId: id, objectLabel: (data as { name?: string }).name ?? null,
      action: "update", actorId: user?.id, actorEmail: user?.email, changes,
    });
  }

  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;

  const { data: snap } = await supabase.from("products").select("name").eq("id", id).eq("tenant_id", tenantId).maybeSingle();

  const { error } = await supabase
    .from("products")
    .delete()
    .eq("id", id)
    .eq("tenant_id", tenantId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (snap) {
    const user = await getAuthUser();
    await logChange(supabase, {
      tenantId, objectType: "products", objectId: id, objectLabel: snap.name,
      action: "delete", actorId: user?.id, actorEmail: user?.email,
    });
  }

  return new NextResponse(null, { status: 204 });
}
