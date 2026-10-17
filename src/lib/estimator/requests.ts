// Request parsing for the estimate and template routes: pure, no I/O, so the
// validation rules (which fields a body may set, ranges, list paging) are unit
// tested without a database. Every foreign id that survives parsing (account,
// contact, template, product) is still VERIFIED against the tenant by the
// route before use -- parsing only guarantees it is a well-formed uuid.

import type { EstimateStatus } from "@/lib/types";
import { parseLineEdit } from "./overrides";
import { groupSlug } from "./types";
import type { EstimateComponent } from "./types";

export const ESTIMATE_STATUSES: readonly EstimateStatus[] = ["draft", "quoted", "won", "lost"];
/** Statuses a person may set by hand: "quoted" belongs to the quote conversion. */
export const SETTABLE_STATUSES: readonly EstimateStatus[] = ["draft", "won", "lost"];

export const MAX_NAME = 200;
export const MAX_NOTES = 5000;
export const MAX_MARGIN_PCT = 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Only `cf_` keys may arrive through custom_data (tenant custom fields). */
export function cfOnly(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter(([k]) => k.startsWith("cf_")));
}

export function parseMargin(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > MAX_MARGIN_PCT) return null;
  return Math.round(n * 100) / 100;
}

type Fail = { ok: false; error: string };

function optId(body: Record<string, unknown>, key: string): string | null | Fail {
  if (!(key in body) || body[key] === null || body[key] === "") return null;
  return isUuid(body[key]) ? (body[key] as string) : { ok: false, error: `${key} must be an id.` };
}

const isFail = (v: unknown): v is Fail => typeof v === "object" && v !== null && (v as Fail).ok === false;

export type EstimateCreate = {
  name: string;
  account_id: string | null;
  contact_id: string | null;
  template_id: string;
  params: Record<string, unknown>;
  margin_pct: number;
  notes: string | null;
  custom_data: Record<string, unknown>;
};

export function parseEstimateCreate(body: unknown): { ok: true; value: EstimateCreate } | Fail {
  if (!isRecord(body)) return { ok: false, error: "A JSON body is required." };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return { ok: false, error: "Name is required." };
  if (name.length > MAX_NAME) return { ok: false, error: `Name can be at most ${MAX_NAME} characters.` };
  if (!isUuid(body.template_id)) return { ok: false, error: "Choose a template (template_id)." };
  const account = optId(body, "account_id");
  if (isFail(account)) return account;
  const contact = optId(body, "contact_id");
  if (isFail(contact)) return contact;
  if (body.params !== undefined && body.params !== null && !isRecord(body.params)) return { ok: false, error: "params must be an object of input values." };
  let margin = 0;
  if (body.margin_pct !== undefined && body.margin_pct !== null && body.margin_pct !== "") {
    const m = parseMargin(body.margin_pct);
    if (m === null) return { ok: false, error: `Margin must be between 0 and ${MAX_MARGIN_PCT} percent.` };
    margin = m;
  }
  const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, MAX_NOTES) : null;
  return {
    ok: true,
    value: {
      name, account_id: account, contact_id: contact, template_id: body.template_id,
      params: isRecord(body.params) ? body.params : {}, margin_pct: margin, notes, custom_data: cfOnly(body.custom_data),
    },
  };
}

export type EstimatePatch = {
  /** Columns to write (allow-listed). */
  patch: Record<string, unknown>;
  /** Foreign ids the route must verify against the tenant before writing. */
  verify: { account_id?: string; contact_id?: string };
  /** New input values, when the body carries them. */
  params?: Record<string, unknown>;
  /** custom_data keys to merge (cf_ only). */
  custom_data?: Record<string, unknown>;
  /** A change that makes the stored lines stale. */
  recompute: boolean;
};

export function parseEstimatePatch(body: unknown): ({ ok: true } & EstimatePatch) | Fail {
  if (!isRecord(body)) return { ok: false, error: "A JSON body is required." };
  const patch: Record<string, unknown> = {};
  const verify: EstimatePatch["verify"] = {};
  let recompute = false;

  if ("name" in body) {
    const n = typeof body.name === "string" ? body.name.trim() : "";
    if (!n) return { ok: false, error: "Name can't be empty." };
    if (n.length > MAX_NAME) return { ok: false, error: `Name can be at most ${MAX_NAME} characters.` };
    patch.name = n;
  }
  for (const key of ["account_id", "contact_id"] as const) {
    if (!(key in body)) continue;
    const id = optId(body, key);
    if (isFail(id)) return id;
    patch[key] = id;
    if (id) verify[key] = id;
  }
  if ("notes" in body) patch.notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, MAX_NOTES) : null;
  if ("margin_pct" in body) {
    const m = parseMargin(body.margin_pct);
    if (m === null) return { ok: false, error: `Margin must be between 0 and ${MAX_MARGIN_PCT} percent.` };
    patch.margin_pct = m;
    recompute = true;
  }
  if ("status" in body) {
    if (!(SETTABLE_STATUSES as readonly unknown[]).includes(body.status)) {
      return { ok: false, error: `Status can be set to ${SETTABLE_STATUSES.join(", ")}; "quoted" is set when the quote is created.` };
    }
    patch.status = body.status;
  }
  let params: Record<string, unknown> | undefined;
  if ("params" in body) {
    if (!isRecord(body.params)) return { ok: false, error: "params must be an object of input values." };
    params = body.params;
    recompute = true;
  }
  let custom: Record<string, unknown> | undefined;
  if ("custom_data" in body) {
    custom = cfOnly(body.custom_data);
  }
  if (Object.keys(patch).length === 0 && !params && !custom) return { ok: false, error: "Nothing to update." };
  return { ok: true, patch, verify, params, custom_data: custom, recompute };
}

