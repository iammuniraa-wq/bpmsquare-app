import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { safeInternalPath } from "@/lib/safeRedirect";
import { SUPABASE_COOKIE_OPTIONS } from "@/lib/constants";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code      = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type      = searchParams.get("type");
  const next = type === "recovery"
    ? "/reset-password"
    : safeInternalPath(searchParams.get("next"));

  const makeSupabase = (response: NextResponse) =>
    createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return request.cookies.getAll(); },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options)
            );
          },
        },
        cookieOptions: SUPABASE_COOKIE_OPTIONS,
      }
    );

  // A recovery link that fails here must land back on /reset-password with
  // a reason, NOT on /login. Falling through to the implicit-flow page below
  // sent the user to /login?error=auth, which the login screen doesn't even
  // render a message for -- so a broken link looked exactly like "clicking
  // reset just opens the login page", and retrying produced the same
  // silence. The link being dead is a thing the user needs told.
  const isRecovery = type === "recovery" || next === "/reset-password";
  const recoveryFailed = (reason: string) =>
    NextResponse.redirect(`${origin}/reset-password?error=${encodeURIComponent(reason)}`);

  // token_hash flow — used by our own reset email (api/auth/request-reset),
  // and by any Supabase template that sends {{ .TokenHash }}. No PKCE code
  // verifier is involved, so it works from any browser or device.
  if (tokenHash && type) {
    const response = NextResponse.redirect(`${origin}${next}`);
    const supabase = makeSupabase(response);
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as "recovery" | "email" | "magiclink" | "invite",
    });
    if (!error) return response;
    if (isRecovery) return recoveryFailed(error.message);
  }

  // PKCE flow — code in query param. Only succeeds in the same browser that
  // asked for the link (the code verifier is a cookie on that origin).
  if (code) {
    const response = NextResponse.redirect(`${origin}${next}`);
    const supabase = makeSupabase(response);
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return response;
    if (isRecovery) return recoveryFailed(error.message);
  }

  if (isRecovery) return recoveryFailed("This reset link is no longer valid.");

  // Implicit flow — tokens arrive in URL fragment (client-side only).
  // Client reads fragment, POSTs tokens to /api/auth/session, then redirects.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  return new NextResponse(
    `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Signing in…</title></head>
<body style="font-family:sans-serif;padding:40px;background:#0f1117;color:#9ca3af">
  <p>Signing you in…</p>
  <script>
    (async function() {
      const hash = window.location.hash.slice(1);
      const params = new URLSearchParams(hash);
      const access_token = params.get('access_token');
      const refresh_token = params.get('refresh_token') || '';

      if (!access_token) {
        window.location.replace('${origin}/login?error=auth');
        return;
      }

      const type = params.get('type');
      const destination = type === 'recovery' ? '/reset-password' : '${next}';

      // POST tokens to server so it can set proper SSR cookies
      const res = await fetch('${origin}/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token, refresh_token, next: destination }),
        credentials: 'include',
      });

      if (res.ok) {
        window.location.replace('${origin}' + destination);
      } else {
        window.location.replace('${origin}/login?error=auth');
      }
    })();
  </script>
</body></html>`,
    { headers: { "content-type": "text/html" } }
  );
}
