import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSchemaPending } from "@/lib/marketing/pending";
import type { TenantConfig, TenantFeatures } from "@/lib/constants";
import { CONNECTOR_ID, loadD365, previewEntity, publicState, runPull, runPushFenceProjects, testConnection, markStatus } from "@/lib/connectors/d365/server";
import { entityConfig, outboundConfig } from "@/lib/connectors/d365/catalog";
import { selectionSupport, type RunSelection } from "@/lib/connectors/d365/selection";
import { hasScope, scopeSummary } from "@/lib/connectors/d365/scope";
import { ordersSchemaReady } from "@/lib/connectors/d365/orders";
import { ERP_DOCUMENTS_BUNDLE } from "@/lib/salesOrders/erpDocs";
import { D365_ENTITY_KEYS, D365_ENTITY_LABEL, D365_ENTITY_TARGET, type D365Config, type D365EntityKey, type D365PublicState } from "@/lib/connectors/d365/types";
import { pushAccountToErp } from "@/lib/accountPush";
import { middlewareClient } from "./client";
import { dispatchQuoteOutcome, type DispatchResult } from "./dispatch";
import { parseRules } from "./rules";
import { selectionContract, resolveTarget } from "./contract";
import { documentView, legacyToDocument, mergeDocument, readDocument, storeDocument, targetOptions, validateDocumentPatch, type DocumentView, type FieldError } from "./documents";
import type { ErpHttp } from "./erp";
import { PRODUCT_NAME } from "./links";
import { recordMessage } from "./messages";
import { NOT_CHECKED, REQUIRED_TABLES, parseCurrencies, parsePriceLists, privilegeVerdict, probeResult, schemaRows, secretExpiry, userAccess, type PermissionCheck, type PickItem } from "./health";
import { listCallWebhooks, verifyCallWebhook } from "@/lib/webhooks/library";
import { sendAccountViaWebhook, webhooksLibraryOn } from "@/lib/webhooks/recordSend";
import { SQL_BUNDLES, TARGET_LABEL, type IntegrationMiddlewareConfig, type SelectionContract, type TargetKind } from "./types";

// Everything the middleware page asks of the server that is not the engine or
// the monitor. Each function takes the tenant id from the caller's session and
// names it in every query.

export async function flagOn(admin: SupabaseClient, tenantId: string): Promise<boolean> {
  const { data } = await admin.from("tenants").select("features").eq("id", tenantId).maybeSingle();
  return (data?.features as TenantFeatures | undefined)?.integration_middleware === true;
}

// ── Rules (the older /rules view) ───────────────────────────────────────────

export type RulesView = IntegrationMiddlewareConfig & {
  /** What the connected product receives, and which options it can take. */
  contract: SelectionContract;
  product: { key: string; name: string } | null;
  /** "Quote" or "Project": what an awarded quote becomes there. */
  awarded_target: string | null;
  /** What a rejected quote does. Since round 2 a rejected quote is never sent. */
  rejected_target: string | null;
};

type Stored = TenantConfig["integration_middleware"];

export async function getRules(admin: SupabaseClient, tenantId: string): Promise<RulesView> {
  const [{ data: t }, loaded] = await Promise.all([admin.from("tenants").select("config").eq("id", tenantId).maybeSingle(), loadD365(admin, tenantId)]);
  const stored = (t?.config as TenantConfig | null)?.integration_middleware;
  return rulesView(parseRules(stored), loaded?.cfg.product ?? null, readDocument(stored).target);
}

export function rulesView(rules: IntegrationMiddlewareConfig, product: D365Config["product"] | null, storedTarget: TargetKind | null = null): RulesView {
  const target = product ? resolveTarget(product, storedTarget) : null;
  return {
    ...rules,
    contract: selectionContract(target),
    product: product ? { key: product, name: PRODUCT_NAME[product] } : null,
    awarded_target: target ? TARGET_LABEL[target] : null,
    rejected_target: product ? "Never sent" : null,
  };
}

