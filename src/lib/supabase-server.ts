import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import {
  PRIMARY_HOST, isMembershipActive,
  TRUSTED_USER_ID_HEADER, TRUSTED_EMAIL_HEADER, TRUSTED_TENANT_ID_HEADER, TRUSTED_ROLE_HEADER,
  SUPABASE_COOKIE_OPTIONS, PATHNAME_HEADER,
} from "./constants";

// The only API route a must-change-password login is allowed to call --
// everything else is blocked by requireTenantUser() below until the flag
// clears. (app)/layout.tsx blocks page navigation the same way, but layouts
// never run for route handlers, so this is the actual enforcement point for
// API access -- without it, a still-must-change-password session could do
// real work via direct API calls while the UI redirected it to
// /force-password-change (see MULTI_TENANT_GUARDRAILS.md-style reasoning:
// a control that only lives in the UI isn't a control).
const MUST_CHANGE_PASSWORD_EXEMPT_PATHS = new Set(["/api/auth/complete-password-change"]);

/**
 * Pure decision function for the API-layer must_change_password gate --
 * kept separate from requireTenantUser() (which needs a live request/DB
 * context to call) purely so this specific branch of security logic can be
 * unit-tested directly. Exported for src/lib/supabase-server.test.ts.
 */
export function shouldBlockForPasswordChange(mustChangePassword: boolean, pathname: string): boolean {
  return mustChangePassword && !MUST_CHANGE_PASSWORD_EXEMPT_PATHS.has(pathname);
}

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
 * platform_admins). cache()-wrapped -- this and resolveHostTenant()
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

export type HostTenantResult =
  | { kind: "resolved"; tenantId: string; role: "admin" | "member" } // host tenant, user has access
  | { kind: "denied" }   // host maps to a tenant, but this user isn't a member — NO fallback
  | { kind: "dev" };     // localhost / 127.0.0.1 — caller may fall back to the user's own membership

/**
 * Resolve the tenant for the CURRENT request strictly from its host, gated on
 * the user's membership. This is the load-bearing multi-tenant isolation
 * primitive: the HOST decides which tenant, the USER only decides access.
 *
 *   - localhost / 127.0.0.1        -> { kind: "dev" }: no host pinning, callers
 *     fall back to the user's own (oldest) membership so local dev isn't disrupted.
 *   - app.bpmsquare.com (PRIMARY_HOST) -> the is_demo tenant (a shared sandbox).
 *   - <x>.bpmsquare.com (a custom_domain) -> that specific tenant.
 *
 * Access: platform admins get standing access to any tenant (a tenant_users row
 * is lazily upserted so RLS-scoped writes work — every query in lib/data/live.ts
 * relies on RLS checking tenant_users directly, so without a real row RLS would
 * keep scoping to whatever tenant the admin already belongs to). Everyone else
 * must have a tenant_users row for THAT tenant, else { kind: "denied" } — it
 * NEVER silently falls back to some other tenant the user happens to belong to.
 * That fallback was the cross-tenant routing bug this replaces (a real-tenant
 * login on app.bpmsquare.com was silently operating on real production data).
 *
 * cache()-wrapped — host + auth don't change mid-request, and the upsert
 * below is a true upsert (onConflict, no ignoreDuplicates) so it's still
 * idempotent to call repeatedly without erroring, while also promoting an
 * existing non-admin row instead of leaving it stale.
 */
export const resolveHostTenant = cache(async (): Promise<HostTenantResult> => {
  const h = await headers();

  // middleware.ts already resolved this exact request's tenant + role (via a
  // verified auth.getUser() call and the real tenant/membership queries)
  // before it ever reached here — trust that instead of repeating the same
  // network + DB round trips. Middleware strips any client-supplied value
  // for this header on every path, so its presence here is never spoofable.
  const trustedTenantId = h.get(TRUSTED_TENANT_ID_HEADER);
  const trustedRole = h.get(TRUSTED_ROLE_HEADER);
  if (trustedTenantId && (trustedRole === "admin" || trustedRole === "member")) {
    return { kind: "resolved", tenantId: trustedTenantId, role: trustedRole };
  }

  const host = h.get("host")?.split(":")[0] ?? "";
  if (host === "localhost" || host === "127.0.0.1") return { kind: "dev" };

  const user = await getAuthUser();
  if (!user) return { kind: "denied" };

  const admin = createAdminSupabase();

  // Which tenant does this host map to?
  let targetTenantId: string | null = null;
  if (host === PRIMARY_HOST) {
    const { data } = await admin.from("tenants").select("id").eq("is_demo", true).maybeSingle();
    targetTenantId = data?.id ?? null;
  } else {
    const { data } = await admin.from("tenants").select("id").eq("custom_domain", host).maybeSingle();
    targetTenantId = data?.id ?? null;
  }
  if (!targetTenantId) return { kind: "denied" };

  // Platform admins: standing access to any tenant; lazily create the row so
  // RLS works. ignoreDuplicates would leave an EXISTING row's role
  // untouched on conflict (e.g. a stale 'member' row from before this
  // person became a platform admin, or from a tenant clone/import) --
  // silently diverging from the "admin" this function unconditionally
  // returns below. That divergence is exactly what RLS enforces against:
  // the app would let an insert/update proceed (its own role check passes),
  // then Postgres would reject it anyway because the real row still says
  // 'member' -- e.g. "new row violates row level security policy for table
  // employees" on POST /api/employees. Omitting ignoreDuplicates makes this
  // an actual UPSERT: an existing row's role is promoted to admin too, so
  // the returned role always matches what's really in the database.
  if (await isPlatformAdmin()) {
    await admin
      .from("tenant_users")
      .upsert({ tenant_id: targetTenantId, user_id: user.id, role: "admin" }, { onConflict: "tenant_id,user_id" });
    return { kind: "resolved", tenantId: targetTenantId, role: "admin" };
  }

  // Everyone else: must be a member of THIS host's tenant, and that
  // membership must be active (not admin-locked, inside its validity window
  // -- see 0057). No fallback.
  const { data: membership } = await admin
    .from("tenant_users")
    .select("role, is_locked, valid_from, valid_to")
    .eq("user_id", user.id)
    .eq("tenant_id", targetTenantId)
    .maybeSingle();
  if (!membership || !isMembershipActive(membership)) return { kind: "denied" };

  return { kind: "resolved", tenantId: targetTenantId, role: (membership.role as "admin" | "member") ?? "member" };
});

