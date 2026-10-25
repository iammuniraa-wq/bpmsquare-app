// SAP S/4HANA connector -- shared, client-safe shapes (no server imports).
//
// One flavour first: S/4HANA Cloud public edition (and any S/4HANA with the same OData V2 APIs). Two ways in:
// the Communication User of a Communication Arrangement over HTTP Basic, or an API key against the SAP Business
// Accelerator Hub sandbox (read-only sample data, for trying the connector before a real system is ready).
// Pull only: customers, suppliers and products. Sending an awarded quote is a later step and is not here.

import type { EntityScope } from "@/lib/connectors/d365/types";

export const SAP_CONNECTOR_ID = "sap_s4";
export const SAP_NAME = "SAP S/4HANA";

/** Master data read by field map (business partners and products). */
export const SAP_BP_KEYS = ["customers", "vendors", "products"] as const;
export type SapBpKey = (typeof SAP_BP_KEYS)[number];
/** Everything the middleware lists for SAP. Sales orders are read whole (orders.ts), never through a field map. */
export const SAP_ENTITY_KEYS = [...SAP_BP_KEYS, "sales_orders"] as const;
export type SapEntityKey = (typeof SAP_ENTITY_KEYS)[number];
export const isSapEntity = (v: unknown): v is SapEntityKey => typeof v === "string" && (SAP_ENTITY_KEYS as readonly string[]).includes(v);
/** The entities that have a field map, a scope and a field list. */
export const isSapBpEntity = (v: unknown): v is SapBpKey => typeof v === "string" && (SAP_BP_KEYS as readonly string[]).includes(v);

export const SAP_ENTITY_LABEL: Record<SapEntityKey, string> = {
  customers: "Customers → Accounts",
  vendors: "Suppliers → Suppliers",
  products: "Products → Products",
  sales_orders: "Sales orders → Sales orders",
};

/** The word on the Resync and Mapping tabs. */
export const SAP_ENTITY_WORD: Record<SapEntityKey, string> = { customers: "Customers", vendors: "Suppliers", products: "Products", sales_orders: "Sales orders" };

/** The BPMSquare table a pull fills, and the module (feature flag) that owns it. */
export const SAP_ENTITY_TARGET: Record<SapEntityKey, { table: "accounts" | "suppliers" | "products" | "sales_orders"; feature: "accounts" | "suppliers" | "products" | "sales_orders" }> = {
  customers: { table: "accounts", feature: "accounts" },
  vendors: { table: "suppliers", feature: "suppliers" },
  products: { table: "products", feature: "products" },
  sales_orders: { table: "sales_orders", feature: "sales_orders" },
};

/** The Communication Scenarios the pulls need. Named in every message that tells an admin what to add. `id` is empty for the order
 *  services: the message then names the service itself, so no scenario number is claimed that this product has not verified. */
export const SAP_SCENARIO = {
  businessPartner: { id: "SAP_COM_0008", name: "Business Partner, Customer and Supplier Integration" },
  product: { id: "SAP_COM_0009", name: "Product Integration" },
  salesOrder: { id: "", name: "API_SALES_ORDER_SRV" },
  outboundDelivery: { id: "", name: "API_OUTBOUND_DELIVERY_SRV" },
  billingDocument: { id: "", name: "API_BILLING_DOCUMENT_SRV" },
  salesOrderSimulation: { id: "", name: "API_SALES_ORDER_SIMULATION_SRV" },
} as const;

/** The order-side services, by the step that needs them. */
export const SAP_ORDER_SERVICES = {
  orders: "API_SALES_ORDER_SRV",
  deliveries: "API_OUTBOUND_DELIVERY_SRV",
  billing: "API_BILLING_DOCUMENT_SRV",
  simulation: "API_SALES_ORDER_SIMULATION_SRV",
} as const;
export type SapOrderService = (typeof SAP_ORDER_SERVICES)[keyof typeof SAP_ORDER_SERVICES];

export const SAP_AUTH_MODES = ["basic", "api_key"] as const;
export type SapAuthMode = (typeof SAP_AUTH_MODES)[number];
export const SAP_AUTH_LABEL: Record<SapAuthMode, string> = { basic: "Communication user", api_key: "API key (SAP Business Accelerator Hub sandbox)" };

/** The one host the API key login may use, and the prefix its service paths carry. */
export const SAP_SANDBOX_HOST = "sandbox.api.sap.com";
export const SAP_SANDBOX_PREFIX = "/s4hanacloud";

export type SapSchedule = "off" | "hourly" | "daily";

/** How one entity is read. The service, entity set and key fields come from the shipped preset, never from the
 *  tenant; only the switch, the schedule, the field map and the scope are the tenant's own. */
export type SapEntityConfig = {
  enabled: boolean;
  schedule?: SapSchedule;
  field_map: Record<string, string>;
  scope?: EntityScope;
};

export type SapConfig = {
  auth_mode: SapAuthMode;
  /** The API host, without the scheme: my426318-api.s4hana.cloud.sap (a :port is kept). The sandbox login fixes it. */
  api_host: string;
  /** The Communication User (basic login only). The password is a secret and lives only in tenant_connectors.credentials. */
  username: string;
  schedule: SapSchedule;
  entities: Partial<Record<SapEntityKey, SapEntityConfig>>;
};

export type SapPublicConfig = Omit<SapConfig, "entities"> & {
  entities: Record<SapEntityKey, SapEntityConfig & { entity_set: string }>;
  /** https://<host>, so a screen that shows "the address" needs no SAP knowledge. */
  environment_url: string;
  sandbox: boolean;
};

export type SapPublicState = {
  config: SapPublicConfig | null;
  /** Which secrets are stored -- never their values. */
  secrets: { password: boolean; api_key: boolean };
  status: "connected" | "error" | "not_connected";
  last_error: string | null;
};