/** The older rules save: the document is updated from them, and everything is stored in step, so /rules and the Quote document are one set of data. */
export async function saveRules(admin: SupabaseClient, tenantId: string, rules: IntegrationMiddlewareConfig): Promise<RulesView> {
  const { data: t } = await admin.from("tenants").select("config").eq("id", tenantId).maybeSingle();
  const config = ((t?.config ?? {}) as TenantConfig);
  const prev = readDocument(config.integration_middleware);
  const stored: Stored = storeDocument(config.integration_middleware, legacyToDocument(rules, prev), rules.payload_capture);
  await admin.from("tenants").update({ config: { ...config, integration_middleware: stored } }).eq("id", tenantId);
  const loaded = await loadD365(admin, tenantId);
  return rulesView(rules, loaded?.cfg.product ?? null, prev.target);
}

// ── The Quote document ──────────────────────────────────────────────────────

type DocContext = ReturnType<typeof baseDocumentContext> & { webhooks: { id: string; name: string }[] | null };

function baseDocumentContext(cfg: D365Config | null) {
  const out = cfg ? outboundConfig(cfg) : null;
  return {
    product: cfg?.product ?? null,
    projectEntitySet: out?.project.entity_set || null,
    salesOrderEntitySet: out?.sales_order.entity_set || null,
    fallbackPriceListId: cfg?.price_list_id ?? null,
  };
}

/** The ERP-side context plus, for a workspace with the webhooks library, its Call webhooks for Standard Quotes (null otherwise: nothing new shows). */
async function documentContext(admin: SupabaseClient, tenantId: string, cfg: D365Config | null, features: TenantFeatures | null | undefined): Promise<DocContext> {
  return { ...baseDocumentContext(cfg), webhooks: features?.webhooks_library === true ? await listCallWebhooks(admin, tenantId, "standard_quotes") : null };
}

export async function getDocuments(admin: SupabaseClient, tenantId: string): Promise<{ documents: DocumentView[]; webhooks: { id: string; name: string }[] }> {
  const [{ data: t }, loaded] = await Promise.all([admin.from("tenants").select("config, features").eq("id", tenantId).maybeSingle(), loadD365(admin, tenantId)]);
  const doc = readDocument((t?.config as TenantConfig | null)?.integration_middleware);
  const ctx = await documentContext(admin, tenantId, loaded?.cfg ?? null, t?.features as TenantFeatures | null);
  return { documents: [documentView(doc, ctx)], webhooks: ctx.webhooks ?? [] };
}

export type SaveDocumentResult = { ok: true; document: DocumentView } | { ok: false; errors: FieldError[] };

/** Save the Quote document. The first successful save confirms it (the set-up tick waits for that). The fallback
 *  price list is a Dynamics id and lives on the connection; everything else lives on the document. */
