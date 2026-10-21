import type { D365Product } from "@/lib/connectors/d365/types";
import { includeContract, offeredTargets, resolveTarget } from "./contract";
import { PRODUCT_SHORT } from "./links";
import {
  ESTIMATE_PARTS, FENCE_PARTS, INCLUDE_KEYS, INCLUDE_LABEL, TARGET_KINDS, TARGET_LABEL,
  type DocumentConfig, type EstimateSelection, type FenceSelection, type IncludeKey, type IncludeSelection, type IntegrationMiddlewareConfig,
  type OutcomeRule, type RuleMode, type StoredMiddlewareConfig, type TargetKind,
} from "./types";

// The Quote document (spec section 6): ONE outbound document replaces the
// separate rules + fence + estimate options. Stored at
// tenants.config.integration_middleware.documents.quote. A workspace that has
// not saved the document yet is read through the older shape (rules + fence +
// estimate), and every write keeps that older shape in step, so the older
// /api/middleware/rules route reads and writes the same data.
//
// Round 2 (spec section 9): a quote goes to the ERP ONLY when it is awarded; a rejected quote never leaves
// BPMSquare. So the document the screen reads has no per-outcome ticks and no automatic / manual choice:
// `enabled`, `target`, `include` and (for a Dynamics Quote or Order) the fallback price list. The older
// `when` / `mode` keys are still READ from a stored document (compat) and the older /rules route still works
// on them; the first save of the new panel settles them (awarded on, automatic, rejected off).
//
// Pure: nothing here touches a database.

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export const DEFAULT_INCLUDE: IncludeSelection = {
  lines: true, summary: true, drawing_link: false, notes_terms: false, security_profile: false,
  // bom and wbs are on by default but only ever apply to a Project target; costs are internal and OFF.
  bom: true, wbs: true, internal_costs: false,
};

export const DEFAULT_DOCUMENT: DocumentConfig = {
  enabled: true, when: { awarded: true, rejected: true }, mode: "auto", target: null, include: { ...DEFAULT_INCLUDE }, confirmed_at: null,
};

const DEFAULT_FENCE: FenceSelection = { summary: true, quantity_lines: true, security_profile: false, drawing_link: false, notes_terms: false };
const DEFAULT_ESTIMATE: EstimateSelection = { summary: true, quote_lines: true, bom: true, wbs: true, internal_costs: false };

// ── include <-> the older fence / estimate selections ───────────────────────

export function fenceFromInclude(i: IncludeSelection): FenceSelection {
  return { summary: i.summary, quantity_lines: i.lines, security_profile: i.security_profile, drawing_link: i.drawing_link, notes_terms: i.notes_terms };
}

export function estimateFromInclude(i: IncludeSelection): EstimateSelection {
  return { summary: i.summary, quote_lines: i.lines, bom: i.bom, wbs: i.wbs, internal_costs: i.internal_costs };
}

/** Two older options feed one new item (summary, lines). When they agree that is the answer; when an
 *  older call changed only one of them, that change wins over what the document held. */
const pick = (prev: boolean, fence: boolean, estimate: boolean): boolean => (fence === estimate ? fence : fence !== prev ? fence : estimate);

export function includeFromLegacy(fence: FenceSelection, estimate: EstimateSelection, prev: IncludeSelection = DEFAULT_INCLUDE): IncludeSelection {
  return {
    lines: pick(prev.lines, fence.quantity_lines, estimate.quote_lines),
    summary: pick(prev.summary, fence.summary, estimate.summary),
    drawing_link: fence.drawing_link,
    notes_terms: fence.notes_terms,
    security_profile: fence.security_profile,
    bom: estimate.bom,
    wbs: estimate.wbs,
    internal_costs: estimate.internal_costs,
  };
}

// ── reading ─────────────────────────────────────────────────────────────────

function parseRule(raw: unknown, def: OutcomeRule): OutcomeRule {
  if (!isObj(raw)) return { ...def };
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : def.enabled,
    mode: raw.mode === "manual" || raw.mode === "auto" ? raw.mode : def.mode,
  };
}

