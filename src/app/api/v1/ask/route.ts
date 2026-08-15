import Anthropic from "@anthropic-ai/sdk";
import { authorizeApi, jsonError, jsonValidationError, readJsonBody, optionsResponse, jsonOk, RW_METHODS } from "../_auth";
import { LIST_SOURCES } from "@/lib/api/listSources";
import { parseListQuery, applyListQuery } from "@/lib/api/query";

// POST /api/v1/ask  { "object": "quotations", "question": "top 5 draft quotes over 50k by value" }
//
// Natural language, compiled to the SAME safe query engine the REST endpoints
// use -- not to SQL. The model only emits a structured query (which listed
// field, which operator, which value); the server turns that into the wire
// query string and runs it through parseListQuery(), so every field is
// validated against the object's whitelist exactly as a normal request would
// be. An out-of-whitelist field the model hallucinates is a 422, never a query.
// There is no model-authored SQL, no model-chosen tenant, and no write path.

export const maxDuration = 30;

const OPS = ["eq", "ne", "gt", "gte", "lt", "lte", "like", "in", "isnull"];

function askTool(fields: { path: string; type: string; searchable?: boolean }[]): Anthropic.Tool {
  return {
    name: "query",
    description: "Translate the user's question into a structured query over the object's fields, or decline if it can't be answered from those fields.",
    input_schema: {
      type: "object",
      properties: {
        answerable: { type: "boolean", description: "false if the question can't be answered from the listed fields." },
        filters: {
          type: "array",
          description: "Conditions, ANDed together. Use only listed field paths.",
          items: {
            type: "object",
            properties: {
              field: { type: "string", enum: fields.map((f) => f.path) },
              op: { type: "string", enum: OPS, description: "like = case-insensitive contains; in = comma-separated list; isnull value is 'true'/'false'." },
              value: { type: "string", description: "The comparison value as a string (dates as ISO yyyy-mm-dd)." },
            },
            required: ["field", "op", "value"],
          },
        },
        search: { type: "string", description: "Free-text contains across searchable fields (" + fields.filter((f) => f.searchable).map((f) => f.path).join(", ") + "). Use instead of guessing which text field." },
        sort: {
          type: "array",
          items: { type: "object", properties: { field: { type: "string", enum: fields.map((f) => f.path) }, dir: { type: "string", enum: ["asc", "desc"] } }, required: ["field", "dir"] },
        },
        select: { type: "array", items: { type: "string", enum: fields.map((f) => f.path) }, description: "Fields to return; omit for all." },
        aggregates: {
          type: "array",
          description: "Aggregates over the filtered set, e.g. sum of total.",
          items: { type: "object", properties: { fn: { type: "string", enum: ["count", "sum", "avg", "min", "max"] }, field: { type: "string", enum: fields.map((f) => f.path) } }, required: ["fn"] },
        },
        group_by: { type: "string", enum: fields.map((f) => f.path), description: "Group counts/aggregates by this field." },
        limit: { type: "integer", minimum: 1, maximum: 200, description: "Row cap; use with sort for 'top N'." },
        count_only: { type: "boolean", description: "true for 'how many' questions -- returns the count without the rows." },
      },
      required: ["answerable"],
    },
  };
}

type QueryInput = {
  answerable?: boolean;
  filters?: { field: string; op: string; value: string }[];
  search?: string;
  sort?: { field: string; dir: string }[];
  select?: string[];
  aggregates?: { fn: string; field?: string }[];
  group_by?: string;
  limit?: number;
  count_only?: boolean;
};

// Build the same wire query string a REST caller would send, so it runs through
// the identical validation path.
function toSearchParams(q: QueryInput): URLSearchParams {
  const sp = new URLSearchParams();
  if (q.filters?.length) sp.set("filter", q.filters.map((f) => `${f.field}:${f.op}:${f.value}`).join(";"));
  if (q.search) sp.set("search", q.search);
  if (q.sort?.length) sp.set("sort", q.sort.map((s) => (s.dir === "desc" ? "-" : "") + s.field).join(","));
  if (q.select?.length) sp.set("select", q.select.join(","));
  if (q.aggregates?.length) sp.set("aggregate", q.aggregates.map((a) => (a.field ? `${a.fn}:${a.field}` : a.fn)).join(","));
  if (q.group_by) sp.set("group_by", q.group_by);
  if (q.limit) sp.set("limit", String(q.limit));
  if (q.count_only) sp.set("count", "only");
  return sp;
}

export async function POST(req: Request) {
  const parsedBody = await readJsonBody(req);
  if (!parsedBody.ok) return parsedBody.response;
  const body = (parsedBody.body ?? {}) as Record<string, unknown>;

  const object = typeof body.object === "string" ? body.object : "";
  const question = typeof body.question === "string" ? body.question.trim() : "";
  const src = LIST_SOURCES[object];
  if (!src) return jsonError(422, "Unknown object", { message: `object must be one of: ${Object.keys(LIST_SOURCES).join(", ")}.` });
  if (!question) return jsonError(422, "Missing question", { message: "Provide a natural-language `question`." });

  // Read scope on the named object -- same gate as GET on that object.
  const auth = await authorizeApi(req, object);
  if ("error" in auth) return auth.error;

  if (!process.env.ANTHROPIC_API_KEY) return jsonError(503, "Not configured", { message: "Natural-language queries need ANTHROPIC_API_KEY set on the server." });

  const today = new Date().toISOString().slice(0, 10);
  let response;
  try {
    response = await new Anthropic().messages.create({
      model: "claude-opus-5",
      max_tokens: 700,
      tools: [askTool(src.fields)],
      tool_choice: { type: "tool", name: "query" },
      system:
        `You translate a question about ${src.label} into a structured query over ONLY these fields:\n` +
        src.fields.map((f) => `- ${f.path} (${f.type}${f.searchable ? ", text-searchable" : ""})`).join("\n") +
        `\nToday is ${today}. Never invent field names outside the list. For "top N" use sort desc + limit. ` +
        `For "how many" set count_only. For totals use aggregates. If the question needs a field that isn't listed, set answerable=false.`,
      messages: [{ role: "user", content: question }],
    });
  } catch (e) {
    console.error("v1/ask model call failed:", e);
    return jsonError(502, "AI service unavailable", { message: "Could not compile the question right now. Try again shortly." });
  }

  const block = response.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") return jsonError(422, "Could not interpret the question", { message: "Try rephrasing, or use the structured query parameters directly." });
  const input = block.input as QueryInput;

  if (input.answerable === false) {
    return jsonOk({
      question, object,
      answerable: false,
      message: `That can't be answered from the available ${src.label.toLowerCase()} fields. Queryable fields: ${src.fields.map((f) => f.path).join(", ")}.`,
    }, RW_METHODS);
  }

  const sp = toSearchParams(input);
  const parsed = parseListQuery(sp, src.fields);
  if (!parsed.ok) {
    // The model produced something the engine rejects -- surface it rather than
    // silently running a different query.
    return jsonValidationError(parsed.errors.map((e) => ({ field: e.param, message: e.message })));
  }

  const rows = await src.load(auth.tenantId);
  const result = applyListQuery(rows, parsed.query);

  return jsonOk({
    question,
    object,
    answerable: true,
    compiled: `/api/v1/${object}?${sp.toString()}`,
    data: result.data,
    meta: { ...result.meta, generated_at: new Date().toISOString() },
  }, RW_METHODS);
}

export function OPTIONS() {
  return optionsResponse(RW_METHODS);
}
