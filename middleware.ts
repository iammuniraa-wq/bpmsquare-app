import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { isPrimaryOrDevHost } from "@/lib/constants";

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

  // Hostname-based tenant isolation — only applies to dedicated tenant domains
  // (e.g. vikas.bpmsquare.com). The shared PRIMARY_HOST and local dev pass through unchanged.
  const host = (request.headers.get("host") ?? "").split(":")[0];
  if (!isPrimaryOrDevHost(host)) {
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: hostTenant } = await admin
      .from("tenants")
      .select("id")
      .eq("custom_domain", host)
      .maybeSingle();

    if (hostTenant) {
      // Platform admins get standing access to every tenant's dedicated domain,
      // without needing a per-tenant tenant_users row or invite.
      let isPlatformAdminUser = false;
      const { data: adminByUserId } = await admin
        .from("platform_admins")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      isPlatformAdminUser = !!adminByUserId;
      if (!isPlatformAdminUser) {
        const { data: adminByEmail } = await admin
          .from("platform_admins")
          .select("id")
          .eq("email", user.email ?? "")
          .maybeSingle();
        isPlatformAdminUser = !!adminByEmail;
      }

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
        await supabase.auth.signOut();
        const loginUrl = new URL("/login", request.url);
        loginUrl.searchParams.set("next", pathname);
        loginUrl.searchParams.set("error", "wrong_workspace");
        const redirect = NextResponse.redirect(loginUrl);
        response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
        return redirect;
      }
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
