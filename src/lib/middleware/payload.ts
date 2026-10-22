import type { OutLine } from "./fence";
import type { Outcome, TargetKind } from "./types";

// Pure builders for what is sent to the ERP. Only facts verified against the
// live Dynamics trial (2026-10-21, docs/design/integration-middleware.md) are
// used for Dataverse:
//  - a quote needs name, customerid_account@odata.bind, pricelevelid@odata.bind
//    and transactioncurrencyid@odata.bind;
//  - lines go in the same POST as `quote_details` (deep insert);
//  - a write-in line carries productdescription, isproductoverridden: true,
//    quantity and priceperunit and NEVER a uomid;
//  - awarded: activate (statecode 1 / statuscode 2), then WinQuote Status 4;
//    rejected: the same activate, then CloseQuote Status 5, both with a
//    QuoteClose subject.

export type Primitive = string | number | boolean | null;

/** The fields BPMSquare offers a quote header map ({placeholder}). */
export const QUOTE_PLACEHOLDERS = [
  "name", "ref", "title", "customer_name", "account_external_id", "description", "total", "subtotal", "valid_until", "outcome",
] as const;
/** ... a quote line map. */
export const LINE_PLACEHOLDERS = ["description", "qty", "rate", "net_rate", "uom", "amount", "discount_pct", "sl_no"] as const;
/** ... a project map. */
export const PROJECT_PLACEHOLDERS = ["name", "ref", "title", "customer_name", "account_external_id", "description", "summary", "total", "status", "outcome"] as const;

export type MapKind = "quote" | "quote_line" | "project" | "sales_order" | "sales_order_line";
export const PLACEHOLDERS: Record<MapKind, readonly string[]> = {
  quote: QUOTE_PLACEHOLDERS, quote_line: LINE_PLACEHOLDERS, project: PROJECT_PLACEHOLDERS,
  // A sales order takes the same fields as a quote; on F&O / Business Central it is a mapped entity like a project.
  sales_order: QUOTE_PLACEHOLDERS, sales_order_line: LINE_PLACEHOLDERS,
};

const FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]*(@odata\.bind)?$/;

/** Check a field map before it is stored: bad field names and placeholders
 *  BPMSquare does not offer are rejected, not dropped. */
export function validateOutboundMap(kind: MapKind, map: unknown): { ok: true; value: Record<string, string> } | { ok: false; errors: { field: string; message: string }[] } {
  const errors: { field: string; message: string }[] = [];
  const value: Record<string, string> = {};
  if (map === undefined || map === null) return { ok: true, value };
  if (typeof map !== "object" || Array.isArray(map)) return { ok: false, errors: [{ field: kind, message: "A field map is a list of field = template pairs." }] };
  const allowed = new Set(PLACEHOLDERS[kind]);
  for (const [field, tpl] of Object.entries(map as Record<string, unknown>)) {
    if (!FIELD_RE.test(field) || field.length > 120) { errors.push({ field, message: "That isn't a valid field name." }); continue; }
    if (typeof tpl !== "string" || !tpl.trim() || tpl.length > 300) { errors.push({ field, message: "Give the field a value or a {placeholder}." }); continue; }
    if ((kind === "quote_line" || kind === "sales_order_line") && /^uomid(@odata\.bind)?$/i.test(field)) { errors.push({ field, message: "A write-in line must not carry a unit of measure (Dynamics refuses it)." }); continue; }
    const bad = [...tpl.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]).filter((p) => !allowed.has(p));
    if (bad.length) { errors.push({ field, message: `Unknown placeholder ${bad.map((b) => `{${b}}`).join(", ")}. Choose from the list.` }); continue; }
    if (/\{[^{}]*$/.test(tpl) || /^[^{]*\}/.test(tpl)) { errors.push({ field, message: "A { } is not closed." }); continue; }
    value[field] = tpl.trim();
  }
  return errors.length ? { ok: false, errors } : { ok: true, value };
}

/** Fill a template. A template that is exactly one placeholder keeps the
 *  value's own type (a quantity stays a number); "true" and "false" become
 *  booleans; anything else is text. Returns null when a placeholder is empty
 *  so the caller leaves the field out. */
export function renderTyped(template: string, vars: Record<string, Primitive | undefined>): Primitive {
  const only = /^\{([a-z_]+)\}$/.exec(template.trim());
  if (only) {
    const v = vars[only[1]];
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) return null;
    return v;
  }
  if (template.trim() === "true") return true;
  if (template.trim() === "false") return false;
  let missing = false;
  const out = template.replace(/\{([a-z_]+)\}/g, (_m, k: string) => {
    const v = vars[k];
    if (v === undefined || v === null || String(v).trim() === "") { missing = true; return ""; }
    return String(v);
  });
  return missing ? null : out;
}

