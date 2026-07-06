import { unstable_cache } from "next/cache";
import { createAdminSupabase, getAuthUser } from "./supabase-server";

export type TenantFeatures = {
  leads: boolean;
  pipeline: boolean;
  amc: boolean;
  dispatch: boolean;
  invoices: boolean;
  partners: boolean;
  ai_assistant: boolean;
  db_export: boolean;
};

export type CompanyInfo = {
  tagline?: string;
  undertaking?: string;
  address?: string;
  phone_dir_tech?: string;
  phone_commercial?: string;
  phone_work?: string;
  landline?: string;
  email?: string;
  email2?: string;
  web?: string;
  gstin?: string;
  iso?: string;
  partners?: { name: string; logo_url?: string }[];
  footer_tagline?: string;
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
};

const _getTenantCached = unstable_cache(
  async (userId: string): Promise<Tenant | null> => {
    // Use admin client so we can query by userId without RLS ambiguity
    const { data } = await createAdminSupabase()
      .from("tenant_users")
      .select("tenants(id, slug, name, logo_url, accent_color, status, plan, features, company_info)")
      .eq("user_id", userId)
      .maybeSingle();
    return (data?.tenants as unknown as Tenant) ?? null;
  },
  ["tenant-by-user"],
  { revalidate: 10, tags: ["tenant"] },
);

/** Load the current user's tenant. Cached 60 s per user; single auth call per request. */
export async function getTenant(): Promise<Tenant | null> {
  const user = await getAuthUser();
  if (!user) return null;
  return _getTenantCached(user.id);
}

/** Admin: list all tenants. Uses service role. */
export async function adminListTenants(): Promise<Tenant[]> {
  const { data } = await createAdminSupabase()
    .from("tenants")
    .select("id, slug, name, logo_url, accent_color, status, plan, features, company_info, created_at")
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

/** Returns the current user's role in their tenant. Cached 60 s per user. */
const _getRoleCached = unstable_cache(
  async (userId: string): Promise<"admin" | "member" | null> => {
    const { data } = await createAdminSupabase()
      .from("tenant_users")
      .select("role")
      .eq("user_id", userId)
      .maybeSingle();
    return (data?.role as "admin" | "member") ?? null;
  },
  ["role-by-user"],
  { revalidate: 60, tags: ["tenant-role"] }
);

export async function getUserRole(): Promise<"admin" | "member" | null> {
  const user = await getAuthUser();
  if (!user) return null;
  return _getRoleCached(user.id);
}

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
