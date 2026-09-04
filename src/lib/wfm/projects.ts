import "server-only";

import type { createAdminSupabase } from "@/lib/supabase-server";
import type { WfmProjectStatus } from "./types";

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

/**
 * Tenant-verify the site ids a project is being linked to and shape the
 * date-effective rows. `from_date` defaults to the project's start date, or
 * today when it has none -- a link has to start somewhere, and backdating it
 * to the epoch would make the site-default fallback claim historical punches
 * that were never this project's.
 */
export async function verifyProjectSites(
  admin: Admin,
  tenantId: string,
  siteIds: unknown,
  startDate: string | null
): Promise<{ rows: { site_id: string; from_date: string; to_date: null }[] } | { error: string }> {
  if (siteIds == null) return { rows: [] };
  if (!Array.isArray(siteIds) || siteIds.some((s) => typeof s !== "string")) {
    return { error: "site_ids must be an array of site ids" };
  }
  const ids = [...new Set(siteIds as string[])];
  if (ids.length === 0) return { rows: [] };

  const { data: found } = await admin
    .from("wfm_sites").select("id").eq("tenant_id", tenantId).in("id", ids);
  if ((found ?? []).length !== ids.length) {
    return { error: "One or more sites weren't found in this tenant" };
  }

  const from = startDate ?? new Date().toISOString().slice(0, 10);
  return { rows: ids.map((site_id) => ({ site_id, from_date: from, to_date: null })) };
}

/** The site ids currently linked to each of these projects, for list display. */
export async function projectSiteMap(
  admin: Admin,
  tenantId: string,
  projectIds: string[]
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (projectIds.length === 0) return map;
  const { data } = await admin
    .from("wfm_project_sites")
    .select("project_id, site_id")
    .eq("tenant_id", tenantId)
    .in("project_id", projectIds);
  for (const row of data ?? []) {
    const key = row.project_id as string;
    map.set(key, [...(map.get(key) ?? []), row.site_id as string]);
  }
  return map;
}
