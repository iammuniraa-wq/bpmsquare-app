import Anthropic from "@anthropic-ai/sdk";
import { authorizeApi, jsonError, jsonValidationError, readJsonBody, optionsResponse, jsonOk, RW_METHODS } from "../_auth";
import { LIST_SOURCES } from "@/lib/api/listSources";
import { parseListQuery, applyListQuery } from "@/lib/api/query";
import { baseQueryProperties, compiledQueryToSearchParams, type CompiledQueryInput } from "@/lib/ai/nlCompile";

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

function askTool(fields: { path: string; type: string; searchable?: boolean }[]): Anthropic.Tool {
  return {
    name: "query",
    description: "Translate the user's question into a structured query over the object's fields, or decline if it can't be answered from those fields.",
    input_schema: {
      type: "object",
      properties: {
        answerable: { type: "boolean", description: "false if the question can't be answered from the listed fields." },
        ...baseQueryProperties(fields),
      },
      required: ["answerable"],
    },
  };
}

type QueryInput = CompiledQueryInput & { answerable?: boolean };

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
  // project_hours rides on the "projects" scope (it is the projects' hours),
  // with the person redacted unless the key also holds "employees" -- the
  // same rule /api/v1/project-hours applies.
  const auth = await authorizeApi(req, object === "project_hours" ? "projects" : object);
  if ("error" in auth) return auth.error;
  const peopleAllowed = object !== "project_hours" || auth.scopes.objects.includes("employees");
  const fields = peopleAllowed ? src.fields : src.fields.filter((f) => !f.path.startsWith("employee."));

  if (!process.env.ANTHROPIC_API_KEY) return jsonError(503, "Not configured", { message: "Natural-language queries need ANTHROPIC_API_KEY set on the server." });

  const today = new Date().toISOString().slice(0, 10);
  let response;
  try {
    response = await new Anthropic().messages.create({
      model: "claude-opus-5",
      max_tokens: 700,
      tools: [askTool(fields)],
      tool_choice: { type: "tool", name: "query" },
      system:
        `You translate a question about ${src.label} into a structured query over ONLY these fields:\n` +
        fields.map((f) => `- ${f.path} (${f.type}${f.searchable ? ", text-searchable" : ""})`).join("\n") +
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

  const sp = compiledQueryToSearchParams(input);
  const parsed = parseListQuery(sp, fields);
  if (!parsed.ok) {
    // The model produced something the engine rejects -- surface it rather than
    // silently running a different query.
    return jsonValidationError(parsed.errors.map((e) => ({ field: e.param, message: e.message })));
  }

  let rows = await src.load(auth.tenantId);
  if (!peopleAllowed) rows = rows.map((r) => { const { employee: _e, ...rest } = r; void _e; return rest; });
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
