import { NextResponse, type NextRequest } from "next/server";
import { logChange } from "@/lib/changeLog";
import { isUuid } from "@/lib/estimator/requests";
import { parseScheduleFile, MAX_SCHEDULE_BYTES, ScheduleFileError } from "@/lib/estimator/schedule";
import { estimatorAccess, errorResponse, pendingResponse, loadEstimate, loadTemplate, templateBody, recomputeEstimate } from "@/lib/estimator/server";

// Element schedule (the way a BIM or detailing export enters an estimate).
//
// POST /api/estimates/[id]/schedule?mode=preview|apply[&skip_errors=1]
//   multipart/form-data with a "file" (.csv or .xlsx), or JSON
//   { filename, csv } / { filename, base64 }.
//   preview -> { ok, header_row, row_count, rows, errors, warnings, totals }  (nothing is written)
//   apply   -> the preview fields plus { estimate, lines, totals }: the estimate is recalculated with
//              the file's quantities (source = "schedule" lines), replacing any earlier schedule.
//              A file with row errors is refused (422) unless skip_errors=1, which uses the good rows.
// DELETE removes the imported schedule and recalculates from the formulas.
// Limits: 5 MB, 2000 rows (schedule.ts). The blank file: GET /api/estimates/schedule-template.

const LOCKED = "This estimate already has a quote, so its quantities can no longer change.";
// A multipart body adds boundaries and headers around the file.
const MAX_BODY_BYTES = MAX_SCHEDULE_BYTES + 64 * 1024;

async function readUpload(req: NextRequest): Promise<{ ok: true; data: Uint8Array; filename: string } | { ok: false; status: number; error: string }> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return { ok: false, status: 413, error: `The file is too large; the limit is ${MAX_SCHEDULE_BYTES / 1048576} MB.` };
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!file || typeof file === "string") return { ok: false, status: 422, error: 'Attach the schedule as a "file" field.' };
    if (file.size > MAX_SCHEDULE_BYTES) return { ok: false, status: 413, error: `The file is too large; the limit is ${MAX_SCHEDULE_BYTES / 1048576} MB.` };
    return { ok: true, data: new Uint8Array(await file.arrayBuffer()), filename: file.name || "schedule.csv" };
  }
  const body = (await req.json().catch(() => null)) as { filename?: unknown; csv?: unknown; base64?: unknown } | null;
  if (!body) return { ok: false, status: 422, error: "Send the file as multipart form data or JSON." };
  const filename = typeof body.filename === "string" && body.filename.trim() ? body.filename.trim().slice(0, 200) : "schedule.csv";
  if (typeof body.csv === "string") {
    const data = new TextEncoder().encode(body.csv);
    if (data.byteLength > MAX_SCHEDULE_BYTES) return { ok: false, status: 413, error: `The file is too large; the limit is ${MAX_SCHEDULE_BYTES / 1048576} MB.` };
    return { ok: true, data, filename: /\.(csv|txt|xlsx)$/i.test(filename) ? filename : `${filename}.csv` };
  }
  if (typeof body.base64 === "string") {
    if (body.base64.length > Math.ceil((MAX_SCHEDULE_BYTES * 4) / 3) + 8) return { ok: false, status: 413, error: `The file is too large; the limit is ${MAX_SCHEDULE_BYTES / 1048576} MB.` };
    return { ok: true, data: new Uint8Array(Buffer.from(body.base64, "base64")), filename };
  }
  return { ok: false, status: 422, error: "Send a file, or JSON with csv or base64." };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const mode = req.nextUrl.searchParams.get("mode") === "apply" ? "apply" : "preview";
    const ctx = await estimatorAccess(mode === "apply" ? "edit" : "view");
    const { supabase, tenantId } = ctx;
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
    const est = await loadEstimate(supabase, tenantId, id);
    if (est.missing) return pendingResponse();
    if (!est.data) return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
    if (mode === "apply" && est.data.standard_quote_id) return NextResponse.json({ error: LOCKED }, { status: 409 });
    if (!est.data.template_id) return NextResponse.json({ error: "This estimate has no template to match the schedule against." }, { status: 409 });
    const tpl = await loadTemplate(supabase, tenantId, est.data.template_id);
    if (!tpl.data) return NextResponse.json({ error: "This estimate's template no longer exists." }, { status: 409 });

    const upload = await readUpload(req);
    if (!upload.ok) return NextResponse.json({ error: upload.error }, { status: upload.status });

    let parsed;
    try {
      parsed = await parseScheduleFile(upload.data, upload.filename, { template: templateBody(tpl.data) });
    } catch (e) {
      if (e instanceof ScheduleFileError) return NextResponse.json({ error: e.message }, { status: 422 });
      throw e;
    }
    const summary = {
      ok: parsed.ok, header_row: parsed.header_row, row_count: parsed.rows.length,
      rows: parsed.rows, errors: parsed.errors, warnings: parsed.warnings, totals: parsed.totals,
    };
    if (mode === "preview") return NextResponse.json(summary);

    const skipErrors = req.nextUrl.searchParams.get("skip_errors") === "1";
    if (!parsed.ok && !skipErrors) {
      return NextResponse.json({ ...summary, error: `The file has ${parsed.errors.length} row problem${parsed.errors.length === 1 ? "" : "s"}. Fix them, or apply the good rows only.` }, { status: 422 });
    }
    if (parsed.quantities.length === 0) return NextResponse.json({ ...summary, error: "There are no usable rows in the file." }, { status: 422 });

    const r = await recomputeEstimate(ctx, id, { schedule: parsed.quantities });
    if (!r.ok) return NextResponse.json({ ...summary, error: r.error, issues: r.issues }, { status: r.status });
    await logChange(supabase, {
      tenantId, objectType: "estimates", objectId: id, objectLabel: est.data.ref ?? est.data.name, action: "update",
      actorId: ctx.userId, actorEmail: ctx.email,
      changes: [{ field: "Element schedule", from: null, to: `${parsed.quantities.length} rows from ${upload.filename}` }],
    });
    return NextResponse.json({ ...summary, estimate: r.estimate, lines: r.lines, totals: r.totals });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await estimatorAccess("edit");
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
    const est = await loadEstimate(ctx.supabase, ctx.tenantId, id);
    if (est.missing) return pendingResponse();
    if (!est.data) return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
    if (est.data.standard_quote_id) return NextResponse.json({ error: LOCKED }, { status: 409 });
    const r = await recomputeEstimate(ctx, id, { schedule: null });
    if (!r.ok) return NextResponse.json({ error: r.error, issues: r.issues }, { status: r.status });
    await logChange(ctx.supabase, {
      tenantId: ctx.tenantId, objectType: "estimates", objectId: id, objectLabel: est.data.ref ?? est.data.name, action: "update",
      actorId: ctx.userId, actorEmail: ctx.email, changes: [{ field: "Element schedule", from: "imported", to: null }],
    });
    return NextResponse.json({ estimate: r.estimate, lines: r.lines, totals: r.totals });
  } catch (e) {
    return errorResponse(e);
  }
}
