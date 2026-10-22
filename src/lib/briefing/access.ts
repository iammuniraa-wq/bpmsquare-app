import "server-only";
import { NextResponse } from "next/server";
import { createAdminSupabase, getAuthUser, requireTenantUser } from "@/lib/supabase-server";
import { resolvePermissions } from "@/lib/permissions";
import { formatMoneyCompact, resolveCurrency } from "@/lib/currency";
import { requireWfm } from "@/lib/wfm/server";
import { resolveWfmScope } from "@/lib/wfm/scope";
import { getBriefing } from "./compute";
import type { BriefingCtx, WfmAccess } from "./load";

// The shared body of GET /api/ai/briefing and POST /api/ai/briefing/refresh. Tenant, person, role, modules and time
// zone all come from the session; the request carries only an optional language tag.

async function wfmAccess(): Promise<WfmAccess | null> {
  try {
    const wfm = await requireWfm();
    if (!wfm.isSupervisor) return null;
    const scope = await resolveWfmScope(wfm);
    return { isSupervisor: true, unrestricted: scope.unrestricted, employeeIds: scope.employeeIds };
  } catch {
    return null;
  }
}

const cleanLang = (v: unknown): string | null => (typeof v === "string" && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(v) ? v.slice(0, 16) : null);

export async function briefingResponse(lang: unknown, refresh: boolean): Promise<NextResponse> {
  let supabase, tenantId, userId, role;
  try {
    ({ supabase, tenantId, userId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const [perms, { data: tenant }, user] = await Promise.all([
    resolvePermissions(supabase, tenantId, userId, role),
    supabase.from("tenants").select("features, config").eq("id", tenantId).maybeSingle(),
    getAuthUser(),
  ]);
  const features = (tenant?.features ?? {}) as Record<string, boolean | undefined>;
  if (features.ai_assistant !== true) return NextResponse.json({ error: "The assistant is not enabled for this workspace." }, { status: 403 });
  const config = (tenant?.config ?? {}) as { currency?: string | null; wfm?: { timezone?: string } };

  const ctx: BriefingCtx = {
    tenantId, perms, features, userId, email: user?.email?.toLowerCase() ?? null, isAdmin: role === "admin",
    wfm: features.wfm === true ? await wfmAccess() : null,
  };
  const cur = resolveCurrency(config);
  const briefing = await getBriefing({
    admin: createAdminSupabase(), ctx, timeZone: config.wfm?.timezone, lang: cleanLang(lang), refresh,
    formatValue: (n) => formatMoneyCompact(n, cur),
  });
  return NextResponse.json(briefing);
}
