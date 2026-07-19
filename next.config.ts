import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @sparticuz/chromium's prebuilt Chromium binary lives in its own bin/
  // folder and is loaded at runtime via a relative path, not a static
  // import -- Vercel's output file tracing doesn't pick it up on its own,
  // so the deployed function is missing it entirely ("/var/task/.../bin
  // does not exist") even though @sparticuz/chromium itself is already on
  // Next's built-in serverExternalPackages list. This forces it in.
  outputFileTracingIncludes: {
    "/api/quotes/**": ["./node_modules/@sparticuz/chromium/bin/**/*"],
  },
};

export default nextConfig;
