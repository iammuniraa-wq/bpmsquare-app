import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { DEFAULT_QUOTE_STATUSES, type QuoteStatusDef } from "@/lib/constants";
import { diffForLog, logChange } from "@/lib/changeLog";
import { parseDateOverride, parseTimestampOverride } from "@/lib/dateProfile";

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

  // Auto-sync outcome to the pipeline status whenever status changes (unless
  // the caller is also explicitly setting outcome in this same request) --
  // reaching a terminal status is a definitive event. A quote can still be
  // marked won/lost independently, before that, via its own "outcome" patch.
  if ("status" in patch) {
    const { data: tenant } = await admin.from("tenants").select("config").eq("id", tenantId).single();
    const quoteStatuses: QuoteStatusDef[] = (tenant?.config as { quote_statuses?: QuoteStatusDef[] })?.quote_statuses ?? DEFAULT_QUOTE_STATUSES;
    const def = quoteStatuses.find((s) => s.value === patch.status);
    if (!("outcome" in patch)) {
      patch.outcome = def?.is_terminal ? (def.is_lost ? "lost" : "won") : "open";
    }
    // Submitted-to-customer: stamped the first time the quote leaves its
    // initial status (works for tenant-customized status sets too, where
    // the post-draft stage isn't necessarily called "sent"). Also stamped by
    // the email route on an actual send; a manual override always wins.
    if (!before.submitted_at && !("submitted_at" in patch) && def && !def.is_initial) {
      patch.submitted_at = new Date().toISOString();
    }
  }

  // Closed date follows outcome: stamped when the quote leaves "open",
  // cleared when it's reopened -- unless the caller overrode it explicitly.
  const effectiveOutcome = ("outcome" in patch ? patch.outcome : before.outcome) as string;
  if (!("closed_at" in patch)) {
    if (effectiveOutcome !== "open" && before.outcome === "open") patch.closed_at = new Date().toISOString();
    else if (effectiveOutcome === "open" && before.outcome !== "open") patch.closed_at = null;
  }

  patch.updated_at = new Date().toISOString();

  const { data, error } = await admin
    .from("quotes")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("*")
    .single();

  if (error) { console.error("[quotes PATCH] update failed", error); return NextResponse.json({ error: error.message }, { status: 500 }); }

  const user = await getAuthUser();
  // updated_at changes on every save by definition -- logging it would put a
  // meaningless row in every audit entry.
  const { updated_at: _updatedAt, ...diffPatch } = patch;
  const changes = diffForLog("quotes", (before as Record<string, unknown>) ?? {}, diffPatch);
  if (changes.length > 0) {
    await logChange(supabase, {
      tenantId, objectType: "quotes", objectId: id, objectLabel: (data as { ref?: string }).ref ?? null,
      action: "update", actorId: user?.id, actorEmail: user?.email, changes,
    });
  }

  return NextResponse.json(data);
}
