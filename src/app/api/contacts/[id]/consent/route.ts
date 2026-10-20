import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { canEditWorkcenter, resolvePermissions } from "@/lib/permissions";
import { logChange } from "@/lib/changeLog";
import type { TenantFeatures } from "@/lib/constants";
import { marketingScoringOn } from "@/lib/marketing/config";
import { loadContactConsent, recordConsentByStaff } from "@/lib/marketing/contactConsent";

// The Consent card on a contact. GET reads what this person has agreed to; POST
// records that they agreed or withdrew (appended to the consent ledger with the
// rep and the note as evidence -- history is never edited). 404 unless the
// workspace has the marketing scoring program (a platform-admin flag).

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
  if (!marketingScoringOn((data?.features ?? null) as Partial<TenantFeatures> | null)) {
    return { response: NextResponse.json({ error: "Not found" }, { status: 404 }) } as const;
  }
  return { ctx, admin } as const;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate();
  if ("response" in g) return g.response;
  const { id } = await params;
  return NextResponse.json(await loadContactConsent(g.admin, g.ctx.tenantId, id));
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate();
  if ("response" in g) return g.response;
  const { supabase, tenantId, userId, role } = g.ctx;
  if (!canEditWorkcenter(await resolvePermissions(supabase, tenantId, userId, role), "contacts")) {
    return NextResponse.json({ error: "You don't have permission to edit contacts." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { channel?: unknown; topic?: unknown; status?: unknown; basis?: unknown; note?: unknown } | null;
  if (!body || typeof body.channel !== "string" || typeof body.status !== "string") return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const { id } = await params;
  const result = await recordConsentByStaff(g.admin, tenantId, userId, id, {
    channel: body.channel,
    topic: typeof body.topic === "string" ? body.topic : null,
    status: body.status,
    basis: typeof body.basis === "string" ? body.basis : null,
    note: typeof body.note === "string" ? body.note : "",
  });
  if (!result.ok) return NextResponse.json({ error: result.error, pending: result.pending ?? false }, { status: result.status });

  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "contacts", objectId: id, objectLabel: result.label,
    action: "update", actorId: user?.id, actorEmail: user?.email, changes: result.changes,
  });
  return NextResponse.json({ consent: await loadContactConsent(g.admin, tenantId, id) });
}
