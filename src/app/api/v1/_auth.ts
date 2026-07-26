/**
 * Every v1 route resolves its tenant from a per-tenant bearer key
 * (tenants.api_key) -- no shared/global key. Generated in Settings → Admin →
 * this tenant.
 */
export async function resolveTenantFromBearer(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;
  const { createAdminSupabase } = await import("@/lib/supabase-server");
  const { data } = await createAdminSupabase().from("tenants").select("id").eq("api_key", token).maybeSingle();
  return data?.id ?? null;
}

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
