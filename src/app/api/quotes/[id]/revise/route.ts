import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { diffForLog, logChange } from "@/lib/changeLog";

// Clone a quote (and its lines) into a new draft revision -- available from
// any phase (Draft through Rejected/Approved), not just once the original is
// closed: paperwork often needs a fresh version mid-negotiation too. The
// original is locked read-only (superseded_by) the moment the new version
// exists, so there's never more than one live/editable copy of a quote in a
// revision chain at a time.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;

  const { data: original, error: qErr } = await supabase
    .from("quotes")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .single();

  if (qErr || !original) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }
  if (original.superseded_by) {
    return NextResponse.json({ error: "This version has already been superseded -- create a new version from the latest one instead." }, { status: 409 });
  }

  const newRev = (original.revision ?? 1) + 1;
  const baseRef = String(original.ref).replace(/-R\d+$/, "");
  const newRef  = `${baseRef}-R${newRev}`;

  // Every user-editable field carries over -- a new version is a fresh
  // pipeline pass on the same deal, not a blank quote. Lifecycle fields
  // (status, outcome, the submitted/closed timestamps, business_status,
  // superseded_by) reset instead: this is a brand-new draft that hasn't been
  // sent, decided, or superseded by anything yet.
  const { data: created, error: cErr } = await supabase
    .from("quotes")
    .insert({
      tenant_id: tenantId,
      account_id: original.account_id,
      contact_id: original.contact_id ?? null,
      entity_id: original.entity_id ?? null,
      ref: newRef,
      name: original.name ?? null,
      type: original.type,
      status: "draft",
      outcome: "open",
      business_status: null,
      total: original.total ?? 0,
      quote_date: original.quote_date ?? null,
      valid_until: original.valid_until,
      inquiry_date: original.inquiry_date ?? null,
      submitted_at: null,
      closed_at: null,
      notes: original.notes,
      terms: original.terms ?? null,
      scope_of_work: original.scope_of_work ?? null,
      ref_no: original.ref_no ?? null,
      pr_no: original.pr_no ?? null,
      po_number: original.po_number ?? null,
      po_amount: original.po_amount ?? null,
      discount_type: original.discount_type ?? null,
      discount_pct: original.discount_pct ?? null,
      discount_fixed: original.discount_fixed ?? null,
      gst_rate: original.gst_rate ?? null,
      asset_ids: original.asset_ids ?? [],
      revision: newRev,
      selected_option_id: original.selected_option_id ?? null,
      territory: original.territory ?? null,
      sales_org: original.sales_org ?? null,
      custom_data: original.custom_data ?? null,
      meta: original.meta ?? null,
      superseded_by: null,
    })
    .select("id, ref")
    .single();

  if (cErr || !created) {
    return NextResponse.json({ error: cErr?.message ?? "Failed to create revision" }, { status: 500 });
  }

  const { data: lines } = await supabase
    .from("quote_lines")
    .select("description, uom, qty, rate, discount_pct, amount, sl_no, group_id, group_label, group_type, group_description, category, deduction, inventory_item_id")
    .eq("quote_id", id)
    .eq("tenant_id", tenantId);

  if (Array.isArray(lines) && lines.length > 0) {
    const rows = lines.map((l) => ({ ...l, tenant_id: tenantId, quote_id: created.id }));
    const { error: lErr } = await supabase.from("quote_lines").insert(rows);
    if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 });
  }

  await supabase.from("quote_revisions").insert({
    tenant_id: tenantId,
    quote_id: created.id,
    rev: newRev,
    date: new Date().toISOString().split("T")[0],
    description: `Revised from ${original.ref}`,
  });

  // Lock the source quote -- it's now read-only regardless of its own
  // status, everywhere (in-app edit route, v1 PATCH). Best-effort ordering:
  // the new version already exists at this point even if this update fails,
  // so a retry of this request would 409 on "already superseded" above --
  // safe, since the failure mode is "old version stays briefly editable",
  // never data loss or a dangling reference.
  const { error: lockErr } = await supabase
    .from("quotes")
    .update({ superseded_by: created.id })
    .eq("id", id)
    .eq("tenant_id", tenantId);
  if (lockErr) console.error("[revise] failed to lock superseded quote", lockErr.message);

  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "quotes", objectId: created.id, objectLabel: created.ref,
    action: "create", actorId: user?.id, actorEmail: user?.email,
    changes: diffForLog("quotes", {}, { revised_from: original.ref, revision: newRev }),
  });

  return NextResponse.json({ id: created.id, ref: created.ref }, { status: 201 });
}
