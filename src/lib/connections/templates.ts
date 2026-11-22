import { D365_DEFAULTS } from "@/lib/connectors/d365/catalog";
import { SAP_PRESETS } from "@/lib/connectors/sap_s4/catalog";
import type { D365EntityKey, D365Product } from "@/lib/connectors/d365/types";
import type { EndpointObject, ParsedEndpoint } from "./endpointSpec";

// "Start from a template": the presets the Dynamics 365 and SAP S/4HANA connectors ship with, offered as an OPTIONAL list of
// endpoints for a connection you add yourself. A template is read from those presets (never copied), nothing here is applied by
// itself, and a person picks the rows they want. ePROMIS has no template: its API is not documented, so it has no verified
// operation to offer (src/lib/connectors/epromis/presets/epromis.default.json says so). Client-safe.

export type EndpointTemplate = {
  key: string;
  label: string;
  /** Which connection type it suits: the endpoints are OData entity sets. */
  family: "odata";
  /** A short plain line about the address the connection needs. */
  addressHint: string;
  endpoints: Pick<ParsedEndpoint, "name" | "path" | "method" | "direction" | "object_type">[];
};

const D365_OBJECT: Partial<Record<D365EntityKey, { object: EndpointObject; name: string }>> = {
  customers: { object: "customers", name: "Customers" },
  contacts: { object: "contacts", name: "Contacts" },
  products: { object: "products", name: "Products" },
  projects: { object: "projects", name: "Projects" },
};

function d365(key: string, label: string, product: D365Product, addressHint: string): EndpointTemplate {
  const defaults = D365_DEFAULTS[product];
  const endpoints: EndpointTemplate["endpoints"] = [];
  for (const [entity, meta] of Object.entries(D365_OBJECT) as [D365EntityKey, { object: EndpointObject; name: string }][]) {
    const set = defaults[entity]?.entity_set;
    if (set) endpoints.push({ name: meta.name, path: set, method: "GET", direction: "in", object_type: meta.object });
  }
  return { key, label, family: "odata", addressHint, endpoints };
}

export const ENDPOINT_TEMPLATES: readonly EndpointTemplate[] = [
  d365("d365_fo", "Dynamics 365 Finance and Operations", "fo", "https://yourenv.operations.dynamics.com/data"),
  d365("d365_dataverse", "Dynamics 365 Sales (Dataverse)", "dataverse", "https://yourorg.crm4.dynamics.com/api/data/v9.2"),
  d365("d365_bc", "Dynamics 365 Business Central", "bc", "https://api.businesscentral.dynamics.com/v2.0/<tenant>/<environment>/api/v2.0"),
  {
    key: "sap_s4_bp", label: "SAP S/4HANA business partners", family: "odata",
    addressHint: "https://<host>/sap/opu/odata/sap/API_BUSINESS_PARTNER",
    endpoints: [{ name: "Customers", path: SAP_PRESETS.customers.entity_set, method: "GET", direction: "in", object_type: "customers" }],
  },
  {
    key: "sap_s4_product", label: "SAP S/4HANA products", family: "odata",
    addressHint: "https://<host>/sap/opu/odata/sap/API_PRODUCT_SRV",
    endpoints: [{ name: "Products", path: SAP_PRESETS.products.entity_set, method: "GET", direction: "in", object_type: "products" }],
  },
];

export const getTemplate = (key: string): EndpointTemplate | undefined => ENDPOINT_TEMPLATES.find((t) => t.key === key);
