import "server-only";
import { getAuthUser } from "@/lib/supabase-server";
import { insertWithMasterRef } from "@/lib/masterRef";
import { logChange } from "@/lib/changeLog";
import { compareElements, summaryOf, summaryText, type CompareEl } from "./compare";
import { DRAWING_BUCKET_NAME, hashOfObject, readHead } from "./storage";
import { ensureDefaultType, isMissingSchema, loadElements, loadRevision, loadRevisions, loadType, needsUpdate, normaliseRevision, REVISION_COLS, DRAWING_COLS, verifyLinks, type DrawingCtx, type Failure } from "./server";
import { drawingNoProblem, mayReturn, normaliseDrawingNo, numberingProblem, nextRevNo, releaseDecision, revLabelFor, revLabelProblem, submitProblems } from "./rules";
import { filePath, pathBelongsTo, sniffFile, uploadRequestProblem } from "./files";
import type { DrawingRow, ElementRow, NewElement, RevisionRow } from "./types";

// Every write of the register, in one place so a route stays a few lines and a test can drive each rule. All writes use the ADMIN client
// (the member policy on these tables is select-only, 0255) and every one is tenant-scoped; every foreign id is verified first.

export type Out<T> = ({ ok: true } & T) | ({ ok: false } & Failure);
const fail = (status: number, error: string, extra?: Record<string, unknown>): { ok: false } & Failure => ({ ok: false, status, error, ...(extra ? { extra } : {}) });
const pending = (): { ok: false } & Failure => ({ ok: false, ...needsUpdate() });

async function actor(): Promise<{ id: string | null; email: string | null }> {
  const u = await getAuthUser();
  return { id: u?.id ?? null, email: u?.email ?? null };
}
const label = (d: Pick<DrawingRow, "ref" | "drawing_no" | "title">) => `${d.drawing_no}${d.title ? ` ${d.title}` : ""}`.trim();

async function logDrawing(ctx: DrawingCtx, d: DrawingRow, action: "create" | "update" | "delete", changes?: { field: string; from: unknown; to: unknown }[]): Promise<void> {
  const a = await actor();
  await logChange(ctx.supabase, { tenantId: ctx.tenantId, objectType: "drawings", objectId: d.id, objectLabel: label(d), action, actorId: a.id ?? ctx.userId, actorEmail: a.email, changes });
}

const cleanText = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

// ── Create ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export type CreateBody = { drawing_no?: unknown; title?: unknown; external_no?: unknown; type_id?: unknown; opportunity_id?: unknown; project_id?: unknown; wbs_item_id?: unknown; notes?: unknown; custom_data?: unknown };

