import "server-only";
import { logChange } from "@/lib/changeLog";
import { insertWithMasterRef } from "@/lib/masterRef";
import { getAuthUser } from "@/lib/supabase-server";
import { getTenant } from "@/lib/tenant";
import { AwardError, awardWithDecision, loadCurrentAwards } from "@/lib/rfq/awards";
import { createRfq, loadRfqBundle, renderRfqPdf, sendToSupplier } from "@/lib/rfq/server";
import { splitReachable, unreachableMessage } from "@/lib/rfq/reach";
import { rfqConfig, type Rfq } from "@/lib/rfq/types";
import { assertTenderSuppliersAllowed } from "@/lib/supplierGroups/server";
import {
  PACKAGE_LIMITS, PACKAGE_LINE_REASON, awardProblem, canDownloadHandover, cleanPackageReason, deleteProblem, isUuid, lineQty, linesLocked, markSentProblem,
  packageAwardDecision, roundMoney, roundOriginLabel, roundProblem, roundTitle, unawardProblem,
  type PackageInput, type PackageRow, type RoundInput,
} from "./rules";
import {
  PACKAGE_COLS, currentRound, isMissingSchema, loadBaseline, loadPackageLines, loadPackageRows, loadWorld, needsBuyoutUpdate, packageRowAfter, packageRowFor, workRounds,
  type BuyoutCtx, type Failure, type PackageDbRow, type World,
} from "./server";
import { buildPackageHandoverWorkbook, handoverFileName, type PackageHandoverInput } from "./handover";

// The writes of the Buy-out tab (docs/design/contract-buyout.md). Every id from a request is verified against the workspace AND this project
// first; every write chains the tenant; nothing is hard-deleted that the record needs (rounds and RFQ awards stay); the award goes through the
// RFQ module's own award code so the two never disagree.

type Result<T> = ({ ok: true } & T) | ({ ok: false } & Failure);
const fail = (status: number, error: string, extra?: Record<string, unknown>): { ok: false } & Failure => ({ ok: false, status, error, ...(extra ? { extra } : {}) });

const labelOf = (p: { ref: string | null; name: string }) => `${p.ref ?? ""} ${p.name}`.trim();
const pkgLabel = (p: { ref: string | null; name: string }) => `${p.ref ?? "Package"} ${p.name}`.trim();

/** Package changes are logged on the PROJECT (its history tab and the Contract projects filter), like variations and milestones. */
async function logProject(req: BuyoutCtx, changes: { field: string; from: unknown; to: unknown }[]) {
  if (changes.length === 0) return;
  const user = await getAuthUser();
  await logChange(req.admin, {
    tenantId: req.tenantId, objectType: "contract_projects", objectId: req.project.id, objectLabel: labelOf(req.project), action: "update",
    actorId: user?.id ?? req.userId, actorEmail: user?.email, changes,
  });
}

// ── Packages ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The approved budget lines of `ids`, or the reason they cannot go in a package. */
async function resolveBudgetLines(req: BuyoutCtx, ids: readonly string[], ownPackageId: string | null): Promise<Result<{ lines: { id: string; line_key: string; line_no: number; description: string }[] }>> {
  const base = await loadBaseline(req.admin, req.tenantId, req.project.id);
  if (!base.approved) return fail(409, "Approve the baseline budget first. Packages are made from the approved budget.", { code: "no_baseline" });
  const byId = new Map(base.lines.map((l) => [l.id.toLowerCase(), l]));
  const missing = ids.filter((id) => !byId.has(id.toLowerCase()));
  if (missing.length > 0) return fail(422, "A budget line was not found in the approved budget of this project.", { code: "line_not_found", budget_line_ids: missing });
  const chosen = ids.map((id) => byId.get(id.toLowerCase())!);
  const reserve = chosen.filter((l) => l.reserve);
  if (reserve.length > 0) return fail(422, `A reserve line cannot be bought out: ${reserve.slice(0, 3).map((l) => l.description).join(", ")}.`, { code: "reserve_line" });
  const existing = await loadPackageLines(req.admin, req.tenantId, req.project.id);
  const taken = chosen.filter((l) => existing.some((e) => e.line_key === l.line_key && e.package_id !== ownPackageId));
  if (taken.length > 0) return fail(409, `Already in another package: ${taken.slice(0, 3).map((l) => l.description).join(", ")}${taken.length > 3 ? ` and ${taken.length - 3} more` : ""}.`, { code: "line_taken", budget_line_ids: taken.map((l) => l.id) });
  return { ok: true, lines: chosen.map((l) => ({ id: l.id, line_key: l.line_key, line_no: l.line_no, description: l.description })) };
}

