import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { plannedMargin } from "./budget";
import { summariseProjects, type ProjectsSummary } from "./summary";
import { isMissingSchema, normaliseProject, normaliseRevision } from "./server";
import { PROJECT_STATUSES, type ProjectRow, type ProjectStatus, type RevisionRow } from "./types";

// The list of contract projects, shared by the list page and GET /api/contract-projects. Header fields and totals only: a project's
// budget lines (unit costs) never leave the project's own screen and its export.

export type ProjectListRow = {
  id: string;
  ref: string | null;
  name: string;
  status: ProjectStatus;
  account_id: string | null;
  account_name: string | null;
  contract_value: number;
  currency: string | null;
  /** The approved budget, else the revision being worked on. Null while there is no revision. */
  budget_total: number | null;
  budget_state: "approved" | "draft" | "pending" | null;
  margin_pct: number | null;
  planned_end: string | null;
  updated_at: string;
};

export const SORTS = ["ref", "name", "status", "contract_value", "budget_total", "margin_pct", "planned_end", "updated_at"] as const;
export type SortKey = (typeof SORTS)[number];

export type ListParams = { status?: string | null; q?: string | null; sort?: string | null; dir?: string | null; page?: number; pageSize?: number };

export async function listProjects(admin: SupabaseClient, tenantId: string, params: ListParams = {}): Promise<{ rows: ProjectListRow[]; total: number; counts: Record<string, number>; summary: ProjectsSummary; page: number; pageSize: number; pending: boolean }> {
  const pageSize = Math.max(1, Math.min(100, params.pageSize ?? 25));
  const page = Math.max(1, params.page ?? 1);
  const { data, error } = await admin.from("contract_projects").select("*").eq("tenant_id", tenantId).order("updated_at", { ascending: false }).limit(2000);
  if (error) return { rows: [], total: 0, counts: {}, summary: summariseProjects([]), page, pageSize, pending: isMissingSchema(error) };
  const projects: ProjectRow[] = ((data ?? []) as Record<string, unknown>[]).map(normaliseProject);

  const revisions = new Map<string, RevisionRow[]>();
  if (projects.length > 0) {
    const { data: revs } = await admin.from("project_budget_revisions").select("id, project_id, rev_no, status, total").eq("tenant_id", tenantId).limit(10000);
    for (const r of ((revs ?? []) as Record<string, unknown>[]).map(normaliseRevision)) revisions.set(r.project_id, [...(revisions.get(r.project_id) ?? []), r]);
  }
  const accountIds = [...new Set(projects.map((p) => p.account_id).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  for (let i = 0; i < accountIds.length; i += 200) {
    const { data: accs } = await admin.from("accounts").select("id, name").eq("tenant_id", tenantId).in("id", accountIds.slice(i, i + 200));
    for (const a of (accs ?? []) as { id: string; name: string }[]) names.set(a.id, a.name);
  }

  const all: ProjectListRow[] = projects.map((p) => {
    const revs = revisions.get(p.id) ?? [];
    const shown = revs.find((r) => r.status === "approved") ?? revs.find((r) => r.status === "draft" || r.status === "pending") ?? null;
    const margin = shown ? plannedMargin(p.contract_value, shown.total) : null;
    return {
      id: p.id, ref: p.ref, name: p.name, status: p.status, account_id: p.account_id, account_name: p.account_id ? names.get(p.account_id) ?? null : null,
      contract_value: p.contract_value, currency: p.currency, budget_total: shown ? shown.total : null,
      budget_state: shown ? (shown.status as "approved" | "draft" | "pending") : null, margin_pct: margin?.pct ?? null,
      planned_end: p.planned_end, updated_at: p.updated_at,
    };
  });

  const counts: Record<string, number> = { all: all.length };
  for (const s of PROJECT_STATUSES) counts[s] = all.filter((r) => r.status === s).length;

  const term = (params.q ?? "").trim().toLowerCase();
  let rows = all.filter((r) => (!params.status || params.status === "all" || r.status === params.status)
    && (!term || [r.name, r.ref, r.account_name].some((v) => (v ?? "").toLowerCase().includes(term))));
  const sort = (SORTS as readonly string[]).includes(params.sort ?? "") ? (params.sort as SortKey) : "updated_at";
  const dir = params.dir === "asc" ? 1 : -1;
  rows = [...rows].sort((a, b) => {
    const x = a[sort], y = b[sort];
    if (x === y) return 0;
    if (x === null || x === undefined) return 1;
    if (y === null || y === undefined) return -1;
    return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * dir;
  });
  return { rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, counts, summary: summariseProjects(all), page, pageSize, pending: false };
}
