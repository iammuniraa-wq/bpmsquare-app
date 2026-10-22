import { NextResponse, type NextRequest } from "next/server";
import { guard, jsonBody, fail } from "../../_guard";
import { CONNECTOR_ID, loadD365, publicState } from "@/lib/connectors/d365/server";
import { saveConnection, type SaveBody } from "@/lib/connectors/d365/save";
import { disconnectSap, loadSap, publicState as sapPublicState, saveSapConnection, SapSaveError, type SapSaveBody } from "@/lib/connectors/sap_s4/server";
import { SAP_CONNECTOR_ID } from "@/lib/connectors/sap_s4/types";

// One ERP connection, with the connector's own storage and secret sealing (nothing is copied).
//   GET    -> { config, secrets: { client_secret: bool, certificate: bool, private_key: bool, password: bool, refresh_token: bool },
//               status: "connected"|"error"|"not_connected", last_error }
//   PUT    { config: { product, auth_mode, environment_url, directory_id?, client_id?, company?, username?, schedule?,
//                      entities?, secret_expires_on?: "YYYY-MM-DD", price_list_id?, currency_id?,
//                      outbound?: { quote?: { field_map }, quote_line?: { field_map },
//                                   project?: { entity_set, id_field, field_map, tasks?: { entity_set, link_field? }, bom?: { ... } } } | null },
//            secrets?: { client_secret?, certificate?, private_key?, password? } }
//          Secrets are WRITE-ONLY: blank or missing = unchanged, never cleared, never returned.
//          A setting left out of `config` keeps its stored value; `null` clears it (outbound: null = "Reset to standard").
//          Unknown placeholders and bad field names in a map are 422 with the field named.
//   DELETE -> disconnect; records already synced and their links stay.
// SAP S/4HANA (id "sap_s4"): config { auth_mode: "basic" | "api_key", api_host, username?, schedule?, entities? },
//   secrets { password?, api_key? }. The sandbox login (api_key) fixes the host. Same write-only rule for both secrets.
// Test connection: POST /api/middleware/connections/<id>/test. "Sign in as a user" (authorization code) keeps
// using /api/connectors/dynamics365/oauth/start and /callback.
const KNOWN = new Set([CONNECTOR_ID, SAP_CONNECTOR_ID]);

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard();
  if (!g.ok) return g.res;
  const id = (await params).id;
  if (!KNOWN.has(id)) return fail(404, "Connection not found.");
  if (id === SAP_CONNECTOR_ID) return NextResponse.json(sapPublicState(await loadSap(g.ctx.admin, g.ctx.tenantId)));
  return NextResponse.json(publicState(await loadD365(g.ctx.admin, g.ctx.tenantId)));
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard();
  if (!g.ok) return g.res;
  const id = (await params).id;
  if (!KNOWN.has(id)) return fail(404, "Connection not found.");
  try {
    if (id === SAP_CONNECTOR_ID) return NextResponse.json(await saveSapConnection(g.ctx.admin, g.ctx.tenantId, g.ctx.userId, await jsonBody<SapSaveBody>(req)));
    return NextResponse.json(await saveConnection(g.ctx.admin, g.ctx.tenantId, g.ctx.userId, await jsonBody<SaveBody>(req)));
  } catch (e) {
    const x = e as { status?: number; message?: string };
    if (e instanceof SapSaveError) return fail(e.status, e.message);
    return fail(x.status ?? 500, x.message ?? "Could not save the connection.");
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard();
  if (!g.ok) return g.res;
  const id = (await params).id;
  if (!KNOWN.has(id)) return fail(404, "Connection not found.");
  if (id === SAP_CONNECTOR_ID) await disconnectSap(g.ctx.admin, g.ctx.tenantId);
  else await g.ctx.admin.from("tenant_connectors").delete().eq("tenant_id", g.ctx.tenantId).eq("connector_id", CONNECTOR_ID);
  return NextResponse.json({ ok: true });
}
