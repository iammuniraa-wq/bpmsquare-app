import "server-only";
import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase-server";
import { CONNECTOR_ID, loadD365 } from "@/lib/connectors/d365/server";
import { entityConfig } from "@/lib/connectors/d365/catalog";
import {
  cleanScope, conditionId, hasScope, scopeAttributes, scopeSignature, scopeSummary, supportsViaCustomer, type ScopeAttribute,
} from "@/lib/connectors/d365/scope";
import { D365_ENTITY_KEYS, D365_ENTITY_LABEL, type D365Config, type D365EntityKey, type EntityScope, type ScopeCondition } from "@/lib/connectors/d365/types";
import { middlewareClient } from "./client";
import { dataverseLogicalName, entitySetFor, getErpMetadata } from "./metadataServer";
import { parseDataverseOptions, parseLookupTargets, parseODataEnum, type ErpField, type MetadataEntity, type PickValue } from "./metadata";

// The saved Scope of each pulled entity (Resync tab): which records every run reads. Admin-only (the route
// enforces it); the tenant comes from the session and every query names it. Attribute names are accepted only
// when the connected system lists them (or, while its field list cannot be read, when the product's presets do),
// and the kind and option list of a condition always come from here, never from the request.

export const SCOPE_ENTITIES = D365_ENTITY_KEYS.filter((k): k is Exclude<D365EntityKey, "fence_projects"> => k !== "fence_projects");
export type ScopeEntity = (typeof SCOPE_ENTITIES)[number];
export const isScopeEntity = (v: unknown): v is ScopeEntity => typeof v === "string" && (SCOPE_ENTITIES as readonly string[]).includes(v);

