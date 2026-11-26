import "server-only";
import crypto from "crypto";
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ROUTES } from "@/lib/constants";
import { createAdminSupabase } from "@/lib/supabase-server";
import type { CardFact, CardField, ConfirmCard, NextStep } from "@/lib/assistant/cards";
import { CARD_TIPS } from "@/lib/assistant/cardTips";
import { promptText } from "@/lib/assistant/promptSafe";
import { redactText } from "@/lib/middleware/redact";
import { loadOpportunityLines } from "@/lib/sales/opportunityServer";
import { decidersFor, proposalProblem, stageGuard } from "@/lib/tender/approval";
import { loadApprovals, loadApprovers, standingDecision } from "@/lib/tender/approvalServer";
import { BID_LIMITS, submitProblem } from "@/lib/tender/bids/rules";
import { currentSnapshot, latestVersionNo } from "@/lib/tender/bids/server";
import { buildBoqState, boqRequestFor } from "@/lib/tender/boq/server";
import { buildMatchState } from "@/lib/tender/boq/matchServer";
import { priceValidityDays } from "@/lib/tender/boq/price";
import { submitWarnings } from "@/lib/tender/submitChecks";
import { loadTender } from "@/lib/tender/server";
import { tenderRfqLines } from "@/lib/tender/rfqLines";
import type { DocLineForRfq } from "@/components/rfq/prefill";
import { RFQ_LIMITS } from "@/lib/rfq/types";
import { splitReachable } from "@/lib/rfq/reach";
import { assertTenderSuppliersAllowed } from "@/lib/supplierGroups/server";
import { validateTemplate, resolveParams } from "@/lib/estimator/template";
import type { EstimateTemplate } from "@/lib/types";
import type { TemplateInput } from "@/lib/estimator/types";
import { hash8, normaliseValue, structureHash, type SpecField } from "./card";
import { claimCard, finishCard } from "./ledger";
import { loadRecordRow, notOneMessage, resolveRecord, type RecordTarget, type Row } from "./records";
import { refuse, routeStatus, type ActBody, type ExecCtx, type ExecOutcome } from "./outcome";
import type { VerbActionDef } from "./registry";
import { signToken, type TokenPayload } from "./token";
import { runVia } from "./via";

// The tender steps as cards. Each one is a step the Pipeline's own button already takes, so the card does only two things:
// show the facts and the checks that are not a pass (the lines the screen's dialog lists, warnings the person can still go on
// past), and on the press call the very route the button posts to. Nothing here decides a price, a version or an approval.
// The deal, the suppliers and the template are resolved by the SERVER from what the person named and ride in the signed token;
// the model never supplies an id, and a press re-reads every one of them inside this workspace before the route runs.

export type VerbInput = {
  summary?: string;
  deal?: string;
  decision?: string;
  reason?: string;
  revision_reason?: string;
  note?: string;
  suppliers?: unknown;
  title?: string;
  respond_by?: string;
  template?: string;
  name?: string;
  inputs?: unknown;
  margin_pct?: unknown;
  markup_pct?: unknown;
};

export type VerbCtx = {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  perms: ExecCtx["perms"];
  isWorkspaceAdmin: boolean;
  pageRecordId?: string | null;
};

export type VerbBuild =
  | { ok: true; card: ConfirmCard; notes: string[] }
  | { ok: false; reason: string };

const DEAL: RecordTarget = { table: "opportunities", nameColumn: "title", tenderOnly: true };
const SUPPLIER: RecordTarget = { table: "suppliers", nameColumn: "name" };

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const field = (key: string, label: string, widget: SpecField["widget"], o: Partial<SpecField> = {}): SpecField =>
  ({ key, label, widget, kind: "standard", baseRequired: false, ...o });
