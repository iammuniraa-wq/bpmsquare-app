import { NextResponse, type NextRequest } from "next/server";
import { guard, fail } from "../_guard";
import { getErpMetadata } from "@/lib/middleware/metadataServer";
import { isMetadataEntity, METADATA_ENTITIES } from "@/lib/middleware/metadata";
import { wantsSap } from "@/lib/middleware/connectorParam";
import { getSapFields } from "@/lib/connectors/sap_s4/server";
import { isSapEntity } from "@/lib/connectors/sap_s4/types";

// GET /api/middleware/metadata?entity=quote|quote_line|account|contact|product|project|customers|contacts|vendors|products|projects[&refresh=1]
// The ERP's own field list, the pick-list for every target field in the Mapping tab.
//   Dataverse: EntityDefinitions(...)/Attributes. Finance and Operations / Business Central: OData $metadata
//   (a sample row is used when $metadata is too large or refused: source "sample", no required marks).
// -> { fields: [{ name, label, type, required, creatable }], fetchedAt, entity, applicable, source }
//    applicable:false (with `hint`) where the product has no such table, e.g. a quote on Finance and Operations.
// Cached a few minutes per workspace + product + environment + entity set; refresh=1 re-fetches.
// 400 { state: "not_connected" } when no ERP is connected yet. No credential is ever returned.
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const g = await guard();
  if (!g.ok) return g.res;
  const entity = req.nextUrl.searchParams.get("entity");
  if (wantsSap(req)) {
    // SAP S/4HANA: the service's $metadata (customers, vendors, products), plus the address / description parts the map reads.
    if (!isSapEntity(entity)) return fail(422, "entity must be one of: customers, vendors, products.");
    const r = await getSapFields(g.ctx.admin, g.ctx.tenantId, entity, { refresh: req.nextUrl.searchParams.get("refresh") === "1" });
    if (!r.ok) return fail(r.state === "not_connected" ? 400 : 502, r.message, { state: r.state });
    return NextResponse.json({ ok: true, entity, applicable: true, fields: [...r.extra, ...r.main], fetchedAt: r.fetchedAt, source: r.source });
  }
  if (!isMetadataEntity(entity)) return fail(422, `entity must be one of: ${METADATA_ENTITIES.join(", ")}.`);
  const r = await getErpMetadata(g.ctx.tenantId, entity, { refresh: req.nextUrl.searchParams.get("refresh") === "1" });
  if (!r.ok) return fail(r.state === "not_connected" ? 400 : 502, r.message, { state: r.state });
  return NextResponse.json(r);
}
