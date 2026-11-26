import "server-only";
import crypto, { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canEditWorkcenter, canViewWorkcenter, type PermissionSet } from "@/lib/permissions";
import { OBJECT_FEATURE } from "@/lib/objectFeatureMap";
import { actionsEnabled } from "@/lib/actions/registry";
import { hashOf, signToken } from "@/lib/actions/token";
import { sameCompany, parseNewCompetitor, COMPETITOR_LIMITS } from "@/lib/tender/competitors/rules";
import { listCompetitors } from "@/lib/tender/competitors/server";
import { loadOpportunity } from "@/lib/sales/opportunityServer";
import { smallModel } from "../models";
import { promptText } from "../promptSafe";
import type { ConfirmCard } from "../cards";
import { buildCard, competitorsToolResult } from "./card";
import { computeAnalysis } from "./compute";
import { loadAnalysisInput, resolveDeal, type LoadDeps } from "./load";
import { writeNarrative, type NarrativeClient } from "./narrative";
import type { DockCompetitors } from "./types";

// The assistant's two competitor tools (docs/design/assistant-smarter.md section 8).
//   analyse_competitors  read only. The server computes everything from this workspace's own records; the model writes two short
//                        texts from the computed block and nothing else. The result is a card, never model text.
//   propose_competitor   the one write. It only makes a confirm card: nothing exists until the person presses its button, which
//                        runs the competitors route on their own session (press.ts). Off with the rest of the assistant's actions.
// Neither takes a workspace from the model: the tenant is the session's, and a tender is found by reference inside it.

export const ANALYSE_COMPETITORS_TOOL = "analyse_competitors";
export const PROPOSE_COMPETITOR_TOOL = "propose_competitor";

export const COMPETITOR_PROMPT_RULE =
  "\n15. COMPETITORS: when the person asks about the competitors on a tender, who they are bidding against, their chances of winning, how low to price, " +
  "the margin to bid at or how to position a tender, call analyse_competitors. Pass deal (a reference such as OPP-0034) or leave it out when a tender deal is open on their screen; " +
  "pass competitor only when they asked about one named company. The app draws the answer as a card, so after it write ONE short sentence and repeat none of its figures. Before calling it write nothing. " +
  "To add a competitor to a tender call propose_competitor with the name exactly as the person wrote it; it only shows a card, and nothing is added until they press its button, so never say it was added.";

export type CompetitorGate = { analyse: boolean; propose: boolean; costVisible: boolean };

const featureOn = (features: Record<string, boolean | undefined>, object: string): boolean => {
  const f = OBJECT_FEATURE[object];
  return f === undefined || f === null || features[f] === true;
};

/** Who may use which tool. The analysis needs the assistant, the tender edition, the Pipeline, and its view; the write also the actions flag and an edit grant. */
export function competitorGate(a: { features: Record<string, boolean | undefined>; perms: PermissionSet; userId?: string }): CompetitorGate {
  const f = a.features;
  const analyse = f.ai_assistant === true && f.gcc_tender === true && f.pipeline === true && canViewWorkcenter(a.perms, "pipeline");
  const costVisible = (featureOn(f, "estimates") && canViewWorkcenter(a.perms, "estimates")) || (featureOn(f, "rfqs") && canViewWorkcenter(a.perms, "rfqs"));
  return {
    analyse,
    propose: analyse && !!a.userId && actionsEnabled(f) && canEditWorkcenter(a.perms, "pipeline"),
    costVisible: analyse && costVisible,
  };
}

const clean = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = [...v].map((ch) => { const n = ch.charCodeAt(0); return n < 32 || n === 127 || ch === "|" || ch === "<" || ch === ">" ? " " : ch; }).join("").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max).trim() : null;
};

export type AnalyseInput = { deal: string | null; competitor: string | null };
export type ProposeInput = { deal: string | null; name: string | null; country: string | null; note: string | null };

export const parseAnalyseInput = (raw: unknown): AnalyseInput => {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { deal: clean(r.deal, 40), competitor: clean(r.competitor, COMPETITOR_LIMITS.nameMax) };
};

