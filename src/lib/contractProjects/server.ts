import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase, requireTenantUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { canEditWorkcenter, canViewWorkcenter, resolvePermissions } from "@/lib/permissions";
import { isMissingSchema } from "@/lib/tender/server";
import { budgetTotals, lineAmount, round2 } from "./budget";
import {
  JUSTIFICATION_SEEDS, MASTERFORMAT_DIVISIONS, MASTERFORMAT_SECTIONS, MATERIAL_GROUP_SEEDS, RESOURCE_SEEDS, isMasterKind,
  type BudgetLine, type DraftLine, type MasterKind, type MasterRow, type ProjectRow, type RevisionRow,
} from "./types";

// Shared plumbing of the /api/contract-projects* routes and the pages (migration 0226). Every query is tenant-scoped on the admin
// client (MULTI_TENANT_GUARDRAILS.md) and every one tolerates the migration being pending: a missing table or column reads as
// "database update needed", never as a crash. Nothing here runs for a workspace without the platform-admin flag
// `contract_projects` (plus `gcc_tender`): the gate answers 404 first.

export const CONTRACT_PROJECTS_BUNDLE = "scripts/run-bundle-36-contract-projects-2026-10-26.sql";
export const APPROVAL_BUNDLE = "scripts/run-bundle-32-tender-approval-and-room-2026-10-25.sql";
export { isMissingSchema };

export type ProjectCtx = {
  admin: SupabaseClient;
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  role: "admin" | "member";
  canEdit: boolean;
};
export type Failure = { status: number; error: string; extra?: Record<string, unknown> };

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const needsUpdate = (): Failure => ({
  status: 503, error: "A database update is needed before contract projects can be used. Ask your administrator to apply it.",
  extra: { needsDatabaseUpdate: true, bundle: CONTRACT_PROJECTS_BUNDLE },
});

/**
 * The gate every route starts with: a signed-in member of a workspace that owns the module (and the tender edition it needs), who
 * may open Contract Projects. `write` also needs the edit grant and `admin` the workspace admin. Any miss on the module is a plain
 * 404, so a workspace without it cannot tell the module exists.
 */
export async function openProjectRequest(opts: { write?: boolean; admin?: boolean } = {}): Promise<{ ok: true; req: ProjectCtx } | ({ ok: false } & Failure)> {
  let ctx;
  try {
    ctx = await requireTenantUser();
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return { ok: false, status: err.status ?? 401, error: err.message ?? "Unauthorized" };
  }
  const { supabase, tenantId, userId, role } = ctx;
  const notFound = { ok: false as const, status: 404, error: "Not found" };
  for (const key of ["contract_projects", "gcc_tender"] as const) {
    if (!(await tenantHasFeature(supabase, tenantId, key))) return notFound;
  }
  const perms = await resolvePermissions(supabase, tenantId, userId, role);
  if (!canViewWorkcenter(perms, "contract_projects")) return notFound;
  const canEdit = canEditWorkcenter(perms, "contract_projects");
  if (opts.admin && role !== "admin") return { ok: false, status: 403, error: "Only a workspace admin can do this" };
  if (opts.write && !canEdit) return { ok: false, status: 403, error: "You can view contract projects but not change them" };
  return { ok: true, req: { admin: createAdminSupabase(), supabase, tenantId, userId, role, canEdit } };
}

// ── Reads ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const PROJECT_COLS = "id, tenant_id, ref, name, account_id, source_opportunity_id, status, contract_value, currency, planned_start, planned_end, manager_id, erp_system, erp_id, custom_data, created_by, created_at, updated_at";
const REVISION_COLS = "id, project_id, rev_no, status, justification_code, justification_text, created_by, created_at, approved_by, approved_at, locked_at, total";
const LINE_COLS = "id, line_no, line_key, resource_code, cost_code, wbs, description, qty, unit, unit_cost, amount, cost_known, source_ref, reserve, committed, actual";

