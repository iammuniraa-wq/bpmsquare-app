import { listCasesForTenant } from "@/lib/data";
import { authorizeApi } from "../_auth";
import { enrichedList } from "../_list";
import type { QueryableField } from "@/lib/api/query";

const CASE_QUERYABLE: QueryableField[] = [
  { path: "id", type: "string" },
  { path: "ref", type: "string", searchable: true },
  { path: "type", type: "string" },
  { path: "status", type: "string" },
  { path: "equipment_label", type: "string", searchable: true },
  { path: "complaint", type: "string", searchable: true },
  { path: "disposition", type: "string" },
  { path: "has_loaner", type: "boolean" },
  { path: "intake_at", type: "date" },
  { path: "closed_at", type: "date" },
  { path: "account.id", type: "string" },
  { path: "account.name", type: "string", searchable: true },
  { path: "technician_name", type: "string" },
];

export async function GET(req: Request) {
  const auth = await authorizeApi(req, "cases");
  if ("error" in auth) return auth.error;
  const { tenantId } = auth;

  const url = new URL(req.url);
  const cases = await listCasesForTenant(tenantId);
  const rows = cases.map(({ serviceCase: sc, account, technicianName }) => ({
    id: sc.id,
    ref: sc.ref,
    type: sc.type,
    status: sc.status,
    equipment_label: sc.equipment_label,
    complaint: sc.complaint,
    disposition: sc.disposition,
    has_loaner: sc.has_loaner,
    intake_at: sc.intake_at,
    closed_at: sc.closed_at,
    account: account ? { id: account.id, name: account.name } : null,
    technician_name: technicianName,
    _links: { self: `/api/v1/cases/${sc.id}`, account: `/api/v1/accounts/${sc.account_id}` },
  }));

  return enrichedList(req, rows, CASE_QUERYABLE, {
    self: "/api/v1/cases",
    legacyFilters: [
      { path: "status", value: url.searchParams.get("status") },
      { path: "account.id", value: url.searchParams.get("account_id") },
    ],
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