export function renderMap(map: Record<string, string>, vars: Record<string, Primitive | undefined>): Record<string, Primitive> {
  const out: Record<string, Primitive> = {};
  for (const [field, tpl] of Object.entries(map)) {
    if (!FIELD_RE.test(field)) continue;
    const v = renderTyped(tpl, vars);
    if (v !== null) out[field] = v;
  }
  return out;
}

const money = (n: number) => Math.round(Number(n) * 100) / 100;

/** What one quote line is worth per unit once its own discount is taken off. */
export function netRate(l: Pick<OutLine, "rate" | "discount_pct" | "qty" | "amount">): number {
  if (l.discount_pct > 0 && l.qty > 0) return money(l.amount / l.qty);
  return money(l.rate);
}

/** The line that ties an ERP document to the one BPMSquare quote it came from.
 *  Refs (SQ-0003) repeat between workspaces that share one ERP environment; the
 *  quote's own id does not, so a "find it again" matches on this and never on the ref alone. */
export function bpmMarker(docId: string): string {
  return `[bpmsquare:${docId}]`;
}

/** True when `text` carries exactly this document's marker, as a whole token. */
export function hasMarker(text: unknown, docId: string): boolean {
  return typeof text === "string" && text.split(/\s+/).includes(bpmMarker(docId));
}

/** `text` with the marker as its last line, trimmed to fit `max` characters without losing the marker. */
export function withMarker(text: string | null | undefined, docId: string, max = 2000): string {
  const marker = bpmMarker(docId);
  const room = Math.max(0, max - marker.length - 1);
  const body = (text ?? "").trimEnd().slice(0, room);
  return body ? `${body}\n${marker}` : marker;
}

export type QuoteForErp = {
  ref: string;
  /** The BPMSquare quote's id; written into the ERP document as a quiet marker. Absent for the test quote. */
  doc_id?: string | null;
  /** Short name of the work, without the ref. */
  title: string;
  customer_name: string;
  /** The ERP's own id of the customer (from connector_links). */
  account_external_id: string | null;
  description: string[];
  lines: OutLine[];
  subtotal: number;
  total: number;
  valid_until: string | null;
  outcome: Outcome;
  /** ISO code of the quote's currency; offered to the mapping engine as the `currency` field, never read by the older maps. */
  currency?: string | null;
};

export type Problem = { code: string; message: string; fix: string };

export type DataverseQuoteBuild = { body: Record<string, unknown>; problems: Problem[] };

/** The values a Dataverse quote or order header map reads ({placeholder}); also what the mapping engine offers as source fields. */
export function quoteHeaderVars(q: QuoteForErp): Record<string, Primitive> {
  return {
    name: `${q.ref} · ${q.title}`.slice(0, 300), ref: q.ref, title: q.title, customer_name: q.customer_name, account_external_id: q.account_external_id,
    description: q.description.join("\n").slice(0, 2000) || null,
    total: money(q.total), subtotal: money(q.subtotal), valid_until: q.valid_until, outcome: q.outcome, currency: q.currency ?? null,
  };
}

/** ... and one line's. */
export function quoteLineVars(l: OutLine): Record<string, Primitive> {
  return {
    description: l.description, qty: l.qty, rate: money(l.rate), net_rate: netRate(l), uom: l.uom, amount: money(l.amount),
    discount_pct: l.discount_pct, sl_no: l.sl_no,
  };
}

/** ... and a Project's (Finance and Operations, Business Central), or a sales order mapped like one. */
export function projectHeaderVars(q: QuoteForErp, status: string): Record<string, Primitive> {
  const summary = q.description[0] ?? "";
  return {
    name: `${q.ref} · ${q.title}`.slice(0, 200), ref: q.ref, title: q.title, customer_name: q.customer_name, account_external_id: q.account_external_id,
    description: q.doc_id ? withMarker(q.description.join("\n"), q.doc_id) : q.description.join("\n").slice(0, 2000) || null,
    summary: summary || null, total: money(q.total), status, outcome: q.outcome, currency: q.currency ?? null,
  };
}

/** What the mapping engine produced for a send: the header body and one body per line. */
export type PrebuiltBody = { header: Record<string, unknown>; lines: Record<string, unknown>[] };

/**
 * The Dataverse quote with its lines (deep insert). `maps` are the header and
 * line maps in force (preset or the tenant's own). The contract fields are
 * always set after the map runs, so a custom map cannot lose a required bind,
 * the BPMSquare ref prefix, or put a uomid on a write-in line.
 */
