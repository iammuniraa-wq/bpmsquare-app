import { NextResponse, type NextRequest } from "next/server";
import { isPlatformAdmin, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { isUuid } from "@/lib/studio/requests";

// "Mark reviewed": a person at BPMSquare has checked the fit report. Every row
// reads as reviewed, the study stops saying Draft, and the client sees the tick.
// Platform admins only; scoped to the study id and the tenant on that study row.
//
// POST { note? }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Study not found" }, { status: 404 });
  const admin = createAdminSupabase();
  const { data: study } = await admin.from("process_studies").select("id, tenant_id, status").eq("id", id).maybeSingle();
  if (!study) return NextResponse.json({ error: "Study not found" }, { status: 404 });
  if (study.status === "telling" || study.status === "mapped") {
    return NextResponse.json({ error: "This study has no fit report to review yet." }, { status: 409 });
  }
  const tenantId = study.tenant_id as string;
  const body = (await req.json().catch(() => null)) as { note?: unknown } | null;
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 2000) : "";
  const user = await getAuthUser();
  const now = new Date().toISOString();

  const { error: fitErr } = await admin.from("process_study_fit").update({ reviewed: true, updated_at: now }).eq("study_id", id).eq("tenant_id", tenantId);
  if (fitErr) return NextResponse.json({ error: fitErr.message }, { status: 500 });
  const handOff = ["accepted", "rescoped", "closed"].includes(study.status as string);
  const { error } = await admin.from("process_studies")
    .update({ reviewed_at: now, reviewed_by: user?.id ?? null, review_note: note || null, ...(handOff ? {} : { status: "reviewed" }), updated_at: now })
    .eq("id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
