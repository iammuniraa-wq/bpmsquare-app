import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logChange, type ChangeEntry } from "@/lib/changeLog";
import { isSchemaPending } from "@/lib/marketing/pending";
import { recordMessage } from "@/lib/middleware/messages";
import { listEntitySets } from "@/lib/middleware/schema/odata";
import { readSpecText, SchemaFetchError } from "@/lib/middleware/schema/discover";
import {
  guessObject, MAX_BATCH, operationLine, parseEndpointInput, type EndpointInput, type ParsedEndpoint, type PublicEndpoint,
} from "./endpointSpec";
import { describeHttpFailure, EMPTY_ANSWER } from "./plain";
import { callConnection } from "./request";
import {
  CONNECTIONS_BUNDLE, ENDPOINTS_TABLE, getRow, isUuid, toLive, tokenStore, type StoreCtx,
} from "./store";
import type { ConnectionFamily, FieldError } from "./spec";
import { ENDPOINT_TEMPLATES } from "./templates";

// The endpoints of one connection: what BPMSquare may read from or send to it. Every query names the tenant, and the connection id
// that arrives in a request is resolved with the tenant first (a foreign id is a 404, never an insert). Nothing here writes to the
// connected system: Try only reads.

export type Out = { status: number; body: Record<string, unknown> };
const ok = (body: Record<string, unknown>): Out => ({ status: 200, body });
const err = (status: number, error: string, extra: Record<string, unknown> = {}): Out => ({ status, body: { error, ...extra } });
const pendingOut = (): Out => ok({ needsDatabaseUpdate: true, bundle: CONNECTIONS_BUNDLE });
const notFound = (what = "Connection") => err(404, `${what} not found.`);

type EndpointRow = {
  id: string; connection_id: string; name: string; method: PublicEndpoint["method"]; path: string; direction: PublicEndpoint["direction"];
  object_type: PublicEndpoint["objectType"]; run_mode: PublicEndpoint["runMode"]; schedule: PublicEndpoint["schedule"]; enabled: boolean;
  origin: PublicEndpoint["origin"]; template_key: string | null; last_run_at: string | null; last_run_status: "ok" | "failed" | null; last_run_message: string | null;
};

const COLS = "id, connection_id, name, method, path, direction, object_type, run_mode, schedule, enabled, origin, template_key, last_run_at, last_run_status, last_run_message";

export const toPublicEndpoint = (r: EndpointRow): PublicEndpoint => ({
  id: r.id, connectionId: r.connection_id, name: r.name, method: r.method, path: r.path, direction: r.direction, objectType: r.object_type,
  runMode: r.run_mode, schedule: r.schedule, enabled: r.enabled, origin: r.origin, templateKey: r.template_key,
  lastRunAt: r.last_run_at, lastRunStatus: r.last_run_status, lastRunMessage: r.last_run_message,
});

const SAFE: (keyof ParsedEndpoint)[] = ["name", "method", "path", "direction", "object_type", "run_mode", "schedule", "enabled"];
const diff = (before: Partial<ParsedEndpoint> | null, after: ParsedEndpoint): ChangeEntry[] =>
  SAFE.filter((k) => JSON.stringify(before?.[k] ?? null) !== JSON.stringify(after[k] ?? null)).map((k) => ({ field: k, from: before?.[k] ?? null, to: after[k] ?? null }));

async function connectionOf(ctx: StoreCtx, id: unknown) {
  if (!isUuid(id)) return { pending: false, row: null };
  return getRow(ctx.admin, ctx.tenantId, id);
}

async function endpointRow(admin: SupabaseClient, tenantId: string, id: string): Promise<{ pending: boolean; row: EndpointRow | null }> {
  if (!isUuid(id)) return { pending: false, row: null };
  const { data, error } = await admin.from(ENDPOINTS_TABLE).select(COLS).eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (isSchemaPending(error)) return { pending: true, row: null };
  return { pending: false, row: (data as EndpointRow | null) ?? null };
}

export async function listEndpoints(ctx: StoreCtx, connectionId: string): Promise<Out> {
  const c = await connectionOf(ctx, connectionId);
  if (c.pending) return pendingOut();
  if (!c.row) return notFound();
  const { data, error } = await ctx.admin.from(ENDPOINTS_TABLE).select(COLS).eq("tenant_id", ctx.tenantId).eq("connection_id", c.row.id).order("created_at", { ascending: true });
  if (isSchemaPending(error)) return pendingOut();
  if (error) return err(500, "Could not read the endpoints.");
  return ok({ endpoints: ((data ?? []) as EndpointRow[]).map(toPublicEndpoint) });
}

