import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logChange } from "@/lib/changeLog";
import { UOM_OPTIONS, type TenantConfig, type TenantFeatures } from "@/lib/constants";
import { entitySetFor, getErpMetadata } from "../metadataServer";
import { askStructuredMetered, aiConfigured, AiError, monthlyTokensUsed } from "@/lib/ai/structured";
import { resolveMonthlyBudget } from "@/lib/ai/usageCap";
import { usagePercent } from "@/lib/assistant/models";
import { previewWebhook } from "@/lib/webhooks/sender";
import { loadQuoteRecord, loadTenantInfo, listSamples } from "@/lib/webhooks/loaders";
import { SQL_BUNDLES } from "../types";
import { previewMappedQuote } from "../dispatch";
import { ALWAYS_HEADER, ALWAYS_LINES, isMappingDoc, quoteKinds, type MappingDocKey, type MappingView } from "../mappingDoc";
import { context, fieldLists, getMapping, KIND_ENTITY, metadataFetcher } from "../mappingOps";
import type { ErpField, MetadataEntity } from "../metadata";
import { directionOf, resolveConnection, type Connection } from "./connection";
import { validateConverter } from "./convert";
import { compile } from "./engine";
import { mapForWebhook } from "./engineServer";
import {
  detachWebhooks, getActive, getDraft, getVersion, listVersions, resetAll, saveActive, saveDraft, type MappingRow,
} from "./mappingStore";
import { AI_SURFACE, AI_SYSTEM, aiSchema, buildAiPrompt, normaliseAiAnswer } from "./proposeAi";
import { propose } from "./propose";
import { adapterSourceFields, leniencyFields, registryHash, webhookQuoteSourceFields, type DocBlocks } from "./sourceFields";
import { buildExtras, materialiseStandard, missingFor, diffRows, type Materialised } from "./view";
import { listAll, lookupOf } from "./valueListStore";
import { discoverSchema, SchemaFetchError, webhookHeaders, type DiscoverRequest } from "../schema/discover";
import { erpFieldToTarget } from "../schema/dataverse";
import { countFields, diffSchema } from "../schema/types";
import type {
  Confidence, EngineMappingExtras, MapRow, MappingDocument, MappingProblem, MappingTarget, RowOrigin, SourceObject, TargetField, ValueList,
} from "./types";

// The operations behind /api/middleware/mapping* (spec section 9, contract). Every function takes the guard's context, resolves the
// connection with the tenant, and answers `{ status, body }`; the route only turns that into a response. A missing table is
// `needsDatabaseUpdate`, never an error.

export type OpsCtx = { supabase: SupabaseClient; admin: SupabaseClient; tenantId: string; userId: string };
export type Out = { status: number; body: Record<string, unknown> };

const ok = (body: Record<string, unknown>): Out => ({ status: 200, body });
export const fail = (status: number, error: string, extra: Record<string, unknown> = {}): Out => ({ status, body: { error, ...extra } });
export const needsUpdate = (): Out => ok({ needsDatabaseUpdate: true, bundle: SQL_BUNDLES.mapping });

const SOURCE_OBJECT: Record<MappingDocKey, SourceObject> = { quote: "standard_quote", customers: "account", contacts: "contact", products: "product", projects: "project" };
const ORIGINS: RowOrigin[] = ["standard", "proposed", "ai", "user"];
const CONFIDENCE: Confidence[] = ["sure", "likely", "guess"];
const LINES_PATH = /^[A-Za-z_][A-Za-z0-9_]{0,60}$/;
const MAX_ROWS = 500;

// ── State of one document ────────────────────────────────────────────────────

type State = {
  conn: Connection;
  document: MappingDocKey;
  direction: "out" | "in";
  pending: boolean;
  active: MappingRow | null;
  draft: MappingRow | null;
  lists: ValueList[];
  blocks: DocBlocks;
  headerKind: "quote" | "sales_order" | "project";
  engineSets: { header: readonly string[]; lines: readonly string[] };
  /** Dynamics only: the view of today's presets, and the live field lists. */
  legacy: MappingView | null;
  live: MappingTarget | null;
  features: Partial<TenantFeatures>;
  config: Partial<TenantConfig>;
};

const NOT_CONNECTED = { connected: false } as const;

function toTargetFields(list: ErpField[]): TargetField[] {
  return list.map(erpFieldToTarget);
}

