import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantConfig } from "@/lib/constants";
import { priceValidityDays } from "./boq/price";
import { staleLineCounts } from "@/lib/tenderDesk/rules";
import { APPROVAL_KIND_TENDER_BID, APPROVAL_OBJECT_TENDER, decidersFor } from "./approval";
import { loadApprovers } from "./approvalServer";
import { bondState } from "./bond";
import { dayKey, daysUntilClosing, tenderIsLive } from "./rules";
import { isMissingSchema, listTenders, type TenderRow } from "./server";

// The facts AI automation's Tender Watch reads (docs/design/nova-crew-agents.md sections 3.4 and 4.3). Owned by the tender module so the
// crew code never contains a `.from(` of its own: every function takes (admin, tenantId, ...), every query carries
// `.eq("tenant_id", tenantId)`, and a table that is not there yet (migration pending) hides its part and is reported in `unavailable`,
// never thrown. Nothing here reads a price, a cost, a markup, a message body (beyond the open-question text) or an approver's comment.

type Row = Record<string, unknown>;
const chunks = <T,>(a: readonly T[], n: number): T[][] => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const PAGE = 1000;
const DAY_MS = 86_400_000;

async function readIn(admin: SupabaseClient, tenantId: string, table: string, cols: string, column: string, ids: readonly string[], extra?: (q: any) => any): Promise<{ rows: Row[]; ok: boolean }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const rows: Row[] = [];
  for (const part of chunks([...new Set(ids)], 100)) {
    for (let page = 0; page < 50; page++) {
      let q = admin.from(table).select(cols).eq("tenant_id", tenantId).in(column, part);
      if (extra) q = extra(q);
      const from = page * PAGE;
      const { data, error } = await q.order(column, { ascending: true }).range(from, from + PAGE - 1);
      if (error) {
        if (!isMissingSchema(error)) console.error(`[crew] ${table} could not be read`, error.message);
        return { rows: [], ok: false };
      }
      const got = (data ?? []) as unknown as Row[];
      rows.push(...got);
      if (got.length < PAGE) break;
    }
  }
  return { rows, ok: true };
}

const daysBetween = (fromIso: string | null, now: Date): number | null => {
  const t = fromIso ? Date.parse(fromIso) : NaN;
  return Number.isFinite(t) ? Math.max(0, Math.floor((now.getTime() - t) / DAY_MS)) : null;
};

export type TenderCrewFacts = {
  deal_id: string;
  ref: string | null;
  title: string;
  tender_no: string | null;
  issuer: string | null;
  portal: string | null;
  stage: string;
  live: boolean;
  closing_at: string | null;
  days_to_close: number | null;
  decision: string | null;
  days_since_receipt: number | null;
  addenda_count: number;
  owner_id: string | null;
  team_ids: string[];
  boq: { version: number | null; lines: number; priced: number; unpriced: number; stale: number; days_since_upload: number | null } | null;
  approval: { pending: boolean; age_days: number | null; proposed: string | null; proposer_id: string | null; decider_ids: string[]; allow_self: boolean };
  questions: { open: number; overdue: number; owner_ids: string[] };
  rfq: { rfqs: number; suppliers: number; sent: number; replied: number; waiting: number; days_waiting: number | null; buyer_ids: string[] };
  bond: { expiry: string | null; days_to_expiry: number | null; state: string | null };
  room: { exists: boolean; silent_days: number | null };
  next_steps: { open: number; overdue: number };
  /** Members who may be addressed about this deal: owner, team, deciders, buyers, question owners, workspace admins. */
  people: { admin_ids: string[] };
};

export type TenderFactsResult = { facts: TenderCrewFacts[]; unavailable: string[]; admin_ids: string[] };

/** The tenders a plan pass should look at: live ones. Cheap (two reads); the heavy facts are loaded only for these. */
export async function listLiveTenderIds(admin: SupabaseClient, tenantId: string): Promise<{ ids: string[]; pending: boolean; tenders: TenderRow[] }> {
  const { rows, pending } = await listTenders(admin, tenantId);
  if (pending || rows.length === 0) return { ids: [], pending, tenders: [] };
  const deals = await readIn(admin, tenantId, "opportunities", "id, stage, outcome", "id", rows.map((t) => t.opportunity_id));
  const byId = new Map(deals.rows.map((d) => [d.id as string, d]));
  const live = rows.filter((t) => { const d = byId.get(t.opportunity_id); return d && tenderIsLive({ outcome: String(d.outcome), stage: String(d.stage) }, t); });
  return { ids: live.map((t) => t.opportunity_id), pending: false, tenders: live };
}

