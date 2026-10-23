import { authorizeApi, jsonOk } from "../../_auth";
import { loadSalesOrderForApi } from "@/lib/api/salesOrderRows";

// One sales order with its lines. The same customer-safe fields as the list plus the customer-facing text (notes, terms);
// see src/lib/api/salesOrderRows.ts for what is deliberately never selected.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApi(req, "sales_orders");
  if ("error" in auth) return auth.error;

  const { id } = await params;
  const order = await loadSalesOrderForApi(auth.tenantId, id);
  if (!order) return Response.json({ error: "Not found" }, { status: 404 });

  return jsonOk({ data: order, _links: { self: `/api/v1/sales-orders/${id}` } });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
