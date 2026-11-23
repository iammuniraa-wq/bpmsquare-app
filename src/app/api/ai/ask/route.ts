import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { getTenantCurrency } from "@/lib/tenant";
import { askAssistant, capabilityList, AssistantError } from "@/lib/ai/assistant";
import { monthlyTokensUsed } from "@/lib/ai/structured";
import { AssistantMeter } from "@/lib/assistant/meter";
import { usagePercent } from "@/lib/assistant/models";
import { describePage } from "@/lib/assistant/pageService";
import { parseAllowWeb } from "@/lib/assistant/webConsent";
import { parseHistory, resolveAskAccess } from "@/lib/assistant/askAccess";
import { normalizeQuery } from "@/lib/assistant/webQuery";
import { resolveWebConsent } from "@/lib/assistant/consentToken";
import { resolveScreen } from "@/lib/assistant/screens";
import { offeredTasks } from "@/lib/assistant/guide";
import { screenAccessFor } from "@/lib/assistant/screenAccess";
import { ANALYSIS_CONSENT_PREFIX, decodeAnalysisQuery, parseToolInput } from "@/lib/assistant/analysisTool";
import type { AnalysisSetup } from "@/lib/assistant/analysisRun";
import { REPORT_CONSENT_PREFIX, decodeReportQuery, parseReportInput } from "@/lib/assistant/reportTool";
import type { ReportSetup } from "@/lib/assistant/reportRun";
import { analysisAccess } from "@/lib/analysis/service";
import { CREATE_CONSENT_PREFIX, decodeCreateConsent, parseCreateFlow } from "@/lib/assistant/createResearch";

// The chart tool makes a nested model call inside a turn (compileAndRun),
// so a turn that uses it costs two sequential calls, not one -- same
// reasoning as reports/ask's bump to 75.
export const maxDuration = 120;

// GET /api/ai/ask?route=/quotations/<id> -- what the dock shows when it opens: example questions, the usage pill, the
// one-line context fact for the record on screen and the suggestions strip. Scoped to this caller's Business Roles.
// The route is the only thing taken from the client; the record behind it is loaded here through the caller's own
// permissions and this workspace's own rows.
export async function GET(request: NextRequest) {
  const access = await resolveAskAccess();
  if (access instanceof NextResponse) return access;
  const { tenantId, userId, perms, features, budget, isAdmin, config } = access;

  const route = request.nextUrl.searchParams.get("route");
  const [used, page, screen] = await Promise.all([
    monthlyTokensUsed(tenantId).catch(() => 0),
    describePage(createAdminSupabase(), { tenantId, perms, features }, userId, route).catch(() => ({ context: null, suggestions: [] })),
    resolveScreen(route, screenAccessFor(perms, features, isAdmin)).catch(() => null),
  ]);
  return NextResponse.json({
    capabilities: capabilityList(perms),
    usage: { percent: usagePercent(used, budget), off: budget <= 0 },
    context: page.context ? { label: page.context.label, objectType: page.context.objectType } : null,
    suggestions: page.suggestions,
    // Whether the dock may offer "Analyse company" (the card's own button). The same gate the tool and POST use.
    analysis: analysisAccess({ features, config, perms }).ok,
    // The screen's own jobs, as "show me how" chips. Answered from the manifest, so they cost no AI allowance.
    guides: offeredTasks(screen),
  });
}

