/**
 * Extension registry — maps tenant slug → extension module.
 *
 * To onboard a new tenant with custom logic:
 *   1. Create src/extensions/<slug>/index.tsx
 *   2. Add one line here
 *
 * Standard product code is never touched for tenant customisations.
 */
import type { TenantExtension } from "@/extensions/types";
import base from "@/extensions/_base";

// Static import map — required for Next.js bundler (no dynamic variable imports).
const REGISTRY: Record<string, () => Promise<{ default: TenantExtension }>> = {
  "vikas-pioneers": () => import("@/extensions/vikas"),
  // The demo workspace was the original dev tenant and carried the slug
  // "vikas" until 2026-09-06, when it was renamed "demo" -- the shared slug
  // had made it look like the client's own workspace. It keeps showing the
  // Vikas customisations it always has; drop this line if the demo should
  // become plain product instead. "vikas" stays mapped so nothing breaks
  // between the deploy and the rename.
  demo: () => import("@/extensions/vikas"),
  vikas: () => import("@/extensions/vikas"),
};

let cache: Record<string, TenantExtension> = {};

export async function loadExtension(tenantSlug: string | null | undefined): Promise<TenantExtension> {
  const slug = tenantSlug ?? "_base";
  if (cache[slug]) return cache[slug];

  const loader = REGISTRY[slug];
  const ext = loader ? (await loader()).default : base;
  cache[slug] = ext;
  return ext;
}

/** For use in React Server Components — returns the resolved extension. */
export async function getExtension(tenantSlug: string | null | undefined): Promise<TenantExtension> {
  return loadExtension(tenantSlug);
}