/**
 * Add endpoints to a connection: one by hand, or several picked from its metadata or from a template. All or nothing: a row that
 * is not valid refuses the whole request and names the row. A name already on the connection is refused for a hand-made row and
 * skipped (counted) for the picked ones, so picking the same list twice adds nothing twice.
 */
export async function createEndpoints(ctx: StoreCtx, body: { connection_id?: unknown; items?: unknown }): Promise<Out> {
  const c = await connectionOf(ctx, body.connection_id);
  if (c.pending) return pendingOut();
  if (!c.row) return notFound();
  const items = Array.isArray(body.items) ? (body.items as EndpointInput[]) : [];
  if (items.length === 0) return err(422, "Choose at least one endpoint.");
  if (items.length > MAX_BATCH) return err(422, `Add at most ${MAX_BATCH} endpoints at a time.`);

  const family: ConnectionFamily = c.row.family;
  const parsed: ParsedEndpoint[] = [];
  const errors: (FieldError & { row: number })[] = [];
  items.forEach((it, i) => {
    const r = parseEndpointInput(it ?? {}, family);
    if (r.ok) parsed.push(r.value);
    else for (const e of r.errors) errors.push({ ...e, row: i });
  });
  if (errors.length) return err(422, errors[0].message, { errors });

  const { data: have, error: e0 } = await ctx.admin.from(ENDPOINTS_TABLE).select("name").eq("tenant_id", ctx.tenantId).eq("connection_id", c.row.id);
  if (isSchemaPending(e0)) return pendingOut();
  const names = new Set(((have ?? []) as { name: string }[]).map((r) => r.name.toLowerCase()));
  const fresh: ParsedEndpoint[] = [];
  let skipped = 0;
  for (const p of parsed) {
    const taken = names.has(p.name.toLowerCase());
    if (taken && p.origin === "hand") return err(422, "An endpoint with that name already exists on this connection.", { errors: [{ field: "name", message: "An endpoint with that name already exists on this connection.", row: 0 }] });
    if (taken) { skipped++; continue; }
    names.add(p.name.toLowerCase());
    fresh.push(p);
  }
  if (fresh.length === 0) return ok({ endpoints: [], created: 0, skipped });

  const { data, error } = await ctx.admin.from(ENDPOINTS_TABLE).insert(fresh.map((p) => ({
    tenant_id: ctx.tenantId, connection_id: c.row!.id, ...p, created_by: ctx.userId, updated_by: ctx.userId,
  }))).select(COLS);
  if (isSchemaPending(error)) return pendingOut();
  if (error) return err(error.code === "23505" ? 422 : 500, error.code === "23505" ? "An endpoint with that name already exists on this connection." : "Could not save the endpoints.");
  const rows = (Array.isArray(data) ? data : data ? [data] : []) as EndpointRow[];
  for (const r of rows) {
    await logChange(ctx.supabase, {
      tenantId: ctx.tenantId, objectType: "integration_endpoint", objectId: r.id, objectLabel: `${c.row.name} · ${r.name}`, action: "create", actorId: ctx.userId,
      changes: diff(null, fresh.find((p) => p.name === r.name) ?? (r as unknown as ParsedEndpoint)),
    });
  }
  return ok({ endpoints: rows.map(toPublicEndpoint), created: rows.length, skipped });
}

export async function updateEndpoint(ctx: StoreCtx, id: string, body: EndpointInput): Promise<Out> {
  const e = await endpointRow(ctx.admin, ctx.tenantId, id);
  if (e.pending) return pendingOut();
  if (!e.row) return notFound("Endpoint");
  const c = await connectionOf(ctx, e.row.connection_id);
  if (!c.row) return notFound();
  // The stored values underneath, the request's on top: a request that only flips `enabled` is valid on its own.
  const merged: EndpointInput = {
    name: e.row.name, method: e.row.method, path: e.row.path, direction: e.row.direction, object_type: e.row.object_type,
    run_mode: e.row.run_mode, schedule: e.row.schedule, enabled: e.row.enabled, origin: e.row.origin, template_key: e.row.template_key, ...body,
  };
  const r = parseEndpointInput(merged, c.row.family);
  if (!r.ok) return err(422, r.errors[0].message, { errors: r.errors });
  const before: ParsedEndpoint = { ...(e.row as unknown as ParsedEndpoint), object_type: e.row.object_type };
  const changes = diff(before, r.value);
  const { data, error } = await ctx.admin.from(ENDPOINTS_TABLE).update({ ...r.value, origin: e.row.origin, template_key: e.row.template_key, updated_by: ctx.userId, updated_at: new Date().toISOString() })
    .eq("id", e.row.id).eq("tenant_id", ctx.tenantId).select(COLS).maybeSingle();
  if (error) return err(error.code === "23505" ? 422 : 500, error.code === "23505" ? "An endpoint with that name already exists on this connection." : "Could not save the endpoint.");
  if (!data) return notFound("Endpoint");
  if (changes.length) await logChange(ctx.supabase, { tenantId: ctx.tenantId, objectType: "integration_endpoint", objectId: e.row.id, objectLabel: `${c.row.name} · ${r.value.name}`, action: "update", actorId: ctx.userId, changes });
  return ok({ endpoint: toPublicEndpoint(data as EndpointRow) });
}

