import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { quoteHeaderVars, quoteLineVars, projectHeaderVars, type PrebuiltBody, type QuoteForErp } from "../payload";
import { reverseConverter, type ListLookup } from "./convert";
import { assembleBody, compile, describeProblems, inboundFieldMap, run, type Program } from "./engine";
import { getActive, type MappingRow } from "./mappingStore";
import { adapterSourceFields, leniencyFields, webhookQuoteSourceFields, type DocBlocks } from "./sourceFields";
import type { MappingDocument, MappingProblem, Primitive, RowError } from "./types";
import { loadListMap, lookupOf } from "./valueListStore";
import type { MappingDocKey } from "../mappingDoc";

// The runtime half that reads the database: find the active mapping document of a connection, compile it against what
// BPMSquare offers today, run it on a record. Everything is tenant-scoped, and a missing table or no document is "none":
// the caller then takes today's path, byte for byte.

export type Runtime =
  | { state: "none" }
  | { state: "ready"; program: Program; lists: ListLookup; doc: MappingDocument; row: MappingRow }
  | { state: "invalid"; errors: RowError[]; row: MappingRow };

export async function loadRuntime(
  admin: SupabaseClient, tenantId: string, connection: string, document: string, direction: "out" | "in", blocks: DocBlocks,
): Promise<Runtime> {
  const got = await getActive(admin, tenantId, connection, document);
  if (got.pending || !got.value) return { state: "none" };
  const row = got.value;
  const lists = lookupOf(await loadListMap(admin, tenantId, connection));
  const c = compile(row.doc, { direction, sourceFields: leniencyFields(blocks, row.doc), lists, checkTargets: false });
  return c.ok ? { state: "ready", program: c.program, lists, doc: row.doc, row } : { state: "invalid", errors: c.errors, row };
}

const asPrimitive = (v: unknown): Primitive | undefined => (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : v === undefined ? undefined : undefined);

/** The customer's non-personal fields and the quote's custom fields, for the `account.*` and `cf_*` source keys. A missing column is simply no value. */
async function quoteExtras(admin: SupabaseClient, tenantId: string, accountId: string | null, quoteId: string | null): Promise<Record<string, Primitive>> {
  const out: Record<string, Primitive> = {};
  if (accountId) {
    const { data } = await admin.from("accounts").select("ref, name, city, country").eq("id", accountId).eq("tenant_id", tenantId).maybeSingle();
    for (const [k, v] of Object.entries((data ?? {}) as Record<string, unknown>)) { const p = asPrimitive(v); if (p !== undefined) out[`account.${k}`] = p; }
  }
  if (quoteId) {
    const { data, error } = await admin.from("standard_quotes").select("custom_data").eq("id", quoteId).eq("tenant_id", tenantId).maybeSingle();
    const cd = !error ? (data as { custom_data?: unknown } | null)?.custom_data : null;
    if (cd && typeof cd === "object") for (const [k, v] of Object.entries(cd as Record<string, unknown>)) if (/^cf_[a-z0-9_]{1,60}$/.test(k)) { const p = asPrimitive(v); if (p !== undefined) out[k] = p; }
  }
  return out;
}

export type QuoteMapped =
  | { used: false }
  | { used: true; prebuilt: PrebuiltBody; problems: MappingProblem[]; invalid: boolean; version: number };

/**
 * An awarded Standard Quote through the saved mapping document of an ERP connection, or `{ used: false }` when the workspace has
 * none (the older field maps then build the body, as before). `currentEntity` is the ERP entity the Links tab creates now: a
 * document made for another one is refused loudly rather than sent to the wrong place.
 */
export async function mapQuoteForAdapter(
  admin: SupabaseClient, tenantId: string,
  a: { connection: string; qfe: QuoteForErp; headerKind: "quote" | "sales_order" | "project"; currentEntity: string; accountId: string | null; quoteId: string | null; engineSets: readonly string[] },
): Promise<QuoteMapped> {
  const blocks = adapterSourceFields("quote", a.headerKind);
  const rt = await loadRuntime(admin, tenantId, a.connection, "quote", "out", blocks);
  if (rt.state === "none") return { used: false };
  const empty: PrebuiltBody = { header: {}, lines: [] };
  if (rt.state === "invalid") {
    const first = rt.errors[0];
    return { used: true, prebuilt: empty, invalid: true, version: rt.row.version, problems: [{ code: "row_invalid", rowId: first?.rowId, field: first?.field, message: `The mapping needs a fix: ${first?.message ?? "it could not be read"}`, fix: "Open Mapping, correct the row, save, then Restart." }] };
  }
  if (rt.doc.target.entity && a.currentEntity && rt.doc.target.entity !== a.currentEntity) {
    return { used: true, prebuilt: empty, invalid: true, version: rt.row.version, problems: [{ code: "row_invalid", message: `The mapping is for ${rt.doc.target.entity}, but Links now creates ${a.currentEntity}.`, fix: "Open Mapping, choose the mapping for this document (or reset it), then Restart." }] };
  }
  const extras = await quoteExtras(admin, tenantId, a.accountId, a.quoteId);
  const header = { ...(a.headerKind === "project" ? projectHeaderVars(a.qfe, "awarded") : quoteHeaderVars(a.qfe)), ...extras };
  const r = run(rt.program, { header, lines: a.qfe.lines.map((l) => quoteLineVars(l)) }, { lists: rt.lists, engineSets: a.engineSets });
  return { used: true, prebuilt: { header: r.header, lines: r.lines }, problems: r.problems, invalid: false, version: rt.row.version };
}

