import { NextResponse, NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getAuthUser } from "@/lib/supabase-server";
import { getTenant } from "@/lib/tenant";
import { logChange } from "@/lib/changeLog";
import { allowanceFor, logUsage } from "@/lib/ai/structured";
import { OVER_BUDGET_MESSAGE, resolveMonthlyBudget } from "@/lib/ai/usageCap";
import { webAvailability } from "@/lib/assistant/webConsent";
import { AnalysisResearchError, NO_KEY } from "@/lib/analysis/research";
import { dayStartIso } from "@/lib/analysis/budget";
import { isMissingSchema } from "@/lib/tender/server";
import { openTenderDealRequest } from "@/lib/tender/dealAccess";
import { COMPETITOR_LIMITS, readResearchAnswers } from "@/lib/tender/competitors/rules";
import { COMPETITOR_COLS_LEGACY, PENDING_COMPETITORS, PENDING_RESEARCH, listCompetitors } from "@/lib/tender/competitors/server";
import { runCompetitorResearch } from "@/lib/tender/competitors/research";
import {
  DAILY_CAP_MESSAGE, NO_PROPOSALS_NOTICE, RESEARCH_LIMITS, RESEARCH_SURFACE, TIMEOUT_MESSAGE, WEB_OFF_TEXT, completeAnswers, mergeAnswers, missingQuestions, validateCompetitorResearch,
} from "@/lib/tender/competitors/researchRules";

// POST /api/opportunities/[id]/competitors/research { answers?, fresh? } -- "Suggest from market research".
// The model never decides anything: it is asked for sourced candidates, and validateCompetitorResearch() keeps only what a page the
// search provider itself reported supports. Candidates are saved as `proposed` rows (not part of the tender until a person accepts), a
// fact without a source never reaches the database, and "not found" is the only fallback. Order: the tender gate, web research switched
// on, migration 0239 applied, the three questions answered (asked first, nothing runs until they are), the monthly allowance, the
// per-tender daily cap, the key, then the search. The usage row is written only after a completed call, so a failure holds nothing.
export const maxDuration = 120;

