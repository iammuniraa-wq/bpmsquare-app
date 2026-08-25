import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import type { LIST_SOURCES } from "@/lib/api/listSources";
import { parseListQuery, applyListQuery, type QueryableType } from "@/lib/api/query";
import { baseQueryProperties, compiledQueryToSearchParams, type CompiledQueryInput } from "@/lib/ai/nlCompile";
import type { ReportPayload } from "@/lib/reportView";

// The ONE "compile a question into a chart-worthy answer" primitive --
// shared by Report Builder (POST /api/reports/ask, docs/ai-report-builder-
// architecture.md) and the dock assistant (src/lib/ai/assistant.ts)'s
// `chart` tool. Before this, the two surfaces re-derived the same query-
// compilation logic independently -- one chart-shaped, one text-shaped --
// which is exactly the "why does the dock answer differently than Talk to
// data" gap this file closes. One engine, two callers: Report Builder still
// owns routing (which object) and insights fan-out (many facets, its own
// concern for a dedicated analytics page); the dock already knows the
// object from its own conversational context, so it calls straight in.
//
// The model NEVER writes SQL and never sees a data row -- it only ever
// emits the structured shape below, validated by parseListQuery() against
// the object's field whitelist before anything runs.

export type ChartType = "stat" | "bar" | "line" | "table";

export type CompileInput = CompiledQueryInput & {
  answerable?: boolean;
  reason?: string;
  chart_type?: ChartType;
  x?: string | null;
  y?: string | null;
  title?: string;
  interpretation?: string;
};

export function compileTool(fields: { path: string; type: string; searchable?: boolean }[]): Anthropic.Tool {
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
export function decideChartType(compiled: CompileInput, groupByType: QueryableType | null, countOnly: boolean): ChartType {
  if (countOnly) return "stat";
  if (groupByType) return groupByType === "date" ? "line" : "bar";
  if (compiled.select && compiled.select.length > 0) return "table";
  if (compiled.aggregates?.length) return "stat";
  return "table";
}

export type ReportResult = {
  status: "ready";
  question: string;
  object: string;
  object_label: string;
  chart_type: ChartType;
  x: string | null;
  y: string | null;
  title: string;
  interpretation: string;
  dropped_sensitive_fields: string[];
  compiled_query: string;
  data: Record<string, unknown>[];
  groups: ReportPayload["groups"];
  aggregates: Record<string, number> | null;
  total: number;
};
export type CompileOutcome = { ok: true; report: ReportResult } | { ok: false; reason: string };

/** One question against one already-loaded object -> one chart-worthy
 * report, or a specific decline reason. `contextPrefix` carries prior-turn
 * context as TEXT only (a refinement in Report Builder, prior chat turns in
 * the dock) -- never a client-supplied query, so every call still recompiles
 * and revalidates from scratch. */
export async function compileAndRun(
  anthropic: Anthropic,
  question: string,
  objectKey: string,
  src: (typeof LIST_SOURCES)[string],
  rows: Record<string, unknown>[],
  today: string,
  contextPrefix?: string
): Promise<CompileOutcome> {
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
        `- "X by category" (status, type...) -> group_by + the value aggregate + chart_type=bar. Set group_sort to the aggregate key (e.g. "sum_total") when the question is about value; leave count when it's about counts.\n` +
        `- Trend over time -> group_by on a DATE field + chart_type=line. Set group_period to the granularity asked (day, week, month, quarter, year) -- an unset period defaults to month, and the engine orders time buckets chronologically on its own.\n` +
        `- "top N X by Y" -> group_by X, aggregate Y, group_sort=aggregate key, chart_type=bar (NOT table -- a ranking is a bar chart).\n` +
        `- GROUP-LEVEL THRESHOLDS: "accounts with quote value over 50k", "customers with more than 3 open cases" -- the condition is on the GROUP's total, not any single row. Use group_by + the aggregate + having (e.g. having=[{key:"sum_total",op:"gt",value:50000}]) + group_sort=that aggregate key + chart_type=bar. Filtering rows by total>50000 instead answers a DIFFERENT question (individual records over the threshold) -- only do that when the question is explicitly about individual records.\n` +
        `- A list of records ("show me...", "which quotes...") -> select the most useful 4-6 columns + sort + chart_type=table.\n` +
        `\nAlways fill interpretation with exactly what you measured, including any threshold and whether it applied per-record or per-group -- never vague. ` +
        `If this object's fields genuinely can't answer the question, set answerable=false with a specific reason.`,
      messages: [{ role: "user", content: contextPrefix ? `${contextPrefix}\n\n${question}` : question }],
    });
  } catch (e) {
    console.error("reportCompile: compile stage failed:", e);
    return { ok: false, reason: "Could not compile that question right now." };
  }

  const compileBlock = compileResponse.content.find((b) => b.type === "tool_use");
  if (!compileBlock || compileBlock.type !== "tool_use") {
    return { ok: false, reason: "Could not interpret the question." };
  }
  const compiled = compileBlock.input as CompileInput;

  if (compiled.answerable === false) {
    return { ok: false, reason: compiled.reason || `That can't be answered from ${src.label}'s available fields.` };
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
    return { ok: false, reason: "The compiled query wasn't valid: " + parsed.errors.map((e) => e.message).join("; ") };
  }

  const result = applyListQuery(rows, parsed.query);

  return {
    ok: true,
    report: {
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
    },
  };
}
