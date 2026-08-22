import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";

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
  const cfg = (data?.config ?? {}) as {
    territories?: string[]; sales_orgs?: string[];
    product_categories?: { name: string; subs: string[] }[];
  };
  return NextResponse.json({
    territories: cfg.territories ?? [],
    sales_orgs: cfg.sales_orgs ?? [],
    product_categories: cfg.product_categories ?? [],
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

  const body = await request.json() as {
    territories?: string[]; sales_orgs?: string[];
    product_categories?: { name?: unknown; subs?: unknown }[];
  };
  const territories: string[] = Array.isArray(body.territories)
    ? body.territories.map((t) => t.trim()).filter(Boolean)
    : [];
  const sales_orgs: string[] = Array.isArray(body.sales_orgs)
    ? body.sales_orgs.map((s) => s.trim()).filter(Boolean)
    : [];
  // Two-level tree, shape-validated: category names unique + non-empty,
  // subs deduped strings. Depth beyond two is silently impossible here —
  // that's the OOB contract, not an oversight.
  const seenCat = new Set<string>();
  const product_categories = (Array.isArray(body.product_categories) ? body.product_categories : [])
    .map((pc) => ({
      name: typeof pc?.name === "string" ? pc.name.trim() : "",
      subs: Array.isArray(pc?.subs)
        ? [...new Set(pc.subs.filter((s): s is string => typeof s === "string").map((s) => s.trim()).filter(Boolean))]
        : [],
    }))
    .filter((pc) => {
      if (!pc.name || seenCat.has(pc.name)) return false;
      seenCat.add(pc.name);
      return true;
    });

  const admin = createAdminSupabase();
  const { data: current, error: readErr } = await admin
    .from("tenants").select("config").eq("id", tenantId).single();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });

  const merged = { ...(current?.config ?? {}), territories, sales_orgs, product_categories };
  const { error } = await admin.from("tenants").update({ config: merged }).eq("id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
