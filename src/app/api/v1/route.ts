import { jsonOk } from "./_auth";

export async function GET() {
  return jsonOk({
    name: "BPMSquare REST API",
    version: "1.0",
    generated_at: new Date().toISOString(),
    authentication:
      "Bearer token — a per-tenant API key, generated in Settings → Admin → this tenant. Every endpoint resolves the tenant from that key; there is no global/shared key. The key grants writes as well as reads, so treat it like a password.",
    start_here: {
      metadata: "GET /api/v1/metadata — every documented entity",
      quotation_fields: "GET /api/v1/metadata/quotations — every quotation field, its type, allowed values and whether it is writable",
    },
    endpoints: {
      "GET /api/v1":                      "This index",
      "GET /api/v1/metadata":             "List documented entities",
      "GET /api/v1/metadata/:entity":     "Full field-level metadata for one entity",
      "GET /api/v1/quotations":           "List quotations (filters: status, account_id)",
      "POST /api/v1/quotations":          "Create a quotation, with its lines",
      "GET /api/v1/quotations/:id":       "Quotation detail with lines, account, contact and totals",
      "PATCH /api/v1/quotations/:id":     "Update a quotation and/or replace its lines",
      "DELETE /api/v1/quotations/:id":    "Delete a quotation",
      "GET /api/v1/accounts":             "List all accounts",
      "GET /api/v1/accounts/:id":         "Account detail with contacts, cases, quotes, work orders",
      "GET /api/v1/cases":                "List all service cases",
      "GET /api/v1/inventory":            "List inventory stock items",
      "GET /api/v1/inventory/:id":        "Inventory item detail with transaction history",
      "GET /api/v1/invoices":             "List invoices",
      "GET /api/v1/invoices/:id":         "Invoice detail with line items and payments",
      "GET /api/v1/purchase-orders":      "List purchase orders",
      "GET /api/v1/purchase-orders/:id":  "Purchase order detail with line items",
    },
    conventions: {
      errors: "422 for validation failures, with a per-field `details` array. 404 for a record or related id not in your tenant. 400 for malformed JSON.",
      totals: "Monetary totals are always calculated server-side. Sending `total` or a line `amount` is rejected.",
      children: "Child arrays (e.g. quotation `lines`) are replaced wholesale on PATCH. Omit the key to leave them unchanged.",
      unknown_fields: "Rejected with 422 rather than ignored, so typos in bulk loads fail loudly.",
    },
    coming_soon: [
      "Write endpoints for cases, accounts and invoices — the metadata/validation structure is in place, each needs its own entity definition",
      "GET /api/v1/openapi.json — OpenAPI 3 spec generated from the same metadata",
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
