// Dynamics 365 connector -- shared, client-safe shapes (no server imports).
//
// One connector for the three Dynamics 365 products a customer actually
// runs, because they speak three different APIs:
//   fo         Finance & Operations / Supply Chain   OData at <env>/data/
//   dataverse  Sales, Customer Service, Field Service,
//              Project Operations (the CE family)     Web API at <env>/api/data/v9.2/
//   bc         Business Central                        API v2.0 (online or on-prem)
//
// Login types (owner request: "oauth or basic or certificate"):
//   client_secret   OAuth 2.0 client credentials with an app secret (Entra ID)
//   certificate     OAuth 2.0 client credentials with a certificate -- a signed
//                   client assertion; the private key never leaves our server
//   authorization_code  OAuth 2.0 with a person signing in (delegated); we keep
//                   the refresh token
//   basic           username + password / web service access key -- Business
//                   Central on-premises only (Microsoft retired basic auth for
//                   every Dynamics 365 online API)

export const D365_PRODUCTS = ["fo", "dataverse", "bc"] as const;
export type D365Product = (typeof D365_PRODUCTS)[number];

export const D365_PRODUCT_LABEL: Record<D365Product, string> = {
  fo: "Finance & Operations / Supply Chain",
  dataverse: "Sales / Customer Service / Field Service / Project Operations (Dataverse)",
  bc: "Business Central",
};

export const D365_AUTH_MODES = ["client_secret", "certificate", "authorization_code", "basic"] as const;
export type D365AuthMode = (typeof D365_AUTH_MODES)[number];

export const D365_AUTH_LABEL: Record<D365AuthMode, string> = {
  client_secret: "OAuth 2.0 — app registration + client secret",
  certificate: "OAuth 2.0 — app registration + certificate",
  authorization_code: "OAuth 2.0 — sign in as a user",
  basic: "Basic — username + password / web service key (Business Central on-premises)",
};

/** Which login types each product accepts. */
export const D365_AUTH_FOR_PRODUCT: Record<D365Product, D365AuthMode[]> = {
  fo: ["client_secret", "certificate", "authorization_code"],
  dataverse: ["client_secret", "certificate", "authorization_code"],
  bc: ["client_secret", "certificate", "authorization_code", "basic"],
};

/** The BPMSquare objects a pull can fill, and the one a push can send. */
export const D365_ENTITY_KEYS = ["customers", "contacts", "vendors", "products", "projects", "fence_projects"] as const;
export type D365EntityKey = (typeof D365_ENTITY_KEYS)[number];

export const D365_ENTITY_LABEL: Record<D365EntityKey, string> = {
  customers: "Customers → Accounts",
  contacts: "Contacts → Contacts",
  vendors: "Vendors → Suppliers",
  products: "Products / items → Products",
  projects: "Projects → Workforce projects",
  fence_projects: "Fence projects → Projects (push)",
};

export const D365_ENTITY_TARGET: Record<D365EntityKey, { table: string; direction: "pull" | "push"; feature: string }> = {
  customers: { table: "accounts", direction: "pull", feature: "accounts" },
  contacts: { table: "contacts", direction: "pull", feature: "contacts" },
  vendors: { table: "suppliers", direction: "pull", feature: "suppliers" },
  products: { table: "products", direction: "pull", feature: "products" },
  projects: { table: "wfm_projects", direction: "pull", feature: "wfm_projects" },
  fence_projects: { table: "fence_projects", direction: "push", feature: "fence_projects" },
};

/**
 * How one entity is read or written. `field_map` maps a BPMSquare field to
 * the external field holding it (pull), or an external field to a template
 * of BPMSquare values (push, e.g. "{name}"). Tenants override the defaults
 * in src/lib/connectors/d365/catalog.ts per environment, because a
 * customised Dynamics environment renames and extends entities.
 */
export type D365EntityConfig = {
  enabled: boolean;
  entity_set: string;
  id_field: string;
  key_field?: string;
  modified_field?: string;
  filter?: string;
  field_map: Record<string, string>;
  /** Automatic sync for this entity (middleware page). Absent = the
   *  connector-wide `schedule`. */
  schedule?: "off" | "hourly" | "daily";
};

/**
 * What the integration middleware sends when a Standard Quote is awarded or
 * rejected. Every part is optional: each product ships a preset in
 * catalog.ts (D365_OUTBOUND_PRESETS) and a quote goes out with no mapping at
 * all. A map here replaces the preset's map whole.
 */
export type D365OutboundConfig = {
  /** Dataverse quote header: external field -> template over the quote. */
  quote?: { field_map?: Record<string, string> };
  /** Dataverse write-in line: external field -> template over the line. */
  quote_line?: { field_map?: Record<string, string> };
  /** Finance & Operations / Business Central project. */
  project?: {
    entity_set?: string; id_field?: string; field_map?: Record<string, string>;
    /** Where an estimate's WBS tasks and bill of materials go, once the project exists.
     *  `link_field` is the field on each row that receives the project's id. */
    tasks?: { entity_set: string; link_field?: string };
    bom?: { entity_set: string; link_field?: string };
  };
};

/**
 * What a Sales Order becomes. Kept beside `outbound` rather than in it so the older screens that edit
 * `outbound` as a whole never touch it. Dataverse: header map (same placeholders as a quote) and a
 * write-in line map. Finance & Operations / Business Central: the entity set, id field and map of a
 * sales order (preset-only and not verified live: it stays unavailable until the entity set is set
 * under Mapping).
 */
export type D365OrderConfig = {
  sales_order?: { entity_set?: string; id_field?: string; field_map?: Record<string, string> };
  sales_order_line?: { field_map?: Record<string, string> };
};

export type D365Config = {
  product: D365Product;
  auth_mode: D365AuthMode;
  /** https://contoso.operations.dynamics.com | https://contoso.crm4.dynamics.com |
   *  BC online: environment name (e.g. "Production") | BC on-prem: API base URL */
  environment_url: string;
  /** Entra ID directory (tenant) id or domain -- every OAuth mode. */
  directory_id?: string;
  client_id?: string;
  /** F&O legal entity (dataAreaId) or BC company id. */
  company?: string;
  username?: string;
  schedule: "off" | "hourly" | "daily";
  entities: Partial<Record<D365EntityKey, D365EntityConfig>>;
  /** Day the client secret expires (YYYY-MM-DD); the middleware page warns 30 days before. */
  secret_expires_on?: string;
  /** Dataverse only: the price list and currency a quote must carry (chosen from the pick-lists, never typed). */
  price_list_id?: string;
  currency_id?: string;
  outbound?: D365OutboundConfig;
  orders?: D365OrderConfig;
};

export type D365PublicState = {
  config: D365Config | null;
  /** Which secrets are stored -- never their values. */
  secrets: { client_secret: boolean; certificate: boolean; private_key: boolean; password: boolean; refresh_token: boolean };
  status: "connected" | "error" | "not_connected";
  last_error: string | null;
};

export const DATE_FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