export async function loadTenderCrewFacts(admin: SupabaseClient, tenantId: string, dealIds: readonly string[], opts: { now: Date; timezone: string }): Promise<TenderFactsResult> {
  const { now, timezone } = opts;
  const unavailable: string[] = [];
  if (dealIds.length === 0) return { facts: [], unavailable, admin_ids: [] };

  const { data: tenantRow } = await admin.from("tenants").select("config").eq("id", tenantId).maybeSingle();
  const config = ((tenantRow?.config ?? {}) as TenantConfig) ?? {};
  const todayKey = dayKey(now, timezone);

  const tendersR = await readIn(admin, tenantId, "opportunity_tenders", "*", "opportunity_id", dealIds);
  if (!tendersR.ok) return { facts: [], unavailable: ["tenders"], admin_ids: [] };
  const dealsR = await readIn(admin, tenantId, "opportunities", "id, ref, title, stage, outcome, owner_id, team, created_at", "id", dealIds);
  const dealById = new Map(dealsR.rows.map((d) => [d.id as string, d]));

  const [boqR, srcR, apprR, roomsR, rfqR, actR, appr] = await Promise.all([
    readIn(admin, tenantId, "tender_boq_lines", "opportunity_id, price_source, price_as_of, stale_accepted, removed_in_revision", "opportunity_id", dealIds),
    readIn(admin, tenantId, "tender_boq_sources", "opportunity_id, version, uploaded_at", "opportunity_id", dealIds, (q) => q.eq("is_current", true)),
    readIn(admin, tenantId, "approval_requests", "object_id, proposed_value, requested_by, created_at", "object_id", dealIds, (q) => q.eq("object_type", APPROVAL_OBJECT_TENDER).eq("kind", APPROVAL_KIND_TENDER_BID).eq("status", "pending")),
    readIn(admin, tenantId, "deal_rooms", "id, opportunity_id", "opportunity_id", dealIds),
    readIn(admin, tenantId, "rfqs", "id, origin_id, buyer_id, requested_by", "origin_id", dealIds, (q) => q.eq("origin_type", "opportunity").in("status", ["sent", "partially_replied", "replied"])),
    readIn(admin, tenantId, "deal_activities", "opportunity_id, next_step_due, next_step_done_at", "opportunity_id", dealIds, (q) => q.not("next_step_due", "is", null)),
    loadApprovers(admin, tenantId, config),
  ]);
  if (!boqR.ok) unavailable.push("bill of quantities");
  if (!apprR.ok) unavailable.push("approvals");
  if (!roomsR.ok) unavailable.push("deal room");
  if (!rfqR.ok) unavailable.push("RFQs");
  if (!actR.ok) unavailable.push("next steps");

  const roomIds = roomsR.rows.map((r) => r.id as string);
  const msgR = roomIds.length
    ? await readIn(admin, tenantId, "deal_room_messages", "room_id, kind, question_owner_id, question_due, question_status, created_at", "room_id", roomIds, (q) => q.is("deleted_at", null))
    : { rows: [] as Row[], ok: true };
  const rfqIds = rfqR.rows.map((r) => r.id as string);
  const supR = rfqIds.length ? await readIn(admin, tenantId, "rfq_suppliers", "rfq_id, status, sent_at", "rfq_id", rfqIds) : { rows: [] as Row[], ok: true };

  const { data: adminRows } = await admin.from("tenant_users").select("user_id").eq("tenant_id", tenantId).eq("role", "admin").limit(200);
  const admin_ids = ((adminRows ?? []) as { user_id: string }[]).map((r) => r.user_id);

  const validity = priceValidityDays(config);
  const boqLines = boqR.rows.map((x) => ({
    opportunityId: x.opportunity_id as string, priceSource: str(x.price_source), priceAsOf: typeof x.price_as_of === "string" ? x.price_as_of.slice(0, 10) : null,
    staleAccepted: x.stale_accepted === true, removed: x.removed_in_revision === true,
  }));
  const staleBy = staleLineCounts(boqLines, todayKey, validity);
  const group = <T extends Row>(rows: T[], key: string) => { const m = new Map<string, T[]>(); for (const r of rows) { const k = r[key] as string; (m.get(k) ?? m.set(k, []).get(k)!).push(r); } return m; };
  const linesBy = group(boqLines as unknown as Row[], "opportunityId");
  const srcBy = new Map(srcR.rows.map((s) => [s.opportunity_id as string, s]));
  const apprBy = group(apprR.rows, "object_id");
  const roomBy = new Map(roomsR.rows.map((r) => [r.opportunity_id as string, r.id as string]));
  const msgsBy = group(msgR.rows, "room_id");
  const rfqBy = group(rfqR.rows, "origin_id");
  const supBy = group(supR.rows, "rfq_id");
  const actBy = group(actR.rows, "opportunity_id");

  const facts: TenderCrewFacts[] = [];
  for (const t of tendersR.rows) {
    const id = t.opportunity_id as string;
    const d = dealById.get(id);
    if (!d) continue;
    const closing = typeof t.closing_at === "string" && !Number.isNaN(Date.parse(t.closing_at)) ? new Date(t.closing_at).toISOString() : null;
    const team = ((d.team ?? []) as { user_id?: string }[]).map((m) => m?.user_id).filter((x): x is string => typeof x === "string");

    const lines = (linesBy.get(id) ?? []) as unknown as { priceSource: string | null; removed: boolean }[];
    const live = lines.filter((l) => !l.removed);
    const src = srcBy.get(id);
    const boq = boqR.ok && live.length + (src ? 1 : 0) > 0
      ? { version: src ? Number(src.version) : null, lines: live.length, priced: live.filter((l) => !!l.priceSource).length, unpriced: live.filter((l) => !l.priceSource).length, stale: staleBy.get(id) ?? 0, days_since_upload: daysBetween(str(src?.uploaded_at), now) }
      : null;

    const pend = (apprBy.get(id) ?? [])[0];
    const proposer = str(pend?.requested_by);
    const approval = {
      pending: !!pend, age_days: pend ? daysBetween(str(pend.created_at), now) : null, proposed: str(pend?.proposed_value), proposer_id: proposer,
      decider_ids: pend && proposer ? decidersFor(appr.approvers, proposer, appr.allowSelfApproval) : [], allow_self: appr.allowSelfApproval,
    };

    const roomId = roomBy.get(id);
    const msgs = roomId ? (msgsBy.get(roomId) ?? []) : [];
    const open = msgs.filter((m) => m.kind === "question" && m.question_status === "open");
    const overdue = open.filter((m) => typeof m.question_due === "string" && m.question_due < todayKey);
    const lastMsg = msgs.map((m) => str(m.created_at)).filter((x): x is string => !!x).sort().pop() ?? null;

    const rfqs = rfqBy.get(id) ?? [];
    const sups = rfqs.flatMap((r) => supBy.get(r.id as string) ?? []);
    const waitingSups = sups.filter((s) => s.status === "sent" || s.status === "viewed");
    const waitDays = waitingSups.map((s) => daysBetween(str(s.sent_at), now)).filter((x): x is number => x !== null);

    const acts = actBy.get(id) ?? [];
    const openSteps = acts.filter((a) => !a.next_step_done_at);
    const bondExpiry = typeof t.bid_bond_expiry === "string" ? t.bid_bond_expiry.slice(0, 10) : null;

    facts.push({
      deal_id: id, ref: str(d.ref), title: str(d.title) ?? "Tender", tender_no: str(t.tender_no), issuer: str(t.issuer_name), portal: str(t.portal),
      stage: str(d.stage) ?? "", live: tenderIsLive({ outcome: String(d.outcome), stage: String(d.stage) }, { decision: str(t.decision) }),
      closing_at: closing, days_to_close: daysUntilClosing(closing, now, timezone), decision: str(t.decision),
      days_since_receipt: daysBetween(str(d.created_at), now), addenda_count: Number(t.addenda_count ?? 0),
      owner_id: str(d.owner_id), team_ids: team, boq, approval,
      questions: { open: open.length, overdue: overdue.length, owner_ids: [...new Set(open.map((m) => str(m.question_owner_id)).filter((x): x is string => !!x))] },
      rfq: { rfqs: rfqs.length, suppliers: sups.length, sent: sups.filter((s) => s.status !== "pending").length, replied: sups.filter((s) => s.status === "replied").length, waiting: waitingSups.length, days_waiting: waitDays.length ? Math.max(...waitDays) : null, buyer_ids: [...new Set(rfqs.flatMap((r) => [str(r.buyer_id), str(r.requested_by)]).filter((x): x is string => !!x))] },
      bond: { expiry: bondExpiry, days_to_expiry: bondExpiry ? Math.round((Date.parse(bondExpiry) - Date.parse(todayKey)) / DAY_MS) : null, state: safeBondState(t, now, timezone) },
      room: { exists: !!roomId, silent_days: roomId ? daysBetween(lastMsg, now) : null },
      next_steps: { open: openSteps.length, overdue: openSteps.filter((a) => typeof a.next_step_due === "string" && a.next_step_due < todayKey).length },
      people: { admin_ids },
    });
  }
  return { facts, unavailable, admin_ids };
}

