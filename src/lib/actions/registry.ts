import "server-only";
import type { NextRequest } from "next/server";
import { canCreateWorkcenter, type PermissionSet } from "@/lib/permissions";
import { ROUTES } from "@/lib/constants";
import type { PilotObjectType } from "@/lib/fieldRegistry";
import type { WorkcenterKey } from "@/lib/workcenters";
import type { NextStep } from "@/lib/assistant/cards";

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

export type CreateActionDef = {
  key: string;
  kind: "create";
  /** Assistant object type (assistant/objects.ts), also the tool's `object` value. */
  object: string;
  noun: string;
  registryType: PilotObjectType;
  /** The change-log / PII object name, the same string the route logs under. */
  table: "accounts" | "contacts";
  route: string;
  load: () => Promise<{ POST: RouteHandler }>;
  featureKey: string;
  workcenter: WorkcenterKey;
  /** Required by the route itself (it answers 400 without them), whatever the field config says. */
  requiredKeys: string[];
  refs: RefDef[];
  labelOf: (values: Record<string, string>) => string;
  hrefFor: (id: string) => string;
  next: (record: { id: string; label: string }) => NextStep[];
};

export const ACTIONS: CreateActionDef[] = [
  {
    key: "create_account", kind: "create", object: "account", noun: "account", registryType: "account", table: "accounts",
    route: "/api/accounts", load: () => import("@/app/api/accounts/route"),
    featureKey: "accounts", workcenter: "accounts",
    requiredKeys: ["name", "type"], refs: [],
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
];

export const actionByKey = (key: string): CreateActionDef | undefined => ACTIONS.find((a) => a.key === key);
export const actionFor = (object: string): CreateActionDef | undefined => ACTIONS.find((a) => a.object === object);

/**
 * Objects with a POST route under src/app/api that the assistant cannot create yet, each with the reason. The
 * registry test fails when a route is in neither list, so a new object is a decision, not an oversight.
 */
export const DEFERRED: Record<string, string> = {
  quotes: "needs line items and pricing; the quote screens and the pricing engine stay the way in",
  "standard-quotes": "needs line items and pricing; the quote screens stay the way in",
  cases: "needs an account and assets; next in line after accounts and contacts",
  invoices: "an outward financial document; a verb for a later step, not a plain create",
  assets: "needs an owning account and technical fields; next in line",
  suppliers: "next in line; same shape as accounts",
  products: "next in line; same shape as accounts",
  leads: "next in line; carries consent and a source",
  opportunities: "needs an account and a stage; next in line",
  rfqs: "has lines and suppliers; the RFQ screen stays the way in",
  estimates: "born from a template; the Estimator stays the way in",
  "work-orders": "authorised by a quote; created by the dispatch flow",
};

export type ActionGate = { features: Record<string, boolean | undefined>; perms: PermissionSet };

/** The assistant's actions are a platform-admin flag that needs the assistant and Nova both on. */
export function actionsEnabled(features: Record<string, boolean | undefined>): boolean {
  return features.ai_assistant === true && features.ai_assistant_actions === true && features.next_experience === true;
}

/** Actions this caller may start: the flag, the object's module, and the Business Role's create grant. */
export function availableActions(gate: ActionGate): CreateActionDef[] {
  if (!actionsEnabled(gate.features)) return [];
  return ACTIONS.filter((a) => gate.features[a.featureKey] === true && canCreateWorkcenter(gate.perms, a.workcenter));
}
