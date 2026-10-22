import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listScoredLeads } from "@/lib/marketing/leads/queries";
import { canViewWorkcenter } from "@/lib/permissions";
import type { WorkcenterKey } from "@/lib/workcenters";
import { canUseObject, type AssistantCtx } from "@/lib/assistant/sources";
import { objectDef } from "@/lib/assistant/objects";
import { daysFromToday, type DayWindow } from "./day";
import {
  abmCandidates, dealCandidates, invoiceCandidates, leadCandidates, mentionCandidates, quoteCandidates,
  syncCandidates, taskCandidates, wfmCandidates, type QueueSummary,
} from "./rules";
import type { ChangeRow, CommentRow } from "./yesterday";
import type { Candidate } from "./types";

// Everything the briefing reads. Two rules hold for every query in this file, because the admin client bypasses RLS:
//   1. `.eq("tenant_id", ctx.tenantId)` on every query, the workspace of the session, never a request value.
//   2. "Mine" is `ctx.userId` on the owner / creator / actor / author column, or a row addressed to the person as a
//      supervisor or admin. A manager's briefing therefore never holds another person's history or private text.
// A source is only read when the module is on for the workspace and the person's Business Roles grant view on its
// workcenter (the same check the rest of the assistant uses). A failed or missing table (migration pending) yields
// nothing for that source and never an error for the briefing.

export type WfmAccess = { isSupervisor: boolean; unrestricted: boolean; employeeIds: string[] | null };

export type BriefingCtx = AssistantCtx & {
  userId: string;
  /** For mentions, which are stored by email. */
  email: string | null;
  isAdmin: boolean;
  wfm: WfmAccess | null;
};

const DAY = 86_400_000;

function can(ctx: BriefingCtx, feature: string, workcenter: WorkcenterKey): boolean {
  return ctx.features[feature] === true && canViewWorkcenter(ctx.perms, workcenter);
}

const safe = async <T,>(job: () => Promise<T>, fallback: T): Promise<T> => {
  try { return await job(); } catch { return fallback; }
};

export async function loadYesterday(admin: SupabaseClient, ctx: BriefingCtx, win: DayWindow): Promise<{ changes: ChangeRow[]; comments: CommentRow[] }> {
  const [changes, comments] = await Promise.all([
    safe(async () => {
      const { data, error } = await admin.from("change_log")
        .select("object_type, object_id, object_label, action, created_at")
        .eq("tenant_id", ctx.tenantId).eq("actor_id", ctx.userId)
        .gte("created_at", win.yesterdayStart).lt("created_at", win.todayStart)
        .order("created_at", { ascending: false }).limit(500);
      return error ? [] : ((data ?? []) as ChangeRow[]);
    }, [] as ChangeRow[]),
    safe(async () => {
      const { data, error } = await admin.from("record_comments")
        .select("object_type, object_id, created_at")
        .eq("tenant_id", ctx.tenantId).eq("author_id", ctx.userId)
        .gte("created_at", win.yesterdayStart).lt("created_at", win.todayStart)
        .order("created_at", { ascending: false }).limit(200);
      return error ? [] : ((data ?? []) as CommentRow[]);
    }, [] as CommentRow[]),
  ]);
  return { changes, comments };
}

async function queueSummary(
  admin: SupabaseClient, ctx: BriefingCtx, win: DayWindow, table: string, dateCol: string,
): Promise<QueueSummary | undefined> {
  const wfm = ctx.wfm;
  if (!wfm) return undefined;
  if (!wfm.unrestricted && (wfm.employeeIds ?? []).length === 0) return undefined;
  let q = admin.from(table).select(dateCol, { count: "exact" })
    .eq("tenant_id", ctx.tenantId).eq("status", "pending")
    .order(dateCol, { ascending: true }).limit(1);
  if (!wfm.unrestricted) q = q.in("employee_id", wfm.employeeIds ?? []);
  const { data, count, error } = await q;
  if (error || !count) return undefined;
  const first = (data?.[0] as unknown as Record<string, unknown> | undefined)?.[dateCol];
  const left = daysFromToday(win.today, first, win.timeZone);
  return { count, oldestDays: left === null ? 0 : Math.max(0, -left) };
}

