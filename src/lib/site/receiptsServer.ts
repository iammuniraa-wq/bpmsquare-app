import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthUser } from "@/lib/supabase-server";
import { diffForLog, logChange } from "@/lib/changeLog";
import { insertWithMasterRef } from "@/lib/masterRef";
import { cfOnly } from "@/lib/customData";
import { loadRevisions, currentRevision } from "@/lib/contractProjects/server";
import { loadPackageLines, loadPackageRows, loadRounds } from "@/lib/contractProjects/buyout/server";
import { acceptedByLine, cleanReceiptInput, discrepancyLines, hasDiscrepancy, receiptOutcome, receivedValueByPackage, summarise, type PackageReceived } from "./receiptRules";
import { reasonProblem } from "./expenseRules";
import { isUuid, type SiteReceipt, type SiteReceiptLine } from "./types";
import {
  anyProject, checkFiles, foreignLineKeys, isMissingSchema, loadActorNames, needsUpdate, notifyPeople, projectForSite, readSiteBody, storeEvidence,
  type SiteCtx, type SiteProject,
} from "./server";
import { loadViewerScope, isDeciderOn, type Result } from "./expensesServer";

// The site receipt, server side: create (idempotent on the phone's client id), the list, cancel with a reason, and what has arrived per
// buy-out package. A receipt is evidence and creates no cost. Every query is tenant-scoped on the admin client; the tables have a
// SELECT-only policy, so no write can come from anywhere else (MULTI_TENANT_GUARDRAILS.md).

export const RECEIPT_COLS = "id, ref, project_id, client_id, status, package_id, delivery_note_ref, source_type, source_id, received_at, received_by, handed_by, vehicle, note, outcome, cancel_reason, cancelled_by, cancelled_at, erp_ref, erp_state, custom_data, created_at, updated_at";
export const LINE_COLS = "id, receipt_id, line_no, line_key, element_code, building, description, uom, qty_expected, qty_received, qty_accepted, qty_rejected, condition, reason_code, note";

const fail = (status: number, error: string, extra: Record<string, unknown> = {}): Result => ({ status, body: { error, ...extra } });
const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export const normaliseReceipt = (r: Record<string, unknown>): SiteReceipt => ({ ...(r as unknown as SiteReceipt), erp_state: (r.erp_state as SiteReceipt["erp_state"]) ?? "not_sent" });
export const normaliseReceiptLine = (r: Record<string, unknown>): SiteReceiptLine => ({
  ...(r as unknown as SiteReceiptLine), line_no: Number(r.line_no ?? 0), qty_expected: n(r.qty_expected), qty_received: Number(r.qty_received ?? 0), qty_accepted: Number(r.qty_accepted ?? 0), qty_rejected: Number(r.qty_rejected ?? 0),
});

export async function loadReceipt(admin: SupabaseClient, tenantId: string, id: string): Promise<{ receipt: SiteReceipt; lines: SiteReceiptLine[] } | null | "pending"> {
  if (!isUuid(id)) return null;
  const { data, error } = await admin.from("site_receipts").select(RECEIPT_COLS).eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (error) return isMissingSchema(error) ? "pending" : null;
  if (!data) return null;
  const { data: lines } = await admin.from("site_receipt_lines").select(LINE_COLS).eq("tenant_id", tenantId).eq("receipt_id", id).order("line_no", { ascending: true }).limit(500);
  return { receipt: normaliseReceipt(data as Record<string, unknown>), lines: ((lines ?? []) as Record<string, unknown>[]).map(normaliseReceiptLine) };
}

// ── Create ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/site-receipts. One request holds the count, the photos and the signature, so a queued capture is one atomic upload.
 * Idempotent on `client_id`. The project, package and line keys are verified against THIS workspace; the outcome is computed here from the
 * lines, never read from the body, and the received time is the capture time the phone stamped (within a week, never in the future).
 */
