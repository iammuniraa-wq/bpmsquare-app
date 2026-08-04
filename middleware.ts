import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import {
  isPrimaryOrDevHost, PRIMARY_HOST, isMembershipActive,
  TRUSTED_USER_ID_HEADER, TRUSTED_EMAIL_HEADER, TRUSTED_TENANT_ID_HEADER, TRUSTED_ROLE_HEADER,
  SUPABASE_COOKIE_OPTIONS,
} from "@/lib/constants";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Strip any client-supplied values for the trusted identity headers on
  // EVERY path, including the public/bypassed ones below — these headers are
  // only ever set further down, after a verified auth check + tenant
  // resolution, so nothing must be allowed to smuggle a spoofed value in.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(TRUSTED_USER_ID_HEADER);
  requestHeaders.delete(TRUSTED_EMAIL_HEADER);
  requestHeaders.delete(TRUSTED_TENANT_ID_HEADER);
  requestHeaders.delete(TRUSTED_ROLE_HEADER);

  // Public paths — never intercept
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/reset-password") ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/manifest") ||
    pathname.startsWith("/icons") ||
    // Signed, no-login quote PDF links (see lib/quotePublicLink.ts) — shared over
    // WhatsApp/etc. Auth here is the token itself, verified inside the route/page,
    // not a session; every tenant-owned query behind them is still tenant-scoped.
    /^\/quotations\/[^/]+\/print-public\//.test(pathname) ||
    /^\/api\/quotes\/[^/]+\/pdf-public\//.test(pathname) ||
    // Signed, no-login marketing-email unsubscribe link (see
    // lib/marketingUnsubscribe.ts) -- same reasoning as the quote links above.
    // $-anchored so this can never match a deeper/future path under the same
    // prefix with different auth requirements.
    /^\/marketing\/unsubscribe\/[^/]+\/[^/]+$/.test(pathname) ||
    /^\/api\/marketing\/unsubscribe\/[^/]+\/[^/]+$/.test(pathname) ||
    // Signed, no-login "I'm interested" campaign click-through link (see
    // lib/campaignInterestLink.ts) -- same reasoning as the unsubscribe link.
    /^\/marketing\/interest\/[^/]+\/[^/]+\/[^/]+$/.test(pathname) ||
    /^\/api\/marketing\/interest\/[^/]+\/[^/]+\/[^/]+$/.test(pathname) ||
    // Public REST API. These carry their own auth -- a per-tenant bearer key
    // (tenants.api_key), resolved by resolveTenantFromBearer() in every single
    // route under /api/v1, which also decides the tenant. Same reasoning as the
    // signed links above: the credential is in the request, not a session
    // cookie, so bouncing to /login would make the API unusable to any client
    // that isn't a logged-in browser -- which is every API client.
    //
    // The session gate below must not apply here, but note it is the ONLY thing
    // being skipped: each route still 401s without a valid key, and every query
    // behind them is tenant-scoped by the tenant that key resolves to.
    pathname === "/api/v1" ||
    pathname.startsWith("/api/v1/")
  ) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
        },
      },
      cookieOptions: SUPABASE_COOKIE_OPTIONS,
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Host-driven tenant isolation. The host decides which tenant; the user only
  // decides access. localhost / 127.0.0.1 pass through untouched (local dev).
  //   - PRIMARY_HOST (app.bpmsquare.com) = the demo sandbox tenant: only its
  //     invited members (or platform admins) may enter.
  //   - a custom_domain (vikas.bpmsquare.com) = that specific real tenant: only
  //     its members (or platform admins) may enter.
  // Non-members are signed out and bounced to /login?error=wrong_workspace in
  // BOTH cases — a real-tenant login must not be able to silently operate on
  // app.bpmsquare.com (that was the cross-tenant routing bug this closes).
  const host = (request.headers.get("host") ?? "").split(":")[0];

  const denyWithError = async (error: string) => {
    await supabase.auth.signOut();
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    loginUrl.searchParams.set("error", error);
    const redirect = NextResponse.redirect(loginUrl);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  };
  const denyWrongWorkspace = () => denyWithError("wrong_workspace");
  // Business-user enforcement (0057): a locked or out-of-validity membership
  // is cut off here, on every request -- not just at login -- so an admin
  // locking a user takes effect on their very next click, even mid-session.
  // Platform admins never hit this (they resolve via platform_admins above,
  // not a tenant_users row).
  const denyLocked = () => denyWithError("account_locked");

  // Populated only when this middleware itself reaches a firm "resolved"
  // conclusion (concrete tenant + role) — left null on the pre-existing
  // fall-through gaps below (no demo tenant configured / unmapped custom
  // domain) and on localhost/dev, so those paths get no trusted headers and
  // fall back to the render layer doing the real resolution itself, same as
  // before this change.
  let resolvedTenantId: string | null = null;
  let resolvedRole: "admin" | "member" | null = null;

  if (host === PRIMARY_HOST) {
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const [{ data: demoTenant }, { data: adminByUserId }, { data: adminByEmail }] = await Promise.all([
      admin.from("tenants").select("id").eq("is_demo", true).maybeSingle(),
      admin.from("platform_admins").select("id").eq("user_id", user.id).maybeSingle(),
      admin.from("platform_admins").select("id").eq("email", user.email ?? "").maybeSingle(),
    ]);

    const isPlatformAdminUser = !!adminByUserId || !!adminByEmail;
    if (isPlatformAdminUser) {
      resolvedTenantId = demoTenant?.id ?? null;
      resolvedRole = "admin";
    } else if (demoTenant) {
      const { data: membership } = await admin
        .from("tenant_users")
        .select("role, is_locked, valid_from, valid_to")
        .eq("user_id", user.id)
        .eq("tenant_id", demoTenant.id)
        .maybeSingle();
      if (!membership) return denyWrongWorkspace();
      if (!isMembershipActive(membership)) return denyLocked();
      resolvedTenantId = demoTenant.id;
      resolvedRole = (membership.role as "admin" | "member") ?? "member";
    }
  } else if (!isPrimaryOrDevHost(host)) {
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // These three are independent of each other -- run them together instead
    // of one-after-another. On the common (non-admin) path this was always
    // running all three anyway (the by-user_id lookup misses, forcing the
    // by-email fallback), just sequentially; this cuts that wall-clock time
    // roughly to one round trip instead of three.
    const [{ data: hostTenant }, { data: adminByUserId }, { data: adminByEmail }] = await Promise.all([
      admin.from("tenants").select("id").eq("custom_domain", host).maybeSingle(),
      admin.from("platform_admins").select("id").eq("user_id", user.id).maybeSingle(),
      admin.from("platform_admins").select("id").eq("email", user.email ?? "").maybeSingle(),
    ]);

    if (hostTenant) {
      // Platform admins get standing access to every tenant's dedicated domain,
      // without needing a per-tenant tenant_users row or invite.
      const isPlatformAdminUser = !!adminByUserId || !!adminByEmail;

      if (isPlatformAdminUser) {
        resolvedTenantId = hostTenant.id;
        resolvedRole = "admin";
      } else {
        // Check directly for a row on THIS tenant, not "the" tenant_users row --
        // a user can belong to more than one tenant now (see invite routes).
        const { data: membership } = await admin
          .from("tenant_users")
          .select("role, is_locked, valid_from, valid_to")
          .eq("user_id", user.id)
          .eq("tenant_id", hostTenant.id)
          .maybeSingle();
        if (!membership) {
          // Session belongs to a different tenant than this domain resolves to — hard isolation.
          return denyWrongWorkspace();
        }
        if (!isMembershipActive(membership)) return denyLocked();
        resolvedTenantId = hostTenant.id;
        resolvedRole = (membership.role as "admin" | "member") ?? "member";
      }
    }
  }

  if (resolvedTenantId && resolvedRole) {
    // Hand the already-verified identity + tenant resolution downstream so
    // supabase-server.ts can skip repeating the same auth.getUser() network
    // call and the same tenant/membership queries on every render/route.
    requestHeaders.set(TRUSTED_USER_ID_HEADER, user.id);
    requestHeaders.set(TRUSTED_EMAIL_HEADER, user.email ?? "");
    requestHeaders.set(TRUSTED_TENANT_ID_HEADER, resolvedTenantId);
    requestHeaders.set(TRUSTED_ROLE_HEADER, resolvedRole);
    const finalResponse = NextResponse.next({ request: { headers: requestHeaders } });
    response.cookies.getAll().forEach((cookie) => finalResponse.cookies.set(cookie));
    return finalResponse;
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