async function loadState(ctx: OpsCtx, conn: Connection, document: MappingDocKey, opts: { refresh?: boolean } = {}): Promise<State | "not_connected" | "bad_document"> {
  if (conn.kind === "webhook" && document !== "quote") return "bad_document";
  const { admin, tenantId } = ctx;
  const direction = directionOf(conn, document);
  const [act, dr, lists, t] = await Promise.all([
    getActive(admin, tenantId, conn.id, document), getDraft(admin, tenantId, conn.id, document), listAll(admin, tenantId, conn.id),
    admin.from("tenants").select("features, config").eq("id", tenantId).maybeSingle(),
  ]);
  const features = ((t.data as { features?: Partial<TenantFeatures> } | null)?.features ?? {}) as Partial<TenantFeatures>;
  const config = ((t.data as { config?: Partial<TenantConfig> } | null)?.config ?? {}) as Partial<TenantConfig>;
  const base = {
    conn, document, direction, pending: act.pending || dr.pending, active: act.pending ? null : act.value, draft: dr.pending ? null : dr.value,
    lists: lists.pending ? [] : lists.lists, features, config,
  };

  if (conn.kind === "webhook") {
    return { ...base, blocks: webhookQuoteSourceFields(conn.allowPersonalData), headerKind: "quote", engineSets: { header: [], lines: [] }, legacy: null, live: null };
  }
  if (conn.id !== "dynamics365") {
    return { ...base, blocks: adapterSourceFields(document, "quote"), headerKind: "quote", engineSets: { header: [], lines: [] }, legacy: null, live: null };
  }

  const c = await context(admin, tenantId);
  if (!c.loaded) return "not_connected";
  const cfg = c.loaded.cfg;
  const fetcher = opts.refresh
    ? async (entity: MetadataEntity): Promise<ErpField[]> => { const r = await getErpMetadata(tenantId, entity, { refresh: true }); return r.ok && r.applicable ? r.fields : []; }
    : metadataFetcher(tenantId);
  const legacy = await getMapping(admin, tenantId, document, fetcher);
  if ("connected" in legacy) return "not_connected";
  const lists2 = await fieldLists(cfg, document, c.target, fetcher);
  let headerKind: State["headerKind"] = "quote";
  let entity = "";
  let linesPath: string | null = null;
  if (document === "quote") {
    const k = quoteKinds(cfg.product, c.target);
    headerKind = k.header === "sales_order" ? "sales_order" : k.header === "project" ? "project" : "quote";
    entity = entitySetFor(cfg, KIND_ENTITY[k.header]) ?? "";
    linesPath = k.lines ? (k.header === "sales_order" ? "order_details" : "quote_details") : null;
  } else {
    entity = entitySetFor(cfg, document as MetadataEntity) ?? "";
  }
  const live: MappingTarget = {
    kind: "adapter", entity, linesPath,
    schema: { fetchedAt: new Date().toISOString(), sourceUrl: null, fields: toTargetFields(lists2.header), lineFields: toTargetFields(lists2.lines) },
  };
  return {
    ...base, blocks: adapterSourceFields(document, headerKind), headerKind,
    engineSets: document === "quote" && cfg.product === "dataverse" ? { header: ALWAYS_HEADER, lines: ALWAYS_LINES } : { header: [], lines: [] },
    legacy, live,
  };
}

const parseDoc = (v: unknown): MappingDocKey | null => (isMappingDoc(v) ? v : null);

/** The snapshot the tab and the next save work from: a newer fetched list (draft), else the saved one, else today's live list. */
function effectiveTarget(s: State): MappingTarget | null {
  return s.draft?.doc.target ?? s.active?.doc.target ?? s.live ?? null;
}

function standardRows(s: State): Materialised | null {
  return s.legacy ? materialiseStandard(s.legacy) : null;
}

function currentRows(s: State): { header: MapRow[]; lines: MapRow[] } {
  if (s.active) return { header: s.active.doc.header, lines: s.active.doc.lines };
  const std = standardRows(s);
  return std ? { header: std.header, lines: std.lines } : { header: [], lines: [] };
}

/** Known BPMSquare values per list kind, for naming the rows of a proposed list. */
export function knownValues(config: Partial<TenantConfig>): Partial<Record<string, string[]>> {
  const own = typeof (config as { currency?: string }).currency === "string" ? [(config as { currency: string }).currency] : [];
  return {
    unit: [...UOM_OPTIONS],
    currency: [...new Set([...own, "INR", "USD", "EUR", "GBP", "AED", "SAR", "QAR", "KWD", "BHD", "OMR", "SGD", "AUD", "CAD", "JPY", "CNY"])],
    status: ["draft", "sent", "accepted", "rejected"],
  };
}

