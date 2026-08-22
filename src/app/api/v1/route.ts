import { jsonOk, resolveTenantFromBearer, ERR_401_TENANT } from "./_auth";

export async function GET(req: Request) {
  // The index is behind the key like every other v1 route. It exposes no tenant
  // data, but /api/v1 is exempt from the middleware session gate, and an
  // exemption should not quietly add a new unauthenticated public surface.
  const tenantId = await resolveTenantFromBearer(req);
  if (!tenantId) return ERR_401_TENANT();

  return jsonOk({
    name: "BPMSquare REST API",
    version: "1.0",
    generated_at: new Date().toISOString(),
    authentication:
      "Bearer token — a per-tenant API key. Two kinds: the tenant's full-access key (Settings → General → Developer), or a scoped key you mint there (read-only vs write, and per-object). Every endpoint resolves the tenant from the key; there is no global/shared key. Treat any key like a password — scoped keys can be revoked individually.",
    start_here: {
      openapi: "GET /api/v1/openapi.json — OpenAPI 3.0 spec (import into Postman/Insomnia/SAP CPI or run codegen)",
      metadata: "GET /api/v1/metadata — every documented entity",
      quotation_fields: "GET /api/v1/metadata/quotations — every quotation field, its type, allowed values and whether it is writable",
      changes: "GET /api/v1/changes?since=<cursor> — the change feed; poll to sync only what changed",
    },
    endpoints: {
      "GET /api/v1":                      "This index",
      "GET /api/v1/openapi.json":         "OpenAPI 3.0 spec for the whole API",
      "GET /api/v1/metadata":             "List documented entities",
      "GET /api/v1/metadata/:entity":     "Full field-level metadata for one entity",
      "GET /api/v1/changes":              "Change feed (CDC): ?since=<cursor>&object_type=&limit=",
      "POST /api/v1/ask":                 "Natural-language query: { object, question } compiled to the safe query engine",
      "POST /api/v1/price":               "PricingEngine: price a document against the tenant's published config, full waterfall trace",
      "GET /api/v1/quotations":           "List quotations (filters: status, account_id)",
      "POST /api/v1/quotations":          "Create a quotation, with its lines",
      "GET /api/v1/quotations/:id":       "Quotation detail with lines, account, contact and totals",
      "PATCH /api/v1/quotations/:id":     "Update a quotation and/or replace its lines",
      "DELETE /api/v1/quotations/:id":    "Delete a quotation",
      "GET /api/v1/accounts":             "List all accounts",
      "GET /api/v1/accounts/:id":         "Account detail with contacts, cases, quotes, work orders",
      "GET /api/v1/cases":                "List all service cases",
      "GET /api/v1/employees":            "List staff records (scope must name \"employees\" explicitly)",
      "GET /api/v1/employees/:id":        "Employee detail",
      "GET /api/v1/inventory":            "List inventory stock items",
      "GET /api/v1/inventory/:id":        "Inventory item detail with transaction history",
      "GET /api/v1/invoices":             "List invoices",
      "GET /api/v1/invoices/:id":         "Invoice detail with line items and payments",
      "GET /api/v1/products":             "List products (sellable catalog; list price, tax, category)",
      "GET /api/v1/products/:id":         "Product detail",
      "GET /api/v1/purchase-orders":      "List purchase orders",
      "GET /api/v1/purchase-orders/:id":  "Purchase order detail with line items",
    },
    conventions: {
      errors: "422 for validation failures, with a per-field `details` array. 404 for a record or related id not in your tenant. 400 for malformed JSON.",
      totals: "Monetary totals are always calculated server-side. Sending `total` or a line `amount` is rejected.",
      children: "Child arrays (e.g. quotation `lines`) are replaced wholesale on PATCH. Omit the key to leave them unchanged.",
      unknown_fields: "Rejected with 422 rather than ignored, so typos in bulk loads fail loudly.",
    },
    query: {
      description: "List endpoints accept an enriched query layer (currently live on GET /api/v1/quotations; rolling out to the rest). Every referenced field is validated against the entity's metadata, so a typo is a 422, not a silent full scan.",
      select:    "?select=ref,total,account.name — projection; dotted paths for nested fields.",
      filter:    "?filter=status:eq:draft;total:gte:50000;account.name:like:pump — ;-separated field:op:value (AND). ops: eq ne gt gte lt lte like in isnull (in=comma list; isnull=true|false).",
      sort:      "?sort=-total,ref — multi-key; leading - is descending.",
      paginate:  "?page=1&limit=50 — limit clamped to 200; meta.total and _links.next/prev are returned.",
      aggregate: "?aggregate=count,sum:total,avg:total — inline aggregates over the FILTERED set, returned in meta.aggregates. (Most CRM REST APIs make you pull every row and total client-side.)",
      example:   "GET /api/v1/quotations?filter=status:eq:draft;total:gte:50000&select=ref,total,account.name&sort=-total&aggregate=sum:total",
    },
    access_control:
      "Scoped API keys are live. A key carries a scope: read and/or write, and either all objects or a named subset (quotations, accounts, cases, inventory, invoices, purchase-orders). A read-only key gets 403 on any write; a key scoped to a subset gets 403 on any object outside it. \"employees\" is the one object the all-objects wildcard does NOT cover — staff personal data requires a key that names it explicitly. Mint and revoke keys in Settings → General → Developer.",
    webhooks:
      "Live (push). Register an endpoint in Settings → General → Developer; every create/update/delete is delivered as a signed batch (HMAC-SHA256, header X-BPMSquare-Signature) with the same event shape as GET /api/v1/changes. Only events after registration are sent; the /changes feed remains the pull-based backfill.",
    ask: {
      description: "Live. POST a plain-English question and the object to run it over; it is compiled to the same validated query engine (never to SQL) and executed with your read scope. The response echoes the exact `compiled` query string it ran, so you can lift it into a normal request.",
      example: 'POST /api/v1/ask  { "object": "quotations", "question": "top 5 draft quotes over 50,000 by value" }',
    },
    coming_soon: [
      "Write endpoints for cases, accounts and invoices — the metadata/validation structure is in place, each needs its own entity definition",
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
