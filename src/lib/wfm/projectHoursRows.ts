import "server-only";

import { createAdminSupabase } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { getWfmConfig } from "@/lib/wfm/server";
import { loadProjectSessions } from "@/lib/wfm/projectHoursServer";
import { resolveBillRate, periodsOverlap, round2 } from "@/lib/wfm/billing";
import type { QueryableField } from "@/lib/api/query";

// "Project hours" as a flat, queryable object: ONE ROW PER WORK SESSION,
// tagged with the project it was attributed to (or "Unassigned"), the
// top-level project, the account, the person and what the hour is worth
// at the tenant's rate ladder. This is what makes project costing a thing
// you can ASK about -- "hours by project this month", "billable amount by
// account last quarter", "who worked on Conveyor Retrofit" -- through the
// same single-object engine Talk to data, the dock assistant and
// /api/v1/ask already run on. No join surface: every parent is
// denormalized onto the row.
//
// Cost is deliberately NOT a column. The rows feed the v1 API, and cost
// is internal (same rule as products.cost_price); margin lives on the
// billing preview only.

export const PROJECT_HOURS_FIELDS: QueryableField[] = [
  { path: "date", type: "date" },
  { path: "project.id", type: "string" },
  { path: "project.ref", type: "string", searchable: true },
  { path: "project.name", type: "string", searchable: true },
  { path: "project.level", type: "number" },
  { path: "project.status", type: "string" },
  { path: "top_project.id", type: "string" },
  { path: "top_project.name", type: "string", searchable: true },
  { path: "account.id", type: "string" },
  { path: "account.name", type: "string", searchable: true },
  { path: "employee.id", type: "string", sensitive: true },
  { path: "employee.name", type: "string", searchable: true, sensitive: true },
  { path: "employment_type", type: "string" },
  { path: "minutes", type: "number" },
  { path: "hours", type: "number" },
  { path: "break_minutes", type: "number" },
  { path: "bill_rate", type: "number" },
  { path: "billable_amount", type: "number" },
  { path: "invoiced", type: "boolean" },
  { path: "assigned", type: "boolean" },
];

/** Who worked is personal data. On the v1 API the employee columns are only
 *  for a key explicitly scoped to "employees" (the same rule as
 *  /api/v1/employees); everyone else gets the hours without the person. */
export function redactPeople(
  rows: Record<string, unknown>[],
  fields: QueryableField[],
  allowed: boolean
): { rows: Record<string, unknown>[]; fields: QueryableField[] } {
  if (allowed) return { rows, fields };
  return {
    rows: rows.map((r) => { const { employee: _e, ...rest } = r; void _e; return rest; }),
    fields: fields.filter((f) => !f.path.startsWith("employee.")),
  };
}

const LOOKBACK_DAYS = 366;

export async function loadProjectHoursRows(tenantId: string): Promise<Record<string, unknown>[]> {
  const admin = createAdminSupabase();
  if (!(await tenantHasFeature(admin, tenantId, "wfm_projects"))) return [];

  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);

  const [config, loaded, { data: projects }, { data: employees }, { data: billed }] = await Promise.all([
    getWfmConfig(admin, tenantId),
    loadProjectSessions(admin, tenantId, from, to, null),
    admin.from("wfm_projects").select("id, ref, name, parent_id, account_id, status, bill_rate").eq("tenant_id", tenantId),
    admin.from("employees").select("id, first_name, last_name, employee_code, employment_type").eq("tenant_id", tenantId),
    admin.from("wfm_project_invoices").select("project_id, period_from, period_to, invoices!inner(status)").eq("tenant_id", tenantId),
  ]);
  if ("pending_migration" in loaded) return [];

  type P = { id: string; ref: string | null; name: string; parent_id: string | null; account_id: string | null; status: string; bill_rate: number | null };
  const byId = new Map(((projects ?? []) as P[]).map((p) => [p.id, p]));
  const accountIds = [...new Set([...byId.values()].map((p) => p.account_id).filter((x): x is string => !!x))];
  const { data: accounts } = accountIds.length
    ? await admin.from("accounts").select("id, name").eq("tenant_id", tenantId).in("id", accountIds)
    : { data: [] as { id: string; name: string }[] };
  const accountName = new Map((accounts ?? []).map((a) => [a.id as string, a.name as string]));
  const empById = new Map((employees ?? []).map((e) => [e.id as string, e]));

  const chain = (id: string): { ids: string[]; rates: (number | null)[] } => {
    const ids: string[] = [];
    const rates: (number | null)[] = [];
    let cur: string | null = id;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const p = byId.get(cur);
      if (!p) break;
      ids.push(cur);
      rates.push(p.bill_rate ?? null);
      cur = p.parent_id;
    }
    return { ids, rates };
  };

  // Billed periods, ignoring cancelled invoices, keyed by project so a
  // session's "invoiced" flag walks its own ancestors (a parent's invoice
  // covers the child's hours).
  const billedByProject = new Map<string, { from: string; to: string }[]>();
  for (const b of billed ?? []) {
    const inv = (Array.isArray(b.invoices) ? b.invoices[0] : b.invoices) as { status: string } | null;
    if (inv?.status === "cancelled") continue;
    const pid = b.project_id as string;
    billedByProject.set(pid, [...(billedByProject.get(pid) ?? []), { from: b.period_from as string, to: b.period_to as string }]);
  }

  const rows: Record<string, unknown>[] = [];
  for (const emp of loaded.sessions) {
    const e = empById.get(emp.employee_id);
    const name = e ? [e.first_name, e.last_name].filter(Boolean).join(" ") : "Unknown";
    const type = (e?.employment_type as string | null) ?? null;
    for (const s of emp.sessions) {
      const minutes = config.deduct_breaks ? s.net_minutes : s.gross_minutes;
      if (minutes <= 0) continue;
      const date = s.in.slice(0, 10);
      const p = s.project_id ? byId.get(s.project_id) : undefined;
      const { ids, rates } = p ? chain(p.id) : { ids: [], rates: [] };
      const top = ids.length ? byId.get(ids[ids.length - 1]) : undefined;
      const rate = p ? resolveBillRate(rates, type, config.costing).rate : 0;
      const invoiced = ids.some((id) => (billedByProject.get(id) ?? []).some((b) => periodsOverlap(date, date, b.from, b.to)));
      const accountId = top?.account_id ?? p?.account_id ?? null;
      rows.push({
        id: `${emp.employee_id}:${s.in}`,
        date,
        project: p
          ? { id: p.id, ref: p.ref, name: p.name, level: ids.length - 1, status: p.status }
          : { id: null, ref: null, name: "Unassigned", level: null, status: null },
        top_project: top ? { id: top.id, name: top.name } : { id: null, name: p ? p.name : "Unassigned" },
        account: { id: accountId, name: accountId ? (accountName.get(accountId) ?? null) : null },
        employee: { id: emp.employee_id, name, code: e?.employee_code ?? null },
        employment_type: type,
        minutes,
        hours: round2(minutes / 60),
        break_minutes: s.break_minutes,
        bill_rate: rate,
        billable_amount: p ? round2((minutes / 60) * rate) : 0,
        invoiced,
        assigned: !!p,
      });
    }
  }
  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return rows;
}
