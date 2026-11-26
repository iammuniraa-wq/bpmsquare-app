import { NextResponse } from "next/server";
import { RECEIPT_REASONS } from "@/lib/site/types";
import { failure, loadCategories, loadCostLineChoices, loadSiteProjects, openSiteRequest } from "@/lib/site/server";
import { loadExpectedDeliveries } from "@/lib/site/receiptsServer";

// GET /api/site/bootstrap  -> what the phone caches on each open so it can capture with no signal: the projects that take site entries, each with
//   its cost line NAMES (no amount, no quantity of money), its expected deliveries (quantities only), the expense categories and the reason list.
//   A site person never sees a budget figure; none is in this answer. Needs either site module.
export async function GET() {
  const gate = await openSiteRequest("any");
  if (!gate.ok) return failure(gate);
  const { admin, tenantId, userId, features } = gate.req;
  const expenses = features.site_expenses === true;
  const receipts = features.site_receipts === true;
  const projects = (await loadSiteProjects(admin, tenantId)).slice(0, 60);
  const categories = expenses ? (await loadCategories(admin, tenantId, { activeOnly: true })).rows.map((c) => ({ id: c.id, name: c.name, resource_code: c.resource_code })) : [];
  const out = [];
  for (const p of projects) {
    out.push({
      id: p.id, ref: p.ref, name: p.name, currency: p.currency,
      lines: expenses ? (await loadCostLineChoices(admin, tenantId, p.id)).slice(0, 1500) : [],
      deliveries: receipts ? await loadExpectedDeliveries(admin, tenantId, p.id).catch(() => []) : [],
    });
  }
  return NextResponse.json({ user_id: userId, modules: { expenses, receipts }, projects: out, categories, reasons: RECEIPT_REASONS, fetched_at: new Date().toISOString() });
}
