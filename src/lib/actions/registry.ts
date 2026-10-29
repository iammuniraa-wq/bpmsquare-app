import "server-only";
import type { NextRequest } from "next/server";
import { canCreateWorkcenter, type PermissionSet } from "@/lib/permissions";
import { ROUTES } from "@/lib/constants";
import type { PilotObjectType } from "@/lib/fieldRegistry";
import type { WorkcenterKey } from "@/lib/workcenters";
import type { CardWidget, NextStep } from "@/lib/assistant/cards";
import type { AssistantObjectType } from "@/lib/assistant/objects";
import { TENDER_PORTALS, TENDER_PORTAL_LABEL } from "@/lib/tender/rules";

// The action registry: what the assistant is allowed to DO, one entry per thing. An entry names the object's own
// app route (the one the New form posts to), so an assistant create goes through exactly the validation, foreign-id
// checks, PII encryption, master reference and Change History the form does. The assistant has no other way to
// write. Fields are not listed here: they come from the workspace's own field config at card time, so a custom
// field or a renamed label is on the card the moment it exists.
//
// actions/registry.test.ts walks src/app/api and fails when an entry points at a route that is missing or has no
// POST, and when an object route with a POST is neither registered nor in DEFERRED with a reason.

export type RouteHandler = (req: NextRequest) => Promise<Response>;

/** A record an object points at (a contact's account). The person names it; the card resolves the id. */
export type RefDef = {
  /** Request body key and card field key. */
  key: string;
  label: string;
  /** The key the assistant uses in `references` to name it. */
  param: string;
  table: "accounts";
  required: boolean;
  /** When the person is on a record of this type, that record is the default. */
  fromPage?: "account";
};

/** A field the route takes that the object's field registry does not list (a tender's number, portal, bid end date). */
export type ExtraFieldDef = {
  key: string;
  label: string;
  widget: CardWidget;
  options?: { value: string; label: string }[];
};

export type CreateActionDef = {
  key: string;
  kind: "create";
  /** The tool's `object` value; the assistant object type (assistant/objects.ts) unless `base` says which one it is a kind of. */
  object: string;
  /** The assistant object type this is a kind of, when `object` is a narrower word (a tender is a deal). */
  base?: AssistantObjectType;
  noun: string;
  /** One clause for the CREATABLE block when the object's name alone does not say what it is. */
  blurb?: string;
  registryType: PilotObjectType;
  /** The change-log / PII object name, the same string the route logs under. */
  table: "accounts" | "contacts" | "suppliers" | "products" | "opportunities";
  route: string;
  load: () => Promise<{ POST: RouteHandler }>;
  featureKey: string;
  /** Further module flags the route itself insists on (a tender deal also needs Pipeline). */
  alsoFeatures?: string[];
  workcenter: WorkcenterKey;
  /**
   * When present, ONLY these standard fields of the registry are offered, and no custom fields: the route takes exactly
   * these, and a field it would silently drop (or one that is internal, like a product's cost price) must not be on a card.
   */
  fieldKeys?: readonly string[];
  /** Fields the route takes that the registry lacks; they come first on the card and carry no workspace label override. */
  extraFields?: ExtraFieldDef[];
  /** The request body for a route that does not take the flat field-to-value shape. */
  body?: (values: Record<string, string>) => Record<string, unknown>;
  /** Required on the card: the route answers 400 without them, or the assistant insists on them. */
  requiredKeys: string[];
  refs: RefDef[];
  labelOf: (values: Record<string, string>) => string;
  hrefFor: (id: string) => string;
  next: (record: { id: string; label: string }) => NextStep[];
  /**
   * Present only on an organisation object (a company, never a person). The keys of the standard fields the assistant
   * may propose from the web for it, each with the plain description the research call is given instead of the
   * workspace's own label. A key the field config does not offer is simply not asked for.
   */
  research?: Record<string, string>;
};

/**
 * What New tender sends: the deal's account, title and source on top, the tender details in `tender`. The bid end date is a
 * calendar date on a card, so it goes as noon UTC: the same calendar day in every zone from the Gulf to the Americas, and the
 * person can set the hour on the deal. Nothing else is sent: no stage, no deal type, no amount (the lines make that).
 */
export function tenderBody(v: Record<string, string>): Record<string, unknown> {
  const tender: Record<string, unknown> = {};
  if (v.tender_no) tender.tender_no = v.tender_no;
  if (v.issuer_name) tender.issuer_name = v.issuer_name;
  if (v.portal) tender.portal = v.portal;
  if (v.closing_at) tender.closing_at = `${v.closing_at}T12:00:00.000Z`;
  return {
    account_id: v.account_id,
    ...(v.title ? { title: v.title } : {}),
    ...(v.source ? { source: v.source } : {}),
    tender,
  };
}