function parseTarget(v: unknown): TargetKind | null {
  return (TARGET_KINDS as readonly unknown[]).includes(v) ? (v as TargetKind) : null;
}

/** The document as stored; anything missing or malformed falls back to the default. Never throws. */
export function parseDocument(raw: unknown): DocumentConfig {
  const r = isObj(raw) ? raw : {};
  const when = isObj(r.when) ? r.when : {};
  const inc = isObj(r.include) ? r.include : {};
  const include = { ...DEFAULT_INCLUDE };
  for (const k of INCLUDE_KEYS) if (typeof inc[k] === "boolean") include[k] = inc[k] as boolean;
  const mode: RuleMode = r.mode === "manual" ? "manual" : "auto";
  const modeRejected: RuleMode | undefined = r.mode_rejected === "manual" || r.mode_rejected === "auto" ? r.mode_rejected : undefined;
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : true,
    when: { awarded: typeof when.awarded === "boolean" ? when.awarded : true, rejected: typeof when.rejected === "boolean" ? when.rejected : true },
    mode,
    ...(modeRejected && modeRejected !== mode ? { mode_rejected: modeRejected } : {}),
    target: parseTarget(r.target),
    include,
    confirmed_at: typeof r.confirmed_at === "string" && !Number.isNaN(Date.parse(r.confirmed_at)) ? r.confirmed_at : null,
  };
}

/** The older rules + fence + estimate shape, as a document (what a workspace that never saved the new panel holds). */
function documentFromLegacyKeys(r: Record<string, unknown>): DocumentConfig {
  const rules = isObj(r.rules) ? r.rules : {};
  const fenceRaw = isObj(r.fence) ? r.fence : {};
  const estRaw = isObj(r.estimate) ? r.estimate : {};
  const fence = { ...DEFAULT_FENCE };
  for (const p of FENCE_PARTS) if (typeof fenceRaw[p] === "boolean") fence[p] = fenceRaw[p] as boolean;
  const estimate = { ...DEFAULT_ESTIMATE };
  for (const p of ESTIMATE_PARTS) if (typeof estRaw[p] === "boolean") estimate[p] = estRaw[p] as boolean;
  const aw = parseRule(rules.quote_awarded, { enabled: true, mode: "auto" });
  const rj = parseRule(rules.quote_rejected, { enabled: true, mode: "auto" });
  return legacyToDocument({ rules: { quote_awarded: aw, quote_rejected: rj }, fence, estimate, payload_capture: false }, DEFAULT_DOCUMENT);
}

/** The document in force for a workspace: the saved one, else the older shape read as one. */
export function readDocument(stored: unknown): DocumentConfig {
  const r = isObj(stored) ? stored : {};
  const docs = isObj(r.documents) ? r.documents : null;
  if (docs && isObj(docs.quote)) return parseDocument(docs.quote);
  return documentFromLegacyKeys(r);
}

// ── the older shape, as a view of the document ──────────────────────────────

export function rulesFromDocument(d: DocumentConfig): IntegrationMiddlewareConfig["rules"] {
  return {
    quote_awarded: { enabled: d.enabled && d.when.awarded, mode: d.mode },
    quote_rejected: { enabled: d.enabled && d.when.rejected, mode: d.mode_rejected ?? d.mode },
  };
}

/** A set of older rules / fence / estimate options, written back into the document. Target and
 *  confirmation are not part of the older shape and are kept. */
export function legacyToDocument(l: IntegrationMiddlewareConfig, prev: DocumentConfig): DocumentConfig {
  const a = l.rules.quote_awarded;
  const r = l.rules.quote_rejected;
  const enabled = a.enabled || r.enabled;
  return {
    enabled,
    when: enabled ? { awarded: a.enabled, rejected: r.enabled } : prev.when,
    mode: a.mode,
    ...(r.mode !== a.mode ? { mode_rejected: r.mode } : {}),
    target: prev.target,
    include: includeFromLegacy(l.fence, l.estimate, prev.include),
    confirmed_at: prev.confirmed_at,
  };
}

