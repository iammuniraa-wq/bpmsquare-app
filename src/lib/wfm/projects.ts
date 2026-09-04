import "server-only";

import type { createAdminSupabase } from "@/lib/supabase-server";
import type { WfmProjectStatus } from "./types";
import { reparentError, depthOf, type TreeNodeLike } from "./projectTree";

type Admin = ReturnType<typeof createAdminSupabase>;

export const PROJECT_STATUSES: readonly WfmProjectStatus[] = [
  "planned", "active", "on_hold", "completed", "cancelled",
];

export const PROJECT_SELECT =
  "id, ref, name, code, parent_id, account_id, status, start_date, end_date, budget_hours, custom_data";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type ParsedProject =
  | { values: Record<string, unknown> }
  | { error: string };

/**
 * Validate and narrow a project create/update body to an explicit field
 * allowlist (§3b: "explicit PATCH field allowlist"). On update every field is
 * optional; only keys actually present are returned, so a PATCH never
 * silently blanks a column the caller didn't mention.
 *
 * Foreign ids (account_id, parent_id) are shaped here but tenant-verified by
 * the caller against the admin client, per MULTI_TENANT_GUARDRAILS.md.
 */
export async function parseProjectBody(
  body: unknown,
  opts: { required: boolean }
): Promise<ParsedProject> {
  const b = (body ?? {}) as Record<string, unknown>;
  const values: Record<string, unknown> = {};

  const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k);

  if (opts.required || has("name")) {
    const name = typeof b.name === "string" ? b.name.trim() : "";
    if (!name) return { error: "name is required" };
    values.name = name;
  }

  for (const key of ["code"] as const) {
    if (has(key)) {
      const v = b[key];
      values[key] = typeof v === "string" && v.trim() ? v.trim() : null;
    }
  }

  for (const key of ["account_id", "parent_id"] as const) {
    if (has(key)) {
      const v = b[key];
      if (v !== null && typeof v !== "string") return { error: `${key} must be an id or null` };
      values[key] = v || null;
    }
  }

  if (has("status")) {
    if (!PROJECT_STATUSES.includes(b.status as WfmProjectStatus)) {
      return { error: `status must be one of: ${PROJECT_STATUSES.join(", ")}` };
    }
    values.status = b.status;
  }

  for (const key of ["start_date", "end_date"] as const) {
    if (has(key)) {
      const v = b[key];
      if (v !== null && (typeof v !== "string" || !DATE_RE.test(v))) {
        return { error: `${key} must be YYYY-MM-DD or null` };
      }
      values[key] = v || null;
    }
  }

  // An end before the start silently breaks every date-window report that
  // reads it, so it's rejected rather than stored and worked around later.
  const start = (values.start_date ?? null) as string | null;
  const end = (values.end_date ?? null) as string | null;
  if (start && end && end < start) {
    return { error: "end_date can't be before start_date" };
  }

  if (has("budget_hours")) {
    const v = b.budget_hours;
    if (v !== null && (typeof v !== "number" || !Number.isFinite(v) || v < 0)) {
      return { error: "budget_hours must be a non-negative number or null" };
    }
    values.budget_hours = v ?? null;
  }

  if (has("custom_data") && b.custom_data && typeof b.custom_data === "object") {
    // Only cf_ keys, same contract as every other object's PATCH (§3b).
    const cd = Object.fromEntries(
      Object.entries(b.custom_data as Record<string, unknown>).filter(([k]) => k.startsWith("cf_"))
    );
    values.custom_data = cd;
  }

  if (!opts.required && Object.keys(values).length === 0) {
    return { error: "Nothing to update" };
  }
  return { values };
}

/** What a project is linked to. Any combination, any of them empty. */
export type ProjectLinks = { site_ids: string[]; employee_ids: string[]; shift_ids: string[] };

const EMPTY_LINKS: ProjectLinks = { site_ids: [], employee_ids: [], shift_ids: [] };

/**
 * Tenant-verify the ids a project is being linked to, and shape the rows.
 *
 * Sites, people and shifts are all optional and independent -- a project
 * linked to nothing is legitimate, it simply collects no hours automatically.
 * Every id arrives in a request body, so each is checked against its own
 * table WITH the tenant filter before use (MULTI_TENANT_GUARDRAILS.md).
 */
