import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import type { DashLayoutItem } from "@/lib/constants";

function sanitizeLayout(input: unknown): DashLayoutItem[] | null {
  if (!Array.isArray(input)) return null;
  const out: DashLayoutItem[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object" || typeof (item as { id?: unknown }).id !== "string") continue;
    const size = (item as { size?: unknown }).size;
    out.push({
      id: (item as { id: string }).id,
      hidden: !!(item as { hidden?: unknown }).hidden,
      ...(size === "compact" || size === "half" || size === "full" ? { size } : {}),
    });
  }
  return out;
}

// PATCH /api/dashboard/layout -- the CALLER's own personal dashboard
// customization, layered on top of whichever default (a Business Role's
// dashboard, or the tenant-wide one) would otherwise apply to them. Every
// tenant member can call this for themselves -- it's their own view, not an
// admin control -- and it only ever touches their own tenant_users row
// (tenantId/userId both come from requireTenantUser(), never the body).
// Pass layout: null to clear the override and fall back to the default.
export async function PATCH(request: NextRequest) {
  let tenantId, userId;
  try {
    ({ tenantId, userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const body = await request.json().catch(() => null);
  let layout: DashLayoutItem[] | null;
  if (body?.layout === null) {
    layout = null;
  } else if (Array.isArray(body?.layout)) {
    layout = sanitizeLayout(body.layout);
  } else {
    return NextResponse.json({ error: "Invalid layout" }, { status: 400 });
  }

  const admin = createAdminSupabase();
  const { error } = await admin
    .from("tenant_users")
    .update({ dashboard_layout_override: layout })
    .eq("tenant_id", tenantId)
    .eq("user_id", userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