export const parseProposeInput = (raw: unknown): ProposeInput => {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { deal: clean(r.deal, 40), name: clean(r.name, COMPETITOR_LIMITS.nameMax), country: clean(r.country, COMPETITOR_LIMITS.countryMax), note: clean(r.note, COMPETITOR_LIMITS.notesMax) };
};

export function analyseCompetitorsTool(): Anthropic.Tool {
  return {
    name: ANALYSE_COMPETITORS_TOOL,
    description:
      "Show a competitor analysis and bid strategy card for a TENDER deal: the competitors recorded on it, how this workspace has fared against each of them before, " +
      "the margin ladder (chance of winning and expected profit at each margin, with a recommended range) and the risks. Read only: the app computes every figure from the workspace's own records. " +
      "Use it for questions about competitors, chances of winning, how low to price, the margin to bid at, or how to position a tender. " +
      "Pass deal as the tender's reference (for example OPP-0034), or leave it out when a tender deal is open on the person's screen. Pass competitor only when they asked about one named company. " +
      "The app draws the card: you then write ONE short sentence and do not repeat it.",
    input_schema: {
      type: "object",
      properties: {
        deal: { type: "string", description: "The tender deal's reference, such as OPP-0034." },
        competitor: { type: "string", description: "One competitor on that tender, only when the person asked about it by name." },
      },
    },
  };
}

export function proposeCompetitorTool(): Anthropic.Tool {
  return {
    name: PROPOSE_COMPETITOR_TOOL,
    description:
      "Show a card to add a competitor to a tender deal. Nothing is added until the person presses the button on the card, so never say it was added. " +
      "Pass the company's name exactly as the person wrote it; pass country or note only when they said them. Pass deal as the tender's reference, or leave it out when a tender deal is open on their screen.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "The competitor company, as the person wrote it." },
        deal: { type: "string", description: "The tender deal's reference, such as OPP-0034." },
        country: { type: "string" },
        note: { type: "string", description: "A short note, only if the person gave one." },
      },
      required: ["name"],
    },
  };
}

export type CompetitorEnv = {
  /** The service-role client: every query below carries the workspace. */
  admin: SupabaseClient;
  tenantId: string;
  userId: string | null;
  perms: PermissionSet;
  features: Record<string, boolean | undefined>;
  now: Date;
  /** The deal on the person's screen, when one is open. */
  openDealId: string | null;
  /** Web research is switched on: the card may offer it. */
  webOn: boolean;
  /** The metered client for the one small-model call; null writes the plain wording. */
  client: NarrativeClient | null;
  deps?: LoadDeps;
};

export type AnalyseOutcome = { kind: "card"; card: DockCompetitors; out: string } | { kind: "error"; message: string };

export async function runAnalyseCompetitors(raw: unknown, env: CompetitorEnv): Promise<AnalyseOutcome> {
  const gate = competitorGate({ features: env.features, perms: env.perms, userId: env.userId ?? undefined });
  if (!gate.analyse) return { kind: "error", message: "Competitor analysis is not available to this person here." };
  const input = parseAnalyseInput(raw);
  const found = await resolveDeal(env.admin, env.tenantId, input, env.openDealId);
  if (!found.ok) return { kind: "error", message: found.message };
  const loaded = await loadAnalysisInput(env.admin, env.tenantId, found.id, { costVisible: gate.costVisible, focus: input.competitor, now: env.now, deps: env.deps });
  if (!loaded.ok) return { kind: "error", message: loaded.message };
  if (input.competitor && !loaded.input.competitors.some((c) => sameCompany(c.name, input.competitor!))) {
    return { kind: "error", message: `${promptText(input.competitor, 80)} is not on the competitor list of ${loaded.input.deal.ref}. ${gate.propose ? "Offer to add it with propose_competitor." : "Tell the person to add it on the Competitors tab."}` };
  }
  const computed = computeAnalysis(loaded.input);
  const narrative = await writeNarrative(computed, { client: env.client, model: smallModel() });
  const card = buildCard(computed, narrative, { canEdit: gate.propose, webOn: env.webOn });
  return { kind: "card", card, out: competitorsToolResult(card) };
}

// ── the confirm card ─────────────────────────────────────────────────────────────────────────────────────────────────────

