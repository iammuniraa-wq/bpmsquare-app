import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { resolvePermissions, canViewWorkcenter } from "@/lib/permissions";
import { tenantHasFeature } from "@/lib/tenant";
import { LIST_SOURCES } from "@/lib/api/listSources";
import { parseListQuery, applyListQuery, type QueryableType } from "@/lib/api/query";
import { baseQueryProperties, compiledQueryToSearchParams, type CompiledQueryInput } from "@/lib/ai/nlCompile";

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

export const maxDuration = 60;

type ChartType = "stat" | "bar" | "line" | "table";

type RouteInput = {
  status?: "ready" | "needs_clarification" | "decline";
  objects?: string[];
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
        status: { type: "string", enum: ["ready", "needs_clarification", "decline"] },
        objects: {
          type: "array", items: { type: "string", enum: catalog.map((c) => c.key) },
          description: "Exactly one object -- the single one whose OWN fields (including any already-denormalized related name) answer the question. Never a signal to attempt a join across two objects.",
        },
        clarifying_question: { type: "string", description: "Required when status=needs_clarification. Offer the real candidate interpretations as part of the question, e.g. \"By revenue do you mean quote value or invoiced amount?\"" },
        reason: { type: "string", description: "Required when status=decline. Specific: name what's missing (a join, an object not in the catalog, etc), not a generic refusal." },
      },
      required: ["status"],
    },
  };
}

type CompileInput = CompiledQueryInput & {
  answerable?: boolean;
  reason?: string;
  chart_type?: ChartType;
  x?: string | null;
  y?: string | null;
  title?: string;
  interpretation?: string;
};

function compileTool(fields: { path: string; type: string; searchable?: boolean }[]): Anthropic.Tool {
  return {
    name: "build_report",
    description: "Compile the question into a structured query and choose how to visualize it.",
    input_schema: {
      type: "object",
      properties: {
        answerable: { type: "boolean", description: "false if this object's fields can't answer the question." },
        reason: { type: "string", description: "Required when answerable=false. Specific." },
        ...baseQueryProperties(fields),
        chart_type: { type: "string", enum: ["stat", "bar", "line", "table"], description: "stat for a single number ('how many', a total); bar for a breakdown by category (use with group_by); line for a trend (use with group_by on a DATE field); table otherwise." },
        x: { type: "string", description: "The field driving the x-axis/category -- normally the same as group_by." },
        y: { type: "string", description: "The field or aggregate driving the y-axis/value." },
        title: { type: "string", description: "Short chart title, e.g. \"Open quotes by status\"." },
        interpretation: {
          type: "string",
          description: "REQUIRED whenever answerable is true. One sentence naming EXACTLY which field(s) and filter(s) answer the question, e.g. \"Won quotes' total value, by month, over the last 12 months.\" Shown to the user alongside the chart -- never omit it, never make it vague.",
        },
      },
      required: ["answerable"],
    },
  };
}

/** The engine, not the model, decides the final chart type -- the "engine is
 * truth, model is advisory" discipline the pricing engine's AI layer already
 * uses. See docs/ai-report-builder-architecture.md §2.1. */