// ── Lists ────────────────────────────────────────────────────────────────────

export const ESTIMATE_SORTS = ["ref", "name", "status", "created_at", "updated_at", "margin_pct"] as const;
export type EstimateSort = (typeof ESTIMATE_SORTS)[number];
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

export type ListParams = {
  q: string;
  status: EstimateStatus | null;
  account_id: string | null;
  template_id: string | null;
  sort: EstimateSort;
  dir: "asc" | "desc";
  page: number;
  page_size: number;
};

/** Strip what would break a PostgREST `or=(...)` filter (commas, parentheses,
 *  the LIKE wildcards) -- the search term never reaches raw SQL, but its
 *  characters are part of the filter grammar. */
export function sanitizeSearch(raw: string): string {
  return raw.replace(/[,()%*_\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

export function parseListParams(sp: URLSearchParams): ListParams {
  const status = sp.get("status");
  const sort = sp.get("sort");
  const page = Number.parseInt(sp.get("page") ?? "1", 10);
  const size = Number.parseInt(sp.get("page_size") ?? String(DEFAULT_PAGE_SIZE), 10);
  const account = sp.get("account_id");
  const template = sp.get("template_id");
  return {
    q: sanitizeSearch(sp.get("q") ?? ""),
    status: (ESTIMATE_STATUSES as readonly string[]).includes(status ?? "") ? (status as EstimateStatus) : null,
    account_id: isUuid(account) ? account : null,
    template_id: isUuid(template) ? template : null,
    sort: (ESTIMATE_SORTS as readonly string[]).includes(sort ?? "") ? (sort as EstimateSort) : "created_at",
    dir: sp.get("dir") === "asc" ? "asc" : "desc",
    page: Number.isFinite(page) && page > 0 ? page : 1,
    page_size: Number.isFinite(size) && size > 0 ? Math.min(size, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE,
  };
}

// ── Manual lines ─────────────────────────────────────────────────────────────

export type ManualLineCreate = {
  description: string;
  group: string;
  uom: string | null;
  qty: number;
  waste_pct: number;
  unit_cost: number | null;
  component: EstimateComponent;
  product_id: string | null;
  wbs_code: string | null;
};

export const DEFAULT_MANUAL_GROUP = "Manual items";

/** A hand-added line: description is required; everything else has a default.
 *  `product_id` is a well-formed uuid only -- the route verifies it. */
export function parseManualLine(body: unknown): { ok: true; value: ManualLineCreate } | Fail {
  if (!isRecord(body)) return { ok: false, error: "A JSON body is required." };
  if (typeof body.description !== "string" || !body.description.trim()) return { ok: false, error: "Description is required." };
  const edit = parseLineEdit({ ...body, qty: body.qty ?? 1 });
  if (!edit.ok) return edit;
  let group = DEFAULT_MANUAL_GROUP;
  if (body.group !== undefined && body.group !== null && body.group !== "") {
    if (typeof body.group !== "string" || !body.group.trim() || body.group.trim().length > 80 || groupSlug(body.group) === "") {
      return { ok: false, error: "Group must be a name of up to 80 characters with at least one letter or digit." };
    }
    group = body.group.trim();
  }
  const product = optId(body, "product_id");
  if (isFail(product)) return product;
  return {
    ok: true,
    value: {
      description: edit.edit.description ?? body.description.trim().slice(0, 200),
      group,
      uom: edit.edit.uom ?? null,
      qty: edit.edit.qty ?? 1,
      waste_pct: edit.edit.waste_pct ?? 0,
      unit_cost: edit.edit.unit_cost ?? null,
      component: edit.edit.component ?? "other",
      product_id: product,
      wbs_code: edit.edit.wbs_code ?? null,
    },
  };
}

// ── Templates ────────────────────────────────────────────────────────────────

export const MAX_TEMPLATE_NAME = 120;

export type TemplateHeader = {
  name?: string;
  description?: string | null;
  trade?: string | null;
  is_active?: boolean;
  quote_granularity?: "group" | "line";
  geometry?: string | null;
};

/** The header fields of a template body (everything except inputs/rates/rules,
 *  which validateTemplate owns). Returns only the keys present. */
export function parseTemplateHeader(body: unknown, opts: { requireName: boolean }): { ok: true; header: TemplateHeader } | Fail {
  if (!isRecord(body)) return { ok: false, error: "A JSON body is required." };
  const header: TemplateHeader = {};
  if ("name" in body || opts.requireName) {
    const n = typeof body.name === "string" ? body.name.trim() : "";
    if (!n) return { ok: false, error: "Template name is required." };
    if (n.length > MAX_TEMPLATE_NAME) return { ok: false, error: `Template name can be at most ${MAX_TEMPLATE_NAME} characters.` };
    header.name = n;
  }
  if ("description" in body) header.description = typeof body.description === "string" && body.description.trim() ? body.description.trim().slice(0, 2000) : null;
  if ("trade" in body) header.trade = typeof body.trade === "string" && body.trade.trim() ? body.trade.trim().slice(0, 60) : null;
  if ("is_active" in body) {
    if (typeof body.is_active !== "boolean") return { ok: false, error: "is_active must be true or false." };
    header.is_active = body.is_active;
  }
  if ("quote_granularity" in body) {
    if (body.quote_granularity !== "group" && body.quote_granularity !== "line") return { ok: false, error: 'quote_granularity must be "group" or "line".' };
    header.quote_granularity = body.quote_granularity;
  }
  if ("geometry" in body) header.geometry = typeof body.geometry === "string" && body.geometry.trim() ? body.geometry.trim() : null;
  return { ok: true, header };
}
