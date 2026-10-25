import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantConfig, TenantFeatures } from "@/lib/constants";
import { CONNECTOR_ID, loadD365 } from "@/lib/connectors/d365/server";
import type { D365Config } from "@/lib/connectors/d365/types";
import type { ErpHttp } from "@/lib/middleware/erp";
import { middlewareClient } from "@/lib/middleware/client";
import { plainFailure } from "@/lib/middleware/payload";

// What Check with ERP and Send to ERP both need before they talk to the ERP: the workspace's own connector (read with the
// tenant filter, never from a request), checked to be the Dataverse one these actions are built for, and a client for it.
// A test hands in its own `http`, as the quote dispatcher's tests do.

export type TenantRow = { features: TenantFeatures | null; config: TenantConfig | null; custom_domain: string | null };

export type ErpOpen =
  | { ok: true; cfg: D365Config; http: ErpHttp; tenant: TenantRow; middleware: boolean }
  | { ok: false; kind: "no_connector" | "unsupported" | "unreachable"; message: string };

export async function loadTenantRow(admin: SupabaseClient, tenantId: string): Promise<TenantRow | null> {
  const { data } = await admin.from("tenants").select("features, config, custom_domain").eq("id", tenantId).maybeSingle();
  return (data as TenantRow | null) ?? null;
}

export async function openErp(admin: SupabaseClient, tenantId: string, tenant: TenantRow, injected?: ErpHttp): Promise<ErpOpen> {
  const loaded = await loadD365(admin, tenantId);
  if (!loaded) return { ok: false, kind: "no_connector", message: "No ERP is connected. Connect Dynamics 365 under Settings > Integration middleware." };
  if (loaded.cfg.product !== "dataverse") {
    return { ok: false, kind: "unsupported", message: "Checking and sending orders is built for Dynamics 365 Sales (Dataverse). This connection is a different product." };
  }
  let http: ErpHttp;
  try {
    http = injected ?? (await middlewareClient(admin, tenantId, loaded.cfg, loaded.creds));
  } catch (e) {
    const f = plainFailure(e as { status?: number; message?: string }, undefined, "order");
    return { ok: false, kind: "unreachable", message: `${f.headline} ${f.fix}` };
  }
  return { ok: true, cfg: loaded.cfg, http, tenant, middleware: tenant.features?.integration_middleware === true };
}

/** The ERP's id of the order's customer, from the link a customer sync made (tenant-scoped). */
export async function customerErpId(admin: SupabaseClient, tenantId: string, accountId: string | null): Promise<string | null> {
  if (!accountId) return null;
  const { data } = await admin.from("connector_links").select("external_id").eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID)
    .eq("entity", "customers").eq("object_id", accountId).limit(1).maybeSingle();
  const id = (data as { external_id?: string } | null)?.external_id;
  if (!id) return null;
  const m = id.match(/^([a-z0-9]{1,8})\|(.+)$/);
  return m ? m[2] : id;
}

/** ERP ids of the products that have a counterpart there, keyed by the BPMSquare product id. */
export async function productErpIds(admin: SupabaseClient, tenantId: string, productIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(productIds)];
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await admin.from("connector_links").select("object_id, external_id").eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID)
      .eq("entity", "products").in("object_id", ids.slice(i, i + 100));
    for (const r of (data ?? []) as { object_id: string; external_id: string }[]) out.set(r.object_id, r.external_id);
  }
  return out;
}
