import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { resolvePermissions, canViewWorkcenter } from "@/lib/permissions";
import { tenantHasFeature } from "@/lib/tenant";
import { LIST_SOURCES } from "@/lib/api/listSources";
import { compileAndRun, type ReportResult, type CompileOutcome } from "@/lib/ai/reportCompile";
import { normalizeReport } from "@/lib/reportView";

// POST /api/reports/ask -- "talk to data" (docs/ai-report-builder-architecture.md).
// Session-authenticated, in-app. Two model calls, not one:
//   Stage 1 (route): pick ONE object out of the caller's PERMISSION-FILTERED
//     catalog -- an object the caller can't view never reaches the prompt,
//     so the model literally cannot route there. Small, reliable field
//     enums stay small because routing happens BEFORE compiling.
//   Stage 2 (compile): the same query-compilation discipline /api/v1/ask
//     already uses, extended with chart_type/x/y/title/interpretation.
// Neither stage ever produces a data value -- every number in the response
// comes from parseListQuery()+applyListQuery() running over rows loaded
// live, tenant-scoped, from the database. The model can misroute or
// misinterpret intent (why `interpretation` is mandatory and always shown),
// but it cannot invent a field or a number.

// Insights mode adds one more SEQUENTIAL call (the summary) after the
// parallel facet compiles, so it needs more headroom than a single-question
// ask -- bumped from 60 after the summary call was added.
export const maxDuration = 75;

type RouteInput = {
  status?: "ready" | "insights" | "needs_clarification" | "decline";
  objects?: string[];
  facets?: { object?: string; question?: string }[];
  clarifying_question?: string;
  reason?: string;
};

function routeTool(catalog: { key: string; description: string; fields: string[] }[]): Anthropic.Tool {
  return {
    name: "route_question",
    description: "Decide which object this question is about, ask for clarification, or decline.",
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string", enum: ["ready", "insights", "needs_clarification", "decline"],
          description:
            "ready: one specific, answerable-as-one-chart question. " +
            "insights: a BROAD, open-ended ask about an object as a whole (\"insights about X\", \"how's X doing\", \"overview of X\", \"tell me about X\") -- one chart can't answer it, so instead propose several specific facets (see `facets`). " +
            "needs_clarification / decline as before.",
        },
        objects: {
          type: "array", items: { type: "string", enum: catalog.map((c) => c.key) },
          description: "Exactly one object -- the single one whose OWN fields (including any already-denormalized related name) answer the question. Never a signal to attempt a join across two objects.",
        },
        facets: {
          type: "array",
          items: {
            type: "object",
            properties: {
              object: { type: "string", enum: catalog.map((c) => c.key), description: "The single object THIS facet queries." },
              question: { type: "string", description: "A complete, standalone question answerable as ONE chart from that object alone -- it never sees the original question's wording." },
            },
            required: ["object", "question"],
          },
          description:
            "Required when status=insights: 3-6 SPECIFIC sub-questions, each answerable as ONE chart from ONE object (each is compiled and run independently). For a broad question about one object, keep every facet on that object. For a whole-business question (\"overview of my business\", \"how are we doing\"), facets may span DIFFERENT objects -- e.g. one on quotations, one on cases, one on invoices. Cover different angles, don't overlap: typically a breakdown by category/status, a trend over time, a top-N ranking by value, a headline total or count.",
        },
        clarifying_question: { type: "string", description: "Required when status=needs_clarification. Offer the real candidate interpretations as part of the question, e.g. \"By revenue do you mean quote value or invoiced amount?\"" },
        reason: { type: "string", description: "Required when status=decline. Specific: name what's missing (a join, an object not in the catalog, etc), not a generic refusal." },
      },
      required: ["status"],
    },
  };
}

// One line of ALREADY-COMPUTED fact per report -- the same numbers the
// chart itself renders, reduced to text. This is what the summary call
// below is allowed to talk about; it never sees a raw row.
function digestReport(r: ReportResult): string {
  const n = normalizeReport(r);
  if (n.chartType === "stat") return `${n.title}: ${n.statValue?.toLocaleString("en-IN")}`;
  if ((n.chartType === "bar" || n.chartType === "line") && n.series?.length) {
    const top = n.series.slice(0, 6).map((s) => `${s.key}=${s.value.toLocaleString("en-IN")}`).join(", ");
    return `${n.title}: ${top}${n.series.length > 6 ? ` (+${n.series.length - 6} more)` : ""}`;
  }
  return `${n.title}: ${n.tableRows?.length ?? 0} record(s)${n.tableTotal && n.tableTotal > (n.tableRows?.length ?? 0) ? ` of ${n.tableTotal} total` : ""}`;
}