// POST /api/ai/ask -- answer one question about this tenant's data, or take the person where they asked to go.
// The tenant is taken from the session (requireTenantUser), never from the
// request body, and the model can only pick from a fixed catalog of
// pre-approved read queries and a generated list of places -- see src/lib/ai/assistant.ts.
export async function POST(request: NextRequest) {
  const access = await resolveAskAccess();
  if (access instanceof NextResponse) return access;
  const { supabase, tenantId, userId, perms, features, budget, isAdmin, webEnabled, webOff, config } = access;

  const body = await request.json().catch(() => null);
  const guideTask = typeof body?.guideTask === "string" && /^[a-z0-9_]{1,40}$/.test(body.guideTask) ? body.guideTask : null;
  const question = typeof body?.question === "string" ? body.question.trim() : guideTask ? "Show me how" : "";
  if (!question) return NextResponse.json({ error: "Ask me something first." }, { status: 400 });
  if (question.length > 1000) return NextResponse.json({ error: "That question is too long." }, { status: 400 });

  const history = parseHistory(body, question);

  // The page: only the route is used. An object type or record id sent beside it is ignored, because the server
  // derives both from the route itself (assistant/objects.ts) and checks the id against this workspace's rows.
  const route = typeof body?.route === "string" ? body.route.slice(0, 300) : null;

  // Web research: a permission sent while the workspace does not have it is a 404, not a quiet no-op, so a stale or
  // forged client learns that the route for it does not exist here. The tool is never offered when this is off.
  const allowWeb = parseAllowWeb(body?.allow_web);
  if (allowWeb && !webEnabled) return NextResponse.json({ error: "Web research is not enabled for this workspace." }, { status: 404 });
  // What the client claims is checked against a token this server signed when it showed the chip (audit 2026-10-22 L5).
  const claimedQuery = typeof body?.consent_query === "string" ? normalizeQuery(body.consent_query).slice(0, 300) : null;
  const consent = resolveWebConsent({ tenantId, userId, allow: allowWeb, query: claimedQuery, token: body?.consent_token });

  // Company analysis. A Yes on an analysis chip carries that chip's signed subject: it is run with no model, and a
  // token that does not verify leaves `consentId` empty, so the person is simply asked again. Analyse and Refresh send
  // the subject with no consent and are answered with the chip. Either way the analysis path never reads the web
  // permission below, and the web-search path never sees an analysis subject.
  const yesToAnalysis = allowWeb !== null && !!claimedQuery?.startsWith(ANALYSIS_CONSENT_PREFIX);
  const analyseBody = body?.analyse && typeof body.analyse === "object" ? body.analyse : null;
  if ((yesToAnalysis || analyseBody) && !webEnabled) return NextResponse.json({ error: "Web research is not enabled for this workspace." }, { status: 404 });
  const directInput = yesToAnalysis ? decodeAnalysisQuery(claimedQuery) : analyseBody ? parseToolInput(analyseBody) : null;
  if ((yesToAnalysis || analyseBody) && !directInput) return NextResponse.json({ error: "That analysis request is not valid." }, { status: 400 });
  const analysis: AnalysisSetup | undefined = webEnabled
    ? {
        admin: createAdminSupabase(), config, budget,
        ...(directInput ? { direct: { input: directInput, consentId: yesToAnalysis ? consent.consentId : null } } : {}),
      }
    : undefined;
  // Company report: the same shape. A Yes on a report chip carries that chip's signed subject, and Refresh sends the subject with no consent.
  // The report path never reads the web-search permission below, and the web-search path never sees a report subject.
  const yesToReport = allowWeb !== null && !!claimedQuery?.startsWith(REPORT_CONSENT_PREFIX);
  const reportBody = body?.report && typeof body.report === "object" ? body.report : null;
  if ((yesToReport || reportBody) && !webEnabled) return NextResponse.json({ error: "Web research is not enabled for this workspace." }, { status: 404 });
  const reportInput = yesToReport ? decodeReportQuery(claimedQuery) : reportBody ? parseReportInput(reportBody) : null;
  if ((yesToReport || reportBody) && !reportInput) return NextResponse.json({ error: "That report request is not valid." }, { status: 400 });
  const companyReport: ReportSetup | undefined = webEnabled
    ? {
        admin: createAdminSupabase(), config, budget,
        ...(reportInput ? { direct: { input: reportInput, consentId: yesToReport ? consent.consentId : null } } : {}),
      }
    : undefined;
  // Create with web research: the two chips under the "how do you want to fill in the details?" question send `create_flow`;
  // a Yes on the lookup chip carries that chip's signed company. No model runs for either, and a token that does not verify
  // leaves `consentId` empty, so the person is asked again. Like the analysis, it never reads the web-search permission.
  const yesToCreate = allowWeb !== null && !!claimedQuery?.startsWith(CREATE_CONSENT_PREFIX);
  const createBody = body?.create_flow !== undefined && body?.create_flow !== null;
  const createInput = yesToCreate ? decodeCreateConsent(claimedQuery) : createBody ? parseCreateFlow(body.create_flow) : null;
  if ((yesToCreate || createBody) && !createInput) return NextResponse.json({ error: "That request is not valid." }, { status: 400 });
  if (createInput?.mode === "web" && !webEnabled) return NextResponse.json({ error: "Web research is not enabled for this workspace." }, { status: 404 });
  const createFlow = createInput ? { input: createInput, consentId: yesToCreate ? consent.consentId : null } : undefined;
  const webAllow = yesToAnalysis || yesToCreate || yesToReport ? { allow: null, consentQuery: null, consentId: null } : consent;

  const currency = await getTenantCurrency();
  const meter = new AssistantMeter({ tenantId, userId, budget });

  try {
    const reply = await askAssistant(history, {
      supabase, tenantId, userId, perms, currency, features, isAdmin: perms.unrestricted, isWorkspaceAdmin: isAdmin, route, meter, guideTask,
      web: webEnabled ? { enabled: true, userId, allow: webAllow.allow, consentQuery: webAllow.consentQuery, consentId: webAllow.consentId } : undefined,
      analysis, companyReport, webOff, createFlow,
    });
    return NextResponse.json({
      ...reply,
      // Absent when the ask was answered without reading the meter (opening a screen); the dock keeps its last figure.
      usage: meter.percent === null ? undefined : { percent: meter.percent, off: budget <= 0 },
    });
  } catch (e) {
    if (e instanceof AssistantError) return NextResponse.json({ error: e.message }, { status: 503 });
    console.error("Assistant failed:", e);
    return NextResponse.json({ error: "The assistant is unavailable right now." }, { status: 500 });
  }
}