export async function createPackage(req: BuyoutCtx, input: PackageInput): Promise<Result<{ row: PackageRow }>> {
  const { admin, tenantId, project } = req;
  const probe = await loadPackageRows(admin, tenantId, project.id);
  if (probe.pending) return fail(503, needsBuyoutUpdate().error, needsBuyoutUpdate().extra);
  const count = await admin.from("project_buyout_packages").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("project_id", project.id);
  if ((count.count ?? 0) >= PACKAGE_LIMITS.maxPackages) return fail(409, `A project holds up to ${PACKAGE_LIMITS.maxPackages} packages.`);
  const picked = await resolveBudgetLines(req, input.budget_line_ids ?? [], null);
  if (!picked.ok) return picked;

  const made = await insertWithMasterRef<Record<string, unknown>>(admin, "project_buyout_packages", tenantId, {
    tenant_id: tenantId, project_id: project.id, name: input.name, kind: input.kind ?? "supplier", status: "draft", note: input.note ?? null, currency: project.currency, created_by: req.userId,
  }, PACKAGE_COLS);
  if (made.error || !made.data) {
    if (isMissingSchema(made.error)) return fail(503, needsBuyoutUpdate().error, needsBuyoutUpdate().extra);
    return fail(500, made.error?.message ?? "Could not save the package");
  }
  const pkgId = made.data.id as string;
  const ordered = [...picked.lines].sort((a, b) => a.line_no - b.line_no);
  const ins = await admin.from("project_buyout_package_lines").insert(ordered.map((l, i) => ({
    tenant_id: tenantId, project_id: project.id, package_id: pkgId, budget_line_id: l.id, line_key: l.line_key, sort_order: i + 1,
  })));
  if (ins.error) {
    await admin.from("project_buyout_packages").delete().eq("id", pkgId).eq("tenant_id", tenantId);
    if (ins.error.code === "23505") return fail(409, "One of those budget lines was just put in another package. Reload and choose again.", { code: "line_taken" });
    return fail(500, ins.error.message);
  }
  const row = await packageRowAfter(req, pkgId);
  await logProject(req, [{ field: `Package ${made.data.ref ?? ""} added`.replace("  ", " "), from: null, to: `${input.name}, ${ordered.length} line${ordered.length === 1 ? "" : "s"}` }]);
  return { ok: true, row: row! };
}

