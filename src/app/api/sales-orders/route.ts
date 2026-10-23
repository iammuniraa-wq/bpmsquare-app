import { NextResponse, type NextRequest } from "next/server";
import { getAuthUser } from "@/lib/supabase-server";
import { getTenant } from "@/lib/tenant";
import { resolveCurrency } from "@/lib/currency";
import { diffForLog, logChange } from "@/lib/changeLog";
import { emitOrderCreated } from "@/lib/events/emitters";
import { cfOnly } from "@/lib/customData";
import { cleanCurrency, cleanParty, cleanText, parseListParams, searchTerm } from "@/lib/salesOrders/clean";
import { insertOrderWithRef, lineRows } from "@/lib/salesOrders/create";
import { findOrderFromSource, loadSourceDraft, type SourceDraft } from "@/lib/salesOrders/fromSource";
import { pricingModeFor } from "@/lib/salesOrders/rules";
import { checkLineProducts, failure, guard, emptyPending, needsUpdate, pending } from "@/lib/salesOrders/server";
import { chooseOrderType } from "@/lib/salesOrders/typeSelect";
import { cleanDate, cleanOrderLines, clampMoney, computeOrderTotals, type CleanOrderLine } from "@/lib/salesOrders/totals";
import type { OrderSourceType } from "@/lib/salesOrders/types";

// Sales orders (docs/design/sales-order-build-spec-so1.md).
//
// GET  /api/sales-orders?status=&account_id=&q=&sort=&dir=&page=&page_size=
//   -> { rows: [{ id, ref, status, status_label, spine, origin, account_id, account_name, type_id, type_name, pricing_mode,
//                 total, currency, requested_date, expected_date, customer_po, source_type, source_id, created_at, updated_at }],
//        total, page, page_size, pages, needsDatabaseUpdate? }
// POST /api/sales-orders { type_id?, account_id, contact_id?, bill_to?, ship_to?, customer_po?, requested_date?, currency?,
//                          notes?, terms?, shipping_amount?, opportunity_id?, custom_data?, lines, source?: { type, id }, confirm_another? }
//   -> 201 the order row plus { lines }. With `source` the server copies lines, prices, tax, discount, currency, account and
//      pricing mode from the accepted / won source; one order per source unless confirm_another (409 otherwise).

export async function GET(req: NextRequest) {
  let ctx;
  try { ctx = await guard(); } catch (e) { return failure(e); }
  const { supabase, tenantId } = ctx;
  const p = parseListParams(new URL(req.url).searchParams);

  let query = supabase.from("sales_orders").select("*", { count: "exact" }).eq("tenant_id", tenantId);
  if (p.status) query = query.eq("status", p.status);
  if (p.account_id) query = query.eq("account_id", p.account_id);
  if (p.q) {
    const term = searchTerm(p.q);
    if (term) {
      const { data: accs } = await supabase.from("accounts").select("id").eq("tenant_id", tenantId).ilike("name", `%${term}%`).limit(50);
      const ids = ((accs ?? []) as { id: string }[]).map((a) => a.id);
      const clauses = [`ref.ilike.%${term}%`, `customer_po.ilike.%${term}%`];
      if (ids.length > 0) clauses.push(`account_id.in.(${ids.join(",")})`);
      query = query.or(clauses.join(","));
    }
  }
  const from = (p.page - 1) * p.page_size;
  const { data, error, count } = await query.order(p.sort, { ascending: p.dir === "asc" }).range(from, from + p.page_size - 1);
  if (error) return pending(error) ? emptyPending() : NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as Record<string, unknown>[];
  const accountIds = [...new Set(rows.map((r) => r.account_id as string))];
  const typeIds = [...new Set(rows.map((r) => r.type_id as string | null).filter((x): x is string => !!x))];
  const [{ data: accs }, { data: types }] = await Promise.all([
    accountIds.length ? supabase.from("accounts").select("id, name").eq("tenant_id", tenantId).in("id", accountIds) : Promise.resolve({ data: [] }),
    typeIds.length ? supabase.from("sales_order_types").select("id, name").eq("tenant_id", tenantId).in("id", typeIds) : Promise.resolve({ data: [] }),
  ]);
  const accountName = new Map(((accs ?? []) as { id: string; name: string }[]).map((a) => [a.id, a.name]));
  const typeName = new Map(((types ?? []) as { id: string; name: string }[]).map((t) => [t.id, t.name]));
  const total = count ?? from + rows.length;

  return NextResponse.json({
    rows: rows.map((r) => ({
      id: r.id, ref: r.ref, status: r.status, status_label: r.status_label ?? null, spine: r.spine, origin: r.origin,
      account_id: r.account_id, account_name: accountName.get(r.account_id as string) ?? null,
      type_id: r.type_id ?? null, type_name: r.type_id ? typeName.get(r.type_id as string) ?? null : null,
      pricing_mode: r.pricing_mode, total: Number(r.total ?? 0), currency: r.currency,
      requested_date: r.requested_date ?? null, expected_date: r.expected_date ?? null, customer_po: r.customer_po ?? null,
      source_type: r.source_type, source_id: r.source_id ?? null, created_at: r.created_at, updated_at: r.updated_at,
    })),
    total, page: p.page, page_size: p.page_size, pages: Math.max(1, Math.ceil(total / p.page_size)),
  });
}

