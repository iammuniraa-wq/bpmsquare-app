import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantConfig } from "@/lib/constants";
import { CONNECTOR_ID, loadD365 } from "@/lib/connectors/d365/server";
import type { D365Config } from "@/lib/connectors/d365/types";
import { resolveTarget } from "./contract";
import { readDocument } from "./documents";
import { getErpMetadata } from "./metadataServer";
import type { ErpField, MetadataEntity } from "./metadata";
import { applyMapping, buildMappingView, isMappingDoc, quoteKinds, resetMapping, type MappingChange, type MappingDocKey, type MappingView, type RowError } from "./mappingDoc";
import type { MapKind } from "./payload";
import type { TargetKind } from "./types";

// The server half of the two-column Mapping tab: read the connection and the Quote document, ask the ERP for its
// own field lists (cached, through fetchPublic), and write the changed map back to the connection's config.
// Every query names the tenant.

export type FieldFetcher = (entity: MetadataEntity) => Promise<ErpField[]>;

const KIND_ENTITY: Record<MapKind, MetadataEntity> = {
  quote: "quote", quote_line: "quote_line", sales_order: "sales_order", sales_order_line: "sales_order_line", project: "project",
};

/** The default fetcher: the ERP's own list, or nothing when it cannot be read (the screen then offers the mapped names only). */
export const metadataFetcher = (tenantId: string): FieldFetcher => async (entity) => {
  const r = await getErpMetadata(tenantId, entity);
  return r.ok && r.applicable ? r.fields : [];
};

async function context(admin: SupabaseClient, tenantId: string) {
  const [{ data: t }, loaded] = await Promise.all([admin.from("tenants").select("config").eq("id", tenantId).maybeSingle(), loadD365(admin, tenantId)]);
  const target = loaded ? resolveTarget(loaded.cfg.product, readDocument((t?.config as TenantConfig | null)?.integration_middleware).target) : ("quote" as TargetKind);
  return { loaded, target };
}

async function fieldLists(cfg: D365Config, doc: MappingDocKey, target: TargetKind, fetch: FieldFetcher): Promise<{ header: ErpField[]; lines: ErpField[] }> {
  if (doc !== "quote") return { header: await fetch(doc as MetadataEntity), lines: [] };
  const k = quoteKinds(cfg.product, target);
  const [header, lines] = await Promise.all([fetch(KIND_ENTITY[k.header]), k.lines ? fetch(KIND_ENTITY[k.lines]) : Promise.resolve([] as ErpField[])]);
  return { header, lines };
}

export async function getMapping(admin: SupabaseClient, tenantId: string, doc: MappingDocKey, fetch: FieldFetcher = metadataFetcher(tenantId)): Promise<MappingView | { connected: false }> {
  const { loaded, target } = await context(admin, tenantId);
  if (!loaded) return { connected: false };
  return buildMappingView({ doc, cfg: loaded.cfg, target, erpFields: await fieldLists(loaded.cfg, doc, target, fetch) });
}

async function store(admin: SupabaseClient, tenantId: string, cfg: D365Config, change: MappingChange): Promise<string | null> {
  const next: D365Config = { ...cfg };
  if ("outbound" in change) { if (change.outbound) next.outbound = change.outbound; else delete next.outbound; }
  if ("orders" in change) { if (change.orders) next.orders = change.orders; else delete next.orders; }
  if (change.entities) next.entities = change.entities;
  const { error } = await admin.from("tenant_connectors").update({ config: next as unknown as Record<string, string>, updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID);
  return error ? error.message : null;
}

export type SaveMappingResult = { ok: true; view: MappingView } | { ok: false; status: number; error: string; errors?: RowError[] };

export async function saveMapping(admin: SupabaseClient, tenantId: string, body: unknown, fetch: FieldFetcher = metadataFetcher(tenantId)): Promise<SaveMappingResult> {
  const b = (body && typeof body === "object" ? body : {}) as { document?: unknown; section?: unknown; rows?: unknown; entity_set?: unknown; id_field?: unknown };
  if (!isMappingDoc(b.document)) return { ok: false, status: 422, error: "Choose which mapping to save." };
  if (b.section !== "header" && b.section !== "lines") return { ok: false, status: 422, error: "section must be header or lines." };
  if (!Array.isArray(b.rows) || b.rows.length > 200) return { ok: false, status: 422, error: "Send the rows to save." };
  const rows = b.rows.map((r) => ({ id: String((r as { id?: unknown })?.id ?? ""), erp: (r as { erp?: unknown })?.erp === null || (r as { erp?: unknown })?.erp === undefined ? null : ((r as { erp?: unknown }).erp as string) }));
  const { loaded, target } = await context(admin, tenantId);
  if (!loaded) return { ok: false, status: 400, error: "Connect your ERP first." };
  const erpFields = await fieldLists(loaded.cfg, b.document, target, fetch);
  const r = applyMapping({
    doc: b.document, cfg: loaded.cfg, target, erpFields, section: b.section, rows,
    settings: b.entity_set !== undefined || b.id_field !== undefined ? { entity_set: b.entity_set, id_field: b.id_field } : undefined,
  });
  if (!r.ok) return { ok: false, status: 422, error: r.errors[0].message, errors: r.errors };
  const err = await store(admin, tenantId, loaded.cfg, r.change);
  if (err) return { ok: false, status: 500, error: err };
  const after = await loadD365(admin, tenantId);
  return { ok: true, view: buildMappingView({ doc: b.document, cfg: after?.cfg ?? loaded.cfg, target, erpFields }) };
}

export async function resetMappingOp(admin: SupabaseClient, tenantId: string, body: unknown, fetch: FieldFetcher = metadataFetcher(tenantId)): Promise<SaveMappingResult> {
  const doc = (body as { document?: unknown } | null)?.document;
  if (!isMappingDoc(doc)) return { ok: false, status: 422, error: "Choose which mapping to reset." };
  const { loaded, target } = await context(admin, tenantId);
  if (!loaded) return { ok: false, status: 400, error: "Connect your ERP first." };
  const err = await store(admin, tenantId, loaded.cfg, resetMapping(loaded.cfg, doc, target));
  if (err) return { ok: false, status: 500, error: err };
  const after = await loadD365(admin, tenantId);
  return { ok: true, view: buildMappingView({ doc, cfg: after?.cfg ?? loaded.cfg, target, erpFields: await fieldLists(loaded.cfg, doc, target, fetch) }) };
}