const aiAvailable = (s: State) => s.features.ai_assistant === true && aiConfigured();

// ── GET ──────────────────────────────────────────────────────────────────────

export async function getView(ctx: OpsCtx, connRaw: unknown, docRaw: unknown): Promise<Out> {
  const document = parseDoc(docRaw);
  if (!document) return fail(422, "Choose quote, customers, contacts, products or projects.");
  const r = await resolveConnection(ctx.admin, ctx.tenantId, connRaw);
  if (!r.ok) return fail(r.status, r.error);
  const s = await loadState(ctx, r.conn, document);
  if (s === "not_connected") return ok({ ...NOT_CONNECTED });
  if (s === "bad_document") return fail(422, "A webhook mapping is for the Quote document.");
  return ok(await assembleView(ctx, s));
}

async function assembleView(ctx: OpsCtx, s: State): Promise<Record<string, unknown>> {
  const versions = s.pending ? [] : (await listVersions(ctx.admin, ctx.tenantId, s.conn.id, s.document)).map((v) => ({ version: v.version, at: v.at, by: v.by }));
  const target = effectiveTarget(s);
  const std = standardRows(s);
  const activeDoc = s.active?.doc ?? null;
  let rows = currentRows(s);

  // A webhook (no preset) with a fetched field list and no saved mapping starts from the proposal, shown unsaved.
  if (!activeDoc && !std && target) {
    const p = proposeBlocks(s, target, { header: [], lines: [] }, "fill");
    rows = { header: p.header.rows, lines: p.lines.rows };
  }
  const t: MappingTarget | null = target;
  const fields = t?.schema.fields ?? [];
  const lineFields = t?.schema.lineFields ?? [];
  const missing = activeDoc || !s.legacy
    ? [...missingFor(rows.header, fields, s.engineSets.header), ...missingFor(rows.lines, lineFields, s.engineSets.lines)]
    : s.legacy.missingRequired;
  const extras: EngineMappingExtras = buildExtras({
    doc: activeDoc && t ? { ...activeDoc, target: t } : activeDoc, version: s.active?.version ?? null, versions,
    usingStandard: !activeDoc && !!std, standard: !activeDoc ? { header: rows.header, lines: rows.lines, skipped: [] } : null, liveTarget: t,
    sourceFields: s.blocks, missingRequired: missing, lists: s.lists, ai: aiAvailable(s),
  });
  const base = s.legacy
    ? { ...s.legacy, usingStandard: s.legacy.usingStandard && !activeDoc }
    : { document: { key: s.document, label: "Quote", targetLabel: s.conn.label }, sections: [], erpFields: { header: [], lines: [] }, usingStandard: false, settings: null, connected: true };
  return { ...base, ...extras, missingRequired: missing, ...(s.pending ? { needsDatabaseUpdate: true, bundle: SQL_BUNDLES.mapping } : {}) };
}

// ── Rows from a request ──────────────────────────────────────────────────────

type RowsIn = { header: MapRow[]; lines: MapRow[] };
type Err = { rowId?: string; field?: string; message: string };

function sanitizeBlock(raw: unknown, direction: "out" | "in", label: string): { rows: MapRow[] } | { errors: Err[] } {
  if (!Array.isArray(raw)) return { errors: [{ message: `Send the ${label} rows as a list.` }] };
  if (raw.length > MAX_ROWS) return { errors: [{ message: `A mapping holds at most ${MAX_ROWS} rows per block.` }] };
  const errors: Err[] = [];
  const rows: MapRow[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || typeof r !== "object" || Array.isArray(r)) { errors.push({ message: "Each row is an object." }); continue; }
    const id = typeof r.id === "string" ? r.id : "";
    const bad = (message: string) => errors.push({ rowId: id || undefined, field: typeof r.target === "string" ? r.target : undefined, message });
    if (!id || id.length > 80 || /[\r\n\0]/.test(id)) { bad("Every row needs an id."); continue; }
    if (typeof r.target !== "string" || !r.target.trim() || r.target.length > 160 || /[\r\n\0]/.test(r.target)) { bad("This row has no ERP field."); continue; }
    if (r.source !== null && r.source !== undefined && (typeof r.source !== "string" || r.source.length > 80 || /[\r\n\0]/.test(r.source))) { bad("The BPMSquare field is not valid."); continue; }
    let convert = null;
    if (r.convert !== null && r.convert !== undefined) {
      const v = validateConverter(r.convert, direction);
      if (!v.ok) { bad(v.message); continue; }
      convert = v.value;
    }
    if (r.ifEmpty !== null && r.ifEmpty !== undefined && (typeof r.ifEmpty !== "string" || r.ifEmpty.length > 500)) { bad("The default is text of up to 500 characters."); continue; }
    rows.push({
      id, target: r.target.trim(), source: (r.source as string | null | undefined) ?? null, convert, ifEmpty: (r.ifEmpty as string | null | undefined) ?? null,
      origin: ORIGINS.includes(r.origin as RowOrigin) ? (r.origin as RowOrigin) : "user",
      confidence: CONFIDENCE.includes(r.confidence as Confidence) ? (r.confidence as Confidence) : null,
    });
  }
  return errors.length ? { errors } : { rows };
}

