import { NextResponse, type NextRequest } from "next/server";
import { exportAnswerSheet, exportPriced, openBoqRequest } from "@/lib/tender/boq/server";

// GET /api/opportunities/[id]/boq/export?kind=priced|answer[&wbs=1]
//   priced  the client's own workbook with our unit rate and amount written into it (their layout, formats and other sheets kept);
//           wbs=1 adds one last column "WBS" with each row's WBS item (a split line reads `2.1 60 % · 2.2 15 % · 2.3 25 %`)
//   answer  a clean .xlsx list of the lines for copy and paste into a portal form (Ariba)
// Only the selling rate and amount are written: cost, markup and margin never leave the deal.

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openBoqRequest(id, false);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const query = new URL(request.url).searchParams;
  const kind = query.get("kind");
  if (kind !== "priced" && kind !== "answer") return NextResponse.json({ error: "kind must be priced or answer" }, { status: 400 });
  const out = kind === "priced" ? await exportPriced(gate.req, { withWbs: query.get("wbs") === "1" }) : await exportAnswerSheet(gate.req);
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
  return new NextResponse(new Uint8Array(out.buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${out.fileName.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
      "X-Unpriced-Count": String(out.unpriced),
    },
  });
}
