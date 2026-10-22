import { NextResponse, type NextRequest } from "next/server";
import { guard } from "../../../_guard";
import { csvExport, csvImport, MAX_CSV_BYTES } from "@/lib/middleware/mapping/listOps";

type Params = { params: Promise<{ kind: string }> };

// GET ?connection= -> the list as CSV (bpm_value,erp_code,inbound).
// POST ?connection=[&confirm=1] multipart "file" (CSV, up to 1 MB / 2000 rows): without confirm -> { preview: { added, changed, removed }, rows };
// with confirm=1 the whole list is replaced by the file -> { preview, applied: true, rows }.
export async function GET(req: NextRequest, ctx: Params) {
  const g = await guard();
  if (!g.ok) return g.res;
  const { kind } = await ctx.params;
  const o = await csvExport(g.ctx, req.nextUrl.searchParams.get("connection"), decodeURIComponent(kind));
  if ("csv" in o) {
    return new NextResponse(o.csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${o.filename}"`, "Cache-Control": "no-store" } });
  }
  return NextResponse.json(o.body, { status: o.status });
}

export async function POST(req: NextRequest, ctx: Params) {
  const g = await guard();
  if (!g.ok) return g.res;
  const { kind } = await ctx.params;
  let text = "";
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose a CSV file." }, { status: 422 });
    if (file.size > MAX_CSV_BYTES) return NextResponse.json({ error: "That file is larger than 1 MB." }, { status: 422 });
    text = await file.text();
  } catch {
    return NextResponse.json({ error: "Send the file as multipart form data." }, { status: 422 });
  }
  const o = await csvImport(g.ctx, req.nextUrl.searchParams.get("connection"), decodeURIComponent(kind), text, req.nextUrl.searchParams.get("confirm") === "1");
  return NextResponse.json(o.body, { status: o.status });
}
