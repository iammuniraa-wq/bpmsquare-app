import type { D365Config, D365EntityConfig, D365EntityKey, D365Product } from "./types";

// Default entity + field maps per Dynamics 365 product. These are the
// out-of-the-box Microsoft entities; a customised environment differs, which
// is why every one of these is only a starting point a tenant admin can
// override on the connector screen (and check with "Preview" against their
// own environment before the first sync).
//
// Pull maps: BPMSquare field -> external field. Two special keys:
//   account_external_id  the external id of the record's customer, used to
//                        link a contact/project to an account already synced
//   (id/key/modified fields are declared separately on the entity)
//
// Push maps (fence_projects): external field -> template over the fence
// project's values: {name} {ref} {summary} {total_length_m} {status}
// {account_external_id}. A field whose template resolves to empty is left
// out, so an @odata.bind to a customer that was never synced is simply not
// sent rather than sent broken.

type Defaults = Partial<Record<D365EntityKey, D365EntityConfig>>;

const FO: Defaults = {
  customers: {
    enabled: true, entity_set: "CustomersV3", id_field: "CustomerAccount", key_field: "CustomerAccount",
    field_map: { name: "OrganizationName", city: "AddressCity", phone: "PrimaryContactPhone", email: "PrimaryContactEmail" },
  },
  vendors: {
    enabled: true, entity_set: "VendorsV2", id_field: "VendorAccountNumber", key_field: "VendorAccountNumber",
    field_map: { name: "VendorOrganizationName", city: "AddressCity", phone: "PrimaryPhoneNumber", email: "PrimaryEmailAddress" },
  },
  products: {
    enabled: true, entity_set: "ReleasedProductsV2", id_field: "ItemNumber", key_field: "ItemNumber",
    field_map: { name: "SearchName", sku: "ItemNumber", uom: "SalesUnitSymbol", list_price: "SalesPrice" },
  },
  projects: {
    enabled: false, entity_set: "Projects", id_field: "ProjectID", key_field: "ProjectID",
    field_map: { name: "ProjectName", code: "ProjectID", account_external_id: "CustomerAccount" },
  },
  contacts: {
    enabled: false, entity_set: "ContactPersonsV2", id_field: "ContactPersonId", key_field: "ContactPersonId",
    field_map: { name: "ContactPersonName", email: "PrimaryEmailAddress", phone: "PrimaryPhoneNumber", account_external_id: "AssociatedPartyNumber" },
  },
  // F&O project creation needs a project contract, group and type that are
  // specific to each implementation -- off until the admin maps them.
  fence_projects: {
    enabled: false, entity_set: "Projects", id_field: "ProjectID",
    field_map: { ProjectName: "{name}", CustomerAccount: "{account_external_id}" },
  },
};

const DATAVERSE: Defaults = {
  customers: {
    enabled: true, entity_set: "accounts", id_field: "accountid", key_field: "accountnumber", modified_field: "modifiedon",
    field_map: { name: "name", city: "address1_city", phone: "telephone1", email: "emailaddress1" },
  },
  contacts: {
    enabled: true, entity_set: "contacts", id_field: "contactid", modified_field: "modifiedon",
    field_map: { name: "fullname", email: "emailaddress1", phone: "telephone1", account_external_id: "_parentcustomerid_value" },
  },
  // Dataverse has no vendor table out of the box: vendors are accounts
  // typed Vendor (11) or Supplier (10).
  vendors: {
    enabled: false, entity_set: "accounts", id_field: "accountid", key_field: "accountnumber", modified_field: "modifiedon",
    filter: "customertypecode eq 10 or customertypecode eq 11",
    field_map: { name: "name", city: "address1_city", phone: "telephone1", email: "emailaddress1" },
  },
  products: {
    enabled: true, entity_set: "products", id_field: "productid", key_field: "productnumber", modified_field: "modifiedon",
    field_map: { name: "name", sku: "productnumber", list_price: "price" },
  },
  projects: {
    enabled: false, entity_set: "msdyn_projects", id_field: "msdyn_projectid", modified_field: "modifiedon",
    field_map: { name: "msdyn_subject", account_external_id: "_msdyn_customer_value" },
  },
  fence_projects: {
    enabled: false, entity_set: "msdyn_projects", id_field: "msdyn_projectid",
    field_map: {
      msdyn_subject: "{name}",
      msdyn_description: "{ref} · {summary}",
      "msdyn_customer_account@odata.bind": "/accounts({account_external_id})",
    },
  },
};

