import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_COOKIE_OPTIONS } from "@/lib/constants";
import { createAdminSupabase } from "@/lib/supabase-server";
import { controlPlanePublicKeys, instanceSlug } from "@/lib/controlPlane/crypto";
import { acceptHandoff } from "@/lib/controlPlane/handoff";
import { safeInternalPath } from "@/lib/safeRedirect";

// GET /api/platform/handoff?t=<token>&next=/admin -- the landing end of "Open admin" in the control plane console.
// Public to the proxy (the signed token is the credential). Dark by default: 404 unless CONTROL_PLANE_PUBLIC_KEYS is set.
// acceptHandoff() proves: the Ed25519 signature, the lifetime (<= 120 s), that the token was minted FOR this instance
// (INSTANCE_SLUG), that its subject is a platform admin in THIS database, and that its jti was never used (platform_handoffs).
// Only then is a session made, the same way the e-mail links do it (generateLink -> hashed_token -> verifyOtp, as in
// api/auth/request-reset and auth/callback), so the cookies are the ones @supabase/ssr always sets. No other sign-in path exists here.

export const dynamic = "force-dynamic";

const refuse = (status: number, reason: string) =>
  NextResponse.json({ error: "handoff refused", reason }, { status, headers: { "cache-control": "no-store" } });

export async function GET(request: NextRequest) {
  const keys = controlPlanePublicKeys();
  if (keys.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { searchParams, origin } = new URL(request.url);
  const admin = createAdminSupabase();
  const outcome = await acceptHandoff(admin, searchParams.get("t"), keys, instanceSlug());
  if (!outcome.ok) return refuse(outcome.status, outcome.reason);

  const next = safeInternalPath(searchParams.get("next"), "/admin");

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email: outcome.email });
  const hashed = link?.properties?.hashed_token;
  // The link is for the account the platform_admins row points at, never for whichever account the e-mail happens to resolve to.
  if (linkError || !hashed || link?.user?.id !== outcome.userId) return refuse(502, "session_not_established");

  const response = NextResponse.redirect(`${origin}${next}`);
  response.headers.set("cache-control", "no-store");
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() { return request.cookies.getAll(); },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
    cookieOptions: SUPABASE_COOKIE_OPTIONS,
  });
  const { error } = await supabase.auth.verifyOtp({ token_hash: hashed, type: "magiclink" });
  if (error) return refuse(502, "session_not_established");
  return response;
}
