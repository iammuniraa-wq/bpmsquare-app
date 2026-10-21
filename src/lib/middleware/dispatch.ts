import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { tenantOrigin, type TenantConfig, type TenantFeatures } from "@/lib/constants";
import { logChangeBatch } from "@/lib/changeLog";
import { loadD365, CONNECTOR_ID } from "@/lib/connectors/d365/server";
import { outboundConfig } from "@/lib/connectors/d365/catalog";
import { splitExternalId } from "@/lib/connectors/d365/mapping";
import type { D365Config } from "@/lib/connectors/d365/types";
import { parseRules, ruleFor, autoAction } from "./rules";
import { isPriceOnly, resolveTarget } from "./contract";
import { readDocument } from "./documents";
import { resolveDataversePricing, type RunCache } from "./pricing";
import { shapeForErp, type OutLine } from "./fence";
import { shapeEstimate, type EstimateShape, type Row } from "./estimate";
import {
  buildDataverseQuote, buildProjectBody, plainFailure, previewWords, stepsFor,
  type Problem, type QuoteForErp,
} from "./payload";
import { sendDataverseQuote, ErpStepError, type ErpHttp, type DataverseQuoteState } from "./erp";
import { sendDataverseSalesOrder, type DataverseOrderState } from "./erpOrder";
import { buildExchangePayload, pickExchange, recordingHttp, type Recorder } from "./exchange";
import { erpDeepLink, PRODUCT_NAME, totalsNote } from "./links";
import { findOpenMessage, messagesTableReady, recordMessage, resolveEarlier } from "./messages";
import { loadQuoteSource, type QuoteSource } from "./source";
import { middlewareClient } from "./client";
import { outcomeForStatus, STATUS_FOR_OUTCOME, type DocumentConfig, type IntegrationMiddlewareConfig, type Outcome, type TargetKind } from "./types";

// The outbound engine: a Standard Quote that is awarded or rejected goes to the
// connected ERP (Dynamics Sales = Quote; Finance and Operations / Business
// Central = Project). It runs AFTER the user's save and must never fail or slow
// it -- every outcome, good or bad, becomes an integration_messages row, and a
// failure is retried from the Resync tab. One BPMSquare quote is one ERP
// document, found again through connector_links (and, if that link was lost,
// through the quote-id marker written into the ERP document), and claimed
// before the first ERP call, so a second or overlapping dispatch never makes a
// twin.

/** A quote goes to the ERP only when it is awarded. A rejected quote never leaves BPMSquare and leaves no trace. */
export const REJECTED_NEVER_SENT = "A rejected quote is never sent to the ERP.";

export type DispatchTrigger = "auto" | "manual" | "retry" | "send_now";

export type DispatchResult =
  | { state: "disabled"; reason: string }
  | { state: "not_found" }
  | { state: "needs_database_update" }
  | { state: "waiting"; messageId: string | null }
  /** Another send of this same quote holds the claim: nothing was done here. */
  | { state: "in_progress" }
  | { state: "sent"; messageId: string | null; number: string | null; link: string | null }
  | { state: "already_sent"; number: string | null; link: string | null }
  | { state: "skipped"; messageId: string | null; headline: string }
  | { state: "failed"; messageId: string | null; headline: string; fix: string };

type TenantRow = { features: TenantFeatures | null; config: TenantConfig | null; custom_domain: string | null };

async function loadTenant(admin: SupabaseClient, tenantId: string): Promise<TenantRow | null> {
  const { data } = await admin.from("tenants").select("features, config, custom_domain").eq("id", tenantId).maybeSingle();
  return (data as TenantRow | null) ?? null;
}

type Link = { id?: string; external_id: string; external_key: string | null; synced_at?: string | null };

/** The link `entity` a quote's push row is filed under. The claim is keyed by the TARGET: a quote that was
 *  sent as a Quote and is later sent as a Sales Order is a different document, so it must not read as already
 *  sent. A Quote and a Project keep the original value (their unique claim index, migration 0201, covers
 *  it, and one product only ever offers one of the two); a Sales Order has its own. */
export const QUOTE_LINK_ENTITY = "standard_quotes";
export function linkEntityFor(target: TargetKind): string {
  return target === "sales_order" ? `${QUOTE_LINK_ENTITY}:sales_order` : QUOTE_LINK_ENTITY;
}

async function findLink(admin: SupabaseClient, tenantId: string, entity: string, objectId: string): Promise<Link | null> {
  const { data } = await admin.from("connector_links").select("id, external_id, external_key, synced_at").eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID)
    .eq("entity", entity).eq("object_id", objectId).limit(1).maybeSingle();
  return (data as Link | null) ?? null;
}

// ── The per-document claim ──────────────────────────────────────────────────
// One BPMSquare quote becomes one ERP document, even when two sends overlap (the
// automatic send after the save plus an admin's Send now, or two Retry presses).
// Before any ERP call the dispatcher INSERTS the quote's connector_links row with
// external_id "pending:<uuid>"; a unique partial index (migration 0201) lets only
// one insert win, and the loser does nothing. The winner replaces the placeholder
// with the ERP's id as soon as the document exists. A failure before the ERP made
// anything deletes the claim, so Retry works; a failure after keeps it, holding
// the ERP id, so Retry resumes from that document instead of making a twin.

