import { jsonOk } from "./_auth";

export async function GET() {
  return jsonOk({
    name: "VeveyCRM REST API",
    version: "1.0",
    generated_at: new Date().toISOString(),
    authentication: "Bearer token — a per-tenant API key, generated in Settings → Admin → this tenant. Every endpoint below resolves the tenant from that key; there is no global/shared key anymore.",
    endpoints: {
      "GET /api/v1":                     "This index",
      "GET /api/v1/accounts":             "List all accounts",
      "GET /api/v1/accounts/:id":         "Account detail with contacts, cases, quotes, work orders",
      "GET /api/v1/cases":                "List all service cases",
      "GET /api/v1/quotations":           "List all quotations",
      "GET /api/v1/inventory":            "List inventory stock items",
      "GET /api/v1/inventory/:id":        "Inventory item detail with transaction history",
      "GET /api/v1/invoices":             "List invoices",
      "GET /api/v1/invoices/:id":         "Invoice detail with line items and payments",
      "GET /api/v1/purchase-orders":      "List purchase orders",
      "GET /api/v1/purchase-orders/:id":  "Purchase order detail with line items",
    },
    coming_soon: [
      "POST /api/v1/cases        — create case",
      "PATCH /api/v1/cases/:id   — update case status",
      "POST /api/v1/quotations   — create quotation",
      "GET  /api/v1/openapi.json — OpenAPI 3 spec",
      "POST /api/v1/webhooks     — register webhook endpoint",
    ],
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
    },
  });
}
