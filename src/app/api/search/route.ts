import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { globalSearch } from "@/lib/data";
import { resolvePermissions, toViewableWorkcenters } from "@/lib/permissions";
import { allowedSearchTypes, getSearchObject, type SearchObjectType } from "@/lib/globalSearch";

export async function GET(request: NextRequest) {
  let supabase, tenantId, userId, role;
  try {
    ({ supabase, tenantId, userId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";
  const typeParam = searchParams.get("type") ?? undefined;
  const objectType = typeParam && getSearchObject(typeParam) ? (typeParam as SearchObjectType) : undefined;

  // Search obeys the same Business Role workcenter grants as the pages it
  // links to -- a scoped member never gets results (or even queries) for an
  // object their sidebar would hide. Same resolution the app layout uses,
  // including the linked-employee wfm_role check, so the bar's dropdown
  // (client) and the results (here) always agree.
  const perms = await resolvePermissions(supabase, tenantId, userId, role);
  let wfmSupervisor = role === "admin" || perms.grants.get("wfm")?.canEdit === true;
  if (!wfmSupervisor) {
    const { data: membership } = await supabase
      .from("tenant_users")
      .select("employee_id")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .maybeSingle();
    if (membership?.employee_id) {
      const { data: employee } = await supabase
        .from("employees")
        .select("wfm_role")
        .eq("tenant_id", tenantId)
        .eq("id", membership.employee_id)
        .eq("status", "active")
        .maybeSingle();
      wfmSupervisor = employee?.wfm_role === "supervisor";
    }
  }
  const types = allowedSearchTypes(toViewableWorkcenters(perms), wfmSupervisor);
  // Employee results deep-link to the supervisor Employee Hub only for
  // callers requireWfmSupervisorPage would accept; everyone else lands on
  // the master-data Employees list.
  const employeeHub = wfmSupervisor;

  if (objectType && types !== "all" && !types.includes(objectType)) {
    return NextResponse.json({ results: [] });
  }

  const results = await globalSearch(tenantId, q, objectType, 8, { types, employeeHub });
  return NextResponse.json({ results });
}
