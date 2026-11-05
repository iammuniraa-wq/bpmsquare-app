import "server-only";
import { promptText } from "@/lib/assistant/promptSafe";
import { dayKey } from "@/lib/tender/rules";
import {
  loadNextSteps, loadOpenQuestions, loadRfqSuppliers, loadTenderCrewFacts, loadUnpricedByCostCode, type TenderCrewFacts,
} from "@/lib/tender/crewFacts";
import type { Ref, RunContext, ToolAdapter, ToolResult } from "../types";
import { TENDER_TOOL_SPECS } from "./tenderSpecs";

// Tender Watch's allow-listed tools (docs/design/nova-crew-agents.md section 3.4). Rules, enforced by a test:
//  - an adapter is (ctx, args) => ToolResult and the tenant is never an argument: it comes from ctx;
//  - it calls an EXISTING tenant-scoped function that takes (admin, tenantId, ...): the readers live in src/lib/tender/crewFacts.ts,
//    this folder reaches no table directly (src/lib/crew/adapters.test.ts greps for it);
//  - read-only, size-capped; the people in a result are user ids, never names or e-mail addresses.

const dealRef = (f: TenderCrewFacts): Ref => ({ type: "opportunity", id: f.deal_id, label: f.ref ?? f.title });
const idOf = (args: Record<string, unknown>): string | null => (typeof args.deal_id === "string" ? args.deal_id : null);
const NEED_DEAL = { ok: false, error: "deal_id is required." } as const;

/** d1, d2 ...: a short stable key for a deal inside one run, in the plan's candidate order. */
export const aliasOf = (ctx: Pick<RunContext, "candidateIds">, dealId: string): string => `d${[...ctx.candidateIds].indexOf(dealId) + 1}`;

/** The brief of one deal as the model sees it. Ids are user ids; no name, e-mail or price appears. */
export function briefEntry(f: TenderCrewFacts) {
  const { people: _people, ...rest } = f;
  void _people;
  return rest;
}

export function briefOf(ctx: Pick<RunContext, "candidateIds">, facts: readonly TenderCrewFacts[]): { deals: Record<string, ReturnType<typeof briefEntry>> } {
  return { deals: Object.fromEntries(facts.map((f) => [aliasOf(ctx, f.deal_id), briefEntry(f)])) };
}

async function oneDeal(ctx: RunContext, dealId: string): Promise<TenderCrewFacts | null> {
  const r = await loadTenderCrewFacts(ctx.admin, ctx.tenantId, [dealId], { now: ctx.now, timezone: ctx.timezone });
  return r.facts[0] ?? null;
}

export const tenderAdapters: ToolAdapter[] = [
  {
    key: "tender_brief",
    ...TENDER_TOOL_SPECS.tender_brief!,
    async run(ctx, args): Promise<ToolResult> {
      const ids = Array.isArray(args.deal_ids) ? (args.deal_ids as string[]) : [...ctx.candidateIds];
      const r = await loadTenderCrewFacts(ctx.admin, ctx.tenantId, ids.slice(0, 12), { now: ctx.now, timezone: ctx.timezone });
      return { ok: true, data: { ...briefOf(ctx, r.facts), unavailable: r.unavailable }, refs: r.facts.map(dealRef) };
    },
  },
  {
    key: "tender_open_questions",
    ...TENDER_TOOL_SPECS.tender_open_questions!,
    async run(ctx, args): Promise<ToolResult> {
      const id = idOf(args);
      if (!id) return NEED_DEAL;
      const r = await loadOpenQuestions(ctx.admin, ctx.tenantId, id, ctx.now);
      if (!r.ok) return { ok: false, error: "Deal Room questions could not be read (a database update may be pending)." };
      return { ok: true, data: { deal_id: id, count: r.rows.length, questions: r.rows.map((q) => ({ owner_id: q.owner_id, due: q.due, age_days: q.age_days, text: promptText(q.text, 300) })) } };
    },
  },
  {
    key: "tender_approvals",
    ...TENDER_TOOL_SPECS.tender_approvals!,
    async run(ctx, args): Promise<ToolResult> {
      const id = idOf(args);
      if (!id) return NEED_DEAL;
      const f = await oneDeal(ctx, id);
      if (!f) return { ok: false, error: "That tender could not be read." };
      return { ok: true, data: { deal_id: id, ...f.approval }, refs: [dealRef(f)] };
    },
  },
  {
    key: "tender_rfq_status",
    ...TENDER_TOOL_SPECS.tender_rfq_status!,
    async run(ctx, args): Promise<ToolResult> {
      const id = idOf(args);
      if (!id) return NEED_DEAL;
      const r = await loadRfqSuppliers(ctx.admin, ctx.tenantId, id);
      if (!r.ok) return { ok: false, error: "RFQ status could not be read (a database update may be pending)." };
      return { ok: true, data: { deal_id: id, suppliers: r.rows.length, replied: r.rows.filter((s) => s.status === "replied").length, waiting: r.rows.filter((s) => s.status === "sent" || s.status === "viewed").length, rows: r.rows } };
    },
  },
  {
    key: "tender_unpriced_by_cost_code",
    ...TENDER_TOOL_SPECS.tender_unpriced_by_cost_code!,
    async run(ctx, args): Promise<ToolResult> {
      const id = idOf(args);
      if (!id) return NEED_DEAL;
      const r = await loadUnpricedByCostCode(ctx.admin, ctx.tenantId, id);
      if (!r.ok) return { ok: false, error: "The bill of quantities could not be read (a database update may be pending)." };
      return { ok: true, data: { deal_id: id, cost_codes: r.rows } };
    },
  },
  {
    key: "tender_next_steps",
    ...TENDER_TOOL_SPECS.tender_next_steps!,
    async run(ctx, args): Promise<ToolResult> {
      const id = idOf(args);
      if (!id) return NEED_DEAL;
      const r = await loadNextSteps(ctx.admin, ctx.tenantId, id, dayKey(ctx.now, ctx.timezone));
      if (!r.ok) return { ok: false, error: "Next steps could not be read (a database update may be pending)." };
      return { ok: true, data: { deal_id: id, open: r.rows.length, overdue: r.rows.filter((s) => s.overdue).length, steps: r.rows.map((s) => ({ text: promptText(s.text, 200), due: s.due, overdue: s.overdue })) } };
    },
  },
  {
    key: "tender_people",
    ...TENDER_TOOL_SPECS.tender_people!,
    async run(ctx, args): Promise<ToolResult> {
      const id = idOf(args);
      if (!id) return NEED_DEAL;
      const f = await oneDeal(ctx, id);
      if (!f) return { ok: false, error: "That tender could not be read." };
      return { ok: true, data: { deal_id: id, owner_id: f.owner_id, team_ids: f.team_ids, decider_ids: f.approval.decider_ids, buyer_ids: f.rfq.buyer_ids, question_owner_ids: f.questions.owner_ids }, refs: [dealRef(f)] };
    },
  },
];
