import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { diffForLog, logChange } from "@/lib/changeLog";
import { parseDateOverride, parseTimestampOverride } from "@/lib/dateProfile";
import { applyDateProfile } from "@/lib/api/quoteService";
import { LOSS_REASONS } from "@/lib/constants";

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId, userId;
  try {
    ({ supabase, tenantId, userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { id } = await params;

  // Snapshot quote before deletion for audit log
  const { data: snap } = await supabase
    .from("quotes")
    .select("ref, name, status, total, account_id, created_at")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .single();

  const { error } = await supabase
    .from("quotes")
    .delete()
    .eq("id", id)
    .eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Append deletion record to tenants.config.deleted_quotes
  if (snap) {
    const admin = createAdminSupabase();
    const { data: tenant } = await admin.from("tenants").select("config").eq("id", tenantId).single();
    const cfg = (tenant?.config ?? {}) as Record<string, unknown>;
    const log = Array.isArray(cfg.deleted_quotes) ? (cfg.deleted_quotes as unknown[]) : [];
    log.push({
      id,
      ref:        snap.ref,
      name:       snap.name ?? null,
      status:     snap.status,
      total:      snap.total,
      account_id: snap.account_id,
      created_at: snap.created_at,
      deleted_at: new Date().toISOString(),
      deleted_by: userId,
    });
    await admin.from("tenants").update({ config: { ...cfg, deleted_quotes: log } }).eq("id", tenantId);

    const user = await getAuthUser();
    await logChange(supabase, {
      tenantId, objectType: "quotes", objectId: id, objectLabel: snap.ref,
      action: "delete", actorId: user?.id, actorEmail: user?.email,
    });
  }

  return new NextResponse(null, { status: 204 });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;
  const body = await request.json();

  const allowed = ["status", "notes", "custom_data", "ref_no", "outcome"];
  const patch: Record<string, unknown> = {};
  for (const key of allowed) if (key in body) patch[key] = body[key];

  // Loss Intelligence (0088): a structured reason travels with a lost/
  // dropped outcome (also fileable later on an already-lost quote); winning
  // or reopening clears both -- a live quote carries no loss story.
  if ("loss_reason" in body) {
    const v = body.loss_reason;
    if (v !== null && !(LOSS_REASONS as readonly string[]).includes(v as string)) {
      return NextResponse.json({ error: `loss_reason must be one of: ${LOSS_REASONS.join(", ")} (or null)` }, { status: 400 });
    }
    patch.loss_reason = v;
  }
  if ("loss_note" in body) {
    const v = body.loss_note;
    patch.loss_note = typeof v === "string" && v.trim() ? v.trim().slice(0, 500) : null;
  }
  if (patch.outcome === "won" || patch.outcome === "open") {
    patch.loss_reason = null;
    patch.loss_note = null;
  }

  // Date-profile manual overrides (0059) -- null clears, a valid YYYY-MM-DD
  // sets, anything malformed is a 400 (never a silent clear of an existing
  // business timestamp).
  if ("inquiry_date" in body) {
    const r = parseDateOverride(body.inquiry_date);
    if (!r.ok) return NextResponse.json({ error: "inquiry_date must be a valid YYYY-MM-DD date" }, { status: 400 });
    patch.inquiry_date = r.date;
  }
  if ("submitted_at" in body) {
    const r = parseTimestampOverride(body.submitted_at);
    if (!r.ok) return NextResponse.json({ error: "submitted_at must be a valid YYYY-MM-DD date" }, { status: 400 });
    patch.submitted_at = r.iso;
  }
  if ("closed_at" in body) {
    const r = parseTimestampOverride(body.closed_at);
    if (!r.ok) return NextResponse.json({ error: "closed_at must be a valid YYYY-MM-DD date" }, { status: 400 });
    patch.closed_at = r.iso;
  }

  const admin = createAdminSupabase();

  const { data: before } = await admin
    .from("quotes")
    .select("*")
    .eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!before) return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  if (before.superseded_by) {
    return NextResponse.json({ error: "This version has been superseded and is read-only -- edit the latest version instead." }, { status: 409 });
  }

  // Status (pipeline position) and outcome (won/lost/dropped/open) are
  // independent fields -- see applyDateProfile in quoteService.ts for the one
  // rule tying them together (a closed status can never coexist with an
  // undecided "open" outcome), plus the submitted_at/closed_at date-profile
  // stamps. Shared with the v1 API so both channels enforce it identically.
  const dateProfile = await applyDateProfile(admin, tenantId, before as Record<string, unknown>, patch);
  if (dateProfile.error) return NextResponse.json({ error: dateProfile.error }, { status: 400 });

  let { data, error } = await admin
    .from("quotes")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("*")
    .single();

  // Deploy-order resilience: code ships before the owner runs migration
  // 0088 by hand. If the loss columns don't exist yet, retry without them
  // rather than blocking the outcome change itself.
  if (error?.code === "42703" && ("loss_reason" in patch || "loss_note" in patch)) {
    delete patch.loss_reason;
    delete patch.loss_note;
    ({ data, error } = await admin
      .from("quotes").update(patch).eq("id", id).eq("tenant_id", tenantId).select("*").single());
  }

  if (error) { console.error("[quotes PATCH] update failed", error); return NextResponse.json({ error: error.message }, { status: 500 }); }

  const user = await getAuthUser();
  // updated_at changes on every save by definition -- logging it would put a
  // meaningless row in every audit entry.
  const { updated_at: _updatedAt, ...diffPatch } = patch;
  const changes = diffForLog("quotes", (before as Record<string, unknown>) ?? {}, diffPatch);
  if (changes.length > 0) {
    await logChange(supabase, {
      tenantId, objectType: "quotes", objectId: id, objectLabel: (data as { ref?: string }).ref ?? null,
      action: dateProfile.reopened ? "reopen" : "update", actorId: user?.id, actorEmail: user?.email, changes,
    });
  }

  return NextResponse.json(data);
}