export async function saveDocument(admin: SupabaseClient, tenantId: string, body: unknown, now: Date = new Date()): Promise<SaveDocumentResult> {
  const [{ data: t }, loaded] = await Promise.all([admin.from("tenants").select("config, features").eq("id", tenantId).maybeSingle(), loadD365(admin, tenantId)]);
  const config = ((t?.config ?? {}) as TenantConfig);
  const cur = readDocument(config.integration_middleware);
  const ctx = await documentContext(admin, tenantId, loaded?.cfg ?? null, t?.features as TenantFeatures | null);
  const checked = validateDocumentPatch(body, { product: ctx.product, targets: targetOptions(ctx), current: cur });
  if (!checked.ok) return checked;
  // The webhook id is resolved against this workspace, its kind and its object before it is stored: a foreign or wrong-kind id is refused.
  const willBeWebhook = (checked.value.target ?? cur.target) === "webhook";
  if (willBeWebhook) {
    const id = checked.value.webhook_id !== undefined ? checked.value.webhook_id : cur.webhook_id ?? null;
    if (!(await verifyCallWebhook(admin, tenantId, id, "standard_quotes"))) return { ok: false, errors: [{ field: "webhook_id", message: "Choose a webhook for Standard Quotes from the list." }] };
  }
  if (checked.value.fallbackPriceListId !== undefined && !loaded) return { ok: false, errors: [{ field: "fallbackPriceListId", message: "Connect Dynamics first." }] };

  const next = mergeDocument(cur, checked.value, now);
  const stored: Stored = storeDocument(config.integration_middleware, next);
  await admin.from("tenants").update({ config: { ...config, integration_middleware: stored } }).eq("id", tenantId);

  let cfg = loaded?.cfg ?? null;
  const viewCtx = ctx;
  if (loaded && checked.value.fallbackPriceListId !== undefined) {
    const nextCfg: D365Config = { ...loaded.cfg };
    if (checked.value.fallbackPriceListId) nextCfg.price_list_id = checked.value.fallbackPriceListId;
    else delete nextCfg.price_list_id;
    await admin.from("tenant_connectors").update({ config: nextCfg as unknown as Record<string, string>, updated_at: now.toISOString() }).eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID);
    cfg = nextCfg;
  }
  return { ok: true, document: documentView(next, { ...viewCtx, ...baseDocumentContext(cfg), webhooks: ctx.webhooks }) };
}

// ── Connections tab ─────────────────────────────────────────────────────────

export async function connectionList(admin: SupabaseClient, tenantId: string): Promise<{ id: string; label: string; kind: "erp"; state: D365PublicState }[]> {
  return [{ id: CONNECTOR_ID, label: "Microsoft Dynamics 365 / Business Central", kind: "erp", state: publicState(await loadD365(admin, tenantId)) }];
}

export async function testConnectionOp(admin: SupabaseClient, tenantId: string): Promise<{ ok: true; message: string } | { ok: false; error: string; status: number }> {
  const row = await loadD365(admin, tenantId);
  if (!row) return { ok: false, error: "Save the connection first.", status: 400 };
  try {
    const message = await testConnection(admin, tenantId, row.cfg, row.creds);
    await markStatus(admin, tenantId, true);
    return { ok: true, message };
  } catch (e) {
    const msg = (e as Error).message ?? "Test failed";
    await markStatus(admin, tenantId, false, msg);
    return { ok: false, error: msg, status: 400 };
  }
}

export type HealthProblem = { kind: "database" | "connection" | "secret"; message: string; bundle?: string };

/** Only what needs attention. An empty `problems` means nothing to show: no list of tables that are fine. The secret's
 *  expiry shows only when it is within 30 days (`secretSoon`), or as a problem once it has passed. Price list and currency
 *  are not requirements any more (they are decided per send). */
export async function health(admin: SupabaseClient, tenantId: string) {
  const exists: Record<string, boolean> = {};
  await Promise.all(REQUIRED_TABLES.map(async ({ table }) => {
    const { error } = await admin.from(table).select("tenant_id").eq("tenant_id", tenantId).limit(1);
    exists[table] = !isSchemaPending(error);
  }));
  const schema = schemaRows(exists);
  const loaded = exists.tenant_connectors ? await loadD365(admin, tenantId) : null;
  const state = publicState(loaded);

  const problems: HealthProblem[] = [];
  const missing = schema.filter((r) => !r.exists);
  for (const bundle of [...new Set(missing.map((r) => r.bundle).filter((b): b is string => !!b))]) {
    problems.push({ kind: "database", message: `A database update is needed (${missing.filter((r) => r.bundle === bundle).map((r) => r.label).join(", ")}).`, bundle });
  }
  if (state.config && state.status === "error") problems.push({ kind: "connection", message: state.last_error || "The connection needs attention. Press Test." });
  const secret = secretExpiry(state.config?.secret_expires_on);
  if (secret.state === "expired") problems.push({ kind: "secret", message: "The Dynamics client secret has expired. Create a new one and save it under Edit." });
  return {
    problems,
    ...(secret.state === "soon" && secret.days_left !== null ? { secretSoon: { days: secret.days_left } } : {}),
    connection: { connected: state.status === "connected", product: state.config ? { key: state.config.product, name: PRODUCT_NAME[state.config.product] } : null },
  };
}