const PENDING_PREFIX = "pending:";
const isPending = (externalId: string) => externalId.startsWith(PENDING_PREFIX);
/** A send that died before reaching the ERP leaves its claim behind (the routes stop at 120 s);
 *  after this long a later send may take it over. */
const CLAIM_STALE_MS = 10 * 60_000;

type Claim = {
  /** The placeholder this send holds, until the ERP document exists and its id is recorded. */
  pendingId: string | null;
  /** The ERP document is known to exist (or may exist): the claim must never be deleted. */
  keep: boolean;
  /** A real link from an earlier send: resume from it. */
  existing: Link | null;
};

const linkKey = (tenantId: string, quoteId: string, entity: string) => ({ tenant_id: tenantId, connector_id: CONNECTOR_ID, entity, object_id: quoteId });

/** Every claim or link row for this quote and entity, oldest first. Only read to settle a race (below). */
async function claimRows(admin: SupabaseClient, tenantId: string, entity: string, quoteId: string): Promise<{ id: string; external_id: string }[]> {
  const { data } = await admin.from("connector_links").select("id, external_id").eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID)
    .eq("entity", entity).eq("object_id", quoteId).order("created_at", { ascending: true }).order("id", { ascending: true });
  return (data ?? []) as { id: string; external_id: string }[];
}

async function acquireClaim(admin: SupabaseClient, tenantId: string, entity: string, quoteId: string): Promise<{ busy: true } | { busy: false; claim: Claim }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const found = await findLink(admin, tenantId, entity, quoteId);
    if (found && !isPending(found.external_id)) return { busy: false, claim: { pendingId: null, keep: false, existing: found } };
    const pendingId = `${PENDING_PREFIX}${randomUUID()}`;
    const now = new Date().toISOString();
    if (!found) {
      const { error } = await admin.from("connector_links").insert({
        ...linkKey(tenantId, quoteId, entity), object_type: "standard_quotes", external_id: pendingId, external_key: null, direction: "push", synced_at: now,
      });
      if (!error) {
        if (entity === QUOTE_LINK_ENTITY) return { busy: false, claim: { pendingId, keep: false, existing: null } };
        // No unique index covers the other targets, so two overlapping inserts can both succeed. The oldest
        // row wins; the other deletes its own and stands down. Both sides read the same rows, so they agree.
        const rows = await claimRows(admin, tenantId, entity, quoteId);
        if (rows.length <= 1 || rows[0].external_id === pendingId) return { busy: false, claim: { pendingId, keep: false, existing: null } };
        await admin.from("connector_links").delete().eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID).eq("entity", entity).eq("object_id", quoteId).eq("external_id", pendingId);
        continue;
      }
      if (error.code !== "23505") throw new Error(`could not start the send (${error.message})`);
      continue;
    }
    // Someone else's claim is there. It is theirs unless it has gone stale; taking it over is a
    // compare-and-swap on its placeholder, so only one waiting send can win it.
    const age = Date.now() - Date.parse(found.synced_at ?? "");
    if (!(age > CLAIM_STALE_MS)) return { busy: true };
    const { data } = await admin.from("connector_links").update({ external_id: pendingId, synced_at: now })
      .eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID).eq("entity", entity).eq("object_id", quoteId).eq("external_id", found.external_id).select("id");
    if ((data as unknown[] | null)?.length) return { busy: false, claim: { pendingId, keep: false, existing: null } };
  }
  return { busy: true };
}

/** Put the ERP's id and readable number on the quote's link. Returns the error text, or null. */
async function writeQuoteLink(admin: SupabaseClient, tenantId: string, entity: string, quoteId: string, externalId: string, key: string | null): Promise<string | null> {
  const patch = { external_id: externalId, external_key: key, synced_at: new Date().toISOString() };
  const { data, error } = await admin.from("connector_links").update(patch)
    .eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID).eq("entity", entity).eq("object_id", quoteId).select("id");
  if (error) return error.message;
  if ((data as unknown[] | null)?.length) return null;
  // The link was removed since (someone unlinked it): write it again.
  const ins = await admin.from("connector_links").insert({ ...linkKey(tenantId, quoteId, entity), object_type: "standard_quotes", direction: "push", ...patch });
  return ins.error ? ins.error.message : null;
}

async function recordLink(c: Ctx, externalId: string, key: string | null): Promise<void> {
  if (!c.quoteId) return;
  const entity = linkEntityFor(c.prep.target);
  let err = await writeQuoteLink(c.admin, c.tenantId, entity, c.quoteId, externalId, key);
  if (err) err = await writeQuoteLink(c.admin, c.tenantId, entity, c.quoteId, externalId, key);
  if (err) throw new Error(`created in the ERP but could not be recorded (${err}) — do not send it again`);
  if (c.claim) c.claim.pendingId = null;
}

