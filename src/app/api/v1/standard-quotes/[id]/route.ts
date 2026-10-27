import { authorizeApi, jsonOk } from "../../_auth";
import { loadStandardQuoteForApi } from "@/lib/api/standardQuoteRows";

// One standard quote with its lines. The same customer-safe fields as the list plus the
// customer-facing text (introduction, notes, terms); see src/lib/api/standardQuoteRows.ts for
// what is deliberately never selected.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApi(req, "standard_quotes");
  if ("error" in auth) return auth.error;

  const { id } = await params;
  const quote = await loadStandardQuoteForApi(auth.tenantId, id);
  if (!quote) return Response.json({ error: "Not found" }, { status: 404 });

  return jsonOk({
    data: quote,
    _links: { self: `/api/v1/standard-quotes/${id}` },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