export type PickResult = { applicable: boolean; items: PickItem[]; hint?: string } | { error: string; status: number };

async function dataverseList(admin: SupabaseClient, tenantId: string, set: string, query: Record<string, string>, parse: (j: unknown) => PickItem[]): Promise<PickResult> {
  const loaded = await loadD365(admin, tenantId);
  if (!loaded) return { error: "Connect your ERP first.", status: 400 };
  if (loaded.cfg.product !== "dataverse") return { applicable: false, items: [], hint: "Only Dynamics 365 Sales needs a price list and a currency." };
  try {
    const client = await middlewareClient(admin, tenantId, loaded.cfg, loaded.creds);
    return { applicable: true, items: parse(await client.get(set, query)) };
  } catch (e) {
    return { error: (e as Error).message || "The ERP did not answer.", status: 400 };
  }
}

export const listPriceLists = (admin: SupabaseClient, tenantId: string) =>
  dataverseList(admin, tenantId, "pricelevels", { $select: "name,pricelevelid,statecode", $filter: "statecode eq 0", $orderby: "name asc" }, parsePriceLists);

export const listCurrencies = (admin: SupabaseClient, tenantId: string) =>
  dataverseList(admin, tenantId, "transactioncurrencies", { $select: "currencyname,isocurrencycode,transactioncurrencyid,statecode", $filter: "statecode eq 0" }, parseCurrencies);

/** What the connected app user can and cannot do: read probes, and for Dynamics Sales a look-up of the create and
 *  close privileges. Creates nothing. A privilege is never reported as missing on this evidence alone (a role can
 *  reach the app user through a team or a business unit this look-up does not see): it is either confirmed, or
 *  "not checked, use Send a test quote". */
export async function checkPermissions(admin: SupabaseClient, tenantId: string, opts: { http?: Pick<ErpHttp, "get"> } = {}): Promise<{ checks: PermissionCheck[] } | { error: string; status: number }> {
  const loaded = await loadD365(admin, tenantId);
  if (!loaded) return { error: "Connect your ERP first.", status: 400 };
  const { cfg, creds } = loaded;
  let client: Pick<ErpHttp, "get">;
  if (opts.http) client = opts.http;
  else {
    const made = await middlewareClient(admin, tenantId, cfg, creds).catch((e: Error) => e);
    if (made instanceof Error) return { error: made.message, status: 400 };
    client = made;
  }
  const checks: PermissionCheck[] = [];
  const probe = async (id: string, label: string, run: () => Promise<unknown>) => {
    try { await run(); checks.push(probeResult(id, label, null)); } catch (e) { checks.push(probeResult(id, label, e as { status?: number; message?: string })); }
  };
  const read = (key: D365EntityKey, label: string) => {
    const ec = entityConfig(cfg, key);
    return probe(`read_${key}`, label, () => client.get(ec?.entity_set ?? "", { $top: "1", $select: ec?.id_field || undefined }));
  };
  await read("customers", "Read customers");
  await read("contacts", "Read contacts");
  await read("products", "Read products");

  if (cfg.product === "dataverse") {
    await probe("read_price_lists", "Read price lists", () => client.get("pricelevels", { $top: "1", $select: "pricelevelid" }));
    await probe("read_quotes", "Read quotes", () => client.get("quotes", { $top: "1", $select: "quoteid" }));
    // The app user is its OWN systemuser (WhoAmI answers for it, not for any signed-in person); its roles and
    // privileges are looked up once and every create / close check reads from that.
    const who = await userAccess(client, ["prvCreateQuote", "prvWriteQuote", "prvCreateQuoteClose", "prvCreateSalesOrder"]);
    for (const [id, label, privs] of [
      ["create_quote", "Create quotes", ["prvCreateQuote"]],
      ["close_quote", "Mark quotes won or lost", ["prvWriteQuote", "prvCreateQuoteClose"]],
      ["create_order", "Create sales orders", ["prvCreateSalesOrder"]],
    ] as const) {
      checks.push(privilegeVerdict(who, privs) ? { id, label, ok: true, fix: null } : { id, label, ok: null, fix: NOT_CHECKED });
    }
  } else {
    const set = outboundConfig(cfg).project.entity_set;
    if (set) await probe("read_projects", "Read projects", () => client.get(set, { $top: "1" }));
    checks.push({ id: "create_project", label: "Create projects", ok: null, fix: NOT_CHECKED });
  }
  return { checks };
}

