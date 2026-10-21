import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSchemaPending } from "@/lib/marketing/pending";
import type { TenantConfig, TenantFeatures } from "@/lib/constants";
import { CONNECTOR_ID, loadD365, previewEntity, publicState, runPull, runPushFenceProjects, testConnection, markStatus } from "@/lib/connectors/d365/server";
import { entityConfig, outboundConfig } from "@/lib/connectors/d365/catalog";
import { D365_ENTITY_KEYS, D365_ENTITY_LABEL, D365_ENTITY_TARGET, type D365Config, type D365EntityKey, type D365PublicState } from "@/lib/connectors/d365/types";
import { pushAccountToErp } from "@/lib/accountPush";
import { middlewareClient } from "./client";
import { dispatchQuoteOutcome, type DispatchResult } from "./dispatch";
import { parseRules } from "./rules";
import { selectionContract, targetFor } from "./contract";
import { PRODUCT_NAME, TARGET_NAME } from "./links";
import { recordMessage } from "./messages";
import { REQUIRED_TABLES, parseCurrencies, parsePriceLists, probeResult, schemaRows, secretExpiry, type PermissionCheck, type PickItem } from "./health";
import { SQL_BUNDLES, type IntegrationMiddlewareConfig, type SelectionContract } from "./types";

// Everything the middleware page asks of the server that is not the engine or
// the monitor. Each function takes the tenant id from the caller's session and
// names it in every query.

export async function flagOn(admin: SupabaseClient, tenantId: string): Promise<boolean> {
  const { data } = await admin.from("tenants").select("features").eq("id", tenantId).maybeSingle();
  return (data?.features as TenantFeatures | undefined)?.integration_middleware === true;
}

// ── Rules ───────────────────────────────────────────────────────────────────

export type RulesView = IntegrationMiddlewareConfig & {
  /** What the connected product receives, and which options it can take. */
  contract: SelectionContract;
  product: { key: string; name: string } | null;
  /** "Quote" or "Project": what an awarded quote becomes there. */
  awarded_target: string | null;
  /** What a rejected quote does: closes the quote, or sends nothing. */
  rejected_target: string | null;
};

export async function getRules(admin: SupabaseClient, tenantId: string): Promise<RulesView> {
  const [{ data: t }, loaded] = await Promise.all([admin.from("tenants").select("config").eq("id", tenantId).maybeSingle(), loadD365(admin, tenantId)]);
  const rules = parseRules((t?.config as TenantConfig | null)?.integration_middleware);
  return rulesView(rules, loaded?.cfg.product ?? null);
}

export function rulesView(rules: IntegrationMiddlewareConfig, product: D365Config["product"] | null): RulesView {
  return {
    ...rules,
    contract: selectionContract(targetFor(product)),
    product: product ? { key: product, name: PRODUCT_NAME[product] } : null,
    awarded_target: product ? TARGET_NAME[product] : null,
    rejected_target: product ? (product === "dataverse" ? "Closes the quote as lost" : "Sends nothing") : null,
  };
}

