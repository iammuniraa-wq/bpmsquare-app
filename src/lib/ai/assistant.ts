import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PermissionSet } from "@/lib/permissions";
import { canViewWorkcenter } from "@/lib/permissions";
import { LIST_SOURCES } from "@/lib/api/listSources";
import { parseListQuery, applyListQuery } from "@/lib/api/query";
import { compiledQueryToSearchParams, type CompiledQueryInput } from "@/lib/ai/nlCompile";

/**
 * Conversational data assistant (the bottom-right dock).
 *
 * ── Why it's built this way ────────────────────────────────────────────────
 * An agentic loop, not a fixed intent catalog: the model can query ANY
 * object in LIST_SOURCES (permission-filtered before it sees the catalog),
 * chain several queries, compare results, and answer follow-ups with the
 * conversation's context. What it still CANNOT do, by construction:
 *   - write SQL or see a query language -- its only data tool emits the
 *     same structured shape /api/v1/ask compiles, validated by
 *     parseListQuery() against the object's field whitelist. A hallucinated
 *     field is a validation error fed back for self-correction, never a query.
 *   - reach outside the caller's tenant -- every load() is tenant-scoped by
 *     the id from requireTenantUser(), exactly like every other route.
 *   - see an object the caller's Business Roles don't grant view on -- the
 *     catalog is filtered before the prompt is built.
 *   - create, update or delete -- no such tool exists in the loop.
 * Numbers in the reply are composed by the model FROM tool results over
 * live data; the interpretation duty ("say exactly what you measured")
 * is part of its instructions, same doctrine as Report Builder.
 */

export class AssistantError extends Error {}

const MAX_TURNS = 6;         // model calls per question (tool-use rounds + final)
const MAX_ROWS_TO_MODEL = 20; // rows a single query returns into context

export type ChatTurn = { role: "user" | "assistant"; text: string };

// Special lookups for data that isn't (yet) in LIST_SOURCES.
type QuickLookup = {
  id: string;
  workcenter: Parameters<typeof canViewWorkcenter>[1];
  description: string;
  run: (supabase: SupabaseClient, tenantId: string) => Promise<string>;
};

const QUICK_LOOKUPS: QuickLookup[] = [
  {
    id: "open_leads",
    workcenter: "leads",
    description: "How many marketing leads are still open (status new/inspecting/quoted)",
    run: async (supabase, tenantId) => {
      const { count } = await supabase
        .from("leads").select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId).in("status", ["new", "inspecting", "quoted"]);
      return JSON.stringify({ open_leads: count ?? 0 });
    },
  },
  {
    id: "who_is_in_today",
    workcenter: "wfm",
    description: "How many employees are checked in right now / on break (Workforce presence)",
    run: async (supabase, tenantId) => {
      const since = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("wfm_presence_events").select("employee_id, kind, ts")
        .eq("tenant_id", tenantId).is("superseded_by", null).gte("ts", since)
        .order("ts", { ascending: true });
      const last = new Map<string, string>();
      for (const e of data ?? []) last.set(e.employee_id as string, e.kind as string);
      const checkedIn = [...last.values()].filter((k) => k === "check_in" || k === "break_end").length;
      const onBreak = [...last.values()].filter((k) => k === "break_start").length;
      return JSON.stringify({ checked_in_now: checkedIn, on_break_now: onBreak });
    },
  },
];

function visibleSources(perms: PermissionSet) {
  return Object.entries(LIST_SOURCES).filter(([, src]) => canViewWorkcenter(perms, src.relatedWorkcenter));
}

function visibleQuickLookups(perms: PermissionSet) {
  return QUICK_LOOKUPS.filter((q) => canViewWorkcenter(perms, q.workcenter));
}

/** Example-question chips for the dock's empty state, permission-filtered. */
export function capabilityList(perms: PermissionSet): string[] {
  const has = (wc: Parameters<typeof canViewWorkcenter>[1]) => canViewWorkcenter(perms, wc);
  const out: string[] = [];
  if (has("accounts")) out.push("Which accounts have quote value over 1 lakh?");
  if (has("quotations")) out.push("Total value of open quotations");
  if (has("quotations")) out.push("Quotes by status");
  if (has("cases")) out.push("How many cases are open, by priority?");
  if (has("invoices")) out.push("Total outstanding invoice value");
  if (has("products")) out.push("Which products are in the catalog?");
  if (has("leads")) out.push("How many leads are still open?");
  if (has("wfm")) out.push("Who is checked in right now?");
  return out;
}

