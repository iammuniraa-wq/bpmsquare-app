import type { ScopeKind } from "@/lib/connectors/d365/types";
import {
  SAP_ENTITY_KEYS, SAP_SANDBOX_HOST, SAP_SANDBOX_PREFIX, SAP_SCENARIO,
  type SapConfig, type SapEntityConfig, type SapEntityKey, type SapSchedule,
} from "./types";

// What ships with the connector, so a pull works with zero configuration. Everything here is the standard SAP
// API (API_BUSINESS_PARTNER, API_PRODUCT_SRV), version 2602 and older. A tenant changes only the switch, the
// schedule, the field map and the scope of an entity (types.ts); the service, entity set and key fields are fixed.

export type SapPreset = {
  service: "API_BUSINESS_PARTNER" | "API_PRODUCT_SRV";
  entity_set: string;
  /** The immutable key: what a link is stored under. */
  id_field: string;
  /** The readable number people know (the business partner number, the product number). */
  key_field: string;
  /** A date the system keeps up to date: the incremental pull asks for rows changed since. */
  modified_field: string;
  /** Always applied: customers are business partners that have a customer number, and so on. */
  filter: string;
  /** Navigation properties the field map's dotted names (address.*, description.*) are read from. */
  expand: readonly string[];
  /** The dotted prefix the expansion fills. */
  prefix: "address" | "description";
  scenario: keyof typeof SAP_SCENARIO;
  /** BPMSquare field -> the SAP field it is read from. */
  field_map: Record<string, string>;
  /** The BPMSquare fields a map may fill, in the order the Mapping tab shows them. */
  fields: readonly string[];
  enabled: boolean;
};

const BP_EXPAND = ["to_BusinessPartnerAddress/to_EmailAddress", "to_BusinessPartnerAddress/to_PhoneNumber"] as const;

export const SAP_PRESETS: Record<SapEntityKey, SapPreset> = {
  customers: {
    service: "API_BUSINESS_PARTNER", entity_set: "A_BusinessPartner", id_field: "BusinessPartner", key_field: "BusinessPartner", modified_field: "LastChangeDate",
    filter: "Customer ne ''", expand: BP_EXPAND, prefix: "address", scenario: "businessPartner", enabled: true,
    fields: ["name", "address_line1", "city", "postal_code", "country", "phone", "email"],
    field_map: {
      name: "BusinessPartnerFullName", address_line1: "address.StreetName", city: "address.CityName", postal_code: "address.PostalCode",
      country: "address.Country", phone: "address.PhoneNumber", email: "address.EmailAddress",
    },
  },
  vendors: {
    service: "API_BUSINESS_PARTNER", entity_set: "A_BusinessPartner", id_field: "BusinessPartner", key_field: "BusinessPartner", modified_field: "LastChangeDate",
    filter: "Supplier ne ''", expand: BP_EXPAND, prefix: "address", scenario: "businessPartner", enabled: true,
    fields: ["name", "city", "phone", "email"],
    field_map: { name: "BusinessPartnerFullName", city: "address.CityName", phone: "address.PhoneNumber", email: "address.EmailAddress" },
  },
  products: {
    service: "API_PRODUCT_SRV", entity_set: "A_Product", id_field: "Product", key_field: "Product", modified_field: "LastChangeDate",
    filter: "IsMarkedForDeletion eq false", expand: ["to_Description"], prefix: "description", scenario: "product", enabled: true,
    fields: ["name", "sku", "uom", "description"],
    field_map: { name: "description.ProductDescription", sku: "Product", uom: "BaseUnit" },
  },
};

/** The entity set whose $metadata lists the fields a dotted prefix draws from. */
export const SAP_PREFIX_SETS: Record<SapPreset["prefix"], { service: SapPreset["service"]; sets: { set: string; only?: readonly string[] }[] }> = {
  address: { service: "API_BUSINESS_PARTNER", sets: [{ set: "A_BusinessPartnerAddress" }] },
  description: { service: "API_PRODUCT_SRV", sets: [{ set: "A_ProductDescription", only: ["ProductDescription", "Language"] }] },
};

