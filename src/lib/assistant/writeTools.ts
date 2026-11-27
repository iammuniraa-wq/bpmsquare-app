import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { availableUpdates, availableVerbs, type UpdateActionDef, type VerbActionDef } from "@/lib/actions/registry";
import { loadSpec } from "@/lib/actions/card";
import { buildUpdateCard } from "@/lib/actions/update";
import { buildVerbCard, type VerbInput } from "@/lib/actions/verbs";
import type { PermissionSet } from "@/lib/permissions";
import type { ConfirmCard } from "./cards";
import type { AssistantObjectType } from "./objects";
import { promptText } from "./promptSafe";

// The assistant's two write-shaped tools beyond create_record, both of which can only ever produce a CARD:
//   change_record  plain fields of ONE existing record, shown as before and after (docs/design/assistant-actions.md step 3)
//   tender_action  one step on a tender deal: a bid decision, a bid version, an RFQ, an estimate, a product match, price all (step 4)
// Neither takes a tenant, a user or an id from the model: the record is named (a reference or an exact name) and the server
// resolves it inside the caller's workspace, asking the person when it is not exactly one. Nothing is changed until the person
// presses the card (POST /api/ai/act). Both tools are in WEB_LOCKED_TOOLS (ai/assistant.ts): once web text is in the context, neither is offered.

export const CHANGE_TOOL_NAME = "change_record";
export const TENDER_TOOL_NAME = "tender_action";
/** Every tool this file defines; the assistant adds them to the tools a web-derived turn may not call. */
export const WRITE_TOOL_NAMES: readonly string[] = [CHANGE_TOOL_NAME, TENDER_TOOL_NAME];

export type PageRef = { type: AssistantObjectType; id: string } | null;

export type Writer = {
  tools: Anthropic.Tool[];
  /** The CHANGEABLE / TENDER STEPS blocks of the stable prompt. */
  catalog: string;
  has: (toolName: string) => boolean;
  /** `final`: words the person gets as they are, so that nothing is added to them. */
  run: (toolName: string, input: unknown, page: PageRef) => Promise<{ out: string; card?: ConfirmCard; final?: string }>;
};

export function changeRecordTool(updates: UpdateActionDef[]): Anthropic.Tool {
  return {
    name: CHANGE_TOOL_NAME,
    description:
      "Show the person a card that changes plain fields of ONE existing record, with what it holds now and what it will hold. Use it only when they ask you to change, update, correct or set something on a record. " +
      "It changes nothing: they check the card and press the button. " +
      "Name the record in `record` by its reference (ACC-0001, SUP-0003, OPP-0034), SKU, tender number or exact name; leave `record` out only when the person has that record open. " +
      "Put in `values` only what the person told you, using the field keys from CHANGEABLE; never guess a value, and a field cannot be emptied from here.",
    input_schema: {
      type: "object",
      properties: {
        object: { type: "string", enum: updates.map((u) => u.object) },
        record: { type: "string", description: "The record: its reference, SKU, tender number or exact name." },
        summary: { type: "string", description: "One sentence, in your own words, saying what you are about to change and on which record." },
        values: { type: "object", additionalProperties: { type: "string" }, description: "Field key to its new value, as plain text." },
      },
      required: ["object", "summary", "values"],
    },
  };
}

