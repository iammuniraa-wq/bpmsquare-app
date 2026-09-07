// Tenant-scoped reads for fence_projects's supporting tables, kept out of
// materials.ts (products-specific) since this is fence_security_profiles.
// Server-only, degrades cleanly to [] on a pending migration (42P01) per
// bpmsquarecore §3b -- the fence-preview page must render an empty-profile
// state, never crash, if a tenant somehow has the feature flag on ahead of
// the migration.

import "server-only";
import { createAdminSupabase } from "@/lib/supabase-server";

export interface FenceSecurityProfileRow {
  id: string;
  label: string;
  blurb: string | null;
  post_spacing_m: number;
  embedment_m: number;
  pipe_class: string;
  sort_order: number;
}

export async function getFenceSecurityProfiles(tenantId: string): Promise<FenceSecurityProfileRow[]> {
  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("fence_security_profiles")
    .select("id, label, blurb, post_spacing_m, embedment_m, pipe_class, sort_order")
    .eq("tenant_id", tenantId)
    .order("sort_order", { ascending: true });
  if (error) return []; // 42P01 = 0122 pending, or any other read failure -- empty, never a crash
  return (data ?? []) as FenceSecurityProfileRow[];
}