export async function loadOpen(admin: SupabaseClient, ctx: BriefingCtx, win: DayWindow, now: Date): Promise<Candidate[]> {
  const { today, timeZone: tz } = win;
  const jobs: Promise<Candidate[]>[] = [];

  if (canUseObject(ctx, objectDef("quote"))) {
    jobs.push(safe(async () => {
      const { data, error } = await admin.from("quotes")
        .select("id, ref, status, outcome, valid_until, total, created_at")
        .eq("tenant_id", ctx.tenantId).eq("created_by", ctx.userId)
        .or("outcome.is.null,outcome.eq.open")
        .order("created_at", { ascending: false }).limit(300);
      return error ? [] : quoteCandidates((data ?? []) as Record<string, unknown>[], today, tz);
    }, []));
  }

  if (canUseObject(ctx, objectDef("lead"))) {
    jobs.push(safe(async () => {
      const { leads, pending } = await listScoredLeads(admin, ctx.tenantId);
      return pending ? [] : leadCandidates(leads, ctx.userId, today, tz);
    }, []));
  }

  if (canUseObject(ctx, objectDef("opportunity"))) {
    jobs.push(safe(async () => {
      const { data, error } = await admin.from("opportunities")
        .select("id, ref, title, expected_close, amount, outcome")
        .eq("tenant_id", ctx.tenantId).eq("owner_id", ctx.userId).eq("outcome", "open")
        .not("expected_close", "is", null).order("expected_close", { ascending: true }).limit(200);
      return error ? [] : dealCandidates((data ?? []) as Record<string, unknown>[], today, tz);
    }, []));
  }

  if (can(ctx, "abm", "abm")) {
    jobs.push(safe(async () => {
      const { data, error } = await admin.from("abm_target_accounts")
        .select("id, next_step_due, accounts(name)")
        .eq("tenant_id", ctx.tenantId).eq("owner_user_id", ctx.userId)
        .not("next_step_due", "is", null).lte("next_step_due", today).limit(100);
      return error ? [] : abmCandidates((data ?? []) as Record<string, unknown>[], today, tz);
    }, []));
  }

  if (can(ctx, "journeys", "marketing_journeys")) {
    jobs.push(safe(async () => {
      const { data, error } = await admin.from("journey_tasks")
        .select("id, title, due_on, status, account_id")
        .eq("tenant_id", ctx.tenantId).eq("owner_user_id", ctx.userId).eq("status", "open")
        .not("due_on", "is", null).lte("due_on", today).limit(100);
      return error ? [] : taskCandidates((data ?? []) as Record<string, unknown>[], today, tz);
    }, []));
  }

  if (canUseObject(ctx, objectDef("invoice"))) {
    jobs.push(safe(async () => {
      const owned = await admin.from("accounts").select("id")
        .eq("tenant_id", ctx.tenantId).eq("owner_user_id", ctx.userId).limit(200);
      const ids = (owned.data ?? []).map((a) => String(a.id));
      if (owned.error || ids.length === 0) return [];
      const { data, error } = await admin.from("invoices")
        .select("id, ref, status, due_date, total, paid_amount")
        .eq("tenant_id", ctx.tenantId).in("account_id", ids).in("status", ["sent", "partial", "overdue"])
        .lt("due_date", today).limit(200);
      return error ? [] : invoiceCandidates((data ?? []) as Record<string, unknown>[], today, tz);
    }, []));
  }

  // The inbox is a Nova surface; a workspace without it has no mention to act on.
  if (ctx.email && (ctx.features.next_experience === true || ctx.features.spectacular_theme === true)) {
    jobs.push(safe(async () => {
      const { data, error } = await admin.from("record_comments")
        .select("id, object_type, object_id, created_at")
        .eq("tenant_id", ctx.tenantId).contains("mentions", [ctx.email!.toLowerCase()])
        .order("created_at", { ascending: false }).limit(30);
      const rows = (data ?? []) as Record<string, unknown>[];
      if (error || rows.length === 0) return [];
      const reads = await admin.from("nova_inbox_reads").select("comment_id")
        .eq("tenant_id", ctx.tenantId).eq("user_id", ctx.userId);
      const readIds = new Set((reads.data ?? []).map((r) => String(r.comment_id)));
      return mentionCandidates(rows, readIds, today, tz, (def) => canUseObject(ctx, def));
    }, []));
  }

  if (ctx.features.wfm === true && canViewWorkcenter(ctx.perms, "wfm") && ctx.wfm?.isSupervisor) {
    jobs.push(safe(async () => {
      const [leave, correction, overtime] = await Promise.all([
        safe(() => queueSummary(admin, ctx, win, "wfm_leave_requests", "created_at"), undefined),
        safe(() => queueSummary(admin, ctx, win, "wfm_correction_requests", "created_at"), undefined),
        safe(() => queueSummary(admin, ctx, win, "wfm_ot_sessions", "started_at"), undefined),
      ]);
      return wfmCandidates({ leave, correction, overtime });
    }, []));
  }

  if (ctx.isAdmin && ctx.features.integration_middleware === true) {
    jobs.push(safe(async () => {
      const since = new Date(now.getTime() - DAY).toISOString();
      const { data, count, error } = await admin.from("integration_messages")
        .select("created_at", { count: "exact" })
        .eq("tenant_id", ctx.tenantId).eq("status", "failed").gte("created_at", since)
        .order("created_at", { ascending: true }).limit(1);
      if (error || !count) return [];
      const left = daysFromToday(today, (data?.[0] as Record<string, unknown> | undefined)?.created_at, tz);
      return syncCandidates({ count, oldestDays: left === null ? 0 : Math.max(0, -left) });
    }, []));
  }

  return (await Promise.all(jobs)).flat();
}