export const normaliseProject = (r: Record<string, unknown>): ProjectRow => ({ ...(r as unknown as ProjectRow), contract_value: Number(r.contract_value ?? 0) });
export const normaliseRevision = (r: Record<string, unknown>): RevisionRow => ({ ...(r as unknown as RevisionRow), rev_no: Number(r.rev_no ?? 0), total: Number(r.total ?? 0) });
export const normaliseLine = (r: Record<string, unknown>): BudgetLine => ({
  ...(r as unknown as BudgetLine), line_no: Number(r.line_no ?? 0), qty: Number(r.qty ?? 0), unit_cost: Number(r.unit_cost ?? 0), amount: Number(r.amount ?? 0),
  cost_known: r.cost_known !== false, reserve: r.reserve === true,
  committed: r.committed == null ? null : Number(r.committed), actual: r.actual == null ? null : Number(r.actual),
});

export async function loadProject(admin: SupabaseClient, tenantId: string, id: string): Promise<{ kind: "ok"; project: ProjectRow } | { kind: "missing" } | { kind: "pending" }> {
  if (!UUID_RE.test(id)) return { kind: "missing" };
  const { data, error } = await admin.from("contract_projects").select(PROJECT_COLS).eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (error) return isMissingSchema(error) ? { kind: "pending" } : { kind: "missing" };
  return data ? { kind: "ok", project: normaliseProject(data as Record<string, unknown>) } : { kind: "missing" };
}

export async function loadProjectBySource(admin: SupabaseClient, tenantId: string, opportunityId: string): Promise<{ id: string; ref: string | null } | null> {
  const { data } = await admin.from("contract_projects").select("id, ref").eq("tenant_id", tenantId).eq("source_opportunity_id", opportunityId).maybeSingle();
  return (data as { id: string; ref: string | null } | null) ?? null;
}

export async function loadRevisions(admin: SupabaseClient, tenantId: string, projectId: string): Promise<{ rows: RevisionRow[]; pending: boolean }> {
  const { data, error } = await admin.from("project_budget_revisions").select(REVISION_COLS).eq("tenant_id", tenantId).eq("project_id", projectId).order("rev_no", { ascending: true }).limit(500);
  if (error) return { rows: [], pending: isMissingSchema(error) };
  return { rows: ((data ?? []) as Record<string, unknown>[]).map(normaliseRevision), pending: false };
}

export async function loadRevision(admin: SupabaseClient, tenantId: string, projectId: string, revisionId: string): Promise<RevisionRow | null> {
  if (!UUID_RE.test(revisionId)) return null;
  const { data } = await admin.from("project_budget_revisions").select(REVISION_COLS).eq("id", revisionId).eq("tenant_id", tenantId).eq("project_id", projectId).maybeSingle();
  return data ? normaliseRevision(data as Record<string, unknown>) : null;
}

/** The revision a screen opens on: the one being worked on (draft or waiting), else the approved baseline, else the newest. */
export function currentRevision(revisions: readonly RevisionRow[]): RevisionRow | null {
  return revisions.find((r) => r.status === "draft" || r.status === "pending") ?? revisions.find((r) => r.status === "approved") ?? revisions[revisions.length - 1] ?? null;
}

export async function loadLines(admin: SupabaseClient, tenantId: string, revisionId: string): Promise<BudgetLine[]> {
  const { data, error } = await admin.from("project_budget_lines").select(LINE_COLS).eq("tenant_id", tenantId).eq("revision_id", revisionId).order("line_no", { ascending: true }).limit(5000);
  if (error) return [];
  return ((data ?? []) as Record<string, unknown>[]).map(normaliseLine);
}

// ── The code lists ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * First use: the STARTER lists (source 'default'), only where a kind has NO row at all for the workspace, and with ignore-duplicates
 * so a code a person already edited is never touched. They are the eight resource levels with material sub-groups, the MasterFormat
 * divisions and a few sections as cost codes, and the justification reasons; a file import replaces or extends them (matched on
 * kind + code). A missing table is not an error.
 */
