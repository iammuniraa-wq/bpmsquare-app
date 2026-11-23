import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase, getAuthUser, requireTenantUser } from "@/lib/supabase-server";
import { logChange } from "@/lib/changeLog";
import { cleanCategory } from "@/lib/site/settingsRules";
import { isMissingSchema, needsUpdate } from "@/lib/site/server";

// POST /api/settings/site/categories  { name, resource_code?, cost_code?, erp_category?, limit_amount?, active?, sort_order? } -> 201 { id }
//   Adds an expense category (admin only; Site expenses module). The name is unique per workspace (409). A category is never deleted: switch it
//   off, so an old expense still names it.
export async function POST(request: NextRequest) {
  let ctx;
  try { ctx = await requireTenantUser(); } catch (e) { const err = e as { status?: number; message: string }; return NextResponse.json({ error: err.message }, { status: err.status ?? 401 }); }
  if (ctx.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const admin = createAdminSupabase();
  const { data: t } = await admin.from("tenants").select("features").eq("id", ctx.tenantId).maybeSingle();
  const f = ((t as { features?: Record<string, boolean> } | null)?.features ?? {}) as Record<string, boolean>;
  if (f.site_expenses !== true || f.contract_projects !== true) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const cleaned = cleanCategory(body, false);
  if (!cleaned.ok) return NextResponse.json({ error: cleaned.error }, { status: 422 });
  const { data, error } = await admin.from("site_expense_categories").insert({ tenant_id: ctx.tenantId, ...cleaned.value }).select("id, name").single();
  if (error || !data) {
    if (isMissingSchema(error)) return NextResponse.json({ error: needsUpdate("site_expenses").error, ...needsUpdate("site_expenses").extra }, { status: 503 });
    if (error?.code === "23505") return NextResponse.json({ error: "There is already a category with that name" }, { status: 409 });
    return NextResponse.json({ error: error?.message ?? "Could not add the category" }, { status: 500 });
  }
  const user = await getAuthUser();
  await logChange(ctx.supabase, { tenantId: ctx.tenantId, objectType: "site_expenses", objectId: (data as { id: string }).id, objectLabel: `Category ${(data as { name: string }).name}`, action: "create", actorId: user?.id, actorEmail: user?.email, changes: [{ field: "Category added", from: null, to: (data as { name: string }).name }] });
  return NextResponse.json({ id: (data as { id: string }).id }, { status: 201 });
}
