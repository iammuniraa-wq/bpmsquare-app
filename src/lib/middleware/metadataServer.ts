import "server-only";
import { unstable_cache, revalidateTag } from "next/cache";
import { createAdminSupabase } from "@/lib/supabase-server";
import { loadD365 } from "@/lib/connectors/d365/server";
import { entityConfig, outboundConfig } from "@/lib/connectors/d365/catalog";
import type { D365Config, D365Product } from "@/lib/connectors/d365/types";
import type { D365Client } from "@/lib/connectors/d365/odata";
import { middlewareClient } from "./client";
import { fieldsFromSampleRow, parseDataverseAttributes, parseODataMetadata, type ErpField, type MetadataEntity } from "./metadata";

// Live field lists from the connected ERP. Admin-only (the route enforces it),
// tenant-scoped, fetched through the middleware client (fetchPublic), and
// cached per tenant, product, environment and entity set for a few minutes.
// Credentials stay inside the closure; nothing about them is returned.

export const METADATA_TTL_SECONDS = 300;

export type MetadataResult =
  | { ok: true; entity: MetadataEntity; applicable: true; fields: ErpField[]; fetchedAt: string; source: "metadata" | "sample" }
  | { ok: true; entity: MetadataEntity; applicable: false; fields: []; fetchedAt: string; hint: string }
  | { ok: false; state: "not_connected" | "error"; message: string };

const DATAVERSE_LOGICAL: Partial<Record<MetadataEntity, string>> = {
  quote: "quote", quote_line: "quotedetail", sales_order: "salesorder", sales_order_line: "salesorderdetail", account: "account", customers: "account", vendors: "account",
  contact: "contact", contacts: "contact", product: "product", products: "product",
};

const PULL_KEY: Partial<Record<MetadataEntity, "customers" | "contacts" | "vendors" | "products" | "projects">> = {
  account: "customers", customers: "customers", contact: "contacts", contacts: "contacts", vendors: "vendors",
  product: "products", products: "products", project: "projects", projects: "projects",
};

const q = (s: string) => s.replace(/'/g, "''");

/** The entity set an ERP product exposes for a BPMSquare entity, or null when it has none. */
export function entitySetFor(cfg: Pick<D365Config, "product" | "entities" | "outbound">, entity: MetadataEntity): string | null {
  if (entity === "quote" || entity === "quote_line") return cfg.product === "dataverse" ? (entity === "quote" ? "quotes" : "quotedetails") : null;
  if (entity === "sales_order" || entity === "sales_order_line") {
    if (cfg.product === "dataverse") return entity === "sales_order" ? "salesorders" : "salesorderdetails";
    return entity === "sales_order" ? outboundConfig(cfg).sales_order.entity_set || null : null;
  }
  if (entity === "project" || entity === "projects") {
    const own = outboundConfig(cfg).project.entity_set;
    if (cfg.product === "dataverse") return entityConfig(cfg, "projects")?.entity_set || null;
    return own || entityConfig(cfg, "projects")?.entity_set || null;
  }
  const key = PULL_KEY[entity];
  return key ? entityConfig(cfg, key)?.entity_set || null : null;
}

/** The table's logical name: known for the standard ones, otherwise looked up from its entity set. */
export async function dataverseLogicalName(client: Pick<D365Client, "get">, entity: MetadataEntity, set: string): Promise<string> {
  const known = DATAVERSE_LOGICAL[entity];
  if (known) return known;
  const r = (await client.get("EntityDefinitions", { $select: "LogicalName", $filter: `EntitySetName eq '${q(set)}'` })) as { value?: { LogicalName?: string }[] };
  const logical = r.value?.[0]?.LogicalName;
  if (!logical) throw new Error(`Dynamics does not know the table ${set}.`);
  return logical;
}

async function fetchFields(tenantId: string, entity: MetadataEntity, product: D365Product): Promise<{ fields: ErpField[]; source: "metadata" | "sample"; fetchedAt: string } | { notApplicable: string; fetchedAt: string }> {
  const admin = createAdminSupabase();
  const loaded = await loadD365(admin, tenantId);
  if (!loaded) throw new Error("not_connected");
  const { cfg, creds } = loaded;
  const set = entitySetFor(cfg, entity);
  if (!set) return { fetchedAt: new Date().toISOString(), notApplicable: product === "dataverse" ? "This entity is not mapped for the connected product." : "Finance and Operations and Business Central take a Project, not a quote." };

  if (product === "dataverse") {
    const client = await middlewareClient(admin, tenantId, cfg, creds);
    const logical = await dataverseLogicalName(client, entity, set);
    const json = await client.get(`EntityDefinitions(LogicalName='${q(logical)}')/Attributes`, { $select: "LogicalName,DisplayName,AttributeType,RequiredLevel,IsValidForCreate,AttributeOf,IsValidForAdvancedFind" });
    return { fields: parseDataverseAttributes(json), source: "metadata", fetchedAt: new Date().toISOString() };
  }

  // Business Central lists companies one level above a company-scoped base; its
  // $metadata lives at the API root.
  const client = await middlewareClient(admin, tenantId, product === "bc" ? { ...cfg, company: undefined } : cfg, creds);
  try {
    const res = await client.requestRaw("GET", "$metadata", { headers: { Accept: "application/xml" } });
    const fields = parseODataMetadata(res.text, set);
    if (fields.length) return { fields, source: "metadata", fetchedAt: new Date().toISOString() };
  } catch {
    // Too large or refused: fall back to a sample row below.
  }
  const sample = await (await middlewareClient(admin, tenantId, cfg, creds)).get(set, { $top: "1" }) as { value?: Record<string, unknown>[] };
  return { fields: fieldsFromSampleRow(sample.value?.[0]), source: "sample", fetchedAt: new Date().toISOString() };
}

export async function getErpMetadata(tenantId: string, entity: MetadataEntity, opts: { refresh?: boolean } = {}): Promise<MetadataResult> {
  const loaded = await loadD365(createAdminSupabase(), tenantId);
  if (!loaded) return { ok: false, state: "not_connected", message: "No ERP is connected yet. Connect one under Connections." };
  const { cfg } = loaded;
  const tag = `mw-metadata:${tenantId}`;
  if (opts.refresh) revalidateTag(tag, { expire: 0 });
  const set = entitySetFor(cfg, entity) ?? "-";
  try {
    const run = unstable_cache(
      () => fetchFields(tenantId, entity, cfg.product),
      ["mw-metadata", tenantId, cfg.product, cfg.environment_url, entity, set],
      { revalidate: METADATA_TTL_SECONDS, tags: [tag] },
    );
    const r = await run();
    if ("notApplicable" in r) return { ok: true, entity, applicable: false, fields: [], fetchedAt: r.fetchedAt, hint: r.notApplicable };
    return { ok: true, entity, applicable: true, fields: r.fields, fetchedAt: r.fetchedAt, source: r.source };
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "not_connected") return { ok: false, state: "not_connected", message: "No ERP is connected yet. Connect one under Connections." };
    return { ok: false, state: "error", message: msg || "The ERP did not return its field list." };
  }
}