/** A new drawing and its first revision (a draft, number 0). The file is attached afterwards, as for every later revision. */
export async function createDrawing(ctx: DrawingCtx, body: CreateBody): Promise<Out<{ drawing: DrawingRow; revision: RevisionRow }>> {
  const noRaw = typeof body.drawing_no === "string" ? body.drawing_no : "";
  const noProblem = drawingNoProblem(noRaw);
  if (noProblem) return fail(422, noProblem);
  const drawingNo = normaliseDrawingNo(noRaw);
  const title = cleanText(body.title, 200);
  if (!title) return fail(422, "A title is needed");

  const links = {
    type_id: typeof body.type_id === "string" && body.type_id ? body.type_id : null,
    opportunity_id: typeof body.opportunity_id === "string" && body.opportunity_id ? body.opportunity_id : null,
    project_id: typeof body.project_id === "string" && body.project_id ? body.project_id : null,
    wbs_item_id: typeof body.wbs_item_id === "string" && body.wbs_item_id ? body.wbs_item_id : null,
  };
  const linkProblem = await verifyLinks(ctx.admin, ctx.tenantId, links);
  if (linkProblem) return fail(422, linkProblem);

  const type = links.type_id ? await loadType(ctx.admin, ctx.tenantId, links.type_id) : await ensureDefaultType(ctx.admin, ctx.tenantId);
  if (!type) return pending();
  if (!type.active) return fail(422, "That drawing type is not in use any more");
  const numbering = numberingProblem(type.numbering_pattern, drawingNo);
  if (numbering) return fail(422, numbering);

  const custom = body.custom_data && typeof body.custom_data === "object" && !Array.isArray(body.custom_data)
    ? Object.fromEntries(Object.entries(body.custom_data as Record<string, unknown>).filter(([k]) => k.startsWith("cf_")))
    : {};
  const { data, error } = await insertWithMasterRef<DrawingRow>(ctx.admin, "drawings", ctx.tenantId, {
    tenant_id: ctx.tenantId, drawing_no: drawingNo, title, external_no: cleanText(body.external_no, 80), type_id: type.id,
    opportunity_id: links.opportunity_id, project_id: links.project_id, wbs_item_id: links.wbs_item_id, custom_data: custom, created_by: ctx.userId,
  }, DRAWING_COLS);
  if (error || !data) {
    if (error && isMissingSchema(error)) return pending();
    if (error?.code === "23505") return fail(409, "That drawing number is already used in this workspace");
    return fail(500, error?.message ?? "Could not create the drawing");
  }

  const revNo = 0;
  const { data: rev, error: revError } = await ctx.admin.from("drawing_revisions").insert({
    tenant_id: ctx.tenantId, drawing_id: data.id, rev_no: revNo, rev_label: revLabelFor(type.rev_scheme, revNo), status: "draft", source: "upload",
    notes: cleanText(body.notes, 2000), created_by: ctx.userId,
  }).select(REVISION_COLS).single();
  if (revError || !rev) {
    await ctx.admin.from("drawings").delete().eq("id", data.id).eq("tenant_id", ctx.tenantId);
    return fail(500, revError?.message ?? "Could not create the first revision");
  }
  await logDrawing(ctx, data, "create", [{ field: "Drawing", from: null, to: `${data.drawing_no} ${title}` }, { field: "Type", from: null, to: type.name }]);
  return { ok: true, drawing: data, revision: normaliseRevision(rev as unknown as Record<string, unknown>) };
}

// ── A new revision ─────────────────────────────────────────────────────────────────────────────────────────────────

export async function startRevision(ctx: DrawingCtx, drawing: DrawingRow, body: { rev_label?: unknown; notes?: unknown; source?: unknown; source_ref?: unknown }): Promise<Out<{ revision: RevisionRow }>> {
  const type = await loadType(ctx.admin, ctx.tenantId, drawing.type_id);
  const { rows, pending: isPending } = await loadRevisions(ctx.admin, ctx.tenantId, drawing.id);
  if (isPending) return pending();
  const open = rows.find((r) => r.status === "draft" || r.status === "in_review");
  if (open) return fail(409, `Revision ${open.rev_label} is still ${open.status === "draft" ? "a draft" : "in review"}. Release or delete it before starting another`);
  const revNo = nextRevNo(rows);
  let revLabel = revLabelFor(type?.rev_scheme ?? "letters", revNo);
  if (typeof body.rev_label === "string" && body.rev_label.trim()) {
    const problem = revLabelProblem(body.rev_label);
    if (problem) return fail(422, problem);
    revLabel = body.rev_label.trim();
  }
  if (rows.some((r) => r.rev_label.toLowerCase() === revLabel.toLowerCase())) return fail(409, `Revision ${revLabel} already exists`);
  const sourceRef = cleanText(body.source_ref, 200);
  if (sourceRef && rows.some((r) => r.source_ref === sourceRef)) return fail(409, "That version has already been added to this drawing");
  const source = ["upload", "email", "ifc", "schedule", "acc", "import"].includes(String(body.source)) ? String(body.source) : "upload";
  const { data, error } = await ctx.admin.from("drawing_revisions").insert({
    tenant_id: ctx.tenantId, drawing_id: drawing.id, rev_no: revNo, rev_label: revLabel, status: "draft", source, source_ref: sourceRef,
    notes: cleanText(body.notes, 2000), created_by: ctx.userId,
  }).select(REVISION_COLS).single();
  if (error || !data) {
    if (error?.code === "23505") return fail(409, "Another revision was started at the same moment. Reload and look again");
    return fail(500, error?.message ?? "Could not start the revision");
  }
  await logDrawing(ctx, drawing, "update", [{ field: "Revision started", from: null, to: `Revision ${revLabel}` }]);
  return { ok: true, revision: normaliseRevision(data as unknown as Record<string, unknown>) };
}