// One generic data tool for every object. Field names are plain strings here
// (per-object enums would need one tool per object); the field catalog lives
// in the system prompt and parseListQuery() enforces it at execution -- an
// unknown field comes back as a tool error naming the accepted fields, which
// the loop lets the model correct.
function queryDataTool(objects: string[]): Anthropic.Tool {
  return {
    name: "query_data",
    description:
      "Run one read-only query against a business object and get real data back. " +
      "Use the field lists in your instructions -- never guess a field name. " +
      "You can call this several times to answer one question (e.g. to compare two statuses).",
    input_schema: {
      type: "object",
      properties: {
        object: { type: "string", enum: objects },
        filters: {
          type: "array",
          description: "Row conditions, ANDed. op: eq ne gt gte lt lte like in isnull. Dates ISO yyyy-mm-dd.",
          items: {
            type: "object",
            properties: {
              field: { type: "string" }, op: { type: "string" },
              value: { type: "string", description: "Comparison value as a string." },
            },
            required: ["field", "op", "value"],
          },
        },
        search: { type: "string", description: "Free-text contains across the object's searchable fields." },
        sort: { type: "array", items: { type: "object", properties: { field: { type: "string" }, dir: { type: "string", enum: ["asc", "desc"] } }, required: ["field", "dir"] } },
        select: { type: "array", items: { type: "string" }, description: "Columns to return for row listings. Keep to the 3-6 most useful." },
        aggregates: { type: "array", items: { type: "object", properties: { fn: { type: "string", enum: ["count", "sum", "avg", "min", "max"] }, field: { type: "string" } }, required: ["fn"] } },
        group_by: { type: "string", description: "Group counts/aggregates by this field." },
        group_period: { type: "string", enum: ["day", "week", "month", "quarter", "year"], description: "Calendar bucket when group_by is a DATE field (trends). Defaults to month." },
        having: {
          type: "array",
          description: "Group-level conditions after group_by (SQL HAVING), e.g. accounts whose sum_total > 50000. Keys: 'count' or '<fn>_<field>'.",
          items: { type: "object", properties: { key: { type: "string" }, op: { type: "string", enum: ["eq", "ne", "gt", "gte", "lt", "lte"] }, value: { type: "number" } }, required: ["key", "op", "value"] },
        },
        group_sort: { type: "string", description: "'count', 'key', or an aggregate key like 'sum_total'. Descending by default, '+' prefix for ascending." },
        limit: { type: "integer", minimum: 1, maximum: 25, description: "Row cap for listings (max 25 in chat)." },
        count_only: { type: "boolean", description: "true when only counts/aggregates/groups are needed -- no rows." },
      },
      required: ["object"],
    },
  };
}

function quickLookupTool(lookups: QuickLookup[]): Anthropic.Tool {
  return {
    name: "quick_lookup",
    description: "Special pre-built lookups for data outside query_data's objects.",
    input_schema: {
      type: "object",
      properties: {
        lookup: {
          type: "string",
          enum: lookups.map((l) => l.id),
          description: lookups.map((l) => `${l.id}: ${l.description}`).join(" | "),
        },
      },
      required: ["lookup"],
    },
  };
}

type QueryDataInput = CompiledQueryInput & { object?: string };

async function runQueryData(
  input: QueryDataInput,
  ctx: { tenantId: string; perms: PermissionSet }
): Promise<string> {
  const key = input.object ?? "";
  const src = LIST_SOURCES[key];
  if (!src || !canViewWorkcenter(ctx.perms, src.relatedWorkcenter)) {
    return `Error: unknown or inaccessible object "${key}".`;
  }

  // PII rule, same as Report Builder: aggregate over, never list out.
  const sensitive = new Set(src.fields.filter((f) => f.sensitive).map((f) => f.path));
  const select = input.select?.filter((p) => !sensitive.has(p));

  const limit = Math.min(MAX_ROWS_TO_MODEL, Math.max(1, input.limit ?? 10));
  const sp = compiledQueryToSearchParams({ ...input, select, limit });
  if (input.group_by) sp.set("group_limit", "15");

  const parsed = parseListQuery(sp, src.fields);
  if (!parsed.ok) {
    // Fed back into the loop -- the model corrects and retries.
    return "Error: " + parsed.errors.map((e) => e.message).join("; ");
  }

  const rows = await src.load(ctx.tenantId);
  const result = applyListQuery(rows, parsed.query);
  return JSON.stringify({
    object: key,
    total_matching: result.meta.total,
    aggregates: result.meta.aggregates ?? undefined,
    groups: result.meta.groups ?? undefined,
    rows: input.count_only ? undefined : result.data.slice(0, MAX_ROWS_TO_MODEL),
  });
}