/** A failure before the ERP made anything: give the claim back so Retry can send. */
async function releaseClaim(c: Ctx): Promise<void> {
  const cl = c.claim;
  if (!c.quoteId || !cl?.pendingId || cl.keep) return;
  // If this delete fails the placeholder simply goes stale and a later send takes it over.
  await c.admin.from("connector_links").delete().eq("tenant_id", c.tenantId).eq("connector_id", CONNECTOR_ID).eq("entity", linkEntityFor(c.prep.target))
    .eq("object_id", c.quoteId).eq("external_id", cl.pendingId);
}

/** The ERP's own id for a customer, from the link a customer sync made. */
async function customerExternalId(admin: SupabaseClient, tenantId: string, accountId: string): Promise<{ id: string; area: string | null } | null> {
  const link = await findLink(admin, tenantId, "customers", accountId);
  if (!link) return null;
  const s = splitExternalId(link.external_id);
  return { id: s.id, area: s.area };
}

// ── Preparing a send ────────────────────────────────────────────────────────

type Prepared = {
  cfg: D365Config;
  creds: Record<string, string>;
  rules: IntegrationMiddlewareConfig;
  doc: DocumentConfig;
  outcome: Outcome;
  target: TargetKind;
  source: QuoteSource;
  qfe: QuoteForErp;
  customerArea: string | null;
  problems: Problem[];
  body: Record<string, unknown> | null;
  /** Finance and Operations / Business Central: the mapped entity (a project or a sales order) and its children. */
  project: { entity_set: string; id_field: string; tasks: Row[] | null; bom: Row[] | null; taskTarget: { entity_set: string; link_field?: string } | null; bomTarget: { entity_set: string; link_field?: string } | null } | null;
  included: string[];
  refused: { part: string; hint: string }[];
  /** Unused since round 2 (a rejected quote never reaches a send); kept so the preview contract does not change. */
  nothingToSend: string | null;
  /** Building the send needed the ERP and could not reach it; the send reports this as the failure. */
  httpError: unknown | null;
};

function profileKeyFor(cfg: D365Config): string {
  return cfg.product === "fo" || cfg.product === "bc" ? "dynamics365" : "generic";
}

const nounFor = (t: TargetKind): "quote" | "order" | "project" => (t === "sales_order" ? "order" : t);

function buildQuoteForErp(source: QuoteSource, outcome: Outcome, accountExternalId: string | null, rules: IntegrationMiddlewareConfig, target: TargetKind, cfg: D365Config): {
  qfe: QuoteForErp; est: EstimateShape | null; included: string[]; refused: { part: string; hint: string }[];
} {
  const q = source.quote;
  const base: string[] = [];
  if (q.intro_text?.trim()) base.push(q.intro_text.trim());
  base.push(totalsNote(q));
  let lines: OutLine[] = source.lines;
  let description = base;
  let est: EstimateShape | null = null;
  const included: string[] = [];
  const refused: { part: string; hint: string }[] = [];
  let title = source.accountName;

  if (source.fence) {
    const shaped = shapeForErp({ lines, base, fence: source.fence, selection: rules.fence, notes: q.notes, terms: q.terms, subtotal: q.subtotal });
    lines = shaped.lines;
    description = shaped.description;
    title = source.fence.name;
    included.push("Fence project details as ticked");
  } else if (source.estimate) {
    est = shapeEstimate({
      target, selection: rules.estimate, estimate: source.estimate.info, exportLines: source.estimate.exportLines,
      quoteLines: source.lines, quoteSubtotal: q.subtotal, profileKey: profileKeyFor(cfg),
    });
    description = [...base, ...est.description];
    if (isPriceOnly(target)) lines = est.lines;
    title = source.estimate.info.name;
    included.push(...est.included);
    refused.push(...est.refused);
  } else {
    included.push(`${lines.length} quote line${lines.length === 1 ? "" : "s"}`);
  }
  return {
    qfe: {
      ref: q.ref, doc_id: q.id, title, customer_name: source.accountName, account_external_id: accountExternalId, description, lines,
      subtotal: q.subtotal, total: q.total, valid_until: q.valid_until, outcome,
    },
    est, included, refused,
  };
}

/** The ISO code of the BPMSquare quote's currency: the workspace currency (INR until one is chosen). */
const quoteCurrencyCode = (tenant: TenantRow): string => String((tenant.config as { currency?: string } | null)?.currency ?? "INR");

