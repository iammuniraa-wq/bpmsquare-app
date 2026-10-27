import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { getTenant } from "@/lib/tenant";
import { resolveCurrency } from "@/lib/currency";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { resolvePermissions, canEditWorkcenter } from "@/lib/permissions";
import { getEffectiveFieldConfig, getSalesConfig } from "@/lib/fieldConfig";
import { buildObjectSpec } from "@/lib/import/registrySchema";
import { validateRow, hasBlockingIssue } from "@/lib/import/validate";
import { collectCustomData, describeDbError, fetchAllRows, nameKey, readImportBody, summarise } from "@/lib/import/server";
import { diffForLog, logChangeBatch, type ChangeLogEntryParams } from "@/lib/changeLog";
import { insertOrderWithRef } from "@/lib/salesOrders/create";
import { chooseOrderType } from "@/lib/salesOrders/typeSelect";
import { cleanCurrency, cleanText } from "@/lib/salesOrders/clean";
import { cleanDate, clampMoney } from "@/lib/salesOrders/totals";
import { loadTypes } from "@/lib/salesOrders/server";
import type { RowOutcome } from "@/lib/import/types";

// Data Workbench import of sales orders (bpmsquarecore 3b-4): creates DRAFT headers by account (and contact) NAME, the
// create-time business key (section 3), with the order type picked by name or by the type rules. The Order ID is
// generated here, never read from the file; status, pricing mode and totals are computed, never imported. An order made
// this way has no lines yet -- they are added with Sales Order Lines, keyed on the Order ID an export shows. Same insert
// path as POST /api/sales-orders (type prefix numbering, tenant currency).
export async function POST(request: NextRequest) {
  let supabase, tenantId, userId, role;
  try {
    ({ supabase, tenantId, userId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  // A tenant without the module cannot read or write its data in bulk either.
  const gate = await assertObjectFeature(tenantId, "sales_orders");
  if (gate) return gate;
  const perms = await resolvePermissions(supabase, tenantId, userId, role);
  if (!canEditWorkcenter(perms, "sales_orders")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rows = readImportBody(await request.json());
  if (!rows) return NextResponse.json({ error: "No rows provided" }, { status: 400 });

  const [fieldConfig, salesConfig, accounts, contacts, typesRes, tenant] = await Promise.all([
    getEffectiveFieldConfig(supabase, tenantId, "sales_order"),
    getSalesConfig(supabase, tenantId),
    fetchAllRows<{ id: string; name: string; type: string | null; state: string | null; country: string | null; custom_data: Record<string, unknown> | null }>(supabase, "accounts", "id, name, type, state, country, custom_data", tenantId),
    fetchAllRows<{ id: string; name: string; account_id: string | null }>(supabase, "contacts", "id, name, account_id", tenantId),
    loadTypes(supabase, tenantId),
    getTenant(),
  ]);
  if (typesRes.pending) return NextResponse.json({ error: "A database update is needed before Sales Orders can be used." }, { status: 503 });
  const spec = buildObjectSpec("sales_orders", fieldConfig, salesConfig);
  const accountByName = new Map(accounts.map((a) => [nameKey(a.name), a]));
  const contactByKey = new Map(contacts.map((c) => [`${c.account_id}|${nameKey(c.name)}`, c.id]));
  const typeByName = new Map(typesRes.types.map((t) => [nameKey(t.name), t]));
  const defaultCurrency = resolveCurrency(tenant?.config).code;

  const outcomes: RowOutcome[] = [];
  const logRows: ChangeLogEntryParams[] = [];
  const user = await getAuthUser();

  for (const { rowNum, values } of rows) {
    const validated = validateRow(spec, values, rowNum);
    if (hasBlockingIssue(validated)) {
      outcomes.push({ rowNum, status: "failed", reason: validated.issues.filter((i) => i.severity === "error").map((i) => i.message).join("; ") });
      continue;
    }
    const v = validated.values;

    const account = accountByName.get(nameKey(v.account_name ?? ""));
    if (!account) {
      outcomes.push({ rowNum, status: "failed", reason: `Account "${v.account_name ?? ""}" was not found. Import accounts first, or check the spelling` });
      continue;
    }
    let contactId: string | null = null;
    if (v.contact_name) {
      contactId = contactByKey.get(`${account.id}|${nameKey(v.contact_name)}`) ?? null;
      if (!contactId) {
        outcomes.push({ rowNum, status: "failed", reason: `Contact "${v.contact_name}" was not found at that account` });
        continue;
      }
    }
    let typeId: string | null = null;
    if (v.type_name) {
      const t = typeByName.get(nameKey(v.type_name));
      if (!t || !t.active) {
        outcomes.push({ rowNum, status: "failed", reason: `Order type "${v.type_name}" was not found, or is switched off. Check Settings > Order types` });
        continue;
      }
      typeId = t.id;
    }
    const choice = await chooseOrderType(supabase, tenantId, { typeId, account, sourceType: "direct" });
    if (!choice.ok) {
      outcomes.push({ rowNum, status: "failed", reason: choice.error });
      continue;
    }

    const shipping = clampMoney(v.shipping_amount);
    const custom = collectCustomData(values);
    const record = {
      type_id: choice.type.id,
      origin: "bpmsquare",
      status: "draft",
      spine: "open",
      account_id: account.id,
      contact_id: contactId,
      customer_po: cleanText(v.customer_po, 100),
      source_type: "direct",
      currency: cleanCurrency(v.currency) ?? defaultCurrency,
      pricing_mode: choice.type.pricing_mode,
      subtotal: 0, discount_total: 0, tax_total: 0, shipping_amount: shipping, total: shipping,
      requested_date: cleanDate(v.requested_date),
      notes: cleanText(v.notes, 4000),
      terms: cleanText(v.terms, 4000),
      owner_user_id: userId,
      created_by: userId,
      ...(custom ? { custom_data: custom } : {}),
    };

    const made = await insertOrderWithRef(supabase, tenantId, choice.type.prefix, record);
    if (!made.data) {
      outcomes.push({ rowNum, status: "failed", reason: describeDbError(made.error) || "could not be saved" });
      continue;
    }
    outcomes.push({ rowNum, status: "inserted" });
    logRows.push({
      tenantId, objectType: "sales_orders", objectId: made.data.id, objectLabel: made.data.ref,
      action: "create", actorId: user?.id, actorEmail: user?.email,
      changes: diffForLog("sales_orders", {}, { account_id: account.id, contact_id: contactId, type: choice.type.name, total: record.total }),
    });
  }

  if (logRows.length > 0) await logChangeBatch(supabase, logRows);
  return NextResponse.json(summarise(outcomes));
}
