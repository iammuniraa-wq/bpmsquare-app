import { createAdminSupabase } from "@/lib/supabase-server";
import type { TenantFeatures } from "@/lib/constants";
import { OBJECT_FEATURE, featureForObject } from "./objectFeatureMap";

// The map itself lives in objectFeatureMap.ts (pure, so client code can read it); everything that already imports it from
// here keeps working.
export { OBJECT_FEATURE, featureForObject };

/** Does this tenant own the module that owns `object`? */
export async function tenantOwnsObject(tenantId: string, object: string): Promise<boolean> {
  return (await tenantObjectAccess(tenantId, object)).owned;
}

/**
 * The same single features read as tenantOwnsObject, keeping the flag the v1
 * call log needs (integration_middleware) so logging an API call costs a
 * workspace without the flag no extra query.
 */
export async function tenantObjectAccess(tenantId: string, object: string): Promise<{ owned: boolean; middleware: boolean }> {
  const key = featureForObject(object);
  if (key === null) return { owned: true, middleware: false };
  const { data } = await createAdminSupabase()
    .from("tenants")
    .select("features")
    .eq("id", tenantId)
    .maybeSingle();
  const f = data?.features as TenantFeatures | undefined;
  return { owned: !!f?.[key], middleware: f?.integration_middleware === true };
}

/**
 * API-route guard. Returns a ready-to-return 404 when the tenant does not
 * own the module, or null to continue.
 *
 * 404 and not 403 on purpose (bpmsquarecore §3b): a tenant without the
 * module should not learn the endpoint exists.
 *
 *   const gate = await assertObjectFeature(tenantId, "products");
 *   if (gate) return gate;
 */
export async function assertObjectFeature(
  tenantId: string,
  object: string
): Promise<Response | null> {
  if (await tenantOwnsObject(tenantId, object)) return null;
  return Response.json({ error: "Not found" }, { status: 404 });
}