export function buildDataverseQuote(
  q: QuoteForErp,
  cfg: { price_list_id?: string | null; currency_id?: string | null },
  maps: { quote: Record<string, string>; quote_line: Record<string, string> },
  /** A sales order is built exactly like a quote (verified live 2026-10-21); only the line collection is named differently. */
  kind: "quote" | "sales_order" = "quote",
  /** A saved mapping document ran instead of the maps: its body is the starting point, and every contract step below still applies. */
  prebuilt?: PrebuiltBody | null,
): DataverseQuoteBuild {

  const problems: Problem[] = [];
  const title = `${q.ref} · ${q.title}`.slice(0, 300);
  const body: Record<string, unknown> = prebuilt ? { ...prebuilt.header } : renderMap(maps.quote, quoteHeaderVars(q));
  if (q.doc_id) body.description = withMarker(typeof body.description === "string" ? body.description : "", q.doc_id);
  // The ref stays visible in the ERP whatever the map says.
  const name = typeof body.name === "string" && body.name.trim() ? body.name : title;
  body.name = name.startsWith(q.ref) ? name : `${q.ref} · ${name}`.slice(0, 300);

  if (q.account_external_id) body["customerid_account@odata.bind"] = `/accounts(${q.account_external_id})`;
  else problems.push({ code: "customer_not_linked", message: "This customer is not in Dynamics yet.", fix: "Sync customers, then retry." });
  if (cfg.price_list_id) body["pricelevelid@odata.bind"] = `/pricelevels(${cfg.price_list_id})`;
  else problems.push({ code: "no_price_list", message: "This customer has no price list in Dynamics and no fallback is set", fix: "Set a fallback price list on the Quote link, or give the customer a price list in Dynamics, then retry." });
  if (cfg.currency_id) body["transactioncurrencyid@odata.bind"] = `/transactioncurrencies(${cfg.currency_id})`;
  else problems.push({ code: "no_currency", message: "No Dynamics currency matches this quote's currency, and the base currency could not be read.", fix: "Add the currency in Dynamics (or check the app user can read currencies), then retry." });

  if (!q.lines.length) problems.push({ code: "no_lines", message: "The quote has no lines to send.", fix: "Add at least one line to the quote." });
  body[kind === "quote" ? "quote_details" : "order_details"] = q.lines.map((l, i) => {
    const line = (prebuilt ? { ...(prebuilt.lines[i] ?? {}) } : renderMap(maps.quote_line, quoteLineVars(l))) as Record<string, unknown>;
    for (const k of Object.keys(line)) if (k.toLowerCase() === "uomid" || k.toLowerCase() === "uomid@odata.bind") delete line[k];
    if (line.productdescription === undefined) line.productdescription = l.description;
    if (line.quantity === undefined) line.quantity = l.qty;
    if (line.priceperunit === undefined) line.priceperunit = netRate(l);
    line.isproductoverridden = true;
    return line;
  });
  return { body, problems };
}

export const ACTIVATE_BODY = { statecode: 1, statuscode: 2 } as const;

export function closeSubject(ref: string, outcome: Outcome): string {
  return `${ref} ${outcome}`;
}

/** Body of the WinQuote (awarded) or CloseQuote (rejected) action. */
export function closeActionBody(quoteId: string, ref: string, outcome: Outcome): { action: "WinQuote" | "CloseQuote"; body: Record<string, unknown> } {
  return {
    action: outcome === "awarded" ? "WinQuote" : "CloseQuote",
    body: {
      QuoteClose: { subject: closeSubject(ref, outcome), "quoteid@odata.bind": `/quotes(${quoteId})` },
      Status: outcome === "awarded" ? 4 : 5,
    },
  };
}

export type ProjectBuild = { body: Record<string, Primitive>; problems: Problem[] };

/** The Project created in Finance & Operations or Business Central. The
 *  BPMSquare ref prefixes the name (the field every product shows). */