/** The current user's oldest ACTIVE tenant_users membership (tenant_id + role). Used only as the localhost/dev fallback. */
async function oldestMembership(userId: string): Promise<{ tenant_id: string; role: "admin" | "member" } | null> {
  const { data } = await createAdminSupabase()
    .from("tenant_users")
    .select("tenant_id, role, is_locked, valid_from, valid_to")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data?.tenant_id || !isMembershipActive(data)) return null;
  return { tenant_id: data.tenant_id as string, role: (data.role as "admin" | "member") ?? "member" };
}

/**
 * Resolve the current viewer's tenant_id for lib/data/live.ts read helpers that
 * only need a tenant_id (not the full requireTenantUser() return shape). Host
 * decides the tenant; denied access returns null (no fallback); only on
 * localhost/dev does it fall back to the user's own oldest membership.
 */
export async function resolveViewerTenantId(userId: string): Promise<string | null> {
  const host = await resolveHostTenant();
  if (host.kind === "resolved") return host.tenantId;
  if (host.kind === "denied") return null;
  return (await oldestMembership(userId))?.tenant_id ?? null;
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

  // Host decides the tenant; the user only decides access.
  const host = await resolveHostTenant();
  let result: { supabase: SupabaseClient; tenantId: string; userId: string; role: "admin" | "member" };
  if (host.kind === "resolved") {
    result = { supabase, tenantId: host.tenantId, userId: user.id, role: host.role };
  } else if (host.kind === "denied") {
    // On a real deployed host, not being a member of that host's tenant is a
    // hard stop — never fall back to some other tenant the user belongs to.
    throw { status: 403, message: "No access to this workspace" };
  } else {
    // localhost / dev only: fall back to the user's own oldest membership.
    const membership = await oldestMembership(user.id);
    if (!membership) throw { status: 403, message: "No tenant membership" };
    result = { supabase, tenantId: membership.tenant_id, userId: user.id, role: membership.role };
  }

  const pathname = (await headers()).get(PATHNAME_HEADER) ?? "";
  const gate = await getTenantMembership(result.tenantId, result.userId);
  if (shouldBlockForPasswordChange(Boolean(gate?.must_change_password), pathname)) {
    throw { status: 403, message: "Password change required — set a new password before continuing" };
  }

  return result;
}

/**
 * Per-request cached getUser — React cache() deduplicates across multiple
 * callers in the same render (AppLayout + getTenant no longer make 2 auth calls).
 */
export const getAuthUser = cache(async () => {
  // Same trust as resolveHostTenant() above: middleware.ts already ran the
  // real supabase.auth.getUser() network call (which verifies the JWT
  // signature against the auth server) for this exact request. Every caller
  // of getAuthUser() in this codebase only reads .id / .email off the
  // result, so a minimal reconstructed object is sufficient here.
  const h = await headers();
  const trustedUserId = h.get(TRUSTED_USER_ID_HEADER);
  if (trustedUserId) {
    return { id: trustedUserId, email: h.get(TRUSTED_EMAIL_HEADER) || undefined } as unknown as User;
  }

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
});

/**
 * cache()-wrapped: one session client per request instead of one per caller.
 * Beyond skipping redundant construction, the shared object identity is what
 * lets cache()-wrapped functions that take the client as an argument
 * (resolvePermissions) actually deduplicate -- cache() keys arguments by
 * identity, so two distinct client objects would defeat it.
 */
export const createServerSupabase = cache(async () => {
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
      cookieOptions: SUPABASE_COOKIE_OPTIONS,
    }
  );
});

/**
 * The caller's tenant_users row for THIS request's tenant -- the one row
 * that was previously fetched up to three times per navigation (the
 * password gate here in requireTenantUser, plus the app layout's own
 * password-gate and WFM-membership lookups). cache()-wrapped so it's one
 * query per request no matter how many places need it. Admin client with
 * explicit tenant+user filters (MULTI_TENANT_GUARDRAILS: every admin-client
 * query names its tenant filter).
 */
export const getTenantMembership = cache(
  async (tenantId: string, userId: string): Promise<{
    must_change_password: boolean | null;
    employee_id: string | null;
    wfm_default_landing: string | null;
  } | null> => {
    const { data } = await createAdminSupabase()
      .from("tenant_users")
      .select("must_change_password, employee_id, wfm_default_landing")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .maybeSingle();
    return data ?? null;
  }
);