/** What to store at tenants.config.integration_middleware: the document, and the older keys in step with it. */
export function storeDocument(existing: unknown, doc: DocumentConfig, payloadCapture?: boolean): StoredMiddlewareConfig {
  const base = (isObj(existing) ? existing : {}) as StoredMiddlewareConfig;
  const docs = isObj(base.documents) ? base.documents : {};
  return {
    ...base,
    rules: rulesFromDocument(doc),
    fence: fenceFromInclude(doc.include),
    estimate: estimateFromInclude(doc.include),
    payload_capture: payloadCapture ?? base.payload_capture === true,
    documents: { ...docs, quote: doc },
  };
}

// ── targets ─────────────────────────────────────────────────────────────────

export type TargetOption = { key: TargetKind; label: string; available: boolean; hint: string | null; verified: boolean };

export const NEEDS_ENTITY_SET = "Needs the entity set in Mapping";
export const NEEDS_ERP = "Connect an ERP first";

/** What the connected product can create for a Standard Quote. A Sales Order on Finance and Operations or
 *  Business Central is preset-only: it is not verified live and stays unavailable until the entity set is set. */
export function targetOptions(a: { product: D365Product | null; projectEntitySet: string | null; salesOrderEntitySet: string | null }): TargetOption[] {
  return offeredTargets(a.product).map((key): TargetOption => {
    const label = TARGET_LABEL[key];
    if (!a.product) return { key, label, available: false, hint: NEEDS_ERP, verified: false };
    if (a.product === "dataverse") return { key, label, available: true, hint: null, verified: true };
    if (key === "project") {
      const ok = !!a.projectEntitySet;
      return { key, label, available: ok, hint: ok ? null : NEEDS_ENTITY_SET, verified: true };
    }
    const ok = !!a.salesOrderEntitySet;
    return { key, label, available: ok, hint: ok ? null : NEEDS_ENTITY_SET, verified: false };
  });
}

// ── the view the screen reads ───────────────────────────────────────────────

export type DocumentView = {
  key: "quote";
  label: "Quote";
  source: "standard_quote";
  enabled: boolean;
  summary: string;
  target: { key: TargetKind; label: string };
  targets: { key: TargetKind; label: string; available: boolean; hint: string | null; verified: boolean }[];
  include: { key: IncludeKey; label: string; on: boolean; allowed: boolean; hint: string | null }[];
  /** The Dynamics price list used when the customer has none of their own; null = none set. */
  fallbackPriceListId: string | null;
  /** Only a Dynamics Quote or Sales Order needs a price list, so only then does the screen show the fallback. */
  showFallbackPriceList: boolean;
  /** The panel has been saved once; the set-up tick waits for this. */
  confirmed: boolean;
  confirmedAt: string | null;
  /** The same instant, under the spec's name (section 6). */
  confirmed_at: string | null;
};

export function documentSummary(_d: DocumentConfig, product: D365Product | null, target: TargetKind): string {
  const words = "Awarded";
  const dest = product ? `${PRODUCT_SHORT[product]} ${TARGET_LABEL[target]}` : `${TARGET_LABEL[target]} (no ERP connected yet)`;
  return `${words} → ${dest}`;
}

export function documentView(d: DocumentConfig, a: { product: D365Product | null; projectEntitySet: string | null; salesOrderEntitySet: string | null; fallbackPriceListId?: string | null }): DocumentView {
  const target = resolveTarget(a.product, d.target);
  const contract = includeContract(target);
  return {
    key: "quote", label: "Quote", source: "standard_quote",
    enabled: d.enabled,
    summary: documentSummary(d, a.product, target),
    target: { key: target, label: TARGET_LABEL[target] },
    targets: targetOptions(a),
    include: INCLUDE_KEYS.map((key) => ({ key, label: INCLUDE_LABEL[key], on: d.include[key] && contract[key].allowed, allowed: contract[key].allowed, hint: contract[key].hint })),
    fallbackPriceListId: a.fallbackPriceListId ?? null,
    showFallbackPriceList: a.product === "dataverse" && (target === "quote" || target === "sales_order"),
    confirmed: d.confirmed_at !== null,
    confirmedAt: d.confirmed_at,
    confirmed_at: d.confirmed_at,
  };
}

