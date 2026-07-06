import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const type = searchParams.get("type");
  const next = type === "recovery"
    ? "/reset-password"
    : (searchParams.get("next") ?? "/");

  // PKCE flow — code in query param
  if (code) {
    const response = NextResponse.redirect(`${origin}${next}`);
    const supabase = createServerClient(
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
      }
    );
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return response;
  }

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
