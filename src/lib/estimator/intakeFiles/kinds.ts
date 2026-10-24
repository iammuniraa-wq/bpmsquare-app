// Which attachments "Read the email" can read, and the caps it holds them to (docs/design/drawing-intake.md part 1).
// Pure: no I/O, no SDK. The browser imports the limits to word the info tip; the server enforces them.

export type FileKind = "pdf" | "image" | "docx" | "xlsx" | "dxf" | "other";

export const INTAKE_LIMITS = {
  maxFiles: 6,
  maxTotalBytes: 10 * 1024 * 1024,
  /** PDFs longer than this are refused by name. */
  maxPdfPages: 20,
  /** When the page count cannot be read from the bytes, the size is the cap. */
  maxPdfBytesUnknownPages: 8 * 1024 * 1024,
  /** The model service takes images up to 5 MB each. */
  maxImageBytes: 5 * 1024 * 1024,
  maxSheets: 5,
  maxRowsPerSheet: 200,
  maxTextChars: 60_000,
} as const;

export const LIMITS_TEXT = `Up to ${INTAKE_LIMITS.maxFiles} files, ${INTAKE_LIMITS.maxTotalBytes / 1024 / 1024} MB in all, PDFs up to ${INTAKE_LIMITS.maxPdfPages} pages. PDF, Word, Excel, PNG and JPG are read; DXF drawings go to the drawing reader.`;

/** The reason load.ts gives a DXF: the route hands those to the drawing reader instead. */
export const DXF_SKIP_REASON = "DXF files are read by the drawing reader.";

export const KIND_LABEL: Record<FileKind, string> = { pdf: "PDF", image: "Photo", docx: "Word", xlsx: "Excel", dxf: "DXF", other: "File" };

const cleanExt = (ext: string | null | undefined, name: string): string => {
  const e = (ext ?? "").trim().toLowerCase().replace(/^\./, "");
  if (e) return e;
  const m = /\.([a-z0-9]{1,6})$/i.exec(name);
  return m ? m[1].toLowerCase() : "";
};

export function classifyFile(name: string, mime: string | null | undefined, ext?: string | null): FileKind {
  const e = cleanExt(ext, name);
  const m = (mime ?? "").toLowerCase();
  if (e === "pdf" || m === "application/pdf") return "pdf";
  if (e === "png" || e === "jpg" || e === "jpeg" || m === "image/png" || m === "image/jpeg") return "image";
  if (e === "docx" || m === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (e === "xlsx" || m === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return "xlsx";
  if (e === "dxf") return "dxf";
  return "other";
}

/** Why a file will not be read, judged from its row alone (before any download), or null when it can be tried. */
export function skipReason(kind: FileKind, sizeBytes: number, ext?: string | null, name = ""): string | null {
  if (kind === "dxf") return DXF_SKIP_REASON;
  if (kind === "other") {
    const e = cleanExt(ext, name);
    if (e === "dwg") return "DWG files are not read. Save the drawing as DXF.";
    return `${e ? `.${e}` : "This kind of"} file is not read here. PDF, Word, Excel, PNG and JPG are.`;
  }
  if (kind === "image" && sizeBytes > INTAKE_LIMITS.maxImageBytes) return "The photo is larger than 5 MB.";
  if (sizeBytes > INTAKE_LIMITS.maxTotalBytes) return "The file is larger than 10 MB.";
  return null;
}