/** The one Monitor line for a list of problems, with the kind the row is filed under. */
export const problemsForMonitor = describeProblems;

// ── Inbound ──────────────────────────────────────────────────────────────────

export type InboundMapping = {
  /** `BPM field = ERP field`, as the older pull reads it. */
  fieldMap: Record<string, string>;
  /** The ERP value of a BPMSquare field after the reverse converter; unknown codes are collected in `unknown`. */
  transform: (bpmField: string, raw: unknown) => unknown;
  unknown: { list: string; value: string }[];
};

export async function loadInbound(admin: SupabaseClient, tenantId: string, connection: string, document: MappingDocKey): Promise<InboundMapping | null> {
  const rt = await loadRuntime(admin, tenantId, connection, document, "in", adapterSourceFields(document, "quote"));
  if (rt.state !== "ready") return null;
  const bySource = new Map(rt.program.header.filter((r) => r.source).map((r) => [r.source as string, r]));
  const unknown: InboundMapping["unknown"] = [];
  return {
    fieldMap: inboundFieldMap(rt.program),
    unknown,
    transform: (bpm, raw) => {
      const row = bySource.get(bpm);
      if (!row) return raw;
      const rev = reverseConverter(row.convert, raw, rt.lists);
      if (rev.unknown) unknown.push(rev.unknown);
      return rev.bad ? raw : rev.value;
    },
  };
}

// ── Webhooks ─────────────────────────────────────────────────────────────────

export type WebhookMapped = { ok: true; body: Record<string, unknown> } | { ok: false; headline: string; fix: string };

/** The record a Call webhook for a Standard Quote reads, flattened to the keys the Mapping tab offers. */
export function webhookQuoteRecord(parts: { record: { id: string; url: string }; quote?: Record<string, unknown>; account?: Record<string, unknown> }, sys: { event: string; workspace: string; sentAt: string; deliveryId: string }) {
  const header: Record<string, Primitive | undefined> = { "record.id": parts.record.id, "record.url": parts.record.url, event: sys.event, sent_at: sys.sentAt, delivery_id: sys.deliveryId, "workspace.name": sys.workspace };
  for (const [k, v] of Object.entries(parts.quote ?? {})) { if (k === "lines" || k === "external") continue; const p = asPrimitive(v); if (p !== undefined) header[k] = p; }
  for (const [k, v] of Object.entries(parts.account ?? {})) { const p = asPrimitive(v); if (p !== undefined) header[`account.${k}`] = p; }
  const lines = (Array.isArray(parts.quote?.lines) ? (parts.quote!.lines as Record<string, unknown>[]) : []).map((l) => {
    const o: Record<string, Primitive | undefined> = {};
    for (const [k, v] of Object.entries(l)) { const p = asPrimitive(v); if (p !== undefined) o[k] = p; }
    return o;
  });
  return { header, lines };
}

export async function mapForWebhook(
  admin: SupabaseClient, tenantId: string, def: { id: string; allow_personal_data: boolean },
  parts: Parameters<typeof webhookQuoteRecord>[0], sys: Parameters<typeof webhookQuoteRecord>[1],
): Promise<WebhookMapped> {
  const connection = `webhook:${def.id}`;
  const rt = await loadRuntime(admin, tenantId, connection, "quote", "out", webhookQuoteSourceFields(def.allow_personal_data));
  if (rt.state === "none") return { ok: false, headline: "This webhook's mapping was not found.", fix: "Open Mapping and save one for this webhook, or choose another payload on the Request tab." };
  if (rt.state === "invalid") return { ok: false, headline: `The mapping needs a fix: ${rt.errors[0]?.message ?? "it could not be read"}`, fix: "Open Mapping, correct the row, then restart." };
  const r = run(rt.program, webhookQuoteRecord(parts, sys), { lists: rt.lists });
  if (r.problems.length) {
    const d = describeProblems(r.problems);
    return { ok: false, headline: d.headline, fix: d.fix };
  }
  return { ok: true, body: assembleBody(rt.program, r) };
}
