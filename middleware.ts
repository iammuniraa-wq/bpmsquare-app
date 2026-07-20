import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { isPrimaryOrDevHost, PRIMARY_HOST } from "@/lib/constants";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public paths — never intercept
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/reset-password") ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/manifest") ||
    pathname.startsWith("/icons")
  ) {
    return NextResponse.next();
  }

  const response = NextResponse.next({ request });

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

  const denyWrongWorkspace = async () => {
    await supabase.auth.signOut();
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    loginUrl.searchParams.set("error", "wrong_workspace");
    const redirect = NextResponse.redirect(loginUrl);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  };

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
    if (!isPlatformAdminUser && demoTenant) {
      const { data: membership } = await admin
        .from("tenant_users")
        .select("id")
        .eq("user_id", user.id)
        .eq("tenant_id", demoTenant.id)
        .maybeSingle();
      if (!membership) return denyWrongWorkspace();
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

      let tenantMatches = true;
      if (!isPlatformAdminUser) {
        // Check directly for a row on THIS tenant, not "the" tenant_users row --
        // a user can belong to more than one tenant now (see invite routes).
        const { data: membership } = await admin
          .from("tenant_users")
          .select("id")
          .eq("user_id", user.id)
          .eq("tenant_id", hostTenant.id)
          .maybeSingle();
        tenantMatches = !!membership;
      }

      if (!isPlatformAdminUser && !tenantMatches) {
        // Session belongs to a different tenant than this domain resolves to — hard isolation.
        return denyWrongWorkspace();
      }
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