export async function createReceipt(req: SiteCtx, request: Request): Promise<Result> {
  const { body, files, signature } = await readSiteBody(request);
  if (isUuid(body.client_id)) {
    const { data: prior, error } = await req.admin.from("site_receipts").select(RECEIPT_COLS).eq("tenant_id", req.tenantId).eq("client_id", body.client_id).maybeSingle();
    if (error && isMissingSchema(error)) return fail(503, needsUpdate("site_receipts").error, needsUpdate("site_receipts").extra);
    if (prior) {
      return (prior as { received_by: string }).received_by === req.userId
        ? { status: 200, body: { receipt: normaliseReceipt(prior as Record<string, unknown>), duplicate_request: true } }
        : fail(409, "That capture id is already used");
    }
  }
  const project = typeof body.project_id === "string" ? await projectForSite(req.admin, req.tenantId, body.project_id) : null;
  if (!project) return fail(422, "Choose an active project that takes site entries");
  const cleaned = cleanReceiptInput(body, { now: new Date() });
  if (!cleaned.ok) return fail(422, cleaned.error);
  const v = cleaned.value;

  if (v.package_id) {
    const { data: pkg, error } = await req.admin.from("project_buyout_packages").select("id").eq("id", v.package_id).eq("tenant_id", req.tenantId).eq("project_id", project.id).maybeSingle();
    if (error || !pkg) return fail(422, "That package is not on this project");
  }
  const foreign = await foreignLineKeys(req.admin, req.tenantId, project.id, v.lines.map((l) => l.line_key).filter((k): k is string => !!k));
  if (foreign.length > 0) return fail(422, "An item points at a budget line that is not on this project");

  const checked = await checkFiles(files, signature);
  if (!checked.ok) return fail(422, checked.error);
  const needsEvidence = v.lines.some((l) => l.qty_rejected > 0 || l.condition !== "ok");
  if (needsEvidence && !checked.items.some((i) => i.kind === "photo")) return fail(422, "Add a photo of the rejected or damaged pieces");

  const outcome = receiptOutcome(v.lines);
  const made = await insertWithMasterRef<Record<string, unknown>>(req.admin, "site_receipts", req.tenantId, {
    tenant_id: req.tenantId, project_id: project.id, client_id: v.client_id, status: "confirmed", package_id: v.package_id, delivery_note_ref: v.delivery_note_ref,
    source_type: v.source_type, source_id: v.source_id, received_at: v.received_at, received_by: req.userId, handed_by: v.handed_by, vehicle: v.vehicle, note: v.note, outcome, erp_state: "not_sent",
  }, RECEIPT_COLS);
  if (made.error || !made.data) {
    if (isMissingSchema(made.error)) return fail(503, needsUpdate("site_receipts").error, needsUpdate("site_receipts").extra);
    if (made.error?.code === "23505") {
      const { data: again } = await req.admin.from("site_receipts").select(RECEIPT_COLS).eq("tenant_id", req.tenantId).eq("client_id", v.client_id).maybeSingle();
      if (again && (again as { received_by: string }).received_by === req.userId) return { status: 200, body: { receipt: normaliseReceipt(again as Record<string, unknown>), duplicate_request: true } };
    }
    return fail(500, made.error?.message ?? "Could not save the receipt");
  }
  const receipt = normaliseReceipt(made.data);
  const lineRows = v.lines.map((l, i) => ({ tenant_id: req.tenantId, receipt_id: receipt.id, line_no: i + 1, ...l }));
  const ins = await req.admin.from("site_receipt_lines").insert(lineRows);
  if (ins.error) {
    await req.admin.from("site_receipts").delete().eq("id", receipt.id).eq("tenant_id", req.tenantId);
    return fail(500, "The items could not be saved. Try again");
  }
  const stored = await storeEvidence(req.admin, { tenantId: req.tenantId, userId: req.userId, objectType: "site_receipt", objectId: receipt.id, items: checked.items });
  if (!stored.ok) {
    await req.admin.from("site_receipts").delete().eq("id", receipt.id).eq("tenant_id", req.tenantId);
    return fail(500, stored.error);
  }

  const sum = summarise(v.lines);
  const user = await getAuthUser();
  await logChange(req.supabase, {
    tenantId: req.tenantId, objectType: "site_receipts", objectId: receipt.id, objectLabel: `${receipt.ref ?? ""} ${v.delivery_note_ref ?? ""}`.trim(), action: "create", actorId: user?.id, actorEmail: user?.email,
    changes: diffForLog("site_receipts", {}, { project: `${project.ref ?? ""} ${project.name}`.trim(), delivery_note: v.delivery_note_ref, outcome, accepted: sum.accepted, rejected: sum.rejected, short: sum.short, photos: stored.stored.length }),
  });
  if (hasDiscrepancy(v.lines)) {
    const names = await loadActorNames(req.admin, req.tenantId, [req.userId]);
    const who = names.get(req.userId) ?? user?.email ?? "A colleague";
    const problems = discrepancyLines(v.lines);
    await notifyPeople(req, {
      projectId: project.id, projectLabel: `${project.ref ?? ""} ${project.name}`.trim(),
      recipients: [project.manager_id, ...req.config.notify_receipts].filter((x): x is string => !!x),
      subject: `Delivery received with a problem: ${receipt.ref ?? ""} ${v.delivery_note_ref ?? ""}`.trim().slice(0, 200),
      text: `${who} confirmed a delivery on "${project.name}" (${outcome}).\n${problems.slice(0, 20).map((p) => `- ${p}`).join("\n")}`,
      comment: `Delivery ${receipt.ref ?? ""} ${outcome}: ${problems.slice(0, 3).join("; ")}`.slice(0, 600), actorEmail: user?.email ?? null,
    });
  }
  return { status: 201, body: { receipt, lines: lineRows.length } };
}

