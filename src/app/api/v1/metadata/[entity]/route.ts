import { API_ENTITIES } from "@/lib/api/registry";
import { describeEntity } from "@/lib/api/schema";
import { resolveTenantFromBearer, ERR_401_TENANT, jsonOk, jsonError, optionsResponse } from "../../_auth";

export async function GET(req: Request, { params }: { params: Promise<{ entity: string }> }) {
  const tenantId = await resolveTenantFromBearer(req);
  if (!tenantId) return ERR_401_TENANT();

  const { entity } = await params;
  const def = API_ENTITIES[entity];
  if (!def) {
    return jsonError(404, "Unknown entity", {
      message: `No metadata for "${entity}".`,
      available: Object.keys(API_ENTITIES),
    });
  }

  return jsonOk({
    data: describeEntity(def),
    usage: {
      create: `POST ${def.endpoint} — send any field marked writable; fields marked required_on_create must be present.`,
      read_one: `GET ${def.endpoint}/:id`,
      update: `PATCH ${def.endpoint}/:id — send only the fields you want to change.`,
      delete: `DELETE ${def.endpoint}/:id`,
      notes: [
        "Unknown field names are rejected with 422 rather than ignored, so a typo fails loudly instead of silently dropping data.",
        "Fields marked computed or read_only are rejected on write; the server derives them.",
        "Child arrays are replaced wholesale on update — send the complete set, or omit the key to leave them untouched.",
      ],
    },
    _links: { self: `/api/v1/metadata/${entity}`, all_metadata: "/api/v1/metadata", collection: def.endpoint },
  });
}

export async function OPTIONS() {
  return optionsResponse();
}
