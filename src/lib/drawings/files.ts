// What may be stored in the private `drawing-files` bucket, and how a path is built (docs/design/pcbs-drawing-register.md section 3).
// Pure. The stored type is decided by what the bytes ARE (a sniff of the first bytes), never by the name the browser gave or the
// type it declared: the 2026-07-25 stored-XSS lesson. SVG and HTML are never accepted, whatever they are called.

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
/** Schedules are read in a function, so they stay under the request limit. */
export const MAX_SCHEDULE_BYTES = 4 * 1024 * 1024;

export const DRAWING_FILE_BUCKET = "drawing-files";

type Kind = { ext: string; type: string; sniff: (head: Uint8Array, text: string) => boolean; inline: boolean };

const startsWith = (head: Uint8Array, bytes: number[]) => bytes.every((b, i) => head[i] === b);
const looksText = (head: Uint8Array) => { for (const b of head.subarray(0, 512)) if (b === 0) return false; return true; };

export const ALLOWED: Kind[] = [
  { ext: "pdf", type: "application/pdf", sniff: (h) => startsWith(h, [0x25, 0x50, 0x44, 0x46]), inline: false },
  { ext: "png", type: "image/png", sniff: (h) => startsWith(h, [0x89, 0x50, 0x4e, 0x47]), inline: true },
  { ext: "jpg", type: "image/jpeg", sniff: (h) => startsWith(h, [0xff, 0xd8, 0xff]), inline: true },
  { ext: "jpeg", type: "image/jpeg", sniff: (h) => startsWith(h, [0xff, 0xd8, 0xff]), inline: true },
  { ext: "xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sniff: (h) => startsWith(h, [0x50, 0x4b, 0x03, 0x04]), inline: false },
  { ext: "csv", type: "text/csv", sniff: (h) => looksText(h), inline: false },
  { ext: "dxf", type: "application/dxf", sniff: (h, t) => (looksText(h) && /^\s*0\s*\r?\n\s*SECTION/i.test(t)) || startsWith(h, [0x41, 0x75, 0x74, 0x6f, 0x43, 0x41, 0x44]), inline: false },
  { ext: "dwg", type: "application/acad", sniff: (h, t) => /^AC10\d\d/.test(t), inline: false },
  { ext: "ifc", type: "application/x-step", sniff: (_h, t) => /^ISO-10303-21/.test(t.trimStart()), inline: false },
  // Revit models: kept as a plain attachment, the product never opens them. An OLE compound file.
  { ext: "rvt", type: "application/octet-stream", sniff: (h) => startsWith(h, [0xd0, 0xcf, 0x11, 0xe0]), inline: false },
];

export const ALLOWED_EXTENSIONS = ALLOWED.map((k) => k.ext);
export const ACCEPT_ATTR = ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(",");

export function extensionOf(name: string): string {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
}

/** A file name safe to put in a storage path and a Content-Disposition header: no path parts, no control or odd characters. */
export function safeFileName(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "";
  const cleaned = base.normalize("NFKD").replace(/[^\w.\- ()]+/g, "_").replace(/\s+/g, " ").replace(/^\.+/, "").trim().slice(0, 120);
  return cleaned || "file";
}

/** <tenant_id>/<drawing_id>/<revision_id>/<safe name>: the tenant folder is what the route checks the object against. */
export function filePath(tenantId: string, drawingId: string, revisionId: string, name: string): string {
  return `${tenantId}/${drawingId}/${revisionId}/${safeFileName(name)}`;
}

export function pathBelongsTo(path: string, tenantId: string, drawingId: string, revisionId: string): boolean {
  return path.startsWith(`${tenantId}/${drawingId}/${revisionId}/`) && !path.includes("..");
}

/** A request to upload (before any bytes move): the name's extension and the size. */
export function uploadRequestProblem(name: string, size: number): string | null {
  if (!name.trim()) return "A file name is needed";
  const ext = extensionOf(name);
  if (ext === "svg" || ext === "html" || ext === "htm") return "SVG and HTML files are not accepted";
  if (!ALLOWED_EXTENSIONS.includes(ext)) return `This file type is not accepted. Use ${ALLOWED_EXTENSIONS.map((e) => e.toUpperCase()).join(", ")}`;
  if (!Number.isFinite(size) || size <= 0) return "The file is empty";
  if (size > MAX_FILE_BYTES) return "The file is larger than 50 MB";
  return null;
}

export type Sniffed = { ok: true; ext: string; type: string; inline: boolean } | { ok: false; error: string };

/**
 * What the bytes are. `head` is the first few KB. The extension has to agree with the content (a .pdf that is really HTML is refused),
 * and anything that contains markup that a browser would run is refused even inside an allowed type.
 */
export function sniffFile(name: string, head: Uint8Array): Sniffed {
  const ext = extensionOf(name);
  const kind = ALLOWED.find((k) => k.ext === ext);
  if (!kind) return { ok: false, error: "This file type is not accepted" };
  const text = new TextDecoder("utf-8", { fatal: false }).decode(head.subarray(0, 2048));
  if (/<\s*(svg|html|script|iframe|!doctype\s+html)\b/i.test(text) && (kind.type.startsWith("text/") || kind.ext === "dxf" || kind.ext === "ifc")) {
    return { ok: false, error: "SVG and HTML content is not accepted" };
  }
  if (/^\s*<\s*(\?xml[^>]*>\s*<\s*)?svg\b/i.test(text) || /^\s*<\s*!doctype\s+html/i.test(text)) return { ok: false, error: "SVG and HTML content is not accepted" };
  if (!kind.sniff(head, text)) return { ok: false, error: `The content is not a valid .${ext} file` };
  return { ok: true, ext, type: kind.type, inline: kind.inline };
}

/** Content-Disposition for a signed link: everything is an attachment except the two raster images. */
export function downloadName(name: string): string { return safeFileName(name); }