async function prepare(
  admin: SupabaseClient, tenantId: string, tenant: TenantRow, source: QuoteSource, outcome: Outcome,
  loaded: NonNullable<Awaited<ReturnType<typeof loadD365>>>, getHttp: () => Promise<ErpHttp>, cache: RunCache,
): Promise<Prepared> {
  const { cfg, creds } = loaded;
  const rules = parseRules(tenant.config?.integration_middleware);
  const doc = readDocument(tenant.config?.integration_middleware);
  const target = resolveTarget(cfg.product, doc.target);
  const cust = await customerExternalId(admin, tenantId, source.quote.account_id);
  const { qfe, est, included, refused } = buildQuoteForErp(source, outcome, cust?.id ?? null, rules, target, cfg);
  const out = outboundConfig(cfg);
  const prep: Prepared = {
    cfg, creds, rules, doc, outcome, target, source, qfe, customerArea: cust?.area ?? null, problems: [], body: null, project: null, included, refused, nothingToSend: null, httpError: null,
  };
  if (cfg.product === "dataverse") {
    const order = target === "sales_order";
    // Price list and currency are decided per send (customer's own list, then the fallback; ISO match, then base).
    let pricing: { priceListId: string | null; currencyId: string | null } = { priceListId: cfg.price_list_id ?? null, currencyId: cfg.currency_id ?? null };
    if (cust) {
      try {
        pricing = await resolveDataversePricing(await getHttp(), {
          accountExternalId: cust.id, fallbackPriceListId: cfg.price_list_id ?? null, fallbackCurrencyId: cfg.currency_id ?? null, isoCode: quoteCurrencyCode(tenant), cache,
        });
      } catch (e) {
        const f = plainFailure(e as { status?: number; message?: string }, undefined, nounFor(target));
        prep.httpError = e;
        prep.problems = [{ code: "erp_unreachable", message: f.headline, fix: f.fix }];
        return prep;
      }
    }
    const b = buildDataverseQuote(
      qfe, { price_list_id: pricing.priceListId, currency_id: pricing.currencyId },
      order ? { quote: out.sales_order.field_map, quote_line: out.sales_order_line.field_map } : { quote: out.quote.field_map, quote_line: out.quote_line.field_map },
      order ? "sales_order" : "quote",
    );
    prep.body = b.body;
    prep.problems = b.problems;
    return prep;
  }
  // Finance and Operations / Business Central: a Project, or a Sales Order through the mapped entity.
  const order = target === "sales_order";
  const mapped = order ? out.sales_order : out.project;
  const b = buildProjectBody(qfe, mapped, { status: "awarded", dataArea: cfg.company ?? cust?.area ?? null, isFo: cfg.product === "fo", noun: order ? "sales order" : "project" });
  prep.body = b.body;
  prep.problems = b.problems;
  if (!cust) prep.problems.unshift({ code: "customer_not_linked", message: "This customer is not in the ERP yet.", fix: "Sync customers, then retry." });
  const own = cfg.outbound?.project;
  prep.project = {
    entity_set: mapped.entity_set, id_field: mapped.id_field,
    tasks: order ? null : est?.tasks ?? null,
    bom: order ? null : est?.bom ?? null,
    taskTarget: order ? null : own?.tasks ?? null, bomTarget: order ? null : own?.bom ?? null,
  };
  return prep;
}

// ── Preview ─────────────────────────────────────────────────────────────────

export type PreviewResult =
  | { ok: true; words: string[]; body: Record<string, unknown> | null; extras: { tasks: number; bom: number; costs: boolean }; included: string[]; refused: { part: string; hint: string }[]; problems: Problem[]; target: TargetKind; outcome: Outcome; nothingToSend: string | null }
  | { ok: false; state: "disabled" | "not_found" | "not_connected"; message: string };

/** What would be sent, in words first and as the raw body. Nothing is sent or recorded. */
export async function previewQuoteOutcome(admin: SupabaseClient, tenantId: string, quoteId: string, opts: { outcome?: Outcome; http?: ErpHttp } = {}): Promise<PreviewResult> {
  const tenant = await loadTenant(admin, tenantId);
  if (!tenant?.features?.integration_middleware) return { ok: false, state: "disabled", message: "Integration middleware is not switched on for this workspace." };
  const loaded = await loadD365(admin, tenantId);
  if (!loaded) return { ok: false, state: "not_connected", message: "No ERP is connected yet. Connect one under Connections." };
  const source = await loadQuoteSource(admin, tenantId, quoteId, tenantOrigin(tenant.custom_domain));
  if (!source) return { ok: false, state: "not_found", message: "Quote not found." };
  const outcome = opts.outcome ?? outcomeForStatus(source.quote.status);
  if (!outcome) return { ok: false, state: "disabled", message: "This quote is not awarded yet." };
  if (outcome === "rejected") return { ok: false, state: "disabled", message: REJECTED_NEVER_SENT };
  let hp: Promise<ErpHttp> | null = null;
  const getHttp = () => (hp ??= opts.http ? Promise.resolve(opts.http) : middlewareClient(admin, tenantId, loaded.cfg, loaded.creds));
  const p = await prepare(admin, tenantId, tenant, source, outcome, loaded, getHttp, {});
  const words = previewWords({
    target: p.target, productLabel: PRODUCT_NAME[p.cfg.product], ref: p.qfe.ref, customer: p.qfe.customer_name,
    lineCount: p.qfe.lines.length, total: p.qfe.total, outcome, steps: p.nothingToSend ? [p.nothingToSend] : stepsFor(p.cfg.product, outcome, p.target),
  });
  if (p.included.length) words.push(`Included: ${p.included.join("; ")}.`);
  for (const r of p.refused) words.push(`Not sent: ${r.part.replace(/_/g, " ")}. ${r.hint}`);
  const hasCosts = !!p.project && p.included.includes("Internal cost breakdown");
  return {
    ok: true, words, body: p.body,
    extras: { tasks: p.project?.tasks?.length ?? 0, bom: p.project?.bom?.length ?? 0, costs: hasCosts },
    included: p.included, refused: p.refused, problems: p.problems, target: p.target, outcome, nothingToSend: p.nothingToSend,
  };
}