function sanitizeRows(raw: unknown, direction: "out" | "in"): { rows: RowsIn } | { errors: Err[] } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { errors: [{ message: "Send the rows as { header: [...], lines: [...] }." }] };
  const o = raw as { header?: unknown; lines?: unknown };
  const h = sanitizeBlock(o.header ?? [], direction, "header");
  if ("errors" in h) return h;
  const l = sanitizeBlock(o.lines ?? [], direction, "lines");
  if ("errors" in l) return l;
  return { rows: { header: h.rows, lines: l.rows } };
}

function errorsOut(errors: Err[]): Out {
  return fail(422, errors[0]?.message ?? "Check the rows.", { errors });
}

// ── PUT ──────────────────────────────────────────────────────────────────────

export async function saveEngine(ctx: OpsCtx, body: Record<string, unknown>): Promise<Out> {
  const document = parseDoc(body.document);
  if (!document) return fail(422, "Choose which mapping to save.");
  const r = await resolveConnection(ctx.admin, ctx.tenantId, body.connection);
  if (!r.ok) return fail(r.status, r.error);
  const s = await loadState(ctx, r.conn, document);
  if (s === "not_connected") return fail(400, "Connect your ERP first.");
  if (s === "bad_document") return fail(422, "A webhook mapping is for the Quote document.");
  if (s.pending) return needsUpdate();

  const rows = sanitizeRows(body.rows, s.direction);
  if ("errors" in rows) return errorsOut(rows.errors);
  const base = effectiveTarget(s);
  if (!base) return fail(422, "Fetch the target's fields first: no field list yet.");

  const target: MappingTarget = { ...base };
  if (body.target !== undefined) {
    const t = body.target as { entity?: unknown; linesPath?: unknown } | null;
    if (!t || typeof t !== "object") return fail(422, "The target must be an object.");
    if (t.entity !== undefined) {
      if (typeof t.entity !== "string" || !t.entity.trim() || t.entity.length > 160 || /[\r\n\0]/.test(t.entity)) return fail(422, "The target entity is not valid.");
      target.entity = t.entity.trim();
    }
    if (t.linesPath !== undefined) {
      if (t.linesPath !== null && (typeof t.linesPath !== "string" || !LINES_PATH.test(t.linesPath) || ["__proto__", "constructor", "prototype"].includes(t.linesPath))) return fail(422, "The lines block name is not valid.");
      target.linesPath = t.linesPath as string | null;
    }
  }
  const doc: MappingDocument = {
    source: { object: SOURCE_OBJECT[document], registryHash: registryHash(s.blocks) }, target, header: rows.rows.header, lines: rows.rows.lines,
    ...(typeof body.note === "string" && body.note.trim() ? { note: body.note.trim().slice(0, 200) } : s.active?.doc.note ? { note: s.active.doc.note } : {}),
  };
  const lookup = lookupOf(new Map(s.lists.map((l) => [l.kind, l])));
  const c = compile(doc, { direction: s.direction, sourceFields: leniencyFields(s.blocks, { header: [], lines: [] }), lists: lookup, checkTargets: true });
  if (!c.ok) return errorsOut(c.errors);

  const before = s.active?.doc ?? null;
  const saved = await saveActive(ctx.admin, ctx.tenantId, ctx.userId, s.conn.id, document, s.direction, doc);
  if (!saved.ok) return saved.pending ? needsUpdate() : fail(500, saved.error);
  if (s.conn.kind === "webhook") {
    // A webhook that already takes its body from a mapping follows the newest version.
    await ctx.admin.from("webhooks").update({ mapping_id: saved.id }).eq("id", s.conn.webhookId).eq("tenant_id", ctx.tenantId).not("mapping_id", "is", null);
  }
  const changes = [
    ...diffRows(before ? [...before.header, ...before.lines] : [], [...doc.header, ...doc.lines]),
    { field: "version", from: before ? saved.version - 1 : null, to: saved.version },
  ];
  await logChange(ctx.supabase, { tenantId: ctx.tenantId, objectType: "integration_mapping", objectId: saved.id, objectLabel: `${s.conn.label} · ${document}`, action: before ? "update" : "create", actorId: ctx.userId, changes });
  const after = await loadState(ctx, r.conn, document);
  return typeof after === "string" ? ok({ saved: true }) : ok(await assembleView(ctx, after));
}