// A short executive summary synthesized ONLY from the facts above -- not a
// third data call. It cannot invent a number because it isn't given any
// data to invent from, only text already derived from a real query result
// (same "engine computes, model narrates" split as everywhere else in this
// feature). Best-effort: a failure here drops the summary, never the charts.
async function writeInsightsSummary(anthropic: Anthropic, question: string, reports: ReportResult[]): Promise<string | null> {
  try {
    const digest = reports.map(digestReport).join("\n");
    const response = await anthropic.messages.create({
      model: "claude-opus-5",
      max_tokens: 300,
      system:
        "You write a short executive summary for a business owner looking at their own live CRM data. " +
        "You are given a list of ALREADY-COMPUTED facts -- exact numbers, already correct. Reference ONLY the numbers given below; " +
        "never invent, estimate, round differently, or infer a number not present. " +
        "Write 3-5 sentences of plain, direct business prose -- no bullet points, no restating every fact mechanically, no hedging or filler. " +
        "Call out what's actually notable: concentration in one item, a trend, something that looks like a risk or an opportunity -- the thing a busy owner would want to know without scanning every chart themselves.",
      messages: [{ role: "user", content: `Original question: "${question}"\n\nComputed facts:\n${digest}` }],
    });
    const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text?.trim();
    return text || null;
  } catch (e) {
    console.error("reports/ask insights summary failed:", e);
    return null;
  }
}

