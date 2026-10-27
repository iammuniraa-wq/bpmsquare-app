import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { printUrlToPdf } from "@/lib/pdf/printUrlToPdf";
import { verifyOrderPublicToken } from "@/lib/salesOrderPublicLink";
import { tenantOfOrder } from "@/lib/salesOrders/printData";

export const runtime = "nodejs";
export const maxDuration = 60;

// Public counterpart to /api/sales-orders/[id]/pdf: no session, reached through a signed link
// (lib/salesOrderPublicLink.ts). The token is verified against the order id first; the order's own workspace must
// still own the module; the headless browser then prints the token-gated print-public page.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; token: string }> }) {
  const { id, token } = await params;
  if (!verifyOrderPublicToken(id, token)) return NextResponse.json({ error: "This link is invalid or has expired." }, { status: 404 });

  const admin = createAdminSupabase();
  const tenantId = await tenantOfOrder(admin, id);
  if (!tenantId) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  const { data: tenant } = await admin.from("tenants").select("features").eq("id", tenantId).maybeSingle();
  if (!(tenant?.features as { sales_orders?: boolean } | undefined)?.sales_orders) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  const { data: order } = await admin.from("sales_orders").select("ref").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const printUrl = new URL(`/sales-orders/${id}/print-public/${token}`, new URL(req.url).origin).toString();
  const r = await printUrlToPdf(printUrl);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return new NextResponse(new Uint8Array(r.pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${(order as { ref: string }).ref}.pdf"` },
  });
}