export async function updatePackage(req: BuyoutCtx, pkg: PackageDbRow, input: PackageInput): Promise<Result<{ row: PackageRow }>> {
  const { admin, tenantId, project } = req;
  if (pkg.status === "handed_over") return fail(409, "This package was handed over. It can no longer be changed.", { code: "handed_over" });
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const changes: { field: string; from: unknown; to: unknown }[] = [];
  if (input.name !== undefined && input.name !== pkg.name) { patch.name = input.name; changes.push({ field: `Package ${pkg.ref ?? ""} name`.replace("  ", " "), from: pkg.name, to: input.name }); }
  if (input.kind !== undefined && input.kind !== pkg.kind) { patch.kind = input.kind; changes.push({ field: `Package ${pkg.ref ?? ""} kind`.replace("  ", " "), from: pkg.kind, to: input.kind }); }
  if (input.note !== undefined && (input.note ?? null) !== (pkg.note ?? null)) { patch.note = input.note ?? null; changes.push({ field: `Package ${pkg.ref ?? ""} note`.replace("  ", " "), from: pkg.note, to: input.note ?? null }); }

  if (input.budget_line_ids !== undefined) {
    const world = await loadWorld(req, { roundsFor: [pkg.id] });
    if ("pending" in world) return fail(503, needsBuyoutUpdate().error, needsBuyoutUpdate().extra);
    const rounds = world.rounds.get(pkg.id)?.length ?? 0;
    const mine = world.pkgLines.filter((l) => l.package_id === pkg.id);
    const base = world.baseline;
    const wantedKeys = new Set(input.budget_line_ids.map((id) => base.lines.find((l) => l.id.toLowerCase() === id.toLowerCase())?.line_key).filter((k): k is string => !!k));
    const same = wantedKeys.size === mine.length && mine.every((l) => wantedKeys.has(l.line_key));
    if (!same) {
      if (linesLocked({ status: pkg.status, rounds })) return fail(409, rounds > 0 ? "A round was already sent, so the lines are fixed. Start a new package for other lines." : "This package is awarded. Un-award it to change its lines.", { code: "lines_locked" });
      if (input.budget_line_ids.length === 0) return fail(422, "A package needs at least one line. Delete the package instead.");
      const picked = await resolveBudgetLines(req, input.budget_line_ids, pkg.id);
      if (!picked.ok) return picked;
      const keep = new Set(picked.lines.map((l) => l.line_key));
      const drop = mine.filter((l) => !keep.has(l.line_key));
      const add = picked.lines.filter((l) => !mine.some((m) => m.line_key === l.line_key)).sort((a, b) => a.line_no - b.line_no);
      if (add.length > 0) {
        const ins = await admin.from("project_buyout_package_lines").insert(add.map((l, i) => ({
          tenant_id: tenantId, project_id: project.id, package_id: pkg.id, budget_line_id: l.id, line_key: l.line_key, sort_order: 10_000 + i,
        })));
        if (ins.error) return ins.error.code === "23505" ? fail(409, "One of those budget lines was just put in another package. Reload and choose again.", { code: "line_taken" }) : fail(500, ins.error.message);
      }
      if (drop.length > 0) {
        const del = await admin.from("project_buyout_package_lines").delete().eq("tenant_id", tenantId).eq("project_id", project.id).eq("package_id", pkg.id).in("id", drop.map((l) => l.id));
        if (del.error) return fail(500, del.error.message);
      }
      // Renumber in the budget's order so the RFQ lines of a later round read like the budget.
      const order = [...picked.lines].sort((a, b) => a.line_no - b.line_no);
      const now = await loadPackageLines(admin, tenantId, project.id);
      for (const [i, l] of order.entries()) {
        const row = now.find((x) => x.package_id === pkg.id && x.line_key === l.line_key);
        if (row) await admin.from("project_buyout_package_lines").update({ sort_order: i + 1 }).eq("id", row.id).eq("tenant_id", tenantId).eq("package_id", pkg.id);
      }
      changes.push({ field: `Package ${pkg.ref ?? ""} lines`.replace("  ", " "), from: mine.length, to: order.length });
    }
  }

  if (Object.keys(patch).length > 1) {
    const up = await admin.from("project_buyout_packages").update(patch).eq("id", pkg.id).eq("tenant_id", tenantId).eq("project_id", project.id).select("id");
    if (up.error) return fail(isMissingSchema(up.error) ? 503 : 500, up.error.message);
    if ((up.data ?? []).length === 0) return fail(404, "Not found");
  }
  await logProject(req, changes);
  const row = await packageRowAfter(req, pkg.id);
  return { ok: true, row: row! };
}

export async function deletePackage(req: BuyoutCtx, pkg: PackageDbRow): Promise<Result<object>> {
  const { admin, tenantId, project } = req;
  const world = await loadWorld(req, { roundsFor: [pkg.id] });
  if ("pending" in world) return fail(503, needsBuyoutUpdate().error, needsBuyoutUpdate().extra);
  const p = deleteProblem({ status: pkg.status, rounds: world.rounds.get(pkg.id)?.length ?? 0 });
  if (p) return fail(p.status, p.error, { code: p.code });
  const del = await admin.from("project_buyout_packages").delete().eq("id", pkg.id).eq("tenant_id", tenantId).eq("project_id", project.id).eq("status", "draft");
  if (del.error) return fail(500, del.error.message);
  // The lines go with the package by the foreign key; saying so here keeps the budget lines free even where the cascade is not there.
  await admin.from("project_buyout_package_lines").delete().eq("tenant_id", tenantId).eq("project_id", project.id).eq("package_id", pkg.id);
  await logProject(req, [{ field: `Package ${pkg.ref ?? ""} removed`.replace("  ", " "), from: pkg.name, to: null }]);
  return { ok: true };
}

// ── Rounds ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type RoundSent = { supplier: string; ok: boolean; reason?: string; redirected?: boolean };