function safeBondState(t: Row, now: Date, timezone: string): string | null {
  try {
    return bondState({
      bid_bond_amount: t.bid_bond_amount == null ? null : Number(t.bid_bond_amount),
      bid_bond_expiry: typeof t.bid_bond_expiry === "string" ? t.bid_bond_expiry.slice(0, 10) : null,
      bond_status: (str(t.bond_status) ?? "requested") as Parameters<typeof bondState>[0]["bond_status"],
    }, now, timezone).label;
  } catch {
    return str(t.bond_status);
  }
}

// ── Drill-down readers (each wraps one slice of the same tenant-scoped facts) ───────────────────────────────────────────────

/** Open Deal Room questions of one deal: owner, due, age and the question text (untrusted: the adapter wraps it). */
export async function loadOpenQuestions(admin: SupabaseClient, tenantId: string, dealId: string, now: Date): Promise<{ rows: { owner_id: string | null; due: string | null; age_days: number | null; text: string }[]; ok: boolean }> {
  const room = await readIn(admin, tenantId, "deal_rooms", "id", "opportunity_id", [dealId]);
  const roomId = room.rows[0]?.id as string | undefined;
  if (!room.ok || !roomId) return { rows: [], ok: room.ok };
  const m = await readIn(admin, tenantId, "deal_room_messages", "body, question_owner_id, question_due, created_at", "room_id", [roomId], (q) => q.is("deleted_at", null).eq("kind", "question").eq("question_status", "open"));
  return {
    ok: m.ok,
    rows: m.rows.slice(0, 20).map((r) => ({ owner_id: str(r.question_owner_id), due: typeof r.question_due === "string" ? r.question_due : null, age_days: daysBetween(str(r.created_at), now), text: String(r.body ?? "").slice(0, 300) })),
  };
}

