import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSchemaPending } from "@/lib/marketing/pending";
import { isHeld, movement, nextStep, reasonLine, weeklySeries, type HistoryPoint, type Movement, type NextStep } from "./insight";
import { isStage, STAGES, type Factor, type IntentRow, type SignalTopic, type Stage, type TopSignal } from "./types";

// What the screens read. Everything comes from the stored rows (account_intent,
// account_intent_history); nothing here scores anything. Every query chains the
// tenant, and a missing table (migration pending) reads as an empty workspace.

const DAY = 86_400_000;
const LIMIT = 1000;

type Ctx = { admin: SupabaseClient; tenantId: string };

export type WorkspaceRow = {
  account_id: string;
  name: string;
  city: string | null;
  industry: string | null;
  owner: string | null;
  score: number;
  stage: Stage;
  reason: string;
  movement: Movement;
  series: number[];
  topics: string[];
  why: TopSignal[];
  next: NextStep;
  computed_at: string;
};

export type Workspace = {
  rows: WorkspaceRow[];
  counts: Record<Stage | "all" | "new", number>;
  /** Accounts that moved up a stage in the last 30 days: the module's one-line claim. */
  moved30: number;
  updatedAt: string | null;
  topics: SignalTopic[];
  pending: boolean;
};

export async function ownerNames(admin: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  try {
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const want = new Set(ids);
    for (const u of data?.users ?? []) if (want.has(u.id) && u.email) out.set(u.id, u.email.split("@")[0]);
  } catch { /* names are a courtesy; the list works without them */ }
  return out;
}

export async function listTopics(c: Ctx): Promise<{ topics: SignalTopic[]; pending: boolean }> {
  const { data, error } = await c.admin.from("signal_topics").select("*").eq("tenant_id", c.tenantId).order("name");
  if (error) return { topics: [], pending: isSchemaPending(error) };
  return { topics: (data ?? []) as SignalTopic[], pending: false };
}

async function history(c: Ctx, accountIds: string[] | null, now: Date, days: number): Promise<Map<string, HistoryPoint[]>> {
  const since = new Date(now.getTime() - days * DAY).toISOString().slice(0, 10);
  const out = new Map<string, HistoryPoint[]>();
  const wanted = accountIds ? new Set(accountIds) : null;
  for (let from = 0; ; from += 1000) {
    let q = c.admin.from("account_intent_history").select("account_id, day, score").eq("tenant_id", c.tenantId).gte("day", since);
    if (accountIds && accountIds.length === 1) q = q.eq("account_id", accountIds[0]);
    const { data, error } = await q.range(from, from + 999);
    if (error) return out;
    for (const r of (data ?? []) as { account_id: string; day: string; score: number }[]) {
      if (wanted && !wanted.has(r.account_id)) continue;
      out.set(r.account_id, [...(out.get(r.account_id) ?? []), { day: r.day, score: r.score }]);
    }
    if ((data ?? []).length < 1000) return out;
  }
}