/**
 * A new request for quotes for the whole package: one RFQ (a round) holding every line, sent to the chosen suppliers by the RFQ module's own
 * create and send code. Earlier rounds are never touched. The suppliers are held to the client's approved list (422 naming those outside it).
 */
export async function createRound(req: BuyoutCtx, pkg: PackageDbRow, input: RoundInput): Promise<Result<{ rfq_id: string; ref: string; round: number; sent: RoundSent[] }>> {
  const { admin, tenantId, project, userId } = req;
  const world = await loadWorld(req, { roundsFor: [pkg.id] });
  if ("pending" in world) return fail(503, needsBuyoutUpdate().error, needsBuyoutUpdate().extra);
  const mine = world.pkgLines.filter((l) => l.package_id === pkg.id).sort((a, b) => a.sort_order - b.sort_order);
  const rounds = world.rounds.get(pkg.id)?.length ?? 0;
  const stop = roundProblem({ status: pkg.status, line_count: mine.length, rounds });
  if (stop) return fail(stop.status, stop.error, { code: stop.code });

  const tenant = await getTenant();
  if (!tenant || tenant.id !== tenantId) return fail(400, "Workspace not resolved");

  const allowed = await assertTenderSuppliersAllowed(admin, tenantId, { package_id: pkg.id }, input.supplier_ids);
  if (!allowed.ok) return allowed;

  const { data: sups } = await admin.from("suppliers").select("id, name, email, phone, status").eq("tenant_id", tenantId).in("id", input.supplier_ids);
  const found = (sups ?? []) as { id: string; name: string; email: string | null; phone: string | null; status: string }[];
  if (found.length !== input.supplier_ids.length) return fail(404, "A supplier was not found.");
  const inactive = found.filter((s) => s.status === "inactive");
  if (inactive.length > 0) return fail(422, `Inactive supplier: ${inactive.map((s) => s.name).join(", ")}.`, { code: "inactive_supplier" });
  const { reachable, unreachable } = splitReachable(found);
  if (unreachable.length > 0 && reachable.length === 0) {
    return fail(422, unreachableMessage(unreachable, true), { unreachable: unreachable.map((u) => ({ supplier_id: u.id, supplier: u.name, has_phone: !!u.phone?.trim() })) });
  }

  const byKey = new Map(world.baseline.lines.map((l) => [l.line_key, l]));
  const lines = mine.map((l) => byKey.get(l.line_key));
  if (lines.some((l) => !l)) return fail(409, "A budget line of this package is no longer in the approved budget. Fix the package before asking for quotes.", { code: "line_missing" });

  const cfg = rfqConfig(tenant.config?.rfq);
  const user = await getAuthUser();
  const roundNo = rounds + 1;
  let rfq: { id: string; ref: string };
  try {
    rfq = await createRfq({ admin, tenantId, userId, email: user?.email ?? null }, {
      title: roundTitle(pkg, roundNo), origin_type: "manual", respond_by: input.reply_by, currency: project.currency,
      notes_to_supplier: input.note, notes_internal: `Contract buy-out ${pkg.ref ?? ""} for ${labelOf(project)}`.trim(),
      lines: lines.map((l) => ({ description: l!.description, uom: l!.unit, qty: l!.qty })),
      supplier_ids: input.supplier_ids,
    }, cfg);
  } catch (e) {
    const err = e as { status?: number; message?: string };
    return fail(err.status ?? 500, err.message ?? "Could not create the round");
  }

  // Tie the round to the package and each RFQ line to its package line. If any of it fails, the half-made RFQ is removed again.
  const undo = async (status: number, message: string): Promise<{ ok: false } & Failure> => {
    await admin.from("rfqs").delete().eq("id", rfq.id).eq("tenant_id", tenantId);
    return fail(status, message);
  };
  const head = await admin.from("rfqs").update({ package_id: pkg.id, origin_label: roundOriginLabel(project, pkg), updated_at: new Date().toISOString() }).eq("id", rfq.id).eq("tenant_id", tenantId).select("id");
  if (head.error) return undo(isMissingSchema(head.error) ? 503 : 500, isMissingSchema(head.error) ? needsBuyoutUpdate().error : head.error.message);
  const { data: made } = await admin.from("rfq_lines").select("id, sl_no").eq("tenant_id", tenantId).eq("rfq_id", rfq.id);
  const bySl = new Map(((made ?? []) as { id: string; sl_no: number }[]).map((r) => [Number(r.sl_no), r.id]));
  for (const [i, l] of mine.entries()) {
    const rid = bySl.get(i + 1);
    if (!rid) return undo(500, "The round's lines could not be tied to the package");
    const up = await admin.from("rfq_lines").update({ package_line_id: l.id }).eq("id", rid).eq("tenant_id", tenantId).eq("rfq_id", rfq.id);
    if (up.error) return undo(isMissingSchema(up.error) ? 503 : 500, isMissingSchema(up.error) ? needsBuyoutUpdate().error : up.error.message);
  }

  const upPkg = await admin.from("project_buyout_packages").update({ current_rfq_id: rfq.id, status: "out", updated_at: new Date().toISOString() })
    .eq("id", pkg.id).eq("tenant_id", tenantId).eq("project_id", project.id).select("id");
  if (upPkg.error || (upPkg.data ?? []).length === 0) return undo(500, upPkg.error?.message ?? "The package changed while the round was made. Reload and try again");

  const sent: RoundSent[] = [];
  const bundle = await loadRfqBundle(admin, tenantId, rfq.id, { messages: false });
  if (bundle) {
    const pdf = bundle.suppliers.length && cfg.attach_pdf ? await renderRfqPdf(admin, tenant, bundle) : null;
    for (const rs of bundle.suppliers) {
      const r = await sendToSupplier(admin, { tenant, bundle, rs, kind: "request", pdf, message: input.note, actor: { id: userId, email: user?.email ?? null } });
      sent.push({ supplier: rs.suppliers?.name ?? "", ok: r.ok, ...(r.ok ? { redirected: r.redirected } : { reason: r.reason }) });
    }
  }
  await logProject(req, [{ field: `Package ${pkg.ref ?? ""} round ${roundNo} sent`.replace("  ", " "), from: null, to: `${rfq.ref} to ${found.map((s) => s.name).join(", ")}`.slice(0, 900) }]);
  return { ok: true, rfq_id: rfq.id, ref: rfq.ref, round: roundNo, sent };
}