// ── Reset and restore ────────────────────────────────────────────────────────

export async function resetEngine(ctx: OpsCtx, body: Record<string, unknown>): Promise<Out> {
  const document = parseDoc(body.document);
  if (!document) return fail(422, "Choose which mapping to reset.");
  const r = await resolveConnection(ctx.admin, ctx.tenantId, body.connection);
  if (!r.ok) return fail(r.status, r.error);
  const s = await loadState(ctx, r.conn, document);
  if (s === "not_connected") return fail(400, "Connect your ERP first.");
  if (s === "bad_document") return fail(422, "A webhook mapping is for the Quote document.");
  if (s.pending) return needsUpdate();
  if (s.active) {
    if (s.conn.kind === "webhook") await detachWebhooks(ctx.admin, ctx.tenantId, s.active.id);
    const done = await resetAll(ctx.admin, ctx.tenantId, s.conn.id, document, { keepDraft: s.conn.kind === "webhook" });
    if (!done.ok) return fail(500, done.error);
    await logChange(ctx.supabase, { tenantId: ctx.tenantId, objectType: "integration_mapping", objectId: s.active.id, objectLabel: `${s.conn.label} · ${document}`, action: "delete", actorId: ctx.userId, changes: [{ field: "mapping", from: `version ${s.active.version}`, to: "standard" }] });
  } else if (s.draft) {
    await resetAll(ctx.admin, ctx.tenantId, s.conn.id, document, { keepDraft: s.conn.kind === "webhook" });
  }
  const after = await loadState(ctx, r.conn, document);
  return typeof after === "string" ? ok({ reset: true }) : ok(await assembleView(ctx, after));
}

export async function restoreEngine(ctx: OpsCtx, body: Record<string, unknown>): Promise<Out> {
  const document = parseDoc(body.document);
  if (!document) return fail(422, "Choose which mapping to restore.");
  if (typeof body.version !== "number" || !Number.isInteger(body.version) || body.version < 1) return fail(422, "Choose a version to restore.");
  const r = await resolveConnection(ctx.admin, ctx.tenantId, body.connection);
  if (!r.ok) return fail(r.status, r.error);
  const s = await loadState(ctx, r.conn, document);
  if (s === "not_connected") return fail(400, "Connect your ERP first.");
  if (s === "bad_document") return fail(422, "A webhook mapping is for the Quote document.");
  if (s.pending) return needsUpdate();
  const old = await getVersion(ctx.admin, ctx.tenantId, s.conn.id, document, body.version);
  if (!old) return fail(404, "That version was not found.");
  const saved = await saveActive(ctx.admin, ctx.tenantId, ctx.userId, s.conn.id, document, s.direction, old.doc);
  if (!saved.ok) return saved.pending ? needsUpdate() : fail(500, saved.error);
  if (s.conn.kind === "webhook") await ctx.admin.from("webhooks").update({ mapping_id: saved.id }).eq("id", s.conn.webhookId).eq("tenant_id", ctx.tenantId).not("mapping_id", "is", null);
  await logChange(ctx.supabase, { tenantId: ctx.tenantId, objectType: "integration_mapping", objectId: saved.id, objectLabel: `${s.conn.label} · ${document}`, action: "update", actorId: ctx.userId, changes: [{ field: "restored", from: s.active ? `version ${s.active.version}` : null, to: `version ${old.version} as version ${saved.version}` }] });
  const after = await loadState(ctx, r.conn, document);
  return typeof after === "string" ? ok({ restored: true }) : ok(await assembleView(ctx, after));
}

