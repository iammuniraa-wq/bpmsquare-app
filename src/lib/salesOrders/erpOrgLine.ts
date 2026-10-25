import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveErpOrg } from "@/lib/middleware/erpOrg";
import { describeErpOrg, ORG_KIND_LABEL, type ErpOrgKind } from "@/lib/middleware/erpOrgPure";
import { listAll } from "@/lib/middleware/mapping/valueListStore";
import type { OrderRow } from "./server";

// The one read-only line on an order's ERP tab: "Sales area 1000/10/00 (from coverage Saudi retail)" or "ERP company ...".
// Only for a connector that is connected and uses the code. Dynamics says nothing when no company is mapped (a single-company
// Dataverse works without one); SAP says so plainly, because an order cannot be created in SAP without a sales area.

export type ErpOrgLineView = { kind: ErpOrgKind; label: string; ok: boolean; text: string };

const SAP_CONNECTOR = "sap_s4";
const D365_CONNECTOR = "dynamics365";

async function sapConnected(db: SupabaseClient, tenantId: string): Promise<boolean> {
  const { data, error } = await db.from("tenant_connectors").select("status").eq("tenant_id", tenantId).eq("connector_id", SAP_CONNECTOR).maybeSingle();
  return !error && (data as { status?: string } | null)?.status === "connected";
}

export async function loadErpOrgLines(
  db: SupabaseClient, tenantId: string, order: Pick<OrderRow, "account_id" | "type_id" | "origin">, dataverse: boolean,
): Promise<ErpOrgLineView[]> {
  const out: ErpOrgLineView[] = [];
  // An order that came from the ERP already has its organisation there; nothing here would be sent.
  if (order.origin === "erp") return out;
  try {
    if (dataverse) {
      // A workspace that never mapped a company reads one cheap query and shows nothing.
      const lists = await listAll(db, tenantId, D365_CONNECTOR);
      const mapped = !lists.pending && (lists.lists.find((l) => l.kind === "erp_company")?.rows.length ?? 0) > 0;
      if (mapped) {
        const r = await resolveErpOrg(db, tenantId, { connectorId: D365_CONNECTOR, kind: "erp_company", accountId: order.account_id, orderTypeId: order.type_id });
        if (r.ok) out.push({ kind: "erp_company", label: ORG_KIND_LABEL.erp_company, ...describeErpOrg(r, "erp_company") });
      }
    }
    if (await sapConnected(db, tenantId)) {
      const r = await resolveErpOrg(db, tenantId, { connectorId: SAP_CONNECTOR, kind: "sales_area", accountId: order.account_id, orderTypeId: order.type_id });
      out.push({ kind: "sales_area", label: ORG_KIND_LABEL.sales_area, ...describeErpOrg(r, "sales_area") });
    }
  } catch (e) {
    console.error("[sales-orders] the ERP organisation line could not be read", (e as Error).message);
  }
  return out;
}