// ── Award and un-award ─────────────────────────────────────────────────────────────────────────────────────────────────

export type AwardBody = { rfq_id?: unknown; supplier_id?: unknown; reason?: unknown };

/** Puts back the awards a failed package award had already written, and only those (a line awarded to some other answer is left alone). */
async function releaseLines(req: BuyoutCtx, rfq: Rfq, ctx: { tenantId: string; userId: string; email: string | null }, responseIds: ReadonlySet<string>, staleDays: number) {
  const cur = await loadCurrentAwards(req.admin, req.tenantId, rfq.id).catch(() => ({ rows: [], pending: true }));
  const lineIds = cur.rows.filter((a) => responseIds.has(a.response_id)).map((a) => a.rfq_line_id);
  if (lineIds.length === 0) return;
  await awardWithDecision(req.admin, ctx, { rfq, targets: lineIds.map((lineId) => ({ lineId, responseId: null })), reason: null, replace: true, staleDays }).catch(() => undefined);
}

export async function awardPackage(req: BuyoutCtx, pkg: PackageDbRow, body: AwardBody): Promise<Result<{ row: PackageRow; warnings: string[] }>> {
  const { admin, tenantId, project, userId } = req;
  if (!req.rfqEdit) return fail(403, "Awarding needs the RFQ module and permission to edit RFQs");
  if (!isUuid(body.rfq_id)) return fail(422, "Choose the round to award from");
  if (!isUuid(body.supplier_id)) return fail(422, "Choose the supplier to award");
  const wantedRfq = body.rfq_id.toLowerCase();
  const wantedSupplier = body.supplier_id.toLowerCase();

  const world = await loadWorld(req, { roundsFor: [pkg.id] });
  if ("pending" in world) return fail(503, needsBuyoutUpdate().error, needsBuyoutUpdate().extra);
  const lineCount = world.pkgLines.filter((l) => l.package_id === pkg.id).length;
  const stop = awardProblem({ status: pkg.status, line_count: lineCount });
  if (stop) return fail(stop.status, stop.error, { code: stop.code });

  const work = workRounds(world, pkg);
  const chosenRound = work.find((r) => r.view.rfq_id.toLowerCase() === wantedRfq);
  if (!chosenRound) return fail(404, "That round does not belong to this package");
  if (["draft", "cancelled", "closed"].includes(chosenRound.view.status)) return fail(409, chosenRound.view.status === "draft" ? "That round was not sent." : "That round is closed.");
  const quote = chosenRound.view.quotes.find((q) => q.supplier_id.toLowerCase() === wantedSupplier);
  if (!quote) return fail(404, "That supplier is not on this round");
  if (quote.total === null) return fail(422, `${quote.supplier_name} has not quoted every line of this package (${quote.lines_quoted} of ${quote.lines_total}). A package goes to one supplier for all its lines.`, { code: "incomplete_quote" });

  const current = currentRound(work) ?? chosenRound;
  const decision = packageAwardDecision({ chosen: quote, chosenRound: chosenRound.view.quotes, currentRound: current.view.quotes });
  const reason = cleanPackageReason(body.reason);
  if (decision.needsReason && !reason) {
    return fail(422, decision.why === "expired"
      ? "That answer has expired or is out of date while a valid one exists. Say why you are awarding it (at least 3 characters)."
      : "That is not the lowest valid price of the current round. Say why you are awarding it (at least 3 characters).", { code: "reason_required", why: decision.why, lowest_valid: decision.lowestValid, chosen_total: quote.total });
  }

  const { data: rfqRow } = await admin.from("rfqs").select("*").eq("id", chosenRound.view.rfq_id).eq("tenant_id", tenantId).eq("package_id", pkg.id).maybeSingle();
  if (!rfqRow) return fail(404, "That round does not belong to this package");
  const rfq = rfqRow as unknown as Rfq;
  const rs = chosenRound.data.suppliers.find((s) => s.supplier_id === quote.supplier_id && s.status !== "cancelled");
  if (!rs) return fail(404, "That supplier is not on this round");

  const live = chosenRound.data.lines.filter((l) => l.status !== "cancelled");
  const targets = live.map((l) => {
    const r = chosenRound.data.responses.find((x) => x.rfq_supplier_id === rs.id && x.rfq_line_id === l.id);
    return { lineId: l.id, responseId: r?.id ?? null };
  });
  if (targets.some((t) => !t.responseId)) return fail(422, `${quote.supplier_name} has not quoted every line of this package.`, { code: "incomplete_quote" });

  const user = await getAuthUser();
  const ctx = { tenantId, userId, email: user?.email ?? null };
  const responseIds = new Set(targets.map((t) => t.responseId as string));
  let outcomes: Awaited<ReturnType<typeof awardWithDecision>>;
  try {
    outcomes = await awardWithDecision(admin, ctx, { rfq, targets, reason: reason ?? PACKAGE_LINE_REASON, replace: false, staleDays: world.staleDays });
  } catch (e) {
    await releaseLines(req, rfq, ctx, responseIds, world.staleDays);
    if (e instanceof AwardError) return fail(e.status, e.message, e.extra);
    throw e;
  }

  const qtyOf = new Map(live.map((l) => [l.id, lineQty(l.qty)]));
  let committed = 0;
  for (const o of outcomes) committed += (o.unit_cost ?? 0) * (qtyOf.get(o.line_id) ?? 1);
  committed = roundMoney(committed);

  const now = new Date().toISOString();
  const up = await admin.from("project_buyout_packages").update({
    status: "awarded", awarded_rfq_id: rfq.id, awarded_supplier_id: quote.supplier_id, committed_amount: committed, currency: project.currency, award_reason: reason,
    awarded_by: userId, awarded_at: now, current_rfq_id: pkg.current_rfq_id ?? rfq.id, updated_at: now,
  }).eq("id", pkg.id).eq("tenant_id", tenantId).eq("project_id", project.id).in("status", ["draft", "out", "ready"]).select("id");
  if (up.error || (up.data ?? []).length === 0) {
    await releaseLines(req, rfq, ctx, responseIds, world.staleDays);
    return up.error ? fail(500, up.error.message) : fail(409, "This package was changed by someone else a moment ago. Reload and look again.", { code: "changed" });
  }

  await logProject(req, [
    { field: `Package ${pkg.ref ?? ""} awarded`.replace("  ", " "), from: null, to: `${quote.supplier_name}, ${committed.toFixed(2)}${project.currency ? ` ${project.currency}` : ""}, round ${chosenRound.view.round} (${rfq.ref ?? "RFQ"})` },
    ...(reason ? [{ field: `Package ${pkg.ref ?? ""} award reason`.replace("  ", " "), from: null, to: reason }] : []),
  ]);
  const row = await packageRowAfter(req, pkg.id);
  return { ok: true, row: row!, warnings: outcomes.map((o) => o.warning).filter((w): w is string => !!w) };
}