/** Fields the flattened row adds beyond the address entity's own: the default e-mail and phone. */
export const SAP_ADDRESS_EXTRAS = [
  { name: "address.EmailAddress", label: "Email address (default)", type: "String" },
  { name: "address.PhoneNumber", label: "Phone number (default)", type: "String" },
] as const;

/** The fields of the field map that must be plain names of the system, optionally dotted into a flattened part. */
export const SAP_FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;

/** The base URL the services hang from. The sandbox serves the same paths under /s4hanacloud. */
export function sapOrigin(cfg: Pick<SapConfig, "api_host" | "auth_mode">): string {
  return `https://${cfg.auth_mode === "api_key" ? SAP_SANDBOX_HOST : cfg.api_host}`;
}

export function sapServiceBase(cfg: Pick<SapConfig, "api_host" | "auth_mode">, service: SapPreset["service"]): string {
  return `${sapOrigin(cfg)}${cfg.auth_mode === "api_key" ? SAP_SANDBOX_PREFIX : ""}/sap/opu/odata/sap/${service}`;
}

export const isSandbox = (cfg: Pick<SapConfig, "auth_mode">): boolean => cfg.auth_mode === "api_key";

/** The entity config in force: the tenant's switch, schedule, map and scope over the preset. A map is replaced whole. */
export function entityConfig(cfg: Pick<SapConfig, "entities">, key: SapEntityKey): SapEntityConfig & { entity_set: string } {
  const p = SAP_PRESETS[key];
  const own = cfg.entities?.[key];
  return {
    enabled: own?.enabled ?? p.enabled,
    field_map: own?.field_map && Object.keys(own.field_map).length ? own.field_map : { ...p.field_map },
    ...(own?.schedule ? { schedule: own.schedule } : {}),
    ...(own?.scope ? { scope: own.scope } : {}),
    entity_set: p.entity_set,
  };
}

export function effectiveEntities(cfg: Pick<SapConfig, "entities">): Record<SapEntityKey, SapEntityConfig & { entity_set: string }> {
  return Object.fromEntries(SAP_ENTITY_KEYS.map((k) => [k, entityConfig(cfg, k)])) as Record<SapEntityKey, SapEntityConfig & { entity_set: string }>;
}

export const scheduleOf = (cfg: Pick<SapConfig, "entities" | "schedule">, key: SapEntityKey): SapSchedule => cfg.entities?.[key]?.schedule ?? cfg.schedule ?? "off";

// ── Scope: the attributes offered first ─────────────────────────────────────
// A scope narrows the main entity set only (the business partner, the product). Sales area, country and other
// attributes that live on an associated entity are not offered; the screen says so.

export type SapScopeCommon = { name: string; label: string; kind: ScopeKind; options?: { value: string; label: string }[] };

const BP_COMMON: SapScopeCommon[] = [
  { name: "BusinessPartnerCategory", label: "Category", kind: "option", options: [{ value: "1", label: "Person" }, { value: "2", label: "Organization" }, { value: "3", label: "Group" }] },
  { name: "BusinessPartnerGrouping", label: "Grouping", kind: "text" },
  { name: "Industry", label: "Industry", kind: "text" },
  { name: "CorrespondenceLanguage", label: "Language", kind: "text" },
  { name: "BusinessPartnerType", label: "Type", kind: "text" },
];

export const SAP_SCOPE_COMMON: Record<SapEntityKey, SapScopeCommon[]> = {
  customers: BP_COMMON,
  vendors: BP_COMMON,
  products: [
    { name: "ProductType", label: "Product type", kind: "text" },
    { name: "ProductGroup", label: "Product group", kind: "text" },
    { name: "BaseUnit", label: "Base unit", kind: "text" },
    { name: "Division", label: "Division", kind: "text" },
  ],
};
