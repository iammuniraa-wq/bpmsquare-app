import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { normalizeCategoryTree } from "@/lib/picklists";

export async function GET() {
  let tenantId;
  try {
    ({ tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { data, error } = await createAdminSupabase()
    .from("tenants")
    .select("config")
    .eq("id", tenantId)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const cfg = (data?.config ?? {}) as Record<string, unknown>;
  return NextResponse.json({
    product_categories: normalizeCategoryTree(cfg.product_categories),
  });
}

export async function PUT(request: NextRequest) {
  let tenantId, role;
  try {
    ({ tenantId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // normalizePicklist/normalizeCategoryTree do the validation: name required,
  // code derived from the name when blank, codes canonicalised (uppercase,
  // A-Z0-9_, 40 chars) and deduped. Two-level tree depth is the OOB contract.
  const body = await request.json() as Record<string, unknown>;
  const product_categories = normalizeCategoryTree(body.product_categories);

  const admin = createAdminSupabase();
  const { data: current, error: readErr } = await admin
    .from("tenants").select("config").eq("id", tenantId).single();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });

  const merged = { ...(current?.config ?? {}), product_categories };
  const { error } = await admin.from("tenants").update({ config: merged }).eq("id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
