import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import type { PageLayout } from "@/lib/types";

const DEFAULTS: Record<string, PageLayout> = {
  quote: [
    { id: "core",        kind: "builtin", label: "Quote details", field_keys: [] },
    { id: "lines",       kind: "builtin", label: "Scope of work", field_keys: [] },
    { id: "notes",       kind: "builtin", label: "Notes & terms", field_keys: [] },
    { id: "work_orders", kind: "builtin", label: "Work orders",   field_keys: [] },
  ],
  case: [
    { id: "core",  kind: "builtin", label: "Case details", field_keys: [] },
    { id: "notes", kind: "builtin", label: "Notes",        field_keys: [] },
  ],
  account: [
    { id: "core", kind: "builtin", label: "Account details", field_keys: [] },
  ],
  work_order: [
    { id: "core",  kind: "builtin", label: "Work order details", field_keys: [] },
    { id: "notes", kind: "builtin", label: "Notes",              field_keys: [] },
  ],
  dashboard: [
    { id: "kpis",         kind: "builtin", label: "Key metrics",     field_keys: [] },
    { id: "attention",    kind: "builtin", label: "Needs action",    field_keys: [] },
    { id: "work_orders",  kind: "builtin", label: "Work orders",     field_keys: [] },
    { id: "quick_create", kind: "builtin", label: "Quick create",    field_keys: [] },
    { id: "activity",     kind: "builtin", label: "Recent activity", field_keys: [] },
  ],
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ object: string }> }
) {
  const { object } = await params;
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { data } = await supabase
    .from("page_layouts")
    .select("layout")
    .eq("tenant_id", tenantId)
    .eq("object_type", object)
    .maybeSingle();

  return NextResponse.json(data?.layout ?? DEFAULTS[object] ?? []);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ object: string }> }
) {
  const { object } = await params;
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { layout } = await request.json();
  if (!Array.isArray(layout)) {
    return NextResponse.json({ error: "layout must be an array" }, { status: 400 });
  }

  const { error } = await supabase
    .from("page_layouts")
    .upsert(
      { tenant_id: tenantId, object_type: object, layout, updated_at: new Date().toISOString() },
      { onConflict: "tenant_id,object_type" }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