export const VALUES_CAP = 50;
const q = (s: string) => s.replace(/'/g, "''");

export type ScopeView = {
  entity: ScopeEntity;
  label: string;
  conditions: ScopeCondition[];
  summary: string;
  needs_full: boolean;
  attributes: ScopeAttribute[];
  /** "system": the list comes from the connected system. "presets": it could not be read, only the common attributes are offered. */
  source: "system" | "presets";
};
type Fail = { error: string; status: number };

const PLURAL: Record<ScopeEntity, string> = { customers: "customers", contacts: "contacts", vendors: "vendors", products: "products", projects: "projects" };

async function fieldsOf(tenantId: string, entity: MetadataEntity): Promise<ErpField[] | null> {
  const r = await getErpMetadata(tenantId, entity);
  return r.ok && r.applicable ? r.fields : null;
}

async function attributeList(tenantId: string, cfg: D365Config, entity: ScopeEntity): Promise<{ attributes: ScopeAttribute[]; fields: ErpField[] | null; customerFields: ErpField[] | null }> {
  const [fields, customerFields] = await Promise.all([
    fieldsOf(tenantId, entity),
    supportsViaCustomer(cfg.product, entity) ? fieldsOf(tenantId, "customers") : Promise.resolve(null),
  ]);
  return { attributes: scopeAttributes(cfg.product, entity, fields, customerFields), fields, customerFields };
}

const viewOf = (entity: ScopeEntity, scope: EntityScope | undefined, attributes: ScopeAttribute[], fields: ErpField[] | null): ScopeView => ({
  entity, label: D365_ENTITY_LABEL[entity], conditions: scope?.conditions ?? [], summary: scopeSummary(scope, PLURAL[entity]),
  needs_full: scope?.needs_full === true && hasScope(scope), attributes, source: fields ? "system" : "presets",
});

export async function getScope(admin: SupabaseClient, tenantId: string, entity: ScopeEntity): Promise<ScopeView | Fail> {
  const loaded = await loadD365(admin, tenantId);
  if (!loaded) return { error: "Connect your ERP first.", status: 400 };
  const ec = entityConfig(loaded.cfg, entity);
  if (!ec) return { error: "That entity is not available for this product.", status: 422 };
  const { attributes, fields } = await attributeList(tenantId, loaded.cfg, entity);
  return viewOf(entity, ec.scope, attributes, fields);
}

/** Save (or clear, with no conditions) the scope of one entity. */
export async function saveScope(admin: SupabaseClient, tenantId: string, entity: ScopeEntity, body: unknown): Promise<ScopeView | Fail> {
  const loaded = await loadD365(admin, tenantId);
  if (!loaded) return { error: "Connect your ERP first.", status: 400 };
  const { cfg } = loaded;
  const ec = entityConfig(cfg, entity);
  if (!ec) return { error: "That entity is not available for this product.", status: 422 };

  const first = cleanScope((body as { conditions?: unknown } | null)?.conditions ?? [], cfg.product, entity);
  if (!first.ok) return { error: first.error, status: 422 };
  const { attributes, fields } = await attributeList(tenantId, cfg, entity);
  const byId = new Map(attributes.map((a) => [a.id, a]));
  const given = (first.scope.conditions);
  const bound: ScopeCondition[] = [];
  for (const c of given) {
    const a = byId.get(conditionId(c));
    if (!a) return { error: `"${c.attribute_label || c.attribute}" is not an attribute of ${entity} in this system.`, status: 422 };
    // The system decides what an attribute is; the request only says which one and which values.
    bound.push({ ...c, kind: a.kind, attribute_label: a.label, ...(a.enum_type ? { enum_type: a.enum_type } : {}), ...(a.via ? { via: a.via } : {}) });
  }
  const checked = cleanScope(bound, cfg.product, entity);
  if (!checked.ok) return { error: checked.error, status: 422 };

  const prev = ec.scope;
  const changed = scopeSignature(prev) !== scopeSignature(checked.scope);
  // The incremental position covers the OLD scope. Narrowing from "all" is safe (everything it read is a superset),
  // anything else may leave records the new scope wants unread until a Full resync.
  const needsFull = prev?.needs_full === true || (hasScope(prev) && changed);
  const scope: EntityScope | undefined = checked.scope.conditions.length || needsFull
    ? { conditions: checked.scope.conditions, ...(needsFull ? { needs_full: true } : {}) }
    : undefined;

  const own = { ...ec };
  delete own.scope;
  const entities = { ...cfg.entities, [entity]: { ...own, ...(scope ? { scope } : {}) } };
  const { error } = await admin.from("tenant_connectors").update({ config: { ...cfg, entities } as unknown as Record<string, string>, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID);
  if (error) return { error: error.message, status: 500 };
  return viewOf(entity, scope, attributes, fields);
}

// ── Values of one attribute ─────────────────────────────────────────────────

export type ScopeValues = { kind: ScopeAttribute["kind"]; /** true: the person types the values (text, number). */ typed: boolean; values: PickValue[]; more: boolean };

async function enumMembers(tenantId: string, cfg: D365Config, enumType: string): Promise<PickValue[]> {
  const run = unstable_cache(async () => {
    const admin = createAdminSupabase();
    const loaded = await loadD365(admin, tenantId);
    if (!loaded) return [];
    const client = await middlewareClient(admin, tenantId, cfg.product === "bc" ? { ...loaded.cfg, company: undefined } : loaded.cfg, loaded.creds);
    const res = await client.requestRaw("GET", "$metadata", { headers: { Accept: "application/xml" } });
    return parseODataEnum(res.text, enumType);
  }, ["mw-scope-enum", tenantId, cfg.product, cfg.environment_url, enumType], { revalidate: 300 });
  return run();
}

const DEFAULT_TARGETS: Record<string, string[]> = { Owner: ["systemuser", "team"], Customer: ["account", "contact"] };

/** The records a Dataverse lookup can point at, by name, capped. */
async function lookupRecords(client: Awaited<ReturnType<typeof middlewareClient>>, logical: string, attr: string, type: string, search: string): Promise<{ values: PickValue[]; more: boolean }> {
  let targets: string[] = [];
  try {
    targets = parseLookupTargets(await client.get(`EntityDefinitions(LogicalName='${q(logical)}')/Attributes(LogicalName='${q(attr)}')/Microsoft.Dynamics.CRM.LookupAttributeMetadata`, { $select: "Targets" }));
  } catch {
    targets = [];
  }
  if (!targets.length) targets = DEFAULT_TARGETS[type] ?? [];
  targets = targets.slice(0, 2);
  const per = Math.floor(VALUES_CAP / Math.max(1, targets.length));
  const out: PickValue[] = [];
  let more = false;
  for (const t of targets) {
    const def = (await client.get(`EntityDefinitions(LogicalName='${q(t)}')`, { $select: "EntitySetName,PrimaryIdAttribute,PrimaryNameAttribute,DisplayName" })) as {
      EntitySetName?: string; PrimaryIdAttribute?: string; PrimaryNameAttribute?: string; DisplayName?: { UserLocalizedLabel?: { Label?: string } | null } | null;
    };
    const id = def.PrimaryIdAttribute, name = def.PrimaryNameAttribute, set = def.EntitySetName;
    if (!id || !name || !set || ![id, name, set].every((x) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(x))) continue;
    const page = (await client.get(set, {
      $select: `${id},${name}`, $top: String(per), $orderby: `${name} asc`,
      ...(search ? { $filter: `contains(${name},'${q(search)}')` } : {}),
    })) as { value?: Record<string, unknown>[] };
    const rows = page.value ?? [];
    if (rows.length >= per) more = true;
    const kindWord = targets.length > 1 ? ` (${def.DisplayName?.UserLocalizedLabel?.Label ?? t})` : "";
    for (const r of rows) {
      const v = r[id];
      if (typeof v === "string") out.push({ value: v, label: `${String(r[name] ?? v)}${kindWord}` });
    }
  }
  return { values: out, more };
}

export async function getScopeValues(admin: SupabaseClient, tenantId: string, entity: ScopeEntity, attributeId: string, search: string): Promise<ScopeValues | Fail> {
  const loaded = await loadD365(admin, tenantId);
  if (!loaded) return { error: "Connect your ERP first.", status: 400 };
  const { cfg, creds } = loaded;
  const { attributes, fields, customerFields } = await attributeList(tenantId, cfg, entity);
  const a = attributes.find((x) => x.id === attributeId);
  if (!a) return { error: "That attribute is not available.", status: 422 };
  if (a.kind === "text" || a.kind === "number") return { kind: a.kind, typed: true, values: [], more: false };
  if (a.kind === "boolean") return { kind: a.kind, typed: false, values: [{ value: "true", label: "Yes" }, { value: "false", label: "No" }], more: false };

  try {
    if (cfg.product === "dataverse") {
      const client = await middlewareClient(admin, tenantId, cfg, creds);
      const owner: MetadataEntity = a.via ? "customers" : entity;
      const set = entitySetFor(cfg, owner);
      if (!set) return { error: "That entity is not available for this product.", status: 422 };
      const logical = await dataverseLogicalName(client, owner, set);
      const field = (a.via ? customerFields : fields)?.find((f) => f.name === a.name);
      if (a.kind === "lookup") return { kind: a.kind, typed: false, ...(await lookupRecords(client, logical, a.name, field?.type ?? "Lookup", search.trim().slice(0, 80))) };
      const type = field?.type ?? "Picklist";
      const cast = type === "State" ? "StateAttributeMetadata" : type === "Status" ? "StatusAttributeMetadata" : "PicklistAttributeMetadata";
      const json = await client.get(`EntityDefinitions(LogicalName='${q(logical)}')/Attributes(LogicalName='${q(a.name)}')/Microsoft.Dynamics.CRM.${cast}`, { $select: "LogicalName", $expand: "OptionSet($select=Options)" });
      const values = parseDataverseOptions(json);
      const needle = search.trim().toLowerCase();
      return { kind: a.kind, typed: false, values: (needle ? values.filter((v) => v.label.toLowerCase().includes(needle)) : values).slice(0, VALUES_CAP), more: values.length > VALUES_CAP };
    }
    if (a.kind === "option" && a.enum_type) {
      const values = await enumMembers(tenantId, cfg, a.enum_type);
      const needle = search.trim().toLowerCase();
      return { kind: a.kind, typed: false, values: (needle ? values.filter((v) => v.label.toLowerCase().includes(needle)) : values).slice(0, VALUES_CAP), more: values.length > VALUES_CAP };
    }
  } catch (e) {
    return { error: (e as Error).message || "The system did not return its values.", status: 502 };
  }
  return { kind: a.kind, typed: false, values: [], more: false };
}