const BC: Defaults = {
  customers: {
    enabled: true, entity_set: "customers", id_field: "id", key_field: "number", modified_field: "lastModifiedDateTime",
    field_map: { name: "displayName", city: "city", phone: "phoneNumber", email: "email" },
  },
  vendors: {
    enabled: true, entity_set: "vendors", id_field: "id", key_field: "number", modified_field: "lastModifiedDateTime",
    field_map: { name: "displayName", city: "city", phone: "phoneNumber", email: "email" },
  },
  products: {
    enabled: true, entity_set: "items", id_field: "id", key_field: "number", modified_field: "lastModifiedDateTime",
    field_map: { name: "displayName", sku: "number", uom: "baseUnitOfMeasureCode", list_price: "unitPrice" },
  },
  projects: {
    enabled: false, entity_set: "projects", id_field: "id", key_field: "number", modified_field: "lastModifiedDateTime",
    field_map: { name: "displayName", code: "number" },
  },
  contacts: {
    enabled: false, entity_set: "contacts", id_field: "id", key_field: "number", modified_field: "lastModifiedDateTime",
    field_map: { name: "displayName", email: "email", phone: "phoneNumber" },
  },
  fence_projects: {
    enabled: false, entity_set: "projects", id_field: "id",
    field_map: { displayName: "{name}" },
  },
};

export const D365_DEFAULTS: Record<D365Product, Defaults> = { fo: FO, dataverse: DATAVERSE, bc: BC };

/** The entity config in force: the tenant's override where set, else the
 *  product default. Field maps are replaced whole, never merged key by key
 *  -- a removed mapping must stay removed. */
export function entityConfig(cfg: Pick<D365Config, "product" | "entities">, key: D365EntityKey): D365EntityConfig | null {
  const own = cfg.entities?.[key];
  const def = D365_DEFAULTS[cfg.product]?.[key];
  if (!own && !def) return null;
  return { ...(def ?? { enabled: false, entity_set: "", id_field: "id", field_map: {} }), ...(own ?? {}) } as D365EntityConfig;
}

/** The OAuth resource ("audience") a token must be issued for. */
export function resourceFor(cfg: Pick<D365Config, "product" | "environment_url">): string {
  if (cfg.product === "bc") return "https://api.businesscentral.dynamics.com";
  return new URL(cfg.environment_url).origin;
}

