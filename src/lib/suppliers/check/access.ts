import "server-only";
import { NextResponse } from "next/server";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { resolvePermissions } from "@/lib/permissions";
import { resolveMonthlyBudget } from "@/lib/ai/usageCap";
import type { TenantConfig } from "@/lib/constants";
import { logChange } from "@/lib/changeLog";
import { VERDICT_LABEL, type SupplierCheckResult } from "./types";
import type { CheckAccess } from "./service";

// The session side of the supplier check routes. Tenant, person, permissions, the workspace's modules and its allowance all come from
// the session, never from the request body or the query string.

export type CheckSession = CheckAccess & { role: "admin" | "member"; email: string | null };

export async function resolveCheckSession(): Promise<CheckSession | NextResponse> {
  let tenantId: string, userId: string, role: "admin" | "member", supabase;
  try {
    ({ supabase, tenantId, userId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message ?? "Unauthorized" }, { status: err.status ?? 401 });
  }
  const admin = createAdminSupabase();
  const [perms, { data: tenant }, user] = await Promise.all([
    resolvePermissions(supabase, tenantId, userId, role),
    admin.from("tenants").select("features, config").eq("id", tenantId).maybeSingle(),
    getAuthUser(),
  ]);
  const config = (tenant?.config ?? {}) as Partial<TenantConfig>;
  return {
    admin, tenantId, userId, perms, role, email: user?.email ?? null,
    features: (tenant?.features ?? {}) as Record<string, boolean | undefined>,
    config, budget: resolveMonthlyBudget(config.ai_assistant?.monthly_token_budget),
  };
}

export const isSession = (s: CheckSession | NextResponse): s is CheckSession => !(s instanceof NextResponse);

/** One Change History line on the supplier: who ran or saved a check and what it said. Never throws. */
export async function logCheckSaved(s: Pick<CheckSession, "tenantId" | "userId" | "email">, r: SupplierCheckResult): Promise<void> {
  await logChange(createAdminSupabase(), {
    tenantId: s.tenantId, objectType: "suppliers", objectId: r.supplierId, objectLabel: r.supplierName, action: "update",
    actorId: s.userId, actorEmail: s.email,
    changes: [{
      field: "Supplier check", from: null,
      to: `${VERDICT_LABEL[r.verdict]}${r.rating.value === null ? "" : `, rating ${r.rating.value.toFixed(1)}`}${r.reputation.webUsed ? ", web research used" : ""}`,
    }],
  });
}