export async function loadWorkspace(c: Ctx, now: Date = new Date()): Promise<Workspace> {
  const empty: Workspace = { rows: [], counts: { all: 0, new: 0, quiet: 0, looking: 0, comparing: 0, deciding: 0 }, moved30: 0, updatedAt: null, topics: [], pending: false };
  const { data, error } = await c.admin.from("account_intent").select("*").eq("tenant_id", c.tenantId).order("score", { ascending: false }).limit(LIMIT);
  if (error) return { ...empty, pending: isSchemaPending(error) };
  const intents = (data ?? []) as IntentRow[];

  const ids = intents.map((i) => i.account_id);
  const [accounts, hist, topics, run] = await Promise.all([
    ids.length
      ? c.admin.from("accounts").select("id, name, city, industry, owner_user_id").eq("tenant_id", c.tenantId).in("id", ids)
      : Promise.resolve({ data: [] as unknown[] }),
    history(c, ids, now, 60),
    listTopics(c),
    c.admin.from("signal_runs").select("finished_at").eq("tenant_id", c.tenantId).order("finished_at", { ascending: false }).limit(1),
  ]);
  const accountRows = ((accounts.data ?? []) as { id: string; name: string; city: string | null; industry: string | null; owner_user_id: string | null }[]);
  const byId = new Map(accountRows.map((a) => [a.id, a]));
  const owners = await ownerNames(c.admin, [...new Set(accountRows.map((a) => a.owner_user_id).filter((x): x is string => !!x))]);

  const rows: WorkspaceRow[] = [];
  for (const i of intents) {
    const a = byId.get(i.account_id);
    if (!a) continue; // an account that no longer exists (or is not this tenant's) is not listed
    const stage: Stage = isStage(i.stage) ? i.stage : "quiet";
    const series = weeklySeries(hist.get(i.account_id) ?? [], now);
    const top = (i.top_signals ?? []) as TopSignal[];
    rows.push({
      account_id: i.account_id, name: a.name, city: a.city, industry: a.industry,
      owner: a.owner_user_id ? (owners.get(a.owner_user_id) ?? null) : null,
      score: i.score, stage,
      reason: reasonLine(stage, top, isHeld(i.marked_not_in_market_at, now)),
      movement: movement({ stage, previous_stage: i.previous_stage, stage_changed_at: i.stage_changed_at, score: i.score }, series, now),
      series, topics: i.topics ?? [], why: top.slice(0, 2), next: nextStep(stage, top.map((t) => t.kind)), computed_at: i.computed_at,
    });
  }

  const counts: Workspace["counts"] = { all: rows.length, new: 0, quiet: 0, looking: 0, comparing: 0, deciding: 0 };
  let moved30 = 0;
  for (const r of rows) {
    counts[r.stage]++;
    if (r.movement.fresh) counts.new++;
  }
  for (const i of intents) {
    if (!i.stage_changed_at || !i.previous_stage || !byId.has(i.account_id)) continue;
    const inDays = (now.getTime() - new Date(i.stage_changed_at).getTime()) / DAY;
    if (inDays <= 30 && STAGES.indexOf(i.stage) > STAGES.indexOf(i.previous_stage)) moved30++;
  }
  const finished = (run.data as { finished_at: string | null }[] | null)?.find((r) => r.finished_at)?.finished_at ?? null;
  return { rows, counts, moved30, updatedAt: finished, topics: topics.topics, pending: false };
}

export type AccountSignals = {
  account: { id: string; name: string; city: string | null };
  score: number;
  stage: Stage;
  reason: string;
  movement: Movement;
  series: number[];
  factors: Factor[];
  timeline: TopSignal[];
  next: NextStep;
  held: boolean;
  topics: string[];
  computed_at: string | null;
};

/** One account's working: the explainable score, the timeline, the sparkline. Null when the account is not this tenant's. */
export async function loadAccountSignals(c: Ctx, accountId: string, now: Date = new Date()): Promise<AccountSignals | null> {
  const { data: acct } = await c.admin.from("accounts").select("id, name, city").eq("id", accountId).eq("tenant_id", c.tenantId).maybeSingle();
  if (!acct) return null;
  const account = acct as { id: string; name: string; city: string | null };
  const { data, error } = await c.admin.from("account_intent").select("*").eq("tenant_id", c.tenantId).eq("account_id", accountId).maybeSingle();
  const row = error ? null : (data as IntentRow | null);
  const hist = (await history(c, [accountId], now, 60)).get(accountId) ?? [];
  const series = weeklySeries(hist, now);
  if (!row) {
    return {
      account, score: 0, stage: "quiet", reason: reasonLine("quiet", []), series,
      movement: movement({ stage: "quiet", previous_stage: null, stage_changed_at: null, score: 0 }, series, now),
      factors: [], timeline: [], next: nextStep("quiet", []), held: false, topics: [], computed_at: null,
    };
  }
  const stage: Stage = isStage(row.stage) ? row.stage : "quiet";
  const top = (row.top_signals ?? []) as TopSignal[];
  const held = isHeld(row.marked_not_in_market_at, now);
  return {
    account, score: row.score, stage, held, topics: row.topics ?? [], computed_at: row.computed_at,
    reason: reasonLine(stage, top, held), series,
    movement: movement({ stage, previous_stage: row.previous_stage, stage_changed_at: row.stage_changed_at, score: row.score }, series, now),
    factors: (row.factors ?? []) as Factor[], timeline: top, next: nextStep(stage, top.map((t) => t.kind)),
  };
}
