import { NextResponse, type NextRequest } from "next/server";
import { isUuid } from "@/lib/estimator/requests";
import { estimatorAccess, errorResponse } from "@/lib/estimator/server";
import { aiConfigured, EstimatorAiError, notConfiguredResponse, meteredAsk, ESTIMATE_INTAKE_SURFACE } from "@/lib/estimator/aiServer";
import { runIntake, type DrawingRead } from "@/lib/estimator/aiRun";
import { measureAttachment } from "@/lib/estimator/drawing/run";
import { loadIntakeFiles, type LoadedFiles } from "@/lib/estimator/intakeFiles/load";
import { classifyFile, DXF_SKIP_REASON, skipReason } from "@/lib/estimator/intakeFiles/kinds";
import { ATTACHMENT_BUCKET, inboxAccess, loadAttachments, loadEmailForViewer } from "@/lib/inbox/server";

// POST { template_id, text, email_id?, attachment_ids? } -- read a pasted brief or email (and, optionally, the files the
// person ticked on that Inbox message) against the chosen template and PROPOSE a value for each input, each marked
// found | likely | missing with the source words (`fields`, plus the file and page when it came from a file). `values`
// holds only found and likely inputs; a missing input never gets a number. Nothing is saved: the new-estimate page
// fills its fields for the user to review. Needs estimate-create access (it costs a model call) and counts against
// the workspace's AI allowance (surface "estimate_intake"). 503 { configured: false } when no AI key is set.
//
// Attachment ids are only ever looked up with the session's tenant AND the message id (intakeFiles/load.ts); a path is
// never taken from the request. A file that cannot be read is reported by name and the rest still read.
//
// GET ?email_id= -- the message's attachments as the intake box lists them (name, kind, size, quality, and whether each
// can be read), for a message the person may see. Empty list otherwise.
export const maxDuration = 120;

const TEXT_TOKENS = 4000;
const FILE_TOKENS = 8000;

export async function GET(req: NextRequest) {
  try {
    const { tenantId } = await estimatorAccess("create");
    const emailId = req.nextUrl.searchParams.get("email_id");
    if (!isUuid(emailId)) return NextResponse.json({ files: [] });
    let ctx;
    try { ctx = await inboxAccess(false); } catch { return NextResponse.json({ files: [] }); }
    if (ctx.tenantId !== tenantId || !(await loadEmailForViewer(ctx, emailId))) return NextResponse.json({ files: [] });
    const rows = await loadAttachments(ctx, [emailId]);
    return NextResponse.json({
      files: rows.map((a) => {
        const kind = classifyFile(a.file_name, a.mime_type, a.ext);
        const note = kind === "dxf" ? null : skipReason(kind, a.size_bytes, a.ext, a.file_name);
        return { id: a.id, name: a.file_name, kind, size_bytes: a.size_bytes, quality: a.quality, quality_note: a.quality_note, readable: !note, note };
      }),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { supabase, tenantId, userId } = await estimatorAccess("create");
    if (!aiConfigured()) return notConfiguredResponse();
    const body = (await req.json().catch(() => null)) as { template_id?: unknown; text?: unknown; email_id?: unknown; attachment_ids?: unknown; unit_factor?: unknown } | null;
    const unitFactor = typeof body?.unit_factor === "number" && Number.isFinite(body.unit_factor) && body.unit_factor > 0 ? body.unit_factor : undefined;
    if (!isUuid(body?.template_id)) return NextResponse.json({ error: "Choose a template first." }, { status: 422 });

    let files: LoadedFiles = { files: [], skipped: [] };
    const drawings: DrawingRead[] = [];
    if (isUuid(body?.email_id) && Array.isArray(body?.attachment_ids) && body!.attachment_ids.length > 0) {
      let ctx;
      try { ctx = await inboxAccess(false); } catch { ctx = null; }
      if (!ctx || ctx.tenantId !== tenantId) {
        files = { files: [], skipped: [{ id: "", name: "Attachments", reason: "You do not have access to this message's files." }] };
      } else {
        files = await loadIntakeFiles({
          admin: ctx.admin, tenantId,
          canSeeEmail: async (id) => !!(await loadEmailForViewer(ctx, id)),
          download: async (path) => {
            const { data, error } = await ctx.admin.storage.from(ATTACHMENT_BUCKET).download(path);
            return error || !data ? null : new Uint8Array(await data.arrayBuffer());
          },
        }, { emailId: body!.email_id, attachmentIds: body!.attachment_ids });
        // DXF drawings are measured, not sent to the model: at most two, each loaded with the person's own access.
        const dxf = files.skipped.filter((s) => s.id && s.reason === DXF_SKIP_REASON).slice(0, 2);
        files = { ...files, skipped: files.skipped.filter((s) => !dxf.includes(s)) };
        for (const s of dxf) {
          const m = await measureAttachment(ctx, { emailId: body!.email_id, attachmentId: s.id, ...(unitFactor ? { factor: unitFactor } : {}) });
          if (m.ok) drawings.push({ id: s.id, name: s.name, table: m.payload.layers });
          else files = { ...files, skipped: [...files.skipped, { id: s.id, name: s.name, reason: m.error }] };
        }
      }
    }

    const r = await runIntake({
      supabase, tenantId, templateId: body!.template_id as string, text: typeof body?.text === "string" ? body.text : "",
      ask: meteredAsk({ tenantId, userId }, ESTIMATE_INTAKE_SURFACE, files.files.length > 0 ? FILE_TOKENS : TEXT_TOKENS),
      files, drawings,
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ configured: true, ...r.proposal });
  } catch (e) {
    if (e instanceof EstimatorAiError) return NextResponse.json({ error: e.message, configured: e.status !== 503 }, { status: e.status });
    return errorResponse(e);
  }
}