export function tenderActionTool(verbs: VerbActionDef[]): Anthropic.Tool {
  return {
    name: TENDER_TOOL_NAME,
    description:
      "Show the person a card for ONE step on a tender deal. It does nothing yet: the card lists the facts and any check that is not a pass, and the person presses its button. " +
      "Use it only when they ask for that step. Name the deal in `deal` by its reference, tender number or exact name; leave it out only when they have that deal open. " +
      "Put in only what the person told you; use the inputs listed under TENDER STEPS in your instructions.",
    input_schema: {
      type: "object",
      properties: {
        verb: { type: "string", enum: verbs.map((v) => v.verb) },
        deal: { type: "string", description: "The tender deal: its reference, tender number or exact name." },
        summary: { type: "string", description: "One sentence, in your own words, saying which step you are about to take and on which deal." },
        decision: { type: "string", enum: ["go", "no_go"], description: "decision step: go or no_go." },
        reason: { type: "string", description: "decision step: the person's reason, in their words." },
        revision_reason: { type: "string", description: "submit_bid step: why the bid is revised (from the second version)." },
        note: { type: "string", description: "submit_bid step: an optional note." },
        suppliers: { type: "array", items: { type: "string" }, description: "rfq step: supplier names or references." },
        lines: { type: "string", description: "rfq step: only when the person named particular lines, their own words for them, e.g. \"geotextile\". Leave it out for every line without a price." },
        title: { type: "string", description: "rfq step: an optional title." },
        respond_by: { type: "string", description: "rfq step: the date suppliers reply by, yyyy-mm-dd." },
        template: { type: "string", description: "estimate step: the estimate template's name." },
        name: { type: "string", description: "estimate step: an optional name for the estimate." },
        inputs: { type: "object", additionalProperties: { type: "string" }, description: "estimate step: the template's own inputs by label, e.g. {\"Wall height\": \"3.2\"}." },
        margin_pct: { type: "string", description: "estimate step: the margin percent." },
        markup_pct: { type: "string", description: "price step: the markup percent on cost." },
      },
      required: ["verb", "summary"],
    },
  };
}

const KEY_HINT: Record<string, string> = {
  account: "its ACC- reference or exact name",
  contact: "its CON- reference or exact name",
  supplier: "its SUP- reference or exact name",
  product: "its PRD- reference, SKU or exact name",
  tender: "its OPP- reference, tender number or exact name",
};

/** The CHANGEABLE block: per object, the fields a change may set, as the workspace has them right now. */
export async function changeCatalog(supabase: SupabaseClient, tenantId: string, updates: UpdateActionDef[]): Promise<string> {
  const blocks = await Promise.all(updates.map(async (u) => {
    const spec = await loadSpec(supabase, tenantId, u);
    const fields = spec.fields
      .map((f) => `${f.key} (${promptText(f.label, 60)}${f.widget === "date" ? ", yyyy-mm-dd" : ""}${f.options?.length ? `: ${f.options.map((o) => promptText(o.value, 40)).join("|")}` : ""})`)
      .join(", ");
    return `- ${u.object}: fields: ${fields}\n  record: ${KEY_HINT[u.object] ?? "its reference or exact name"}`;
  }));
  return "CHANGEABLE objects for change_record (use these keys exactly; a value cannot be emptied from here):\n" + blocks.join("\n");
}

const STEP_LINE: Record<VerbActionDef["verb"], string> = {
  decision: "decision: propose go or no-go on the bid. Inputs: decision (go|no_go), reason (the person's own words; leave it out if they gave none)",
  submit_bid: "submit_bid: submit the bid as the next version. Inputs: revision_reason (from version 2), note",
  rfq: "rfq: a draft RFQ from the lines that have no price. Inputs: suppliers (their names), lines (only when the person named particular lines)",
  estimate: "estimate: an estimate on the tender from a named template. Inputs: template, inputs ({input label: value}), name, margin_pct",
  match: "match: link the strong catalog matches on the BOQ. No inputs",
  price: "price: price the BOQ lines that have no price. Inputs: markup_pct",
};

export function tenderCatalog(verbs: VerbActionDef[]): string {
  return "TENDER STEPS for tender_action (each only shows a card; the person presses it):\n" +
    verbs.map((v) => `- ${STEP_LINE[v.verb]}`).join("\n") +
    "\n  Every step takes deal: its OPP- reference, tender number or exact name (leave it out when the person has that deal open).";
}

const asStrings = (v: unknown): Record<string, string> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => typeof x === "string" || typeof x === "number").map(([k, x]) => [k, String(x)]))
    : {};

const cleanInput = (input: unknown): Record<string, unknown> => (input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {});

export type WriterCtx = {
  supabase: SupabaseClient;
  tenantId: string;
  userId?: string;
  perms: PermissionSet;
  features: Record<string, boolean | undefined>;
  isWorkspaceAdmin: boolean;
};