export async function POST(req: NextRequest) {
  let ctx;
  try { ctx = await guard(); } catch (e) { return failure(e); }
  const { supabase, tenantId, userId } = ctx;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  // 1. The source, if any: it decides the account, lines, prices, pricing mode and currency.
  let draft: SourceDraft | null = null;
  const src = body.source as { type?: unknown; id?: unknown } | undefined;
  if (src !== undefined && src !== null) {
    if (typeof src !== "object" || typeof src.type !== "string" || typeof src.id !== "string") {
      return NextResponse.json({ error: "source must be { type, id }" }, { status: 400 });
    }
    const loaded = await loadSourceDraft(supabase, tenantId, { type: src.type, id: src.id });
    if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status });
    draft = loaded.draft;
    if (draft.source_type !== "order") {
      const existing = await findOrderFromSource(supabase, tenantId, draft.source_type, draft.source_id);
      if (existing.length > 0 && body.confirm_another !== true) {
        return NextResponse.json(
          { error: `An order already exists for this ${draft.source_type.replace("_", " ")}: ${existing[0].ref}. Send confirm_another to make another.`, existing, needs_confirmation: true },
          { status: 409 },
        );
      }
    }
  }
  const sourceType: OrderSourceType = draft?.source_type ?? "direct";

  // 2. The customer and the other foreign ids, each checked against this tenant.
  const accountId = draft?.account_id ?? (typeof body.account_id === "string" ? body.account_id : "");
  if (!accountId) return NextResponse.json({ error: "account_id is required" }, { status: 400 });
  const { data: account } = await supabase.from("accounts").select("id, type, state, country, custom_data").eq("id", accountId).eq("tenant_id", tenantId).maybeSingle();
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  let contactId: string | null = draft?.contact_id ?? null;
  if (typeof body.contact_id === "string" && body.contact_id) {
    const { data: contact } = await supabase.from("contacts").select("id").eq("id", body.contact_id).eq("tenant_id", tenantId).maybeSingle();
    if (!contact) return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    contactId = body.contact_id;
  }

  let opportunityId: string | null = draft?.opportunity_id ?? null;
  if (typeof body.opportunity_id === "string" && body.opportunity_id) {
    const { data: opp, error: oppErr } = await supabase.from("opportunities").select("id").eq("id", body.opportunity_id).eq("tenant_id", tenantId).maybeSingle();
    if (oppErr || !opp) return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    opportunityId = body.opportunity_id;
  }

  // 3. The order type; pricing mode comes from the type, or from the source quote.
  const choice = await chooseOrderType(supabase, tenantId, {
    typeId: typeof body.type_id === "string" && body.type_id ? body.type_id : null,
    account: account as { type?: string | null; state?: string | null; country?: string | null; custom_data?: Record<string, unknown> | null },
    sourceType,
  });
  if (!choice.ok) return choice.needsUpdate ? needsUpdate() : NextResponse.json({ error: choice.error }, { status: choice.status });
  const type = choice.type;
  const pricingMode = pricingModeFor(type, draft?.pricing_mode ?? null);

  // 4. Lines: copied from the source, else the body. Products are verified (refused from a body, dropped from a copy).
  const rawLines: CleanOrderLine[] = draft ? draft.lines : cleanOrderLines(body.lines);
  const checked = await checkLineProducts(supabase, tenantId, rawLines, !draft);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 404 });
  const lines = checked.lines;

  const tenant = await getTenant();
  const currency = draft?.currency ?? cleanCurrency(body.currency) ?? resolveCurrency(tenant?.config).code;
  const shipping = draft ? draft.shipping_amount : clampMoney(body.shipping_amount);
  const totals = computeOrderTotals(lines, shipping);
  const customData = cfOnly(body.custom_data);

  const header = {
    type_id: type.id,
    origin: "bpmsquare",
    status: "draft",
    spine: "open",
    account_id: accountId,
    contact_id: contactId,
    bill_to: cleanParty(body.bill_to),
    ship_to: cleanParty(body.ship_to),
    customer_po: cleanText(body.customer_po, 100) ?? draft?.customer_po ?? null,
    source_type: sourceType,
    source_id: draft?.source_id ?? null,
    opportunity_id: opportunityId,
    currency,
    pricing_mode: pricingMode,
    ...totals,
    requested_date: cleanDate(body.requested_date),
    notes: cleanText(body.notes, 4000) ?? draft?.notes ?? null,
    terms: cleanText(body.terms, 4000) ?? draft?.terms ?? null,
    owner_user_id: userId,
    custom_data: customData && Object.keys(customData).length > 0 ? customData : null,
    created_by: userId,
  };

  const inserted = await insertOrderWithRef(supabase, tenantId, type.prefix, header);
  if (!inserted.data) {
    if (pending(inserted.error)) return needsUpdate();
    return NextResponse.json({ error: inserted.error?.message ?? "Failed to create the order" }, { status: 500 });
  }
  const order = inserted.data;

  if (lines.length > 0) {
    const { error: linesErr } = await supabase.from("sales_order_lines").insert(lineRows(tenantId, order.id, lines));
    if (linesErr) {
      await supabase.from("sales_orders").delete().eq("id", order.id).eq("tenant_id", tenantId);
      return NextResponse.json({ error: linesErr.message }, { status: 500 });
    }
  }

  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "sales_orders", objectId: order.id, objectLabel: order.ref,
    action: "create", actorId: user?.id, actorEmail: user?.email,
    changes: [
      ...(draft ? [{ field: `Created from ${draft.source_type.replace("_", " ")}`, from: null, to: draft.source_ref ?? draft.source_id }] : []),
      ...diffForLog("sales_orders", {}, { account_id: accountId, type: type.name, pricing_mode: pricingMode, total: totals.total }),
    ],
  });
  await emitOrderCreated(tenantId, {
    orderId: order.id, ref: order.ref, total: totals.total, accountId, contactId, actorId: user?.id,
    sourceType, sourceId: draft?.source_id ?? null, typeId: type.id,
  });

  const { data: row } = await supabase.from("sales_orders").select("*").eq("id", order.id).eq("tenant_id", tenantId).maybeSingle();
  const { data: savedLines } = await supabase.from("sales_order_lines").select("*").eq("order_id", order.id).eq("tenant_id", tenantId).order("line_no");
  return NextResponse.json({ ...(row ?? { id: order.id, ref: order.ref }), lines: savedLines ?? [] }, { status: 201 });
}
