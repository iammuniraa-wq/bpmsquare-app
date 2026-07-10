import { cache } from "react";
import { redirect } from "next/navigation";
import { createAdminSupabase, getAuthUser } from "./supabase-server";
import type { TenantConfig, TenantFeatures } from "./constants";

export type { TenantFeatures } from "./constants";

export type CompanyInfo = {
  // Core identity
  name?: string;
  tagline?: string;
  address?: string;
  email?: string;
  web?: string;
  gstin?: string;
  footer_tagline?: string;
  // Logo: use logo_url if available, otherwise auto-initials from name; logo_bg is the icon background colour
  logo_url?: string;
  logo_bg?: string;
  // Flexible phone list — renders as a labelled row per entry
  phones?: { label: string; number: string }[];
  // Optional extras — only rendered when present
  undertaking?: string;
  iso?: string;
  partners?: { name: string; logo_url?: string }[];
  // Tax override for print (falls back to tenants.config.tax)
  tax_label?: string;
  tax_rate?: number;
  // Legacy individual phone fields — kept for backwards compatibility
  phone_dir_tech?: string;
  phone_commercial?: string;
  phone_work?: string;
  landline?: string;
  email2?: string;
};

export type Tenant = {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  accent_color: string;
  status: "active" | "suspended" | "trial";
  plan: "free" | "pro" | "enterprise";
  features: TenantFeatures;
  company_info: CompanyInfo;
  config: TenantConfig;
};

/**
 * Load the current user's tenant.
 * React cache() deduplicates within a single render (layout + requireFeature = 1 DB call).
 * Fresh per request — no Vercel Data Cache, so platform admin changes take effect immediately.
 */
export const getTenant = cache(async (): Promise<Tenant | null> => {
  const user = await getAuthUser();
  if (!user) return null;
  const { data } = await createAdminSupabase()
    .from("tenant_users")
    .select("tenants(id, slug, name, logo_url, accent_color, status, plan, features, company_info, config)")
    .eq("user_id", user.id)
    .maybeSingle();
  return (data?.tenants as unknown as Tenant) ?? null;
});

/**
 * Server-side guard for feature-gated pages.
 * Call at the top of any page that requires a specific feature to be enabled.
 * Redirects to dashboard if the feature is off for this tenant.
 */
export async function requireFeature(key: keyof TenantFeatures): Promise<void> {
  const tenant = await getTenant();
  if (!tenant?.features?.[key]) redirect("/");
}

/** Admin: list all tenants. Uses service role. */
export async function adminListTenants(): Promise<Tenant[]> {
  const { data } = await createAdminSupabase()
    .from("tenants")
    .select("id, slug, name, logo_url, accent_color, status, plan, features, company_info, config, created_at")
    .order("created_at", { ascending: false });
  return (data as Tenant[]) ?? [];
}

/** Admin: update tenant features / status / plan. */
export async function adminUpdateTenant(
  id: string,
  patch: Partial<Pick<Tenant, "status" | "plan" | "features" | "name" | "logo_url" | "accent_color" | "company_info">>
) {
  return createAdminSupabase().from("tenants").update(patch).eq("id", id);
}

export const getUserRole = cache(async (): Promise<"admin" | "member" | null> => {
  const user = await getAuthUser();
  if (!user) return null;
  const { data } = await createAdminSupabase()
    .from("tenant_users")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();
  return (data?.role as "admin" | "member") ?? null;
});

/** Admin: check if the current user is a platform admin. */
export async function isPlatformAdmin(): Promise<boolean> {
  const user = await getAuthUser();
  if (!user) return false;

  const { data } = await createAdminSupabase()
    .from("platform_admins")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (data) return true;

  // Fallback: check email in case user_id not yet linked
  const { data: byEmail } = await createAdminSupabase()
    .from("platform_admins")
    .select("id")
    .eq("email", user.email ?? "")
    .maybeSingle();

  // Link user_id if found by email
  if (byEmail) {
    await createAdminSupabase()
      .from("platform_admins")
      .update({ user_id: user.id })
      .eq("email", user.email ?? "");
    return true;
  }

  return false;
}