export async function removeEndpoint(ctx: StoreCtx, id: string): Promise<Out> {
  const e = await endpointRow(ctx.admin, ctx.tenantId, id);
  if (e.pending) return pendingOut();
  if (!e.row) return notFound("Endpoint");
  const c = await connectionOf(ctx, e.row.connection_id);
  await ctx.admin.from(ENDPOINTS_TABLE).delete().eq("id", e.row.id).eq("tenant_id", ctx.tenantId);
  await logChange(ctx.supabase, { tenantId: ctx.tenantId, objectType: "integration_endpoint", objectId: e.row.id, objectLabel: `${c.row?.name ?? "Connection"} · ${e.row.name}`, action: "delete", actorId: ctx.userId, changes: [] });
  return ok({ ok: true });
}

export function templates(): Out {
  return ok({ templates: ENDPOINT_TEMPLATES.map((t) => ({ key: t.key, label: t.label, family: t.family, addressHint: t.addressHint, endpoints: t.endpoints })) });
}

// ── From metadata ───────────────────────────────────────────────────────────

export type Candidate = { name: string; path: string; method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; summary: string; object_type: string | null };

/** The operations of an OpenAPI document, every method of every path (the schema reader keeps only those with a body). Pure. */
export function listOpenApiOperations(spec: unknown): Candidate[] {
  const out: Candidate[] = [];
  const paths = spec && typeof spec === "object" ? (spec as { paths?: unknown }).paths : null;
  if (!paths || typeof paths !== "object") return out;
  for (const [path, item] of Object.entries(paths as Record<string, unknown>)) {
    if (!item || typeof item !== "object" || !path.startsWith("/")) continue;
    for (const m of ["get", "post", "put", "patch", "delete"] as const) {
      const op = (item as Record<string, unknown>)[m];
      if (!op || typeof op !== "object") continue;
      const o = op as { summary?: unknown; operationId?: unknown };
      const summary = String(o.summary ?? o.operationId ?? "").slice(0, 120);
      out.push({ name: summary || `${m.toUpperCase()} ${path}`, path, method: m.toUpperCase() as Candidate["method"], summary, object_type: guessObject(path) });
      if (out.length >= 300) return out;
    }
  }
  return out;
}

