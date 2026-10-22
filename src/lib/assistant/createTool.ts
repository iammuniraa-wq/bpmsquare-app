import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CreateActionDef } from "@/lib/actions/registry";
import { buildCard, loadSpec } from "@/lib/actions/card";
import type { ConfirmCard } from "./cards";
import { promptText } from "./promptSafe";

// The assistant's one way to propose a create: it can only ever produce a CARD. The tool result tells the model that
// nothing exists yet; the record appears only when the person presses the card's button (POST /api/ai/act).

export function createRecordTool(actions: CreateActionDef[]): Anthropic.Tool {
  return {
    name: "create_record",
    description:
      "Show the person a card to create ONE record. Use it only when they ask you to create or add something. " +
      "It creates nothing: they check the fields and press the button on the card. " +
      "Put in `values` only what the person told you or what is on the screen they have open; leave every other field out, never guess one. " +
      "Use the field keys from CREATABLE in your instructions. Name a record the new one belongs to in `references`.",
    input_schema: {
      type: "object",
      properties: {
        object: { type: "string", enum: actions.map((a) => a.object) },
        summary: { type: "string", description: "One sentence, in your own words, saying what you are about to create and for whom." },
        values: { type: "object", additionalProperties: { type: "string" }, description: "Field key to value, as plain text." },
        references: { type: "object", additionalProperties: { type: "string" }, description: "Records this one belongs to, by name, e.g. {\"account\": \"Tesla Germany\"}." },
      },
      required: ["object", "summary", "values"],
    },
  };
}

/** The CREATABLE block of the stable prompt: per object, its fields as the workspace has them right now. */
export async function createCatalog(supabase: SupabaseClient, tenantId: string, actions: CreateActionDef[]): Promise<string> {
  const blocks = await Promise.all(actions.map(async (a) => {
    const spec = await loadSpec(supabase, tenantId, a);
    const fields = spec.fields
      .filter((f) => f.kind !== "ref")
      .map((f) => `${f.key}${f.baseRequired ? "*" : ""} (${promptText(f.label, 60)}${f.options?.length ? `: ${f.options.map((o) => promptText(o.value, 40)).join("|")}` : ""})`)
      .join(", ");
    const refs = a.refs.map((r) => `${r.param}${r.required ? "*" : ""} (name of the ${r.label.toLowerCase()})`).join(", ");
    return `- ${a.object}: fields: ${fields}${refs ? `\n  references: ${refs}` : ""}`;
  }));
  return "CREATABLE objects for create_record (* = required; use these keys exactly):\n" + blocks.join("\n");
}

export type CreateToolInput = { object?: string; summary?: string; values?: unknown; references?: unknown };

const asStrings = (v: unknown): Record<string, string> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => typeof x === "string").map(([k, x]) => [k, x as string]))
    : {};

export async function runCreateRecord(
  input: CreateToolInput,
  ctx: { supabase: SupabaseClient; tenantId: string; userId: string; actions: CreateActionDef[]; pageAccountId?: string | null },
): Promise<{ out: string; card?: ConfirmCard }> {
  const def = ctx.actions.find((a) => a.object === input.object);
  if (!def) return { out: `Error: you cannot create "${input.object ?? ""}" for this person.` };
  const built = await buildCard(
    { supabase: ctx.supabase, tenantId: ctx.tenantId, userId: ctx.userId },
    def,
    {
      values: asStrings(input.values),
      references: asStrings(input.references),
      summary: (input.summary ?? "").trim() || `Create a ${def.noun}.`,
      pageAccountId: ctx.pageAccountId,
    },
  );
  if (!built.ok) return { out: built.reason };
  const { card, ignored } = built;
  const notes = [
    "Card shown. NOTHING is created yet: the person must press the button on the card, so never say it was created.",
    card.duplicates.length ? `Similar records already exist: ${card.duplicates.map((d) => d.label).join("; ")}. Mention this in one short clause.` : "",
    card.notices.length ? `Notes: ${card.notices.join(" ")}` : "",
    ignored.length ? `Ignored (not fields of this object): ${ignored.join(", ")}.` : "",
    "Reply with one short line.",
  ].filter(Boolean);
  return { out: notes.join(" "), card };
}