/** Test connection, then the permission probes, as ONE answer: a plain line, and only what failed. */
export async function connectionCheck(admin: SupabaseClient, tenantId: string, opts: { http?: Pick<ErpHttp, "get"> } = {}): Promise<{ ok: boolean; line: string; failures: { label: string; fix: string }[]; status: number; message?: string; error?: string }> {
  const conn = await testConnectionOp(admin, tenantId);
  if (!conn.ok) return { ok: false, line: conn.error, failures: [{ label: "Connection", fix: conn.error }], status: conn.status, error: conn.error };
  const perms = await checkPermissions(admin, tenantId, opts);
  if ("error" in perms) return { ok: false, line: perms.error, failures: [{ label: "Permissions", fix: perms.error }], status: 200, message: conn.message };
  const failures = perms.checks.filter((c) => c.ok === false).map((c) => ({ label: c.label, fix: c.fix ?? "Give the app user a role that includes this, then test again." }));
  const unchecked = perms.checks.filter((c) => c.ok === null).length;
  const line = failures.length
    ? `Connected, but ${failures.length === 1 ? "1 thing needs" : `${failures.length} things need`} fixing.`
    : unchecked ? `Connected. Everything checked is fine; ${unchecked} ${unchecked === 1 ? "check" : "checks"} can only be proved by sending a test quote.` : "Connected. Everything checked is fine.";
  return { ok: failures.length === 0, line, failures, status: 200, message: conn.message };
}

// ── Sync (Resync tab and Mapping tab) ───────────────────────────────────────

const SCOPE_PLURAL: Record<D365EntityKey, string> = { customers: "customers", contacts: "contacts", vendors: "vendors", products: "products", projects: "projects", fence_projects: "fence projects", sales_orders: "sales orders" };

export const SYNC_SCHEDULES = ["off", "hourly", "daily"] as const;
export type SyncSchedule = (typeof SYNC_SCHEDULES)[number];

