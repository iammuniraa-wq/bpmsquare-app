import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { allowedHost, sovereignHost } from "./d365/catalog";
import type { D365Config } from "./d365/types";
import { getConnectorDef } from "./registry";

// "Which external system holds this record, and what do people call it
// there?" -- read-only, for the External record line on detail pages.
//
// The answer never carries a GUID as text: `readable` is the link's
// business number (external_key) when there is one, else the record's own
// name where that name is the same thing in both systems (an account, a
// contact, a product), else the ERP's own word for the kind of record
// ("Opportunity", "Sales order"). It is NEVER BPMSquare's own reference
// (SQ-0007): that is not what the ERP calls the record. The raw external id
// is returned only as `title`, for a tooltip. Everything is tenant-scoped, and a missing
// connector table (42P01 / PGRST205) or any other read failure yields no
// links rather than breaking the page.
//
// Connector-agnostic: the system name comes from the link's connector_id
// through the connector registry, a record may carry several links (one per
// connector), and only a connector with a deep-link builder (below) gets an
// "Open in ..." address. A table this file does not know still shows its
// readable key, just without a link.

export type ExternalRef = {
  connectorId: string;
  /** The connector's own name: "Dynamics 365", later "SAP", "ePROMIS". */
  system: string;
  /** What kind of record this is, in words ("Quote", "Purchase order"). */
  objectLabel: string;
  readable: string;
  deepLink: string | null;
  direction: "pull" | "push";
  /** The external system's own id: a tooltip, never a label. */
  title: string;
};

type Rec = Record<string, unknown>;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Every BPMSquare table that can carry a connector link: the label shown for
 * it, the columns that name a record (selected for the readable fallback),
 * and its Dataverse table for the deep link (null = no stable address).
 */
export type ObjectInfo = {
  label: string; cols: string; pick: (r: Rec) => string; dataverse: string | null;
  /** The record's name is a BPMSquare-made reference, not something the ERP also calls it. */
  refBased?: boolean;
};

export const OBJECT_TABLES: Record<string, ObjectInfo> = {
  accounts: { label: "Account", cols: "id, name", pick: (r) => str(r.name), dataverse: "account" },
  contacts: { label: "Contact", cols: "id, name", pick: (r) => str(r.name), dataverse: "contact" },
  products: { label: "Product", cols: "id, name, sku", pick: (r) => str(r.name) || str(r.sku), dataverse: "product" },
  suppliers: { label: "Supplier", cols: "id, name", pick: (r) => str(r.name), dataverse: "account" },
  inventory_items: { label: "Inventory item", cols: "id, name, sku", pick: (r) => str(r.name) || str(r.sku), dataverse: "product" },
  standard_quotes: { label: "Quote", cols: "id, ref", pick: (r) => str(r.ref), dataverse: "quote", refBased: true },
  quotes: { label: "Quotation", cols: "id, ref", pick: (r) => str(r.ref), dataverse: "quote", refBased: true },
  opportunities: { label: "Deal", cols: "id, ref, title", pick: (r) => str(r.ref) || str(r.title), dataverse: "opportunity", refBased: true },
  estimates: { label: "Estimate", cols: "id, ref, name", pick: (r) => str(r.ref) || str(r.name), dataverse: null, refBased: true },
  fence_projects: { label: "Fence project", cols: "id, ref, name", pick: (r) => str(r.ref) || str(r.name), dataverse: null, refBased: true },
  rfqs: { label: "RFQ", cols: "id, ref, title", pick: (r) => str(r.ref) || str(r.title), dataverse: null, refBased: true },
  purchase_orders: { label: "Purchase order", cols: "id, ref", pick: (r) => str(r.ref), dataverse: null, refBased: true },
  invoices: { label: "Invoice", cols: "id, ref", pick: (r) => str(r.ref), dataverse: "invoice", refBased: true },
  work_orders: { label: "Work order", cols: "id, ref", pick: (r) => str(r.ref), dataverse: "msdyn_workorder", refBased: true },
  service_cases: { label: "Case", cols: "id, ref", pick: (r) => str(r.ref), dataverse: "incident", refBased: true },
  wfm_projects: { label: "Project", cols: "id, ref, name", pick: (r) => str(r.ref) || str(r.name), dataverse: "msdyn_project", refBased: true },
  employees: {
    label: "Employee", cols: "id, first_name, last_name, employee_code",
    pick: (r) => str(r.employee_code) || [str(r.first_name), str(r.last_name)].filter(Boolean).join(" "), dataverse: null, refBased: true,
  },
};

/** The ERP's own word for a linked record, from the link's `entity`. Sales orders are filed under "standard_quotes:sales_order". */
const ENTITY_WORD: Record<string, string> = {
  opportunities: "Opportunity", opportunity: "Opportunity", standard_quotes: "Quote", quotes: "Quote", "standard_quotes:sales_order": "Sales order",
  salesorders: "Sales order", invoices: "Invoice", incidents: "Case", msdyn_projects: "Project", projects: "Project",
  customers: "Account", accounts: "Account", contacts: "Contact", products: "Product", vendors: "Vendor",
};

/** What a link with no business number is called: the ERP's kind of record, never BPMSquare's reference. */
export function entityWord(entity: string, fallback: string): string {
  return ENTITY_WORD[entity.trim().toLowerCase()] ?? fallback;
}

const GUID_RE = /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i;
const IDENT_RE = /^[a-z_][a-z0-9_]*$/;

/** Entity set ("opportunities", "msdyn_projects") to its logical name. */
function logicalNameOf(entitySet: string): string | null {
  const s = entitySet.trim().toLowerCase();
  if (!IDENT_RE.test(s)) return null;
  if (s.endsWith("ies")) return `${s.slice(0, -3)}y`;
  if (s.endsWith("s")) return s.slice(0, -1);
  return s;
}

