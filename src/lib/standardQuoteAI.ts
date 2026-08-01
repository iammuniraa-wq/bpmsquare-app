import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// Three tool-forced Claude calls for Standard Quote's AI features, all
// mirroring the error-handling/tool-use pattern already proven in
// src/lib/import/extract.ts (document extraction) -- same model, same
// most-specific-error-first mapping to a user-facing message.

export class StandardQuoteAIError extends Error {}

function client(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new StandardQuoteAIError("AI drafting isn't configured yet (missing ANTHROPIC_API_KEY).");
  }
  return new Anthropic();
}

async function callTool<T>(toolName: string, tool: Anthropic.Tool, content: string): Promise<T> {
  let response;
  try {
    response = await client().messages.create({
      model: "claude-opus-5",
      max_tokens: 3000,
      tools: [tool],
      tool_choice: { type: "tool", name: toolName },
      messages: [{ role: "user", content }],
    });
  } catch (e) {
    console.error("Standard Quote AI request failed:", e);
    if (e instanceof Anthropic.AuthenticationError) {
      throw new StandardQuoteAIError("The AI service rejected ANTHROPIC_API_KEY. Check it's set correctly and redeploy.");
    }
    if (e instanceof Anthropic.PermissionDeniedError) {
      throw new StandardQuoteAIError("This API key doesn't have access to the AI model.");
    }
    if (e instanceof Anthropic.NotFoundError) {
      throw new StandardQuoteAIError("The AI model isn't available for this account.");
    }
    if (e instanceof Anthropic.RateLimitError) {
      throw new StandardQuoteAIError("The AI service is rate-limited right now. Try again in a moment.");
    }
    if (e instanceof Anthropic.APIConnectionError) {
      throw new StandardQuoteAIError("Could not reach the AI service. Try again in a moment.");
    }
    if (e instanceof Anthropic.APIError) {
      throw new StandardQuoteAIError(`AI service error (${e.status}): ${e.message}`);
    }
    throw new StandardQuoteAIError("AI drafting failed. Try again, or fill this in manually.");
  }

  if (response.stop_reason === "refusal") {
    throw new StandardQuoteAIError("The AI declined this request. Try rephrasing, or fill this in manually.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new StandardQuoteAIError("The response was too long to complete. Try a shorter description.");
  }

  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!toolUse) {
    throw new StandardQuoteAIError("The AI did not return structured data. Try again, or fill this in manually.");
  }
  return toolUse.input as T;
}

// ── Draft line items from a plain-language job description ──────────────

export type DraftedLine = { description: string; uom: string; qty: string };

const DRAFT_LINES_TOOL: Anthropic.Tool = {
  name: "submit_draft_lines",
  description: "Propose quote line items for the described job. Only propose items clearly implied by the description -- do not invent unrelated services, and never invent a price.",
  input_schema: {
    type: "object",
    properties: {
      lines: {
        type: "array",
        items: {
          type: "object",
          properties: {
            description: { type: "string", description: "What this line item is for, concise" },
            uom: { type: "string", description: "Unit of measure, e.g. Nos, Hrs, Sqft, Kg, Ltr, Set, Lot" },
            qty: { type: "string", description: "Quantity as a plain number string, e.g. \"3\"" },
          },
          required: ["description", "uom", "qty"],
          additionalProperties: false,
        },
      },
    },
    required: ["lines"],
    additionalProperties: false,
  },
};

export async function draftStandardQuoteLines(description: string): Promise<DraftedLine[]> {
  const prompt =
    `A salesperson is creating a quote and described the job as:\n\n"${description}"\n\n` +
    "Propose line items for this quote -- description, unit of measure, and quantity only. " +
    "Never propose a price/rate; that is filled in separately by the salesperson. " +
    "Keep it to what's clearly implied -- don't pad the quote with unrelated items.";
  const result = await callTool<{ lines?: DraftedLine[] }>("submit_draft_lines", DRAFT_LINES_TOOL, prompt);
  return Array.isArray(result.lines) ? result.lines.slice(0, 50) : [];
}

// ── Draft a short, personalized intro paragraph for a quote ─────────────

const DRAFT_INTRO_TOOL: Anthropic.Tool = {
  name: "submit_intro",
  description: "Write a short, professional cover paragraph to open a sales quote.",
  input_schema: {
    type: "object",
    properties: {
      intro_text: { type: "string", description: "2-4 sentences, professional tone, no placeholders like [Company Name] -- use the real names given." },
    },
    required: ["intro_text"],
    additionalProperties: false,
  },
};

export async function draftStandardQuoteIntro(input: {
  accountName: string;
  lineDescriptions: string[];
  notes?: string | null;
}): Promise<string> {
  const prompt =
    `Write a short (2-4 sentence) professional intro paragraph for a sales quote.\n\n` +
    `Customer: ${input.accountName}\n` +
    `What's being quoted: ${input.lineDescriptions.join("; ")}\n` +
    (input.notes ? `Additional context: ${input.notes}\n` : "") +
    "\nTone: professional, warm, concise -- not salesy or full of superlatives. " +
    "Reference the customer by name and briefly summarize the value of what's being quoted. " +
    "Do not invent pricing, dates, or promises not implied by the context above.";
  const result = await callTool<{ intro_text?: string }>("submit_intro", DRAFT_INTRO_TOOL, prompt);
  return typeof result.intro_text === "string" ? result.intro_text.trim() : "";
}

// ── Design a template's blocks/accent/logo position from a style brief ──

const DESIGN_TEMPLATE_TOOL: Anthropic.Tool = {
  name: "submit_template_design",
  description: "Configure a Standard Quote print template to match the requested style.",
  input_schema: {
    type: "object",
    properties: {
      accent_color: { type: "string", description: "A hex color, e.g. #1a4fa0, fitting the requested style" },
      logo_position: { type: "string", enum: ["left", "center", "right"] },
      blocks: {
        type: "array",
        description: "Every block in display order. Include all of: letterhead, quote_meta, bill_to, intro_text, line_items, totals, specs_table, notes, terms, signature, cta_banner, footer_text -- reorder and toggle visible to fit the brief. letterhead/quote_meta/bill_to/line_items/totals are always visible regardless of what you set.",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["letterhead", "quote_meta", "bill_to", "intro_text", "line_items", "totals", "notes", "terms", "signature", "footer_text", "specs_table", "cta_banner"],
            },
            visible: { type: "boolean" },
            content: { type: "string", description: "Only for intro_text (a short generic cover note), footer_text (a short closing line), or specs_table (\"Label: Value\" one per line) -- omit for other types" },
          },
          required: ["type", "visible"],
          additionalProperties: false,
        },
      },
    },
    required: ["accent_color", "logo_position", "blocks"],
    additionalProperties: false,
  },
};

export type DesignedTemplate = {
  accent_color?: string;
  logo_position?: string;
  blocks?: { type: string; visible: boolean; content?: string }[];
};

export async function designStandardQuoteTemplate(description: string): Promise<DesignedTemplate> {
  const prompt =
    `Design a Standard Quote print template for this brief:\n\n"${description}"\n\n` +
    "Choose an accent color, logo position, and which optional blocks to show/hide and in what order, " +
    "to best match the brief. Write generic placeholder-free content for any text blocks you enable " +
    "(e.g. a generic intro sentence, not one naming a specific customer since this template will be reused).";
  return callTool<DesignedTemplate>("submit_template_design", DESIGN_TEMPLATE_TOOL, prompt);
}