// ── Sending ─────────────────────────────────────────────────────────────────

type Ctx = {
  admin: SupabaseClient; tenantId: string; quoteId: string | null; userId: string | null; trigger: DispatchTrigger;
  prep: Prepared; http: ErpHttp; t0: number; test: boolean; capture: boolean;
  /** Records the calls made to the ERP, so the message can keep the request and the response of the one that matters. */
  rec: Recorder | null;
  /** Held from just before the first ERP call; absent for the test quote, which has no BPMSquare record. */
  claim?: Claim | null;
};

/** The request and response of the call that explains this message (redacted, capped, always kept for a document send). */
const exchangeOf = (c: Ctx) => (c.rec ? buildExchangePayload(pickExchange(c.rec.calls)) : null);

function failureMessage(c: Ctx, headline: string, fix: string, raw: string | null, status: number | null, extra: Record<string, unknown> = {}) {
  return recordMessage(c.admin, {
    tenantId: c.tenantId, direction: "out", channel: "connector", connectorId: CONNECTOR_ID, entity: c.prep.target,
    objectType: c.quoteId ? "standard_quotes" : null, objectId: c.quoteId, refLabel: c.prep.qfe.ref, status: "failed",
    httpStatus: status, error: raw, durationMs: Date.now() - c.t0, exchange: exchangeOf(c),
    summary: { outcome: c.prep.outcome, ref: c.prep.qfe.ref, target: c.prep.target, headline, fix, trigger: c.trigger, ...(c.test ? { test: true } : {}), ...extra },
  }, c.capture);
}

async function runSend(c: Ctx): Promise<DispatchResult> {
  const { prep } = c;
  const product = prep.cfg.product;

  if (prep.nothingToSend) {
    const r = await recordMessage(c.admin, {
      tenantId: c.tenantId, direction: "out", channel: "connector", connectorId: CONNECTOR_ID, entity: prep.target,
      objectType: c.quoteId ? "standard_quotes" : null, objectId: c.quoteId, refLabel: prep.qfe.ref, status: "skipped", durationMs: Date.now() - c.t0,
      summary: { outcome: prep.outcome, ref: prep.qfe.ref, target: prep.target, headline: prep.nothingToSend, fix: "Nothing to do.", trigger: c.trigger },
    });
    return { state: "skipped", messageId: r.id, headline: prep.nothingToSend };
  }
  if (prep.problems.length) {
    const p = prep.problems[0];
    const r = await failureMessage(c, p.message, p.fix, null, null, { problems: prep.problems.map((x) => x.code) });
    return { state: "failed", messageId: r.id, headline: p.message, fix: p.fix };
  }

  try {
    if (c.quoteId) {
      const got = await acquireClaim(c.admin, c.tenantId, linkEntityFor(prep.target), c.quoteId);
      if (got.busy) return { state: "in_progress" };
      c.claim = got.claim;
    }
    if (product === "dataverse") return prep.target === "sales_order" ? await sendOrder(c) : await sendQuote(c);
    return await sendMapped(c);
  } catch (e) {
    await releaseClaim(c);
    const x = e as { status?: number; message?: string; step?: string };
    const f = plainFailure(x, x.step, nounFor(prep.target));
    const r = await failureMessage(c, f.headline, f.fix, x.message ?? null, x.status ?? null, x.step ? { step: x.step } : {});
    return { state: "failed", messageId: r.id, headline: f.headline, fix: f.fix };
  }
}

async function finish(c: Ctx, a: { number: string | null; erpId: string; link: string | null; steps: string[]; total: number | null; created: boolean; warnings?: string[] }): Promise<DispatchResult> {
  const { prep } = c;
  const r = await recordMessage(c.admin, {
    tenantId: c.tenantId, direction: "out", channel: "connector", connectorId: CONNECTOR_ID, entity: prep.target,
    objectType: c.quoteId ? "standard_quotes" : null, objectId: c.quoteId, refLabel: prep.qfe.ref, status: "ok", durationMs: Date.now() - c.t0,
    summary: {
      outcome: prep.outcome, ref: prep.qfe.ref, target: prep.target, erp_number: a.number, link: a.link, steps: a.steps, lines: prep.qfe.lines.length,
      total: a.total ?? prep.qfe.total, included: prep.included, trigger: c.trigger, ...(c.test ? { test: true } : {}), ...(a.warnings?.length ? { warnings: a.warnings } : {}),
    },
    // Kept always for a document send (redacted and capped), whatever the workspace's payload capture says.
    exchange: exchangeOf(c),
  }, c.capture);
  if (c.quoteId) {
    await resolveEarlier(c.admin, c.tenantId, c.quoteId, prep.outcome, r.id);
    await logChangeBatch(c.admin, [{
      tenantId: c.tenantId, objectType: "standard_quotes", objectId: c.quoteId, objectLabel: prep.qfe.ref, action: "update", actorId: c.userId, actorEmail: null,
      changes: [{ field: `sent to ${PRODUCT_NAME[prep.cfg.product]} (${prep.outcome})`, from: null, to: a.number ?? a.erpId }],
    }]);
  }
  return { state: "sent", messageId: r.id, number: a.number, link: a.link };
}

