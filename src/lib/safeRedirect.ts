// Validates a `next` redirect target from a query param / request body before
// it's ever used in a redirect or (in src/app/auth/callback/route.ts) embedded
// into an inline <script> string literal. Two distinct risks in one check:
//  - open redirect: a value that isn't an internal path (e.g. "evil.com" or
//    "//evil.com") would send an authenticated user off to attacker infra
//    right after a genuine login/magic-link/invite completes.
//  - string-literal injection: auth/callback/route.ts's implicit-flow HTML
//    interpolates `next` directly into `'${next}'` inside a <script> tag with
//    no escaping -- a value containing a quote character could break out of
//    the JS string and inject arbitrary script, exfiltrating the (non-httpOnly,
//    required by @supabase/ssr's browser-read model) session cookie.
// Restricting to a strict internal-path charset (no quotes, backslash, angle
// brackets, semicolons, whitespace) closes both at once.
const SAFE_PATH_RE = /^\/(?!\/)[A-Za-z0-9\-._~/?=&%]*$/;

export function safeInternalPath(path: string | null | undefined, fallback = "/"): string {
  if (path && SAFE_PATH_RE.test(path)) return path;
  return fallback;
}