export function buildProjectBody(
  q: QuoteForErp,
  project: { entity_set: string; field_map: Record<string, string> },
  extra: { status: string; dataArea?: string | null; isFo: boolean; /** the mapped entity is a sales order, not a project */ noun?: "project" | "sales order" },
  /** A saved mapping document ran instead of the map: its header is the body. */
  prebuilt?: PrebuiltBody | null,
): ProjectBuild {
  const problems: Problem[] = [];
  const noun = extra.noun ?? "project";
  if (!project.entity_set) problems.push({ code: "no_project_target", message: `No ${noun} target is set for this product.`, fix: `Open Mapping and choose where ${noun}s go.` });
  const body = (prebuilt ? { ...prebuilt.header } : renderMap(project.field_map, projectHeaderVars(q, extra.status))) as Record<string, Primitive>;
  if (!Object.keys(body).length) problems.push({ code: "empty_project_map", message: `The ${noun} map produced nothing to send.`, fix: `Open Mapping and check the ${noun} fields.` });
  // F&O creates in the app user's default company unless told which.
  if (extra.isFo && extra.dataArea && !("dataAreaId" in project.field_map) && !("dataAreaId" in body) && /^[A-Za-z0-9]{1,8}$/.test(extra.dataArea)) body.dataAreaId = extra.dataArea.toLowerCase();
  return { body, problems };
}

// ── Plain-language failures ─────────────────────────────────────────────────

export type ErrorLike = { status?: number; message?: string; code?: string };

/** What happened and the one thing to do, for an error from the ERP or from
 *  our own steps. The raw message stays on the stored message for "Details". */
export function plainFailure(e: ErrorLike, step?: string, noun: "quote" | "order" | "project" = "quote"): { headline: string; fix: string } {
  const msg = (e.message ?? "").toLowerCase();
  const status = e.status ?? 0;
  const system = noun === "project" ? "The ERP" : "Dynamics";
  if (status === 401) return { headline: "Dynamics refused the login.", fix: "Open Connections, check the secret and press Test connection." };
  if (status === 403 || msg.includes("privilege") || msg.includes("principal user")) {
    return { headline: step === "create" ? `The connected app may not create ${noun}s.` : "The connected app has no permission for this step.", fix: `Give the app user a role that can create${noun === "quote" ? " and close" : ""} ${noun}s, then retry.` };
  }
  if (status === 409) return { headline: e.message?.trim() || "The ERP quote is already closed the other way.", fix: "Change it in the ERP if that is really wanted; BPMSquare will not reopen it." };
  if (status === 404 && step !== "create") return { headline: `The ${noun} is no longer in ${system}.`, fix: "Press Send again to create it afresh." };
  if (msg.includes("price") && msg.includes("list")) return { headline: "Dynamics needs a valid price list.", fix: "Pick a price list under Connections, then retry." };
  if (msg.includes("currency")) return { headline: "The currency does not match.", fix: "Pick the currency under Connections, then retry." };
  if (msg.includes("uom") || msg.includes("unit of measure")) return { headline: "Dynamics refused a unit of measure on a line.", fix: "Remove the unit from the line map, then retry." };
  if (status === 429) return { headline: "Dynamics asked us to slow down.", fix: "Retry in a few minutes." };
  if (status === 0 || status >= 500) return { headline: "Dynamics did not answer properly.", fix: "Retry in a few minutes. If it repeats, check the connection." };
  if (status === 400 || status === 422) return { headline: `Dynamics did not accept the ${noun}.`, fix: "Open Details, fix what it names, then retry." };
  return { headline: `The ${noun} could not be sent.`, fix: "Open Details, then retry." };
}

// ── Words first ─────────────────────────────────────────────────────────────

/** The preview a sales admin reads before the raw body: customer, lines, total. */
export function previewWords(a: { target: TargetKind; productLabel: string; ref: string; customer: string; lineCount: number; total: number; outcome: Outcome; steps: string[] }): string[] {
  const out: string[] = [];
  const lines = `with ${a.lineCount} line${a.lineCount === 1 ? "" : "s"}, total ${money(a.total)}`;
  if (a.target === "quote") out.push(`A quote called ${a.ref} for ${a.customer}, ${lines}.`);
  else if (a.target === "sales_order") out.push(`A sales order called ${a.ref} for ${a.customer}, ${lines}.`);
  else out.push(`A project called ${a.ref} for ${a.customer}.`);
  out.push(`It goes to ${a.productLabel}.`);
  for (const s of a.steps) out.push(s);
  return out;
}

export function stepsFor(product: "dataverse" | "fo" | "bc", outcome: Outcome, target: TargetKind = product === "dataverse" ? "quote" : "project"): string[] {
  if (target === "sales_order") return outcome === "awarded" ? ["The order is created and is Active straight away. Nothing else is sent."] : ["Nothing is sent: a rejected quote has no order."];
  if (target === "project") return outcome === "awarded" ? ["The project is created. Nothing else is sent."] : ["Nothing is sent: rejected quotes are not tracked in projects."];
  return outcome === "awarded" ? ["The quote is made Active, then marked Won."] : ["The quote is made Active, then closed as Lost."];
}
