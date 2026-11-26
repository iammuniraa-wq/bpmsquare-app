import "server-only";
import type { NextRequest } from "next/server";
import { canCreateWorkcenter, canEditWorkcenter, type PermissionSet } from "@/lib/permissions";
import { decryptAccount, decryptContact } from "@/lib/encryption";
import type { Account, Contact } from "@/lib/types";
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
//
// Three kinds of entry, one per thing a card can do: ACTIONS (kind "create": a new record through the object's POST route),
// UPDATE_ACTIONS (kind "update": plain fields of an existing record through the object's PATCH route, with the fields it
// may touch named here) and VERB_ACTIONS (kind "verb": one step on a tender deal through the route its own button posts to).

export type RouteHandler = (req: NextRequest) => Promise<Response>;
/** A route under a record: the handler also gets the id, the way Next passes it. */
export type RecordRouteHandler = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

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

export type UpdateActionDef = {
  key: string;
  kind: "update";
  /** The tool's `object` value; the same word as the create entry of the object. */
  object: string;
  base?: AssistantObjectType;
  noun: string;
  registryType: PilotObjectType;
  table: CreateActionDef["table"];
  /** The object's own PATCH route, with [id] where the record id goes. */
  route: string;
  load: () => Promise<{ PATCH: RecordRouteHandler }>;
  featureKey: string;
  alsoFeatures?: string[];
  workcenter: WorkcenterKey;
  /**
   * The standard fields a change may set: every one is on the route's own allow-list and none is computed or internal. A field the
   * workspace hides is dropped from the card as well. Never a status, a stage, an owner, a foreign id or a money total.
   */
  fieldKeys: readonly string[];
  /** The column that names a record of this object. */
  nameColumn: "name" | "title";
  /** A tender deal is a deal with a row in opportunity_tenders; a plain deal is not offered. */
  tenderOnly?: boolean;
  /** The row as the screen shows it: encrypted columns read back in the clear. */
  readRow?: (row: Record<string, unknown>) => Record<string, unknown>;
  labelOf: (row: Record<string, unknown>) => string;
  hrefFor: (id: string) => string;
  next: (record: { id: string; label: string }) => NextStep[];
};

/** The six steps on a tender deal the assistant can put on a card. */
export type TenderVerb = "decision" | "submit_bid" | "rfq" | "estimate" | "match" | "price";

export type VerbActionDef = {
  key: string;
  kind: "verb";
  verb: TenderVerb;
  noun: string;
  primaryLabel: string;
  /** The route the screen's own button posts to, with [id] where the deal id goes. */
  route: string;
  load: () => Promise<{ POST: RecordRouteHandler }>;
  featureKey: string;
  alsoFeatures: string[];
  workcenter: WorkcenterKey;
  /** Grants the step needs on other objects than the deal (an RFQ is the RFQs workcenter's). */
  alsoGrants?: { workcenter: WorkcenterKey; grant: "create" | "edit" }[];
};

const tenderDealNext = (r: { id: string; label: string }): NextStep[] => [{ id: `open:${r.id}`, label: `Open ${r.label}`, kind: "navigate", target: ROUTES.pipelineDetail(r.id) }];
const rowName = (row: Record<string, unknown>, col: string): string => (typeof row[col] === "string" ? (row[col] as string) : "");

