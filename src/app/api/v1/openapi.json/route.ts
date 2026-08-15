import { resolveTenantFromBearer, ERR_401_TENANT, jsonOk, optionsResponse } from "../_auth";
import { buildOpenApiSpec } from "@/lib/api/openapi";

// GET /api/v1/openapi.json — OpenAPI 3.0 spec generated from the entity
// metadata. The $metadata equivalent: import it into Postman/Insomnia/SAP CPI
// or feed it to a codegen. Behind the tenant key like every other v1 route (it
// exposes no tenant data, but the /api/v1 prefix is exempt from the session
// gate, and an exemption shouldn't add an unauthenticated surface).
export async function GET(req: Request) {
  const tenantId = await resolveTenantFromBearer(req);
  if (!tenantId) return ERR_401_TENANT();
  return jsonOk(buildOpenApiSpec());
}

export function OPTIONS() {
  return optionsResponse();
}
