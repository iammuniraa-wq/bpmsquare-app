import { ROUTES } from "@/lib/constants";
import type { WorkcenterKey } from "@/lib/workcenters";

// Which objects the assistant can be "on" (the record page the person is looking at), and how a route turns into
// one. Pure and client-safe: the dock parses the route for its own use, and the server parses the same route again
// instead of trusting the client's object type. The detail paths come from ROUTES, so a moved page moves here too.

export type AssistantObjectType =
  | "account" | "contact" | "quote" | "standard_quote" | "product" | "lead" | "opportunity" | "estimate"
  | "case" | "invoice" | "asset" | "supplier" | "rfq" | "work_order";

type Row = Record<string, unknown>;

export type ObjectDef = {
  type: AssistantObjectType;
  /** Plain word for the object, used in cards and the context line. */
  noun: string;
  /** Key in the assistant's sources (LIST_SOURCES plus standard_quotes). */
  sourceKey: string;
  /** TenantFeatures flag of the module that owns the object. */
  featureKey: string;
  workcenter: WorkcenterKey;
  detail: (id: string) => string;
  list: string;
  /** The one line shown as "On <title>": a reference and a name, never more. */
  title: (row: Row) => string;
};

const s = (v: unknown): string => (typeof v === "string" ? v : "");
const named = (v: unknown): string => (v && typeof v === "object" ? s((v as Row).name) : "");
const join = (...parts: string[]) => parts.filter(Boolean).join(" · ");

export const OBJECT_DEFS: ObjectDef[] = [
  { type: "quote", noun: "quote", sourceKey: "quotations", featureKey: "quotations", workcenter: "quotations", detail: ROUTES.quotation, list: ROUTES.quotations,
    title: (r) => join(s(r.ref), named(r.account)) },
  { type: "standard_quote", noun: "standard quote", sourceKey: "standard_quotes", featureKey: "standard_quotes", workcenter: "standard_quotes", detail: ROUTES.standardQuote, list: ROUTES.standardQuotes,
    title: (r) => join(s(r.ref), named(r.account)) },
  { type: "account", noun: "account", sourceKey: "accounts", featureKey: "accounts", workcenter: "accounts", detail: ROUTES.account, list: ROUTES.accounts,
    title: (r) => s(r.name) },
  { type: "contact", noun: "contact", sourceKey: "contacts", featureKey: "contacts", workcenter: "contacts", detail: ROUTES.contact, list: ROUTES.contacts,
    title: (r) => join(s(r.name), named(r.account)) },
  { type: "product", noun: "product", sourceKey: "products", featureKey: "products", workcenter: "products", detail: ROUTES.product, list: ROUTES.products,
    title: (r) => join(s(r.ref) || s(r.sku), s(r.name)) },
  { type: "lead", noun: "lead", sourceKey: "leads", featureKey: "leads", workcenter: "leads", detail: ROUTES.marketingLead, list: ROUTES.leads,
    title: (r) => join(s(r.title), named(r.account)) },
  { type: "opportunity", noun: "deal", sourceKey: "opportunities", featureKey: "pipeline", workcenter: "pipeline", detail: ROUTES.pipelineDetail, list: ROUTES.pipeline,
    title: (r) => join(s(r.ref), s(r.title)) },
  { type: "estimate", noun: "estimate", sourceKey: "estimates", featureKey: "estimator", workcenter: "estimates", detail: ROUTES.estimate, list: ROUTES.estimates,
    title: (r) => join(s(r.ref), s(r.name)) },
  { type: "case", noun: "case", sourceKey: "cases", featureKey: "cases", workcenter: "cases", detail: ROUTES.case, list: ROUTES.cases,
    title: (r) => join(s(r.ref), named(r.account)) },
  { type: "invoice", noun: "invoice", sourceKey: "invoices", featureKey: "invoices", workcenter: "invoices", detail: ROUTES.invoice, list: ROUTES.invoices,
    title: (r) => join(s(r.ref), named(r.account)) },
  { type: "asset", noun: "asset", sourceKey: "assets", featureKey: "assets", workcenter: "assets", detail: ROUTES.asset, list: ROUTES.assets,
    title: (r) => join(s(r.name), named(r.account)) },
  { type: "supplier", noun: "supplier", sourceKey: "suppliers", featureKey: "suppliers", workcenter: "suppliers", detail: ROUTES.supplier, list: ROUTES.suppliers,
    title: (r) => s(r.name) },
  { type: "rfq", noun: "RFQ", sourceKey: "rfqs", featureKey: "rfq", workcenter: "rfqs", detail: ROUTES.rfq, list: ROUTES.rfqs,
    title: (r) => join(s(r.ref), s(r.title)) },
  { type: "work_order", noun: "work order", sourceKey: "work-orders", featureKey: "work_orders", workcenter: "work_orders", detail: ROUTES.workOrder, list: ROUTES.workOrders,
    title: (r) => join(s(r.ref), named(r.account)) },
];

export const objectDef = (type: AssistantObjectType): ObjectDef => OBJECT_DEFS.find((d) => d.type === type)!;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

export type PageContext = {
  /** The path the person is on, query string removed. */
  route: string;
  objectType: AssistantObjectType;
  /** null on a list page: the person is in the object's area but on no single record. */
  recordId: string | null;
};

const prefixOf = (d: ObjectDef): string => d.detail("x").slice(0, -1).replace(/\/$/, "");

/**
 * The object (and record) a route belongs to, or null for any other screen. A /new or /edit page of a record is
 * still "on" that record when the id is a UUID; "/quotations/new" is not a record.
 */
export function parsePageContext(pathname: string | null | undefined): PageContext | null {
  if (!pathname || typeof pathname !== "string") return null;
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  for (const d of OBJECT_DEFS) {
    const prefix = prefixOf(d);
    if (path === prefix || path === d.list) return { route: path, objectType: d.type, recordId: null };
    if (path.startsWith(`${prefix}/`)) {
      const seg = path.slice(prefix.length + 1).split("/")[0];
      if (isUuid(seg)) return { route: path, objectType: d.type, recordId: seg };
    }
  }
  return null;
}
