import { NextResponse, type NextRequest } from "next/server";
import { isPlatformAdmin, createAdminSupabase } from "@/lib/supabase-server";
import { isUuid, REQUEST_STATUSES, REVIEW_RATINGS } from "@/lib/studio/requests";
import { EFFORT_BANDS } from "@/lib/studio/types";

// The reviewer's edits on one study (/admin/studies/[id]). Platform admins only:
// they read across tenants by design, so every query below is scoped to the
// study id AND to the tenant stored on that study row (never one from the request).
//
// PATCH { fit: { id, rating?, why? } }
//     | { change: { id, effort_band?, title?, plain? } }
//     | { request: { id, status?, notes? } }

const text = (v: unknown, n: number): string => (typeof v === "string" ? v.trim().slice(0, n) : "");

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Study not found" }, { status: 404 });
  const admin = createAdminSupabase();
  const { data: study } = await admin.from("process_studies").select("id, tenant_id").eq("id", id).maybeSingle();
  if (!study) return NextResponse.json({ error: "Study not found" }, { status: 404 });
  const tenantId = study.tenant_id as string;
  const body = (await req.json().catch(() => null)) as Record<string, Record<string, unknown> | undefined> | null;
  const now = new Date().toISOString();

  if (body?.fit && isUuid(body.fit.id)) {
    const patch: Record<string, unknown> = { updated_at: now };
    if (body.fit.rating !== undefined) {
      if (!(REVIEW_RATINGS as readonly string[]).includes(String(body.fit.rating))) return NextResponse.json({ error: "Unknown rating" }, { status: 422 });
      patch.rating = body.fit.rating;
    }
    if (body.fit.why !== undefined) patch.why = text(body.fit.why, 400);
    // A person has looked at it: the row now reads as reviewed.
    patch.reviewed = true;
    const { error } = await admin.from("process_study_fit").update(patch).eq("id", body.fit.id).eq("study_id", id).eq("tenant_id", tenantId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (body?.change && isUuid(body.change.id)) {
    const patch: Record<string, unknown> = { updated_at: now };
    if (body.change.effort_band !== undefined) {
      if (!(EFFORT_BANDS as readonly string[]).includes(String(body.change.effort_band))) return NextResponse.json({ error: "Unknown band" }, { status: 422 });
      patch.effort_band = body.change.effort_band;
    }
    if (body.change.title !== undefined) { const t = text(body.change.title, 120); if (!t) return NextResponse.json({ error: "A change needs a title." }, { status: 422 }); patch.title = t; }
    if (body.change.plain !== undefined) patch.plain = text(body.change.plain, 400);
    const { error } = await admin.from("process_study_changes").update(patch).eq("id", body.change.id).eq("study_id", id).eq("tenant_id", tenantId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (body?.request && isUuid(body.request.id)) {
    const patch: Record<string, unknown> = { updated_at: now };
    if (body.request.status !== undefined) {
      if (!(REQUEST_STATUSES as readonly string[]).includes(String(body.request.status))) return NextResponse.json({ error: "Unknown status" }, { status: 422 });
      patch.status = body.request.status;
    }
    if (body.request.notes !== undefined) patch.notes = text(body.request.notes, 2000) || null;
    const { error } = await admin.from("process_study_requests").update(patch).eq("id", body.request.id).eq("study_id", id).eq("tenant_id", tenantId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    // The outcome of the call is mirrored on the study so the client sees it.
    const outcome: Record<string, string> = { accepted: "accepted", rescoped: "rescoped", declined: "closed" };
    const st = typeof patch.status === "string" ? outcome[patch.status] : undefined;
    if (st) await admin.from("process_studies").update({ status: st, updated_at: now }).eq("id", id).eq("tenant_id", tenantId);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Nothing to change." }, { status: 422 });
}