/** What the connected system says it offers: the entity sets of an OData service, or the operations of an OpenAPI document. */
export async function discover(ctx: StoreCtx, body: { connection_id?: unknown; source?: unknown; spec_path?: unknown }): Promise<Out> {
  const c = await connectionOf(ctx, body.connection_id);
  if (c.pending) return pendingOut();
  if (!c.row) return notFound();
  const live = toLive(ctx.tenantId, c.row);
  const store = live.config.auth === "oauth2_cc" ? tokenStore(ctx.admin, ctx.tenantId, live.id) : undefined;

  if (c.row.family === "odata") {
    const o = await callConnection(live, { path: "/$metadata", headers: { Accept: "application/xml, text/xml;q=0.9" } }, store);
    if (!o.ok) return err(502, o.result.message, { fix: o.result.fix });
    if (o.status < 200 || o.status >= 300) { const r = describeHttpFailure(o.status, o.text, "odata"); return err(502, r.message, { fix: r.fix }); }
    if (!o.text.trim()) { const r = EMPTY_ANSWER(o.status); return err(502, r.message, { fix: r.fix }); }
    const sets = listEntitySets(o.text);
    if (sets.length === 0) return err(502, "The service lists no entity sets.", { fix: "Check the service address." });
    const items: Candidate[] = sets.map((s) => {
      const name = s.path.replace(/^\//, "");
      return { name, path: name, method: "GET", summary: s.summary, object_type: guessObject(name) };
    });
    return ok({ source: "odata", items });
  }

  // REST: an OpenAPI document at a path on the connection's own server.
  const specPath = typeof body.spec_path === "string" && body.spec_path.trim() ? body.spec_path.trim() : "/openapi.json";
  if (!specPath.startsWith("/") || specPath.startsWith("//") || /\.\.|\s|\\/.test(specPath)) return err(422, "The path of the description must start with a single / on this server, such as /openapi.json.");
  const o = await callConnection(live, { path: specPath }, store);
  if (!o.ok) return err(502, o.result.message, { fix: o.result.fix });
  if (o.status < 200 || o.status >= 300) { const r = describeHttpFailure(o.status, o.text, "rest"); return err(502, r.message, { fix: r.fix }); }
  let spec: unknown;
  try { spec = readSpecText(o.text); } catch (e) { return err(422, e instanceof SchemaFetchError ? e.message : "That file could not be read as an OpenAPI description."); }
  const items = listOpenApiOperations(spec);
  if (items.length === 0) return err(422, "That file lists no operations. Check the path of the OpenAPI description.");
  return ok({ source: "openapi", items });
}

// ── Try ─────────────────────────────────────────────────────────────────────

/** The first rows of a read, as the number of rows and the field NAMES only (never the values). Pure. */
export function describeRows(text: string): { rows: number; fields: string[] } | null {
  let j: unknown;
  try { j = JSON.parse(text); } catch { return null; }
  const list = Array.isArray(j) ? j : j && typeof j === "object" ? (["value", "items", "data", "results", "records"] as const).map((k) => (j as Record<string, unknown>)[k]).find(Array.isArray) as unknown[] | undefined : undefined;
  if (!list) return j && typeof j === "object" ? { rows: 1, fields: Object.keys(j as object).slice(0, 12) } : null;
  const first = list.find((x) => x && typeof x === "object") as Record<string, unknown> | undefined;
  return { rows: list.length, fields: first ? Object.keys(first).filter((k) => !k.startsWith("@")).slice(0, 12) : [] };
}

/** Read the first rows of an In endpoint and say what came back. Writes nothing to the system; the call is one line in the Monitor. */
export async function tryEndpoint(ctx: StoreCtx, id: string): Promise<Out> {
  const e = await endpointRow(ctx.admin, ctx.tenantId, id);
  if (e.pending) return pendingOut();
  if (!e.row) return notFound("Endpoint");
  if (e.row.direction !== "in") return err(422, "Try reads from the system, so it is only for endpoints that come In.");
  const c = await connectionOf(ctx, e.row.connection_id);
  if (!c.row) return notFound();
  const live = toLive(ctx.tenantId, c.row);
  const store = live.config.auth === "oauth2_cc" ? tokenStore(ctx.admin, ctx.tenantId, live.id) : undefined;

  const path = c.row.family === "odata" ? `/${e.row.path}?$top=5` : e.row.path;
  const method = e.row.method === "POST" ? "POST" : "GET";
  const o = await callConnection(live, { method, path, body: method === "POST" ? "{}" : undefined, headers: method === "POST" ? { "Content-Type": "application/json" } : {} }, store);

  let ok_ = false;
  let message: string;
  let fix: string | null = null;
  let sample: { rows: number; fields: string[] } | null = null;
  let httpStatus: number | null = null;
  if (!o.ok) { message = o.result.message; fix = o.result.fix; httpStatus = o.status; }
  else if (o.status < 200 || o.status >= 300) { const r = describeHttpFailure(o.status, o.text, c.row.family); message = r.message; fix = r.fix; httpStatus = o.status; }
  else {
    httpStatus = o.status;
    sample = describeRows(o.text);
    ok_ = true;
    message = sample ? `Read ${sample.rows} row${sample.rows === 1 ? "" : "s"}.` : "The system answered, but not with rows BPMSquare can read.";
    if (!sample) { ok_ = false; fix = "Check the path, and that it returns JSON."; }
  }

  const at = new Date().toISOString();
  await ctx.admin.from(ENDPOINTS_TABLE).update({ last_run_at: at, last_run_status: ok_ ? "ok" : "failed", last_run_message: message.slice(0, 300) }).eq("id", e.row.id).eq("tenant_id", ctx.tenantId);
  await recordMessage(ctx.admin, {
    tenantId: ctx.tenantId, direction: "in", channel: "connector", connectorId: `conn:${c.row.id}`, entity: e.row.object_type,
    status: ok_ ? "ok" : "failed", httpStatus, error: ok_ ? null : message, durationMs: o.ms,
    summary: { kind: "endpoint_try", headline: `${e.row.name}: ${message}`, counterpart: c.row.name, endpoint: e.row.name, operation: operationLine(c.row.family, { method: e.row.method, path: e.row.path, direction: e.row.direction }), rows: sample?.rows ?? null, ...(fix ? { fix } : {}) },
  });
  return ok({ result: { ok: ok_, message, fix, rows: sample?.rows ?? null, fields: sample?.fields ?? [] } });
}
