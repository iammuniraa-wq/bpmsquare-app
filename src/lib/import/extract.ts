import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { ExtractionInput } from "./parseServer";
import type { ExtractedRow, ExtractionResponse, FieldSpec, ObjectSpec } from "./types";

export class ExtractionError extends Error {}

type JsonSchemaProps = Record<string, { type: "string"; description: string }>;

function propsFor(fields: FieldSpec[]): { props: JsonSchemaProps; required: string[] } {
  const props: JsonSchemaProps = {};
  const required: string[] = [];
  for (const f of fields) {
    props[f.key] = { type: "string", description: f.hint || f.label };
    if (f.required) required.push(f.key);
  }
  return { props, required };
}

/**
 * Builds the tool-forced extraction schema from the tenant's live ObjectSpec
 * (the same shape the Data Workbench column mapper already understands), so
 * an extraction never asks for a field this tenant doesn't have and never
 * hallucinates one it does. Quote-shaped objects (a grouping key + line
 * items) get a "groups" schema; everything else gets a flat "rows" schema.
 *
 * Deliberately not `strict: true` -- a tenant with many custom fields (or a
 * quote's header+line nesting) pushes the compiled schema over the API's
 * strict-mode complexity limit ("Schema is too complex", a 400). Ordinary
 * tool use has no such ceiling, and every row still gets re-validated by
 * validateRow/validateQuoteRows downstream regardless.
 */
function buildTool(spec: ObjectSpec) {
  const lineFields = spec.fields.filter((f) => f.scope === "line" && !f.exportOnly);
  const headerFields = spec.fields.filter((f) => f.scope !== "line" && !f.exportOnly);
  const { props: headerProps, required: headerRequired } = propsFor(headerFields);
  headerProps.note = {
    type: "string",
    description: "Anything uncertain about this record that a human should double-check before importing -- omit if there's nothing to flag.",
  };

  if (lineFields.length === 0) {
    return {
      name: "submit_extraction",
      description: `Extract every genuine ${spec.label.toLowerCase()} record from the document into BPMSquare's import shape. Ignore narrative text, boilerplate, and anything that isn't an actual data record.`,
      input_schema: {
        type: "object" as const,
        properties: {
          rows: { type: "array" as const, items: { type: "object" as const, properties: headerProps, required: headerRequired, additionalProperties: false } },
          document_notes: { type: "array" as const, items: { type: "string" as const } },
        },
        required: ["rows", "document_notes"],
        additionalProperties: false,
      },
    };
  }

  const { props: lineProps, required: lineRequired } = propsFor(lineFields);
  lineProps.note = {
    type: "string",
    description: "Why this line is uncertain -- e.g. an ambiguous serial marker, or a total that doesn't match qty x rate -- omit if there's nothing to flag.",
  };

  return {
    name: "submit_extraction",
    description: `Extract every genuine ${spec.label.toLowerCase()} group (header + its priced line items) from the document into BPMSquare's import shape. Ignore boilerplate, scope-of-work prose, terms and general instructions, section dividers, and computed subtotal/total rows -- only rows that are real, individually priced line items belong in "lines".`,
    input_schema: {
      type: "object" as const,
      properties: {
        groups: {
          type: "array" as const,
          items: {
            type: "object" as const,
            properties: {
              header: { type: "object" as const, properties: headerProps, required: headerRequired, additionalProperties: false },
              lines: { type: "array" as const, items: { type: "object" as const, properties: lineProps, required: lineRequired, additionalProperties: false } },
            },
            required: ["header", "lines"],
            additionalProperties: false,
          },
        },
        document_notes: { type: "array" as const, items: { type: "string" as const } },
      },
      required: ["groups", "document_notes"],
      additionalProperties: false,
    },
  };
}

function stringify(rec: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec)) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s !== "") out[k] = s;
  }
  return out;
}

