import "server-only";
import { NextResponse } from "next/server";
import { createAdminSupabase, requireTenantUser } from "@/lib/supabase-server";
import { resolvePermissions } from "@/lib/permissions";
import { resolveMonthlyBudget } from "@/lib/ai/usageCap";
import type { TenantConfig } from "@/lib/constants";
import { isUuid } from "@/lib/assistant/objects";
import type { AnalysisAccess, AnalyseInput } from "./service";

// The session side of POST/GET /api/ai/analysis. Tenant, person, role, modules and allowance all come from the session;
// the request carries only the company to analyse. An account id is checked against the workspace inside the service
// before the account's name is used for anything.

export async function resolveAnalysisAccess(): Promise<AnalysisAccess | NextResponse> {
  let supabase, tenantId, userId, role;
  try {
    ({ supabase, tenantId, userId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const [perms, { data: tenant }] = await Promise.all([
    resolvePermissions(supabase, tenantId, userId, role),
    supabase.from("tenants").select("features, config").eq("id", tenantId).maybeSingle(),
  ]);
  const features = (tenant?.features ?? {}) as Record<string, boolean | undefined>;
  const config = (tenant?.config ?? {}) as Partial<TenantConfig>;
  return { supabase, admin: createAdminSupabase(), tenantId, userId, perms, features, config, budget: resolveMonthlyBudget(config.ai_assistant?.monthly_token_budget) };
}

const text = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

/** Only the named fields are read, and each is length-limited; anything else in the body is ignored. */
export function parseAnalyseInput(raw: Record<string, unknown> | null | undefined): AnalyseInput | { error: string } {
  const r = raw ?? {};
  const accountId = text(r.account_id, 64);
  if (accountId && !isUuid(accountId)) return { error: "account_id is not valid" };
  return {
    accountId: accountId ?? null, name: text(r.name, 200), domain: text(r.domain, 253), country: text(r.country, 80),
    refresh: r.refresh === true, allowWeb: r.allow_web === true,
  };
}
