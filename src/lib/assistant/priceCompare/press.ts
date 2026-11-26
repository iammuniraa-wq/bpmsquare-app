import "server-only";
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canEditWorkcenter, type PermissionSet } from "@/lib/permissions";
import { ROUTES } from "@/lib/constants";
import { actionsEnabled } from "@/lib/actions/registry";
import { claimCard, finishCard, usedResult } from "@/lib/actions/ledger";
import { hashOf, verifyToken } from "@/lib/actions/token";
import { runVia } from "@/lib/actions/via";
import { awardDecision, cleanReason } from "@/lib/rfq/comparison";
import { parseMarkup } from "@/lib/tender/costing/rules";
import type { NextStep } from "@/lib/assistant/cards";
import { latestAnswers, usableUnit } from "./compute";
import { loadRfqData, type RfqHead } from "./load";
import { AWARD_ACT, canonicalPlan } from "./plan";
import type { AwardPlan } from "./types";

// The press of an award card. It runs no model and no tool: it checks the signed plan, then calls the existing award route once per line, in
// this process and on the person's own session, exactly as the compare screen's button does (the Costing route for a tender, the RFQ's own
// route otherwise). The award rules -- the reason for a price that is not the lowest valid one, replacing an award, cost plus markup, the change
// history -- are those routes' own; nothing is copied here. A card is single use (the ledger), and a run that stops half way says which lines are done.

export type PressCtx = {
  admin: SupabaseClient;
  tenantId: string;
  userId: string;
  perms: PermissionSet;
  features: Record<string, boolean | undefined>;
  baseUrl: string;
  now?: number;
};

export type PressBody = { card_id?: unknown; token?: unknown; plan?: unknown; reason?: unknown; replace?: unknown; markup_pct?: unknown };
export type PressOutcome = { status: number; body: Record<string, unknown> };
export type RouteCall = { status: number; json: Record<string, unknown> };

export type PressDeps = {
  call?: (plan: AwardPlan, body: Record<string, unknown>, baseUrl: string) => Promise<RouteCall>;
};

const refuse = (status: number, code: string, error: string, extra: Record<string, unknown> = {}): PressOutcome => ({ status, body: { ok: false, code, error, ...extra } });

export const awardPath = (plan: Pick<AwardPlan, "route" | "dealId" | "rfqId">): string =>
  plan.route === "tender" ? `/api/opportunities/${plan.dealId}/tender/costing/award` : `/api/rfqs/${plan.rfqId}/award`;

