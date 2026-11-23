import "server-only";
import { assertSafeHttpsUrl } from "@/lib/net/safeHost";
import { describeNetworkError } from "./plain";
import {
  CONNECTIONS_BUNDLE, createConnection, deleteConnection, getRow, isUuid, listConnections, loadLive, saveTestResult, toLive, tokenStore, updateConnection, type StoreCtx,
} from "./store";
import {
  parseConnectionInput, SECRET_FOR_AUTH, SECRET_KEYS, type ConnectionInput, type FieldError, type SecretKey, type TestResult,
} from "./spec";
import { runConnectionTest } from "./test";

// What the /api/middleware/custom/connections routes do, away from Next so the same functions are tested. Each takes the guard's
// context (admin of this host's workspace, flag on) and answers { status, body }. The tenant is the session's, never a request's.

export type Out = { status: number; body: Record<string, unknown> };
const ok = (body: Record<string, unknown>): Out => ({ status: 200, body });
const err = (status: number, error: string, extra: Record<string, unknown> = {}): Out => ({ status, body: { error, ...extra } });
const pendingOut = (): Out => ({ status: 200, body: { needsDatabaseUpdate: true, bundle: CONNECTIONS_BUNDLE } });
const fieldsOut = (errors: FieldError[]): Out => err(422, errors[0]?.message ?? "Check the fields.", { errors });

const notFound = () => err(404, "Connection not found.");

/** The address checks that need the network (DNS), on the addresses a person typed. */
async function addressProblem(urls: (string | undefined)[]): Promise<TestResult | null> {
  for (const u of urls) {
    if (!u) continue;
    try { await assertSafeHttpsUrl(u); } catch (e) { return describeNetworkError(e); }
  }
  return null;
}

export async function list(ctx: StoreCtx): Promise<Out> {
  const r = await listConnections(ctx.admin, ctx.tenantId);
  if (r.pending) return pendingOut();
  return ok({ connections: r.items });
}

export async function get(ctx: StoreCtx, id: string): Promise<Out> {
  const { pending, row } = await getRow(ctx.admin, ctx.tenantId, id);
  if (pending) return pendingOut();
  if (!row) return notFound();
  const all = await listConnections(ctx.admin, ctx.tenantId);
  return ok({ connection: all.items.find((c) => c.id === row.id) ?? null });
}

export async function create(ctx: StoreCtx, body: ConnectionInput): Promise<Out> {
  const parsed = parseConnectionInput(body);
  if (!parsed.ok) return fieldsOut(parsed.errors);
  const bad = await addressProblem([parsed.config.base_url, parsed.config.oauth_provider === "custom" ? parsed.config.token_url : undefined]);
  if (bad) return err(422, bad.message, { errors: [{ field: "base_url", message: bad.message }], fix: bad.fix });
  const r = await createConnection(ctx, parsed);
  if (!r.ok) return err(r.status, r.error, r.field ? { errors: [{ field: r.field, message: r.error }] } : {});
  return ok({ connection: r.connection });
}

export async function update(ctx: StoreCtx, id: string, body: ConnectionInput): Promise<Out> {
  const { pending, row } = await getRow(ctx.admin, ctx.tenantId, id);
  if (pending) return pendingOut();
  if (!row) return notFound();
  const parsed = parseConnectionInput(body, { config: row.config, has: Object.fromEntries(SECRET_KEYS.filter((k) => row.secrets?.[k]).map((k) => [k, true])) });
  if (!parsed.ok) return fieldsOut(parsed.errors);
  const bad = await addressProblem([parsed.config.base_url, parsed.config.oauth_provider === "custom" ? parsed.config.token_url : undefined]);
  if (bad) return err(422, bad.message, { errors: [{ field: "base_url", message: bad.message }], fix: bad.fix });
  const r = await updateConnection(ctx, row, parsed);
  if (!r.ok) return err(r.status, r.error, r.field ? { errors: [{ field: r.field, message: r.error }] } : {});
  return ok({ connection: r.connection });
}

export async function remove(ctx: StoreCtx, id: string): Promise<Out> {
  const { pending, row } = await getRow(ctx.admin, ctx.tenantId, id);
  if (pending) return pendingOut();
  if (!row) return notFound();
  await deleteConnection(ctx, row);
  return ok({ ok: true });
}

/** Test a connection that is saved: the result is kept on the row, so the table's chip shows it. */
export async function testSaved(ctx: StoreCtx, id: string): Promise<Out> {
  const { pending, live } = await loadLive(ctx.admin, ctx.tenantId, id);
  if (pending) return pendingOut();
  if (!live) return notFound();
  const result = await runConnectionTest(live, live.config.auth === "oauth2_cc" ? tokenStore(ctx.admin, ctx.tenantId, id) : undefined);
  await saveTestResult(ctx.admin, ctx.tenantId, id, result);
  const all = await listConnections(ctx.admin, ctx.tenantId);
  return ok({ result, connection: all.items.find((c) => c.id === id) ?? null });
}

/**
 * Test what is on screen before it is saved (step 3 of the panel). Nothing is stored. When `id` names a saved connection, a blank
 * secret is filled from the stored one, so editing an address does not need the secret again.
 */
export async function testDraft(ctx: StoreCtx, body: ConnectionInput & { id?: unknown }): Promise<Out> {
  let stored: Awaited<ReturnType<typeof getRow>>["row"] = null;
  if (body.id !== undefined && body.id !== null && body.id !== "") {
    if (!isUuid(body.id)) return notFound();
    const r = await getRow(ctx.admin, ctx.tenantId, body.id);
    if (r.pending) return pendingOut();
    if (!r.row) return notFound();
    stored = r.row;
  }
  const parsed = parseConnectionInput(body, stored ? { config: stored.config, has: Object.fromEntries(SECRET_KEYS.filter((k) => stored!.secrets?.[k]).map((k) => [k, true])) } : null);
  if (!parsed.ok) return fieldsOut(parsed.errors);
  const secrets = { ...parsed.secrets };
  const need: SecretKey | null = SECRET_FOR_AUTH[parsed.config.auth];
  if (need && !secrets[need] && stored) {
    const live = toLive(ctx.tenantId, stored);
    if (live.secrets[need]) secrets[need] = live.secrets[need];
  }
  const result = await runConnectionTest({ id: stored?.id ?? "draft", tenantId: ctx.tenantId, family: parsed.family, config: parsed.config, secrets });
  return ok({ result });
}