export async function unawardPackage(req: BuyoutCtx, pkg: PackageDbRow, body: { reason?: unknown }): Promise<Result<{ row: PackageRow }>> {
  const { admin, tenantId, project, userId } = req;
  if (!req.rfqEdit) return fail(403, "Un-awarding needs the RFQ module and permission to edit RFQs");
  const stop = unawardProblem({ status: pkg.status });
  if (stop) return fail(stop.status, stop.error, { code: stop.code });
  const reason = cleanPackageReason(body.reason);
  if (!reason) return fail(422, "Say why you are taking the award back (at least 3 characters).", { code: "reason_required" });

  const user = await getAuthUser();
  const ctx = { tenantId, userId, email: user?.email ?? null };
  if (pkg.awarded_rfq_id) {
    const { data: rfqRow } = await admin.from("rfqs").select("*").eq("id", pkg.awarded_rfq_id).eq("tenant_id", tenantId).eq("package_id", pkg.id).maybeSingle();
    if (rfqRow) {
      const rfq = rfqRow as unknown as Rfq;
      const cur = await loadCurrentAwards(admin, tenantId, rfq.id);
      const lineIds = cur.rows.map((a) => a.rfq_line_id);
      if (lineIds.length > 0) {
        try {
          await awardWithDecision(admin, ctx, { rfq, targets: lineIds.map((lineId) => ({ lineId, responseId: null })), reason: null, replace: true, staleDays: 180 });
        } catch (e) {
          if (e instanceof AwardError) return fail(e.status, e.message, e.extra);
          throw e;
        }
      }
    }
  }
  const now = new Date().toISOString();
  const up = await admin.from("project_buyout_packages").update({
    status: "out", awarded_rfq_id: null, awarded_supplier_id: null, committed_amount: null, award_reason: null, awarded_by: null, awarded_at: null, updated_at: now,
  }).eq("id", pkg.id).eq("tenant_id", tenantId).eq("project_id", project.id).eq("status", "awarded").select("id");
  if (up.error) return fail(500, up.error.message);
  if ((up.data ?? []).length === 0) return fail(409, "This package was changed by someone else a moment ago. Reload and look again.", { code: "changed" });
  await logProject(req, [{ field: `Package ${pkg.ref ?? ""} award undone`.replace("  ", " "), from: pkg.committed_amount, to: reason }]);
  const row = await packageRowAfter(req, pkg.id);
  return { ok: true, row: row! };
}