export const ACTIONS: CreateActionDef[] = [
  {
    key: "create_account", kind: "create", object: "account", noun: "account", registryType: "account", table: "accounts",
    route: "/api/accounts", load: () => import("@/app/api/accounts/route"),
    featureKey: "accounts", workcenter: "accounts",
    requiredKeys: ["name", "type"], refs: [],
    research: {
      website: "the company's official website address",
      industry: "its industry or sector in a few words",
      address_line1: "the street address of its head office",
      city: "the city of its head office",
      state: "the state or region of its head office",
      postal_code: "the postal code of its head office",
      country: "the country of its head office",
      phone: "the main telephone number the company itself publishes for general enquiries",
      email: "a general enquiries email address the company itself publishes (info@, contact@), never a named person's",
      employee_count: "its number of employees, or a range, if the company states it",
    },
    labelOf: (v) => v.name ?? "",
    hrefFor: ROUTES.account,
    next: (r) => [
      { id: `open:${r.id}`, label: `Open ${r.label}`, kind: "navigate", target: ROUTES.account(r.id) },
      { id: `contact:${r.id}`, label: "Add a contact", kind: "ask", question: `Add a contact to the account ${r.label}` },
    ],
  },
  {
    key: "create_contact", kind: "create", object: "contact", noun: "contact", registryType: "contact", table: "contacts",
    route: "/api/contacts", load: () => import("@/app/api/contacts/route"),
    featureKey: "contacts", workcenter: "contacts",
    requiredKeys: ["name", "account_id"],
    refs: [{ key: "account_id", label: "Account", param: "account", table: "accounts", required: true, fromPage: "account" }],
    labelOf: (v) => v.name ?? "",
    hrefFor: ROUTES.contact,
    next: (r) => [{ id: `open:${r.id}`, label: `Open ${r.label}`, kind: "navigate", target: ROUTES.contact(r.id) }],
  },
  {
    key: "create_supplier", kind: "create", object: "supplier", noun: "supplier", registryType: "supplier", table: "suppliers",
    route: "/api/suppliers", load: () => import("@/app/api/suppliers/route"),
    featureKey: "suppliers", workcenter: "suppliers",
    // Status is set by the route (active); phone, email and GSTIN are details the Suppliers screen collects, not asked here.
    fieldKeys: ["name", "type", "city", "notes"],
    requiredKeys: ["name"], refs: [],
    labelOf: (v) => v.name ?? "",
    hrefFor: ROUTES.supplier,
    next: (r) => [{ id: `open:${r.id}`, label: `Open ${r.label}`, kind: "navigate", target: ROUTES.supplier(r.id) }],
  },
  {
    key: "create_product", kind: "create", object: "product", noun: "product", registryType: "product", table: "products",
    route: "/api/products", load: () => import("@/app/api/products/route"),
    featureKey: "products", workcenter: "products",
    // cost_price is internal (margin): it is not on the card, not in the prompt, and a press that sends it is refused.
    fieldKeys: ["name", "sku", "category", "uom", "list_price"],
    requiredKeys: ["name"], refs: [],
    labelOf: (v) => v.name ?? "",
    hrefFor: ROUTES.product,
    next: (r) => [{ id: `open:${r.id}`, label: `Open ${r.label}`, kind: "navigate", target: ROUTES.product(r.id) }],
  },
  {
    key: "create_tender", kind: "create", object: "tender", base: "opportunity", noun: "tender deal",
    blurb: "a deal in the Pipeline that carries its tender details; the deal type and first stage are set by the app",
    registryType: "opportunity", table: "opportunities",
    // The route New tender posts to: it makes the deal and its tender row together and decides the stage and deal type.
    route: "/api/opportunities/tender", load: () => import("@/app/api/opportunities/tender/route"),
    featureKey: "gcc_tender", alsoFeatures: ["pipeline"], workcenter: "pipeline",
    fieldKeys: ["title", "source"],
    extraFields: [
      { key: "tender_no", label: "Tender number", widget: "text" },
      { key: "issuer_name", label: "Issuer", widget: "text" },
      { key: "portal", label: "Portal", widget: "enum", options: TENDER_PORTALS.map((p) => ({ value: p, label: TENDER_PORTAL_LABEL[p] })) },
      { key: "closing_at", label: "Bid end date", widget: "date" },
    ],
    requiredKeys: ["tender_no", "closing_at"],
    refs: [{ key: "account_id", label: "Account", param: "account", table: "accounts", required: true, fromPage: "account" }],
    body: tenderBody,
    labelOf: (v) => [v.tender_no, v.issuer_name].filter(Boolean).join(" · ") || v.title || "",
    hrefFor: ROUTES.pipelineDetail,
    next: (r) => [{ id: `open:${r.id}`, label: `Open ${r.label}`, kind: "navigate", target: ROUTES.pipelineDetail(r.id) }],
  },
];

export const actionByKey = (key: string): CreateActionDef | undefined => ACTIONS.find((a) => a.key === key);
export const actionFor = (object: string): CreateActionDef | undefined => ACTIONS.find((a) => a.object === object);

