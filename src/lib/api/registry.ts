import type { EntityDef } from "./schema";
import { QUOTE_ENTITY } from "./quotes";

/**
 * Entities exposed through the v1 metadata endpoint.
 *
 * Only quotations are described so far -- deliberately. The structure is the
 * point: adding an entity here is a single line plus its EntityDef, and it
 * immediately gains metadata, validation and documentation. The read-only
 * endpoints for accounts/cases/inventory/invoices/purchase-orders exist but
 * have no EntityDef yet, so they are listed as undocumented rather than
 * silently omitted.
 */
export const API_ENTITIES: Record<string, EntityDef> = {
  quotations: QUOTE_ENTITY,
};

export const UNDOCUMENTED_ENDPOINTS = [
  "/api/v1/accounts",
  "/api/v1/cases",
  "/api/v1/employees",
  "/api/v1/inventory",
  "/api/v1/invoices",
  "/api/v1/purchase-orders",
] as const;
