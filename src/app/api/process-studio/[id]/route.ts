import { NextResponse, type NextRequest } from "next/server";
import { logChange, diffForLog } from "@/lib/changeLog";
import { encrypt } from "@/lib/encryption";
import { parseStudyPatch } from "@/lib/studio/requests";
import { studioAccess, errorResponse, ownedStudy, loadBundle, updateStudy } from "@/lib/studio/server";

// One study.
//
// GET    -> the whole bundle: study, messages, steps, fit, changes, tasks, comments, requests
// PATCH  { name?, follow_ups?, language?, areas?, lanes?, plan_start_date?, weekend?,
//          contact_name?, contact_email?, custom_data? (cf_ keys only) }
// DELETE -> the study and everything under it (rows cascade). Uploaded documents are
//           phase 2, so there are no files to remove yet.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await studioAccess("view");
    const study = await ownedStudy(ctx, (await params).id);
    return NextResponse.json(await loadBundle(ctx, study));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await studioAccess("edit");
    const study = await ownedStudy(ctx, (await params).id);
    const parsed = parseStudyPatch(await req.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });

    const patch: Record<string, unknown> = { ...parsed.patch };
    if ("contact_email" in parsed && parsed.contact_email !== undefined) patch.contact_email = encrypt(parsed.contact_email);
    if (parsed.custom_data && Object.keys(parsed.custom_data).length > 0) {
      patch.custom_data = { ...(study.custom_data ?? {}), ...parsed.custom_data };
    }
    if (Object.keys(patch).length > 0) await updateStudy(ctx, study.id, patch);

    // The email is encrypted in the audit log's eyes too: diffForLog redacts it.
    const logged: Record<string, unknown> = { ...parsed.patch };
    if (parsed.contact_email !== undefined) logged.contact_email = parsed.contact_email;
    if (parsed.custom_data) logged.custom_data = patch.custom_data;
    const changes = diffForLog("process_studies", study as unknown as Record<string, unknown>, logged);
    if (changes.length > 0) {
      await logChange(ctx.supabase, {
        tenantId: ctx.tenantId, objectType: "process_studies", objectId: study.id, objectLabel: study.ref ?? study.name,
        action: "update", actorId: ctx.userId, actorEmail: ctx.email, changes,
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await studioAccess("delete");
    const study = await ownedStudy(ctx, (await params).id);
    const { error } = await ctx.admin.from("process_studies").delete().eq("id", study.id).eq("tenant_id", ctx.tenantId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logChange(ctx.supabase, {
      tenantId: ctx.tenantId, objectType: "process_studies", objectId: study.id, objectLabel: study.ref ?? study.name,
      action: "delete", actorId: ctx.userId, actorEmail: ctx.email,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