/** The base URL every entity path is appended to. */
export function apiBase(cfg: Pick<D365Config, "product" | "environment_url" | "directory_id" | "company" | "auth_mode">): string {
  const env = cfg.environment_url.trim().replace(/\/+$/, "");
  if (cfg.product === "fo") return `${new URL(env).origin}/data`;
  if (cfg.product === "dataverse") return `${new URL(env).origin}/api/data/v9.2`;
  // Business Central: online is addressed by directory + environment name,
  // on-premises by its own API base URL (basic auth only applies there).
  const company = cfg.company ? `/companies(${cfg.company})` : "";
  if (/^https:\/\//i.test(env)) return `${env}${company}`;
  return `https://api.businesscentral.dynamics.com/v2.0/${encodeURIComponent(cfg.directory_id ?? "")}/${encodeURIComponent(env)}/api/v2.0${company}`;
}

/** Hosts an ONLINE environment may live on. A tenant-typed URL is fetched by
 *  our server, so an online product is held to Microsoft's own domains; only
 *  BC on-premises (basic auth) may point at the customer's own host, and that
 *  still passes the private-network guard. */
export function allowedHost(cfg: Pick<D365Config, "product" | "auth_mode">, host: string): boolean {
  const h = host.toLowerCase();
  if (cfg.product === "bc" && cfg.auth_mode === "basic") return true;
  if (cfg.product === "bc") return h === "api.businesscentral.dynamics.com";
  // Commercial cloud only: tokens come from login.microsoftonline.com, which
  // can't issue for a sovereign-cloud resource (see sovereignHost).
  return h.endsWith(".dynamics.com");
}

/** A US Government / China (21Vianet) Dynamics host. Those clouds sign in at
 *  their own authority (login.microsoftonline.us / login.chinacloudapi.cn),
 *  which this connector doesn't support yet -- say so instead of failing
 *  with an opaque sign-in error. */
export function sovereignHost(host: string): boolean {
  const h = host.toLowerCase();
  return h.endsWith(".dynamics.cn") || h.endsWith(".microsoftdynamics.us") || h.endsWith(".dynamics365.us") || h.endsWith(".appsplatform.us") || h.endsWith(".microsoftdynamics.de");
}

// ── Integration middleware presets ──────────────────────────────────────────
// What an awarded or rejected Standard Quote becomes in each product, so a
// quote goes out with no mapping done (docs/design/integration-middleware.md,
// "Works with zero mapping"). A tenant's own map in config.outbound replaces
// the matching preset whole.
//
// Dataverse: a Quote. The header map is external field -> template; the
// customer, price list and currency binds are ALWAYS added by the builder (a
// Dataverse quote is refused without them), so a custom map cannot lose them.
// Lines are write-in lines (no catalogue product): productdescription +
// isproductoverridden + quantity + priceperunit, and NEVER a uomid (Dataverse
// refuses a write-in line that carries one -- verified live 2026-10-21).
//
// F&O and Business Central: a Project, created through the same entity and
// map the older fence-project push uses.

export type OutboundPreset = {
  quote: { field_map: Record<string, string> };
  quote_line: { field_map: Record<string, string> };
  project: { entity_set: string; id_field: string; field_map: Record<string, string> };
};

export const D365_OUTBOUND_PRESETS: Record<D365Product, OutboundPreset> = {
  dataverse: {
    quote: { field_map: { name: "{name}", description: "{description}" } },
    quote_line: { field_map: { productdescription: "{description}", quantity: "{qty}", priceperunit: "{net_rate}", isproductoverridden: "true" } },
    project: { entity_set: "", id_field: "", field_map: {} },
  },
  fo: {
    quote: { field_map: {} },
    quote_line: { field_map: {} },
    project: { entity_set: "Projects", id_field: "ProjectID", field_map: { ProjectName: "{name}", CustomerAccount: "{account_external_id}" } },
  },
  bc: {
    quote: { field_map: {} },
    quote_line: { field_map: {} },
    project: { entity_set: "projects", id_field: "id", field_map: { displayName: "{name}" } },
  },
};

/** The outbound maps in force: the tenant's own where set, else the preset. */
export function outboundConfig(cfg: Pick<D365Config, "product" | "outbound">): OutboundPreset & { custom: { quote: boolean; quote_line: boolean; project: boolean } } {
  const preset = D365_OUTBOUND_PRESETS[cfg.product];
  const own = cfg.outbound ?? {};
  const q = own.quote?.field_map;
  const l = own.quote_line?.field_map;
  const p = own.project;
  const hasQ = !!q && Object.keys(q).length > 0;
  const hasL = !!l && Object.keys(l).length > 0;
  const hasP = !!p && (Object.keys(p.field_map ?? {}).length > 0 || !!p.entity_set);
  return {
    quote: { field_map: hasQ ? q! : preset.quote.field_map },
    quote_line: { field_map: hasL ? l! : preset.quote_line.field_map },
    project: {
      entity_set: p?.entity_set || preset.project.entity_set,
      id_field: p?.id_field || preset.project.id_field,
      field_map: p?.field_map && Object.keys(p.field_map).length > 0 ? p.field_map : preset.project.field_map,
    },
    custom: { quote: hasQ, quote_line: hasL, project: hasP },
  };
}