export const UPDATE_ACTIONS: UpdateActionDef[] = [
  {
    key: "update_account", kind: "update", object: "account", noun: "account", registryType: "account", table: "accounts",
    route: "/api/accounts/[id]", load: () => import("@/app/api/accounts/[id]/route"),
    featureKey: "accounts", workcenter: "accounts",
    fieldKeys: ["name", "type", "address_line1", "address_line2", "city", "state", "postal_code", "country", "phone", "phone2", "email", "email2", "website", "industry", "employee_count", "annual_revenue", "gstin", "notes"],
    nameColumn: "name",
    readRow: (r) => decryptAccount(r as unknown as Account) as unknown as Record<string, unknown>,
    labelOf: (r) => rowName(r, "name"), hrefFor: ROUTES.account,
    next: (r) => [{ id: `open:${r.id}`, label: `Open ${r.label}`, kind: "navigate", target: ROUTES.account(r.id) }],
  },
  {
    key: "update_contact", kind: "update", object: "contact", noun: "contact", registryType: "contact", table: "contacts",
    route: "/api/contacts/[id]", load: () => import("@/app/api/contacts/[id]/route"),
    featureKey: "contacts", workcenter: "contacts",
    // The contact's account is a link between two records: moving a contact is done on its own screen.
    fieldKeys: ["name", "role", "department", "birthday", "linkedin_url", "phone", "phone2", "phone3", "email", "email2", "website", "address_line1", "address_line2", "city", "state", "postal_code", "country", "notes"],
    nameColumn: "name",
    readRow: (r) => decryptContact(r as unknown as Contact) as unknown as Record<string, unknown>,
    labelOf: (r) => rowName(r, "name"), hrefFor: ROUTES.contact,
    next: (r) => [{ id: `open:${r.id}`, label: `Open ${r.label}`, kind: "navigate", target: ROUTES.contact(r.id) }],
  },
  {
    key: "update_supplier", kind: "update", object: "supplier", noun: "supplier", registryType: "supplier", table: "suppliers",
    route: "/api/suppliers/[id]", load: () => import("@/app/api/suppliers/[id]/route"),
    featureKey: "suppliers", workcenter: "suppliers",
    fieldKeys: ["name", "type", "status", "city", "phone", "email", "gstin", "notes"],
    nameColumn: "name",
    labelOf: (r) => rowName(r, "name"), hrefFor: ROUTES.supplier,
    next: (r) => [{ id: `open:${r.id}`, label: `Open ${r.label}`, kind: "navigate", target: ROUTES.supplier(r.id) }],
  },
  {
    key: "update_product", kind: "update", object: "product", noun: "product", registryType: "product", table: "products",
    route: "/api/products/[id]", load: () => import("@/app/api/products/[id]/route"),
    featureKey: "products", workcenter: "products",
    // cost_price and cost_price_as_of are internal (margin): on no card, in no prompt. The cost sheet, quantity breaks, supplier and
    // item type are structure with their own screens.
    fieldKeys: ["name", "sku", "category", "status", "list_price", "tax_percent", "uom", "lead_time_days", "description"],
    nameColumn: "name",
    labelOf: (r) => rowName(r, "name"), hrefFor: ROUTES.product,
    next: (r) => [{ id: `open:${r.id}`, label: `Open ${r.label}`, kind: "navigate", target: ROUTES.product(r.id) }],
  },
  {
    key: "update_tender", kind: "update", object: "tender", base: "opportunity", noun: "tender deal", registryType: "opportunity", table: "opportunities",
    route: "/api/opportunities/[id]", load: () => import("@/app/api/opportunities/[id]/route"),
    featureKey: "gcc_tender", alsoFeatures: ["pipeline"], workcenter: "pipeline",
    // Stage, outcome and loss reason are moves (the tender steps), the amount and probability are computed, owner and team are people.
    fieldKeys: ["title", "description", "source", "expected_close"],
    nameColumn: "title", tenderOnly: true,
    labelOf: (r) => [rowName(r, "ref"), rowName(r, "title")].filter(Boolean).join(" ") || rowName(r, "title"),
    hrefFor: ROUTES.pipelineDetail, next: tenderDealNext,
  },
];

export const VERB_ACTIONS: VerbActionDef[] = [
  {
    key: "tender_decision", kind: "verb", verb: "decision", noun: "bid decision", primaryLabel: "Propose decision",
    route: "/api/opportunities/[id]/tender/approval", load: () => import("@/app/api/opportunities/[id]/tender/approval/route"),
    featureKey: "gcc_tender", alsoFeatures: ["pipeline"], workcenter: "pipeline",
  },
  {
    key: "tender_submit_bid", kind: "verb", verb: "submit_bid", noun: "bid version", primaryLabel: "Submit bid",
    route: "/api/opportunities/[id]/tender/bids", load: () => import("@/app/api/opportunities/[id]/tender/bids/route"),
    featureKey: "gcc_tender", alsoFeatures: ["pipeline"], workcenter: "pipeline",
  },
  {
    key: "tender_rfq", kind: "verb", verb: "rfq", noun: "RFQ", primaryLabel: "Create RFQ",
    route: "/api/rfqs", load: async () => ({ POST: (await import("@/app/api/rfqs/route")).POST as unknown as RecordRouteHandler }),
    featureKey: "gcc_tender", alsoFeatures: ["pipeline", "rfq", "suppliers"], workcenter: "pipeline",
    alsoGrants: [{ workcenter: "rfqs", grant: "edit" }],
  },
  {
    key: "tender_estimate", kind: "verb", verb: "estimate", noun: "estimate", primaryLabel: "Create estimate",
    route: "/api/estimates", load: async () => ({ POST: (await import("@/app/api/estimates/route")).POST as unknown as RecordRouteHandler }),
    featureKey: "gcc_tender", alsoFeatures: ["pipeline", "estimator"], workcenter: "pipeline",
    alsoGrants: [{ workcenter: "estimates", grant: "create" }],
  },
  {
    key: "tender_match", kind: "verb", verb: "match", noun: "product match", primaryLabel: "Match to products",
    route: "/api/opportunities/[id]/boq/match", load: () => import("@/app/api/opportunities/[id]/boq/match/route"),
    featureKey: "gcc_tender", alsoFeatures: ["pipeline", "products"], workcenter: "pipeline",
  },
  {
    key: "tender_price", kind: "verb", verb: "price", noun: "BOQ pricing", primaryLabel: "Price all",
    route: "/api/opportunities/[id]/boq/price", load: () => import("@/app/api/opportunities/[id]/boq/price/route"),
    featureKey: "gcc_tender", alsoFeatures: ["pipeline"], workcenter: "pipeline",
  },
];

