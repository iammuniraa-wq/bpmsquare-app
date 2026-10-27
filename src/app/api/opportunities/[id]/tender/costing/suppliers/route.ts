import { NextResponse } from "next/server";
import { openCostingRequest } from "@/lib/tender/costing/server";
import { allowedSuppliersForAccount, loadPickerSuppliers } from "@/lib/supplierGroups/server";

// GET /api/opportunities/[id]/tender/costing/suppliers
//   The suppliers the Costing "New RFQ" composer may offer for this tender deal: the deal's client account decides
//   (docs/design/contract-buyout.md section 0b). When the client has an approved supplier list (an active group with members) ONLY its members
//   are returned and `restricted` is true; otherwise every active supplier of the workspace, `restricted` false, `group` null. The server also
//   refuses anyone outside the list when the RFQ is created (POST /api/rfqs answers 422 naming them), so hiding them here is a convenience.
//   -> { restricted: boolean, group: { id, name } | null, account: { id, name } | null,
//        suppliers: [{ id, ref, name, email, city, status, type }] }   (inactive suppliers are left out; sorted by name)
// Same door as the rest of Costing: the tender flags, the Pipeline view, a tender deal of THIS workspace and the estimator or RFQ module.

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openCostingRequest(id, false);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, tenantId, opp } = gate.req;
  const accountId = (opp as { account_id?: string | null }).account_id ?? null;
  const restriction = await allowedSuppliersForAccount(tenantId, accountId, admin);
  const suppliers = await loadPickerSuppliers(admin, tenantId, restriction.restricted ? restriction.supplier_ids : null);
  let account: { id: string; name: string } | null = null;
  if (accountId) {
    const { data } = await admin.from("accounts").select("id, name").eq("id", accountId).eq("tenant_id", tenantId).maybeSingle();
    account = (data as { id: string; name: string } | null) ?? null;
  }
  return NextResponse.json({ restricted: restriction.restricted, group: restriction.group, account, suppliers });
}
