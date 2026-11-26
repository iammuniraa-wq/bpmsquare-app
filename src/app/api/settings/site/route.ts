import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase, getAuthUser, requireTenantUser } from "@/lib/supabase-server";
import { logChange } from "@/lib/changeLog";
import { listMembersForPicker } from "@/lib/sales/opportunityServer";
import { loadMembership } from "@/lib/tender/approvalServer";
import { siteConfig } from "@/lib/site/files";
import { cleanSiteSettings } from "@/lib/site/settingsRules";
import { loadCategories, needsUpdate } from "@/lib/site/server";

// GET / PUT /api/settings/site -- Settings > Site entry: the limits (a project manager approves alone up to X; a person's monthly cap), who is told
// about a delivery problem, and the expense categories. Stored in tenants.config.site; categories are rows. Admin-only in both directions, and the
// route is 404 for a workspace with neither Site module. A person chosen to be told must be a member of THIS workspace (guardrails: unverified ids).

async function guard() {
  const ctx = await requireTenantUser();
  if (ctx.role !== "admin") throw Object.assign(new Error("Forbidden"), { status: 403 });
  const admin = createAdminSupabase();
  const { data } = await admin.from("tenants").select("features, config").eq("id", ctx.tenantId).maybeSingle();
  const f = ((data as { features?: Record<string, boolean> } | null)?.features ?? {}) as Record<string, boolean>;
  if (!(f.site_expenses === true || f.site_receipts === true) || f.contract_projects !== true) throw Object.assign(new Error("Not found"), { status: 404 });
  return { ...ctx, admin, config: ((data as { config?: Record<string, unknown> } | null)?.config ?? {}) as Record<string, unknown>, features: f };
}
const fail = (e: unknown) => {
  const err = e as { status?: number; message: string };
  return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
};

export async function GET() {
  let ctx;
  try { ctx = await guard(); } catch (e) { return fail(e); }
  const cfg = siteConfig(ctx.config);
  const [people, membership, cats] = await Promise.all([listMembersForPicker(ctx.admin, ctx.tenantId), loadMembership(ctx.admin, ctx.tenantId), ctx.features.site_expenses ? loadCategories(ctx.admin, ctx.tenantId) : Promise.resolve({ rows: [], pending: false })]);
  return NextResponse.json({
    pm_limit: cfg.pm_limit ?? null, monthly_cap: cfg.monthly_cap ?? null, notify_receipts: cfg.notify_receipts, members: people.map((m) => ({ ...m, is_admin: membership.adminIds.includes(m.user_id) })),
    categories: cats.rows, categories_pending: cats.pending, modules: { expenses: ctx.features.site_expenses === true, receipts: ctx.features.site_receipts === true },
    ...(cats.pending ? { update: needsUpdate("site_expenses").extra } : {}),
  });
}

export async function PUT(request: NextRequest) {
  let ctx;
  try { ctx = await guard(); } catch (e) { return fail(e); }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  const cleaned = cleanSiteSettings(body);
  if (!cleaned.ok) return NextResponse.json({ error: cleaned.error }, { status: 422 });
  const { memberIds } = await loadMembership(ctx.admin, ctx.tenantId);
  const members = new Set(memberIds);
  if (cleaned.value.notify_receipts.some((id) => !members.has(id))) return NextResponse.json({ error: "Everyone told must be a member of this workspace" }, { status: 422 });

  const before = siteConfig(ctx.config);
  const kept = (ctx.config.site && typeof ctx.config.site === "object" ? ctx.config.site : {}) as Record<string, unknown>;
  const merged = { ...ctx.config, site: { ...kept, ...cleaned.value } };
  const { error } = await ctx.admin.from("tenants").update({ config: merged }).eq("id", ctx.tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const user = await getAuthUser();
  await logChange(ctx.supabase, {
    tenantId: ctx.tenantId, objectType: "tenants", objectId: ctx.tenantId, objectLabel: "Site entry settings", action: "update", actorId: user?.id, actorEmail: user?.email,
    changes: [
      { field: "Manager approves alone up to", from: before.pm_limit ?? null, to: cleaned.value.pm_limit },
      { field: "Monthly cap per person", from: before.monthly_cap ?? null, to: cleaned.value.monthly_cap },
      { field: "Told about delivery problems", from: `${before.notify_receipts.length} people`, to: `${cleaned.value.notify_receipts.length} people` },
    ].filter((c) => c.from !== c.to),
  });
  return NextResponse.json({ ok: true });
}
