export function checkApiKey(req: Request): boolean {
  const auth = req.headers.get("Authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7).trim() : auth.trim();
  const expected = process.env.VEVEY_API_KEY;
  if (!expected) return false; // key not configured — block all access
  return provided === expected;
}

/**
 * Per-tenant bearer auth for genuinely live-data v1 routes (inventory, purchase-orders).
 * Additive to checkApiKey -- the legacy routes (accounts/cases/quotations) keep using the
 * single process-wide key against seed data; this resolves a real tenant from tenants.api_key.
 */
export async function resolveTenantFromBearer(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;
  const { createAdminSupabase } = await import("@/lib/supabase-server");
  const { data } = await createAdminSupabase().from("tenants").select("id").eq("api_key", token).maybeSingle();
  return data?.id ?? null;
}

export const ERR_401 = () =>
  Response.json(
    { error: "Unauthorized", message: "Include header: Authorization: Bearer <VEVEY_API_KEY>" },
    { status: 401, headers: { "Content-Type": "application/json" } }
  );

/** For routes authenticated via resolveTenantFromBearer (per-tenant key, not VEVEY_API_KEY). */
export const ERR_401_TENANT = () =>
  Response.json(
    { error: "Unauthorized", message: "Include header: Authorization: Bearer <tenant API key>. Generate one in Settings → Admin → this tenant." },
    { status: 401, headers: { "Content-Type": "application/json" } }
  );

export const jsonOk = (data: unknown) =>
  Response.json(data, {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
    },
  });
