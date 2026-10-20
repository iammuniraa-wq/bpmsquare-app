import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PreparedUpdate } from "@/lib/import/updateServer";
import type { RowOutcome } from "@/lib/import/types";
import { isGoalMetric, isKind, isProgramStatus, isRole, isTier } from "./types";

// Shared pieces of the three ABM Data Workbench Update routes. Update always
// matches on the row's real id, never on a name or ref (bpmsquarecore section 3),
// and only touches the columns each route lists. Progress is not one of them: a
// manual progress change needs a reason, so it is made on the screen.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type Normalised = { ok: true; value: unknown } | { ok: false; reason: string };

const bad = (reason: string): Normalised => ({ ok: false, reason });
const ok = (value: unknown): Normalised => ({ ok: true, value });

export const NORMALISE: Record<string, (raw: string) => Normalised> = {
  name: (v) => (v.trim() ? ok(v.trim().slice(0, 160)) : bad("Name cannot be empty")),
  kind: (v) => (isKind(v.trim()) ? ok(v.trim()) : bad("Kind must be new_business or expansion")),
  status: (v) => (isProgramStatus(v.trim()) ? ok(v.trim()) : bad("Status must be draft, active, paused, completed or archived")),
  goal: (v) => ok(v.trim() ? v.trim().slice(0, 400) : null),
  goal_metric: (v) => (isGoalMetric(v.trim()) ? ok(v.trim()) : bad("Goal metric must be deals_won, deals_opened, accounts_engaged or revenue")),
  goal_target: (v) => { if (!v.trim()) return ok(null); const n = Number(v); return Number.isFinite(n) && n >= 0 ? ok(n) : bad("Goal target must be a number"); },
  starts_on: (v) => (!v.trim() ? ok(null) : DATE_RE.test(v.trim()) ? ok(v.trim()) : bad("Dates must look like 2027-01-31")),
  ends_on: (v) => (!v.trim() ? ok(null) : DATE_RE.test(v.trim()) ? ok(v.trim()) : bad("Dates must look like 2027-01-31")),
  next_step_due: (v) => (!v.trim() ? ok(null) : DATE_RE.test(v.trim()) ? ok(v.trim()) : bad("Dates must look like 2027-01-31")),
  next_step: (v) => ok(v.trim() ? v.trim().slice(0, 300) : null),
  default_tier: (v) => (isTier(v.trim()) ? ok(v.trim()) : bad("Tier must be one_to_one, one_to_few or one_to_many")),
  tier: (v) => (isTier(v.trim()) ? ok(v.trim()) : bad("Tier must be one_to_one, one_to_few or one_to_many")),
  role: (v) => (isRole(v.trim()) ? ok(v.trim()) : bad("Role must be decision_maker, influencer, user, blocker or unknown")),
};

/**
 * Turns Update rows into id-matched patches. Custom-field columns (cf_) are
 * merged into the row's existing custom_data (read tenant-filtered), so a file
 * that carries one custom column does not wipe the others.
 */
export async function prepareAbmUpdates(
  supabase: SupabaseClient,
  tenantId: string,
  table: string,
  allowed: readonly string[],
  rows: { rowNum: number; values: Record<string, string> }[],
): Promise<{ prepared: PreparedUpdate[]; outcomes: RowOutcome[] }> {
  const prepared: PreparedUpdate[] = [];
  const outcomes: RowOutcome[] = [];
  const staged: { rowNum: number; id: string; patch: Record<string, unknown>; cf: Record<string, string> }[] = [];

  for (const { rowNum, values } of rows) {
    const id = values.id?.trim();
    if (!id) { outcomes.push({ rowNum, status: "failed", reason: "Record ID is required to update a row" }); continue; }
    const patch: Record<string, unknown> = {};
    let failed: string | null = null;
    for (const key of allowed) {
      if (!(key in values)) continue;
      const n = (NORMALISE[key] ?? ((v: string) => ok(v.trim() || null)))(values[key] ?? "");
      if (!n.ok) { failed = n.reason; break; }
      patch[key] = n.value;
    }
    if (failed) { outcomes.push({ rowNum, status: "failed", reason: failed }); continue; }
    const cf: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) if (k.startsWith("cf_") && v?.trim()) cf[k] = v.trim();
    if (Object.keys(patch).length === 0 && Object.keys(cf).length === 0) { outcomes.push({ rowNum, status: "skipped", reason: "No mapped columns to update" }); continue; }
    staged.push({ rowNum, id, patch, cf });
  }

  const needCf = staged.filter((s) => Object.keys(s.cf).length > 0);
  const existing = new Map<string, Record<string, unknown>>();
  if (needCf.length > 0) {
    const { data } = await supabase.from(table).select("id, custom_data").eq("tenant_id", tenantId).in("id", needCf.map((s) => s.id));
    for (const r of (data ?? []) as { id: string; custom_data: Record<string, unknown> | null }[]) existing.set(r.id, r.custom_data ?? {});
  }
  for (const s of staged) {
    const patch = { ...s.patch, updated_at: new Date().toISOString() };
    if (Object.keys(s.cf).length > 0) {
      (patch as Record<string, unknown>).custom_data = { ...(existing.get(s.id) ?? {}), ...s.cf };
    }
    prepared.push({ rowNum: s.rowNum, id: s.id, patch, diffPatch: Object.fromEntries(Object.entries(patch).filter(([k]) => k !== "updated_at")) });
  }
  return { prepared, outcomes };
}