export async function verifyProjectLinks(
  admin: Admin,
  tenantId: string,
  body: unknown
): Promise<{ rows: Record<string, string>[] } | { error: string }> {
  const b = (body ?? {}) as Record<string, unknown>;

  const read = (key: string): string[] | { error: string } => {
    const v = b[key];
    if (v == null) return [];
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
      return { error: `${key} must be an array of ids` };
    }
    return [...new Set(v as string[])];
  };

  const specs: { key: string; table: string; column: string; label: string }[] = [
    { key: "site_ids", table: "wfm_sites", column: "site_id", label: "sites" },
    { key: "employee_ids", table: "employees", column: "employee_id", label: "employees" },
    { key: "shift_ids", table: "wfm_shifts", column: "shift_id", label: "shifts" },
  ];

  const rows: Record<string, string>[] = [];
  for (const spec of specs) {
    const ids = read(spec.key);
    if (!Array.isArray(ids)) return ids;
    if (ids.length === 0) continue;

    const { data: found } = await admin
      .from(spec.table).select("id").eq("tenant_id", tenantId).in("id", ids);
    if ((found ?? []).length !== ids.length) {
      return { error: `One or more ${spec.label} weren't found in this tenant` };
    }
    for (const id of ids) rows.push({ [spec.column]: id });
  }
  return { rows };
}

/** True when the body mentions links at all -- a PATCH that says nothing
 *  about them must leave existing links alone rather than clearing them. */
export function bodyTouchesLinks(body: unknown): boolean {
  const b = (body ?? {}) as Record<string, unknown>;
  return ["site_ids", "employee_ids", "shift_ids"].some((k) =>
    Object.prototype.hasOwnProperty.call(b, k)
  );
}

/** Replace a project's links wholesale. Called only when the body mentions them. */
export async function replaceProjectLinks(
  admin: Admin,
  tenantId: string,
  projectId: string,
  rows: Record<string, string>[]
): Promise<void> {
  await admin.from("wfm_project_links").delete().eq("tenant_id", tenantId).eq("project_id", projectId);
  if (rows.length > 0) {
    await admin.from("wfm_project_links").insert(
      rows.map((r) => ({ ...r, tenant_id: tenantId, project_id: projectId }))
    );
  }
}

/** Everything one project is linked to, split by kind, for the detail screen. */
export async function projectLinks(
  admin: Admin,
  tenantId: string,
  projectId: string
): Promise<ProjectLinks> {
  const { data, error } = await admin
    .from("wfm_project_links")
    .select("site_id, employee_id, shift_id")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId);
  if (error) return { ...EMPTY_LINKS };

  const out: ProjectLinks = { site_ids: [], employee_ids: [], shift_ids: [] };
  for (const r of data ?? []) {
    if (r.site_id) out.site_ids.push(r.site_id as string);
    else if (r.employee_id) out.employee_ids.push(r.employee_id as string);
    else if (r.shift_id) out.shift_ids.push(r.shift_id as string);
  }
  return out;
}

/** How many things each project is linked to -- the list screen shows this so
 *  a project that will never collect anything is obvious at a glance. */
export async function projectLinkCounts(
  admin: Admin,
  tenantId: string,
  projectIds: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (projectIds.length === 0) return counts;
  const { data } = await admin
    .from("wfm_project_links")
    .select("project_id")
    .eq("tenant_id", tenantId)
    .in("project_id", projectIds);
  for (const r of data ?? []) {
    const k = r.project_id as string;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

/** Every project row this tenant has, as bare tree nodes. Small by nature --
 *  a tenant has tens of projects, not thousands -- and the hierarchy rules
 *  need the whole shape to detect cycles and measure a subtree. */
export async function loadTree(admin: Admin, tenantId: string): Promise<TreeNodeLike[]> {
  const { data, error } = await admin
    .from("wfm_projects")
    .select("id, parent_id")
    .eq("tenant_id", tenantId);
  if (error) return [];
  return (data ?? []).map((r) => ({ id: r.id as string, parent_id: (r.parent_id as string | null) ?? null }));
}

/**
 * Whether this project may sit under this parent, given the tenant's
 * configured levels. `childId` is null when creating, since a new project has
 * no subtree to carry with it.
 *
 * Returns an error string for a 400, or null when allowed.
 */
export function validateParent(
  tree: TreeNodeLike[],
  levels: string[],
  parentId: string | null,
  childId: string | null
): string | null {
  if (!parentId) return null;
  if (childId) return reparentError(tree, levels, childId, parentId);

  // Creating: only the parent's own depth matters.
  const byId = new Map(tree.map((t) => [t.id, t]));
  const parentDepth = depthOf(byId, parentId);
  if (parentDepth === null) return "That parent is not reachable";
  if (parentDepth >= levels.length) {
    return levels.length === 0
      ? "Sub-items aren't switched on for this workspace"
      : `That is already the deepest level (${levels[levels.length - 1]})`;
  }
  return null;
}
