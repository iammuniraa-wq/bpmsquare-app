// One attachment's bytes -> what the model is shown. PDFs and photos go through as document and image blocks (the model
// reads text, tables and drawn or scanned plans); Word becomes text with mammoth; Excel becomes rows of text with exceljs.
// Everything here is a third party's file: it is wrapped in <file> tags the prompt calls DATA, and a file that cannot be
// read returns a note instead of throwing, so one bad file never fails the call.

import type Anthropic from "@anthropic-ai/sdk";
import { INTAKE_LIMITS, type FileKind } from "./kinds";
import { countPdfPages, isEncryptedPdf, looksLikePdf } from "./pdf";

export type AskBlock = Anthropic.ContentBlockParam;

/** A file that was read: the name the model sees, what kind it is, its text (Word and Excel) and the blocks to send. */
export type ReadFile = {
  /** The attachment this came from (used for the "Open page" link). */
  id: string;
  /** The name shown to the model and in the review: cleaned, unique within one call. */
  name: string;
  kind: "pdf" | "image" | "docx" | "xlsx";
  /** Word and Excel only: the extracted text a quoted source is checked against. */
  text: string | null;
  pages: number | null;
  bytes: number;
  blocks: AskBlock[];
};

export type Converted = { ok: true; file: Omit<ReadFile, "id" | "name"> } | { ok: false; note: string };

/** A name safe to put inside a tag and a sentence: no markup, quotes or control characters, 80 characters at most. */
export function cleanName(raw: string): string {
  const s = raw.replace(/[\u0000-\u001f<>"'`\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return s || "file";
}

const asString = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as { result?: unknown; text?: unknown; richText?: { text: string }[]; hyperlink?: unknown };
    if (o.result !== undefined) return asString(o.result);
    if (Array.isArray(o.richText)) return o.richText.map((r) => r.text).join("").trim();
    if (typeof o.text === "string") return o.text.trim();
    return "";
  }
  return String(v).trim();
};

/** Rows of an Excel file as text: up to 5 sheets and 200 rows each, empty rows skipped, cells joined with " | ". */
export async function xlsxToText(bytes: Uint8Array): Promise<string> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  const parts: string[] = [];
  for (const ws of wb.worksheets.slice(0, INTAKE_LIMITS.maxSheets)) {
    const rows: string[] = [];
    let seen = 0;
    ws.eachRow({ includeEmpty: false }, (row) => {
      if (seen >= INTAKE_LIMITS.maxRowsPerSheet) return;
      const cells: string[] = [];
      for (let c = 1; c <= row.cellCount; c++) cells.push(asString(row.getCell(c).value));
      while (cells.length && cells[cells.length - 1] === "") cells.pop();
      if (cells.length === 0) return;
      seen++;
      rows.push(cells.join(" | "));
    });
    if (rows.length) parts.push(`Sheet "${ws.name}":\n${rows.join("\n")}`);
  }
  return parts.join("\n\n");
}

export async function docxToText(bytes: Uint8Array): Promise<string> {
  const mammoth = await import("mammoth");
  const r = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  return r.value.replace(/\n{3,}/g, "\n\n").trim();
}

const isZip = (b: Uint8Array) => b.length > 3 && b[0] === 0x50 && b[1] === 0x4b;
const isPng = (b: Uint8Array) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isJpeg = (b: Uint8Array) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

const b64 = (b: Uint8Array) => Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString("base64");
const tagged = (name: string, body: string) => `<file name="${name}">\n${body}\n</file>`;

/** Turn one file's bytes into blocks for the model, or say why it cannot be read. Never throws. */
export async function convertFile(name: string, kind: FileKind, bytes: Uint8Array): Promise<Converted> {
  try {
    if (bytes.byteLength === 0) return { ok: false, note: "The file is empty." };
    if (kind === "pdf") {
      if (!looksLikePdf(bytes)) return { ok: false, note: "This is not a readable PDF." };
      if (isEncryptedPdf(bytes)) return { ok: false, note: "The PDF is password protected." };
      const pages = countPdfPages(bytes);
      if (pages > INTAKE_LIMITS.maxPdfPages) return { ok: false, note: `The PDF has ${pages} pages (limit ${INTAKE_LIMITS.maxPdfPages}). Send the pages that matter.` };
      if (pages === 0 && bytes.byteLength > INTAKE_LIMITS.maxPdfBytesUnknownPages) return { ok: false, note: "The PDF is too large to read (limit 8 MB when its pages cannot be counted)." };
      return {
        ok: true,
        file: {
          kind: "pdf", text: null, pages: pages || null, bytes: bytes.byteLength,
          blocks: [
            { type: "text", text: `File "${name}" (PDF${pages ? `, ${pages} page${pages === 1 ? "" : "s"}` : ""}) follows as a document. Page numbers start at 1.` },
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64(bytes) }, title: name },
          ],
        },
      };
    }
    if (kind === "image") {
      const png = isPng(bytes);
      if (!png && !isJpeg(bytes)) return { ok: false, note: "This is not a readable PNG or JPG photo." };
      if (bytes.byteLength > INTAKE_LIMITS.maxImageBytes) return { ok: false, note: "The photo is larger than 5 MB." };
      return {
        ok: true,
        file: {
          kind: "image", text: null, pages: null, bytes: bytes.byteLength,
          blocks: [
            { type: "text", text: `File "${name}" (photo) follows as an image.` },
            { type: "image", source: { type: "base64", media_type: png ? "image/png" : "image/jpeg", data: b64(bytes) } },
          ],
        },
      };
    }
    if (kind === "docx" || kind === "xlsx") {
      if (!isZip(bytes)) return { ok: false, note: `This is not a readable ${kind === "docx" ? "Word" : "Excel"} file.` };
      const raw = kind === "docx" ? await docxToText(bytes) : await xlsxToText(bytes);
      const text = raw.slice(0, INTAKE_LIMITS.maxTextChars);
      if (!text.trim()) return { ok: false, note: kind === "docx" ? "The Word file has no text." : "The Excel file has no rows with values." };
      return { ok: true, file: { kind, text, pages: null, bytes: bytes.byteLength, blocks: [{ type: "text", text: tagged(name, text) }] } };
    }
    return { ok: false, note: "This kind of file is not read here." };
  } catch {
    return { ok: false, note: "The file could not be opened. It may be damaged or password protected." };
  }
}
