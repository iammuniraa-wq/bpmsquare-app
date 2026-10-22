import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { resolvePermissions } from "@/lib/permissions";
import { actionsEnabled } from "@/lib/actions/registry";
import { executeCard } from "@/lib/actions/execute";

// POST /api/ai/act { card_id, token, values, confirm_duplicates? } -- the press of a confirm card. This is the only
// place the assistant writes, and it writes by running the object's own create route on the caller's own session
// (src/lib/actions/execute.ts has the order of checks). Tenant, user and permissions come from the session; the
// token only proves which card this was.
export async function POST(request: NextRequest) {
  let supabase, tenantId, userId, role;
  try {
    ({ supabase, tenantId, userId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const [perms, { data: tenant }] = await Promise.all([
    resolvePermissions(supabase, tenantId, userId, role),
    supabase.from("tenants").select("features").eq("id", tenantId).maybeSingle(),
  ]);
  const features = (tenant?.features ?? {}) as Record<string, boolean | undefined>;
  if (!actionsEnabled(features)) return NextResponse.json({ error: "The assistant cannot make changes in this workspace." }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Nothing to confirm." }, { status: 400 });

  const out = await executeCard(
    { supabase, admin: createAdminSupabase(), tenantId, userId, perms, features, baseUrl: request.url },
    body,
  );
  return NextResponse.json(out.body, { status: out.status });
}