// ── saving ──────────────────────────────────────────────────────────────────

export type DocumentPatch = {
  enabled?: boolean;
  target?: TargetKind;
  include?: Partial<IncludeSelection>;
  /** A GUID, or null to clear. Stored on the connection (it is a Dynamics id), not on the document. */
  fallbackPriceListId?: string | null;
};

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type FieldError = { field: string; message: string };

/** Strict check of a submitted change: unknown keys and wrong types are rejected, not dropped, and so is
 *  a target the system cannot create or an item the chosen target cannot carry. */
export function validateDocumentPatch(raw: unknown, ctx: { product: D365Product | null; targets: TargetOption[]; current: DocumentConfig }): { ok: true; value: DocumentPatch } | { ok: false; errors: FieldError[] } {
  const errors: FieldError[] = [];
  if (!isObj(raw)) return { ok: false, errors: [{ field: "body", message: "Send the document as an object." }] };
  const out: DocumentPatch = {};
  for (const k of Object.keys(raw)) if (!["enabled", "target", "include", "fallbackPriceListId"].includes(k)) errors.push({ field: k, message: "Unknown setting." });

  if (raw.enabled !== undefined) { if (typeof raw.enabled === "boolean") out.enabled = raw.enabled; else errors.push({ field: "enabled", message: "On or off." }); }
  if (raw.fallbackPriceListId !== undefined) {
    if (raw.fallbackPriceListId === null || raw.fallbackPriceListId === "") out.fallbackPriceListId = null;
    else if (typeof raw.fallbackPriceListId === "string" && GUID_RE.test(raw.fallbackPriceListId.trim())) out.fallbackPriceListId = raw.fallbackPriceListId.trim();
    else errors.push({ field: "fallbackPriceListId", message: "Choose the price list from the list." });
  }
  let target = resolveTarget(ctx.product, ctx.current.target);
  if (raw.target !== undefined) {
    const t = parseTarget(raw.target);
    const opt = t ? ctx.targets.find((x) => x.key === t) : undefined;
    if (!t) errors.push({ field: "target", message: "Choose what to create in the ERP." });
    else if (!opt) errors.push({ field: "target", message: `${ctx.product ? PRODUCT_SHORT[ctx.product] : "That system"} cannot create a ${TARGET_LABEL[t]}.` });
    else if (!opt.available) errors.push({ field: "target", message: `${opt.label}: ${opt.hint ?? "not available yet"}.` });
    else { out.target = t; target = t; }
  }
  if (raw.include !== undefined) {
    if (!isObj(raw.include)) errors.push({ field: "include", message: "Send the list as ticks." });
    else {
      const contract = includeContract(target);
      out.include = {};
      for (const [k, v] of Object.entries(raw.include)) {
        if (!(INCLUDE_KEYS as readonly string[]).includes(k)) { errors.push({ field: `include.${k}`, message: "Unknown item." }); continue; }
        if (typeof v !== "boolean") { errors.push({ field: `include.${k}`, message: "Ticked or not." }); continue; }
        const key = k as IncludeKey;
        if (v && !contract[key].allowed) { errors.push({ field: `include.${k}`, message: `${INCLUDE_LABEL[key]}: ${contract[key].hint ?? "not available here"} (a ${TARGET_LABEL[target]}).` }); continue; }
        out.include[key] = v;
      }
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}

export function mergeDocument(cur: DocumentConfig, p: DocumentPatch, now: Date = new Date()): DocumentConfig {
  const next: DocumentConfig = {
    ...cur,
    enabled: p.enabled ?? cur.enabled,
    // The new panel is authoritative: a quote is sent when awarded, automatically, and never when rejected.
    when: { awarded: true, rejected: false },
    mode: "auto",
    target: p.target ?? cur.target,
    include: { ...cur.include, ...(p.include ?? {}) },
    // The first successful save of the panel confirms it.
    confirmed_at: cur.confirmed_at ?? now.toISOString(),
  };
  delete next.mode_rejected;
  return next;
}
