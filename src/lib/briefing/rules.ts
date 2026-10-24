import { ROUTES } from "@/lib/constants";
import { DRAFT_STALE_DAYS, EXPIRY_WINDOW_DAYS, NEW_LEAD_DAYS } from "@/lib/assistant/suggestions";
import { daysFromToday } from "./day";
import { familyOf } from "./yesterday";
import { RULES } from "./score";
import type { Candidate } from "./types";
import type { ObjectDef } from "@/lib/assistant/objects";

/**
 * The "Open today" rules: rows in, candidates out. Each function is the briefing's version of a rule that already
 * exists for the suggestions strip (suggestions.ts / ownWork.ts), with the same thresholds, so the dock chips and the
 * briefing never disagree about what counts as stale. The loaders (load.ts) decide whose rows these are; nothing
 * here looks at a user id except the lead filter, which exists to be tested. Pure.
 */

type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const join = (...parts: string[]) => parts.filter(Boolean).join(" · ");
const over = (left: number | null) => (left === null ? null : Math.max(0, -left));

/** Quotes the person created. One candidate per quote, the most pressing reading wins: expired, then expiring, then a stale draft. */
export function quoteCandidates(rows: readonly Row[], today: string, tz: string): Candidate[] {
  const out: Candidate[] = [];
  for (const q of rows) {
    const outcome = str(q.outcome);
    if (outcome && outcome !== "open") continue;
    const id = str(q.id);
    if (!id) continue;
    const base = { objectType: "quote", label: str(q.ref) || "Quote", href: ROUTES.quotation(id), value: num(q.total) || undefined, ownership: "own" as const };
    const left = daysFromToday(today, q.valid_until, tz);
    if (left !== null && left < 0) { out.push({ ...base, id: `quote:${id}`, kind: "quote_expired", days: -left }); continue; }
    if (left !== null && left <= EXPIRY_WINDOW_DAYS) { out.push({ ...base, id: `quote:${id}`, kind: "quote_expiring", days: left }); continue; }
    const age = over(daysFromToday(today, q.created_at, tz));
    if (q.status === "draft" && age !== null && age >= DRAFT_STALE_DAYS) out.push({ ...base, id: `quote:${id}`, kind: "quote_draft", days: age });
  }
  return out;
}

/** Draft sales orders the person created and has not confirmed: "N orders to confirm". One candidate per order. */
export function orderCandidates(rows: readonly Row[], today: string, tz: string): Candidate[] {
  const out: Candidate[] = [];
  for (const o of rows) {
    const id = str(o.id);
    if (!id || o.status !== "draft") continue;
    out.push({
      id: `order:${id}`, kind: "order_confirm", objectType: "sales_order", label: str(o.ref) || "Sales order",
      href: ROUTES.salesOrder(id), days: over(daysFromToday(today, o.created_at, tz)) ?? 0, value: num(o.total) || undefined, ownership: "own",
    });
  }
  return out;
}

export type LeadRow = {
  id: string; title: string | null; account_name: string; status: string | null; stage: string;
  owner_user_id: string | null; ready_at: string | null; created_at: string;
};

/** Leads the person owns: Ready for sales, and brand-new ones nobody has picked up for more than two days. */
export function leadCandidates(rows: readonly LeadRow[], userId: string, today: string, tz: string): Candidate[] {
  const out: Candidate[] = [];
  for (const l of rows) {
    if (!userId || l.owner_user_id !== userId) continue;
    const label = join(l.title ?? "", l.account_name) || "Lead";
    const base = { objectType: "lead", label, href: ROUTES.marketingLead(l.id), ownership: "own" as const };
    if (l.stage === "ready") {
      out.push({ ...base, id: `lead:${l.id}`, kind: "lead_ready", days: over(daysFromToday(today, l.ready_at ?? l.created_at, tz)) ?? 0 });
    } else if (l.status === "new") {
      const age = over(daysFromToday(today, l.created_at, tz)) ?? 0;
      if (age > NEW_LEAD_DAYS) out.push({ ...base, id: `lead:${l.id}`, kind: "lead_new", days: age });
    }
  }
  return out;
}

/** Open deals the person owns that are past their expected close or close within a week. */
export function dealCandidates(rows: readonly Row[], today: string, tz: string): Candidate[] {
  const out: Candidate[] = [];
  for (const d of rows) {
    const outcome = str(d.outcome);
    if (outcome && outcome !== "open") continue;
    const id = str(d.id);
    const left = daysFromToday(today, d.expected_close, tz);
    if (!id || left === null || left > EXPIRY_WINDOW_DAYS) continue;
    out.push({
      id: `deal:${id}`, kind: left < 0 ? "deal_late" : "deal_closing", objectType: "opportunity",
      label: join(str(d.ref), str(d.title)) || "Deal", href: ROUTES.pipelineDetail(id),
      days: left < 0 ? -left : left, value: num(d.amount) || undefined, ownership: "own",
    });
  }
  return out;
}