const money = (n: unknown, currency?: string | null): string => {
  const v = Number(n);
  const text = Number.isFinite(v) ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(n ?? "");
  return currency ? `${currency} ${text}` : text;
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const stageText = (s: unknown): string => { const t = str(s).replace(/_/g, " ").trim(); return t ? t[0].toUpperCase() + t.slice(1) : "—"; };
const dealLabel = (deal: Row): string => [str(deal.ref), str(deal.title)].filter(Boolean).join(" ") || "tender deal";
const dealNext = (id: string, label: string): NextStep[] => [{ id: `open:${id}`, label: `Open ${label}`, kind: "navigate", target: ROUTES.pipelineDetail(id) }];

type Env = {
  supabase: SupabaseClient; admin: SupabaseClient; tenantId: string; userId: string; perms: ExecCtx["perms"]; isWorkspaceAdmin: boolean;
  dealId: string; deal: Row;
};

type Tg = Record<string, string | string[]>;

async function tenantConfig(env: Pick<Env, "supabase" | "tenantId">): Promise<Record<string, unknown>> {
  const { data } = await env.supabase.from("tenants").select("config").eq("id", env.tenantId).maybeSingle();
  return ((data as { config?: Record<string, unknown> } | null)?.config ?? {}) as Record<string, unknown>;
}

// ── what each step's card offers ─────────────────────────────────────────────────────────────────────────────────

const DECISION_OPTIONS = [{ value: "go", label: "Go: bid" }, { value: "no_go", label: "No-go: do not bid" }];

async function loadTemplateRow(supabase: SupabaseClient, tenantId: string, id: string): Promise<EstimateTemplate | null> {
  const { data } = await supabase.from("estimate_templates").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  return (data as EstimateTemplate | null) ?? null;
}

const inputWidget = (i: TemplateInput): SpecField["widget"] => (i.type === "number" ? "number" : i.type === "boolean" ? "checkbox" : "enum");
const inputField = (i: TemplateInput): SpecField => field(`in_${i.key}`, i.unit ? `${i.label} (${i.unit})` : i.label, inputWidget(i), {
  options: i.type === "select" ? (i.options ?? []).map((o) => ({ value: o.key, label: o.label || o.key })) : undefined,
});

/** The fields a step's card holds. For an estimate, the template's own inputs the person gave, so a press can only set those. */
async function fieldsFor(verb: VerbActionDef["verb"], env: Env, tg: Tg, offered: Set<string> | null): Promise<SpecField[]> {
  switch (verb) {
    case "decision": return [field("decision", "Decision", "enum", { baseRequired: true, options: DECISION_OPTIONS }), field("reason", "Reason", "textarea", { baseRequired: true })];
    case "submit_bid": return [field("revision_reason", "Why the bid is revised", "textarea", { baseRequired: tg.rev === "1" }), field("note", "Note", "textarea")];
    case "rfq": return [field("title", "Title", "text"), field("respond_by", "Suppliers reply by", "date")];
    case "price": return [field("markup_pct", "Markup on cost (%)", "number", { baseRequired: true })];
    case "match": return [];
    case "estimate": {
      const t = await loadTemplateRow(env.supabase, env.tenantId, str(tg.tpl));
      const inputs = (t?.inputs ?? []) as unknown as TemplateInput[];
      return [
        field("name", "Name", "text", { baseRequired: true }), field("margin_pct", "Margin (%)", "number"),
        ...inputs.map(inputField).filter((f) => offered !== null && offered.has(f.key)),
      ];
    }
  }
}

// ── building a card ──────────────────────────────────────────────────────────────────────────────────────────────

type Plan = { ok: true; title: string; values: Record<string, string>; facts: CardFact[]; checks: string[]; notices: string[]; tg: Tg; offered?: string[]; summary: string }
  | { ok: false; reason: string };

async function planDecision(env: Env, input: VerbInput): Promise<Plan> {
  const norm = str(input.decision).toLowerCase().replace(/[^a-z]/g, "");
  const decision = norm === "go" || norm === "bid" ? "go" : norm === "nogo" || norm === "nobid" ? "no_go" : "";
  if (!decision) return { ok: false, reason: "Is the decision go (bid) or no-go (do not bid)? Ask the person; no card has been shown." };
  const { rows, pending } = await loadApprovals(env.admin, env.tenantId, env.dealId);
  if (pending) return { ok: false, reason: "Approval needs a database update that has not been applied in this workspace. Tell the person; no card has been shown." };
  const { approvers, allowSelfApproval } = await loadApprovers(env.admin, env.tenantId, (await tenantConfig(env)) as never);
  const deciders = decidersFor(approvers, env.userId, allowSelfApproval);
  const problem = proposalProblem({ stage: str(env.deal.stage), outcome: str(env.deal.outcome), hasPending: rows.some((r) => r.status === "pending"), deciders });
  if (problem) return { ok: false, reason: `${problem}. Tell the person in one line; no card has been shown.` };
  const label = dealLabel(env.deal);
  return {
    ok: true, title: `Propose bid decision: ${label}`, summary: `Propose ${decision === "go" ? "go" : "no-go"} for ${label}.`,
    values: { decision, reason: str(input.reason).trim() },
    facts: [{ label: "Stage", value: stageText(env.deal.stage) }, { label: "Asked to approve", value: plural(deciders.length, "person", "people") }],
    checks: [], notices: [], tg: { id: env.dealId },
  };
}

async function unpricedFromLines(env: Env): Promise<number> {
  const lines = (await loadOpportunityLines(env.admin, env.tenantId, env.dealId)) as unknown as { is_selected?: boolean | null; break_of?: string | null; rate: number | string }[];
  return lines.filter((l) => l.is_selected !== false && !l.break_of && !(Number(l.rate) > 0)).length;
}

async function planSubmitBid(env: Env, input: VerbInput): Promise<Plan> {
  const latest = await latestVersionNo(env.admin, env.tenantId, env.dealId);
  if (latest.pending) return { ok: false, reason: "Bid versions need a database update that has not been applied in this workspace. Tell the person; no card has been shown." };
  const snap = await currentSnapshot(env.admin, env.tenantId, env.dealId);
  const problem = submitProblem({ stage: str(env.deal.stage), outcome: str(env.deal.outcome), lineCount: snap.line_count });
  if (problem) return { ok: false, reason: `${problem}. Tell the person in one line; no card has been shown.` };
  const standing = await standingDecision(env.admin, env.tenantId, env.dealId);
  const stageProblem = standing.available ? stageGuard({ from: str(env.deal.stage), to: "submitted", effective: standing.effective }) : null;
  if (stageProblem) return { ok: false, reason: `${stageProblem}. Tell the person in one line; no card has been shown.` };

  const versionNo = latest.no + 1;
  const config = await tenantConfig(env);
  const days = priceValidityDays(config as never);
  let unpriced: number | null = null;
  let stale: number | null = null;
  try {
    const r = await boqRequestFor({ supabase: env.supabase, tenantId: env.tenantId, userId: env.userId, role: env.isWorkspaceAdmin ? "admin" : "member", perms: env.perms }, env.dealId, false);
    const state = r.ok ? await buildBoqState(r.req) : null;
    if (state?.source) { unpriced = state.totals.unpriced; stale = state.totals.stale; }
  } catch { /* the saved lines answer for the unpriced count */ }
  if (unpriced === null) unpriced = await unpricedFromLines(env);
  const tender = await loadTender(env.admin, env.tenantId, env.dealId);
  const checks = submitWarnings({
    unpriced, stale, priceValidityDays: days,
    approvedGo: standing.available ? standing.effective?.proposed_value === "go" : null,
    guarantee: { amount: tender?.bid_bond_amount ?? null, expiry: tender?.bid_bond_expiry ?? null, status: tender?.bond_status ?? "held" },
  });

  const currency = str(env.deal.currency) || null;
  const label = dealLabel(env.deal);
  return {
    ok: true, title: `Submit bid: ${label}`, summary: `Submit bid version ${versionNo} for ${label}.`,
    values: { revision_reason: str(input.revision_reason).trim(), note: str(input.note).trim() },
    facts: [{ label: "Version", value: String(versionNo) }, { label: "Lines", value: String(snap.line_count) }, { label: "Total", value: money(snap.total, currency) }],
    checks, notices: [], tg: { id: env.dealId, v: String(versionNo), rev: versionNo > 1 ? "1" : "0" },
  };
}

async function rfqLinesFor(env: Pick<Env, "admin" | "tenantId" | "dealId">) {
  const lines = (await loadOpportunityLines(env.admin, env.tenantId, env.dealId)) as unknown as (DocLineForRfq & { is_selected?: boolean | null })[];
  const unpriced = new Set(lines.filter((l) => !(Number(l.rate) > 0)).map((l) => l.id));
  const composed = tenderRfqLines(lines, () => "another RFQ").filter((l) => l.include !== false && l.source_line_id && unpriced.has(l.source_line_id));
  return composed.slice(0, RFQ_LIMITS.maxLines).map((l) => ({
    product_id: l.product_id ?? null, description: l.description, spec: l.spec ?? null, uom: l.uom ?? null, qty: l.qty ?? null, source_line_id: l.source_line_id ?? null,
  }));
}

async function planRfq(env: Env, input: VerbInput): Promise<Plan> {
  const named = (Array.isArray(input.suppliers) ? input.suppliers : []).filter((s): s is string => typeof s === "string" && s.trim() !== "").map((s) => s.trim());
  if (named.length === 0) return { ok: false, reason: "Which suppliers is the RFQ for? Ask the person to name them; no card has been shown." };
  if (named.length > RFQ_LIMITS.maxSuppliers) return { ok: false, reason: `An RFQ can go to ${RFQ_LIMITS.maxSuppliers} suppliers at most. Ask the person to name fewer; no card has been shown.` };

  const picked: { id: string; row: Row }[] = [];
  for (const n of named) {
    const found = await resolveRecord(env.supabase, env.tenantId, SUPPLIER, n);
    if (found.kind !== "one") return { ok: false, reason: notOneMessage("supplier", n, found) };
    if (!picked.some((p) => p.id === found.id)) picked.push({ id: found.id, row: found.row });
  }
  const allowed = await assertTenderSuppliersAllowed(env.admin, env.tenantId, { origin_type: "opportunity", origin_id: env.dealId }, picked.map((p) => p.id));
  if (!allowed.ok) return { ok: false, reason: `${promptText(allowed.error, 300)}. Tell the person which suppliers are not allowed on this tender; no card has been shown.` };

  const lines = await rfqLinesFor(env);
  if (lines.length === 0) return { ok: false, reason: "Every line on this tender already has a price or is on an RFQ, so there is nothing to ask suppliers about. Tell the person; no card has been shown." };

  const { unreachable } = splitReachable(picked.map((p) => ({ id: p.id, name: str(p.row.name), email: str(p.row.email) || null, phone: str(p.row.phone) || null })));
  const notices: string[] = [];
  const checks = unreachable.map((u) => `${u.name || "A supplier"} has no email address, so the RFQ cannot be emailed to them until you add one.`);
  const label = dealLabel(env.deal);
  return {
    ok: true, title: `Create RFQ: ${label}`, summary: `Create an RFQ for the lines of ${label} that have no price, for ${picked.map((p) => str(p.row.name)).join(", ")}.`,
    values: { title: str(input.title).trim(), respond_by: str(input.respond_by).trim() },
    facts: [
      { label: "Suppliers", value: picked.map((p) => str(p.row.name)).join(", ") },
      { label: "Lines without a price", value: String(lines.length) },
    ],
    checks, notices, tg: { id: env.dealId, sup: picked.map((p) => p.id) },
  };
}

const norm = (s: string) => s.trim().toLowerCase();

async function planEstimate(env: Env, input: VerbInput): Promise<Plan> {
  const wanted = str(input.template).trim();
  if (!wanted) return { ok: false, reason: "Which estimate template? Ask the person to name one; no card has been shown." };
  const { data } = await env.supabase.from("estimate_templates").select("*").eq("tenant_id", env.tenantId).limit(200);
  const all = ((data ?? []) as EstimateTemplate[]).filter((t) => t.is_active !== false);
  const exact = all.filter((t) => norm(t.name) === norm(wanted));
  const near = exact.length ? exact : all.filter((t) => norm(t.name).includes(norm(wanted)));
  if (near.length !== 1) {
    const list = near.length ? near : all;
    return {
      ok: false,
      reason: near.length === 0
        ? `No estimate template is called "${promptText(wanted, 80)}". Templates: ${list.slice(0, 10).map((t) => promptText(t.name, 60)).join("; ") || "none yet"}. Ask which one; no card has been shown.`
        : `Several templates match "${promptText(wanted, 80)}": ${near.slice(0, 6).map((t) => promptText(t.name, 60)).join("; ")}. Ask which one; no card has been shown.`,
    };
  }
  const tpl = near[0];
  const valid = validateTemplate({ ...(tpl.geometry ? { geometry: tpl.geometry } : {}), inputs: tpl.inputs ?? [], rates: tpl.rates ?? [], rules: tpl.rules ?? [] } as never);
  if (!valid.ok) return { ok: false, reason: `The template "${promptText(tpl.name, 60)}" has problems and cannot be used yet. Tell the person; no card has been shown.` };

  const inputs = (tpl.inputs ?? []) as unknown as TemplateInput[];
  const given = input.inputs && typeof input.inputs === "object" && !Array.isArray(input.inputs) ? Object.entries(input.inputs as Record<string, unknown>) : [];
  const notices: string[] = [];
  const supplied: Record<string, unknown> = {};
  for (const [k, v] of given) {
    const i = inputs.find((x) => norm(x.label) === norm(k) || x.key === k.trim());
    if (!i) { notices.push(`"${promptText(k, 60)}" is not an input of this template.`); continue; }
    if (typeof v === "object" || v === null || v === undefined) continue;
    let value: unknown = typeof v === "string" ? v.trim() : v;
    if (i.type === "select") {
      const opt = (i.options ?? []).find((o) => o.key === value || norm(o.label || "") === norm(String(value)));
      if (!opt) { notices.push(`${i.label}: "${promptText(String(value), 40)}" is not one of the options.`); continue; }
      value = opt.key;
    } else if (i.type === "boolean") {
      const t = norm(String(value));
      value = ["true", "yes", "1", "on"].includes(t) ? true : ["false", "no", "0", "off"].includes(t) ? false : undefined;
      if (value === undefined) { notices.push(`${i.label} must be yes or no.`); continue; }
    }
    const check = resolveParams([i], { [i.key]: value });
    if (!check.ok) { notices.push(check.issues[0].message); continue; }
    supplied[i.key] = check.params[i.key];
  }

  let margin = "";
  if (input.margin_pct !== undefined && input.margin_pct !== null && input.margin_pct !== "") {
    const m = Number(input.margin_pct);
    if (Number.isFinite(m) && m >= 0 && m <= 1000) margin = String(m);
    else notices.push("The margin must be between 0 and 1000 percent; it was left out.");
  }

  const values: Record<string, string> = { name: str(input.name).trim() || `${tpl.name} · ${dealLabel(env.deal)}`.slice(0, 200), margin_pct: margin };
  for (const i of inputs) if (i.key in supplied) values[`in_${i.key}`] = String(supplied[i.key]);
  const label = dealLabel(env.deal);
  return {
    ok: true, title: `Create estimate: ${tpl.name}`, summary: `Create an estimate from ${tpl.name} for ${label}.`, values,
    facts: [{ label: "Template", value: tpl.name }, { label: "For", value: label }],
    checks: [], notices, offered: Object.keys(values), tg: { id: env.dealId, tpl: tpl.id, acc: str(env.deal.account_id) },
  };
}

async function boqFor(env: Env) {
  return boqRequestFor({ supabase: env.supabase, tenantId: env.tenantId, userId: env.userId, role: env.isWorkspaceAdmin ? "admin" : "member", perms: env.perms }, env.dealId, false);
}

async function planMatch(env: Env): Promise<Plan> {
  const r = await boqFor(env);
  if (!r.ok) return { ok: false, reason: "The bill of quantities of this tender could not be opened. Tell the person; no card has been shown." };
  const state = await buildMatchState(r.req);
  if (!state.enabled) return { ok: false, reason: "The Products module is not on in this workspace, so there is no catalog to match against. Tell the person; no card has been shown." };
  if (state.rows.length === 0) return { ok: false, reason: "Every line already has a catalog product, or there is no BOQ yet. Tell the person; no card has been shown." };
  if (state.strong === 0) return { ok: false, reason: `None of the ${state.rows.length} lines without a product has a strong match, so nothing would be linked. Tell the person they can pick products on the BOQ tab; no card has been shown.` };
  const label = dealLabel(env.deal);
  return {
    ok: true, title: `Match to products: ${label}`, summary: `Link the strong product matches on the BOQ of ${label}.`, values: {},
    facts: [
      { label: "Lines without a product", value: String(state.rows.length) },
      { label: "Strong matches to link", value: String(state.strong) },
      { label: "Left for you to pick", value: String(state.rows.length - state.strong) },
    ],
    checks: [], notices: [], tg: { id: env.dealId, v: state.lines_version },
  };
}

async function planPrice(env: Env, input: VerbInput): Promise<Plan> {
  const r = await boqFor(env);
  if (!r.ok) return { ok: false, reason: "The bill of quantities of this tender could not be opened. Tell the person; no card has been shown." };
  const state = await buildBoqState(r.req);
  if (state.pending || !state.source) return { ok: false, reason: "This tender has no BOQ yet: it is uploaded on the BOQ tab first. Tell the person; no card has been shown." };
  if (state.totals.unpriced === 0) return { ok: false, reason: "Every line of the BOQ already has a price, and Price all never changes a price that is there. Tell the person; no card has been shown." };
  const notices: string[] = [];
  let markup = String(state.default_markup_pct);
  if (input.markup_pct !== undefined && input.markup_pct !== null && input.markup_pct !== "") {
    const m = Number(input.markup_pct);
    if (Number.isFinite(m) && m >= 0 && m <= 1000) markup = String(m);
    else notices.push(`The markup must be between 0 and 1000 percent; the workspace's ${state.default_markup_pct}% is used.`);
  }
  const checks = state.totals.stale > 0
    ? [`${plural(state.totals.stale, "priced line has", "priced lines have")} a price older than ${state.validity_days} days. Price all leaves priced lines as they are.`]
    : [];
  const label = dealLabel(env.deal);
  return {
    ok: true, title: `Price all: ${label}`, summary: `Price the lines of the BOQ of ${label} that have no price.`, values: { markup_pct: markup },
    facts: [{ label: "Lines without a price", value: String(state.totals.unpriced) }, { label: "Lines in the BOQ", value: String(state.totals.lines) }],
    checks, notices, tg: { id: env.dealId },
  };
}

export async function buildVerbCard(
  ctx: VerbCtx, def: VerbActionDef, input: VerbInput, newId: () => string = () => crypto.randomUUID(),
): Promise<VerbBuild> {
  const found = await resolveRecord(ctx.supabase, ctx.tenantId, DEAL, input.deal, ctx.pageRecordId);
  if (found.kind !== "one") return { ok: false, reason: notOneMessage("tender deal", input.deal, found) };
  const env: Env = {
    supabase: ctx.supabase, admin: createAdminSupabase(), tenantId: ctx.tenantId, userId: ctx.userId, perms: ctx.perms, isWorkspaceAdmin: ctx.isWorkspaceAdmin,
    dealId: found.id, deal: found.row,
  };

  const plan: Plan =
    def.verb === "decision" ? await planDecision(env, input)
    : def.verb === "submit_bid" ? await planSubmitBid(env, input)
    : def.verb === "rfq" ? await planRfq(env, input)
    : def.verb === "estimate" ? await planEstimate(env, input)
    : def.verb === "match" ? await planMatch(env)
    : await planPrice(env, input);
  if (!plan.ok) return plan;

  const spec = await fieldsFor(def.verb, env, plan.tg, plan.offered ? new Set(plan.offered) : null);
  const fields: CardField[] = spec.map((f) => ({
    key: f.key, label: f.label, value: plan.values[f.key] ?? "", required: f.baseRequired, widget: f.widget, options: f.options,
  }));
  const cardId = newId();
  const summary = (input.summary ?? "").trim().slice(0, 240) || plan.summary;
  const token = signToken({
    cid: cardId, tid: ctx.tenantId, uid: ctx.userId, act: def.key, h: structureHash(def, { fields: spec, rules: [] }), dup: "", sm: summary,
    pv: Object.fromEntries(spec.map((f) => [f.key, hash8(plan.values[f.key] ?? "")])), tg: plan.tg,
  });
  return {
    ok: true, notes: plan.checks,
    card: {
      id: cardId, token, action: "verb", object: def.verb, noun: def.noun, title: plan.title, summary, fields, duplicates: [],
      notices: plan.notices, facts: plan.facts, checks: plan.checks, primaryLabel: def.primaryLabel, risk: "write", info: CARD_TIPS[CARD_TIP_FOR[def.verb]],
    },
  };
}

const CARD_TIP_FOR = { decision: "decision", submit_bid: "submit_bid", rfq: "rfq", estimate: "estimate", match: "match", price: "price" } as const;

// ── the press ────────────────────────────────────────────────────────────────────────────────────────────────────

type Pressed =
  | { ok: true; route: string; load: () => Promise<Response>; done: (json: Row) => { record: { id: string; href: string; label: string }; next: NextStep[]; message: string; details: string[] } }
  | { ok: false; out: ExecOutcome };

const fail = (status: number, code: string, error: string): Pressed => ({ ok: false, out: refuse(status, code, error) });

async function prepare(ctx: ExecCtx, def: VerbActionDef, env: Env, tg: Tg, values: Record<string, string>): Promise<Pressed> {
  const id = env.dealId;
  const label = dealLabel(env.deal);
  const route = def.route.replace("[id]", id);
  const call = async (body: Record<string, unknown>): Promise<Response> => {
    const { POST } = await def.load();
    const req = new NextRequest(new URL(route, ctx.baseUrl), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return POST(req, { params: Promise.resolve({ id }) });
  };
  const onDeal = (message: string, details: string[] = []) => ({ record: { id, href: ROUTES.pipelineDetail(id), label }, next: dealNext(id, label), message, details });

  switch (def.verb) {
    case "decision":
      return {
        ok: true, route, load: () => call({ decision: values.decision, reason: values.reason }),
        done: () => onDeal(`Proposed ${values.decision === "go" ? "go" : "no-go"} for ${label}`, ["Your approvers have been told and decide it on the deal."]),
      };
    case "submit_bid": {
      const latest = await latestVersionNo(env.admin, env.tenantId, id);
      if (String(latest.no + 1) !== tg.v) return fail(409, "stale_record", "A new bid version was submitted since this card was shown. Ask me again and I will show the current one.");
      if (tg.rev === "1" && (values.revision_reason ?? "").length < BID_LIMITS.reasonMin) return fail(422, "missing", "Say why the bid is revised.");
      return {
        ok: true, route, load: () => call({ revision_reason: values.revision_reason ?? "", note: values.note ?? "" }),
        done: (j) => onDeal(`Bid version ${j.version_no ?? tg.v} submitted for ${label}`, [
          `${plural(Number(j.line_count ?? 0), "line", "lines")} · ${money(j.total, str(env.deal.currency) || null)}`,
          ...(j.stage_error ? [`The tender could not be moved to Submitted: ${str(j.stage_error)}`] : []),
        ]),
      };
    }
    case "rfq": {
      const sup = Array.isArray(tg.sup) ? tg.sup : [];
      const { data } = await env.supabase.from("suppliers").select("id").eq("tenant_id", env.tenantId).in("id", sup);
      if (((data ?? []) as { id: string }[]).length !== sup.length) return fail(422, "ref", "A supplier on this card was not found in this workspace. Ask me again.");
      const lines = await rfqLinesFor(env);
      if (lines.length === 0) return fail(422, "nothing", "Every line already has a price or is on an RFQ now, so there is nothing to ask suppliers about.");
      return {
        ok: true, route, load: () => call({
          ...(values.title ? { title: values.title } : {}), ...(values.respond_by ? { respond_by: values.respond_by } : {}),
          origin_type: "opportunity", origin_id: id, lines, supplier_ids: sup, send: false,
        }),
        done: (j) => {
          const ref = str(j.ref) || "RFQ";
          const rid = str(j.id);
          return {
            record: { id: rid, href: ROUTES.rfq(rid), label: ref },
            next: [{ id: `deal:${id}`, label: `Open ${label}`, kind: "navigate", target: ROUTES.pipelineDetail(id) }],
            message: `Created ${ref}: ${plural(lines.length, "line", "lines")} for ${plural(sup.length, "supplier", "suppliers")}`,
            details: ["It is a draft. Nothing has been sent to the suppliers."],
          };
        },
      };
    }
    case "estimate": {
      const t = await loadTemplateRow(env.supabase, env.tenantId, str(tg.tpl));
      if (!t || t.is_active === false) return fail(422, "ref", "That estimate template is not available any more. Ask me again.");
      const inputs = (t.inputs ?? []) as unknown as TemplateInput[];
      const params: Record<string, unknown> = {};
      for (const i of inputs) {
        const v = values[`in_${i.key}`];
        if (v === undefined) continue;
        params[i.key] = i.type === "number" ? Number(v) : i.type === "boolean" ? v === "true" : v;
      }
      return {
        ok: true, route, load: () => call({
          name: values.name, template_id: t.id, ...(tg.acc ? { account_id: str(tg.acc) } : {}), opportunity_id: id,
          ...(values.margin_pct ? { margin_pct: Number(values.margin_pct) } : {}), params,
        }),
        done: (j) => {
          const ref = str(j.ref) || values.name;
          const eid = str(j.id);
          const warnings = Array.isArray(j.warnings) ? (j.warnings as unknown[]).filter((w): w is string => typeof w === "string").slice(0, 3) : [];
          return {
            record: { id: eid, href: ROUTES.estimate(eid), label: ref },
            next: [{ id: `deal:${id}`, label: `Open ${label}`, kind: "navigate", target: ROUTES.pipelineDetail(id) }],
            message: `Created estimate ${ref} on ${label}`, details: warnings,
          };
        },
      };
    }
    case "match":
      return {
        ok: true, route, load: () => call({ base_version: str(tg.v), accept_strong: true }),
        done: (j) => onDeal(`Linked ${plural(Number(j.linked ?? 0), "line", "lines")} to products`, Number(j.skipped ?? 0) > 0 ? [`${plural(Number(j.skipped), "line was", "lines were")} already linked and left alone.`] : []),
      };
    case "price":
      return {
        ok: true, route, load: () => call({ all: true, markup_pct: Number(values.markup_pct) }),
        done: (j) => onDeal(`Priced ${plural(Number(j.priced ?? 0), "line", "lines")}`, Number(j.left_count ?? 0) > 0 ? [`${plural(Number(j.left_count), "line", "lines")} left without a price: no fresh source for ${Number(j.left_count) === 1 ? "it" : "them"}.`] : []),
      };
  }
}

export async function executeVerb(ctx: ExecCtx, body: ActBody, payload: TokenPayload, def: VerbActionDef, cardId: string): Promise<ExecOutcome> {
  const id = typeof payload.tg?.id === "string" ? payload.tg.id : "";
  const deal = await loadRecordRow(ctx.supabase, ctx.tenantId, DEAL, id);
  if (!deal) return refuse(422, "record", "This tender deal was not found in this workspace.");
  const env: Env = {
    supabase: ctx.supabase, admin: ctx.admin, tenantId: ctx.tenantId, userId: ctx.userId, perms: ctx.perms, isWorkspaceAdmin: ctx.role === "admin",
    dealId: id, deal,
  };
  const tg = payload.tg as Tg;

  const offered = new Set(Object.keys(payload.pv));
  const spec = await fieldsFor(def.verb, env, tg, offered);
  if (structureHash(def, { fields: spec, rules: [] }) !== payload.h) return refuse(409, "stale", "This step changed since the card was shown. Ask me again.");

  const raw = body.values && typeof body.values === "object" && !Array.isArray(body.values) ? (body.values as Record<string, unknown>) : {};
  const unknown = Object.keys(raw).filter((k) => !offered.has(k) || !spec.some((f) => f.key === k));
  if (unknown.length) return refuse(422, "unknown_field", "A field that is not on the card was sent.", { fields: unknown });
  const values: Record<string, string> = {};
  for (const f of spec) {
    const n = normaliseValue(f, raw[f.key]);
    if (!n.ok) return refuse(422, "invalid", n.error, { errors: { [f.key]: n.error } });
    if (n.value) values[f.key] = n.value;
  }
  const missing = spec.filter((f) => f.baseRequired && !values[f.key]);
  if (missing.length) return refuse(422, "missing", `${missing[0].label} is required.`, { missing: missing.map((f) => f.key) });

  const prepared = await prepare(ctx, def, env, tg, values);
  if (!prepared.ok) return prepared.out;

  const shown = {
    action: def.key, object: def.verb, summary: redactText(payload.sm), record: { id, label: redactText(dealLabel(deal)) },
    fields: spec.map((f) => ({ key: f.key, label: f.label })), proposed_keys: Object.keys(payload.pv),
    edited: Object.keys(values).filter((k) => payload.pv[k] !== hash8(values[k])),
    values: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, redactText(v)])),
  };
  const claim = await claimCard(ctx.admin, {
    cardId, tenantId: ctx.tenantId, userId: ctx.userId, kind: "verb", actionKey: def.key, route: prepared.route, card: shown, params: { id, values: shown.values },
  });
  if (claim.state === "done") return refuse(409, "already_done", "This card has already been used.", { result: claim.result });
  if (claim.state === "unavailable") return refuse(503, "unavailable", "The assistant cannot make changes yet: its setup is not finished in this workspace. Use the screen instead.");
  if (claim.state === "busy") return refuse(409, "in_progress", "This card is already being processed.");
  const handle = { cardId, tenantId: ctx.tenantId, userId: ctx.userId };

  try {
    const res = await runVia("assistant", () => prepared.load());
    const json = (await res.json().catch(() => ({}))) as Row;
    if (!res.ok) {
      const message = str(json.error) || `The ${def.noun} could not be done.`;
      await finishCard(ctx.admin, handle, { status: "failed", result: { error: redactText(message), status: res.status } });
      return refuse(routeStatus(res.status), "route_refused", message);
    }
    const result = prepared.done(json);
    await finishCard(ctx.admin, handle, { status: "done", result: { ...result.record, message: result.message, details: result.details } });
    return { status: 200, body: { ok: true, ...result } };
  } catch (e) {
    console.error("Assistant tender step failed:", e);
    await finishCard(ctx.admin, handle, { status: "failed", result: { error: `The ${def.noun} could not be done.` } });
    return refuse(500, "failed", `The ${def.noun} could not be done.`);
  }
}
