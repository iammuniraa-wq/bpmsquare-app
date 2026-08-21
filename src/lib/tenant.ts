import { cache } from "react";
import { unstable_cache } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase, getAuthUser, resolveHostTenant } from "./supabase-server";
import type { TenantConfig, TenantFeatures } from "./constants";

export { isPlatformAdmin } from "./supabase-server";

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
  /** @deprecated Plain-text cert badge (e.g. "ISO 9001:2015"). Superseded by `certifications`
   * (logo images) but left in place as a fallback for tenants who haven't migrated. */
  iso?: string;
  /** Accreditation/certification logos shown in the quote letterhead header (e.g. ISO, EGAC, IAF). */
  certifications?: { name: string; logo_url?: string }[];
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
  /** Business-size segment, platform-admin-set at provisioning -- kept as a
   * first-class, trackable dimension (not yet read by any feature/connector
   * gating logic, but that's the point: a clean place to hang it later
   * without another rename). */
  plan: "personal" | "small_business" | "enterprise";
  features: TenantFeatures;
  company_info: CompanyInfo;
  config: TenantConfig;
  custom_domain: string | null;
  api_key: string | null;
  is_demo: boolean;
};

/**
 * Load the current user's tenant.
 * React cache() deduplicates within a single render (layout + requireFeature = 1 DB call).
 * Fresh per request — no Vercel Data Cache, so platform admin changes take effect immediately.
 */
const TENANT_COLUMNS = "id, slug, name, logo_url, accent_color, status, plan, features, company_info, config, custom_domain, api_key, is_demo";

