import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase, requireTenantUser } from "@/lib/supabase-server";
import type { TenantConfig, TenantFeatures } from "@/lib/constants";
import { marketingScoringOn } from "./config";

// Shared start of the two Settings -> Marketing routes: an admin of a
// workspace that has the marketing_scoring program. Anyone else gets the same
// answer a route that does not exist would give.

export type MarketingSettingsContext = {
  admin: SupabaseClient;
  tenantId: string;
  userId: string;
  config: TenantConfig;
  features: Partial<TenantFeatures>;
};

export async function loadMarketingSettingsContext(): Promise<{ ok: true; ctx: MarketingSettingsContext } | { ok: false; response: NextResponse }> {
  let tenantId: string, userId: string, role: string;
  try {
    ({ tenantId, userId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return { ok: false, response: NextResponse.json({ error: err.message }, { status: err.status }) };
  }
  if (role !== "admin") return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };

  const admin = createAdminSupabase();
  const { data, error } = await admin.from("tenants").select("features, config").eq("id", tenantId).single();
  if (error || !data) return { ok: false, response: NextResponse.json({ error: error?.message ?? "Workspace not found" }, { status: 500 }) };
  const features = (data.features ?? {}) as Partial<TenantFeatures>;
  if (!marketingScoringOn(features)) {
    return { ok: false, response: NextResponse.json({ error: "Marketing scoring isn't enabled for your workspace" }, { status: 404 }) };
  }
  return { ok: true, ctx: { admin, tenantId, userId, config: (data.config ?? {}) as TenantConfig, features } };
}