// ── Schema ───────────────────────────────────────────────────────────────────

const SOURCES = ["adapter", "openapi", "odata", "sample", "manual"] as const;

export async function fetchSchema(ctx: OpsCtx, body: Record<string, unknown>): Promise<Out> {
  const document = parseDoc(body.document);
  if (!document) return fail(422, "Choose a document.");
  if (!(SOURCES as readonly unknown[]).includes(body.source)) return fail(422, `Choose a source: ${SOURCES.join(", ")}.`);
  const source = body.source as (typeof SOURCES)[number];
  const r = await resolveConnection(ctx.admin, ctx.tenantId, body.connection);
  if (!r.ok) return fail(r.status, r.error);
  const s = await loadState(ctx, r.conn, document, { refresh: source === "adapter" });
  if (s === "not_connected") return fail(400, "Connect your ERP first.");
  if (s === "bad_document") return fail(422, "A webhook mapping is for the Quote document.");
  if (s.pending) return needsUpdate();

  const previous = effectiveTarget(s);
  let next: MappingTarget;
  let operations: { method: string; path: string; summary: string }[] | undefined;

  if (source === "adapter") {
    if (!s.live) return fail(422, "This connection has no field list of its own yet: paste a sample or add fields.");
    next = s.live;
  } else {
    const req: DiscoverRequest = { source, url: body.url, sample: body.sample, fields: body.fields, linesPath: body.linesPath, operation: (body.operation as DiscoverRequest["operation"]) ?? null };
    if ((source === "openapi" || source === "odata") && body.sendWebhookHeaders === true && s.conn.kind === "webhook") {
      req.headers = await webhookHeaders(ctx.admin, ctx.tenantId, s.conn.webhookId);
    }
    let found;
    try {
      found = await discoverSchema(req);
    } catch (e) {
      if (e instanceof SchemaFetchError) return fail(e.status, e.message);
      return fail(502, "The field list could not be fetched.");
    }
    if (!found.parsed.ok) {
      if (found.parsed.operations) {
        const cur = previous;
        return ok({
          needsOperation: true, message: found.parsed.message, operations: found.parsed.operations,
          target: cur ? targetInfo(cur) : null, targetFields: { header: cur?.schema.fields ?? [], lines: cur?.schema.lineFields ?? [] },
          counts: cur ? countFields(cur.schema.fields, cur.schema.lineFields ?? []) : { total: 0, new: 0, missing: 0 },
        });
      }
      return fail(422, found.parsed.message);
    }
    const p = found.parsed;
    next = {
      kind: source, entity: p.entity, linesPath: p.linesPath,
      schema: { fetchedAt: new Date().toISOString(), sourceUrl: found.sourceUrl, ...(p.operation ? { operation: p.operation } : {}), fields: p.fields, lineFields: p.lineFields },
    };
    operations = undefined;
  }

  // What is new and what vanished, judged against the snapshot this replaces; a mapped field that vanished stays, marked missing.
  const rows = currentRows(s);
  const sameKind = previous && previous.kind === next.kind;
  const mappedH = new Set(rows.header.filter((x) => x.source !== null || x.convert !== null).map((x) => x.target));
  const mappedL = new Set(rows.lines.filter((x) => x.source !== null || x.convert !== null).map((x) => x.target));
  const dh = diffSchema(sameKind || source === "adapter" ? previous?.schema.fields ?? [] : [], next.schema.fields, mappedH);
  const dl = diffSchema(sameKind || source === "adapter" ? previous?.schema.lineFields ?? [] : [], next.schema.lineFields ?? [], mappedL);
  next = { ...next, schema: { ...next.schema, fields: dh.fields, lineFields: dl.fields } };

  const doc: MappingDocument = { source: { object: SOURCE_OBJECT[document], registryHash: registryHash(s.blocks) }, target: next, header: [], lines: [] };
  const saved = await saveDraft(ctx.admin, ctx.tenantId, ctx.userId, s.conn.id, document, s.direction, doc);
  if (!saved.ok) return saved.pending ? needsUpdate() : fail(500, saved.error);
  return ok({
    target: targetInfo(next), targetFields: { header: dh.fields, lines: dl.fields },
    counts: { total: dh.counts.total + dl.counts.total, new: dh.counts.new + dl.counts.new, missing: dh.counts.missing + dl.counts.missing },
    ...(operations ? { operations } : {}), notes: [],
  });
}

