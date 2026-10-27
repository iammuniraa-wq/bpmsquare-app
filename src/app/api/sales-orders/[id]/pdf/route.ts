import { NextResponse, type NextRequest } from "next/server";
import { printUrlToPdf } from "@/lib/pdf/printUrlToPdf";
import { failure, guard, loadOrder, needsUpdate } from "@/lib/salesOrders/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// GET /api/sales-orders/[id]/pdf -> application/pdf of the printed order, designed by the order's TYPE (its blocks,
// accent colour and logo side), the workspace letterhead, and each line's printed text under the line. A headless
// browser prints the signed-in print page, so the order must be this workspace's before anything is rendered.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try { ctx = await guard(); } catch (e) { return failure(e); }
  const { id } = await params;
  const loaded = await loadOrder(ctx.supabase, ctx.tenantId, id);
  if (loaded.kind === "pending") return needsUpdate();
  if (loaded.kind === "error") return NextResponse.json({ error: loaded.message }, { status: 500 });
  if (loaded.kind === "missing") return NextResponse.json({ error: "Not found" }, { status: 404 });

  const printUrl = new URL(`/sales-orders/${id}/print`, new URL(req.url).origin).toString();
  const r = await printUrlToPdf(printUrl, { cookie: req.headers.get("cookie") ?? "" });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return new NextResponse(new Uint8Array(r.pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${loaded.value.order.ref}.pdf"` },
  });
}