// ── Handover ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The Excel handover of an awarded package. */
export async function buildHandover(req: BuyoutCtx, pkg: PackageDbRow): Promise<Result<{ buffer: Buffer; fileName: string }>> {
  const { admin, tenantId, project } = req;
  const world = await loadWorld(req, { roundsFor: [pkg.id] });
  if ("pending" in world) return fail(503, needsBuyoutUpdate().error, needsBuyoutUpdate().extra);
  if (!canDownloadHandover(pkg.status) || !pkg.awarded_rfq_id || !pkg.awarded_supplier_id) return fail(409, "Award the package before making the handover file.", { code: "not_awarded" });
  const work = workRounds(world, pkg);
  const round = work.find((r) => r.view.rfq_id === pkg.awarded_rfq_id);
  if (!round) return fail(409, "The round this package was awarded on is no longer there.", { code: "round_missing" });

  const keyOf = new Map(world.pkgLines.filter((l) => l.package_id === pkg.id).map((l) => [l.id, l.line_key]));
  const budget = new Map([...world.baseline.lines, ...world.baseline.bidLines].map((l) => [l.line_key, l]));
  const codes = [...new Set([...budget.values()].map((l) => l.cost_code).filter((c): c is string => !!c))];
  const codeNames = new Map<string, string>();
  for (let i = 0; i < codes.length; i += 100) {
    const { data } = await admin.from("erp_masters").select("code, name").eq("tenant_id", tenantId).eq("kind", "cost_code").in("code", codes.slice(i, i + 100));
    for (const r of (data ?? []) as { code: string; name: string }[]) codeNames.set(r.code, r.name);
  }
  const awardedLines = round.data.lines.filter((l) => l.status === "awarded" && l.awarded_unit_cost !== null).sort((a, b) => a.sl_no - b.sl_no);
  if (awardedLines.length === 0) return fail(409, "No awarded line was found on that round.", { code: "no_awarded_lines" });

  const [sup, acct, rsRow] = await Promise.all([
    admin.from("suppliers").select("name, ref, email, phone").eq("id", pkg.awarded_supplier_id).eq("tenant_id", tenantId).maybeSingle(),
    project.account_id ? admin.from("accounts").select("name").eq("id", project.account_id).eq("tenant_id", tenantId).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("rfq_suppliers").select("supplier_quote_ref").eq("tenant_id", tenantId).eq("rfq_id", pkg.awarded_rfq_id).eq("supplier_id", pkg.awarded_supplier_id).maybeSingle(),
  ]);
  const supplier = (sup.data ?? { name: "Supplier", ref: null, email: null, phone: null }) as { name: string; ref: string | null; email: string | null; phone: string | null };
  const input: PackageHandoverInput = {
    project: { ref: project.ref, name: project.name, currency: pkg.currency ?? project.currency },
    clientName: (acct.data as { name?: string } | null)?.name ?? null,
    pkg: { ref: pkg.ref, name: pkg.name, kind: pkg.kind },
    supplier,
    round: { rfq_ref: round.view.ref, round: round.view.round, supplier_quote_ref: (rsRow.data as { supplier_quote_ref?: string | null } | null)?.supplier_quote_ref ?? null },
    awarded_at: pkg.awarded_at, awarded_by: pkg.awarded_by ? world.actorNames.get(pkg.awarded_by) ?? null : null,
    lines: awardedLines.map((l, i) => {
      const b = l.package_line_id ? budget.get(keyOf.get(l.package_line_id) ?? "") : undefined;
      return {
        no: i + 1, item: b?.wbs ?? null, cost_code: b?.cost_code ?? null, cost_code_name: b?.cost_code ? codeNames.get(b.cost_code) ?? null : null,
        description: l.description, qty: lineQty(l.qty), unit: l.uom, rate: l.awarded_unit_cost as number,
      };
    }),
  };
  const buffer = await buildPackageHandoverWorkbook(input);
  return { ok: true, buffer, fileName: handoverFileName(pkg.ref) };
}