/** The name a connector goes by on screen, from the registry (short form first). */
export function systemLabel(connectorId: string): string {
  const def = getConnectorDef(connectorId);
  return def?.shortName ?? def?.name ?? connectorId;
}

/**
 * Open-in-Dynamics address, or null. Only a Dataverse environment on a host
 * the connector itself accepts becomes a link: the stored URL is tenant-typed
 * and must never be rendered as-is. Finance and Operations and Business
 * Central have no stable per-record address, so they get none.
 */
export function buildDeepLink(
  cfg: Pick<D365Config, "product" | "auth_mode" | "environment_url" | "entities"> | null | undefined,
  objectType: string,
  externalId: string,
  /** The link's own entity: a quote filed as a sales order opens as one. */
  linkEntity?: string,
): string | null {
  if (!cfg || cfg.product !== "dataverse") return null;
  const id = externalId.trim();
  if (!GUID_RE.test(id)) return null;
  let entity = linkEntity === "standard_quotes:sales_order" ? "salesorder" : (OBJECT_TABLES[objectType]?.dataverse ?? null);
  if (!entity && objectType === "fence_projects") {
    const set = cfg.entities?.fence_projects?.entity_set;
    entity = set ? logicalNameOf(set) : null;
  }
  if (!entity) return null;
  let url: URL;
  try { url = new URL(cfg.environment_url.trim()); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  if (sovereignHost(url.hostname) || !allowedHost(cfg, url.hostname)) return null;
  return `${url.origin}/main.aspx?etn=${encodeURIComponent(entity)}&id=${encodeURIComponent(id.replace(/[{}]/g, ""))}&pagetype=entityrecord`;
}

/** Connectors that can build a record address, by connector_id. A connector not listed here shows its key and no link. */
const DEEP_LINK: Record<string, (config: unknown, objectType: string, externalId: string, entity?: string) => string | null> = {
  dynamics365: (config, objectType, externalId, entity) => buildDeepLink(config as D365Config | null, objectType, externalId, entity),
};

type LinkRow = { object_id: string; connector_id: string; entity: string; external_id: string; external_key: string | null; direction: string };

/**
 * External links for a list of records of one object type, keyed by record
 * id, several per record when several connectors are linked. Ids with no link
 * are absent from the result.
 */
export async function externalRefsFor(
  admin: SupabaseClient,
  tenantId: string,
  objectType: string,
  objectIds: string[],
): Promise<Record<string, ExternalRef[]>> {
  const ids = [...new Set(objectIds.filter(Boolean))];
  if (!tenantId || !IDENT_RE.test(objectType) || ids.length === 0) return {};
  const info = OBJECT_TABLES[objectType];
  try {
    const { data: links, error } = await admin.from("connector_links")
      .select("object_id, connector_id, entity, external_id, external_key, direction")
      .eq("tenant_id", tenantId).eq("object_type", objectType).in("object_id", ids)
      .order("created_at", { ascending: true });
    if (error || !links?.length) return {};
    // A "pending:" id is the middleware's claim on a send in flight: nothing exists in the ERP yet.
    const rows = (links as unknown as LinkRow[]).filter((l) => !l.external_id.startsWith("pending:"));
    if (!rows.length) return {};

    const connectorIds = [...new Set(rows.map((l) => l.connector_id))].filter((id) => DEEP_LINK[id]);
    const configs: Record<string, unknown> = {};
    if (connectorIds.length) {
      const { data: conns } = await admin.from("tenant_connectors").select("connector_id, config")
        .eq("tenant_id", tenantId).in("connector_id", connectorIds);
      for (const cn of (conns ?? []) as unknown as { connector_id: string; config: unknown }[]) configs[cn.connector_id] = cn.config;
    }

    const needName = info && !info.refBased ? [...new Set(rows.filter((l) => !usableKey(l.external_key)).map((l) => l.object_id))] : [];
    const names: Record<string, string> = {};
    if (info && needName.length) {
      const { data: recs } = await admin.from(objectType).select(info.cols).eq("tenant_id", tenantId).in("id", needName);
      for (const r of (recs ?? []) as unknown as Rec[]) names[String(r.id)] = info.pick(r);
    }

    const out: Record<string, ExternalRef[]> = {};
    const seen = new Set<string>();
    for (const l of rows) {
      const dedupe = `${l.object_id}|${l.connector_id}|${l.external_id}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      const key = usableKey(l.external_key);
      (out[l.object_id] ??= []).push({
        connectorId: l.connector_id,
        system: systemLabel(l.connector_id),
        objectLabel: l.entity === "standard_quotes:sales_order" ? "Sales order" : (info?.label ?? "Record"),
        readable: key ?? (info?.refBased ? entityWord(l.entity, info.label) : (names[l.object_id] || "Linked record")),
        deepLink: DEEP_LINK[l.connector_id]?.(configs[l.connector_id], objectType, l.external_id, l.entity) ?? null,
        direction: l.direction === "push" ? "push" : "pull",
        title: l.external_id,
      });
    }
    return out;
  } catch {
    return {};
  }
}

/** One record's external links. */
export async function externalRefsForOne(admin: SupabaseClient, tenantId: string, objectType: string, objectId: string): Promise<ExternalRef[]> {
  return (await externalRefsFor(admin, tenantId, objectType, [objectId]))[objectId] ?? [];
}

/** A business number worth showing: present and not a GUID. */
function usableKey(k: string | null | undefined): string | null {
  const v = str(k);
  return v && !GUID_RE.test(v) ? v : null;
}