export async function syncOverview(admin: SupabaseClient, tenantId: string) {
  const loaded = await loadD365(admin, tenantId);
  if (!loaded) return { connected: false as const, entities: [] };
  const { cfg } = loaded;
  const { data: runs, error } = await admin.from("connector_sync_runs").select("entity, status, trigger, started_at, finished_at, counts, error")
    .eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID).order("started_at", { ascending: false }).limit(200);
  const latest = new Map<string, Record<string, unknown>>();
  const running = new Set<string>();
  for (const r of (runs ?? []) as Record<string, unknown>[]) {
    const e = String(r.entity);
    if (!latest.has(e)) latest.set(e, r);
    if (r.status === "running") running.add(e);
  }
  // Sales orders are read from Dataverse only; for the other products the entity does not exist and is not listed.
  const listed = D365_ENTITY_KEYS.filter((key) => key !== "sales_orders" || !!entityConfig(cfg, key));
  const ordersReady = listed.includes("sales_orders") ? await ordersSchemaReady(admin, tenantId) : true;
  const entities = await Promise.all(listed.map(async (key) => {
    const ec = entityConfig(cfg, key);
    const { count } = await admin.from("connector_links").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID).eq("entity", key);
    const run = latest.get(key) ?? null;
    return {
      key, label: D365_ENTITY_LABEL[key], direction: D365_ENTITY_TARGET[key].direction, enabled: ec?.enabled === true, entity_set: ec?.entity_set ?? null,
      schedule: (ec?.schedule ?? cfg.schedule) as SyncSchedule, schedule_source: ec?.schedule ? ("entity" as const) : ("connector" as const),
      running: running.has(key), linked: count ?? 0, filters: selectionSupport(cfg.product, ec),
      blocked: key === "sales_orders" && !ordersReady ? `A database update is needed first (${ERP_DOCUMENTS_BUNDLE}).` : null,
      scope: key === "fence_projects" || key === "sales_orders" ? null : { summary: scopeSummary(ec?.scope, SCOPE_PLURAL[key]), narrowed: hasScope(ec?.scope), needs_full: hasScope(ec?.scope) && ec?.scope?.needs_full === true },
      last_run: run ? { status: run.status, trigger: run.trigger, started_at: run.started_at, finished_at: run.finished_at, counts: run.counts, error: run.error } : null,
    };
  }));
  return { connected: true as const, product: { key: cfg.product, name: PRODUCT_NAME[cfg.product] }, pending_migration: !!error, entities };
}

