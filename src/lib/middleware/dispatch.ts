import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { tenantOrigin, type TenantConfig, type TenantFeatures } from "@/lib/constants";
import { logChangeBatch } from "@/lib/changeLog";
import { loadD365, CONNECTOR_ID } from "@/lib/connectors/d365/server";
import { outboundConfig } from "@/lib/connectors/d365/catalog";
import { splitExternalId } from "@/lib/connectors/d365/mapping";
import type { D365Config } from "@/lib/connectors/d365/types";
import { parseRules, ruleFor, autoAction } from "./rules";
import { targetFor } from "./contract";
import { shapeForErp, type OutLine } from "./fence";
import { shapeEstimate, type EstimateShape, type Row } from "./estimate";
import {
  buildDataverseQuote, buildProjectBody, plainFailure, previewWords, stepsFor,
  type Problem, type QuoteForErp,
} from "./payload";
import { sendDataverseQuote, ErpStepError, type ErpHttp, type DataverseQuoteState } from "./erp";
import { erpDeepLink, PRODUCT_NAME, totalsNote } from "./links";
import { findOpenMessage, messagesTableReady, recordMessage, resolveEarlier } from "./messages";
import { loadQuoteSource, type QuoteSource } from "./source";
import { middlewareClient } from "./client";
import { outcomeForStatus, STATUS_FOR_OUTCOME, type IntegrationMiddlewareConfig, type Outcome, type TargetKind } from "./types";

// The outbound engine: a Standard Quote that is awarded or rejected goes to the
// connected ERP (Dynamics Sales = Quote; Finance and Operations / Business
// Central = Project). It runs AFTER the user's save and must never fail or slow
// it -- every outcome, good or bad, becomes an integration_messages row, and a
// failure is retried from the Resync tab. One BPMSquare quote is one ERP
// document, found again through connector_links (and, if that link was lost,
// through the ref in the ERP document's name), so a second dispatch never makes
// a twin.

export type DispatchTrigger = "auto" | "manual" | "retry" | "send_now";

export type DispatchResult =
  | { state: "disabled"; reason: string }
  | { state: "not_found" }
  | { state: "needs_database_update" }
  | { state: "waiting"; messageId: string | null }
  | { state: "sent"; messageId: string | null; number: string | null; link: string | null }
  | { state: "already_sent"; number: string | null; link: string | null }
  | { state: "skipped"; messageId: string | null; headline: string }
  | { state: "failed"; messageId: string | null; headline: string; fix: string };

type TenantRow = { features: TenantFeatures | null; config: TenantConfig | null; custom_domain: string | null };

async function loadTenant(admin: SupabaseClient, tenantId: string): Promise<TenantRow | null> {
  const { data } = await admin.from("tenants").select("features, config, custom_domain").eq("id", tenantId).maybeSingle();
  return (data as TenantRow | null) ?? null;
}

type Link = { id?: string; external_id: string; external_key: string | null };

async function findLink(admin: SupabaseClient, tenantId: string, entity: string, objectId: string): Promise<Link | null> {
  const { data } = await admin.from("connector_links").select("id, external_id, external_key").eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID)
    .eq("entity", entity).eq("object_id", objectId).limit(1).maybeSingle();
  return (data as Link | null) ?? null;
}

async function saveQuoteLink(admin: SupabaseClient, tenantId: string, quoteId: string, externalId: string, key: string | null): Promise<void> {
  const existing = await findLink(admin, tenantId, "standard_quotes", quoteId);
  if (existing) {
    await admin.from("connector_links").update({ external_id: externalId, external_key: key, synced_at: new Date().toISOString() })
      .eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID).eq("entity", "standard_quotes").eq("object_id", quoteId);
    return;
  }
  const row = {
    tenant_id: tenantId, connector_id: CONNECTOR_ID, entity: "standard_quotes", object_type: "standard_quotes", object_id: quoteId,
    external_id: externalId, external_key: key, direction: "push",
  };
  let { error } = await admin.from("connector_links").insert(row);
  if (error) ({ error } = await admin.from("connector_links").insert(row));
  if (error) throw new Error(`created in the ERP but could not be recorded (${error.message}) — do not send it again`);
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
  outcome: Outcome;
  target: TargetKind;
  source: QuoteSource;
  qfe: QuoteForErp;
  customerArea: string | null;
  problems: Problem[];
  body: Record<string, unknown> | null;
  project: { entity_set: string; id_field: string; tasks: Row[] | null; bom: Row[] | null; taskTarget: { entity_set: string; link_field?: string } | null; bomTarget: { entity_set: string; link_field?: string } | null } | null;
  included: string[];
  refused: { part: string; hint: string }[];
  /** A product that has nothing to send for this outcome. */
  nothingToSend: string | null;
};