/**
 * Every other top-level collection route under src/app/api with a POST, each with the reason the assistant cannot
 * create it yet. The registry test fails when a route is in neither this list nor ACTIONS (so a new object is a
 * decision, not an oversight) and when an entry here no longer has a POST (so the list cannot rot).
 */
export const DEFERRED: Record<string, string> = {
  // Business objects: next in line, each needs its own required links or lines worked out first.
  assets: "needs an owning account and technical fields; next in line",
  cases: "needs an account and assets; next in line after accounts and contacts",
  estimates: "born from a template; the Estimator stays the way in",
  "fence-projects": "has a site, lines and pricing; the project screens stay the way in",
  inventory: "unique SKU and stock rules; next in line",
  "work-orders": "created from a case with its authorisation (quote or contract); the Create work order action on the case stays the way in",
  invoices: "an outward financial document; a verb for a later step, not a plain create",
  leads: "carries consent and a source; next in line",
  opportunities: "a plain deal needs an account and a stage; next in line. A tender deal is registered (create_tender at /api/opportunities/tender); Create deal from an Inbox email stays the way in",
  "purchase-orders": "has lines and a supplier and goes outward; a verb for a later step",
  quotes: "needs line items and pricing; the quote screens and the pricing engine stay the way in",
  rfqs: "the route takes its lines from the request body (it does not copy a deal's unpriced lines), so the assistant would have to compose line items; Raise RFQ on the deal and the RFQ screen stay the way in",
  "standard-quotes": "needs line items and pricing; the quote screens stay the way in",
  "sales-orders": "made from an accepted quote or a won deal with its lines and prices copied; Create sales order on the quote stays the way in, and the assistant reads orders through Talk to data",
  "sales-order-types": "settings for Sales Orders",
  "contract-projects": "made from an awarded tender with its lines and costs copied, and its budget is approved by a manager; Create contract project on the awarded deal stays the way in, and the assistant reads projects (header and totals only) through Talk to data",
  "supplier-groups": "a client's approved vendor list in a workspace with the tender edition; set up from the Groups tab in Suppliers, which also holds the members",
  technicians: "linked to a login and skills; set up from the Technicians screen",
  // Marketing and studios: configuration-heavy, not a typed record.
  journeys: "a flow of steps, built in the Journeys studio",
  "marketing-events": "built in the Events screen with a form and a follow-up",
  "marketing-forms": "built in the Forms studio",
  newsletters: "built in the Newsletter Studio",
  "process-studio": "a document-driven study, started from its own screen",
  "signal-topics": "settings, not a record",
  // Not records a person creates by asking.
  "business-roles": "access control: never from a chat",
  "business-users": "invites a person and sets a role: never from a chat",
  employees: "payroll-adjacent master data: set up from Workforce",
  "estimate-templates": "settings for the Estimator",
  "standard-quote-templates": "settings for Standard Quotes",
  reports: "saves a report definition, not a business record",
  "saved-queries": "saves a filter, not a business record",
  upload: "a file upload, not a record",
};

/**
 * Verbs on an existing record that the assistant cannot do yet, each with the route that does it and the reason. The
 * registry holds creates only (kind "create"), and registry.test.ts checks every route named here still exists with a POST so
 * the list cannot rot. "Check this order with the ERP" is read-only but is a call to an outside system the person watches the
 * result of; "Send order to the ERP" creates a document in the customer's ERP. Both need a verb card (a confirm card for a
 * named record, not a field form) that the assistant does not have: until then the assistant reads the results through Talk to
 * data (credit_check, price_check, stock_check on sales orders) and the buttons on the ERP tab stay the way in.
 */
export const DEFERRED_VERBS: Record<string, { route: string; why: string }> = {
  check_order_with_erp: { route: "sales-orders/[id]/erp-check", why: "a read-only check of one named order against the ERP; needs a verb confirm card, not a create form" },
  send_order_to_erp: { route: "sales-orders/[id]/erp-send", why: "creates a document in the customer's ERP and locks the order; needs a verb confirm card that lists the checks that are not a pass" },
};

export type ActionGate = { features: Record<string, boolean | undefined>; perms: PermissionSet };

/** The assistant's actions are a platform-admin flag that needs the assistant and Nova both on. */
export function actionsEnabled(features: Record<string, boolean | undefined>): boolean {
  return features.ai_assistant === true && features.ai_assistant_actions === true && features.next_experience === true;
}

/** Actions this caller may start: the flag, the object's module, and the Business Role's create grant. */
export function availableActions(gate: ActionGate): CreateActionDef[] {
  if (!actionsEnabled(gate.features)) return [];
  return ACTIONS.filter((a) =>
    gate.features[a.featureKey] === true && (a.alsoFeatures ?? []).every((k) => gate.features[k] === true) && canCreateWorkcenter(gate.perms, a.workcenter));
}