// ── Cancel, and custom fields ──────────────────────────────────────────────────────────────────────────────────────

/** A manager (the project manager, a cost approver or an admin) cancels a confirmed receipt with a reason; the site person then enters it again. */
export async function cancelReceipt(req: SiteCtx, id: string, body: Record<string, unknown>): Promise<Result> {
  const found = await loadReceipt(req.admin, req.tenantId, id);
  if (found === "pending") return fail(503, needsUpdate("site_receipts").error, needsUpdate("site_receipts").extra);
  if (!found) return fail(404, "Not found");
  const { receipt } = found;
  const scope = await loadViewerScope(req);
  if (!isDeciderOn(scope, receipt.project_id)) return fail(403, "Only the project manager or a cost approver can cancel a receipt");
  if (receipt.status !== "confirmed") return fail(409, "It is already cancelled");
  const problem = reasonProblem(body.reason);
  if (problem) return fail(422, problem);
  const reason = String(body.reason).trim().slice(0, 1000);
  const upd = await req.admin.from("site_receipts").update({ status: "cancelled", cancel_reason: reason, cancelled_by: req.userId, cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id).eq("tenant_id", req.tenantId).eq("status", "confirmed").select(RECEIPT_COLS);
  if (upd.error) return fail(500, upd.error.message);
  const done = ((upd.data ?? []) as Record<string, unknown>[])[0];
  if (!done) return fail(409, "It changed while you were cancelling. Reload");
  const user = await getAuthUser();
  await logChange(req.supabase, { tenantId: req.tenantId, objectType: "site_receipts", objectId: id, objectLabel: receipt.ref, action: "update", actorId: user?.id, actorEmail: user?.email, changes: [{ field: "Cancelled", from: "Confirmed", to: reason }] });
  const project = await anyProject(req.admin, req.tenantId, receipt.project_id);
  if (project && receipt.received_by !== req.userId) {
    await notifyPeople(req, { projectId: project.id, projectLabel: `${project.ref ?? ""} ${project.name}`.trim(), recipients: [receipt.received_by], subject: `Receipt cancelled: ${receipt.ref ?? ""}`, text: `Your receipt ${receipt.ref ?? ""} was cancelled: ${reason}\nPlease enter the delivery again.`, comment: `Receipt ${receipt.ref ?? ""} cancelled: ${reason}`.slice(0, 600), actorEmail: user?.email ?? null });
  }
  return { status: 200, body: { receipt: normaliseReceipt(done) } };
}

/** PATCH: custom fields only (cf_ keys), by the receiver or a manager. A confirmed receipt's count, photos and time are never edited. */
export async function patchReceipt(req: SiteCtx, id: string, body: Record<string, unknown>): Promise<Result> {
  const found = await loadReceipt(req.admin, req.tenantId, id);
  if (found === "pending") return fail(503, needsUpdate("site_receipts").error, needsUpdate("site_receipts").extra);
  if (!found) return fail(404, "Not found");
  const { receipt } = found;
  const scope = await loadViewerScope(req);
  if (receipt.received_by !== req.userId && !isDeciderOn(scope, receipt.project_id)) return fail(403, "You cannot change this receipt");
  if (!("custom_data" in body)) return fail(400, "Nothing to change");
  if (receipt.status !== "confirmed") return fail(409, "A cancelled receipt is not changed");
  const custom = { ...(receipt.custom_data ?? {}), ...(cfOnly(body.custom_data) ?? {}) };
  const upd = await req.admin.from("site_receipts").update({ custom_data: custom, updated_at: new Date().toISOString() }).eq("id", id).eq("tenant_id", req.tenantId).select(RECEIPT_COLS);
  if (upd.error) return fail(500, upd.error.message);
  const user = await getAuthUser();
  const changes = diffForLog("site_receipts", { custom_data: receipt.custom_data }, { custom_data: custom });
  if (changes.length > 0) await logChange(req.supabase, { tenantId: req.tenantId, objectType: "site_receipts", objectId: id, objectLabel: receipt.ref, action: "update", actorId: user?.id, actorEmail: user?.email, changes });
  return { status: 200, body: { receipt: normaliseReceipt(((upd.data ?? []) as Record<string, unknown>[])[0] ?? {}) } };
}

// ── Lists, expected deliveries, received value ─────────────────────────────────────────────────────────────────────

export type ReceiptListRow = SiteReceipt & { project_ref: string | null; project_name: string; received_by_name: string | null; lines: number; accepted: number; rejected: number };

export async function listReceipts(req: SiteCtx, f: { projectId?: string | null; limit?: number } = {}): Promise<{ rows: ReceiptListRow[]; pending: boolean }> {
  let q = req.admin.from("site_receipts").select(RECEIPT_COLS).eq("tenant_id", req.tenantId);
  if (f.projectId && isUuid(f.projectId)) q = q.eq("project_id", f.projectId);
  const { data, error } = await q.order("received_at", { ascending: false }).limit(Math.min(f.limit ?? 300, 1000));
  if (error) return { rows: [], pending: isMissingSchema(error) };
  const list = ((data ?? []) as Record<string, unknown>[]).map(normaliseReceipt);
  const ids = list.map((r) => r.id);
  const projectIds = [...new Set(list.map((r) => r.project_id))];
  const [projects, lines, names] = await Promise.all([
    projectIds.length ? req.admin.from("contract_projects").select("id, ref, name").eq("tenant_id", req.tenantId).in("id", projectIds) : Promise.resolve({ data: [] }),
    ids.length ? req.admin.from("site_receipt_lines").select("receipt_id, qty_accepted, qty_rejected").eq("tenant_id", req.tenantId).in("receipt_id", ids).limit(20000) : Promise.resolve({ data: [] }),
    loadActorNames(req.admin, req.tenantId, list.map((r) => r.received_by)),
  ]);
  const pm = new Map(((projects.data ?? []) as { id: string; ref: string | null; name: string }[]).map((p) => [p.id, p]));
  const agg = new Map<string, { lines: number; accepted: number; rejected: number }>();
  for (const l of (lines.data ?? []) as { receipt_id: string; qty_accepted: number; qty_rejected: number }[]) {
    const a = agg.get(l.receipt_id) ?? { lines: 0, accepted: 0, rejected: 0 };
    a.lines++; a.accepted += Number(l.qty_accepted); a.rejected += Number(l.qty_rejected);
    agg.set(l.receipt_id, a);
  }
  return {
    pending: false,
    rows: list.map((r) => ({ ...r, project_ref: pm.get(r.project_id)?.ref ?? null, project_name: pm.get(r.project_id)?.name ?? "Project", received_by_name: names.get(r.received_by) ?? null, ...(agg.get(r.id) ?? { lines: 0, accepted: 0, rejected: 0 }) })),
  };
}

export type ExpectedItem = { line_key: string; description: string; uom: string | null; qty_expected: number | null; building: string | null };
export type ExpectedDelivery = { package_id: string; ref: string | null; name: string; status: string; supplier_name: string | null; items: ExpectedItem[] };

/**
 * The deliveries a site person can pick from (design 3, step 1): the awarded or handed-over buy-out packages of the project, each item with the
 * quantity still to come. Quantities only: no rate, no amount (a site person never sees budget figures). A project with no buy-out (a
 * workspace without the tender edition, or nothing awarded yet) simply has none, and the person picks "Something else".
 */
export async function loadExpectedDeliveries(admin: SupabaseClient, tenantId: string, projectId: string): Promise<ExpectedDelivery[]> {
  const { rows: packages } = await loadPackageRows(admin, tenantId, projectId);
  const awarded = packages.filter((p) => p.status === "awarded" || p.status === "handed_over");
  if (awarded.length === 0) return [];
  const [pkgLines, revisions, received] = await Promise.all([loadPackageLines(admin, tenantId, projectId), loadRevisions(admin, tenantId, projectId), acceptedForProject(admin, tenantId, projectId)]);
  const revision = revisions.rows.filter((r) => r.status === "approved").sort((a, b) => b.rev_no - a.rev_no)[0] ?? currentRevision(revisions.rows);
  const lineInfo = new Map<string, { description: string; unit: string | null; qty: number }>();
  if (revision) {
    const { data } = await admin.from("project_budget_lines").select("line_key, description, unit, qty").eq("tenant_id", tenantId).eq("revision_id", revision.id).limit(5000);
    for (const l of (data ?? []) as { line_key: string; description: string; unit: string | null; qty: number }[]) lineInfo.set(l.line_key, { description: l.description, unit: l.unit, qty: Number(l.qty) });
  }
  const supplierIds = [...new Set(awarded.map((p) => p.awarded_supplier_id).filter((x): x is string => !!x))];
  const supplierNames = new Map<string, string>();
  if (supplierIds.length) {
    const { data } = await admin.from("suppliers").select("id, name").eq("tenant_id", tenantId).in("id", supplierIds);
    for (const s of (data ?? []) as { id: string; name: string }[]) supplierNames.set(s.id, s.name);
  }
  return awarded.map((p) => ({
    package_id: p.id, ref: p.ref, name: p.name, status: p.status, supplier_name: p.awarded_supplier_id ? supplierNames.get(p.awarded_supplier_id) ?? null : null,
    items: pkgLines.filter((l) => l.package_id === p.id).map((l) => {
      const info = lineInfo.get(l.line_key);
      const left = info ? Math.max(0, Math.round((info.qty - (received.get(l.line_key) ?? 0)) * 1000) / 1000) : null;
      return { line_key: l.line_key, description: info?.description ?? "Item", uom: info?.unit ?? null, qty_expected: left, building: null };
    }),
  }));
}

/** Accepted quantity per budget line over every confirmed receipt of the project. */
export async function acceptedForProject(admin: SupabaseClient, tenantId: string, projectId: string): Promise<Map<string, number>> {
  const { data: receipts, error } = await admin.from("site_receipts").select("id, status").eq("tenant_id", tenantId).eq("project_id", projectId).eq("status", "confirmed").limit(5000);
  if (error || !receipts) return new Map();
  const ids = (receipts as { id: string }[]).map((r) => r.id);
  const rows: { receipt_id: string; line_key: string | null; qty_accepted: number }[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await admin.from("site_receipt_lines").select("receipt_id, line_key, qty_accepted").eq("tenant_id", tenantId).in("receipt_id", ids.slice(i, i + 100)).limit(20000);
    rows.push(...((data ?? []) as { receipt_id: string; line_key: string | null; qty_accepted: number }[]));
  }
  return acceptedByLine((receipts as { id: string; status: string }[]).map((r) => ({ status: r.status, lines: rows.filter((l) => l.receipt_id === r.id) })));
}

export type PackageReceivedRow = PackageReceived & { ref: string | null; name: string; supplier_name: string | null; currency: string | null };

/**
 * Per buy-out package: what was awarded, the value received on site (accepted quantity times the awarded rate of each line) and what is
 * still to receive. Money, so only for the people who manage the project; named "Received on site", never progress or installed.
 */
export async function loadReceivedValues(admin: SupabaseClient, tenantId: string, projectId: string): Promise<PackageReceivedRow[]> {
  const { rows: packages } = await loadPackageRows(admin, tenantId, projectId);
  const awarded = packages.filter((p) => (p.status === "awarded" || p.status === "handed_over") && p.awarded_rfq_id);
  if (awarded.length === 0) return [];
  const [pkgLines, rounds, accepted] = await Promise.all([loadPackageLines(admin, tenantId, projectId), loadRounds(admin, tenantId, awarded.map((p) => p.id)), acceptedForProject(admin, tenantId, projectId)]);
  const supplierIds = [...new Set(awarded.map((p) => p.awarded_supplier_id).filter((x): x is string => !!x))];
  const supplierNames = new Map<string, string>();
  if (supplierIds.length) {
    const { data } = await admin.from("suppliers").select("id, name").eq("tenant_id", tenantId).in("id", supplierIds);
    for (const s of (data ?? []) as { id: string; name: string }[]) supplierNames.set(s.id, s.name);
  }
  const inputs = awarded.map((p) => {
    const round = (rounds.get(p.id) ?? []).find((r) => r.head.id === p.awarded_rfq_id);
    const lines: { line_key: string; qty: number; unit_cost: number }[] = [];
    for (const l of round?.lines ?? []) {
      const key = l.package_line_id ? pkgLines.find((x) => x.id === l.package_line_id)?.line_key : undefined;
      if (!key || l.status !== "awarded" || l.awarded_unit_cost === null) continue;
      lines.push({ line_key: key, qty: l.qty ?? 0, unit_cost: l.awarded_unit_cost });
    }
    return { package_id: p.id, committed: p.committed_amount ?? lines.reduce((s, l) => s + l.qty * l.unit_cost, 0), lines };
  });
  const values = receivedValueByPackage(inputs, accepted);
  return values.map((v) => {
    const p = awarded.find((x) => x.id === v.package_id)!;
    return { ...v, ref: p.ref, name: p.name, supplier_name: p.awarded_supplier_id ? supplierNames.get(p.awarded_supplier_id) ?? null : null, currency: p.currency };
  });
}

export type { SiteProject };