type SeedRow = { code: string; name: string; parent_code?: string | null; flags?: Record<string, boolean> };
export const STARTER_LISTS: { kind: MasterKind; rows: SeedRow[] }[] = [
  {
    kind: "resource",
    rows: [
      ...RESOURCE_SEEDS.map((r) => ({ code: r.code, name: r.name, flags: { ...r.flags } as Record<string, boolean> })),
      ...MATERIAL_GROUP_SEEDS.map((r) => ({ code: r.code, name: r.name, parent_code: r.parent })),
    ],
  },
  {
    kind: "cost_code",
    rows: [
      ...MASTERFORMAT_DIVISIONS.map((d) => ({ code: d.code, name: d.name })),
      ...MASTERFORMAT_SECTIONS.map((s) => ({ code: s.code, name: s.name, parent_code: s.parent })),
    ],
  },
  { kind: "justification", rows: JUSTIFICATION_SEEDS.map((r) => ({ code: r.code, name: r.name })) },
];

export async function ensureMasterSeeds(admin: SupabaseClient, tenantId: string): Promise<void> {
  for (const s of STARTER_LISTS) {
    const { data, error } = await admin.from("erp_masters").select("id").eq("tenant_id", tenantId).eq("kind", s.kind).limit(1);
    if (error || (data ?? []).length > 0) continue;
    await admin.from("erp_masters").upsert(
      s.rows.map((r) => ({ tenant_id: tenantId, kind: s.kind, code: r.code, name: r.name, parent_code: r.parent_code ?? null, flags: r.flags ?? {}, source: "default", active: true })),
      { onConflict: "tenant_id,kind,code", ignoreDuplicates: true },
    );
  }
}

export const MASTER_COLS = "id, kind, code, name, parent_code, flags, source, active";

export async function loadMasters(admin: SupabaseClient, tenantId: string, kind: MasterKind, opts: { activeOnly?: boolean } = {}): Promise<MasterRow[]> {
  const out: MasterRow[] = [];
  for (let from = 0; from < 50_000; from += 1000) {
    let q = admin.from("erp_masters").select(MASTER_COLS).eq("tenant_id", tenantId).eq("kind", kind).order("code", { ascending: true }).range(from, from + 999);
    if (opts.activeOnly) q = q.eq("active", true);
    const { data, error } = await q;
    if (error) break;
    const batch = (data ?? []) as MasterRow[];
    out.push(...batch);
    if (batch.length < 1000) break;
  }
  return out;
}

/** Which of `codes` exist (and are active) in the workspace's list of this kind. Batched so a long list never makes one huge query. */
export async function existingCodes(admin: SupabaseClient, tenantId: string, kind: MasterKind, codes: readonly string[]): Promise<Set<string>> {
  const wanted = [...new Set(codes.filter(Boolean))];
  const found = new Set<string>();
  for (let i = 0; i < wanted.length; i += 100) {
    const { data } = await admin.from("erp_masters").select("code").eq("tenant_id", tenantId).eq("kind", kind).eq("active", true).in("code", wanted.slice(i, i + 100));
    for (const r of (data ?? []) as { code: string }[]) found.add(r.code);
  }
  return found;
}

/** The workspace's cost-side resource codes: every active resource that is not on the income side. */
export async function costResourceCodes(admin: SupabaseClient, tenantId: string): Promise<Set<string>> {
  const all = await loadMasters(admin, tenantId, "resource", { activeOnly: true });
  return new Set(all.filter((r) => r.flags?.revenue_side !== true).map((r) => r.code));
}

export async function memberInTenant(admin: SupabaseClient, tenantId: string, userId: string): Promise<boolean> {
  const { data } = await admin.from("tenant_users").select("user_id").eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle();
  return !!data;
}

// ── Writes ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export type LineCheck = { ok: true } | { ok: false; status: number; error: string };

