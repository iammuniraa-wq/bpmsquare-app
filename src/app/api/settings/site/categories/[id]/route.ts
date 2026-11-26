import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase, getAuthUser, requireTenantUser } from "@/lib/supabase-server";
import { diffForLog, logChange } from "@/lib/changeLog";
import { cleanCategory } from "@/lib/site/settingsRules";
import { categoryOf } from "@/lib/site/server";

// PATCH /api/settings/site/categories/[id]  any of { name, resource_code, cost_code, erp_category, limit_amount, active, sort_order }
//   Edits one category of THIS workspace (admin only; Site expenses module). Looked up by id AND workspace, so another workspace's id is a 404.
type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Ctx) {
  let ctx;
  try { ctx = await requireTenantUser(); } catch (e) { const err = e as { status?: number; message: string }; return NextResponse.json({ error: err.message }, { status: err.status ?? 401 }); }
  if (ctx.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const admin = createAdminSupabase();
  const { data: t } = await admin.from("tenants").select("features").eq("id", ctx.tenantId).maybeSingle();
  const f = ((t as { features?: Record<string, boolean> } | null)?.features ?? {}) as Record<string, boolean>;
  if (f.site_expenses !== true || f.contract_projects !== true) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { id } = await params;
  const before = await categoryOf(admin, ctx.tenantId, id);
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const cleaned = cleanCategory(body, true);
  if (!cleaned.ok) return NextResponse.json({ error: cleaned.error }, { status: 422 });
  if (Object.keys(cleaned.value).length === 0) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  const { error } = await admin.from("site_expense_categories").update(cleaned.value).eq("id", id).eq("tenant_id", ctx.tenantId);
  if (error) return NextResponse.json({ error: error.code === "23505" ? "There is already a category with that name" : error.message }, { status: error.code === "23505" ? 409 : 500 });
  const user = await getAuthUser();
  const changes = diffForLog("site_expenses", before as unknown as Record<string, unknown>, cleaned.value as Record<string, unknown>);
  if (changes.length > 0) await logChange(ctx.supabase, { tenantId: ctx.tenantId, objectType: "site_expenses", objectId: id, objectLabel: `Category ${before.name}`, action: "update", actorId: user?.id, actorEmail: user?.email, changes });
  return NextResponse.json({ ok: true });
}