/** The write tools this caller has right now, or null: no person to bind a card to, no flag, no module, or no edit grant. */
export async function makeWriter(ctx: WriterCtx): Promise<Writer | null> {
  if (!ctx.userId) return null;
  const userId = ctx.userId;
  const gate = { features: ctx.features, perms: ctx.perms };
  const updates = availableUpdates(gate);
  const verbs = availableVerbs(gate);
  if (updates.length === 0 && verbs.length === 0) return null;

  const blocks: string[] = [];
  if (updates.length) blocks.push(await changeCatalog(ctx.supabase, ctx.tenantId, updates));
  if (verbs.length) blocks.push(tenderCatalog(verbs));
  const tools: Anthropic.Tool[] = [];
  if (updates.length) tools.push(changeRecordTool(updates));
  if (verbs.length) tools.push(tenderActionTool(verbs));

  const pageOf = (page: PageRef, type: AssistantObjectType) => (page && page.type === type ? page.id : null);

  return {
    tools, catalog: blocks.join("\n\n"),
    has: (name) => (name === CHANGE_TOOL_NAME && updates.length > 0) || (name === TENDER_TOOL_NAME && verbs.length > 0),
    run: async (name, rawInput, page) => {
      const input = cleanInput(rawInput);
      if (name === CHANGE_TOOL_NAME) {
        const def = updates.find((u) => u.object === input.object);
        if (!def) return { out: `Error: you cannot change "${promptText(input.object, 40)}" for this person.` };
        const built = await buildUpdateCard(
          { supabase: ctx.supabase, tenantId: ctx.tenantId, userId }, def,
          {
            record: typeof input.record === "string" ? input.record : undefined, values: asStrings(input.values),
            summary: (typeof input.summary === "string" ? input.summary : "").trim() || `Change a ${def.noun}.`,
            pageRecordId: pageOf(page, def.base ?? (def.object as AssistantObjectType)),
          },
        );
        if (!built.ok) return { out: built.reason };
        const { card, ignored } = built;
        return {
          card,
          out: [
            "Card shown. NOTHING has been changed yet: the person must press Save changes on the card, so never say it was saved.",
            card.notices.length ? `Notes: ${card.notices.map((n) => promptText(n, 200)).join(" ")}` : "",
            ignored.length ? `Ignored (not changeable fields): ${ignored.map((k) => promptText(k, 40)).join(", ")}.` : "",
            "Reply with one short line.",
          ].filter(Boolean).join(" "),
        };
      }
      if (name === TENDER_TOOL_NAME) {
        const def = typeof input.verb === "string" ? verbs.find((v) => v.verb === input.verb) : undefined;
        if (!def) return { out: `Error: you cannot do the step "${promptText(input.verb, 40)}" for this person.` };
        const built = await buildVerbCard(
          { supabase: ctx.supabase, tenantId: ctx.tenantId, userId, perms: ctx.perms, isWorkspaceAdmin: ctx.isWorkspaceAdmin, pageRecordId: pageOf(page, "opportunity") },
          def,
          {
            ...(input as VerbInput), inputs: asStrings(input.inputs), suppliers: Array.isArray(input.suppliers) ? input.suppliers : [],
            summary: typeof input.summary === "string" ? input.summary : undefined,
          },
        );
        if (!built.ok) return { out: built.reason, final: built.final ? built.say : undefined };
        const { card } = built;
        return {
          card,
          out: [
            `Card shown. NOTHING has been done yet: the person must press ${card.primaryLabel} on the card, so never say it was done.`,
            card.checks?.length ? `Checks on the card that are not a pass (mention them in one short clause): ${card.checks.map((c) => promptText(c, 200)).join(" ")}` : "",
            card.notices.length ? `Notes: ${card.notices.map((n) => promptText(n, 200)).join(" ")}` : "",
            "Reply with one short line.",
          ].filter(Boolean).join(" "),
        };
      }
      return { out: `Error: unknown tool "${name}".` };
    },
  };
}
