import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { getEffectiveFieldConfig, getSalesConfig } from "@/lib/fieldConfig";
import { buildObjectSpec } from "@/lib/import/registrySchema";
import { validateRow, hasBlockingIssue } from "@/lib/import/validate";
import {
  collectCustomData,
  fetchAllRows,
  insertRows,
  nameKey,
  readImportBody,
  summarise,
  type PreparedRow,
} from "@/lib/import/server";
import type { RowOutcome } from "@/lib/import/types";

export async function POST(request: NextRequest) {
  let supabase, tenantId, userId;
  try {
    ({ supabase, tenantId, userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const rows = readImportBody(await request.json());
  if (!rows) return NextResponse.json({ error: "No rows provided" }, { status: 400 });

  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1).toISOString();
  const yearEnd = new Date(now.getFullYear() + 1, 0, 1).toISOString();

  const [fieldConfig, salesConfig, accounts, contacts, quotes, workOrders, { count: existingCount }] = await Promise.all([
    getEffectiveFieldConfig(supabase, tenantId, "invoice"),
    getSalesConfig(supabase, tenantId),
    fetchAllRows<{ id: string; name: string }>(supabase, "accounts", "id, name", tenantId),
    fetchAllRows<{ id: string; name: string }>(supabase, "contacts", "id, name", tenantId),
    fetchAllRows<{ id: string; ref: string }>(supabase, "quotes", "id, ref", tenantId),
    fetchAllRows<{ id: string; ref: string }>(supabase, "work_orders", "id, ref", tenantId),
    supabase.from("invoices").select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).gte("created_at", yearStart).lt("created_at", yearEnd),
  ]);
  const spec = buildObjectSpec("invoices", fieldConfig, salesConfig);
  const accountByName = new Map(accounts.map((a) => [nameKey(a.name), a.id]));
  const contactByName = new Map(contacts.map((c) => [nameKey(c.name), c.id]));
  const quoteByRef = new Map(quotes.map((q) => [nameKey(q.ref), q.id]));
  const workOrderByRef = new Map(workOrders.map((w) => [nameKey(w.ref), w.id]));

  const prepared: PreparedRow[] = [];
  const outcomes: RowOutcome[] = [];
  let seq = (existingCount ?? 0) + 1;

  for (const { rowNum, values } of rows) {
    const validated = validateRow(spec, values, rowNum);
    if (hasBlockingIssue(validated)) {
      outcomes.push({
        rowNum,
        status: "failed",
        reason: validated.issues.filter((i) => i.severity === "error").map((i) => i.message).join("; "),
      });
      continue;
    }

    const v = validated.values;
    const accountId = accountByName.get(nameKey(v.account_name));
    if (!accountId) {
      outcomes.push({
        rowNum,
        status: "failed",
        reason: `Account "${v.account_name}" was not found — import accounts first`,
      });
      continue;
    }

    let contactId: string | null = null;
    if (v.contact_name) {
      contactId = contactByName.get(nameKey(v.contact_name)) ?? null;
      if (!contactId) {
        outcomes.push({ rowNum, status: "failed", reason: `Contact "${v.contact_name}" was not found` });
        continue;
      }
    }

    let quoteId: string | null = null;
    if (v.quote_ref) {
      quoteId = quoteByRef.get(nameKey(v.quote_ref)) ?? null;
      if (!quoteId) {
        outcomes.push({ rowNum, status: "failed", reason: `Quote "${v.quote_ref}" was not found` });
        continue;
      }
    }

    let workOrderId: string | null = null;
    if (v.work_order_ref) {
      workOrderId = workOrderByRef.get(nameKey(v.work_order_ref)) ?? null;
      if (!workOrderId) {
        outcomes.push({ rowNum, status: "failed", reason: `Work order "${v.work_order_ref}" was not found` });
        continue;
      }
    }

    const custom = collectCustomData(values);
    const ref = `INV-${now.getFullYear()}-${String(seq).padStart(4, "0")}`;
    seq++;

    prepared.push({
      rowNum,
      record: {
        tenant_id: tenantId,
        account_id: accountId,
        contact_id: contactId,
        ref,
        work_order_id: workOrderId,
        quote_id: quoteId,
        status: "draft",
        total: 0,
        due_date: v.due_date || null,
        discount_type: "pct",
        discount_pct: 0,
        discount_fixed: 0,
        notes: v.notes ?? null,
        terms: v.terms ?? null,
        created_by: userId,
        ...(custom ? { custom_data: custom } : {}),
      },
    });
  }

  if (prepared.length === 0) return NextResponse.json(summarise(outcomes));
  return NextResponse.json(await insertRows(supabase, "invoices", prepared, outcomes));
}