/** Unpriced and stale BOQ lines of one deal by cost code. No rate, cost or markup is read. */
export async function loadUnpricedByCostCode(admin: SupabaseClient, tenantId: string, dealId: string): Promise<{ rows: { cost_code: string; lines: number; unpriced: number }[]; ok: boolean }> {
  const r = await readIn(admin, tenantId, "tender_boq_lines", "cost_code, price_source, removed_in_revision", "opportunity_id", [dealId]);
  const by = new Map<string, { lines: number; unpriced: number }>();
  for (const x of r.rows) {
    if (x.removed_in_revision === true) continue;
    const k = str(x.cost_code) ?? "(none)";
    const e = by.get(k) ?? { lines: 0, unpriced: 0 };
    e.lines++;
    if (!x.price_source) e.unpriced++;
    by.set(k, e);
  }
  return { ok: r.ok, rows: [...by.entries()].map(([cost_code, v]) => ({ cost_code, ...v })).sort((a, b) => b.unpriced - a.unpriced).slice(0, 25) };
}

/** RFQ supplier states of one deal: status, sent, viewed, replied, reminder count. No prices. */
export async function loadRfqSuppliers(admin: SupabaseClient, tenantId: string, dealId: string): Promise<{ rows: { rfq_ref: string | null; status: string; sent_at: string | null; replied_at: string | null; reminders: number }[]; ok: boolean }> {
  const rfqs = await readIn(admin, tenantId, "rfqs", "id, ref", "origin_id", [dealId], (q) => q.eq("origin_type", "opportunity"));
  if (!rfqs.ok || rfqs.rows.length === 0) return { rows: [], ok: rfqs.ok };
  const refOf = new Map(rfqs.rows.map((r) => [r.id as string, str(r.ref)]));
  const sups = await readIn(admin, tenantId, "rfq_suppliers", "rfq_id, status, sent_at, replied_at, reminder_count", "rfq_id", rfqs.rows.map((r) => r.id as string));
  return { ok: sups.ok, rows: sups.rows.slice(0, 40).map((s) => ({ rfq_ref: refOf.get(s.rfq_id as string) ?? null, status: String(s.status), sent_at: str(s.sent_at), replied_at: str(s.replied_at), reminders: Number(s.reminder_count ?? 0) })) };
}

/** Open call next steps of one deal and when they are due. */
export async function loadNextSteps(admin: SupabaseClient, tenantId: string, dealId: string, todayKey: string): Promise<{ rows: { text: string; due: string | null; overdue: boolean }[]; ok: boolean }> {
  const r = await readIn(admin, tenantId, "deal_activities", "next_step, next_step_due, next_step_done_at", "opportunity_id", [dealId], (q) => q.not("next_step", "is", null));
  return { ok: r.ok, rows: r.rows.filter((x) => !x.next_step_done_at).slice(0, 20).map((x) => ({ text: String(x.next_step ?? "").slice(0, 200), due: typeof x.next_step_due === "string" ? x.next_step_due : null, overdue: typeof x.next_step_due === "string" && x.next_step_due < todayKey })) };
}

export type { TenderRow };