async function callAwardRoute(plan: AwardPlan, body: Record<string, unknown>, baseUrl: string): Promise<RouteCall> {
  const req = new NextRequest(new URL(awardPath(plan), baseUrl), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const res = plan.route === "tender"
    ? await (await import("@/app/api/opportunities/[id]/tender/costing/award/route")).POST(req, { params: Promise.resolve({ id: plan.dealId! }) })
    : await (await import("@/app/api/rfqs/[id]/award/route")).POST(req, { params: Promise.resolve({ id: plan.rfqId }) });
  return { status: res.status, json: ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown> };
}

/**
 * Everything the award route would refuse, asked BEFORE the first line is awarded, because the route is called once per line and a refusal on
 * line five would otherwise leave four awarded. The answers behind the plan are read again now: one that has changed or gone since the card was
 * shown is a stale card, not an award of something the person did not see.
 */
async function precheck(ctx: PressCtx, plan: AwardPlan, a: { reason: string | null; replace: boolean }): Promise<PressOutcome | null> {
  let data;
  try {
    const { data: head } = await ctx.admin.from("rfqs").select("id, ref, title, status, origin_type, origin_id, respond_by").eq("id", plan.rfqId).eq("tenant_id", ctx.tenantId).maybeSingle();
    if (!head) return refuse(422, "route_refused", "RFQ not found");
    data = await loadRfqData(ctx.admin, ctx.tenantId, head as unknown as RfqHead, new Date(ctx.now ?? Date.now()));
  } catch {
    return refuse(502, "failed", "The RFQ could not be read just now. Nothing was awarded.");
  }
  if (data.awardsPending) return refuse(503, "unavailable", "Recording an award needs a database update that has not been applied here. Ask your administrator.");
  const lineIds = new Set(data.lines.map((l) => l.id));
  const answers = latestAnswers(data.responses, lineIds);
  const live = new Set(data.suppliers.filter((s) => s.status !== "cancelled").map((s) => s.id));
  const needReason: string[] = [];
  const taken: string[] = [];
  for (const t of plan.targets) {
    const resp = data.responses.find((r) => r.id === t.responseId && r.rfq_line_id === t.lineId && r.rfq_supplier_id === t.rfqSupplierId);
    if (!resp || !lineIds.has(t.lineId) || !live.has(t.rfqSupplierId) || usableUnit(resp, data.currencyCode) === null) {
      return refuse(409, "changed", `The quote for item ${t.item} has changed since this card was shown. Ask me again.`);
    }
    const onLine = [...answers.values()].filter((r) => r.rfq_line_id === t.lineId && live.has(r.rfq_supplier_id));
    if (awardDecision(t.responseId, onLine, data.today, data.staleDays, null).notLowest) needReason.push(t.item);
    if (data.awards.some((x) => x.rfq_line_id === t.lineId) || data.lineStatus.get(t.lineId) === "awarded") taken.push(t.item);
  }
  if (needReason.length && !a.reason) {
    return refuse(422, "reason_required", `Say why: item ${needReason.join(", ")} ${needReason.length === 1 ? "is" : "are"} not the lowest valid price (at least 3 characters).`, { items: needReason });
  }
  if (taken.length && !a.replace) {
    return refuse(409, "already_awarded", `Item ${taken.join(", ")} already ${taken.length === 1 ? "has" : "have"} an award. Tick the box to replace it.`, { items: taken });
  }
  return null;
}

export function nextAfterAward(plan: Pick<AwardPlan, "route" | "dealId" | "rfqId">): NextStep[] {
  return [{ id: "open-compare", label: "Open the compare screen", kind: "navigate", target: plan.route === "tender" ? `${ROUTES.pipelineDetail(plan.dealId!)}?tab=costing` : ROUTES.rfq(plan.rfqId) }];
}

export async function pressAward(ctx: PressCtx, body: PressBody, deps: PressDeps = {}): Promise<PressOutcome> {
  const cardId = typeof body.card_id === "string" ? body.card_id : "";
  const verified = verifyToken(body.token, { tenantId: ctx.tenantId, userId: ctx.userId, cardId }, ctx.now);
  if (!verified.ok) {
    return verified.reason === "expired"
      ? refuse(410, "expired", "This card has expired. Ask me again and I will show a fresh one.")
      : refuse(403, "token", "This card was not issued to you in this workspace.");
  }
  if (verified.payload.act !== AWARD_ACT) return refuse(403, "token", "This card was not issued to you in this workspace.");
  const plan = canonicalPlan(body.plan);
  if (!plan || hashOf(plan) !== verified.payload.h) return refuse(409, "stale", "This card no longer matches what was shown. Ask me again.");

  if (!actionsEnabled(ctx.features) || ctx.features.rfq !== true) return refuse(403, "not_allowed", "You are not allowed to do that here.");
  if (!canEditWorkcenter(ctx.perms, "rfqs") || (plan.route === "tender" && (ctx.features.gcc_tender !== true || !canEditWorkcenter(ctx.perms, "pipeline")))) {
    return refuse(403, "not_allowed", "You are not allowed to do that here.");
  }

  const used = await usedResult(ctx.admin, { cardId, tenantId: ctx.tenantId, userId: ctx.userId });
  if (used) return refuse(409, "already_done", "This card has already been used.", { result: used.result });

  const markup = body.markup_pct === undefined || body.markup_pct === null || body.markup_pct === "" ? null : parseMarkup(body.markup_pct);
  if (markup === null && body.markup_pct !== undefined && body.markup_pct !== null && body.markup_pct !== "") return refuse(422, "markup", "Markup must be a number from 0 to 1000.");
  const reason = cleanReason(body.reason);
  const replace = body.replace === true;

  const early = await precheck(ctx, plan, { reason, replace });
  if (early) return early;

  const claim = await claimCard(ctx.admin, {
    cardId, tenantId: ctx.tenantId, userId: ctx.userId, kind: "update", actionKey: AWARD_ACT, route: awardPath(plan),
    card: { act: AWARD_ACT, rfq: plan.rfqId, route: plan.route, mode: plan.mode, items: plan.targets.map((t) => t.item) },
    params: { replace, reason_given: !!reason, markup_pct: markup, lines: plan.targets.length },
  });
  if (claim.state === "done") return refuse(409, "already_done", "This card has already been used.", { result: claim.result });
  if (claim.state === "unavailable") return refuse(503, "unavailable", "The assistant cannot make changes yet: its setup is not finished in this workspace. Use the compare screen instead.");
  if (claim.state === "busy") return refuse(409, "in_progress", "This card is already being processed.");
  const handle = { cardId, tenantId: ctx.tenantId, userId: ctx.userId };
  const call = deps.call ?? callAwardRoute;

  const priced: unknown[] = [];
  const skipped: unknown[] = [];
  const warnings: string[] = [];
  let awarded = 0;
  let failure: { item: string; status: number; error: string; code: string | null; extra: Record<string, unknown> } | null = null;
  try {
    await runVia("assistant", async () => {
      for (const t of plan.targets) {
        const common = { line_id: t.lineId, response_id: t.responseId, ...(reason ? { reason } : {}), ...(replace ? { replace: true } : {}) };
        const payload = plan.route === "tender" ? { rfq_id: plan.rfqId, ...common, ...(markup !== null ? { markup_pct: markup } : {}) } : common;
        let res: RouteCall;
        try {
          res = await call(plan, payload, ctx.baseUrl);
        } catch (e) {
          console.error("Assistant award failed:", e);
          res = { status: 500, json: { error: "The award could not be made." } };
        }
        if (res.status >= 200 && res.status < 300 && res.json.ok !== false) {
          awarded++;
          if (Array.isArray(res.json.priced)) priced.push(...res.json.priced);
          if (Array.isArray(res.json.skipped)) {
            for (const k of res.json.skipped as { reason?: unknown }[]) {
              skipped.push(k);
              if (typeof k?.reason === "string") warnings.push(`Item ${t.item} is awarded, but its price was not written onto the BOQ row: ${k.reason}`);
            }
          }
          if (typeof res.json.warning === "string" && res.json.warning) warnings.push(res.json.warning);
          continue;
        }
        const { error, code, ...extra } = res.json as { error?: unknown; code?: unknown } & Record<string, unknown>;
        failure = { item: t.item, status: res.status, error: typeof error === "string" ? error : "The award could not be made.", code: typeof code === "string" ? code : null, extra };
        return;
      }
    });
  } catch (e) {
    console.error("Assistant award failed:", e);
    await finishCard(ctx.admin, handle, awarded > 0 ? { status: "done", result: { awarded, partial: true } } : { status: "failed", result: { error: "The award could not be made." } });
    return awarded > 0 ? { status: 200, body: { ok: true, partial: true, awarded, next: nextAfterAward(plan) } } : refuse(500, "failed", "The award could not be made.");
  }

  const stopped = failure as { item: string; status: number; error: string; code: string | null; extra: Record<string, unknown> } | null;
  if (stopped && awarded === 0) {
    await finishCard(ctx.admin, handle, { status: "failed", result: { error: stopped.error, status: stopped.status, code: stopped.code } });
    return refuse(stopped.status === 404 ? 422 : stopped.status >= 500 ? 502 : stopped.status, stopped.code ?? "route_refused", stopped.error, stopped.extra);
  }
  const result = { awarded, of: plan.targets.length, ...(stopped ? { stopped_at: stopped.item, error: stopped.error } : {}) };
  await finishCard(ctx.admin, handle, { status: "done", result });
  return {
    status: 200,
    body: {
      ok: true, awarded, of: plan.targets.length, priced, skipped, warnings, next: nextAfterAward(plan),
      ...(stopped ? { partial: true, stopped_at: stopped.item, error: stopped.error } : {}),
    },
  };
}
