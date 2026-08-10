import { NextResponse, type NextRequest } from "next/server";
import { requireWfm } from "@/lib/wfm/server";

const VALID = ["live_board", "dashboard"] as const;

// GET /api/wfm/me/landing-preference -- the calling user's current choice
// (null = role-based default, i.e. Live Board for a supervisor).
export async function GET() {
  let ctx;
  try {
    ctx = await requireWfm();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { supabase, tenantId, userId } = ctx;

  const { data, error } = await supabase
    .from("tenant_users")
    .select("wfm_default_landing")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ landing: data?.wfm_default_landing ?? null });
}

// PATCH /api/wfm/me/landing-preference -- the calling user's own choice of
// default landing page when their access is WFM-only (see (app)/layout.tsx).
// Pass null to clear it back to the role-based default (Live Board for a
// supervisor). Session-scoped throughout -- always the caller's own row,
// never a client-supplied user id.
export async function PATCH(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireWfm();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { supabase, tenantId, userId } = ctx;

  const body = await request.json().catch(() => null);
  const value = body?.landing;
  if (value !== null && !VALID.includes(value)) {
    return NextResponse.json({ error: "landing must be 'live_board', 'dashboard', or null" }, { status: 400 });
  }

  const { error } = await supabase
    .from("tenant_users")
    .update({ wfm_default_landing: value })
    .eq("tenant_id", tenantId)
    .eq("user_id", userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, landing: value });
}