export async function saveRules(admin: SupabaseClient, tenantId: string, rules: IntegrationMiddlewareConfig): Promise<RulesView> {
  const { data: t } = await admin.from("tenants").select("config").eq("id", tenantId).maybeSingle();
  const config = ((t?.config ?? {}) as TenantConfig);
  await admin.from("tenants").update({ config: { ...config, integration_middleware: rules } }).eq("id", tenantId);
  const loaded = await loadD365(admin, tenantId);
  return rulesView(rules, loaded?.cfg.product ?? null);
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

export async function health(admin: SupabaseClient, tenantId: string) {
  const exists: Record<string, boolean> = {};
  await Promise.all(REQUIRED_TABLES.map(async ({ table }) => {
    const { error } = await admin.from(table).select("tenant_id").eq("tenant_id", tenantId).limit(1);
    exists[table] = !isSchemaPending(error);
  }));
  const schema = schemaRows(exists);
  const loaded = exists.tenant_connectors ? await loadD365(admin, tenantId) : null;
  const state = publicState(loaded);
  return {
    connection: {
      connected: state.status === "connected",
      state: state.status,
      last_error: state.last_error,
      product: state.config ? { key: state.config.product, name: PRODUCT_NAME[state.config.product] } : null,
      price_list_chosen: !!state.config?.price_list_id,
      currency_chosen: !!state.config?.currency_id,
    },
    secret: secretExpiry(state.config?.secret_expires_on),
    schema,
    needsDatabaseUpdate: schema.some((r) => !r.exists),
    bundles: [...new Set(schema.filter((r) => !r.exists).map((r) => r.bundle))],
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

/** Read probes and a privilege lookup. Creates nothing. */
export async function checkPermissions(admin: SupabaseClient, tenantId: string): Promise<{ checks: PermissionCheck[] } | { error: string; status: number }> {
  const loaded = await loadD365(admin, tenantId);
  if (!loaded) return { error: "Connect your ERP first.", status: 400 };
  const { cfg, creds } = loaded;
  const client = await middlewareClient(admin, tenantId, cfg, creds).catch((e: Error) => e);
  if (client instanceof Error) return { error: client.message, status: 400 };
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
    // Creating and closing a quote are privileges of the app user's role; look them up without writing.
    for (const [id, label, priv] of [["create_quote", "Create quotes", "prvCreateQuote"], ["close_quote", "Mark quotes won or lost", "prvWriteQuote"]] as const) {
      try {
        const who = (await client.get("WhoAmI")) as { UserId?: string };
        const p = (await client.get("privileges", { $select: "privilegeid", $filter: `name eq '${priv}'`, $top: "1" })) as { value?: { privilegeid?: string }[] };
        const privId = p.value?.[0]?.privilegeid;
        if (!who.UserId || !privId) { checks.push({ id, label, ok: null, fix: "Could not check this from here. Use Send a test quote." }); continue; }
        const has = (await client.get(`systemusers(${who.UserId})/Microsoft.Dynamics.CRM.RetrieveUserPrivileges`)) as { value?: { PrivilegeId?: string }[] };
        const ok = (has.value ?? []).some((x) => x.PrivilegeId?.toLowerCase() === privId.toLowerCase());
        checks.push({ id, label, ok, fix: ok ? null : "Give the app user a role that includes this, then check again." });
      } catch (e) {
        checks.push(probeResult(id, label, e as { status?: number; message?: string }));
      }
    }
  } else {
    const set = outboundConfig(cfg).project.entity_set;
    if (set) await probe("read_projects", "Read projects", () => client.get(set, { $top: "1" }));
    checks.push({ id: "create_project", label: "Create projects", ok: null, fix: "A project cannot be tried without creating one. Use Send a test quote." });
  }
  return { checks };
}

// ── Sync (Resync tab and Mapping tab) ───────────────────────────────────────

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
  const entities = await Promise.all(D365_ENTITY_KEYS.map(async (key) => {
    const ec = entityConfig(cfg, key);
    const { count } = await admin.from("connector_links").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID).eq("entity", key);
    const run = latest.get(key) ?? null;
    return {
      key, label: D365_ENTITY_LABEL[key], direction: D365_ENTITY_TARGET[key].direction, enabled: ec?.enabled === true, entity_set: ec?.entity_set ?? null,
      schedule: (ec?.schedule ?? cfg.schedule) as SyncSchedule, schedule_source: ec?.schedule ? ("entity" as const) : ("connector" as const),
      running: running.has(key), linked: count ?? 0,
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

export async function resync(admin: SupabaseClient, tenantId: string, userId: string, entity: D365EntityKey, opts: { full?: boolean; ids?: string[] }) {
  return entity === "fence_projects"
    ? runPushFenceProjects(admin, tenantId, { trigger: "manual", userId, ids: opts.ids })
    : runPull(admin, tenantId, entity, { trigger: "manual", userId, full: opts.full === true });
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