function decideChartType(compiled: CompileInput, groupByType: QueryableType | null, countOnly: boolean): ChartType {
  if (countOnly) return "stat";
  if (groupByType) return groupByType === "date" ? "line" : "bar";
  if (compiled.select && compiled.select.length > 0) return "table";
  if (compiled.aggregates?.length) return "stat";
  return "table";
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
        "Otherwise pick exactly one object and set status=ready.",
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
  if (routed.status !== "ready" || !routed.objects?.length) {
    return NextResponse.json({ status: "declined", reason: routed.reason || "That can't be answered from the data available to you." });
  }

  const objectKey = routed.objects[0];
  const src = LIST_SOURCES[objectKey];
  if (!src || !canViewWorkcenter(perms, src.relatedWorkcenter)) {
    // Defensive -- the catalog was already filtered, this should never fire.
    return NextResponse.json({ status: "declined", reason: "That object isn't available to you." });
  }

  // ── Stage 2: compile ────────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  let compileResponse;
  try {
    compileResponse = await anthropic.messages.create({
      model: "claude-opus-5",
      max_tokens: 900,
      tools: [compileTool(src.fields)],
      tool_choice: { type: "tool", name: "build_report" },
      system:
        `You translate a question about ${src.label} into a structured query over ONLY these fields:\n` +
        src.fields.map((f) => `- ${f.path} (${f.type}${f.searchable ? ", text-searchable" : ""})`).join("\n") +
        `\nToday is ${today}. Never invent field names outside the list. Tolerate typos and casual phrasing ("mote than 50k" = "more than 50,000"; "50k" = 50000, "1L"/"1 lakh" = 100000, "1cr" = 10000000).\n` +
        `\nPick the query SHAPE from the question's real intent:\n` +
        `- "how many X" -> count_only=true, chart_type=stat.\n` +
        `- "total/sum of X" -> aggregates=[{fn:sum,field}], chart_type=stat.\n` +
        `- "X by category" (status, type, month...) -> group_by + the value aggregate + chart_type=bar. Set group_sort to the aggregate key (e.g. "sum_total") when the question is about value; leave count when it's about counts.\n` +
        `- Trend over time -> group_by on a DATE field + group_sort="+key" + chart_type=line.\n` +
        `- "top N X by Y" -> group_by X, aggregate Y, group_sort=aggregate key, chart_type=bar (NOT table -- a ranking is a bar chart).\n` +
        `- GROUP-LEVEL THRESHOLDS: "accounts with quote value over 50k", "customers with more than 3 open cases" -- the condition is on the GROUP's total, not any single row. Use group_by + the aggregate + having (e.g. having=[{key:"sum_total",op:"gt",value:50000}]) + group_sort=that aggregate key + chart_type=bar. Filtering rows by total>50000 instead answers a DIFFERENT question (individual records over the threshold) -- only do that when the question is explicitly about individual records.\n` +
        `- A list of records ("show me...", "which quotes...") -> select the most useful 4-6 columns + sort + chart_type=table.\n` +
        `\nAlways fill interpretation with exactly what you measured, including any threshold and whether it applied per-record or per-group -- never vague. ` +
        `If this object's fields genuinely can't answer the question, set answerable=false with a specific reason.`,
      messages: [{ role: "user", content: question }],
    });
  } catch (e) {
    console.error("reports/ask compile stage failed:", e);
    return NextResponse.json({ error: "Could not compile that question right now. Try again shortly." }, { status: 502 });
  }

  const compileBlock = compileResponse.content.find((b) => b.type === "tool_use");
  if (!compileBlock || compileBlock.type !== "tool_use") {
    return NextResponse.json({ status: "declined", reason: "Could not interpret the question. Try rephrasing." });
  }
  const compiled = compileBlock.input as CompileInput;

  if (compiled.answerable === false) {
    return NextResponse.json({
      status: "declined",
      reason: compiled.reason || `That can't be answered from ${src.label}'s available fields.`,
      queryable_fields: src.fields.map((f) => f.path),
    });
  }

  // PII policy (architecture §3.7): a sensitive field may be aggregated over
  // (count/sum/avg never exposes one person's value) but never placed into a
  // bulk table's select, regardless of what the model asked for or what the
  // caller's workcenter access would otherwise permit on the record page.
  const sensitivePaths = new Set(src.fields.filter((f) => f.sensitive).map((f) => f.path));
  const droppedSensitive = (compiled.select ?? []).filter((p) => sensitivePaths.has(p));
  const safeSelect = compiled.select?.filter((p) => !sensitivePaths.has(p));

  const groupByField = compiled.group_by ? src.fields.find((f) => f.path === compiled.group_by) : undefined;
  const chartType = decideChartType(compiled, groupByField?.type ?? null, Boolean(compiled.count_only));

  // Engine-side group-order defaults ("engine is truth, model is advisory"):
  // a time axis reads chronologically; a value breakdown reads biggest-first
  // by its own aggregate, not by row count.
  let groupSort = compiled.group_sort;
  if (compiled.group_by && !groupSort) {
    const firstAgg = compiled.aggregates?.find((a) => a.fn !== "count" && a.field);
    if (groupByField?.type === "date") groupSort = "+key";
    else if (firstAgg) groupSort = `${firstAgg.fn}_${firstAgg.field}`;
  }

  const sp = compiledQueryToSearchParams({ ...compiled, select: safeSelect, group_sort: groupSort });
  if (compiled.group_by) sp.set("group_limit", "12");

  const parsed = parseListQuery(sp, src.fields);
  if (!parsed.ok) {
    return NextResponse.json({
      status: "declined",
      reason: "The compiled query wasn't valid: " + parsed.errors.map((e) => e.message).join("; "),
    });
  }

  const rows = await src.load(tenantId);
  const result = applyListQuery(rows, parsed.query);

  return NextResponse.json({
    status: "ready",
    question,
    object: objectKey,
    object_label: src.label,
    chart_type: chartType,
    x: compiled.x ?? compiled.group_by ?? null,
    y: compiled.y ?? null,
    title: compiled.title || question,
    interpretation:
      compiled.interpretation ||
      `${src.label}${droppedSensitive.length ? " (some fields omitted -- see below)" : ""}`,
    dropped_sensitive_fields: droppedSensitive,
    compiled_query: sp.toString(),
    data: result.data,
    groups: result.meta.groups ?? null,
    aggregates: result.meta.aggregates ?? null,
    total: result.meta.total,
  });
}
