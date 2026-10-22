import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { resolvePermissions } from "@/lib/permissions";
import { getTenantCurrency } from "@/lib/tenant";
import { askAssistant, capabilityList, AssistantError, type ChatTurn } from "@/lib/ai/assistant";
import { monthlyTokensUsed } from "@/lib/ai/structured";
import { resolveMonthlyBudget } from "@/lib/ai/usageCap";
import { AssistantMeter } from "@/lib/assistant/meter";
import { usagePercent } from "@/lib/assistant/models";
import { describePage } from "@/lib/assistant/pageService";
import type { TenantConfig } from "@/lib/constants";
import { parseAllowWeb, webAvailability } from "@/lib/assistant/webConsent";
import { normalizeQuery } from "@/lib/assistant/webQuery";
import { resolveScreen } from "@/lib/assistant/screens";
import { offeredTasks } from "@/lib/assistant/guide";
import { screenAccessFor } from "@/lib/assistant/screenAccess";

// The chart tool makes a nested model call inside a turn (compileAndRun),
// so a turn that uses it costs two sequential calls, not one -- same
// reasoning as reports/ask's bump to 75.
export const maxDuration = 75;

type Access = {
  supabase: Awaited<ReturnType<typeof requireTenantUser>>["supabase"];
  tenantId: string;
  userId: string;
  perms: Awaited<ReturnType<typeof resolvePermissions>>;
  features: Record<string, boolean | undefined>;
  budget: number;
  /** Platform flag, the assistant it hangs off and the workspace's own external-calls policy, folded into one answer. */
  webEnabled: boolean;
};

// Tenant, person, permissions, the workspace's modules and its allowance, all from the session. The assistant is
// the ai_assistant module: a workspace without it gets 403 here, not only a hidden dock.
async function resolveAccess(): Promise<Access | NextResponse> {
  let supabase, tenantId, userId, role;
  try {
    ({ supabase, tenantId, userId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const [perms, { data: tenant }] = await Promise.all([
    resolvePermissions(supabase, tenantId, userId, role),
    supabase.from("tenants").select("features, config").eq("id", tenantId).maybeSingle(),
  ]);
  const features = (tenant?.features ?? {}) as Record<string, boolean | undefined>;
  if (features.ai_assistant !== true) return NextResponse.json({ error: "The assistant is not enabled for this workspace." }, { status: 403 });
  const config = (tenant?.config ?? {}) as Partial<TenantConfig>;
  return {
    supabase, tenantId, userId, perms, features, budget: resolveMonthlyBudget(config.ai_assistant?.monthly_token_budget),
    webEnabled: webAvailability(features, config).enabled,
  };
}

// GET /api/ai/ask?route=/quotations/<id> -- what the dock shows when it opens: example questions, the usage pill, the
// one-line context fact for the record on screen and the suggestions strip. Scoped to this caller's Business Roles.
// The route is the only thing taken from the client; the record behind it is loaded here through the caller's own
// permissions and this workspace's own rows.
export async function GET(request: NextRequest) {
  const access = await resolveAccess();
  if (access instanceof NextResponse) return access;
  const { tenantId, userId, perms, features, budget } = access;

  const route = request.nextUrl.searchParams.get("route");
  const [used, page, screen] = await Promise.all([
    monthlyTokensUsed(tenantId).catch(() => 0),
    describePage(createAdminSupabase(), { tenantId, perms, features }, userId, route).catch(() => ({ context: null, suggestions: [] })),
    resolveScreen(route, screenAccessFor(perms, features, perms.unrestricted)).catch(() => null),
  ]);
  return NextResponse.json({
    capabilities: capabilityList(perms),
    usage: { percent: usagePercent(used, budget), off: budget <= 0 },
    context: page.context ? { label: page.context.label, objectType: page.context.objectType } : null,
    suggestions: page.suggestions,
    // The screen's own jobs, as "show me how" chips. Answered from the manifest, so they cost no AI allowance.
    guides: offeredTasks(screen),
  });
}

// POST /api/ai/ask -- answer one question about this tenant's data, or take the person where they asked to go.
// The tenant is taken from the session (requireTenantUser), never from the
// request body, and the model can only pick from a fixed catalog of
// pre-approved read queries and a generated list of places -- see src/lib/ai/assistant.ts.
export async function POST(request: NextRequest) {
  const access = await resolveAccess();
  if (access instanceof NextResponse) return access;
  const { supabase, tenantId, userId, perms, features, budget, webEnabled } = access;

  const body = await request.json().catch(() => null);
  const guideTask = typeof body?.guideTask === "string" && /^[a-z0-9_]{1,40}$/.test(body.guideTask) ? body.guideTask : null;
  const question = typeof body?.question === "string" ? body.question.trim() : guideTask ? "Show me how" : "";
  if (!question) return NextResponse.json({ error: "Ask me something first." }, { status: 400 });
  if (question.length > 1000) return NextResponse.json({ error: "That question is too long." }, { status: 400 });

  // Conversation context so follow-ups ("and how many of those are overdue?")
  // work. Client-supplied TEXT only -- it shapes the model's answer, never a
  // query directly; every data access still goes through the permission-
  // filtered tools with this session's own tenant id.
  const rawHistory = Array.isArray(body?.history) ? body.history : [];
  const history: ChatTurn[] = rawHistory
    .filter((t: { role?: string; text?: string }) => (t?.role === "user" || t?.role === "assistant") && typeof t?.text === "string" && t.text.trim())
    .slice(-12)
    .map((t: { role: "user" | "assistant"; text: string }) => ({ role: t.role, text: t.text.slice(0, 4000) }));
  if (history.length === 0 || history[history.length - 1].text !== question || history[history.length - 1].role !== "user") {
    history.push({ role: "user", text: question });
  }
  // Anthropic requires the first message to be from the user.
  while (history.length && history[0].role !== "user") history.shift();

  // The page: only the route is used. An object type or record id sent beside it is ignored, because the server
  // derives both from the route itself (assistant/objects.ts) and checks the id against this workspace's rows.
  const route = typeof body?.route === "string" ? body.route.slice(0, 300) : null;

  // Web research: a permission sent while the workspace does not have it is a 404, not a quiet no-op, so a stale or
  // forged client learns that the route for it does not exist here. The tool is never offered when this is off.
  const allowWeb = parseAllowWeb(body?.allow_web);
  if (allowWeb && !webEnabled) return NextResponse.json({ error: "Web research is not enabled for this workspace." }, { status: 404 });
  const consentQuery = allowWeb === "once" && typeof body?.consent_query === "string" ? normalizeQuery(body.consent_query).slice(0, 300) : null;

  const currency = await getTenantCurrency();
  const meter = new AssistantMeter({ tenantId, userId, budget });

  try {
    const reply = await askAssistant(history, {
      supabase, tenantId, perms, currency, features, isAdmin: perms.unrestricted, route, meter, guideTask,
      web: webEnabled ? { enabled: true, userId, allow: allowWeb, consentQuery } : undefined,
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
