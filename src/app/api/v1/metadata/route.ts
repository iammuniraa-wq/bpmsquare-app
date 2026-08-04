import { API_ENTITIES, UNDOCUMENTED_ENDPOINTS } from "@/lib/api/registry";
import { resolveTenantFromBearer, ERR_401_TENANT, jsonOk, optionsResponse } from "../_auth";

export async function GET(req: Request) {
  const tenantId = await resolveTenantFromBearer(req);
  if (!tenantId) return ERR_401_TENANT();

  return jsonOk({
    description:
      "Machine-readable description of every entity the v1 API exposes for writing: its fields, types, allowed values, which are required, which are read-only, and how they relate to other entities.",
    entities: Object.entries(API_ENTITIES).map(([key, def]) => ({
      key,
      entity: def.name,
      description: def.description,
      endpoint: def.endpoint,
      field_count: def.fields.length,
      children: (def.children ?? []).map((c) => c.entity.name),
      _links: { metadata: `/api/v1/metadata/${key}`, collection: def.endpoint },
    })),
    documented_count: Object.keys(API_ENTITIES).length,
    not_yet_documented: {
      message:
        "These endpoints are read-only and have no field-level metadata yet. They still respond to GET; they simply are not described here.",
      endpoints: UNDOCUMENTED_ENDPOINTS,
    },
    _links: { self: "/api/v1/metadata", api_index: "/api/v1" },
  });
}

export async function OPTIONS() {
  return optionsResponse();
}