export const getTenant = cache(async (): Promise<Tenant | null> => {
  const user = await getAuthUser();
  if (!user) return null;

  // Host decides the tenant; the user only decides access (see resolveHostTenant).
  const host = await resolveHostTenant();
  if (host.kind === "resolved") {
    const { data: hostTenant } = await createAdminSupabase()
      .from("tenants")
      .select(TENANT_COLUMNS)
      .eq("id", host.tenantId)
      .maybeSingle();
    return (hostTenant as unknown as Tenant) ?? null;
  }
  // Denied on a real deployed host — never fall back to another tenant.
  if (host.kind === "denied") return null;

  // localhost / dev only: fall back to the user's own oldest membership.
  const { data } = await createAdminSupabase()
    .from("tenant_users")
    .select(`tenants(${TENANT_COLUMNS})`)
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
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

/**
 * API-route counterpart to requireFeature() -- no existing route in this
 * codebase checked a feature flag before this (every prior TenantFeatures
 * flag is enforced page-side only), so this is a new, deliberately explicit
 * pattern for features that need a hard server-side gate, not just a hidden
 * nav link. Queries by the ALREADY-authenticated tenantId (from
 * requireTenantUser()), not getTenant()'s own host-based resolution, so it
 * can never disagree with the tenant scope the rest of the route already
 * uses.
 */
export async function tenantHasFeature(
  supabase: SupabaseClient,
  tenantId: string,
  key: keyof TenantFeatures
): Promise<boolean> {
  const { data } = await supabase.from("tenants").select("features").eq("id", tenantId).maybeSingle();
  return !!(data?.features as TenantFeatures | undefined)?.[key];
}

/**
 * Strips admin-only secrets (the v1 API key, and the ERP webhook-push
 * signing secret nested in `config`) from a tenant object before it's
 * handed to TenantProvider -- every authenticated member of a tenant was
 * previously receiving both in full via the client-side tenant context
 * (and could also read them by calling their settings API routes directly),
 * even though the Settings UI only *displays* them to admins. Regenerating
 * either was already admin-gated server-side; reading them wasn't.
 */
export function redactTenantForRole(tenant: Tenant, role: "admin" | "member" | null): Tenant {
  if (role === "admin") return tenant;
  const push = tenant.config?.integration_push;
  const a360 = tenant.config?.account_360;
  return {
    ...tenant,
    api_key: null,
    config: {
      ...tenant.config,
      integration_push: push ? { webhook_url: push.webhook_url } : undefined,
      // Account 360 source credentials are the same class of secret as the
      // webhook signing key -- the card list itself is harmless, the auth
      // header value is not.
      account_360: a360
        ? { ...a360, sources: (a360.sources ?? []).map(({ auth_value: _auth, ...rest }) => rest) }
        : undefined,
    },
  };
}

/**
 * Public, unauthenticated lookup for branding a tenant's dedicated login page
 * (name + logo only — nothing sensitive). Returns null when the host has no
 * mapped tenant, so callers fall back to generic BPMSquare branding.
 *
 * Called from the root layout's generateMetadata() on EVERY page load (it's
 * how the tab title is set), so this was a live DB round trip blocking every
 * single navigation just to render a title. `host` maps 1:1 to a tenant
 * (custom_domain), so it's a safe unstable_cache key — no cross-tenant
 * sharing risk, just a bounded staleness window if branding changes (5 min).
 */
export type TenantBranding = {
  id: string;
  name: string;
  logo_url: string | null;
  // True when this tenant runs the WFM self-service portal with employee-code
  // login (config.wfm.login_mode === "code"). The pre-auth login form uses it
  // to accept an employee ID in place of an email; tenant id is included so the
  // form can construct the synthetic address (see lib/wfm/employeeLogin.ts).
  employee_code_login: boolean;
  // True when this tenant lets employees sign in by face (config.wfm.face_login).
  // The login page shows a "Sign in with face" option when set.
  employee_face_login: boolean;
};

export const getTenantBrandingByHost = unstable_cache(
  async (host: string): Promise<TenantBranding | null> => {
    const { data } = await createAdminSupabase()
      .from("tenants")
      .select("id, name, logo_url, features, config")
      .eq("custom_domain", host)
      .maybeSingle();
    if (!data) return null;
    const features = (data.features ?? {}) as TenantFeatures;
    const config = (data.config ?? {}) as TenantConfig;
    return {
      id: data.id as string,
      name: data.name as string,
      logo_url: (data.logo_url as string | null) ?? null,
      employee_code_login: features.wfm === true && config.wfm?.login_mode === "code",
      employee_face_login: features.wfm === true && config.wfm?.face_login === true,
    };
  },
  ["tenant-branding-by-host"],
  // Tagged so a WFM/settings save can bust it immediately (revalidateTag
  // "tenant-branding") -- otherwise a just-enabled flag like face_login or
  // login_mode wouldn't reach the login page for up to 5 minutes.
  { revalidate: 300, tags: ["tenant-branding"] }
);

/** Admin: list all tenants. Uses service role. */
export async function adminListTenants(): Promise<Tenant[]> {
  const { data } = await createAdminSupabase()
    .from("tenants")
    .select("id, slug, name, logo_url, accent_color, status, plan, features, company_info, config, custom_domain, api_key, is_demo, created_at")
    .order("created_at", { ascending: false });
  return (data as Tenant[]) ?? [];
}

/** Admin: update tenant features / status / plan. */
export async function adminUpdateTenant(
  id: string,
  patch: Partial<Pick<Tenant, "status" | "plan" | "features" | "name" | "logo_url" | "accent_color" | "company_info" | "custom_domain" | "api_key" | "config">>
) {
  return createAdminSupabase().from("tenants").update(patch).eq("id", id);
}

export const getUserRole = cache(async (): Promise<"admin" | "member" | null> => {
  const user = await getAuthUser();
  if (!user) return null;

  // Same host-decides-tenant resolution as getTenant(): the role is the one for
  // THIS host's tenant, not whatever tenant the user happens to belong to.
  const host = await resolveHostTenant();
  if (host.kind === "resolved") return host.role;
  if (host.kind === "denied") return null;

  // localhost / dev only: the user's own oldest membership role.
  const { data } = await createAdminSupabase()
    .from("tenant_users")
    .select("role")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return (data?.role as "admin" | "member") ?? null;
});