async function sendQuote(c: Ctx): Promise<DispatchResult> {
  const { prep } = c;
  const existing = c.claim?.existing ?? null;
  const res = await sendDataverseQuote(c.http, {
    ref: prep.qfe.ref, docId: c.quoteId, outcome: prep.outcome, existingId: existing?.external_id ?? null, create: prep.body!,
    onCreated: async (s: DataverseQuoteState) => {
      // The quote exists in the ERP from here on: whatever happens next, the claim stays.
      if (c.claim) c.claim.keep = true;
      await recordLink(c, s.quoteId, s.quoteNumber);
    },
  });
  const link = erpDeepLink(prep.cfg, "quote", res.quoteId);
  await recordLink(c, res.quoteId, res.quoteNumber);
  if (res.alreadyDone) {
    if (c.quoteId) await resolveEarlier(c.admin, c.tenantId, c.quoteId, prep.outcome, null);
    return { state: "already_sent", number: res.quoteNumber, link };
  }
  return finish(c, { number: res.quoteNumber, erpId: res.quoteId, link, steps: res.steps, total: res.total, created: res.created });
}

/** Dynamics Sales, Sales Order: one POST, born Active, so there is no activate or win step. */
async function sendOrder(c: Ctx): Promise<DispatchResult> {
  const { prep } = c;
  const existing = c.claim?.existing ?? null;
  const res = await sendDataverseSalesOrder(c.http, {
    ref: prep.qfe.ref, docId: c.quoteId, existingId: existing?.external_id ?? null, create: prep.body!,
    onCreated: async (s: DataverseOrderState) => {
      if (c.claim) c.claim.keep = true;
      await recordLink(c, s.orderId, s.orderNumber);
    },
  });
  const link = erpDeepLink(prep.cfg, "salesorder", res.orderId);
  await recordLink(c, res.orderId, res.orderNumber);
  if (res.alreadyDone) {
    if (c.quoteId) await resolveEarlier(c.admin, c.tenantId, c.quoteId, prep.outcome, null);
    return { state: "already_sent", number: res.orderNumber, link };
  }
  return finish(c, { number: res.orderNumber, erpId: res.orderId, link, steps: res.steps, total: res.total, created: true });
}

/** Finance and Operations / Business Central: a project, or a sales order, created through its mapped entity. */
async function sendMapped(c: Ctx): Promise<DispatchResult> {
  const { prep } = c;
  const proj = prep.project!;
  const noun = prep.target === "sales_order" ? "order" : "project";
  const existing = c.claim?.existing ?? null;
  if (existing) {
    if (c.quoteId) await resolveEarlier(c.admin, c.tenantId, c.quoteId, prep.outcome, null);
    return { state: "already_sent", number: existing.external_key, link: null };
  }
  let created: { row: Record<string, unknown>; entityId: string | null };
  try {
    created = await c.http.create(proj.entity_set, prep.body!);
  } catch (e) {
    throw new ErpStepError("create", (e as { status?: number }).status ?? 0, (e as Error).message);
  }
  // The document exists in the ERP from here on, whether or not we can read its id back or save it.
  if (c.claim) c.claim.keep = true;
  const row = created.row;
  const raw = row[proj.id_field] ?? row.id ?? created.entityId;
  if (raw === undefined || raw === null || raw === "") throw new ErpStepError("create", 0, `The ERP did not return the new ${noun}'s id`);
  const key = String(row.ProjectID ?? row.SalesOrderNumber ?? row.SalesId ?? row.number ?? row.ProjectId ?? row[proj.id_field] ?? raw);
  const warnings: string[] = [];
  await recordLink(c, String(raw), key);

  const children: [string, Row[] | null, { entity_set: string; link_field?: string } | null][] = [
    ["Project tasks", proj.tasks, proj.taskTarget], ["Bill of materials lines", proj.bom, proj.bomTarget],
  ];
  for (const [label, rows, target] of children) {
    if (!rows?.length) continue;
    if (!target) { warnings.push(`${label} were not sent: no target is set for them under Mapping.`); continue; }
    let failed = 0;
    for (const r of rows) {
      try {
        await c.http.create(target.entity_set, { ...r, ...(target.link_field ? { [target.link_field]: String(raw) } : {}) });
      } catch {
        failed++;
      }
    }
    if (failed) warnings.push(`${label}: ${failed} of ${rows.length} were not accepted.`);
  }
  return finish(c, { number: key, erpId: String(raw), link: null, steps: [`Created the ${noun}.`], total: null, created: true, warnings });
}

