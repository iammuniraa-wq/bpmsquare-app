import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PermissionSet } from "@/lib/permissions";
import { canViewWorkcenter } from "@/lib/permissions";
import type { WorkcenterKey } from "@/lib/workcenters";

/**
 * Read-only data assistant.
 *
 * ── Why it's built this way ────────────────────────────────────────────────
 * The model NEVER writes or sees SQL, and never chooses a tenant. It only
 * picks one entry from a fixed catalog of pre-approved read-only queries
 * (below) plus a couple of scalar parameters; the server then runs that
 * query itself with the caller's own session client and an explicit
 * `.eq("tenant_id", tenantId)` taken from requireTenantUser(). So:
 *   - there is no injection surface (no model-authored query text),
 *   - cross-tenant access is impossible by construction (tenant comes from
 *     the request's session, exactly like every other route), and
 *   - create/update/delete are not merely discouraged, they don't exist as
 *     tools the model can reach.
 * Each intent also declares the workcenter it reads, and is filtered out
 * before the model ever sees it if the caller's Business Roles don't grant
 * view on it -- so the assistant can't become a way around the permission
 * system.
 */

export class AssistantError extends Error {}

export type IntentId =
  | "count_accounts" | "count_contacts"
  | "open_quotes" | "quote_total_value" | "recent_quotes"
  | "open_cases" | "recent_cases"
  | "unpaid_invoices" | "invoice_total_outstanding"
  | "open_leads"
  | "who_is_in_today";

type IntentDef = {
  id: IntentId;
  workcenter: WorkcenterKey;
  /** Shown to the model so it can choose, and to the user as a capability. */
  description: string;
  run: (ctx: RunContext) => Promise<string>;
};

type RunContext = {
  supabase: SupabaseClient;
  tenantId: string;
  limit: number;
  status?: string;
};

const money = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

// Every query below is tenant-filtered explicitly, on the session client
// (so RLS is a second line of defence, not the only one).
const INTENTS: IntentDef[] = [
  {
    id: "count_accounts",
    workcenter: "accounts",
    description: "How many accounts/customers exist",
    run: async ({ supabase, tenantId }) => {
      const { count } = await supabase.from("accounts").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
      return `You have ${count ?? 0} account${count === 1 ? "" : "s"}.`;
    },
  },
  {
    id: "count_contacts",
    workcenter: "contacts",
    description: "How many contacts exist",
    run: async ({ supabase, tenantId }) => {
      const { count } = await supabase.from("contacts").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
      return `You have ${count ?? 0} contact${count === 1 ? "" : "s"}.`;
    },
  },
  {
    id: "open_quotes",
    workcenter: "quotations",
    description: "How many quotations are open / not yet approved or rejected",
    run: async ({ supabase, tenantId }) => {
      const { count } = await supabase
        .from("quotes").select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId).in("status", ["draft", "sent"]);
      return `${count ?? 0} quotation${count === 1 ? " is" : "s are"} still open (draft or sent).`;
    },
  },
  {
    id: "quote_total_value",
    workcenter: "quotations",
    description: "Total value of open quotations",
    run: async ({ supabase, tenantId }) => {
      const { data } = await supabase
        .from("quotes").select("total").eq("tenant_id", tenantId).in("status", ["draft", "sent"]);
      const sum = (data ?? []).reduce((s, q) => s + Number(q.total ?? 0), 0);
      return `Open quotations are worth ${money(sum)} across ${(data ?? []).length} quote${(data ?? []).length === 1 ? "" : "s"}.`;
    },
  },
  {
    id: "recent_quotes",
    workcenter: "quotations",
    description: "The most recent quotations, with their status and value",
    run: async ({ supabase, tenantId, limit }) => {
      const { data } = await supabase
        .from("quotes").select("quote_ref, status, total, created_at")
        .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(limit);
      if (!data?.length) return "There are no quotations yet.";
      return `The ${data.length} most recent quotation${data.length === 1 ? "" : "s"}:\n` +
        data.map((q) => `• ${q.quote_ref ?? "(no ref)"} — ${q.status}, ${money(Number(q.total ?? 0))}`).join("\n");
    },
  },
  {
    id: "open_cases",
    workcenter: "cases",
    description: "How many service cases are open / unresolved",
    run: async ({ supabase, tenantId }) => {
      const { count } = await supabase
        .from("service_cases").select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId).not("status", "in", '("closed","cancelled")');
      return `${count ?? 0} service case${count === 1 ? " is" : "s are"} currently open.`;
    },
  },
  {
    id: "recent_cases",
    workcenter: "cases",
    description: "The most recently created service cases",
    run: async ({ supabase, tenantId, limit }) => {
      const { data } = await supabase
        .from("service_cases").select("case_number, title, status, created_at")
        .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(limit);
      if (!data?.length) return "There are no service cases yet.";
      return `The ${data.length} most recent case${data.length === 1 ? "" : "s"}:\n` +
        data.map((x) => `• ${x.case_number ?? ""} ${x.title ?? ""} — ${x.status}`.trim()).join("\n");
    },
  },
  {
    id: "unpaid_invoices",
    workcenter: "invoices",
    description: "How many invoices are unpaid or overdue",
    run: async ({ supabase, tenantId }) => {
      const { data } = await supabase
        .from("invoices").select("status").eq("tenant_id", tenantId).in("status", ["sent", "partial", "overdue"]);
      const overdue = (data ?? []).filter((i) => i.status === "overdue").length;
      return `${(data ?? []).length} invoice${(data ?? []).length === 1 ? " is" : "s are"} unpaid` +
        (overdue > 0 ? `, of which ${overdue} ${overdue === 1 ? "is" : "are"} overdue.` : ".");
    },
  },
  {
    id: "invoice_total_outstanding",
    workcenter: "invoices",
    description: "Total outstanding / unpaid invoice value",
    run: async ({ supabase, tenantId }) => {
      const { data } = await supabase
        .from("invoices").select("total").eq("tenant_id", tenantId).in("status", ["sent", "partial", "overdue"]);
      const sum = (data ?? []).reduce((s, i) => s + Number(i.total ?? 0), 0);
      return `Outstanding invoice value is ${money(sum)} across ${(data ?? []).length} invoice${(data ?? []).length === 1 ? "" : "s"}.`;
    },
  },
  {
    id: "open_leads",
    workcenter: "leads",
    description: "How many leads are still open (not won or lost)",
    run: async ({ supabase, tenantId }) => {
      const { count } = await supabase
        .from("leads").select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId).in("status", ["new", "inspecting", "quoted"]);
      return `${count ?? 0} lead${count === 1 ? " is" : "s are"} still open.`;
    },
  },
  {
    id: "who_is_in_today",
    workcenter: "wfm",
    description: "How many employees are checked in right now (Workforce)",
    run: async ({ supabase, tenantId }) => {
      const since = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("wfm_presence_events").select("employee_id, kind, ts")
        .eq("tenant_id", tenantId).is("superseded_by", null).gte("ts", since)
        .order("ts", { ascending: true });
      const last = new Map<string, string>();
      for (const e of data ?? []) last.set(e.employee_id as string, e.kind as string);
      const inNow = [...last.values()].filter((k) => k === "check_in" || k === "break_end").length;
      const onBreak = [...last.values()].filter((k) => k === "break_start").length;
      return `${inNow} employee${inNow === 1 ? " is" : "s are"} checked in right now` +
        (onBreak > 0 ? `, and ${onBreak} ${onBreak === 1 ? "is" : "are"} on a break.` : ".");
    },
  },
];

