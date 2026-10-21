import { ROUTES } from "@/lib/constants";
import type { WorkcenterKey } from "@/lib/workcenters";
import type { AssistantObjectType } from "./objects";

// The suggestions strip: two or three next steps for the screen the person is on, from plain rules over the record
// and its related data. Deterministic on purpose (the Account 360 doctrine): a suggestion a rep is told to act on
// has to be explainable and stable across reloads, so no model writes it and no model scores it. In S1 a
// suggestion either opens a screen or sends a prepared question to the chat; none of them writes anything.
// Pure: rows in, suggestions out. The server decides what to load (suggestionsServer.ts).

type Row = Record<string, unknown>;

export type Suggestion = {
  id: string;
  label: string;
  kind: "navigate" | "ask";
  /** kind "navigate": an internal path, built here from ROUTES. */
  target?: string;
  /** kind "ask": the question sent to the chat as if the person had typed it. */
  question?: string;
  /** Shown behind the "i". One or two short sentences. */
  why: string;
  /** What the person needs for the target or the question to work. Filtered on the server, never trusted from the client. */
  requires?: { feature?: string; workcenter?: WorkcenterKey };
};

/** What was loaded alongside the record. `undefined` means "not loaded" (no access, or the module is off): the rules that need it stay silent. */
export type Related = {
  contacts?: Row[];
  quotes?: Row[];
  cases?: Row[];
};

export const MAX_SUGGESTIONS = 3;
export const DRAFT_STALE_DAYS = 7;
export const SENT_STALE_DAYS = 10;
export const NEW_LEAD_DAYS = 2;
export const OPP_STALE_DAYS = 14;
export const EXPIRY_WINDOW_DAYS = 7;

const DAY = 86_400_000;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const named = (v: unknown): string => (v && typeof v === "object" ? str((v as Row).name) : "");
const idOf = (v: unknown): string => (v && typeof v === "object" ? str((v as Row).id) : "");

