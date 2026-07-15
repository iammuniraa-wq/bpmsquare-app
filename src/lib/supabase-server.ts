import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { isPrimaryOrDevHost } from "./constants";

/**
 * True when Supabase env vars are present. The first build slice runs on seed
 * fixtures when this is false, so the app is viewable before a project exists.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

/** Service-role client — bypasses RLS. Use only in server-side admin routes. */
export function createAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/** True if the current authenticated user is a platform admin (whitelisted in platform_admins). */
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

/**
 * Platform admins have no tenant_users row by default. When one is browsing a
 * tenant's dedicated custom domain, resolve straight to that tenant's id so
 * support/ops accounts can access any tenant without a per-tenant invite.
 * Returns null on the shared PRIMARY_HOST/localhost, or for non-admin users.
 */
export async function resolveTenantIdForPlatformAdmin(): Promise<string | null> {
  const host = (await headers()).get("host")?.split(":")[0] ?? "";
  if (isPrimaryOrDevHost(host)) return null;
  if (!(await isPlatformAdmin())) return null;

  const { data } = await createAdminSupabase()
    .from("tenants")
    .select("id")
    .eq("custom_domain", host)
    .maybeSingle();
  return data?.id ?? null;
}

/**
 * Returns the authenticated user's tenant_id, or throws a Response-like object
 * with status 401/403 that route handlers can return directly.
 *
 * Usage:
 *   const { supabase, tenantId } = await requireTenantUser();
 */
export async function requireTenantUser(): Promise<{
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  role: "admin" | "member";
}> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw { status: 401, message: "Unauthorized" };

  // Use service role to look up tenant — bypasses RLS for this internal join
  const { data: tu } = await createAdminSupabase()
    .from("tenant_users")
    .select("tenant_id, role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (tu?.tenant_id) {
    return {
      supabase,
      tenantId: tu.tenant_id as string,
      userId: user.id,
      role: (tu.role as "admin" | "member") ?? "member",
    };
  }

  const fallbackTenantId = await resolveTenantIdForPlatformAdmin();
  if (fallbackTenantId) {
    return { supabase, tenantId: fallbackTenantId, userId: user.id, role: "admin" };
  }

  throw { status: 403, message: "No tenant membership" };
}

/**
 * Per-request cached getUser — React cache() deduplicates across multiple
 * callers in the same render (AppLayout + getTenant no longer make 2 auth calls).
 */
export const getAuthUser = cache(async () => {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
});

export async function createServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {}
        },
      },
    }
  );
}
