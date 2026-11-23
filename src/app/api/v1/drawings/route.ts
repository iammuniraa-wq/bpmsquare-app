import { authorizeApi } from "../_auth";
import { LIST_SOURCES } from "@/lib/api/listSources";
import { enrichedList } from "../_list";

// GET /api/v1/drawings -- the drawings of the workspace with their RELEASED revision (number, label, release date, where filed). A key reaches
// it only by naming "drawings" (explicit scope: project IP), and only a workspace that owns the register gets an answer (404 otherwise).
// No file path, no fingerprint, no draft or review state, no file bytes.

export async function GET(req: Request) {
  const auth = await authorizeApi(req, "drawings");
  if ("error" in auth) return auth.error;

  const { searchParams } = new URL(req.url);
  const src = LIST_SOURCES.drawings;
  let rows = await src.load(auth.tenantId);
  const type = searchParams.get("type");
  if (type) rows = rows.filter((d) => d.type === type);
  const opportunity = searchParams.get("opportunity_id");
  if (opportunity) rows = rows.filter((d) => d.opportunity_id === opportunity);
  const project = searchParams.get("project_id");
  if (project) rows = rows.filter((d) => d.project_id === project);
  if (searchParams.get("released") === "true") rows = rows.filter((d) => d.released === true);

  return enrichedList(req, rows, src.fields, { self: "/api/v1/drawings" });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