/** Resource and cost codes of a set of lines must be in this workspace's lists (cost side only for a resource). */
export async function checkLineCodes(admin: SupabaseClient, tenantId: string, lines: readonly DraftLine[]): Promise<LineCheck> {
  const resources = await costResourceCodes(admin, tenantId);
  const badResource = [...new Set(lines.map((l) => l.resource_code).filter((c): c is string => !!c && !resources.has(c)))];
  if (badResource.length > 0) return { ok: false, status: 422, error: `Not a resource type in your list: ${badResource.slice(0, 5).join(", ")}` };
  const costCodes = lines.map((l) => l.cost_code).filter((c): c is string => !!c);
  const known = await existingCodes(admin, tenantId, "cost_code", costCodes);
  const badCode = [...new Set(costCodes.filter((c) => !known.has(c)))];
  if (badCode.length > 0) return { ok: false, status: 422, error: `Not a cost code in your list: ${badCode.slice(0, 5).join(", ")}` };
  return { ok: true };
}

/** Rows ready to insert: the amount is recomputed here, line numbers are 1..n in the order given, and a new line gets a fresh key. */
export function lineRows(tenantId: string, projectId: string, revisionId: string, lines: readonly DraftLine[]): Record<string, unknown>[] {
  return lines.map((l, i) => ({
    tenant_id: tenantId, project_id: projectId, revision_id: revisionId, line_no: i + 1, line_key: l.line_key || randomUUID(),
    resource_code: l.resource_code, cost_code: l.cost_code, wbs: l.wbs, description: l.description, qty: l.qty, unit: l.unit,
    unit_cost: l.unit_cost, amount: lineAmount(l.qty, l.unit_cost), cost_known: l.cost_known, source_ref: l.source_ref, reserve: l.reserve,
  }));
}

export async function insertLines(admin: SupabaseClient, rows: Record<string, unknown>[]): Promise<{ message: string } | null> {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from("project_budget_lines").insert(rows.slice(i, i + 500));
    if (error) return { message: error.message };
  }
  return null;
}

/** The total of a revision, from its lines, written back so a list can show it without reading every line. */
export async function refreshRevisionTotal(admin: SupabaseClient, tenantId: string, revisionId: string, lines?: readonly Pick<BudgetLine, "amount" | "resource_code" | "cost_code" | "cost_known" | "reserve">[]): Promise<number> {
  const rows = lines ?? (await loadLines(admin, tenantId, revisionId));
  const total = budgetTotals(rows).total;
  await admin.from("project_budget_revisions").update({ total }).eq("id", revisionId).eq("tenant_id", tenantId);
  return total;
}

/**
 * Replace the lines of a revision with a new set. The new rows go in first and the old ones are removed by id afterwards, so a
 * failed insert leaves the old budget exactly as it was; a failed removal takes the new rows out again.
 */
export async function replaceLines(admin: SupabaseClient, tenantId: string, projectId: string, revisionId: string, lines: readonly DraftLine[]): Promise<{ ok: true; total: number } | { ok: false; error: string }> {
  const { data: oldRows, error: readErr } = await admin.from("project_budget_lines").select("id").eq("tenant_id", tenantId).eq("revision_id", revisionId).limit(6000);
  if (readErr) return { ok: false, error: readErr.message };
  const oldIds = ((oldRows ?? []) as { id: string }[]).map((r) => r.id);
  const rows: (Record<string, unknown> & { id: string })[] = lineRows(tenantId, projectId, revisionId, lines).map((r) => ({ ...r, id: randomUUID() }));
  const failed = await insertLines(admin, rows);
  if (failed) {
    await admin.from("project_budget_lines").delete().eq("tenant_id", tenantId).eq("revision_id", revisionId).in("id", rows.map((r) => r.id));
    return { ok: false, error: failed.message };
  }
  for (let i = 0; i < oldIds.length; i += 200) {
    const { error } = await admin.from("project_budget_lines").delete().eq("tenant_id", tenantId).eq("revision_id", revisionId).in("id", oldIds.slice(i, i + 200));
    if (error) {
      await admin.from("project_budget_lines").delete().eq("tenant_id", tenantId).eq("revision_id", revisionId).in("id", rows.map((r) => r.id));
      return { ok: false, error: error.message };
    }
  }
  const total = round2(rows.reduce((s, r) => s + Number(r.amount), 0));
  await admin.from("project_budget_revisions").update({ total }).eq("id", revisionId).eq("tenant_id", tenantId);
  return { ok: true, total };
}

export { isMasterKind };