function systemPrompt(
  sources: [string, (typeof LIST_SOURCES)[string]][],
  lookups: QuickLookup[]
): string {
  const today = new Date().toISOString().slice(0, 10);
  return (
    "You are the BPMSquare Assistant -- the in-app helper for a business running its sales, service and operations on BPMSquare. " +
    "You answer questions about the user's own business data by querying it live, and you answer questions about what you can do.\n\n" +
    "OBJECTS you can query with query_data, and their exact fields (NEVER guess a field not listed):\n" +
    sources
      .map(([key, src]) =>
        `- ${key} (${src.label}): ${src.description}\n  fields: ` +
        src.fields.map((f) => `${f.path}(${f.type}${f.searchable ? ",searchable" : ""})`).join(", ")
      )
      .join("\n") +
    (lookups.length
      ? "\n\nSPECIAL quick_lookup lookups:\n" + lookups.map((l) => `- ${l.id}: ${l.description}`).join("\n")
      : "") +
    `\n\nToday is ${today}.\n\n` +
    "RULES:\n" +
    "1. NEVER state a number, list or fact about the user's data without querying for it first in this conversation. If a tool errors, fix the query and retry.\n" +
    "2. Group-level thresholds ('accounts with quote value over 50k') use group_by + aggregate + having -- the condition is on the group's total, not single rows. Trends use group_by on a date field (bucketed monthly unless you set group_period). Quotations carry their own cash link (invoiced_total, paid_total, balance_due) -- quote-to-cash questions are single queries there.\n" +
    "3. Understand casual Indian business shorthand: 50k=50000, 1L/1 lakh=100000, 1cr=10000000. Format money as ₹ with Indian digit grouping, compact where natural (₹4.5L, ₹2.3Cr).\n" +
    "4. Keep answers SHORT and direct -- one sentence for a number, a compact bullet list for a breakdown (top items only, note how many more). This renders in a small chat panel.\n" +
    "5. Say what you measured when it's not obvious (e.g. 'counting draft + sent quotes as open').\n" +
    "6. You cannot create, change or delete anything from this chat, and you have no tool that can -- if asked to, say so and point to the right place: the Create buttons above this chat or ⌘K can draft a record from pasted text on Nova, and every record has its own New page.\n" +
    "7. Questions about you: you're the BPMSquare Assistant; this chat reads live tenant data through the same permission system as the app; you can answer follow-ups in context.\n" +
    "8. Only discuss this workspace's data and BPMSquare itself -- politely decline anything else."
  );
}

export type AssistantReply = { answer: string };

export async function askAssistant(
  history: ChatTurn[],
  ctx: { supabase: SupabaseClient; tenantId: string; perms: PermissionSet }
): Promise<AssistantReply> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AssistantError("The assistant isn't configured yet (missing ANTHROPIC_API_KEY).");
  }
  const sources = visibleSources(ctx.perms);
  const lookups = visibleQuickLookups(ctx.perms);
  if (sources.length === 0 && lookups.length === 0) {
    return { answer: "You don't currently have access to any data I can report on." };
  }

  const tools: Anthropic.Tool[] = [];
  if (sources.length) tools.push(queryDataTool(sources.map(([k]) => k)));
  if (lookups.length) tools.push(quickLookupTool(lookups));

  const anthropic = new Anthropic();
  const messages: Anthropic.MessageParam[] = history.map((t) => ({ role: t.role, content: t.text }));

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    let response: Anthropic.Message;
    try {
      response = await anthropic.messages.create({
        model: "claude-opus-5",
        max_tokens: 1000,
        tools,
        system: systemPrompt(sources, lookups),
        messages,
      });
    } catch (e) {
      console.error("Assistant request failed:", e);
      if (e instanceof Anthropic.AuthenticationError) throw new AssistantError("The AI service rejected ANTHROPIC_API_KEY.");
      if (e instanceof Anthropic.RateLimitError) throw new AssistantError("The assistant is rate-limited right now. Try again in a moment.");
      if (e instanceof Anthropic.APIConnectionError) throw new AssistantError("Could not reach the AI service. Try again in a moment.");
      throw new AssistantError("The assistant is unavailable right now.");
    }

    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (toolUses.length === 0 || response.stop_reason !== "tool_use") {
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text).join("").trim();
      return { answer: text || "I couldn't work out an answer to that. Try rephrasing?" };
    }

    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      let out: string;
      try {
        if (tu.name === "query_data") {
          out = await runQueryData(tu.input as QueryDataInput, ctx);
        } else if (tu.name === "quick_lookup") {
          const id = (tu.input as { lookup?: string }).lookup;
          const lookup = lookups.find((l) => l.id === id);
          out = lookup ? await lookup.run(ctx.supabase, ctx.tenantId) : `Error: unknown lookup "${id}".`;
        } else {
          out = `Error: unknown tool "${tu.name}".`;
        }
      } catch (e) {
        console.error(`Assistant tool ${tu.name} failed:`, e);
        out = "Error: that lookup failed. Tell the user the data couldn't be read just now.";
      }
      results.push({ type: "tool_result", tool_use_id: tu.id, content: out.slice(0, 20_000) });
    }
    messages.push({ role: "user", content: results });
  }

  return { answer: "That took more digging than I can do in one go — try a more specific question." };
}
