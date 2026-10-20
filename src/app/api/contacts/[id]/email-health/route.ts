import { NextResponse, type NextRequest } from "next/server";
import { revalidateTag } from "next/cache";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { canEditWorkcenter, resolvePermissions } from "@/lib/permissions";
import { logChange } from "@/lib/changeLog";
import type { TenantFeatures } from "@/lib/constants";
import { emailHealthOn, loadContactHealth, runHealthAction, type HealthAction } from "@/lib/marketing/contactHealth";

// The Email health card on a contact (Newsletter Studio). GET reads the contact's
// health; POST runs one of three actions: check the address, fix it, or mark it as
// checked with a reason. Every action writes the change history. 404 unless the
// workspace has the Newsletter Studio (a platform-admin flag).

async function gate() {
  let ctx;
  try {
    ctx = await requireTenantUser();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return { response: NextResponse.json({ error: err.message }, { status: err.status }) } as const;
  }
  const admin = createAdminSupabase();
  const { data } = await admin.from("tenants").select("features").eq("id", ctx.tenantId).maybeSingle();
  if (!emailHealthOn((data?.features ?? null) as Partial<TenantFeatures> | null)) {
    return { response: NextResponse.json({ error: "Not found" }, { status: 404 }) } as const;
  }
  return { ctx, admin } as const;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate();
  if ("response" in g) return g.response;
  const { id } = await params;
  return NextResponse.json(await loadContactHealth(g.admin, g.ctx.tenantId, id));
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate();
  if ("response" in g) return g.response;
  const { supabase, tenantId, userId, role } = g.ctx;
  if (!canEditWorkcenter(await resolvePermissions(supabase, tenantId, userId, role), "contacts")) {
    return NextResponse.json({ error: "You don't have permission to edit contacts." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { action?: unknown; email?: unknown; reason?: unknown } | null;
  let input: HealthAction;
  if (body?.action === "check") input = { action: "check" };
  else if (body?.action === "fix" && typeof body.email === "string") input = { action: "fix", email: body.email };
  else if (body?.action === "confirm" && typeof body.reason === "string") input = { action: "confirm", reason: body.reason };
  else return NextResponse.json({ error: "Unknown action" }, { status: 400 });

  const { id } = await params;
  const result = await runHealthAction(g.admin, tenantId, id, input);
  if (!result.ok) return NextResponse.json({ error: result.error, pending: result.pending ?? false }, { status: result.status });

  if (input.action === "fix") revalidateTag("accounts", { expire: 0 });
  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "contacts", objectId: id, objectLabel: result.label,
    action: "update", actorId: user?.id, actorEmail: user?.email, changes: result.changes,
  });

  return NextResponse.json({ message: result.message, health: await loadContactHealth(g.admin, tenantId, id) });
}