// ── The file ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Step 1: validate the request and hand back a signed upload target. The bytes then go browser to storage, not through this function. */
export async function requestUpload(ctx: DrawingCtx, drawing: DrawingRow, rev: RevisionRow, body: { name?: unknown; size?: unknown }): Promise<Out<{ path: string; token: string; signedUrl: string }>> {
  if (rev.status !== "draft") return fail(409, "Only a draft revision can take a file");
  const name = typeof body.name === "string" ? body.name : "";
  const problem = uploadRequestProblem(name, Number(body.size));
  if (problem) return fail(422, problem);
  const path = filePath(ctx.tenantId, drawing.id, rev.id, name);
  const { data, error } = await ctx.admin.storage.from(DRAWING_BUCKET_NAME).createSignedUploadUrl(path, { upsert: true });
  if (error || !data) return fail(500, "Could not prepare the upload. If this keeps happening the database update may be missing");
  return { ok: true, path, token: data.token, signedUrl: data.signedUrl };
}

/**
 * Step 2: the bytes are in storage. Read the first bytes, decide what the file REALLY is, refuse SVG and HTML, take the size from
 * storage (not from the browser), record the hash the browser computed, and remove any file this revision had before.
 */
export async function finalizeUpload(ctx: DrawingCtx, drawing: DrawingRow, rev: RevisionRow, body: { name?: unknown; sha256?: unknown }): Promise<Out<{ revision: RevisionRow }>> {
  if (rev.status !== "draft") return fail(409, "Only a draft revision can take a file");
  const name = typeof body.name === "string" ? body.name : "";
  const sha = typeof body.sha256 === "string" ? body.sha256.toLowerCase() : "";
  if (!/^[0-9a-f]{64}$/.test(sha)) return fail(422, "The file fingerprint is missing");
  const path = filePath(ctx.tenantId, drawing.id, rev.id, name);
  if (!pathBelongsTo(path, ctx.tenantId, drawing.id, rev.id)) return fail(422, "That file name is not valid");
  const head = await readHead(ctx.admin, path);
  if (!head.ok) return fail(409, "The file did not arrive. Try the upload again");
  const sniff = sniffFile(name, head.head);
  if (!sniff.ok) {
    await ctx.admin.storage.from(DRAWING_BUCKET_NAME).remove([path]);
    return fail(422, sniff.error);
  }
  const problem = uploadRequestProblem(name, head.size);
  if (problem) { await ctx.admin.storage.from(DRAWING_BUCKET_NAME).remove([path]); return fail(422, problem); }
  const previous = rev.file_path && rev.file_path !== path ? rev.file_path : null;
  const { data, error } = await ctx.admin.from("drawing_revisions").update({ file_path: path, file_name: name.slice(0, 200), file_type: sniff.type, file_size: head.size, file_sha256: sha })
    .eq("id", rev.id).eq("drawing_id", drawing.id).eq("tenant_id", ctx.tenantId).eq("status", "draft").select(REVISION_COLS).single();
  if (error || !data) return fail(error ? 500 : 409, error?.message ?? "The revision is no longer a draft");
  if (previous) await ctx.admin.storage.from(DRAWING_BUCKET_NAME).remove([previous]);
  await logDrawing(ctx, drawing, "update", [{ field: `File on revision ${rev.rev_label}`, from: rev.file_name, to: name }]);
  return { ok: true, revision: normaliseRevision(data as unknown as Record<string, unknown>) };
}

