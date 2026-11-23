import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadRevisions, currentRevision } from "@/lib/contractProjects/server";
import { exposureTotals, projectAmount, recordedAmount, round2, type CountedExpense } from "./expenseRules";
import { normaliseExpense, EXPENSE_COLS } from "./expensesServer";
import type { SiteProject } from "./server";
import type { SiteExpense } from "./types";

// What an expense does to its budget line, for the people who manage the money (a site person never sees these figures). "Recorded" is
// computed from approved site expenses and shown beside the line's own Committed and Posted figures; it never writes `actual`, which stays
// "posted by the ERP" only. Posted replaces recorded for an expense the ERP has posted, never both.

export type LineStanding = {
  line_key: string;
  label: string;
  budget: number | null;
  committed: number | null;
  posted: number | null;
  /** Approved expenses on this line, other than the one being looked at. */
  recorded_others: number;
  /** The expense being looked at: counts only once approved. */
  this_one: number;
  currency: string | null;
};

type BudgetRow = { line_key: string; description: string; amount: number; committed: number | null; actual: number | null };

async function approvedLines(admin: SupabaseClient, tenantId: string, projectId: string): Promise<BudgetRow[]> {
  const { rows } = await loadRevisions(admin, tenantId, projectId);
  const revision = rows.filter((r) => r.status === "approved").sort((a, b) => b.rev_no - a.rev_no)[0] ?? currentRevision(rows);
  if (!revision) return [];
  const { data, error } = await admin.from("project_budget_lines").select("line_key, description, amount, committed, actual").eq("tenant_id", tenantId).eq("revision_id", revision.id).limit(5000);
  if (error) return [];
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    line_key: String(r.line_key), description: String(r.description ?? ""), amount: Number(r.amount ?? 0), committed: r.committed == null ? null : Number(r.committed), actual: r.actual == null ? null : Number(r.actual),
  }));
}

async function projectExpenses(admin: SupabaseClient, tenantId: string, projectId: string): Promise<SiteExpense[]> {
  const { data, error } = await admin.from("site_expenses").select(EXPENSE_COLS).eq("tenant_id", tenantId).eq("project_id", projectId).order("expense_date", { ascending: false }).limit(5000);
  return error ? [] : ((data ?? []) as Record<string, unknown>[]).map(normaliseExpense);
}

const counted = (e: SiteExpense): CountedExpense => ({ status: e.status, amount: e.amount, currency: e.currency, amount_project_ccy: e.amount_project_ccy, posted_amount: e.posted_amount, erp_state: e.erp_state });

/** The budget line bar of one expense: budget, committed, posted, recorded by others and this one. Null when it has no cost line yet. */
export async function expenseStanding(admin: SupabaseClient, tenantId: string, project: SiteProject, e: SiteExpense): Promise<LineStanding | null> {
  if (!e.line_key) return null;
  const [lines, all] = await Promise.all([approvedLines(admin, tenantId, project.id), projectExpenses(admin, tenantId, project.id)]);
  const line = lines.find((l) => l.line_key === e.line_key);
  if (!line) return null;
  const others = all.filter((x) => x.line_key === e.line_key && x.id !== e.id).reduce((s, x) => s + recordedAmount(counted(x), project.currency), 0);
  return {
    line_key: line.line_key, label: line.description, budget: line.amount, committed: line.committed, posted: line.actual,
    recorded_others: round2(others), this_one: e.status === "approved" ? round2(recordedAmount(counted(e), project.currency)) : 0, currency: project.currency,
  };
}

export type ProjectExpenseSummary = {
  currency: string | null;
  totals: { waiting: number; recorded: number; posted: number; unconverted: number };
  /** Per cost line with at least one approved or waiting expense: the allocated cost, what is recorded, what waits. */
  byLine: { line_key: string | null; label: string; allocated: number | null; recorded: number; waiting: number }[];
};

/** For the Expenses tab and the Budget tab strip. Money: only for the people who manage the project. */
export async function projectExpenseSummary(admin: SupabaseClient, tenantId: string, project: SiteProject): Promise<ProjectExpenseSummary> {
  const [lines, all] = await Promise.all([approvedLines(admin, tenantId, project.id), projectExpenses(admin, tenantId, project.id)]);
  const active = all.filter((e) => e.status === "submitted" || e.status === "approved");
  const names = new Map(lines.map((l) => [l.line_key, l]));
  const keys = [...new Set(active.map((e) => e.line_key))];
  const byLine = keys.map((k) => {
    const mine = active.filter((e) => e.line_key === k);
    return {
      line_key: k, label: k ? names.get(k)?.description ?? "A line of an older revision" : "Not sure yet", allocated: k ? names.get(k)?.amount ?? null : null,
      recorded: round2(mine.reduce((s, e) => s + recordedAmount(counted(e), project.currency), 0)),
      waiting: round2(mine.filter((e) => e.status === "submitted").reduce((s, e) => s + (projectAmount(counted(e), project.currency) ?? 0), 0)),
    };
  }).sort((a, b) => b.recorded + b.waiting - (a.recorded + a.waiting));
  return { currency: project.currency, totals: exposureTotals(active.map(counted), project.currency), byLine };
}