export const updateByKey = (key: string): UpdateActionDef | undefined => UPDATE_ACTIONS.find((a) => a.key === key);
export const updateFor = (object: string): UpdateActionDef | undefined => UPDATE_ACTIONS.find((a) => a.object === object);
export const verbByKey = (key: string): VerbActionDef | undefined => VERB_ACTIONS.find((a) => a.key === key);
export const verbFor = (verb: string): VerbActionDef | undefined => VERB_ACTIONS.find((a) => a.verb === verb);

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
  "fence-projects": "has a site, lines and pricing; the project screens stay the way in",
  inventory: "unique SKU and stock rules; next in line",
  "work-orders": "created from a case with its authorisation (quote or contract); the Create work order action on the case stays the way in",
  invoices: "an outward financial document; a verb for a later step, not a plain create",
  leads: "carries consent and a source; next in line",
  opportunities: "a plain deal needs an account and a stage; next in line. A tender deal is registered (create_tender at /api/opportunities/tender); Create deal from an Inbox email stays the way in",
  "purchase-orders": "has lines and a supplier and goes outward; a verb for a later step",
  quotes: "needs line items and pricing; the quote screens and the pricing engine stay the way in",
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
 * Verbs on an existing record that the assistant cannot do yet, each with the route that does it and the reason. The verbs it
 * can do are VERB_ACTIONS (the tender steps); registry.test.ts checks every route named here still exists with a POST so the
 * list cannot rot, and that none is also registered. "Check this order with the ERP" is read-only but is a call to an outside
 * system the person watches the result of; "Send order to the ERP" creates a document in the customer's ERP. The assistant reads
 * the results through Talk to data (credit_check, price_check, stock_check on sales orders) and the buttons on the ERP tab stay
 * the way in.
 */
export const DEFERRED_VERBS: Record<string, { route: string; why: string }> = {
  check_order_with_erp: { route: "sales-orders/[id]/erp-check", why: "a read-only check of one named order against the ERP; the ERP tab already shows the answer" },
  send_order_to_erp: { route: "sales-orders/[id]/erp-send", why: "creates a document in the customer's ERP and locks the order; needs a verb confirm card that lists the checks that are not a pass" },
  revise_bid: { route: "opportunities/[id]/tender/bids", why: "a deal that is already Submitted is first moved back to Estimating by a second write, then the new version is posted; the assistant submits only from Estimating or Clarifications and sends a revision to the Bid tab" },
};

export type ActionGate = { features: Record<string, boolean | undefined>; perms: PermissionSet };

/** The assistant's actions are a platform-admin flag that needs the assistant on; Nova is not needed. */
export function actionsEnabled(features: Record<string, boolean | undefined>): boolean {
  return features.ai_assistant === true && features.ai_assistant_actions === true;
}

const modulesOn = (features: Record<string, boolean | undefined>, a: { featureKey: string; alsoFeatures?: string[] }): boolean =>
  features[a.featureKey] === true && (a.alsoFeatures ?? []).every((k) => features[k] === true);

/** Actions this caller may start: the flag, the object's module, and the Business Role's create grant. */
export function availableActions(gate: ActionGate): CreateActionDef[] {
  if (!actionsEnabled(gate.features)) return [];
  return ACTIONS.filter((a) => modulesOn(gate.features, a) && canCreateWorkcenter(gate.perms, a.workcenter));
}

/** Changes this caller may start: the same flag and module, and the Business Role's edit grant. */
export function availableUpdates(gate: ActionGate): UpdateActionDef[] {
  if (!actionsEnabled(gate.features)) return [];
  return UPDATE_ACTIONS.filter((a) => modulesOn(gate.features, a) && canEditWorkcenter(gate.perms, a.workcenter));
}

/** Tender steps this caller may start: the module flags, the Pipeline edit grant (the routes' own rule) and any other object's grant. */
export function availableVerbs(gate: ActionGate): VerbActionDef[] {
  if (!actionsEnabled(gate.features)) return [];
  return VERB_ACTIONS.filter((a) =>
    modulesOn(gate.features, a) && canEditWorkcenter(gate.perms, a.workcenter) &&
    (a.alsoGrants ?? []).every((g) => (g.grant === "create" ? canCreateWorkcenter(gate.perms, g.workcenter) : canEditWorkcenter(gate.perms, g.workcenter))));
}