/** The intents this caller is actually allowed to use, given Business Roles. */
export function availableIntents(perms: PermissionSet): IntentDef[] {
  return INTENTS.filter((i) => canViewWorkcenter(perms, i.workcenter));
}

/** Capability list for the assistant's default/empty state. */
export function capabilityList(perms: PermissionSet): string[] {
  return availableIntents(perms).map((i) => i.description);
}

const ANSWER_TOOL = (allowed: IntentDef[]): Anthropic.Tool => ({
  name: "answer",
  description:
    "Choose which read-only lookup answers the user's question, or decline. " +
    "Never claim to change data -- this system can only read.",
  input_schema: {
    type: "object",
    properties: {
      intent: {
        type: "string",
        enum: [...allowed.map((i) => i.id), "unsupported", "write_request"],
        description:
          allowed.map((i) => `${i.id}: ${i.description}`).join(" | ") +
          " | unsupported: the question is about something this list can't answer" +
          " | write_request: the user is asking to create, change or delete something",
      },
      limit: { type: "integer", description: "How many rows to list, 1-10. Default 5.", minimum: 1, maximum: 10 },
    },
    required: ["intent"],
  },
});

export type AssistantReply = {
  answer: string;
  intent: IntentId | "unsupported" | "write_request";
};

export async function askAssistant(
  question: string,
  ctx: { supabase: SupabaseClient; tenantId: string; perms: PermissionSet }
): Promise<AssistantReply> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AssistantError("The assistant isn't configured yet (missing ANTHROPIC_API_KEY).");
  }
  const allowed = availableIntents(ctx.perms);
  if (allowed.length === 0) {
    return { answer: "You don't currently have access to any data I can report on.", intent: "unsupported" };
  }

  let response;
  try {
    response = await new Anthropic().messages.create({
      model: "claude-opus-5",
      max_tokens: 512,
      tools: [ANSWER_TOOL(allowed)],
      tool_choice: { type: "tool", name: "answer" },
      system:
        "You route a CRM user's question to ONE read-only lookup. You cannot create, update or delete " +
        "anything -- if the user asks you to, choose write_request. If no lookup fits, choose unsupported. " +
        "Do not guess data values; you only pick the lookup.",
      messages: [{ role: "user", content: question }],
    });
  } catch (e) {
    console.error("Assistant request failed:", e);
    if (e instanceof Anthropic.AuthenticationError) throw new AssistantError("The AI service rejected ANTHROPIC_API_KEY.");
    if (e instanceof Anthropic.RateLimitError) throw new AssistantError("The assistant is rate-limited right now. Try again in a moment.");
    if (e instanceof Anthropic.APIConnectionError) throw new AssistantError("Could not reach the AI service. Try again in a moment.");
    throw new AssistantError("The assistant is unavailable right now.");
  }

  const block = response.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    return { answer: "I couldn't work out what to look up. Try rephrasing?", intent: "unsupported" };
  }
  const input = block.input as { intent: string; limit?: number };

  if (input.intent === "write_request") {
    return {
      intent: "write_request",
      answer:
        "I can only look things up — I can't create, change or delete anything. " +
        "You'll need to do that on the relevant page yourself.",
    };
  }

  const intent = allowed.find((i) => i.id === input.intent);
  if (!intent) {
    return {
      intent: "unsupported",
      answer:
        "I can't answer that one yet. Right now I can help with:\n" +
        allowed.map((i) => `• ${i.description}`).join("\n"),
    };
  }

  const limit = Math.min(10, Math.max(1, input.limit ?? 5));
  try {
    const answer = await intent.run({ supabase: ctx.supabase, tenantId: ctx.tenantId, limit });
    return { answer, intent: intent.id };
  } catch (e) {
    console.error(`Assistant intent ${intent.id} failed:`, e);
    throw new AssistantError("I couldn't read that data just now. Try again in a moment.");
  }
}