export async function setEntitySchedule(admin: SupabaseClient, tenantId: string, entity: D365EntityKey, schedule: SyncSchedule): Promise<{ ok: true; schedule: SyncSchedule } | { ok: false; error: string; status: number }> {
  const loaded = await loadD365(admin, tenantId);
  if (!loaded) return { ok: false, error: "Connect your ERP first.", status: 400 };
  const ec = entityConfig(loaded.cfg, entity);
  if (!ec) return { ok: false, error: "That entity is not available for this product.", status: 422 };
  // Stored as a full entity config, like any map the connector screen saves, so the
  // connector route's own validation keeps it.
  const entities = { ...loaded.cfg.entities, [entity]: { ...ec, schedule } };
  const { error } = await admin.from("tenant_connectors").update({ config: { ...loaded.cfg, entities } as unknown as Record<string, string>, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID);
  if (error) return { ok: false, error: error.message, status: 500 };
  return { ok: true, schedule };
}

/** `select` (already checked by parseSelection) narrows a pull to some records; it is ignored by the fence-project push, whose `ids` are its own. */
export async function resync(admin: SupabaseClient, tenantId: string, userId: string, entity: D365EntityKey, opts: { full?: boolean; ids?: string[]; select?: RunSelection }) {
  return entity === "fence_projects"
    ? runPushFenceProjects(admin, tenantId, { trigger: "manual", userId, ids: opts.ids })
    : runPull(admin, tenantId, entity, { trigger: "manual", userId, full: opts.full === true, select: opts.select });
}

export async function previewEntityRows(admin: SupabaseClient, tenantId: string, entity: D365EntityKey): Promise<{ rows: Record<string, unknown>[] } | { error: string; status: number }> {
  const row = await loadD365(admin, tenantId);
  if (!row) return { error: "Connect your ERP first.", status: 400 };
  try {
    return { rows: await previewEntity(admin, tenantId, row.cfg, row.creds, entity) };
  } catch (e) {
    return { error: (e as Error).message ?? "Preview failed", status: 400 };
  }
}

// ── Send a record ───────────────────────────────────────────────────────────

export const SENDABLE_OBJECTS = ["accounts", "standard_quotes"] as const;
export type SendableObject = (typeof SENDABLE_OBJECTS)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SendRecordResult =
  | { ok: true; message: string; number?: string | null; link?: string | null }
  | { ok: false; status: number; headline: string; fix: string | null; needsDatabaseUpdate?: boolean };

export function describeDispatch(r: DispatchResult): SendRecordResult {
  switch (r.state) {
    case "sent": return { ok: true, message: r.number ? `Sent. The ERP number is ${r.number}.` : "Sent.", number: r.number, link: r.link };
    case "already_sent": return { ok: true, message: r.number ? `Already in the ERP as ${r.number}. Nothing was sent twice.` : "Already in the ERP. Nothing was sent twice.", number: r.number, link: r.link };
    case "waiting": return { ok: true, message: "Waiting for you to send it." };
    case "in_progress": return { ok: true, message: "This quote is already being sent. Nothing was sent twice." };
    case "skipped": return { ok: true, message: r.headline };
    case "failed": return { ok: false, status: 422, headline: r.headline, fix: r.fix };
    case "needs_database_update": return { ok: false, status: 200, headline: "A database update is needed first.", fix: `Run ${SQL_BUNDLES.middleware} once.`, needsDatabaseUpdate: true };
    case "not_found": return { ok: false, status: 404, headline: "That record was not found.", fix: null };
    case "disabled": return { ok: false, status: 409, headline: r.reason, fix: null };
  }
}

/** "Send a record": object type + id, verified against the tenant, then sent the
 *  way that object is sent. The id alone never selects a row. */
export async function sendRecord(admin: SupabaseClient, tenantId: string, userId: string, objectType: string, id: string): Promise<SendRecordResult> {
  if (!(SENDABLE_OBJECTS as readonly string[]).includes(objectType)) {
    return { ok: false, status: 422, headline: `Choose one of: ${SENDABLE_OBJECTS.join(", ")}.`, fix: null };
  }
  if (!UUID_RE.test(id)) return { ok: false, status: 422, headline: "That is not a record id.", fix: null };

  if (objectType === "standard_quotes") return describeDispatch(await dispatchQuoteOutcome(admin, tenantId, id, { trigger: "send_now", userId }));

  const { data: feat } = await admin.from("tenants").select("features").eq("id", tenantId).maybeSingle();
  if (webhooksLibraryOn(feat?.features as TenantFeatures | null)) {
    // The library records its own Monitor row for the call.
    const sent = await sendAccountViaWebhook(admin, tenantId, userId, id);
    if (sent.kind === "not_found") return { ok: false, status: 404, headline: "That account was not found.", fix: null };
    if (sent.kind === "none") return { ok: false, status: 422, headline: "No webhook is chosen for accounts.", fix: "Choose one under Settings > Webhooks." };
    const r = sent.result;
    if (r.needsDatabaseUpdate) return { ok: false, status: 200, headline: r.headline, fix: r.fix, needsDatabaseUpdate: true };
    if (r.ok) return { ok: true, message: r.redirected ? "Demo workspace: nothing was sent." : "The account was sent." };
    return { ok: false, status: r.skipped ? 409 : 422, headline: r.headline, fix: r.fix };
  }

  const t0 = Date.now();
  const res = await pushAccountToErp(admin, tenantId, id);
  if (res.ok) {
    await recordMessage(admin, { tenantId, direction: "out", channel: "webhook", entity: "accounts", objectType: "accounts", objectId: id, status: "ok", durationMs: Date.now() - t0, summary: { headline: "Account sent to your ERP endpoint.", trigger: "send_now" } });
    return { ok: true, message: "The account was sent." };
  }
  if (res.status === 404) return { ok: false, status: 404, headline: "That account was not found.", fix: null };
  await recordMessage(admin, { tenantId, direction: "out", channel: "webhook", entity: "accounts", objectType: "accounts", objectId: id, status: "failed", error: res.error, durationMs: Date.now() - t0, summary: { headline: "The account could not be sent.", fix: "Check the ERP push address, then send again.", trigger: "send_now" } });
  return { ok: false, status: 422, headline: "The account could not be sent.", fix: "Check the ERP push address under Other lanes, then send again." };
}