type Body = { answers?: unknown; fresh?: unknown };

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openTenderDealRequest(id, true);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, supabase, tenantId, userId, opp, tender } = gate.req;

  const tenant = await getTenant();
  const web = webAvailability((tenant?.features ?? {}) as Record<string, boolean | undefined>, tenant?.config as { ai_assistant?: { block_external_calls?: boolean } } | null | undefined);
  if (!web.enabled) return NextResponse.json({ error: WEB_OFF_TEXT[web.reason], code: web.reason }, { status: 403 });

  const { rows: all, pending, researchPending } = await listCompetitors(admin, tenantId, id, { includeRejected: true });
  if (pending) return NextResponse.json({ error: PENDING_COMPETITORS }, { status: 503 });
  if (researchPending) return NextResponse.json({ error: PENDING_RESEARCH }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as Body;
  const custom = (tender.custom_data ?? {}) as Record<string, unknown>;
  const country = defaultCountry(tenant?.config);
  const known = mergeAnswers(custom.competitor_research, body?.answers, body?.fresh === true);
  const needs = missingQuestions(known, { country });
  if (needs.length > 0) return NextResponse.json({ needs });
  const answers = completeAnswers(known)!;

  // The answers are context for the person (shown on the tab), saved on the tender; they are not tender fields and nothing else reads them.
  const saved = readResearchAnswers(custom.competitor_research);
  if (!saved || saved.scope !== answers.scope || saved.region !== answers.region || saved.issuer_type !== answers.issuer_type) {
    const stored = await admin.from("opportunity_tenders")
      .update({ custom_data: { ...custom, competitor_research: { ...answers, answered_at: new Date().toISOString() } }, updated_at: new Date().toISOString() })
      .eq("opportunity_id", id).eq("tenant_id", tenantId);
    if (stored.error) return NextResponse.json({ error: isMissingSchema(stored.error) ? PENDING_COMPETITORS : stored.error.message }, { status: isMissingSchema(stored.error) ? 503 : 500 });
  }

  const allowance = await allowanceFor(tenantId, resolveMonthlyBudget((tenant?.config as { ai_assistant?: { monthly_token_budget?: number } } | undefined)?.ai_assistant?.monthly_token_budget));
  if (!allowance.allowed) return NextResponse.json({ error: OVER_BUDGET_MESSAGE, code: "over_budget" }, { status: 429 });

  const now = new Date();
  const today = await admin.from("ai_usage_log").select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId).eq("surface", RESEARCH_SURFACE).eq("study_id", id).gte("created_at", dayStartIso(now));
  if (today.error && !isMissingSchema(today.error)) return NextResponse.json({ error: "Could not check today's research runs. Try again in a moment." }, { status: 500 });
  if ((today.count ?? 0) >= RESEARCH_LIMITS.perDay) return NextResponse.json({ error: DAILY_CAP_MESSAGE, code: "daily_cap" }, { status: 429 });

  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: NO_KEY, code: "no_key" }, { status: 503 });

  const boq = await admin.from("tender_boq_lines").select("file_description").eq("tenant_id", tenantId).eq("opportunity_id", id).order("row_no").limit(RESEARCH_LIMITS.items);
  const items = ((boq.data ?? []) as { file_description: string | null }[]).map((r) => r.file_description ?? "").filter(Boolean);

  let run;
  try {
    run = await runCompetitorResearch(new Anthropic(), {
      title: opp.title, tender_no: tender.tender_no, issuer_name: tender.issuer_name, ...answers, country, items, exclude: all.map((c) => c.name),
    });
  } catch (e) {
    if (!(e instanceof AnalysisResearchError)) {
      console.error("Competitor research failed:", e);
      return NextResponse.json({ error: "The research could not run right now. Nothing was saved." }, { status: 502 });
    }
    // No key: 503. Too slow: 504. An unreadable answer, no search run, a refusal or the provider failing: 502.
    return NextResponse.json({ error: e.message }, { status: e.message === NO_KEY ? 503 : e.message === TIMEOUT_MESSAGE ? 504 : 502 });
  }

  // The meter row is written once the call has completed, whatever the check below keeps: the search was run and paid for.
  await logUsage({ tenantId, userId, surface: RESEARCH_SURFACE, studyId: id, inputTokens: run.tokens.input, outputTokens: run.tokens.output, model: run.model });

  const { proposals, dropped } = validateCompetitorResearch(run.raw, { citations: run.citations, exclude: all.map((c) => c.name), now, model: run.model });
  const room = Math.max(0, COMPETITOR_LIMITS.perDeal - all.filter((c) => c.status !== "rejected").length);
  const kept = proposals.slice(0, room);
  const added: string[] = [];
  for (const [i, p] of kept.entries()) {
    const { error } = await admin.from("opportunity_competitors").insert({
      tenant_id: tenantId, opportunity_id: id, name: p.name, website: p.website, country: p.country, status: "proposed", origin: "research",
      evidence: p.evidence, created_by: userId, sort: all.length + i,
    }).select(COMPETITOR_COLS_LEGACY).maybeSingle();
    if (error) {
      // The name is already on the tender (a parallel run): skipped. Anything else is reported, not hidden.
      if (error.code !== "23505") console.error("Proposed competitor insert failed:", error.message);
      continue;
    }
    added.push(p.name);
  }
  if (added.length > 0) {
    const user = await getAuthUser();
    await logChange(supabase, {
      tenantId, objectType: "opportunity_competitors", objectId: id, objectLabel: `${opp.ref ?? ""} ${opp.title}`.trim(), action: "create",
      actorId: user?.id ?? userId, actorEmail: user?.email, changes: added.map((name) => ({ field: "Proposed from market research", from: null, to: name })),
    });
  }
  return NextResponse.json({
    proposed: added.length, dropped: dropped.length + (proposals.length - kept.length),
    ...(added.length === 0 ? { notice: NO_PROPOSALS_NOTICE } : {}),
  });
}

/** The default entity's country, for the region question ("Saudi Arabia only"). Null when none is set. */
function defaultCountry(config: unknown): string | null {
  const entities = (config as { entities?: { is_default?: boolean; country?: string }[] } | null | undefined)?.entities;
  if (!Array.isArray(entities)) return null;
  const e = entities.find((x) => x?.is_default) ?? entities[0];
  return typeof e?.country === "string" && e.country.trim() ? e.country.trim().slice(0, 60) : null;
}
