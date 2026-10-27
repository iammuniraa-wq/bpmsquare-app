import "server-only";
import type { NextRequest } from "next/server";
import { BOQ_LIMITS, parseColumnMap } from "./parse";
import type { Failure, UploadInput } from "./server";

/** The multipart body of the preview and upload routes: the file, and what the person chose in the mapping panel (all optional, all checked). */
export async function readUploadForm(request: NextRequest): Promise<{ ok: true; input: UploadInput } | ({ ok: false } & Failure)> {
  let form: FormData;
  try { form = await request.formData(); } catch { return { ok: false, status: 400, error: "Send the file as a form upload" }; }
  const file = form.get("file");
  if (!(file instanceof File)) return { ok: false, status: 400, error: "Choose an Excel file" };
  if (file.size > BOQ_LIMITS.maxFileBytes) return { ok: false, status: 413, error: "The file is larger than 15 MB" };
  const sheet = form.get("sheet");
  const headerRow = Number(form.get("header_row"));
  let map = null;
  const rawMap = form.get("map");
  if (typeof rawMap === "string" && rawMap.trim()) {
    let parsed: unknown = null;
    try { parsed = JSON.parse(rawMap); } catch { /* falls to the error below */ }
    map = parseColumnMap(parsed);
    if (!map) return { ok: false, status: 422, error: "The column choice needs a Description and a Quantity column, each on its own column" };
  }
  return {
    ok: true,
    input: {
      bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name || "boq.xlsx",
      sheet: typeof sheet === "string" && sheet ? sheet.slice(0, 120) : null,
      headerRow: Number.isInteger(headerRow) && headerRow >= 1 && headerRow <= BOQ_LIMITS.maxRows ? headerRow : null,
      map,
    },
  };
}