// ── Elements ───────────────────────────────────────────────────────────────────────────────────────────────────────

const toRow = (ctx: DrawingCtx, rev: RevisionRow, e: NewElement, i: number) => ({
  tenant_id: ctx.tenantId, revision_id: rev.id, drawing_id: rev.drawing_id, row_no: i + 1, model_uid: e.model_uid, element_code: e.element_code,
  element_type: e.element_type, building: e.building, wbs_item_id: e.wbs_item_id ?? null, level: e.level, qty: e.qty, unit: e.unit,
  volume_m3: e.volume_m3, area_m2: e.area_m2, length_m: e.length_m, weight_t: e.weight_t, weight_calculated: e.weight_calculated, attrs: e.attrs ?? {},
});

/** Replaces the elements of a DRAFT revision with those just read from a file. Keeps the old ones if the new ones cannot be stored. */
export async function replaceElements(ctx: DrawingCtx, drawing: DrawingRow, rev: RevisionRow, elements: NewElement[], origin: { source: string; file_name: string; sha256: string }): Promise<Out<{ revision: RevisionRow; count: number }>> {
  if (rev.status !== "draft") return fail(409, "Only a draft revision can take elements");
  const before = await loadElements(ctx.admin, ctx.tenantId, rev.id);
  const del = await ctx.admin.from("drawing_revision_elements").delete().eq("revision_id", rev.id).eq("tenant_id", ctx.tenantId);
  if (del.error) return isMissingSchema(del.error) ? fail(503, "Reading elements needs a database update (migration 0256). Ask your administrator to apply it.", { needsDatabaseUpdate: true }) : fail(500, del.error.message);
  const rows = elements.map((e, i) => toRow(ctx, rev, e, i));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await ctx.admin.from("drawing_revision_elements").insert(rows.slice(i, i + 500));
    if (error) {
      await ctx.admin.from("drawing_revision_elements").delete().eq("revision_id", rev.id).eq("tenant_id", ctx.tenantId);
      if (before.length) await ctx.admin.from("drawing_revision_elements").insert(before.map((e: ElementRow, k: number) => toRow(ctx, rev, e as unknown as NewElement, k)));
      return fail(error.code === "23505" ? 422 : 500, error.code === "23505" ? "Two rows carry the same model id" : error.message);
    }
  }
  const summary = { ...(rev.change_summary ?? {}), elements: { source: origin.source, file_name: origin.file_name.slice(0, 200), sha256: origin.sha256, rows: elements.length, loaded_at: new Date().toISOString() } };
  const { data, error } = await ctx.admin.from("drawing_revisions").update({ change_summary: summary }).eq("id", rev.id).eq("tenant_id", ctx.tenantId).eq("status", "draft").select(REVISION_COLS).single();
  if (error || !data) return fail(500, error?.message ?? "Could not record the elements");
  await logDrawing(ctx, drawing, "update", [{ field: `Elements of revision ${rev.rev_label}`, from: before.length ? `${before.length} elements` : null, to: `${elements.length} elements from ${origin.file_name}` }]);
  return { ok: true, revision: normaliseRevision(data as unknown as Record<string, unknown>), count: elements.length };
}

const asCompare = (e: ElementRow): CompareEl => ({ model_uid: e.model_uid, element_code: e.element_code, element_type: e.element_type, building: e.building, level: e.level, qty: e.qty, unit: e.unit, volume_m3: e.volume_m3, area_m2: e.area_m2, length_m: e.length_m, weight_t: e.weight_t });

// ── Submit, return, release ────────────────────────────────────────────────────────────────────────────────────────