function profileKeyFor(cfg: D365Config): string {
  return cfg.product === "fo" || cfg.product === "bc" ? "dynamics365" : "generic";
}

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
    if (target === "quote") lines = est.lines;
    title = source.estimate.info.name;
    included.push(...est.included);
    refused.push(...est.refused);
  } else {
    included.push(`${lines.length} quote line${lines.length === 1 ? "" : "s"}`);
  }
  return {
    qfe: {
      ref: q.ref, title, customer_name: source.accountName, account_external_id: accountExternalId, description, lines,
      subtotal: q.subtotal, total: q.total, valid_until: q.valid_until, outcome,
    },
    est, included, refused,
  };
}

async function prepare(
  admin: SupabaseClient, tenantId: string, tenant: TenantRow, source: QuoteSource, outcome: Outcome,
  loaded: NonNullable<Awaited<ReturnType<typeof loadD365>>>,
): Promise<Prepared> {
  const { cfg, creds } = loaded;
  const rules = parseRules(tenant.config?.integration_middleware);
  const target = targetFor(cfg.product)!;
  const cust = await customerExternalId(admin, tenantId, source.quote.account_id);
  const { qfe, est, included, refused } = buildQuoteForErp(source, outcome, cust?.id ?? null, rules, target, cfg);
  const out = outboundConfig(cfg);
  const prep: Prepared = {
    cfg, creds, rules, outcome, target, source, qfe, customerArea: cust?.area ?? null, problems: [], body: null, project: null, included, refused, nothingToSend: null,
  };
  if (target === "quote") {
    const b = buildDataverseQuote(qfe, cfg, { quote: out.quote.field_map, quote_line: out.quote_line.field_map });
    prep.body = b.body;
    prep.problems = b.problems;
    return prep;
  }
  // Finance and Operations / Business Central: a Project. A rejected quote has
  // nothing to close there.
  if (outcome === "rejected") {
    prep.nothingToSend = `${PRODUCT_NAME[cfg.product]} tracks projects, not quotes, so a rejected quote has nothing to send.`;
    return prep;
  }
  const b = buildProjectBody(qfe, out.project, { status: "awarded", dataArea: cfg.company ?? cust?.area ?? null, isFo: cfg.product === "fo" });
  prep.body = b.body;
  prep.problems = b.problems;
  if (!cust) prep.problems.unshift({ code: "customer_not_linked", message: "This customer is not in the ERP yet.", fix: "Sync customers, then retry." });
  const own = cfg.outbound?.project;
  prep.project = {
    entity_set: out.project.entity_set, id_field: out.project.id_field,
    tasks: est?.tasks ?? null,
    bom: est?.bom ?? null,
    taskTarget: own?.tasks ?? null, bomTarget: own?.bom ?? null,
  };
  return prep;
}

// ── Preview ─────────────────────────────────────────────────────────────────

export type PreviewResult =
  | { ok: true; words: string[]; body: Record<string, unknown> | null; extras: { tasks: number; bom: number; costs: boolean }; included: string[]; refused: { part: string; hint: string }[]; problems: Problem[]; target: TargetKind; outcome: Outcome; nothingToSend: string | null }
  | { ok: false; state: "disabled" | "not_found" | "not_connected"; message: string };

