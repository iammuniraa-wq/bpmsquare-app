// Which ERP organisation unit an order or account belongs to, found through VALUE MAPPING (SO4 plan in docs/design/sales-order.md):
// the Mapping tab's value lists of kind "sales_area" (SAP: one combined code ORG/CHANNEL/DIVISION[/GROUP[/OFFICE]]) and "erp_company"
// (Dynamics company or business unit, Business Central company), keyed by COVERAGE (the owner coverage of the account) or by ORDER TYPE.
// No list row = no code, and the caller says so (a Warning on a check, a refusal to send with the reason); nothing is defaulted silently.
//
// CONTRACT FILE: the types and the function signature are fixed; the SAP builder imports it. The pure rules (key scheme, lookup order,
// the words) are in erpOrgPure.ts so a screen can use them without the server; they are re-exported here.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResolvedCoverage } from "@/lib/coverage/resolve";
import type { Account } from "@/lib/types";
import { loadOrgDirectory } from "./erpOrgNames";
import { noMappingReason, orgKey, parseSalesArea, pickOrgCode, salesAreaProblem, type ErpOrgKind, type ErpOrgResult } from "./erpOrgPure";
import { listAll } from "./mapping/valueListStore";

export { describeErpOrg, noMappingReason, orgKey, orgKeyLabel, parseOrgKey, parseSalesArea, pickOrgCode, ORG_KIND_LABEL } from "./erpOrgPure";
export type { ErpOrgKind, ErpOrgResult, ErpOrgLine, OrgNames } from "./erpOrgPure";

type Deps = {
  /** Replaces the live coverage engine, for a test. */
  resolveCoverage?: (tenantId: string, account: Account) => Promise<Pick<ResolvedCoverage, "owner">>;
};

/**
 * The ERP code for this order/account in this connector, or the reason there is none. Tenant comes from the caller's session, never a body.
 * Order of lookup: the order type's own row first (an order type that needs a different sales area / company), then the owner coverage
 * of the account. The connector id is the value-list connection: "sap_s4" or "dynamics365". The account and the order type are read
 * with the tenant filter, so an id from another workspace finds nothing and the lookup moves on to the coverage.
 */
export async function resolveErpOrg(
  admin: SupabaseClient,
  tenantId: string,
  args: { connectorId: string; kind: ErpOrgKind; accountId: string | null; orderTypeId: string | null },
  deps: Deps = {},
): Promise<ErpOrgResult> {
  const lists = await listAll(admin, tenantId, args.connectorId);
  const rows = lists.pending ? [] : (lists.lists.find((l) => l.kind === args.kind)?.rows ?? []);
  if (rows.every((r) => !r.erp.trim())) return { ok: false, reason: noMappingReason(args.kind, { listEmpty: true }) };

  const { names } = await loadOrgDirectory(admin, tenantId);

  let orderTypeName: string | null = null;
  let orderTypeKey: string | null = null;
  if (args.orderTypeId) {
    const { data } = await admin.from("sales_order_types").select("id, name").eq("id", args.orderTypeId).eq("tenant_id", tenantId).maybeSingle();
    const t = data as { id: string; name: string } | null;
    if (t) { orderTypeName = t.name; orderTypeKey = orgKey("order_type", t.id); }
  }

  let coverageName: string | null = null;
  let coverageKey: string | null = null;
  if (args.accountId) {
    const { data } = await admin.from("accounts").select("*").eq("id", args.accountId).eq("tenant_id", tenantId).maybeSingle();
    if (data) {
      try {
        // Loaded only when a mapping exists: the coverage engine pulls in the whole segmentation stack.
        const resolve = deps.resolveCoverage ?? (await import("@/lib/coverage/resolve")).resolveCoverageForAccount;
        const resolved = await resolve(tenantId, data as Account);
        const seg = resolved.owner?.segment;
        if (seg) { coverageKey = orgKey("segment", seg.id); coverageName = names.segment[seg.id.toLowerCase()] ?? seg.name; }
      } catch (e) {
        console.error("[erp-org] coverage could not be resolved", (e as Error).message);
      }
    }
  }

  const hit = pickOrgCode(rows, { orderTypeKey, coverageKey });
  if (!hit) return { ok: false, reason: noMappingReason(args.kind, { orderTypeName, coverageName, hadAccount: !!args.accountId }) };
  if (args.kind === "sales_area" && !parseSalesArea(hit.code)) {
    return { ok: false, reason: `The sales area mapped for ${hit.via === "order_type" ? `order type '${orderTypeName}'` : `coverage '${coverageName}'`} is not usable. ${salesAreaProblem(hit.code) ?? ""}`.trim() };
  }
  return { ok: true, code: hit.code, via: hit.via, key: hit.key, via_label: (hit.via === "order_type" ? orderTypeName : coverageName) ?? undefined };
}