/** Records that the handover went to the ERP team. From now on the award cannot be undone here. */
export async function markHandoverSent(req: BuyoutCtx, pkg: PackageDbRow, body: { erp_ref?: unknown }): Promise<Result<{ row: PackageRow }>> {
  const { admin, tenantId, project, userId } = req;
  const stop = markSentProblem({ status: pkg.status, handover_sent_at: pkg.handover_sent_at });
  if (stop) return fail(stop.status, stop.error, { code: stop.code });
  let erpRef: string | null = null;
  if (body.erp_ref !== undefined && body.erp_ref !== null) {
    if (typeof body.erp_ref !== "string") return fail(422, "The ERP reference must be text");
    erpRef = body.erp_ref.trim().slice(0, PACKAGE_LIMITS.erpRef) || null;
  }
  const now = new Date().toISOString();
  const up = await admin.from("project_buyout_packages").update({ status: "handed_over", handover_sent_at: now, handover_sent_by: userId, erp_ref: erpRef, updated_at: now })
    .eq("id", pkg.id).eq("tenant_id", tenantId).eq("project_id", project.id).eq("status", "awarded").is("handover_sent_at", null).select("id");
  if (up.error) return fail(500, up.error.message);
  if ((up.data ?? []).length === 0) return fail(409, "This package was changed by someone else a moment ago. Reload and look again.", { code: "changed" });
  await logProject(req, [{ field: `Package ${pkg.ref ?? ""} handed over`.replace("  ", " "), from: null, to: `${pkgLabel(pkg)}${erpRef ? `, ERP ${erpRef}` : ""}` }]);
  const row = await packageRowAfter(req, pkg.id);
  return { ok: true, row: row! };
}

export type { World };
export { packageRowFor };