export function daysSince(iso: unknown, now: Date): number | null {
  const t = typeof iso === "string" ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? Math.floor((now.getTime() - t) / DAY) : null;
}
const daysUntil = (iso: unknown, now: Date): number | null => {
  const d = daysSince(iso, now);
  return d === null ? null : -d;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const open = (outcome: unknown) => outcome !== "won" && outcome !== "lost" && outcome !== "dropped";

const nav = (id: string, label: string, target: string, why: string, requires?: Suggestion["requires"]): Suggestion =>
  ({ id, label, kind: "navigate", target, why, requires });
const ask = (id: string, label: string, question: string, why: string, requires?: Suggestion["requires"]): Suggestion =>
  ({ id, label, kind: "ask", question, why, requires });

const withAccount = (path: string, accountId: string) => (accountId ? `${path}?account_id=${accountId}` : path);

export function accountSuggestions(row: Row, related: Related, now: Date): Suggestion[] {
  const id = str(row.id), name = str(row.name);
  const out: Suggestion[] = [];
  if (related.contacts && related.contacts.length === 0) {
    out.push(nav("account.add-contact", "Add a contact", withAccount(ROUTES.contactNew, id), "No contact is saved for this account yet.", { feature: "contacts", workcenter: "contacts" }));
  }
  const draft = related.quotes?.find((q) => q.status === "draft" && (daysSince(q.created_at, now) ?? 0) >= DRAFT_STALE_DAYS);
  if (draft) {
    out.push(nav("account.finish-draft", `Finish ${str(draft.ref)}`, ROUTES.quotation(str(draft.id)),
      `${str(draft.ref)} has been a draft for ${daysSince(draft.created_at, now)} days.`, { feature: "quotations", workcenter: "quotations" }));
  }
  if (related.quotes?.some((q) => num(q.balance_due) > 0)) {
    out.push(ask("account.unpaid", "Unpaid invoices", `Which invoices of ${name} are not fully paid?`, "Some of its won quotes are invoiced and not fully paid.", { feature: "invoices", workcenter: "invoices" }));
  }
  if (related.cases?.some((c) => !c.closed_at)) {
    out.push(ask("account.open-cases", "Open cases", `What are the open cases of ${name}?`, `${plural(related.cases.filter((c) => !c.closed_at).length, "case")} still open.`, { feature: "cases", workcenter: "cases" }));
  }
  if (related.quotes && related.quotes.length === 0) {
    out.push(nav("account.first-quote", "Start a quotation", withAccount(ROUTES.quotationNew, id), "No quotation exists for this account yet.", { feature: "quotations", workcenter: "quotations" }));
  }
  return out;
}

export function contactSuggestions(row: Row): Suggestion[] {
  const accountId = idOf(row.account), account = named(row.account);
  if (!accountId) return [];
  const out: Suggestion[] = [
    nav("contact.open-account", `Open ${account || "the account"}`, ROUTES.account(accountId), "See everything about their company in one place.", { feature: "accounts", workcenter: "accounts" }),
    ask("contact.quotes", "Their open quotes", `Which open quotations does ${account} have?`, "Shows what is in play with this company.", { feature: "quotations", workcenter: "quotations" }),
    ask("contact.colleagues", "Who else is there", `Who else works at ${account}?`, "Other contacts saved for the same account.", { feature: "contacts", workcenter: "contacts" }),
  ];
  return out;
}

export function quoteSuggestions(row: Row, _related: Related, now: Date): Suggestion[] {
  const id = str(row.id), ref = str(row.ref), accountId = idOf(row.account), account = named(row.account);
  const req = { feature: "quotations", workcenter: "quotations" as WorkcenterKey };
  const out: Suggestion[] = [];
  const age = daysSince(row.created_at, now);
  if (row.status === "draft" && age !== null && age >= DRAFT_STALE_DAYS) {
    out.push(nav("quote.finish", `Finish and send ${ref}`, ROUTES.quotationEdit(id), `It has been a draft for ${age} days.`, req));
  }
  const left = daysUntil(row.valid_until, now);
  if (open(row.outcome) && left !== null) {
    if (left < 0) out.push(ask("quote.expired", "Quotes past their date", "Which open quotations are past their validity date?", `${ref} was valid until ${str(row.valid_until).slice(0, 10)}.`, req));
    else if (left <= EXPIRY_WINDOW_DAYS) out.push(ask("quote.expiring", "Quotes expiring this week", "Which open quotations expire in the next 7 days?", `${ref} is valid until ${str(row.valid_until).slice(0, 10)}.`, req));
  }
  if (row.status === "sent" && open(row.outcome) && accountId && age !== null && age >= SENT_STALE_DAYS) {
    out.push(nav("quote.chase", `Open ${account || "the account"}`, ROUTES.account(accountId), `Sent ${age} days ago and still open. The account shows who to chase.`, { feature: "accounts", workcenter: "accounts" }));
  }
  if (row.outcome === "won" && num(row.invoice_count) === 0) {
    out.push(nav("quote.invoice", "Raise an invoice", withAccount(ROUTES.invoiceNew, accountId), "It is won and has no invoice yet.", { feature: "invoices", workcenter: "invoices" }));
  }
  if (num(row.balance_due) > 0) {
    out.push(ask("quote.unpaid", "Unpaid invoices", `Which invoices for ${ref} are not fully paid?`, "It is invoiced and not fully paid.", { feature: "invoices", workcenter: "invoices" }));
  }
  return out;
}

export function standardQuoteSuggestions(row: Row, now: Date): Suggestion[] {
  const id = str(row.id), ref = str(row.ref), account = named(row.account);
  const req = { feature: "standard_quotes", workcenter: "standard_quotes" as WorkcenterKey };
  const out: Suggestion[] = [];
  const age = daysSince(row.created_at, now);
  if (row.status === "draft" && age !== null && age >= DRAFT_STALE_DAYS) {
    out.push(nav("sq.finish", `Finish and send ${ref}`, ROUTES.standardQuoteEdit(id), `It has been a draft for ${age} days.`, req));
  }
  const sentAge = daysSince(row.sent_at, now);
  if (row.status === "sent" && sentAge !== null && sentAge >= SENT_STALE_DAYS) {
    out.push(ask("sq.chase", "Other quotes waiting", `Which standard quotes were sent more than ${SENT_STALE_DAYS} days ago with no answer?`, `${ref} was sent ${sentAge} days ago.`, req));
  }
  const left = daysUntil(row.valid_until, now);
  if (row.status === "sent" && left !== null && left < 0) {
    out.push(ask("sq.expired", "Quotes past their date", "Which sent standard quotes are past their validity date?", `${ref} was valid until ${str(row.valid_until).slice(0, 10)}.`, req));
  }
  if (account) {
    out.push(ask("sq.account", `${account}'s other quotes`, `List the standard quotes of ${account}.`, "See what else was offered to the same company.", req));
  }
  return out;
}

export function productSuggestions(row: Row): Suggestion[] {
  const id = str(row.id), name = str(row.name), category = str(row.category);
  const req = { feature: "products", workcenter: "products" as WorkcenterKey };
  const out: Suggestion[] = [];
  if (!num(row.list_price)) out.push(nav("product.price", "Set a list price", ROUTES.product(id), "No list price is set, so it cannot be offered at a price.", req));
  if (!category) out.push(nav("product.category", "File it under a category", ROUTES.product(id), "Without a category it is hard to find in the catalog.", req));
  if (category) out.push(ask("product.same-category", `Others in ${category}`, `Which products are in the category ${category}?`, "Compare it with the rest of its category.", req));
  if (row.status === "inactive" && name) out.push(ask("product.inactive", "Other inactive products", "Which products are inactive?", `${name} is inactive.`, req));
  return out;
}

export function leadSuggestions(row: Row, now: Date): Suggestion[] {
  const accountId = idOf(row.account), account = named(row.account);
  const out: Suggestion[] = [];
  const age = daysSince(row.created_at, now);
  if (row.status === "new" && age !== null && age >= NEW_LEAD_DAYS) {
    out.push(nav("lead.pick-up", "Work the new leads", ROUTES.leads, `${str(row.title) || "This lead"} has been new for ${age} days.`, { feature: "leads", workcenter: "leads" }));
  }
  if (accountId) {
    if (row.status === "inspecting") out.push(nav("lead.quote", `Start a quote for ${account}`, withAccount(ROUTES.quotationNew, accountId), "The inspection is under way; the next step is a quote.", { feature: "quotations", workcenter: "quotations" }));
    out.push(nav("lead.account", `Open ${account || "the account"}`, ROUTES.account(accountId), "Their contacts, quotes and cases in one place.", { feature: "accounts", workcenter: "accounts" }));
    out.push(ask("lead.history", "What they bought before", `List the quotations of ${account}.`, "Past quotes show what they have asked for.", { feature: "quotations", workcenter: "quotations" }));
  }
  return out;
}

export function opportunitySuggestions(row: Row, now: Date): Suggestion[] {
  const id = str(row.id), title = str(row.title) || str(row.ref);
  const accountId = str(row.account_id), account = str(row.account_name);
  const req = { feature: "pipeline", workcenter: "pipeline" as WorkcenterKey };
  const out: Suggestion[] = [];
  if (open(row.outcome)) {
    const late = daysSince(row.expected_close, now);
    if (late !== null && late > 0) out.push(nav("opp.close-date", "Update the close date", ROUTES.pipelineDetail(id), `The expected close was ${plural(late, "day")} ago.`, req));
    if (!num(row.amount)) out.push(nav("opp.amount", "Add an amount", ROUTES.pipelineDetail(id), "Without an amount it does not count in the pipeline value.", req));
    const idle = daysSince(row.updated_at, now);
    if (idle !== null && idle >= OPP_STALE_DAYS && account) {
      out.push(ask("opp.stale", `${account}'s quotations`, `List the quotations of ${account}.`, `${title} has not changed for ${idle} days.`, { feature: "quotations", workcenter: "quotations" }));
    }
    if (accountId) out.push(nav("opp.quote", "Start a quotation", withAccount(ROUTES.quotationNew, accountId), "A quotation is the usual next step on an open deal.", { feature: "quotations", workcenter: "quotations" }));
  }
  return out;
}

export function estimateSuggestions(row: Row, now: Date): Suggestion[] {
  const id = str(row.id), account = named(row.account);
  const req = { feature: "estimator", workcenter: "estimates" as WorkcenterKey };
  const out: Suggestion[] = [];
  const age = daysSince(row.created_at, now);
  if (row.status === "draft" && age !== null && age >= DRAFT_STALE_DAYS) out.push(nav("est.continue", "Continue the estimate", ROUTES.estimate(id), `It has been a draft for ${age} days.`, req));
  if (!num(row.quoted_total)) out.push(nav("est.price", "Review the price", ROUTES.estimate(id), "No price is quoted to the customer yet.", req));
  if (account) out.push(ask("est.account", `${account}'s estimates`, `List the estimates of ${account}.`, "See what else was estimated for the same company.", req));
  return out;
}

/** One entry point for the server: the rule set of an object type, de-duplicated, in priority order. Types without rules give nothing. The cap of three is applied after the access filter, so a hidden suggestion never leaves a gap. */
export function suggestionsFor(type: AssistantObjectType, row: Row, related: Related, now: Date): Suggestion[] {
  let list: Suggestion[] = [];
  switch (type) {
    case "account": list = accountSuggestions(row, related, now); break;
    case "contact": list = contactSuggestions(row); break;
    case "quote": list = quoteSuggestions(row, related, now); break;
    case "standard_quote": list = standardQuoteSuggestions(row, now); break;
    case "product": list = productSuggestions(row); break;
    case "lead": list = leadSuggestions(row, now); break;
    case "opportunity": list = opportunitySuggestions(row, now); break;
    case "estimate": list = estimateSuggestions(row, now); break;
    default: list = [];
  }
  const seen = new Set<string>();
  return list.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
}

// ── With no record in front of the person: their own open work ─────────────────────────────────────────────

export type OwnWork = {
  /** The person's own quotes still in draft after DRAFT_STALE_DAYS (ref + id). */
  staleDrafts?: { id: string; ref: string }[];
  /** Leads Ready for sales and assigned to them. */
  readyLeads?: number;
  /** ABM next steps that are theirs and past their date. */
  overdueSteps?: number;
};

export function ownWorkSuggestions(w: OwnWork): Suggestion[] {
  const out: Suggestion[] = [];
  const drafts = w.staleDrafts ?? [];
  if (drafts.length === 1) {
    out.push(nav("own.draft", `Finish ${drafts[0].ref}`, ROUTES.quotationEdit(drafts[0].id), `A draft of yours for more than ${DRAFT_STALE_DAYS} days.`, { feature: "quotations", workcenter: "quotations" }));
  } else if (drafts.length > 1) {
    out.push(nav("own.drafts", `Finish ${drafts.length} draft quotes`, ROUTES.quotations, `Drafts of yours for more than ${DRAFT_STALE_DAYS} days: ${drafts.slice(0, 3).map((d) => d.ref).join(", ")}${drafts.length > 3 ? " and more" : ""}.`, { feature: "quotations", workcenter: "quotations" }));
  }
  if ((w.readyLeads ?? 0) > 0) {
    out.push(nav("own.leads", `Pick up ${plural(w.readyLeads!, "lead")}`, ROUTES.marketingLeads, "Ready for sales and assigned to you.", { feature: "marketing_scoring", workcenter: "leads" }));
  }
  if ((w.overdueSteps ?? 0) > 0) {
    out.push(nav("own.steps", `Follow up ${plural(w.overdueSteps!, "overdue step")}`, ROUTES.marketingAbm, "Next steps of yours in an ABM program that are past their date.", { feature: "abm", workcenter: "abm" }));
  }
  return out;
}

/** Drops a suggestion whose target or question needs a module the workspace lacks or a workcenter the person cannot view. */
export function filterByAccess(
  list: readonly Suggestion[],
  access: { features: Record<string, boolean | undefined>; canView: (wc: WorkcenterKey) => boolean },
): Suggestion[] {
  return list
    .filter((s) => (!s.requires?.feature || access.features[s.requires.feature] === true) && (!s.requires?.workcenter || access.canView(s.requires.workcenter)))
    .slice(0, MAX_SUGGESTIONS);
}
