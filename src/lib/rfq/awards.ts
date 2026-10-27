import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logChange } from "@/lib/changeLog";
import { tenantToday } from "@/lib/tenantClock";
import { awardLine, isMissingRelation } from "./server";
import { awardDecision, cleanReason, MIN_REASON_CHARS, type CompareResponse } from "./comparison";
import { landedUnit } from "./rules";
import type { Rfq, RfqLine } from "./types";

// Awarding with a recorded decision (GCC tender deals, slice 3b, migration 0224). The existing awardLine() still does the work
// of an award (the line's status, the cost the pricing engine reads, the event); this wraps it with the part the buyer is
// accountable for: who chose which answer, and why when it was not the lowest valid price. Every query is on the service-role
// client and chains .eq("tenant_id", tenantId); every id from the request is looked up inside this RFQ first.

export const AWARDS_PENDING_MESSAGE = "Recording an award needs the database update (migration 0224). Ask your administrator to apply it.";

export class AwardError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

export type AwardRow = {
  id: string;
  rfq_id: string;
  rfq_line_id: string;
  rfq_supplier_id: string;
  supplier_id: string;
  response_id: string;
  chosen_by: string | null;
  chosen_at: string;
  reason: string | null;
  not_lowest: boolean;
  landed_unit: number | null;
  lowest_valid_unit: number | null;
  applied_to_deal_at: string | null;
  applied_rate: number | null;
};

const COLS = "id, rfq_id, rfq_line_id, rfq_supplier_id, supplier_id, response_id, chosen_by, chosen_at, reason, not_lowest, landed_unit, lowest_valid_unit, applied_to_deal_at, applied_rate";

/** The award in force on each line of the RFQ. `pending` = migration 0224 has not run (an empty list, not an error). */
export async function loadCurrentAwards(admin: SupabaseClient, tenantId: string, rfqId: string): Promise<{ rows: AwardRow[]; pending: boolean }> {
  const { data, error } = await admin.from("rfq_line_awards").select(COLS).eq("tenant_id", tenantId).eq("rfq_id", rfqId).is("superseded_at", null).order("chosen_at");
  if (error) {
    if (isMissingRelation(error)) return { rows: [], pending: true };
    throw new AwardError(500, error.message);
  }
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    pending: false,
    rows: ((data ?? []) as AwardRow[]).map((r) => ({ ...r, landed_unit: num(r.landed_unit), lowest_valid_unit: num(r.lowest_valid_unit), applied_rate: num(r.applied_rate) })),
  };
}

export type AwardTarget = { lineId: string; responseId: string | null };

export type AwardOutcome = {
  line_id: string;
  status: "awarded" | "no_award";
  unit_cost: number | null;
  cost_input_id: string | null;
  not_lowest: boolean;
  warning?: string;
  /** Only for an RFQ raised for an estimate: what the award did to the estimate line and the BOQ lines priced from it. */
  estimate?: { written: true; repriced: number; flagged: number; locked: boolean } | { written: false; reason: string };
};

type Ctx = { tenantId: string; userId: string; email: string | null };

const fxOf = (v: unknown): number | null => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Award one or more lines. All the checks run before the first change: the lines and answers belong to this RFQ, the supplier
 * is still on it, nothing is silently replaced (a line that already has an award needs `replace`), and a choice that is not the
 * lowest valid price carries a reason. Then each line is recorded and awarded one at a time.
 */