function targetInfo(t: MappingTarget) {
  return {
    kind: t.kind, entity: t.entity, linesPath: t.linesPath,
    schema: { fetchedAt: t.schema.fetchedAt, sourceUrl: t.schema.sourceUrl, counts: countFields(t.schema.fields, t.schema.lineFields ?? []) },
  };
}

// ── Propose ──────────────────────────────────────────────────────────────────

function proposeBlocks(s: State, target: MappingTarget, existing: RowsIn, mode: "fill" | "replace") {
  const known = knownValues(s.config);
  const existingLists = s.lists.map((l) => l.kind);
  const header = propose({ source: s.blocks.header, target: target.schema.fields, existing: existing.header, mode, direction: s.direction, engineSets: s.engineSets.header, known, existingLists });
  const lines = propose({ source: s.blocks.lines, target: target.schema.lineFields ?? [], existing: existing.lines, mode, direction: s.direction, engineSets: s.engineSets.lines, known, existingLists });
  return { header, lines };
}

export async function proposeOp(ctx: OpsCtx, body: Record<string, unknown>): Promise<Out> {
  const document = parseDoc(body.document);
  if (!document) return fail(422, "Choose a document.");
  if (body.mode !== "fill" && body.mode !== "replace") return fail(422, "mode must be fill or replace.");
  const r = await resolveConnection(ctx.admin, ctx.tenantId, body.connection);
  if (!r.ok) return fail(r.status, r.error);
  const s = await loadState(ctx, r.conn, document);
  if (s === "not_connected") return fail(400, "Connect your ERP first.");
  if (s === "bad_document") return fail(422, "A webhook mapping is for the Quote document.");
  if (s.pending) return needsUpdate();
  const target = effectiveTarget(s);
  if (!target) return fail(422, "No field list yet: fetch one, paste a sample, or add fields.");
  const p = proposeBlocks(s, target, currentRows(s), body.mode);
  const lists = [...p.header.lists, ...p.lines.lists.filter((l) => !p.header.lists.some((h) => h.kind === l.kind))];
  return ok({ rows: { header: p.header.rows, lines: p.lines.rows }, lists, missingRequired: [...p.header.missingRequired, ...p.lines.missingRequired] });
}

export async function proposeAiOp(ctx: OpsCtx, body: Record<string, unknown>): Promise<Out> {
  const document = parseDoc(body.document);
  if (!document) return fail(422, "Choose a document.");
  const r = await resolveConnection(ctx.admin, ctx.tenantId, body.connection);
  if (!r.ok) return fail(r.status, r.error);
  const s = await loadState(ctx, r.conn, document);
  if (s === "not_connected") return fail(400, "Connect your ERP first.");
  if (s === "bad_document") return fail(422, "A webhook mapping is for the Quote document.");
  if (s.pending) return needsUpdate();
  if (s.features.ai_assistant !== true) return fail(403, "The AI assistant is not switched on for this workspace.");
  if (!aiConfigured()) return fail(503, "AI is not set up for this workspace.", { code: "not_configured" });
  const target = effectiveTarget(s);
  if (!target) return fail(422, "No field list yet: fetch one, paste a sample, or add fields.");

  const det = proposeBlocks(s, target, currentRows(s), (body.mode === "replace" ? "replace" : "fill"));
  const budget = resolveMonthlyBudget(s.config.ai_assistant?.monthly_token_budget);
  const blocks: [string, typeof det.header.rows, DocBlocks["header"], TargetField[]][] = [
    ["header", det.header.rows, s.blocks.header, target.schema.fields], ["lines", det.lines.rows, s.blocks.lines, target.schema.lineFields ?? []],
  ];
  const out: { block: string; source: string; target: string; reason: string; convert: unknown }[] = [];
  try {
    for (const [block, rows, src, tgt] of blocks) {
      if (!src.length || !tgt.length) continue;
      const taken = { sources: new Set(rows.filter((x) => x.source).map((x) => x.source as string)), targets: new Set(rows.map((x) => x.target)) };
      const { prompt, index } = buildAiPrompt({ source: src, target: tgt, taken });
      if (!index.targets.size || !index.sources.size) continue;
      // Field names and types only: the prompt is built from the lists above and holds no record, value, address or credential.
      const raw = await askStructuredMetered({ tenantId: ctx.tenantId, userId: ctx.userId, surface: AI_SURFACE, budget, system: AI_SYSTEM, prompt, schema: aiSchema(), effort: "low", maxTokens: 3000 });
      for (const sg of normaliseAiAnswer(raw, index)) out.push({ block, ...sg });
    }
  } catch (e) {
    if (e instanceof AiError) {
      if (e.code === "over_budget") return fail(402, e.message, { code: "over_budget" });
      return fail(e.status, e.message, { code: e.code });
    }
    return fail(502, "The AI request failed.");
  }
  const used = await monthlyTokensUsed(ctx.tenantId).catch(() => 0);
  return ok({ suggestions: out.map(({ block, ...rest }) => ({ ...rest, block })), usage: { percent: usagePercent(used, budget), off: budget <= 0 } });
}

