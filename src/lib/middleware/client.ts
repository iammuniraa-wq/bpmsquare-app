import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { D365Client, D365Error, type FetchLike } from "@/lib/connectors/d365/odata";
import { apiBase, allowedHost } from "@/lib/connectors/d365/catalog";
import { authHeaderFor } from "@/lib/connectors/d365/server";
import type { D365Config } from "@/lib/connectors/d365/types";
import { assertSafeHttpsUrl, fetchPublic } from "@/lib/net/safeHost";

/**
 * An ERP client for the middleware. The environment URL is typed by a tenant
 * and fetched by OUR server, so every request goes through fetchPublic()
 * (public host only, re-checked on each redirect hop, the Authorization header
 * dropped if a redirect leaves the origin) on top of the connector's own host
 * allow-list. Credentials never leave this function's closure.
 */
export async function middlewareClient(admin: SupabaseClient, tenantId: string, cfg: D365Config, creds: Record<string, string>): Promise<D365Client> {
  const base = apiBase(cfg);
  const url = await assertSafeHttpsUrl(base);
  if (!allowedHost(cfg, url.hostname)) throw new D365Error("Environment URL isn't a Dynamics 365 address.", 400);
  const safeFetch: FetchLike = (u, init) => fetchPublic(u, init);
  return new D365Client(base, () => authHeaderFor(admin, tenantId, cfg, creds), {
    fetch: safeFetch,
    onUnauthorized: async () => { delete creds.access_token; delete creds.expires_at; },
  });
}
