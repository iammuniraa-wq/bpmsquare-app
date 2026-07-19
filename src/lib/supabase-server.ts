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

/**
 * Finds an existing auth user by email, or creates a new one -- either via a
 * branded Supabase invite email (default) or with a directly-set password
 * (email_confirm: true, usable immediately, no email/SMTP dependency).
 * Shared by every "add a person to a tenant" route (settings/team,
 * admin/tenants create + invite) so the existing-email handling and the
 * set-password option stay consistent across all of them.
 */
export async function findOrCreateUserForInvite(
  admin: ReturnType<typeof createAdminSupabase>,
  email: string,
  opts: { password?: string; inviteData?: Record<string, unknown>; redirectTo?: string }
): Promise<{ userId: string; isNew: boolean } | { error: string }> {
  const { data: existing } = await admin.auth.admin.listUsers();
  const existingUser = existing?.users?.find((u) => u.email === email);
  if (existingUser) return { userId: existingUser.id, isNew: false };

  if (opts.password) {
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password: opts.password,
      email_confirm: true,
      user_metadata: opts.inviteData ?? {},
    });
    if (error || !created?.user) return { error: error?.message ?? "Failed to create user" };
    return { userId: created.user.id, isNew: true };
  }

  const { data: invited, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: opts.inviteData ?? {},
    redirectTo: opts.redirectTo,
  });
  if (error || !invited?.user) {
    const message = error?.message.toLowerCase().includes("already been registered")
      ? "This email already has an account."
      : (error?.message ?? "Failed to invite");
    return { error: message };
  }
  return { userId: invited.user.id, isNew: true };
}

/**
 * True if the current authenticated user is a platform admin (whitelisted in
 * platform_admins). cache()-wrapped -- this and resolveTenantIdForPlatformAdmin()
 * are each called from 4+ independent places per request (root layout directly,
 * plus indirectly via getTenant()/getUserRole()/requireTenantUser()/
 * resolveViewerTenantId(), each of which is itself cached but calls this fresh
 * every time since caching a function doesn't cache what it calls internally).
 * Without this, a single page load was re-running this 1-2 query lookup chain
 * 4-5+ times redundantly, on top of middleware.ts doing the equivalent check
 * again from scratch before the request even reaches here.
 */
export const isPlatformAdmin = cache(async (): Promise<boolean> => {
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
});

/**
 * Platform admins have no tenant_users row by default. When one is browsing a
 * tenant's dedicated custom domain, resolve straight to that tenant's id so
 * support/ops accounts can access any tenant without a per-tenant invite.
 * Returns null on the shared PRIMARY_HOST/localhost, or for non-admin users.
 *
 * Also lazily creates a real tenant_users row (role: admin) for this tenant if
 * one doesn't exist yet. Actual data queries throughout the app (lib/data/live.ts)
 * use the user's own session and rely entirely on Postgres RLS policies that
 * check tenant_users directly -- not on this function's return value -- so
 * without a real row, RLS would keep scoping every query to whichever tenant
 * this admin happens to already belong to, regardless of which domain they're on.
 *
 * cache()-wrapped -- see the comment on isPlatformAdmin() above for why this
 * matters. Safe to dedupe within one request: hostname and auth don't change
 * mid-request, and the upsert below is itself idempotent (ignoreDuplicates).
 */
export const resolveTenantIdForPlatformAdmin = cache(async (): Promise<string | null> => {
  const host = (await headers()).get("host")?.split(":")[0] ?? "";
  if (isPrimaryOrDevHost(host)) return null;

  const user = await getAuthUser();
  if (!user) return null;
  if (!(await isPlatformAdmin())) return null;

  const admin = createAdminSupabase();
  const { data: tenant } = await admin
    .from("tenants")
    .select("id")
    .eq("custom_domain", host)
    .maybeSingle();
  if (!tenant) return null;

  await admin
    .from("tenant_users")
    .upsert({ tenant_id: tenant.id, user_id: user.id, role: "admin" }, { onConflict: "tenant_id,user_id", ignoreDuplicates: true });

  return tenant.id;
});

/**
 * Resolve the current viewer's tenant_id for lib/data/live.ts read helpers that
 * only need a tenant_id (not the full requireTenantUser() return shape). Same
 * priority order: platform-admin hostname resolution first, then this user's
 * own (oldest) tenant_users row. Returns null if neither resolves.
 */
export async function resolveViewerTenantId(userId: string): Promise<string | null> {
  const fallbackTenantId = await resolveTenantIdForPlatformAdmin();
  if (fallbackTenantId) return fallbackTenantId;

  const { data: tu } = await createAdminSupabase()
    .from("tenant_users")
    .select("tenant_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return (tu?.tenant_id as string | undefined) ?? null;
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
  const user = await getAuthUser();
  if (!user) throw { status: 401, message: "Unauthorized" };

  // Platform admins: the tenant mapped to the current hostname always wins over
  // any personal tenant_users row (mirrors getTenant()'s priority in lib/tenant.ts).
  const fallbackTenantId = await resolveTenantIdForPlatformAdmin();
  if (fallbackTenantId) {
    return { supabase, tenantId: fallbackTenantId, userId: user.id, role: "admin" };
  }

  // Use service role to look up tenant — bypasses RLS for this internal join.
  // Ordered + limited to 1 rather than maybeSingle(): a platform admin can now
  // have more than one tenant_users row (one per tenant they've visited via its
  // custom domain), and maybeSingle() errors on more than one match. The oldest
  // row is treated as this user's "home" tenant on the shared PRIMARY_HOST.
  const { data: tu } = await createAdminSupabase()
    .from("tenant_users")
    .select("tenant_id, role")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (tu?.tenant_id) {
    return {
      supabase,
      tenantId: tu.tenant_id as string,
      userId: user.id,
      role: (tu.role as "admin" | "member") ?? "member",
    };
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
