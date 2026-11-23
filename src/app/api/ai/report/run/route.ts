import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { getTenantCurrency } from "@/lib/tenant";
import { askAssistant, AssistantError } from "@/lib/ai/assistant";
import { AssistantMeter } from "@/lib/assistant/meter";
import { parseAllowWeb } from "@/lib/assistant/webConsent";
import { parseHistory, resolveAskAccess } from "@/lib/assistant/askAccess";
import { normalizeQuery } from "@/lib/assistant/webQuery";
import { resolveWebConsent } from "@/lib/assistant/consentToken";
import { REPORT_CONSENT_PREFIX, decodeReportQuery } from "@/lib/assistant/reportTool";
import type { ReportSetup } from "@/lib/assistant/reportRun";
import { RUN_BUDGET_MS } from "@/lib/analysis/report/research";

// POST /api/ai/report/run -- the Yes on a company brief chip (docs/design/company-brief-sales.md section 6). The same brief the
// ask route can run, but answered as a stream of lines so the dock can show four progress rows while the four research parts run:
//   {"type":"part","part":"financials","state":"running"|"done"|"missing"}   one per change
//   {"type":"done","answer":"...","companyReport":{...}}                    the card (or "consent" when a fresh yes is needed)
//   {"type":"error","message":"..."}                                          nothing was made
// The session, the permissions, the signed one-use consent and every gate are the ask route's own (resolveAskAccess and the same
// loop); this route only changes how the answer is delivered. A part is stopped by its own deadline; this route stops waiting at
// RUN_BUDGET_MS (105 s) and answers, so the browser never sees a platform timeout (the route's limit is 120 s).

export const maxDuration = 120;

export const RUN_STOPPED = "The brief took longer than expected. Whatever finished is saved: open the company again in a minute, or try the missing parts.";

export async function POST(request: NextRequest) {
  const access = await resolveAskAccess();
  if (access instanceof NextResponse) return access;
  const { supabase, tenantId, userId, perms, features, budget, isAdmin, webEnabled, config } = access;

  const body = await request.json().catch(() => null);
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question) return NextResponse.json({ error: "Ask me something first." }, { status: 400 });
  if (question.length > 1000) return NextResponse.json({ error: "That question is too long." }, { status: 400 });
  const history = parseHistory(body, question);
  const route = typeof body?.route === "string" ? body.route.slice(0, 300) : null;

  // Web research off for this workspace is a 404, not a quiet no-op, exactly as on the ask route.
  if (!webEnabled) return NextResponse.json({ error: "Web research is not enabled for this workspace." }, { status: 404 });

  // Only a Yes on a brief chip comes here: its query is the signed subject, and the token must verify for this person, this
  // workspace and exactly this subject. A token that does not verify leaves `consentId` empty and the person is asked again.
  const allowWeb = parseAllowWeb(body?.allow_web);
  const claimedQuery = typeof body?.consent_query === "string" ? normalizeQuery(body.consent_query).slice(0, 300) : null;
  if (allowWeb === null || !claimedQuery?.startsWith(REPORT_CONSENT_PREFIX)) return NextResponse.json({ error: "That brief request is not valid." }, { status: 400 });
  const input = decodeReportQuery(claimedQuery);
  if (!input) return NextResponse.json({ error: "That brief request is not valid." }, { status: 400 });
  const consent = resolveWebConsent({ tenantId, userId, allow: allowWeb, query: claimedQuery, token: body?.consent_token });

  const currency = await getTenantCurrency();
  const meter = new AssistantMeter({ tenantId, userId, budget });
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (line: unknown) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`)); } catch { closed = true; }
      };
      const companyReport: ReportSetup = {
        admin: createAdminSupabase(), config, budget,
        direct: { input, consentId: consent.consentId },
        onPart: (part, state) => send({ type: "part", part, state }),
      };
      let stop: ReturnType<typeof setTimeout> | undefined;
      try {
        const work = askAssistant(history, {
          supabase, tenantId, userId, perms, currency, features, isAdmin: perms.unrestricted, isWorkspaceAdmin: isAdmin, route, meter, guideTask: null,
          web: { enabled: true, userId, allow: null, consentQuery: null, consentId: null },
          companyReport, webOff: undefined,
        });
        const stopped = new Promise<"stopped">((resolve) => { stop = setTimeout(() => resolve("stopped"), RUN_BUDGET_MS); });
        const reply = await Promise.race([work, stopped]);
        if (reply === "stopped") {
          send({ type: "error", message: RUN_STOPPED });
        } else {
          send({ type: "done", answer: reply.answer, ...(reply.consent ? { consent: reply.consent } : {}), ...(reply.companyReport ? { companyReport: reply.companyReport } : {}) });
        }
      } catch (e) {
        if (!(e instanceof AssistantError)) console.error("Company brief run failed:", e);
        send({ type: "error", message: e instanceof AssistantError ? e.message : "The brief is unavailable right now." });
      } finally {
        if (stop) clearTimeout(stop);
        closed = true;
        try { controller.close(); } catch { /* the browser went away */ }
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
