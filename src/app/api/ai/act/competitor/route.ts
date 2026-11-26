import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { resolvePermissions } from "@/lib/permissions";
import { actionsEnabled } from "@/lib/actions/registry";
import { pressCompetitorCard } from "@/lib/assistant/competitors/press";

// POST /api/ai/act/competitor { card_id, token, values } -- the press of the assistant's "add a competitor" card. Like POST /api/ai/act it
// is the only place that card writes, and it writes by running the competitors route's own POST on the caller's own session. Tenant, user
// and permissions come from the session; the token only proves which card this was and which tender it was for.
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

  const out = await pressCompetitorCard({ supabase, admin: createAdminSupabase(), tenantId, userId, perms, features, baseUrl: request.url }, body);
  return NextResponse.json(out.body, { status: out.status });
}