// ── Try it ───────────────────────────────────────────────────────────────────

export async function tryOp(ctx: OpsCtx, body: Record<string, unknown>): Promise<Out> {
  const document = parseDoc(body.document);
  if (!document) return fail(422, "Choose a document.");
  if (document !== "quote") return fail(422, "Try it shows what a Standard Quote sends.");
  const r = await resolveConnection(ctx.admin, ctx.tenantId, body.connection);
  if (!r.ok) return fail(r.status, r.error);
  const s = await loadState(ctx, r.conn, document);
  if (s === "not_connected") return fail(400, "Connect your ERP first.");
  if (s === "bad_document") return fail(422, "A webhook mapping is for the Quote document.");
  if (s.pending) return needsUpdate();

  // A record id from the body is resolved with the tenant before anything is read through it.
  let recordId: string | null = null;
  if (body.record_id !== undefined && body.record_id !== null && body.record_id !== "") {
    if (typeof body.record_id !== "string" || !/^[0-9a-f-]{32,40}$/i.test(body.record_id)) return fail(422, "Choose a quote from the list.");
    const { data } = await ctx.admin.from("standard_quotes").select("id").eq("id", body.record_id).eq("tenant_id", ctx.tenantId).maybeSingle();
    if (!data) return fail(404, "That quote was not found.");
    recordId = body.record_id;
  }

  if (s.conn.kind === "adapter") {
    if (s.conn.id !== "dynamics365") return fail(422, "This connection has no sender yet.");
    const p = await previewMappedQuote(ctx.admin, ctx.tenantId, { quoteId: recordId });
    if (!p.ok) return fail(p.status, p.message);
    const problems: MappingProblem[] = p.problems.map((x) => ({ code: x.code as MappingProblem["code"], message: x.message, fix: x.fix }));
    return ok({ words: p.words, request: { method: "POST", url: `/${p.entitySet}`, headers: ["Authorization", "Content-Type", "OData-MaxVersion", "OData-Version", "Accept"], body: p.body }, problems });
  }

  // A webhook: the address, method and header names come from the webhook; the body is the saved mapping's.
  const tenant = await loadTenantInfo(ctx.admin, ctx.tenantId);
  if (!tenant) return fail(404, "Workspace not found.");
  const id = recordId ?? (await listSamples(ctx.admin, ctx.tenantId, "standard_quotes"))[0]?.id ?? null;
  if (!id) return fail(422, "Create a Standard Quote first, then try the mapping on it.");
  const rec = await loadQuoteRecord(ctx.admin, ctx.tenantId, id, tenant.origin, tenant.currency, s.conn.allowPersonalData);
  if (!rec) return fail(404, "That quote was not found.");
  const mapped = await mapForWebhook(ctx.admin, ctx.tenantId, { id: s.conn.webhookId, allow_personal_data: s.conn.allowPersonalData }, rec.parts, { event: "quote.awarded", workspace: tenant.name, sentAt: new Date().toISOString(), deliveryId: "preview" });
  const base = await previewWebhook(ctx.admin, { tenantId: ctx.tenantId, webhookId: s.conn.webhookId, objectType: "standard_quotes", objectId: id });
  const request = base.ok ? { method: base.request.method, url: base.request.url, headers: base.request.headers } : { method: "POST", url: "", headers: [] as string[] };
  const words = [`${rec.label} goes to ${s.conn.label}.`];
  if (!mapped.ok) return ok({ words, request: { ...request, body: null }, problems: [{ code: "row_invalid", message: mapped.headline, fix: mapped.fix }] });
  return ok({ words, request: { ...request, body: mapped.body }, problems: [] });
}
