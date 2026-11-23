import { NextResponse, type NextRequest } from "next/server";
import { getAuthUser } from "@/lib/supabase-server";
import { logChange } from "@/lib/changeLog";
import { EXPENSE_COLS, loadViewerScope, normaliseExpense } from "@/lib/site/expensesServer";
import { buildRegisterWorkbook, type RegisterRow } from "@/lib/site/register";
import { failure, isMissingSchema, loadActorNames, needsUpdate, openSiteRequest } from "@/lib/site/server";
import { PAID_BY_LABEL, isUuid } from "@/lib/site/types";

// The daily register of approved expenses for Finance (the interface to the ERP while the live push is parked). Cost approvers and admins only.
// GET  /api/site-expenses/register[?project_id=][&all=1]  -> an Excel file of approved expenses not yet marked sent (all=1: every approved one)
// POST /api/site-expenses/register  { ids: [uuid] }        -> marks those approved, not-yet-sent expenses as sent to the ERP (the person who uploaded
//      the file does this). Only an approved expense changes; the amount, the approval and the evidence are never touched.

export async function GET(request: NextRequest) {
  const gate = await openSiteRequest("site_expenses");
  if (!gate.ok) return failure(gate);
  const scope = await loadViewerScope(gate.req);
  if (!scope.isCost) return NextResponse.json({ error: "Only a cost approver can download the register" }, { status: 403 });
  const { admin, tenantId } = gate.req;
  const q = request.nextUrl.searchParams;
  let query = admin.from("site_expenses").select(EXPENSE_COLS).eq("tenant_id", tenantId).eq("status", "approved");
  if (q.get("all") !== "1") query = query.neq("erp_state", "sent").neq("erp_state", "posted");
  const pid = q.get("project_id");
  if (pid) { if (!isUuid(pid)) return NextResponse.json({ error: "Not found" }, { status: 404 }); query = query.eq("project_id", pid); }
  const { data, error } = await query.order("approved_at", { ascending: true }).limit(5000);
  if (error) return isMissingSchema(error) ? failure(needsUpdate("site_expenses")) : NextResponse.json({ error: error.message }, { status: 500 });
  const list = ((data ?? []) as Record<string, unknown>[]).map(normaliseExpense);

  const projectIds = [...new Set(list.map((e) => e.project_id))];
  const catIds = [...new Set(list.map((e) => e.category_id).filter((x): x is string => !!x))];
  const [projects, cats, names, tenant] = await Promise.all([
    projectIds.length ? admin.from("contract_projects").select("id, ref, name").eq("tenant_id", tenantId).in("id", projectIds) : Promise.resolve({ data: [] }),
    catIds.length ? admin.from("site_expense_categories").select("id, name, erp_category, resource_code, cost_code").eq("tenant_id", tenantId).in("id", catIds) : Promise.resolve({ data: [] }),
    loadActorNames(admin, tenantId, list.flatMap((e) => [e.submitted_by, e.approved_by])),
    admin.from("tenants").select("name").eq("id", tenantId).maybeSingle(),
  ]);
  const pm = new Map(((projects.data ?? []) as { id: string; ref: string | null; name: string }[]).map((p) => [p.id, p]));
  const cm = new Map(((cats.data ?? []) as { id: string; name: string; erp_category: string | null; resource_code: string | null; cost_code: string | null }[]).map((c) => [c.id, c]));
  const lineNames = new Map<string, string>();
  const keys = [...new Set(list.map((e) => e.line_key).filter((x): x is string => !!x))];
  for (let i = 0; i < keys.length; i += 100) {
    const { data: ls } = await admin.from("project_budget_lines").select("line_key, description").eq("tenant_id", tenantId).in("line_key", keys.slice(i, i + 100)).limit(1000);
    for (const l of (ls ?? []) as { line_key: string; description: string }[]) lineNames.set(l.line_key, l.description);
  }
  const rows: RegisterRow[] = list.map((e) => {
    const c = e.category_id ? cm.get(e.category_id) : undefined;
    return {
      ref: e.ref ?? "", project_ref: pm.get(e.project_id)?.ref ?? null, project_name: pm.get(e.project_id)?.name ?? "", expense_date: e.expense_date,
      category: c?.name ?? "", erp_category: c?.erp_category ?? null, resource_code: c?.resource_code ?? null, cost_code: c?.cost_code ?? null, wbs_code: e.wbs_code,
      cost_line: e.line_key ? lineNames.get(e.line_key) ?? null : null, vendor: e.vendor_text, invoice_ref: e.invoice_ref, currency: e.currency, amount: e.amount,
      amount_project_ccy: e.amount_project_ccy, vat_amount: e.vat_amount, paid_by: PAID_BY_LABEL[e.paid_by] ?? e.paid_by,
      document_state: e.document_state === "invoice_to_follow" ? "Invoice to follow" : "Receipt attached", submitted_by: names.get(e.submitted_by) ?? "",
      approved_by: e.approved_by ? names.get(e.approved_by) ?? "" : "", approved_at: e.approved_at, note: e.note,
    };
  });
  const buffer = await buildRegisterWorkbook(rows, { generated: new Date().toISOString().slice(0, 10), tenantName: (tenant.data as { name?: string } | null)?.name ?? "BPMSquare" });
  return new NextResponse(new Uint8Array(buffer), {
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="site-expenses-${new Date().toISOString().slice(0, 10)}.xlsx"`, "Cache-Control": "no-store" },
  });
}

export async function POST(request: NextRequest) {
  const gate = await openSiteRequest("site_expenses");
  if (!gate.ok) return failure(gate);
  const scope = await loadViewerScope(gate.req);
  if (!scope.isCost) return NextResponse.json({ error: "Only a cost approver can mark expenses as sent" }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { ids?: unknown };
  const ids = Array.isArray(body.ids) ? [...new Set(body.ids.filter(isUuid))].slice(0, 500) : [];
  if (ids.length === 0) return NextResponse.json({ error: "Choose the expenses to mark as sent" }, { status: 400 });
  const { admin, tenantId, userId, supabase } = gate.req;
  const now = new Date().toISOString();
  const upd = await admin.from("site_expenses").update({ erp_state: "sent", sent_at: now, sent_by: userId, updated_at: now })
    .eq("tenant_id", tenantId).eq("status", "approved").in("id", ids).neq("erp_state", "sent").neq("erp_state", "posted").select("id, ref");
  if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 500 });
  const done = (upd.data ?? []) as { id: string; ref: string | null }[];
  const user = await getAuthUser();
  for (const r of done) await logChange(supabase, { tenantId, objectType: "site_expenses", objectId: r.id, objectLabel: r.ref, action: "update", actorId: user?.id, actorEmail: user?.email, changes: [{ field: "Sent to ERP", from: "Not sent", to: "Sent (register)" }] });
  return NextResponse.json({ marked: done.length });
}