export async function submitRevision(ctx: DrawingCtx, drawing: DrawingRow, rev: RevisionRow): Promise<Out<{ revision: RevisionRow; problems?: string[] }>> {
  if (rev.status !== "draft") return fail(409, "Only a draft can be submitted");
  const type = await loadType(ctx.admin, ctx.tenantId, drawing.type_id);
  const els = await loadElements(ctx.admin, ctx.tenantId, rev.id);
  const problems = submitProblems({ drawing, revision: rev, type, hasElements: els.length > 0 });
  if (problems.length) return { ...fail(422, problems[0], { problems }) };

  // What changed against the released revision, kept as counts for the list chip (the screen computes the detail on demand).
  let summary = { ...(rev.change_summary ?? {}) };
  if (els.length && drawing.current_rev_id) {
    const old = await loadElements(ctx.admin, ctx.tenantId, drawing.current_rev_id);
    if (old.length) summary = { ...summary, ...summaryOf(compareElements(old.map(asCompare), els.map(asCompare))) };
  }
  const { data, error } = await ctx.admin.from("drawing_revisions").update({ status: "in_review", submitted_by: ctx.userId, submitted_at: new Date().toISOString(), return_reason: null, change_summary: summary })
    .eq("id", rev.id).eq("drawing_id", drawing.id).eq("tenant_id", ctx.tenantId).eq("status", "draft").select(REVISION_COLS).single();
  if (error || !data) return fail(error ? 500 : 409, error?.message ?? "The revision is no longer a draft");
  await logDrawing(ctx, drawing, "update", [{ field: "Revision submitted", from: "Draft", to: `Revision ${rev.rev_label} in review${summary.added || summary.removed || summary.changed ? `: ${summaryText(summary)}` : ""}` }]);
  return { ok: true, revision: normaliseRevision(data as unknown as Record<string, unknown>) };
}

export async function returnRevision(ctx: DrawingCtx, drawing: DrawingRow, rev: RevisionRow, reasonRaw: unknown): Promise<Out<{ revision: RevisionRow }>> {
  const type = await loadType(ctx.admin, ctx.tenantId, drawing.type_id);
  if (rev.status !== "in_review") return fail(409, "Only a revision in review can be returned to draft");
  if (!mayReturn({ type, revision: rev, userId: ctx.userId, role: ctx.role })) return fail(403, "Only the person who submitted it, a named approver or an admin can return a revision");
  const reason = cleanText(reasonRaw, 1000);
  if (!reason) return fail(422, "Say why it is returned, so the preparer knows what to fix");
  const { data, error } = await ctx.admin.from("drawing_revisions").update({ status: "draft", return_reason: reason })
    .eq("id", rev.id).eq("drawing_id", drawing.id).eq("tenant_id", ctx.tenantId).eq("status", "in_review").select(REVISION_COLS).single();
  if (error || !data) return fail(error ? 500 : 409, error?.message ?? "The revision is no longer in review");
  await logDrawing(ctx, drawing, "update", [{ field: "Revision returned to draft", from: `Revision ${rev.rev_label} in review`, to: reason }]);
  return { ok: true, revision: normaliseRevision(data as unknown as Record<string, unknown>) };
}

/**
 * Release: authority from the type (named approvers, second person), the stored file re-hashed against the fingerprint taken at upload,
 * then ONE database function that supersedes the old release and releases this one in a single transaction. A connector never reaches this
 * route with a user, so it can never release.
 */