/** ABM next steps owned by the person whose date has come. */
export function abmCandidates(rows: readonly Row[], today: string, tz: string): Candidate[] {
  const out: Candidate[] = [];
  for (const t of rows) {
    const id = str(t.id);
    const left = daysFromToday(today, t.next_step_due, tz);
    if (!id || left === null || left > 0) continue;
    const acc = Array.isArray(t.accounts) ? t.accounts[0] : t.accounts;
    out.push({
      id: `abm:${id}`, kind: "abm_step", objectType: "abm_target", label: str((acc as Row | undefined)?.name) || "ABM next step",
      href: ROUTES.marketingAbmTargetShort(id), days: -left, ownership: "own",
    });
  }
  return out;
}

/** Journey tasks assigned to the person that are open and due today or earlier (no date means not yet due). */
export function taskCandidates(rows: readonly Row[], today: string, tz: string): Candidate[] {
  const out: Candidate[] = [];
  for (const t of rows) {
    const id = str(t.id);
    if (!id || t.status === "done") continue;
    const left = daysFromToday(today, t.due_on, tz);
    if (left === null || left > 0) continue;
    const accountId = str(t.account_id);
    out.push({
      id: `task:${id}`, kind: "task_due", objectType: "task", label: str(t.title) || "Task",
      href: accountId ? ROUTES.account(accountId) : ROUTES.marketingJourneys, days: -left, ownership: "own",
    });
  }
  return out;
}

/** Unpaid invoices past their due date, on accounts the person owns. */
export function invoiceCandidates(rows: readonly Row[], today: string, tz: string): Candidate[] {
  const out: Candidate[] = [];
  for (const i of rows) {
    const id = str(i.id);
    const status = str(i.status);
    if (!id || status === "paid" || status === "cancelled" || status === "draft") continue;
    const left = daysFromToday(today, i.due_date, tz);
    if (left === null || left >= 0) continue;
    const balance = num(i.total) - num(i.paid_amount);
    if (balance <= 0) continue;
    out.push({
      id: `invoice:${id}`, kind: "invoice_overdue", objectType: "invoice", label: str(i.ref) || "Invoice",
      href: ROUTES.invoice(id), days: -left, value: balance, ownership: "own",
    });
  }
  return out;
}

/** Comments that mention the person and that they have not marked read, on records they may open. Body text is never carried. */
export function mentionCandidates(
  rows: readonly Row[], readIds: ReadonlySet<string>, today: string, tz: string, canSee: (def: ObjectDef) => boolean,
): Candidate[] {
  const out: Candidate[] = [];
  for (const m of rows) {
    const id = str(m.id);
    const def = familyOf(m.object_type);
    if (!id || !def || readIds.has(id) || !canSee(def)) continue;
    out.push({
      id: `mention:${id}`, kind: "mention", objectType: def.type, label: `Mention on a ${def.noun}`,
      href: def.detail(str(m.object_id)), days: over(daysFromToday(today, m.created_at, tz)) ?? 0, ownership: "approver",
    });
  }
  return out;
}

export type QueueSummary = { count: number; oldestDays: number };

/** A supervisor's waiting requests, one candidate per queue. Counts and age only: never who asked or why. */
export function wfmCandidates(q: { leave?: QueueSummary; correction?: QueueSummary; overtime?: QueueSummary }): Candidate[] {
  const out: Candidate[] = [];
  const add = (kind: "wfm_leave" | "wfm_correction" | "wfm_overtime", s: QueueSummary | undefined, href: string) => {
    if (!s || s.count <= 0) return;
    out.push({ id: `wfm:${kind}`, kind, objectType: "wfm", label: RULES[kind].group(s.count), href, days: Math.max(0, s.oldestDays), count: s.count, ownership: "approver" });
  };
  add("wfm_leave", q.leave, ROUTES.wfmLeave);
  add("wfm_correction", q.correction, ROUTES.wfmCorrections);
  add("wfm_overtime", q.overtime, ROUTES.wfmCorrections);
  return out;
}

/**
 * New customer email waiting in the Inbox channels the person is on the team of, unassigned or assigned to them: one
 * candidate per channel. The channel's name and counts only; never a sender, a subject or a word of the mail.
 */
export function inboxCandidates(rows: readonly { channelId: string; channelName: string; count: number; oldestAt: string }[], today: string, tz: string): Candidate[] {
  const out: Candidate[] = [];
  for (const r of rows) {
    if (r.count <= 0) continue;
    const n = r.count;
    out.push({
      id: `inbox:${r.channelId}`, kind: "inbox_new", objectType: "inbound_emails",
      label: `${n} new ${n === 1 ? "email" : "emails"} in ${r.channelName}`,
      href: `${ROUTES.inbox}?channel=${r.channelId}&status=new`,
      days: over(daysFromToday(today, r.oldestAt, tz)) ?? 0, count: n, ownership: "own",
    });
  }
  return out;
}

/** Failed integration messages of the last 24 hours, for workspace admins. */
export function syncCandidates(s: QueueSummary | undefined): Candidate[] {
  if (!s || s.count <= 0) return [];
  return [{ id: "sync:failed", kind: "sync_failed", objectType: "integration", label: RULES.sync_failed.group(s.count), href: ROUTES.settingsMiddleware, days: Math.max(0, s.oldestDays), count: s.count, ownership: "approver" }];
}
