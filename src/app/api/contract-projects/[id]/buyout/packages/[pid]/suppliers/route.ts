import { NextResponse, type NextRequest } from "next/server";
import { openPackageRequest } from "@/lib/contractProjects/buyout/server";
import { allowedSuppliersForAccount, loadPickerSuppliers } from "@/lib/supplierGroups/server";

// GET /api/contract-projects/[id]/buyout/packages/[pid]/suppliers
//   The suppliers the "Send request" picker may offer for this package: the project's client decides (docs/design/contract-buyout.md section 0b).
//   With an approved supplier list (an active group with members) ONLY its members, `restricted: true`; otherwise every active supplier,
//   `restricted: false` and `group: null` (the screen says "No approved list for this client"). POST .../rounds refuses anyone outside the list.
//   -> { restricted, group: { id, name } | null, suppliers: [{ id, ref, name, email, city, status, type }] }   (inactive suppliers left out; by name)

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string; pid: string }> }) {
  const { id, pid } = await params;
  const gate = await openPackageRequest(id, pid);
  if (!gate.ok) return NextResponse.json({ error: gate.error, ...(gate.extra ?? {}) }, { status: gate.status });
  const { admin, tenantId, project } = gate.req;
  const restriction = await allowedSuppliersForAccount(tenantId, project.account_id, admin);
  const suppliers = await loadPickerSuppliers(admin, tenantId, restriction.restricted ? restriction.supplier_ids : null);
  return NextResponse.json({ restricted: restriction.restricted, group: restriction.group, suppliers });
}