/** What would be sent, in words first and as the raw body. Nothing is sent or recorded. */
export async function previewQuoteOutcome(admin: SupabaseClient, tenantId: string, quoteId: string, opts: { outcome?: Outcome } = {}): Promise<PreviewResult> {
  const tenant = await loadTenant(admin, tenantId);
  if (!tenant?.features?.integration_middleware) return { ok: false, state: "disabled", message: "Integration middleware is not switched on for this workspace." };
  const loaded = await loadD365(admin, tenantId);
  if (!loaded) return { ok: false, state: "not_connected", message: "No ERP is connected yet. Connect one under Connections." };
  const source = await loadQuoteSource(admin, tenantId, quoteId, tenantOrigin(tenant.custom_domain));
  if (!source) return { ok: false, state: "not_found", message: "Quote not found." };
  const outcome = opts.outcome ?? outcomeForStatus(source.quote.status);
  if (!outcome) return { ok: false, state: "disabled", message: "This quote is not awarded or rejected yet." };
  const p = await prepare(admin, tenantId, tenant, source, outcome, loaded);
  const words = previewWords({
    target: p.target, productLabel: PRODUCT_NAME[p.cfg.product], ref: p.qfe.ref, customer: p.qfe.customer_name,
    lineCount: p.qfe.lines.length, total: p.qfe.total, outcome, steps: p.nothingToSend ? [p.nothingToSend] : stepsFor(p.cfg.product, outcome),
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
};

function failureMessage(c: Ctx, headline: string, fix: string, raw: string | null, status: number | null, extra: Record<string, unknown> = {}) {
  return recordMessage(c.admin, {
    tenantId: c.tenantId, direction: "out", channel: "connector", connectorId: CONNECTOR_ID, entity: c.prep.target,
    objectType: c.quoteId ? "standard_quotes" : null, objectId: c.quoteId, refLabel: c.prep.qfe.ref, status: "failed",
    httpStatus: status, error: raw, durationMs: Date.now() - c.t0,
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
    if (product === "dataverse") return await sendQuote(c);
    return await sendProject(c);
  } catch (e) {
    const x = e as { status?: number; message?: string; step?: string };
    const f = plainFailure(x, x.step);
    const r = await failureMessage(c, f.headline, f.fix, x.message ?? null, x.status ?? null, x.step ? { step: x.step } : {});
    return { state: "failed", messageId: r.id, headline: f.headline, fix: f.fix };
  }
}

async function finish(c: Ctx, a: { number: string | null; erpId: string; link: string | null; steps: string[]; total: number | null; created: boolean; warnings?: string[]; request?: unknown }): Promise<DispatchResult> {
  const { prep } = c;
  const r = await recordMessage(c.admin, {
    tenantId: c.tenantId, direction: "out", channel: "connector", connectorId: CONNECTOR_ID, entity: prep.target,
    objectType: c.quoteId ? "standard_quotes" : null, objectId: c.quoteId, refLabel: prep.qfe.ref, status: "ok", durationMs: Date.now() - c.t0,
    summary: {
      outcome: prep.outcome, ref: prep.qfe.ref, target: prep.target, erp_number: a.number, link: a.link, steps: a.steps, lines: prep.qfe.lines.length,
      total: a.total ?? prep.qfe.total, included: prep.included, trigger: c.trigger, ...(c.test ? { test: true } : {}), ...(a.warnings?.length ? { warnings: a.warnings } : {}),
    },
    payload: c.prep.body ? { request: a.request ?? c.prep.body, response: { number: a.number } } : undefined,
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
  const existing = c.quoteId ? await findLink(c.admin, c.tenantId, "standard_quotes", c.quoteId) : null;
  const res = await sendDataverseQuote(c.http, {
    ref: prep.qfe.ref, outcome: prep.outcome, existingId: existing?.external_id ?? null, create: prep.body!,
    onCreated: async (s: DataverseQuoteState) => { if (c.quoteId) await saveQuoteLink(c.admin, c.tenantId, c.quoteId, s.quoteId, s.quoteNumber); },
  });
  const link = erpDeepLink(prep.cfg, "quote", res.quoteId);
  if (c.quoteId) await saveQuoteLink(c.admin, c.tenantId, c.quoteId, res.quoteId, res.quoteNumber);
  if (res.alreadyDone) {
    if (c.quoteId) await resolveEarlier(c.admin, c.tenantId, c.quoteId, prep.outcome, null);
    return { state: "already_sent", number: res.quoteNumber, link };
  }
  return finish(c, { number: res.quoteNumber, erpId: res.quoteId, link, steps: res.steps, total: res.total, created: res.created });
}

async function sendProject(c: Ctx): Promise<DispatchResult> {
  const { prep } = c;
  const proj = prep.project!;
  const existing = c.quoteId ? await findLink(c.admin, c.tenantId, "standard_quotes", c.quoteId) : null;
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
  const row = created.row;
  const raw = row[proj.id_field] ?? row.id ?? created.entityId;
  if (raw === undefined || raw === null || raw === "") throw new ErpStepError("create", 0, "The ERP did not return the new project's id");
  const key = String(row.ProjectID ?? row.number ?? row.ProjectId ?? row[proj.id_field] ?? raw);
  const warnings: string[] = [];
  if (c.quoteId) await saveQuoteLink(c.admin, c.tenantId, c.quoteId, String(raw), key);

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
  return finish(c, { number: key, erpId: String(raw), link: null, steps: ["Created the project."], total: null, created: true, warnings });
}

// ── Public entry points ─────────────────────────────────────────────────────

export async function dispatchQuoteOutcome(
  admin: SupabaseClient, tenantId: string, quoteId: string,
  opts: { trigger: DispatchTrigger; userId?: string | null; outcome?: Outcome; http?: ErpHttp },
): Promise<DispatchResult> {
  const t0 = Date.now();
  const tenant = await loadTenant(admin, tenantId);
  if (!tenant) return { state: "not_found" };
  if (!tenant.features?.integration_middleware) return { state: "disabled", reason: "Integration middleware is not switched on for this workspace." };
  const rules = parseRules(tenant.config?.integration_middleware);

  const source = await loadQuoteSource(admin, tenantId, quoteId, tenantOrigin(tenant.custom_domain));
  if (!source) return { state: "not_found" };
  const outcome = opts.outcome ?? outcomeForStatus(source.quote.status);
  if (!outcome) return { state: "disabled", reason: "This quote is not awarded or rejected." };
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

  const prep = await prepare(admin, tenantId, tenant, source, outcome, loaded);
  let http: ErpHttp;
  try {
    http = opts.http ?? (await middlewareClient(admin, tenantId, loaded.cfg, loaded.creds));
  } catch (e) {
    const f = plainFailure(e as { status?: number; message?: string });
    const ctx = { admin, tenantId, quoteId, userId: opts.userId ?? null, trigger: opts.trigger, prep, http: null as never, t0, test: false, capture: rules.payload_capture };
    const r = await failureMessage(ctx, f.headline, f.fix, (e as Error).message, null);
    return { state: "failed", messageId: r.id, headline: f.headline, fix: f.fix };
  }
  return runSend({ admin, tenantId, quoteId, userId: opts.userId ?? null, trigger: opts.trigger, prep, http, t0, test: false, capture: rules.payload_capture });
}

// ── Test quote ──────────────────────────────────────────────────────────────

export type TestResult =
  | { ok: true; number: string | null; link: string | null; messageId: string | null; ref: string }
  | { ok: false; headline: string; fix: string; messageId: string | null };

/** A clearly named sample (ZZ prefix) sent through the real path, so Connections can prove it works.
 *  The product never deletes it. Uses the first customer that has been synced. */
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
  const { cfg, creds } = loaded;
  const target = targetFor(cfg.product)!;
  const out = outboundConfig(cfg);
  const qfe: QuoteForErp = {
    ref, title: "BPMSquare test quote, safe to ignore", customer_name: String((acct as { name?: string } | null)?.name ?? "Customer"), account_external_id: cust.id,
    description: ["Created by BPMSquare Integration middleware to test the connection. Safe to ignore."], lines, subtotal: 25, total: 25, valid_until: null, outcome: "awarded",
  };
  const prep: Prepared = {
    cfg, creds, rules, outcome: "awarded", target, source: null as never, qfe, customerArea: cust.area, problems: [], body: null, project: null, included: ["2 test lines"], refused: [], nothingToSend: null,
  };
  if (target === "quote") {
    const b = buildDataverseQuote(qfe, cfg, { quote: out.quote.field_map, quote_line: out.quote_line.field_map });
    prep.body = b.body; prep.problems = b.problems;
  } else {
    const b = buildProjectBody(qfe, out.project, { status: "awarded", dataArea: cfg.company ?? cust.area, isFo: cfg.product === "fo" });
    prep.body = b.body; prep.problems = b.problems;
    prep.project = { entity_set: out.project.entity_set, id_field: out.project.id_field, tasks: null, bom: null, taskTarget: null, bomTarget: null };
  }
  let http: ErpHttp;
  try {
    http = opts.http ?? (await middlewareClient(admin, tenantId, cfg, creds));
  } catch (e) {
    const f = plainFailure(e as { status?: number; message?: string });
    return { ok: false, headline: f.headline, fix: f.fix, messageId: null };
  }
  const res = await runSend({ admin, tenantId, quoteId: null, userId, trigger: "send_now", prep, http, t0, test: true, capture: rules.payload_capture });
  if (res.state === "sent" || res.state === "already_sent") return { ok: true, number: res.number, link: res.link, messageId: res.state === "sent" ? res.messageId : null, ref };
  if (res.state === "failed") return { ok: false, headline: res.headline, fix: res.fix, messageId: res.messageId };
  return { ok: false, headline: "Nothing was sent.", fix: "Check the connection.", messageId: null };
}