function toRows(spec: ObjectSpec, input: Record<string, unknown>): ExtractionResponse {
  const documentNotes = Array.isArray(input.document_notes)
    ? input.document_notes.filter((n): n is string => typeof n === "string")
    : [];
  const hasLines = spec.fields.some((f) => f.scope === "line");
  const rows: ExtractedRow[] = [];
  let rowNum = 1;

  if (!hasLines) {
    const rawRows = Array.isArray(input.rows) ? (input.rows as Record<string, unknown>[]) : [];
    for (const r of rawRows) {
      const { note, ...rest } = r;
      rows.push({ rowNum: rowNum++, values: stringify(rest), note: typeof note === "string" ? note : undefined });
    }
    return { rows, documentNotes };
  }

  const groups = Array.isArray(input.groups) ? (input.groups as Record<string, unknown>[]) : [];
  for (const g of groups) {
    const header = (g.header ?? {}) as Record<string, unknown>;
    const { note: headerNote, ...headerRest } = header;
    const headerValues = stringify(headerRest);
    const lines = Array.isArray(g.lines) ? (g.lines as Record<string, unknown>[]) : [];

    if (lines.length === 0) {
      rows.push({ rowNum: rowNum++, values: headerValues, note: typeof headerNote === "string" ? headerNote : undefined });
      continue;
    }

    lines.forEach((l, i) => {
      const { note: lineNote, ...lineRest } = l;
      const note = [i === 0 && typeof headerNote === "string" ? headerNote : "", typeof lineNote === "string" ? lineNote : ""]
        .filter(Boolean)
        .join(" — ");
      rows.push({
        rowNum: rowNum++,
        values: { ...headerValues, ...stringify(lineRest) },
        note: note || undefined,
      });
    });
  }

  return { rows, documentNotes };
}

const INSTRUCTIONS =
  "Extract only genuine data records -- ignore narrative text, boilerplate scope-of-work/terms/instructions paragraphs, section headers, and computed subtotal/total rows. " +
  "Never invent a value that isn't in the document; leave a field blank rather than guessing. " +
  "If something is ambiguous (an unclear label, a total that doesn't match its inputs, a name spelled inconsistently across the document), extract your best reading and add a short note explaining the ambiguity rather than silently picking one.";

function buildContent(input: ExtractionInput, spec: ObjectSpec, fileName: string): Anthropic.MessageParam["content"] {
  const intro = `The following is "${fileName}", a real customer document (a quote letter, invoice, spreadsheet, etc.) that needs to become ${spec.label} records in a CRM.\n\n${INSTRUCTIONS}`;

  if (input.kind === "pdf") {
    // Document block goes before the text per Claude's PDF support -- Claude
    // reads it natively (text + layout), no separate OCR step to run first.
    return [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: input.base64 } },
      { type: "text", text: intro },
    ];
  }

  return `${intro}\n\n--- DOCUMENT DUMP ---\n${input.text}`;
}

/**
 * Turns a raw document dump (see parseServer.ts) into rows shaped exactly
 * like a Data Workbench import file -- keyed by the same field keys
 * ColumnMapper/validateRow already understand, so the result can go straight
 * into the existing review-and-import pipeline with no separate commit path.
 */
export async function extractRowsFromDocument(spec: ObjectSpec, input: ExtractionInput, fileName: string): Promise<ExtractionResponse> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ExtractionError("Document extraction isn't configured yet (missing ANTHROPIC_API_KEY).");
  }

  const tool = buildTool(spec);
  const client = new Anthropic();

  let response;
  try {
    response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 8000,
      tools: [tool],
      tool_choice: { type: "tool", name: "submit_extraction" },
      messages: [{ role: "user", content: buildContent(input, spec, fileName) }],
    });
  } catch (e) {
    console.error("Document extraction request failed:", e);
    // Most-specific first -- a bare network failure and "the key is wrong"
    // need different fixes, and burying both under one message makes this
    // undebuggable from the outside.
    if (e instanceof Anthropic.AuthenticationError) {
      throw new ExtractionError("The extraction service rejected ANTHROPIC_API_KEY. Check it's set correctly (no extra spaces/newlines) and redeploy.");
    }
    if (e instanceof Anthropic.PermissionDeniedError) {
      throw new ExtractionError("This API key doesn't have access to the extraction model. Check the key's plan/permissions in the Anthropic console.");
    }
    if (e instanceof Anthropic.NotFoundError) {
      throw new ExtractionError("The extraction model isn't available for this account.");
    }
    if (e instanceof Anthropic.RateLimitError) {
      throw new ExtractionError("The extraction service is rate-limited right now. Try again in a moment.");
    }
    if (e instanceof Anthropic.APIConnectionError) {
      throw new ExtractionError("Could not reach the extraction service. Try again in a moment.");
    }
    if (e instanceof Anthropic.APIError) {
      throw new ExtractionError(`Extraction service error (${e.status}): ${e.message}`);
    }
    throw new ExtractionError("Extraction failed. Try again, or enter this record manually.");
  }

  if (response.stop_reason === "refusal") {
    throw new ExtractionError("The extraction request was declined. Try a different file, or enter this record manually.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new ExtractionError("This document is too large or complex to extract in one pass. Try splitting it into smaller files.");
  }

  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!toolUse) {
    throw new ExtractionError("The extraction did not return structured data. Try again, or enter this record manually.");
  }

  return toRows(spec, toolUse.input as Record<string, unknown>);
}