export async function awardWithDecision(admin: SupabaseClient, ctx: Ctx, args: {
  rfq: Rfq; targets: AwardTarget[]; reason: unknown; replace: boolean; fxRate?: unknown; staleDays: number;
}): Promise<AwardOutcome[]> {
  const { tenantId } = ctx;
  const { rfq } = args;
  if (!args.targets.length) throw new AwardError(422, "Nothing to award.");

  const current = await loadCurrentAwards(admin, tenantId, rfq.id);
  if (current.pending) throw new AwardError(503, AWARDS_PENDING_MESSAGE);
  const currentByLine = new Map(current.rows.map((r) => [r.rfq_line_id, r]));

  const [{ data: lineRows }, { data: supRows }] = await Promise.all([
    admin.from("rfq_lines").select("id, sl_no, product_id, uom, status, description").eq("tenant_id", tenantId).eq("rfq_id", rfq.id),
    admin.from("rfq_suppliers").select("id, supplier_id, status").eq("tenant_id", tenantId).eq("rfq_id", rfq.id),
  ]);
  const lines = new Map(((lineRows ?? []) as Pick<RfqLine, "id" | "sl_no" | "product_id" | "uom" | "status" | "description">[]).map((l) => [l.id, l]));
  const sups = new Map(((supRows ?? []) as { id: string; supplier_id: string; status: string }[]).map((s) => [s.id, s]));
  const { data: respRows } = sups.size
    ? await admin.from("rfq_responses").select("*").eq("tenant_id", tenantId).in("rfq_supplier_id", [...sups.keys()])
    : { data: [] };
  const responses = ((respRows ?? []) as (CompareResponse & { rfq_supplier_id: string })[]).map((r) => ({
    ...r,
    unit_price: r.unit_price === null ? null : Number(r.unit_price),
    fx_rate: r.fx_rate === null ? null : Number(r.fx_rate),
    moq: r.moq === null ? null : Number(r.moq),
  }));
  const today = await tenantToday(tenantId);
  const fx = fxOf(args.fxRate);
  if (fx !== null && (fx <= 0 || fx > 1e6)) throw new AwardError(422, "Exchange rate must be a positive number.");

  // 1. Every target resolves inside this RFQ; a foreign or stale id is a 404 and nothing changes.
  const seen = new Set<string>();
  const plan = args.targets.map((t) => {
    const line = lines.get(t.lineId);
    if (!line || line.status === "cancelled") throw new AwardError(404, "Line not found");
    if (seen.has(t.lineId)) throw new AwardError(422, "A line can be awarded once per request.");
    seen.add(t.lineId);
    if (!t.responseId) return { line, resp: null as (typeof responses)[number] | null, cur: currentByLine.get(t.lineId) ?? null, decision: null };
    const resp = responses.find((r) => r.id === t.responseId && r.rfq_line_id === t.lineId);
    if (!resp) throw new AwardError(404, "Response not found on this line");
    const rs = sups.get(resp.rfq_supplier_id);
    if (!rs) throw new AwardError(404, "Response not found on this line");
    if (rs.status === "cancelled") throw new AwardError(422, "That supplier was removed from this RFQ.");
    if (resp.status === "no_quote" || resp.unit_price === null) throw new AwardError(422, "That supplier didn't quote this line.");
    const lineResponses = responses.filter((r) => r.rfq_line_id === t.lineId && sups.get(r.rfq_supplier_id)?.status !== "cancelled");
    return { line, resp, cur: currentByLine.get(t.lineId) ?? null, decision: awardDecision(resp.id, lineResponses, today, args.staleDays, fx) };
  });

  // 2. Nothing is replaced behind the buyer's back.
  if (!args.replace) {
    const taken = plan.filter((p) => p.cur || p.line.status === "awarded").filter((p) => p.resp !== null);
    if (taken.length) {
      throw new AwardError(409, `Line ${taken.map((p) => p.line.sl_no).join(", ")} ${taken.length === 1 ? "is" : "are"} already awarded. Confirm to replace the award.`, { code: "already_awarded", lines: taken.map((p) => p.line.id) });
    }
  }
  // A line already ordered keeps its award (the purchase order points at that answer).
  for (const p of plan) {
    const oldId = p.cur?.response_id;
    if (!oldId) continue;
    const { data: ordered, error } = await admin.from("purchase_order_lines").select("id").eq("tenant_id", tenantId).eq("rfq_response_id", oldId).limit(1);
    if (!error && (ordered ?? []).length) throw new AwardError(409, `Line ${p.line.sl_no} is already on a purchase order and can no longer be re-awarded.`, { code: "on_purchase_order" });
  }

  // 3. The reason is required whenever a chosen answer is not the lowest valid price.
  const needReason = plan.filter((p) => p.decision?.notLowest);
  const reason = cleanReason(args.reason);
  if (needReason.length && !reason) {
    throw new AwardError(422, `Say why: line ${needReason.map((p) => p.line.sl_no).join(", ")} ${needReason.length === 1 ? "is" : "are"} not the lowest valid price (at least ${MIN_REASON_CHARS} characters).`, { code: "reason_required", lines: needReason.map((p) => p.line.id) });
  }

  // 4. Record and award, one line at a time.
  const out: AwardOutcome[] = [];
  for (const p of plan) {
    const now = new Date().toISOString();
    if (p.cur) {
      const { data: sup } = await admin.from("rfq_line_awards").update({ superseded_at: now, superseded_by: ctx.userId })
        .eq("id", p.cur.id).eq("tenant_id", tenantId).is("superseded_at", null).select("id");
      if (!(sup ?? []).length) throw new AwardError(409, `Line ${p.line.sl_no} was awarded by someone else a moment ago. Reload and look again.`, { code: "already_awarded" });
    }
    const restore = async () => {
      if (p.cur) await admin.from("rfq_line_awards").update({ superseded_at: null, superseded_by: null }).eq("id", p.cur.id).eq("tenant_id", tenantId);
    };

    if (!p.resp || !p.decision) {
      try {
        await awardLine(admin, ctx, { rfq, lineId: p.line.id, responseId: null });
      } catch (e) {
        await restore();
        throw e;
      }
      out.push({ line_id: p.line.id, status: "no_award", unit_cost: null, cost_input_id: null, not_lowest: false });
      continue;
    }

    const rs = sups.get(p.resp.rfq_supplier_id)!;
    const notLowest = p.decision.notLowest;
    const { data: ins, error: insErr } = await admin.from("rfq_line_awards").insert({
      tenant_id: tenantId, rfq_id: rfq.id, rfq_line_id: p.line.id, rfq_supplier_id: rs.id, supplier_id: rs.supplier_id, response_id: p.resp.id,
      chosen_by: ctx.userId, chosen_at: now, reason: notLowest ? reason : null, not_lowest: notLowest,
      landed_unit: p.decision.landed, lowest_valid_unit: p.decision.lowestValid,
    }).select("id").single();
    if (insErr) {
      await restore();
      if (insErr.code === "23505") throw new AwardError(409, `Line ${p.line.sl_no} was awarded by someone else a moment ago. Reload and look again.`, { code: "already_awarded" });
      if (isMissingRelation(insErr)) throw new AwardError(503, AWARDS_PENDING_MESSAGE);
      throw new AwardError(500, insErr.message);
    }
    const awardId = (ins as { id: string }).id;

    let result;
    try {
      result = await awardLine(admin, ctx, { rfq, lineId: p.line.id, responseId: p.resp.id, fxRate: fx });
    } catch (e) {
      await admin.from("rfq_line_awards").delete().eq("id", awardId).eq("tenant_id", tenantId);
      await restore();
      throw e;
    }

    let warning = result.warning;
    if (p.line.product_id) {
      const w = await recordProductSupplier(admin, tenantId, {
        productId: p.line.product_id, supplierId: rs.supplier_id, uom: p.line.uom, today, resp: p.resp, landed: p.decision.landed,
      });
      if (w) warning = warning ? `${warning} ${w}` : w;
    }
    if (notLowest && reason) {
      await logChange(admin, {
        tenantId, objectType: "rfqs", objectId: rfq.id, objectLabel: rfq.ref, action: "update", actorId: ctx.userId, actorEmail: ctx.email,
        changes: [{ field: `line ${p.line.sl_no} award reason`, from: null, to: reason }],
      });
    }
    // An RFQ raised for an estimate's missing costs (GCC tender deals, slice 3c-1): the awarded cost goes back into the estimate line.
    // Best effort, like the product supplier above: the award stands whatever happens here.
    let estimate: AwardOutcome["estimate"];
    const cost = result.unit_cost ?? p.decision.landed;
    if (rfq.origin_type === "estimate" && cost !== null && cost !== undefined) {
      try {
        const { writeAwardedCostToEstimate } = await import("@/lib/tender/estimates/writeBack");
        const { data: sup } = await admin.from("suppliers").select("name").eq("id", rs.supplier_id).eq("tenant_id", tenantId).maybeSingle();
        const wb = await writeAwardedCostToEstimate(admin, ctx, {
          rfq: { id: rfq.id, ref: rfq.ref, origin_type: rfq.origin_type, origin_id: rfq.origin_id }, rfqLineId: p.line.id, unitCost: Number(cost),
          supplierName: (sup as { name?: string } | null)?.name ?? null,
        });
        estimate = wb.written ? { written: true, repriced: wb.repriced, flagged: wb.flagged, locked: wb.locked } : { written: false, reason: wb.reason };
      } catch (e) {
        estimate = { written: false, reason: e instanceof Error ? e.message : "the estimate could not be updated" };
        warning = `${warning ? `${warning} ` : ""}Awarded, but the cost could not be written to the estimate.`;
      }
    }
    out.push({ line_id: p.line.id, status: "awarded", unit_cost: result.unit_cost, cost_input_id: result.cost_input_id, not_lowest: notLowest, warning, ...(estimate ? { estimate } : {}) });
  }
  return out;
}

/** What this supplier quoted for this product, on the day of the award. Best effort: the award stands if this fails. */
export async function recordProductSupplier(admin: SupabaseClient, tenantId: string, a: {
  productId: string; supplierId: string; uom: string | null; today: string; landed: number | null;
  resp: Pick<CompareResponse, "id" | "unit_price" | "currency" | "lead_time_days" | "moq" | "valid_until" | "fx_rate">;
}): Promise<string | null> {
  const row = {
    tenant_id: tenantId, product_id: a.productId, supplier_id: a.supplierId,
    cost: a.landed ?? (landedUnit(a.resp)), quoted_price: a.resp.unit_price, currency: a.resp.currency, uom: a.uom,
    lead_time_days: a.resp.lead_time_days, moq: a.resp.moq, valid_from: a.today, valid_to: a.resp.valid_until, as_of: a.today,
    source: "rfq", rfq_response_id: a.resp.id, updated_at: new Date().toISOString(),
  };
  const { error } = await admin.from("product_suppliers").upsert(row, { onConflict: "tenant_id,product_id,supplier_id" });
  if (error) return `Awarded, but the supplier's price couldn't be saved on the product: ${error.message}`;
  return null;
}