// ── Public entry points ─────────────────────────────────────────────────────

export async function dispatchQuoteOutcome(
  admin: SupabaseClient, tenantId: string, quoteId: string,
  opts: { trigger: DispatchTrigger; userId?: string | null; outcome?: Outcome; http?: ErpHttp; /** shared by the sends of one Restart */ cache?: RunCache },
): Promise<DispatchResult> {
  const t0 = Date.now();
  const tenant = await loadTenant(admin, tenantId);
  if (!tenant) return { state: "not_found" };
  if (!tenant.features?.integration_middleware) return { state: "disabled", reason: "Integration middleware is not switched on for this workspace." };
  const rules = parseRules(tenant.config?.integration_middleware);

  const source = await loadQuoteSource(admin, tenantId, quoteId, tenantOrigin(tenant.custom_domain));
  if (!source) return { state: "not_found" };
  const outcome = opts.outcome ?? outcomeForStatus(source.quote.status);
  if (!outcome) return { state: "disabled", reason: "This quote is not awarded." };
  if (outcome === "rejected") return { state: "disabled", reason: REJECTED_NEVER_SENT };
  if (source.quote.status !== STATUS_FOR_OUTCOME[outcome]) return { state: "disabled", reason: `The quote is ${source.quote.status}, not ${outcome}.` };

  if (opts.trigger === "auto") {
    const action = autoAction(ruleFor(rules, outcome));
    if (action === "none") return { state: "disabled", reason: "This rule is switched off." };
    if (action === "wait") {
      if (!(await messagesTableReady(admin, tenantId))) return { state: "needs_database_update" };
      const open = await findOpenMessage(admin, tenantId, quoteId, outcome, "pending");
      if (open) return { state: "waiting", messageId: open.id };
      const r = await recordMessage(admin, {
        tenantId, direction: "out", channel: "connector", connectorId: CONNECTOR_ID, objectType: "standard_quotes", objectId: quoteId, refLabel: source.quote.ref, status: "pending",
        summary: { outcome, ref: source.quote.ref, headline: "Waiting for you to send it.", fix: "Press Send now when you are ready.", trigger: "manual" },
      });
      return { state: "waiting", messageId: r.id };
    }
  }
  if (!(await messagesTableReady(admin, tenantId))) return { state: "needs_database_update" };

  const loaded = await loadD365(admin, tenantId);
  if (!loaded) {
    const headline = "No ERP is connected.";
    const fix = "Connect it under Connections, then retry.";
    const r = await recordMessage(admin, {
      tenantId, direction: "out", channel: "connector", connectorId: CONNECTOR_ID, objectType: "standard_quotes", objectId: quoteId, refLabel: source.quote.ref, status: "failed",
      durationMs: Date.now() - t0, summary: { outcome, ref: source.quote.ref, headline, fix, trigger: opts.trigger },
    });
    return { state: "failed", messageId: r.id, headline, fix };
  }

  let hp: Promise<ErpHttp> | null = null;
  const getHttp = () => (hp ??= opts.http ? Promise.resolve(opts.http) : middlewareClient(admin, tenantId, loaded.cfg, loaded.creds));
  const prep = await prepare(admin, tenantId, tenant, source, outcome, loaded, getHttp, opts.cache ?? {});
  let http: ErpHttp;
  try {
    if (prep.httpError) throw prep.httpError;
    http = await getHttp();
  } catch (e) {
    const f = plainFailure(e as { status?: number; message?: string }, undefined, nounFor(prep.target));
    const ctx = { admin, tenantId, quoteId, userId: opts.userId ?? null, trigger: opts.trigger, prep, http: null as never, t0, test: false, capture: rules.payload_capture, rec: null };
    const r = await failureMessage(ctx, f.headline, f.fix, (e as Error).message, null);
    return { state: "failed", messageId: r.id, headline: f.headline, fix: f.fix };
  }
  const rec = recordingHttp(http);
  return runSend({ admin, tenantId, quoteId, userId: opts.userId ?? null, trigger: opts.trigger, prep, http: rec.http, t0, test: false, capture: rules.payload_capture, rec });
}

// ── Test quote ──────────────────────────────────────────────────────────────

export type TestResult =
  | { ok: true; number: string | null; link: string | null; messageId: string | null; ref: string }
  | { ok: false; headline: string; fix: string; messageId: string | null };

/** A clearly named sample (ZZ prefix) sent through the real path, so Connections can prove it works.
 *  The product never deletes it. Uses the first customer that has been synced. It is made as whatever
 *  the Quote document is set to create (a Quote, a Sales Order or a Project). */
