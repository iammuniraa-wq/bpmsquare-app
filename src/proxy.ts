import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import {
  isPrimaryOrDevHost, PRIMARY_HOST, isMembershipActive,
  TRUSTED_USER_ID_HEADER, TRUSTED_EMAIL_HEADER, TRUSTED_TENANT_ID_HEADER, TRUSTED_ROLE_HEADER,
  PATHNAME_HEADER, SUPABASE_COOKIE_OPTIONS,
} from "@/lib/constants";

// Next 16 "proxy" convention (the renamed middleware): ALWAYS runs on the
// Node.js runtime, which on Vercel executes in the project's pinned function
// region (icn1, next to the Seoul database) instead of at the edge nearest
// the visitor. That co-location matters here: this file makes an auth
// verification call plus tenant-resolution queries on every request, and
// from a far-away visitor's edge each of those crossed to Seoul (~200 ms a
// hop, 400-700 ms of TTFB per navigation). As a plain rename of the old
// middleware.ts its behavior is otherwise identical.
export async function proxy(request: NextRequest) {
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
  requestHeaders.delete(PATHNAME_HEADER);
  requestHeaders.set(PATHNAME_HEADER, pathname);

  // Public paths — never intercept
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/reset-password") ||
    pathname.startsWith("/auth/") ||
    // The two auth endpoints that exist precisely BECAUSE there is no
    // session yet -- asking for a password-reset email, and exchanging
    // implicit-flow tokens for real SSR cookies. The session gate below
    // would redirect both to /login, which is how a reset request could
    // appear to succeed while silently never sending anything. Neither
    // reads a client-supplied tenant: request-reset resolves the tenant
    // from the host and answers identically whether or not the address
    // exists. /api/auth/complete-password-change is deliberately NOT here
    // -- it needs a session and calls requireTenantUser() itself.
    pathname === "/api/auth/request-reset" ||
    pathname === "/api/auth/session" ||
    // Face sign-in: by nature pre-session (the caller is trying to GET a
    // session). Tenant is resolved from the host inside the route, the
    // feature is per-tenant opt-in (config.wfm.face_login), and a match only
    // ever yields a single-use token for the matched employee's own login --
    // same reasoning as request-reset above. Without this bypass the session
    // gate 307'd the POST to /login, which is why face sign-in "never
    // recognised" anyone: the route was never reached.
    pathname === "/api/auth/face-login" ||
    // Passkey sign-in's pre-session pair -- same reasoning as face-login. The
    // REGISTER pair is deliberately NOT here: it requires a session.
    pathname === "/api/auth/passkey/login-options" ||
    pathname === "/api/auth/passkey/login-verify" ||
    // The attendance kiosk: a wall tablet with no user session. Its whole
    // credential is a registered device token, verified by
    // authenticateKiosk() inside each of these three routes (and the page
    // itself renders a setup screen until a valid token is stored). The
    // admin device-management route (/api/wfm/kiosk/devices) is
    // deliberately NOT here -- it requires a real session. $-anchored so
    // nothing deeper ever rides along.
    pathname === "/kiosk" ||
    /^\/api\/wfm\/kiosk\/(session|identify|punch)$/.test(pathname) ||
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
    pathname.startsWith("/api/v1/") ||
    // Vercel Cron invocations carry no user session -- just their own
    // CRON_SECRET bearer token, checked inside the route itself (same
    // reasoning as /api/v1 above: a credential in the request, not a
    // cookie, so the session gate would make it uncallable).
    // Prefix rather than an exact path: every /api/wfm/cron/* route is a
    // scheduled job authenticated by CRON_SECRET inside the route itself, and
    // listing them one by one is how the hours-alert job came to be silently
    // 307'd to /login on its very first run (2026-09-04).
    pathname.startsWith("/api/wfm/cron/")
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

    const [{ data: demoTenant }, { data: adminByUserId }, { data: adminByEmail }, { data: ownRows }] = await Promise.all([
      admin.from("tenants").select("id").eq("is_demo", true).maybeSingle(),
      admin.from("platform_admins").select("id").eq("user_id", user.id).maybeSingle(),
      admin.from("platform_admins").select("id").eq("email", user.email ?? "").maybeSingle(),
      admin.from("tenant_users").select("tenant_id, role, is_locked, valid_from, valid_to").eq("user_id", user.id),
    ]);

    const isPlatformAdminUser = !!adminByUserId || !!adminByEmail;
    if (isPlatformAdminUser) {
      resolvedTenantId = demoTenant?.id ?? null;
      resolvedRole = "admin";
      // Trusting "admin" here without a matching tenant_users row is exactly
      // what RLS then contradicts: policies like "employees: admin insert"
      // check the real row, not this header, so a platform admin with no row
      // (or a stale non-admin one) gets waved through this check only to have
      // Postgres reject the write anyway. Lazily upsert the row to match --
      // idempotent, and onConflict without ignoreDuplicates means an existing
      // row's role is actually promoted, not silently left as-is. Skipped
      // when the row already says admin (the steady state after the first
      // request), so the hot path stays read-only.
      const existing = (ownRows ?? []).find((r) => r.tenant_id === resolvedTenantId);
      if (resolvedTenantId && existing?.role !== "admin") {
        await admin
          .from("tenant_users")
          .upsert({ tenant_id: resolvedTenantId, user_id: user.id, role: "admin" }, { onConflict: "tenant_id,user_id" });
      }
    } else if (demoTenant) {
      const membership = (ownRows ?? []).find((r) => r.tenant_id === demoTenant.id) ?? null;
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
    const [{ data: hostTenant }, { data: adminByUserId }, { data: adminByEmail }, { data: ownRows }] = await Promise.all([
      admin.from("tenants").select("id").eq("custom_domain", host).maybeSingle(),
      admin.from("platform_admins").select("id").eq("user_id", user.id).maybeSingle(),
      admin.from("platform_admins").select("id").eq("email", user.email ?? "").maybeSingle(),
      admin.from("tenant_users").select("tenant_id, role, is_locked, valid_from, valid_to").eq("user_id", user.id),
    ]);

    if (hostTenant) {
      // Platform admins get standing access to every tenant's dedicated domain,
      // without needing a per-tenant tenant_users row or invite.
      const isPlatformAdminUser = !!adminByUserId || !!adminByEmail;

      if (isPlatformAdminUser) {
        resolvedTenantId = hostTenant.id;
        resolvedRole = "admin";
        // Same reasoning as the PRIMARY_HOST/demo-tenant branch above --
        // lazily upsert so the real tenant_users row backs this trusted
        // header, instead of RLS rejecting a write the app thinks is fine.
        // Skipped when the row already says admin, keeping the hot path
        // read-only.
        const existing = (ownRows ?? []).find((r) => r.tenant_id === hostTenant.id);
        if (existing?.role !== "admin") {
          await admin
            .from("tenant_users")
            .upsert({ tenant_id: hostTenant.id, user_id: user.id, role: "admin" }, { onConflict: "tenant_id,user_id" });
        }
      } else {
        // The row for THIS tenant specifically, out of the user's memberships
        // (already fetched in the parallel batch above) -- a user can belong
        // to more than one tenant now (see invite routes).
        const membership = (ownRows ?? []).find((r) => r.tenant_id === hostTenant.id) ?? null;
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
