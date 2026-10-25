// Which ERP organisation unit an order or account belongs to, found through VALUE MAPPING (SO4 plan in docs/design/sales-order.md):
// the Mapping tab's value lists of kind "sales_area" (SAP: one combined code ORG/CHANNEL/DIVISION[/GROUP[/OFFICE]]) and "erp_company"
// (Dynamics company or business unit, Business Central company), keyed by COVERAGE (the owner coverage of the account) or by ORDER TYPE.
// No list row = no code, and the caller says so (a Warning on a check, a refusal to send with the reason); nothing is defaulted silently.
//
// CONTRACT FILE: the types and the function signature are fixed; the SO4 value-mapping builder replaces the body, the SAP builder imports it.

import type { SupabaseClient } from "@supabase/supabase-js";

export type ErpOrgKind = "sales_area" | "erp_company";

export type ErpOrgResult =
  | { ok: true; code: string; via: "coverage" | "order_type"; key: string }
  | { ok: false; reason: string };

/** The ERP code for this order/account in this connector, or the reason there is none. Tenant comes from the caller's session, never a body. */
export async function resolveErpOrg(
  _admin: SupabaseClient,
  _tenantId: string,
  _args: { connectorId: string; kind: ErpOrgKind; accountId: string | null; orderTypeId: string | null }
): Promise<ErpOrgResult> {
  return { ok: false, reason: "No ERP organisation mapping is set up yet." };
}

/** A SAP sales area code "1000/10/00" or "1000/10/00/G01/O01" split into its parts; null when malformed. */
export function parseSalesArea(code: string): { salesOrganization: string; distributionChannel: string; division: string; salesGroup?: string; salesOffice?: string } | null {
  const p = code.split("/").map((s) => s.trim());
  if (p.length < 3 || p.length > 5 || p.slice(0, 3).some((s) => !/^[A-Za-z0-9]{1,4}$/.test(s))) return null;
  const out: { salesOrganization: string; distributionChannel: string; division: string; salesGroup?: string; salesOffice?: string } = { salesOrganization: p[0], distributionChannel: p[1], division: p[2] };
  if (p[3]) out.salesGroup = p[3];
  if (p[4]) out.salesOffice = p[4];
  return out;
}
