import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingSchema } from "./server";
import type { WorkPackageRow } from "./types";

import { readAllPages } from "@/lib/pagedRead";
// Reads of the work breakdown (WBS) of a project (migration 0240). Every query is tenant-scoped on the service-role client and tolerates the
// migration being pending: a missing table reads as `pending` with no packages, never as a crash. The writes are in allocationServer.ts.

const PACKAGE_COLS = "id, code, name, owner_employee_id, allocated_cost, sort_order, note";

export type PackagesData = { packages: WorkPackageRow[]; pending: boolean };

export async function loadPackages(admin: SupabaseClient, tenantId: string, projectId: string): Promise<PackagesData> {
  const { data, error } = await admin.from("project_work_packages").select(PACKAGE_COLS).eq("tenant_id", tenantId).eq("project_id", projectId).order("sort_order", { ascending: true }).order("code", { ascending: true }).limit(500);
  if (error) return { packages: [], pending: isMissingSchema(error) };
  const rows = (data ?? []) as { id: string; code: string; name: string; owner_employee_id: string | null; allocated_cost: number | string | null; sort_order: number; note: string | null }[];
  if (rows.length === 0) return { packages: [], pending: false };

  const links = await readAllPages((lo, hi) => admin.from("project_work_package_lines").select("package_id, line_key, sort_order").eq("tenant_id", tenantId).eq("project_id", projectId).order("sort_order", { ascending: true }).order("id", { ascending: true }).range(lo, hi));
  const keysOf = new Map<string, string[]>();
  for (const l of ((links.error ? [] : links.data ?? []) as { package_id: string; line_key: string }[])) keysOf.set(l.package_id, [...(keysOf.get(l.package_id) ?? []), l.line_key]);

  const names = await employeeNames(admin, tenantId, rows.map((r) => r.owner_employee_id));
  return {
    pending: false,
    packages: rows.map((r) => ({
      id: r.id, code: r.code, name: r.name, owner_employee_id: r.owner_employee_id, owner_name: r.owner_employee_id ? names.get(r.owner_employee_id) ?? null : null,
      allocated_cost: r.allocated_cost == null ? null : Number(r.allocated_cost), sort_order: Number(r.sort_order ?? 0), note: r.note, line_keys: keysOf.get(r.id) ?? [],
    })),
  };
}

export async function loadPackage(admin: SupabaseClient, tenantId: string, projectId: string, packageId: string): Promise<WorkPackageRow | null> {
  const { packages } = await loadPackages(admin, tenantId, projectId);
  return packages.find((p) => p.id === packageId) ?? null;
}

async function employeeNames(admin: SupabaseClient, tenantId: string, ids: readonly (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))];
  const out = new Map<string, string>();
  for (let i = 0; i < wanted.length; i += 100) {
    const { data } = await admin.from("employees").select("id, first_name, last_name").eq("tenant_id", tenantId).in("id", wanted.slice(i, i + 100));
    for (const e of (data ?? []) as { id: string; first_name: string | null; last_name: string | null }[]) out.set(e.id, [e.first_name, e.last_name].filter(Boolean).join(" ") || "Employee");
  }
  return out;
}

export type EmployeeChoice = { id: string; name: string; code: string | null; email: string | null; has_login: boolean };

/** Active employees of the workspace, and whether each has a login (a tenant member linked to the employee): only those with one can own a package. */
export async function loadEmployeeChoices(admin: SupabaseClient, tenantId: string): Promise<EmployeeChoice[]> {
  const [emps, logins] = await Promise.all([
    readAllPages((lo, hi) => admin.from("employees").select("id, first_name, last_name, employee_code, email").eq("tenant_id", tenantId).eq("status", "active").order("last_name", { ascending: true }).order("id", { ascending: true }).range(lo, hi)),
    readAllPages((lo, hi) => admin.from("tenant_users").select("employee_id, user_id").eq("tenant_id", tenantId).not("employee_id", "is", null).order("user_id", { ascending: true }).range(lo, hi)),
  ]);
  const withLogin = new Set(((logins.error ? [] : logins.data ?? []) as { employee_id: string | null }[]).map((l) => l.employee_id).filter((x): x is string => !!x));
  return ((emps.error ? [] : emps.data ?? []) as { id: string; first_name: string | null; last_name: string | null; employee_code: string | null; email: string | null }[]).map((e) => ({
    id: e.id, name: [e.first_name, e.last_name].filter(Boolean).join(" ") || "Employee", code: e.employee_code, email: e.email, has_login: withLogin.has(e.id),
  }));
}

/** Is this employee of THIS workspace, active, and does it have a login? The three answers a package owner must give. */
export async function checkOwner(admin: SupabaseClient, tenantId: string, employeeId: string): Promise<{ ok: true } | { ok: false; status: number; error: string; needs_login?: boolean }> {
  const emp = await admin.from("employees").select("id, first_name, last_name, status").eq("id", employeeId).eq("tenant_id", tenantId).maybeSingle();
  if (emp.error || !emp.data) return { ok: false, status: 404, error: "Employee not found" };
  const e = emp.data as { first_name: string | null; last_name: string | null; status: string };
  const name = [e.first_name, e.last_name].filter(Boolean).join(" ") || "That employee";
  if (e.status !== "active") return { ok: false, status: 422, error: `${name} is not active` };
  const login = await admin.from("tenant_users").select("user_id").eq("tenant_id", tenantId).eq("employee_id", employeeId).limit(1);
  if (login.error || (login.data ?? []).length === 0) return { ok: false, status: 422, error: `${name} has no login. Create a login first, then assign the package`, needs_login: true };
  return { ok: true };
}

