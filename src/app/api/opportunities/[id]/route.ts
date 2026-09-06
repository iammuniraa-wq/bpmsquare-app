import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { getTenant, tenantHasFeature } from "@/lib/tenant";
import { diffForLog, logChange } from "@/lib/changeLog";
import { LOSS_REASONS, QUOTE_OUTCOMES } from "@/lib/constants";
import { opportunityStages, stageDef, outcomeForStage, probabilityFor, parseTeam, OPPORTUNITY_SOURCES } from "@/lib/sales/opportunity";
import { loadOpportunity, loadOpportunityLines, loadLinkedQuotes, refreshOpportunityDerived, stageSinceMap } from "@/lib/sales/opportunityServer";

async function guard() {
  const ctx = await requireTenantUser();
  if (!(await tenantHasFeature(ctx.supabase, ctx.tenantId, "pipeline"))) {
    throw Object.assign(new Error("Pipeline isn't enabled for your workspace"), { status: 403 });
  }
  return ctx;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let tenantId;
  try { ({ tenantId } = await guard()); } catch (e: unknown) {
    const err = e as { status?: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
  }
  const { id } = await params;
  const admin = createAdminSupabase();
  const opp = await loadOpportunity(admin, tenantId, id);
  if (!opp) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [lines, quotes, since, { data: account }, { data: contact }] = await Promise.all([
    loadOpportunityLines(admin, tenantId, id),
    loadLinkedQuotes(admin, tenantId, id),
    stageSinceMap(admin, tenantId, [opp]),
    admin.from("accounts").select("id, name").eq("id", opp.account_id).eq("tenant_id", tenantId).maybeSingle(),
    opp.contact_id ? admin.from("contacts").select("id, name").eq("id", opp.contact_id).eq("tenant_id", tenantId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  return NextResponse.json({ ...opp, stage_since: since.get(opp.id) ?? opp.created_at, account_name: account?.name ?? null, contact_name: contact?.name ?? null, lines, quotes });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try { ({ supabase, tenantId } = await guard()); } catch (e: unknown) {
    const err = e as { status?: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const admin = createAdminSupabase();
  const before = await loadOpportunity(admin, tenantId, id);
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const tenant = await getTenant();
  const stages = opportunityStages(tenant?.config);
  const patch: Record<string, unknown> = {};

  for (const key of ["title", "description", "loss_note", "currency", "probability_override_reason", "competitor"] as const) {
    if (key in body) {
      const v = body[key];
      patch[key] = typeof v === "string" && v.trim() ? v.trim() : null;
    }
  }
  if ("title" in patch && !patch.title) return NextResponse.json({ error: "title is required" }, { status: 400 });
  if ("expected_close" in body) {
    const v = body.expected_close;
    if (v !== null && v !== "" && !(typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v))) return NextResponse.json({ error: "expected_close must be YYYY-MM-DD" }, { status: 400 });
    patch.expected_close = v || null;
  }
  if ("source" in body) patch.source = (OPPORTUNITY_SOURCES as readonly string[]).includes(body.source) ? body.source : null;
  if ("probability_override" in body) {
    const v = body.probability_override;
    if (v === null || v === "") patch.probability_override = null;
    else {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 100) return NextResponse.json({ error: "probability_override must be 0-100" }, { status: 400 });
      patch.probability_override = Math.round(n);
    }
  }
  if ("team" in body) patch.team = parseTeam(body.team);
  if ("owner_id" in body) patch.owner_id = typeof body.owner_id === "string" && body.owner_id ? body.owner_id : null;
  if ("contact_id" in body) {
    if (body.contact_id) {
      const { data: contact } = await admin.from("contacts").select("id").eq("id", body.contact_id).eq("tenant_id", tenantId).maybeSingle();
      if (!contact) return NextResponse.json({ error: "Contact not found" }, { status: 404 });
      patch.contact_id = body.contact_id;
    } else patch.contact_id = null;
  }
  if ("custom_data" in body && body.custom_data && typeof body.custom_data === "object") {
    // Only tenant-defined custom fields (cf_*) may land in custom_data.
    const cf = Object.fromEntries(Object.entries(body.custom_data as Record<string, unknown>).filter(([k]) => k.startsWith("cf_")));
    patch.custom_data = { ...(before.custom_data ?? {}), ...cf };
  }

  // Stage and outcome. A closed stage implies its outcome (Won -> won,
  // Lost -> lost) unless the body says otherwise; leaving a closed stage
  // reopens the deal. A lost/dropped outcome files a loss reason.
  let stage = before.stage;
  if ("stage" in body) {
    const def = stageDef(stages, String(body.stage));
    if (!def) return NextResponse.json({ error: `Unknown stage "${body.stage}"` }, { status: 400 });
    stage = def.value;
    patch.stage = stage;
  }
  let outcome = before.outcome;
  if ("outcome" in body) {
    if (!(QUOTE_OUTCOMES as readonly string[]).includes(body.outcome)) return NextResponse.json({ error: "outcome must be open, won, lost or dropped" }, { status: 400 });
    outcome = body.outcome;
  } else if ("stage" in body) {
    outcome = outcomeForStage(stages, stage);
  }
  if (outcome !== before.outcome) patch.outcome = outcome;
  if (outcome === "lost" || outcome === "dropped") {
    if ("loss_reason" in body) {
      if (!(LOSS_REASONS as readonly string[]).includes(body.loss_reason)) return NextResponse.json({ error: "loss_reason is not a known reason" }, { status: 400 });
      patch.loss_reason = body.loss_reason;
    } else if (!before.loss_reason) {
      patch.loss_reason = "other";
    }
  } else if (outcome !== before.outcome) {
    patch.loss_reason = null;
    patch.loss_note = null;
  }
  const closedNow = stageDef(stages, stage)?.is_closed === true || outcome !== "open";
  const closedBefore = stageDef(stages, before.stage)?.is_closed === true || before.outcome !== "open";
  if (closedNow && !closedBefore) patch.closed_at = new Date().toISOString();
  if (!closedNow && closedBefore) patch.closed_at = null;

  patch.probability = probabilityFor(stages, stage, ("probability_override" in patch ? patch.probability_override : before.probability_override) as number | null);
  patch.updated_at = new Date().toISOString();

  const { error } = await admin.from("opportunities").update(patch).eq("id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const user = await getAuthUser();
  const { updated_at: _u, probability: _p, ...diffPatch } = patch;
  const changes = diffForLog("opportunities", before as unknown as Record<string, unknown>, diffPatch);
  if (changes.length > 0) {
    await logChange(supabase, {
      tenantId, objectType: "opportunities", objectId: id, objectLabel: `${before.ref ?? ""} ${(patch.title as string) ?? before.title}`.trim(),
      action: "update", actorId: user?.id, actorEmail: user?.email, changes,
    });
  }
  const after = await loadOpportunity(admin, tenantId, id);
  return NextResponse.json(after);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try { ({ supabase, tenantId } = await guard()); } catch (e: unknown) {
    const err = e as { status?: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
  }
  const { id } = await params;
  const admin = createAdminSupabase();
  const before = await loadOpportunity(admin, tenantId, id);
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Quotes keep existing; the link goes (FK on delete set null).
  const { error } = await admin.from("opportunities").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "opportunities", objectId: id, objectLabel: `${before.ref ?? ""} ${before.title}`.trim(),
    action: "delete", actorId: user?.id, actorEmail: user?.email,
  });
  return new NextResponse(null, { status: 204 });
}

/** Re-derive amount/probability -- exported for the quote routes. */
export { refreshOpportunityDerived };
