import { NextResponse, type NextRequest } from "next/server";
import { logChange } from "@/lib/changeLog";
import { encrypt } from "@/lib/encryption";
import { parseSend } from "@/lib/studio/requests";
import {
  studioAccess, errorResponse, ownedStudy, loadBundle, snapshotVersion, updateStudy, insertRows, loadNotifyAddress,
} from "@/lib/studio/server";
import { studySummary } from "@/lib/studio/summary";
import { sendStudyRequestEmail } from "@/lib/studio/email";

export const maxDuration = 60;

// Step 6: "Send to BPMSquare". Freezes the study as the next version, records the
// request in the /admin/studies queue, emails the BPMSquare team (through
// resolveOutbound, so a demo workspace only reaches its sandbox inbox) and keeps
// the study editable: the next send makes the next version.
//
// POST { name, email } -> { version, request_id, email_status, email_note }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await studioAccess("edit");
    const study = await ownedStudy(ctx, (await params).id);
    const parsed = parseSend(await req.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
    if (study.reached < 5) return NextResponse.json({ error: "Build your plan first, then send it." }, { status: 409 });

    const bundleBefore = await loadBundle(ctx, study);
    if (bundleBefore.steps.length === 0 || bundleBefore.fit.length === 0 || bundleBefore.tasks.length === 0) {
      return NextResponse.json({ error: "There is nothing to send yet: the map, the fit report and the plan are all needed." }, { status: 409 });
    }

    await updateStudy(ctx, study.id, { contact_name: parsed.name, contact_email: encrypt(parsed.email) });
    const version = await snapshotVersion(ctx, { ...study, contact_name: parsed.name }, "submitted");
    const [request] = await insertRows(ctx, "process_study_requests", study.id, [
      { version, status: "new", contact_name: parsed.name, contact_email: encrypt(parsed.email), email_status: "not_sent" },
    ]);

    // Already reviewed work stays reviewed in its own version; a fresh send is a fresh submission.
    await updateStudy(ctx, study.id, { status: "submitted", reached: 6, reviewed_at: null, reviewed_by: null, review_note: null });

    const notify = await loadNotifyAddress();
    const summary = studySummary({ study: bundleBefore.study, steps: bundleBefore.steps, fit: bundleBefore.fit, changes: bundleBefore.changes, tasks: bundleBefore.tasks, comments: bundleBefore.comments });
    const outcome = await sendStudyRequestEmail(ctx, {
      study, version, contactName: parsed.name, contactEmail: parsed.email, summary, notifyTo: notify.address,
      adminUrl: `${req.nextUrl.origin}/admin/studies/${study.id}`,
    });
    await ctx.admin.from("process_study_requests")
      .update({ email_status: outcome.status, email_note: outcome.note, updated_at: new Date().toISOString() })
      .eq("id", request.id as string).eq("tenant_id", ctx.tenantId).eq("study_id", study.id);

    await logChange(ctx.supabase, {
      tenantId: ctx.tenantId, objectType: "process_studies", objectId: study.id, objectLabel: study.ref ?? study.name,
      action: "update", actorId: ctx.userId, actorEmail: ctx.email,
      changes: [{ field: "status", from: study.status, to: "submitted" }, { field: "version", from: study.current_version, to: version }],
    });
    return NextResponse.json({ version, request_id: request.id, email_status: outcome.status, email_note: outcome.note });
  } catch (e) {
    return errorResponse(e);
  }
}