export async function releaseRevision(ctx: DrawingCtx, drawing: DrawingRow, rev: RevisionRow, body: { effective_from?: unknown }): Promise<Out<{ revision: RevisionRow; supersededId: string | null }>> {
  const type = await loadType(ctx.admin, ctx.tenantId, drawing.type_id);
  const decision = releaseDecision({ type, revision: rev, userId: ctx.userId, role: ctx.role });
  if (!decision.ok) return fail(decision.status, decision.error);
  if (rev.file_path && rev.file_sha256) {
    const now = await hashOfObject(ctx.admin, rev.file_path);
    if (!now.ok) return fail(502, "The stored file could not be checked just now. Try again in a moment");
    if (now.sha256 !== rev.file_sha256) return fail(409, "The stored file no longer matches the fingerprint taken at upload. It cannot be released");
  }
  const effective = typeof body.effective_from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.effective_from) ? body.effective_from : null;
  const { data, error } = await ctx.admin.rpc("release_drawing_revision", { p_tenant: ctx.tenantId, p_revision: rev.id, p_user: ctx.userId, p_effective: effective });
  if (error) {
    if (error.code === "42883" || isMissingSchema(error)) return pending();
    const msg = error.message ?? "Could not release";
    if (/submitted a revision cannot release/i.test(msg)) return fail(403, "The person who submitted a revision cannot release it. Ask another approver");
    if (/Only a revision in review/i.test(msg)) return fail(409, "Only a revision in review can be released");
    if (error.code === "23505") return fail(409, "Another revision was released at the same moment. Reload and look again");
    return fail(500, msg);
  }
  const result = (data ?? {}) as { superseded_id?: string | null };
  const fresh = await loadRevision(ctx.admin, ctx.tenantId, drawing.id, rev.id);
  const fromRev = result.superseded_id ? await loadRevision(ctx.admin, ctx.tenantId, drawing.id, result.superseded_id) : null;
  await logDrawing(ctx, drawing, "update", [{ field: `Revision ${rev.rev_label} released`, from: fromRev ? `Revision ${fromRev.rev_label}` : null, to: `Revision ${rev.rev_label}` }]);
  return { ok: true, revision: fresh ?? rev, supersededId: result.superseded_id ?? null };
}

// ── Delete / archive ───────────────────────────────────────────────────────────────────────────────────────────────

/** A draft with no history can be deleted (and its file removed); a revision that left draft never is. */
export async function deleteDraftRevision(ctx: DrawingCtx, drawing: DrawingRow, rev: RevisionRow): Promise<Out<unknown>> {
  if (rev.status !== "draft" || rev.submitted_at) return fail(409, "Only a draft that was never submitted can be deleted");
  const { rows } = await loadRevisions(ctx.admin, ctx.tenantId, drawing.id);
  if (rows.length <= 1) return fail(409, "A drawing keeps at least its first revision. Delete the drawing instead");
  if (rev.file_path) await ctx.admin.storage.from(DRAWING_BUCKET_NAME).remove([rev.file_path]);
  const { error } = await ctx.admin.from("drawing_revisions").delete().eq("id", rev.id).eq("drawing_id", drawing.id).eq("tenant_id", ctx.tenantId).eq("status", "draft");
  if (error) return fail(500, error.message);
  await logDrawing(ctx, drawing, "update", [{ field: "Draft deleted", from: `Revision ${rev.rev_label}`, to: null }]);
  return { ok: true };
}

/** Deleting a drawing is refused once any revision left draft: the record is evidence (release is archived, never removed). */
export async function deleteDrawing(ctx: DrawingCtx, drawing: DrawingRow): Promise<Out<unknown>> {
  const { rows } = await loadRevisions(ctx.admin, ctx.tenantId, drawing.id);
  if (rows.some((r) => r.status !== "draft" || r.submitted_at)) return fail(409, "This drawing has been submitted or released, so it cannot be deleted. Archive it instead");
  const paths = rows.map((r) => r.file_path).filter((p): p is string => !!p);
  if (paths.length) await ctx.admin.storage.from(DRAWING_BUCKET_NAME).remove(paths);
  const { error } = await ctx.admin.from("drawings").delete().eq("id", drawing.id).eq("tenant_id", ctx.tenantId);
  if (error) return fail(500, error.message);
  await logDrawing(ctx, drawing, "delete");
  return { ok: true };
}