export async function sendTestQuote(admin: SupabaseClient, tenantId: string, userId: string | null, opts: { http?: ErpHttp; now?: Date } = {}): Promise<TestResult> {
  const t0 = Date.now();
  const tenant = await loadTenant(admin, tenantId);
  if (!tenant?.features?.integration_middleware) return { ok: false, headline: "Integration middleware is not switched on.", fix: "Ask the platform administrator to switch it on.", messageId: null };
  if (!(await messagesTableReady(admin, tenantId))) return { ok: false, headline: "A database update is needed first.", fix: `Run ${"scripts/run-bundle-10-middleware-2026-10-21.sql"} once.`, messageId: null };
  const loaded = await loadD365(admin, tenantId);
  if (!loaded) return { ok: false, headline: "No ERP is connected.", fix: "Connect it under Connections first.", messageId: null };

  const { data: link } = await admin.from("connector_links").select("object_id, external_id").eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID).eq("entity", "customers")
    .order("created_at").limit(1).maybeSingle();
  const l = link as { object_id: string; external_id: string } | null;
  if (!l) return { ok: false, headline: "No customer has been synced from the ERP yet.", fix: "Sync customers first, then send the test.", messageId: null };
  const { data: acct } = await admin.from("accounts").select("name").eq("id", l.object_id).eq("tenant_id", tenantId).maybeSingle();
  const cust = splitExternalId(l.external_id);

  const now = opts.now ?? new Date();
  const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const ref = `ZZ-TEST-${stamp}`;
  const lines: OutLine[] = [
    { sl_no: "1", description: "Test line A (safe to ignore)", uom: null, qty: 2, rate: 10, discount_pct: 0, amount: 20 },
    { sl_no: "2", description: "Test line B (safe to ignore)", uom: null, qty: 1, rate: 5, discount_pct: 0, amount: 5 },
  ];
  const rules = parseRules(tenant.config?.integration_middleware);
  const doc = readDocument(tenant.config?.integration_middleware);
  const { cfg, creds } = loaded;
  const target = resolveTarget(cfg.product, doc.target);
  const out = outboundConfig(cfg);
  const qfe: QuoteForErp = {
    ref, title: "BPMSquare test quote, safe to ignore", customer_name: String((acct as { name?: string } | null)?.name ?? "Customer"), account_external_id: cust.id,
    description: ["Created by BPMSquare Integration middleware to test the connection. Safe to ignore."], lines, subtotal: 25, total: 25, valid_until: null, outcome: "awarded",
  };
  const prep: Prepared = {
    cfg, creds, rules, doc, outcome: "awarded", target, source: null as never, qfe, customerArea: cust.area, problems: [], body: null, project: null, included: ["2 test lines"], refused: [], nothingToSend: null, httpError: null,
  };
  let http: ErpHttp;
  try {
    http = opts.http ?? (await middlewareClient(admin, tenantId, cfg, creds));
  } catch (e) {
    const f = plainFailure(e as { status?: number; message?: string }, undefined, nounFor(target));
    return { ok: false, headline: f.headline, fix: f.fix, messageId: null };
  }
  if (cfg.product === "dataverse") {
    const order = target === "sales_order";
    let pricing: { priceListId: string | null; currencyId: string | null } = { priceListId: cfg.price_list_id ?? null, currencyId: cfg.currency_id ?? null };
    try {
      pricing = await resolveDataversePricing(http, { accountExternalId: cust.id, fallbackPriceListId: cfg.price_list_id ?? null, fallbackCurrencyId: cfg.currency_id ?? null, isoCode: quoteCurrencyCode(tenant), cache: {} });
    } catch (e) {
      const f = plainFailure(e as { status?: number; message?: string }, undefined, nounFor(target));
      return { ok: false, headline: f.headline, fix: f.fix, messageId: null };
    }
    const b = buildDataverseQuote(
      qfe, { price_list_id: pricing.priceListId, currency_id: pricing.currencyId },
      order ? { quote: out.sales_order.field_map, quote_line: out.sales_order_line.field_map } : { quote: out.quote.field_map, quote_line: out.quote_line.field_map },
      order ? "sales_order" : "quote",
    );
    prep.body = b.body; prep.problems = b.problems;
  } else {
    const order = target === "sales_order";
    const mapped = order ? out.sales_order : out.project;
    const b = buildProjectBody(qfe, mapped, { status: "awarded", dataArea: cfg.company ?? cust.area, isFo: cfg.product === "fo", noun: order ? "sales order" : "project" });
    prep.body = b.body; prep.problems = b.problems;
    prep.project = { entity_set: mapped.entity_set, id_field: mapped.id_field, tasks: null, bom: null, taskTarget: null, bomTarget: null };
  }
  const rec = recordingHttp(http);
  const res = await runSend({ admin, tenantId, quoteId: null, userId, trigger: "send_now", prep, http: rec.http, t0, test: true, capture: rules.payload_capture, rec });
  if (res.state === "sent" || res.state === "already_sent") return { ok: true, number: res.number, link: res.link, messageId: res.state === "sent" ? res.messageId : null, ref };
  if (res.state === "failed") return { ok: false, headline: res.headline, fix: res.fix, messageId: res.messageId };
  return { ok: false, headline: "Nothing was sent.", fix: "Check the connection.", messageId: null };
}
