import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @sparticuz/chromium's prebuilt Chromium binary lives in its own bin/
  // folder and is loaded at runtime via a relative path, not a static
  // import -- Vercel's output file tracing doesn't pick it up on its own,
  // so the deployed function is missing it entirely ("/var/task/.../bin
  // does not exist") even though @sparticuz/chromium itself is already on
  // Next's built-in serverExternalPackages list. This forces it in.
  //
  // Every route that launches the browser needs its own entry -- the
  // invoice and standard-quote PDF routes were missed when this was added
  // for quotes, and failed with exactly that error until 2026-09-06.
  outputFileTracingIncludes: {
    "/api/quotes/**": ["./node_modules/@sparticuz/chromium/bin/**/*"],
    "/api/standard-quotes/**": ["./node_modules/@sparticuz/chromium/bin/**/*"],
    "/api/invoices/**": ["./node_modules/@sparticuz/chromium/bin/**/*"],
  },
};

export default nextConfig;
