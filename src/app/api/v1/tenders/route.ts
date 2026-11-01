import { authorizeApi, jsonValidationError } from "../_auth";
import { LIST_SOURCES } from "@/lib/api/listSources";
import { enrichedList } from "../_list";
import { createAdminSupabase } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { tenantTimezone } from "@/lib/tenantClock";
import { closingWithinDays } from "@/lib/tender/filters";

// The scope is "tenders", explicit only: a "*" key never reaches it (api/v1/_auth.ts EXPLICIT_SCOPE_ONLY). authorizeApi also
// answers 404 for a workspace without the tender edition; the Pipeline is checked here like the deals endpoint does.
export async function GET(req: Request) {
  const auth = await authorizeApi(req, "tenders");
  if ("error" in auth) return auth.error;

  if (!(await tenantHasFeature(createAdminSupabase(), auth.tenantId, "pipeline"))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const src = LIST_SOURCES.tenders;
  let rows = await src.load(auth.tenantId);

  const closingRaw = searchParams.get("closing");
  if (closingRaw !== null && closingRaw !== "") {
    const days = Number(closingRaw);
    if (!Number.isInteger(days) || days < 1 || days > 365) return jsonValidationError([{ field: "closing", message: "closing must be a whole number of days from 1 to 365" }]);
    rows = closingWithinDays(rows, days, new Date(), await tenantTimezone(auth.tenantId));
  }
  rows = rows.map((r) => ({ ...r, _links: { ...(r._links as Record<string, unknown>), self: `/api/v1/tenders/${String(r.id)}`, boq: `/api/v1/tenders/${String(r.id)}/boq` } }));

  return enrichedList(req, rows, src.fields, {
    self: "/api/v1/tenders",
    legacyFilters: (["stage", "outcome", "decision", "portal"] as const).map((path) => ({ path, value: searchParams.get(path) })),
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