export const PROPOSE_ACT = "propose_competitor";
export const PRESS_ROUTE = "/api/ai/act/competitor";

/** What the card offers. Part of the signed token, so the press can only send these fields. */
export const CARD_FIELDS = [
  { key: "name", label: "Company", widget: "text", required: true },
  { key: "country", label: "Country", widget: "text", required: false },
  { key: "note", label: "Note", widget: "textarea", required: false },
] as const;

export const structureOf = (): string => hashOf({ a: PROPOSE_ACT, f: CARD_FIELDS.map((f) => [f.key, f.widget, f.required]) });
export const actOf = (dealId: string): string => `${PROPOSE_ACT}:${dealId}`;
export const hash8 = (s: string): string => crypto.createHash("sha256").update(s).digest("base64url").slice(0, 8);

export type ProposeOutcome = { kind: "card"; card: ConfirmCard; out: string } | { kind: "error"; message: string };

export async function runProposeCompetitor(raw: unknown, env: CompetitorEnv): Promise<ProposeOutcome> {
  const gate = competitorGate({ features: env.features, perms: env.perms, userId: env.userId ?? undefined });
  if (!gate.propose || !env.userId) return { kind: "error", message: "Adding a competitor from chat is not enabled for this person here." };
  const input = parseProposeInput(raw);
  if (!input.name) return { kind: "error", message: "Ask the person which company to add." };
  const found = await resolveDeal(env.admin, env.tenantId, { deal: input.deal, competitor: null }, env.openDealId);
  if (!found.ok) return { kind: "error", message: found.message };

  const parsed = parseNewCompetitor({ name: input.name, country: input.country ?? "", notes: input.note ?? "" });
  if (!parsed.ok) return { kind: "error", message: `${parsed.error}. Tell the person.` };
  const opp = await loadOpportunity(env.admin, env.tenantId, found.id);
  if (!opp) return { kind: "error", message: "That is not a tender deal in this workspace." };
  const ref = opp.ref ?? "this tender";

  const { rows, pending } = await listCompetitors(env.admin, env.tenantId, found.id, { includeRejected: true });
  if (pending) return { kind: "error", message: "Competitors are not set up in this workspace yet." };
  const same = rows.find((r) => sameCompany(r.name, parsed.value.name));
  if (same && same.status === "accepted") return { kind: "error", message: `${promptText(same.name, 80)} is already on the competitor list of ${ref}. Say so; no card is needed.` };
  if (same && same.status === "proposed") return { kind: "error", message: `${promptText(same.name, 80)} is already proposed on ${ref}. Tell the person to accept it on the Competitors tab.` };
  if (rows.filter((r) => r.status !== "rejected").length >= COMPETITOR_LIMITS.perDeal) return { kind: "error", message: `${ref} already holds ${COMPETITOR_LIMITS.perDeal} competitors, the most one tender can have.` };

  const values: Record<string, string> = { name: parsed.value.name, country: parsed.value.country ?? "", note: parsed.value.notes ?? "" };
  const cardId = randomUUID();
  const summary = `Add ${promptText(values.name, 80)} to the competitors on ${promptText(ref, 40)}.`;
  const token = signToken({
    cid: cardId, tid: env.tenantId, uid: env.userId, act: actOf(found.id), h: structureOf(), dup: hashOf([]), sm: summary,
    pv: Object.fromEntries(Object.entries(values).filter(([, v]) => v).map(([k, v]) => [k, hash8(v)])),
  });
  const card: ConfirmCard = {
    id: cardId, token, action: "create", object: "competitor", noun: "competitor",
    title: `Add a competitor to ${promptText(ref, 40)}`,
    summary,
    fields: CARD_FIELDS.map((f) => ({ key: f.key, label: f.label, value: values[f.key], required: f.required, widget: f.widget })),
    duplicates: [],
    notices: same ? [`${promptText(same.name, 80)} was removed from this tender earlier. Adding it again brings it back.`] : [],
    primaryLabel: "Add competitor",
    risk: "write",
    press: PRESS_ROUTE,
  };
  return { kind: "card", card, out: `Card shown to add ${promptText(values.name, 80)} to ${promptText(ref, 40)}. Nothing is added until the person presses its button. Reply with one short line and never say it was added.` };
}
