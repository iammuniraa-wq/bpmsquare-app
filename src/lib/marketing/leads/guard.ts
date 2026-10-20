import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase, requireTenantUser } from "@/lib/supabase-server";
import type { TenantFeatures } from "@/lib/constants";
import { marketingScoringOn } from "../config";

// The start of every scored-lead route: a signed-in member of a workspace that
// has the Leads module AND the scoring program. Anyone else gets the answer a
// route that does not exist would give, so the program is invisible to a
// workspace that was not given it.

export type LeadRouteContext = {
  /** The caller's own session client (for change history); everything else uses `admin`. */
  supabase: SupabaseClient;
  admin: SupabaseClient;
  tenantId: string;
  userId: string;
  role: "admin" | "member";
  features: Partial<TenantFeatures>;
};

export async function loadLeadRouteContext(): Promise<{ ok: true; ctx: LeadRouteContext } | { ok: false; response: NextResponse }> {
  let supabase: SupabaseClient, tenantId: string, userId: string, role: string;
  try {
    ({ supabase, tenantId, userId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return { ok: false, response: NextResponse.json({ error: err.message }, { status: err.status }) };
  }
  const admin = createAdminSupabase();
  const { data, error } = await admin.from("tenants").select("features").eq("id", tenantId).single();
  if (error || !data) return { ok: false, response: NextResponse.json({ error: "Workspace not found" }, { status: 500 }) };
  const features = (data.features ?? {}) as Partial<TenantFeatures>;
  if (features.leads !== true || !marketingScoringOn(features)) {
    return { ok: false, response: NextResponse.json({ error: "Lead scoring isn't enabled for your workspace" }, { status: 404 }) };
  }
  return { ok: true, ctx: { supabase, admin, tenantId, userId, role: role === "admin" ? "admin" : "member", features } };
}