export async function POST(req: Request) {
  let supabase, tenantId, userId, role;
  try {
    ({ supabase, tenantId, userId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const perms = await resolvePermissions(supabase, tenantId, userId, role);
  if (!canViewWorkcenter(perms, "reports")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!(await tenantHasFeature(supabase, tenantId, "ai_reports"))) {
    return NextResponse.json({ error: "AI Report Builder isn't enabled for this workspace." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question) return NextResponse.json({ error: "Ask me something first." }, { status: 400 });
  if (question.length > 500) return NextResponse.json({ error: "That question is too long." }, { status: 400 });

  // Follow-up context: the previous report this question may be refining
  // ("now only this year", "as a quarterly trend", "top 5 instead"). TEXT
  // shown to the model only -- a client-supplied compiled_query is never
  // executed here; the refinement always recompiles from scratch through
  // the same validation as a fresh question.
  const rawCtx = body?.context as { question?: unknown; object?: unknown; compiled_query?: unknown } | undefined;
  const prevContext = rawCtx && typeof rawCtx.question === "string" && typeof rawCtx.object === "string"
    ? {
        question: rawCtx.question.slice(0, 500),
        object: rawCtx.object.slice(0, 60),
        compiled_query: typeof rawCtx.compiled_query === "string" ? rawCtx.compiled_query.slice(0, 1000) : "",
      }
    : null;

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "Talk to data needs ANTHROPIC_API_KEY set on the server." }, { status: 503 });
  }

  // Catalog: every LIST_SOURCES object the caller's Business Roles grant VIEW
  // on -- filtered BEFORE the model ever sees an object name or description.
  // Field NAMES (not full types/hints -- that's stage 2's job) travel with
  // each entry so routing can tell when an object already carries what it
  // needs via a denormalized reference (e.g. quotations.account.name) and
  // answer directly, instead of asking to disambiguate purely because two
  // object names appear in the phrasing -- a real bug found live: "accounts
  // with quote value over 50k" was asking to choose between accounts and
  // quotations, when quotations alone (account.name + total) fully answers
  // it and accounts has no quote-value field at all.
  const catalog = Object.entries(LIST_SOURCES)
    .filter(([, src]) => canViewWorkcenter(perms, src.relatedWorkcenter))
    .map(([key, src]) => ({ key, label: src.label, description: src.description, fields: src.fields.map((f) => f.path) }));

  if (catalog.length === 0) {
    return NextResponse.json({ status: "declined", reason: "You don't have view access to any reportable object." });
  }

  const anthropic = new Anthropic();

  // ── Stage 1: route ──────────────────────────────────────────────────────
  let routeResponse;
  try {
    routeResponse = await anthropic.messages.create({
      model: "claude-opus-5",
      max_tokens: 500,
      tools: [routeTool(catalog)],
      tool_choice: { type: "tool", name: "route_question" },
      system:
        "You route a business question to the ONE object (table) that can answer it. Available objects, with their field names:\n" +
        catalog.map((c) => `- ${c.key}: ${c.description}\n  fields: ${c.fields.join(", ")}`).join("\n") +
        "\n\nA dotted field like account.name or account.id is a DENORMALIZED reference -- it means that object already carries the parent's identity, specifically so a question phrased around the parent (\"accounts with...\", \"which customers...\") can be answered from THIS object alone, without a join. " +
        "Prefer routing directly over asking: if exactly one object's fields can fully answer the question, route to it and do NOT ask for clarification just because another object's NAME also appears in the phrasing -- check whether that other object's fields could even express the alternative reading before treating it as a real candidate. " +
        "Only ask when two DIFFERENT objects could each fully answer the question and would give a meaningfully different number or breakdown -- and when you do, name the real candidate objects/fields, never a vague \"please clarify\". " +
        "If the question genuinely needs data from two objects joined together in a way no single object's fields (including denormalized ones) can express, or names something not in this list, decline with a specific reason naming what's missing. " +
        "If the question is a SPECIFIC, single measure or breakdown (a count, a total, one category-by-category chart, one ranking, one trend), set status=ready with exactly one object. " +
        "If instead the question is BROAD and open-ended -- \"insights about X\", \"how's X doing\", \"overview of X\", \"tell me about X\", \"how is my business doing\", a bare object name with no specific measure -- do NOT try to squeeze it into one chart. Set status=insights and propose 3-6 SPECIFIC, non-overlapping facets, each tagged with the ONE object it queries: for a broad question about one object, keep every facet on that object; for a whole-business question, spread the facets across the most relevant objects (sales via quotations, service via cases, cash via invoices, ...)." +
        (prevContext
          ? `\n\nPREVIOUS REPORT -- the user may be refining it rather than asking fresh: they asked "${prevContext.question}", answered from object "${prevContext.object}". If the new message reads as a refinement of that report ("only this year", "top 5 instead", "as a quarterly trend", "same but for cases"), route it as a complete question against the appropriate object (usually the same one) with status=ready. If it clearly stands alone, ignore this context entirely.`
          : ""),
      messages: [{ role: "user", content: question }],
    });
  } catch (e) {
    console.error("reports/ask route stage failed:", e);
    return NextResponse.json({ error: "Could not process that question right now. Try again shortly." }, { status: 502 });
  }

  const routeBlock = routeResponse.content.find((b) => b.type === "tool_use");
  if (!routeBlock || routeBlock.type !== "tool_use") {
    return NextResponse.json({ status: "declined", reason: "Could not interpret the question. Try rephrasing." });
  }
  const routed = routeBlock.input as RouteInput;

  if (routed.status === "needs_clarification") {
    return NextResponse.json({ status: "needs_clarification", clarifying_question: routed.clarifying_question || "Could you say more about what you mean?" });
  }

  const today = new Date().toISOString().slice(0, 10);

  // ── "insights" -- one chart can't answer a broad question, so run each
  // routed facet as its own compile against ITS OWN object's rows (loaded
  // once per distinct object) and return a stream of chart cards. Facets
  // may span objects for whole-business questions. ──
  if (routed.status === "insights") {
    const facets = (routed.facets ?? [])
      .filter((f): f is { object: string; question: string } =>
        typeof f?.object === "string" && typeof f?.question === "string" && !!f.question.trim() &&
        !!LIST_SOURCES[f.object] && canViewWorkcenter(perms, LIST_SOURCES[f.object].relatedWorkcenter))
      .slice(0, 6);
    if (facets.length === 0) {
      return NextResponse.json({ status: "declined", reason: "Couldn't work out specific enough angles for that. Try a more specific question." });
    }
    const distinctObjects = [...new Set(facets.map((f) => f.object))];
    const rowsByObject = new Map(
      await Promise.all(distinctObjects.map(async (o) => [o, await LIST_SOURCES[o].load(tenantId)] as const))
    );
    const outcomes = await Promise.all(
      facets.map((f) => compileAndRun(anthropic, f.question, f.object, LIST_SOURCES[f.object], rowsByObject.get(f.object)!, today))
    );
    const reports = outcomes.filter((o): o is Extract<CompileOutcome, { ok: true }> => o.ok).map((o) => o.report);
    if (reports.length === 0) {
      return NextResponse.json({ status: "declined", reason: "Couldn't compile any of the angles for that question. Try something more specific." });
    }
    const summary = await writeInsightsSummary(anthropic, question, reports);
    const primary = facets[0].object;
    return NextResponse.json({ status: "insights", question, object: primary, object_label: LIST_SOURCES[primary].label, summary, reports });
  }

  if (routed.status !== "ready" || !routed.objects?.length) {
    return NextResponse.json({ status: "declined", reason: routed.reason || "That can't be answered from the data available to you." });
  }

  const objectKey = routed.objects[0];
  const src = LIST_SOURCES[objectKey];
  if (!src || !canViewWorkcenter(perms, src.relatedWorkcenter)) {
    // Defensive -- the catalog was already filtered, this should never fire.
    return NextResponse.json({ status: "declined", reason: "That object isn't available to you." });
  }

  // ── One specific question -- one chart. When this refines a previous
  // report on the same object, the compile stage sees that report as text
  // context (and still recompiles + revalidates from scratch). ──
  const rows = await src.load(tenantId);
  const contextPrefix = prevContext && prevContext.object === objectKey
    ? `For context, the user's previous report: question "${prevContext.question}", compiled as: ${prevContext.compiled_query || "(n/a)"}. The new request below may refine it -- carry over its constraints unless the new request changes them.`
    : undefined;
  const outcome = await compileAndRun(anthropic, question, objectKey, src, rows, today, contextPrefix);
  if (!outcome.ok) {
    return NextResponse.json({ status: "declined", reason: outcome.reason, queryable_fields: src.fields.map((f) => f.path) });
  }
  return NextResponse.json(outcome.report);
}
