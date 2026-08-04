import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { generateNextQuoteRef } from "@/lib/quoteRef";
import { DEFAULT_QUOTE_ID_FORMAT, type QuoteIdFormat, type TenantConfig } from "@/lib/constants";
import { sanitizeRichText } from "@/lib/sanitizeHtml";
import { diffForLog, logChange } from "@/lib/changeLog";

export async function POST(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const body = await request.json();
  const {
    account_id, type, total, quote_date, valid_until, notes, terms, scope_of_work,
    entity_id, lines, selected_option_id, meta,
    name, contact_id, pr_no, po_number, po_amount, ref_no,
    discount_type, discount_pct, discount_fixed, gst_rate, asset_ids,
    case_id, custom_data,
  } = body;

  if (!account_id) {
    return NextResponse.json({ error: "account_id is required" }, { status: 400 });
  }

  // Verify account belongs to this tenant
  const { data: acct } = await supabase
    .from("accounts")
    .select("id, territory, sales_org")
    .eq("id", account_id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!acct) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  // contact_id/asset_ids come straight from the request body -- verify each
  // belongs to this tenant before it's woven into the new quote, same pattern
  // as the invoices route already uses for its foreign ids. Without this, a
  // tenant-A caller could splice in a tenant-B contact/asset id and have that
  // tenant's (decrypted) PII rendered on this quote, including via the public
  // print/WhatsApp link.
  if (contact_id) {
    const { data: contact } = await supabase.from("contacts").select("id").eq("id", contact_id).eq("tenant_id", tenantId).maybeSingle();
    if (!contact) return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }
  const assetIdsArr: string[] = Array.isArray(asset_ids) ? asset_ids : [];
  if (assetIdsArr.length > 0) {
    const { data: verifiedAssets } = await supabase.from("assets").select("id").in("id", assetIdsArr).eq("tenant_id", tenantId);
    if (!verifiedAssets || verifiedAssets.length !== new Set(assetIdsArr).size) {
      return NextResponse.json({ error: "One or more assets not found" }, { status: 404 });
    }
  }

  // Server-side sequential ref generation — tenant's own Quote ID format, or the default.
  const admin = createAdminSupabase();
  const { data: tenantRow } = await admin.from("tenants").select("config").eq("id", tenantId).maybeSingle();
  const quoteIdFormat: QuoteIdFormat = (tenantRow?.config as TenantConfig | null)?.quote_id_format ?? DEFAULT_QUOTE_ID_FORMAT;

  const baseInsert = {
    tenant_id: tenantId,
    account_id,
    type: type ?? "quotation",
    status: "draft",
    total: total ?? 0,
    quote_date: quote_date || null,
    valid_until: valid_until || null,
    notes: notes || null,
    terms: terms || null,
    scope_of_work: sanitizeRichText(scope_of_work),
    entity_id: entity_id || null,
    name: name || null,
    contact_id: contact_id || null,
    pr_no: pr_no || null,
    po_number: po_number || null,
    po_amount: po_amount ? parseFloat(po_amount) : null,
    ref_no: ref_no || null,
    discount_type: discount_type ?? "pct",
    discount_pct: parseFloat(discount_pct) || 0,
    discount_fixed: parseFloat(discount_fixed) || 0,
    gst_rate: gst_rate !== undefined && gst_rate !== null && gst_rate !== "" ? parseFloat(gst_rate) : null,
    asset_ids: assetIdsArr,
    revision: 1,
    selected_option_id: selected_option_id ?? null,
    meta: meta ?? null,
    custom_data: custom_data ?? null,
    territory: acct!.territory || null,
    sales_org: acct!.sales_org || null,
  };

  // Retry a few times on a (tenant_id, ref) collision -- narrow race window between
  // computing the next sequence number and the insert actually landing.
  let quote: { id: string; ref: string } | null = null;
  let qErr: { message: string; code?: string } | null = null;
  for (let attempt = 0; attempt < 3 && !quote; attempt++) {
    const ref = await generateNextQuoteRef(supabase, tenantId, quoteIdFormat);
    const result = await supabase
      .from("quotes")
      .insert({ ...baseInsert, ref })
      .select("id, ref")
      .single();
    if (!result.error) {
      quote = result.data;
    } else if (result.error.code === "23505") {
      qErr = result.error;
      continue; // unique-constraint collision -- recompute and retry
    } else {
      qErr = result.error;
      break;
    }
  }

  if (!quote) return NextResponse.json({ error: qErr?.message ?? "Failed to create quote" }, { status: 500 });

  if (Array.isArray(lines) && lines.length > 0) {
    const lineRows = lines
      .filter((l) => l.description?.trim())
      .slice(0, 200)
      .map((l) => {
        const qty  = Math.max(0, parseFloat(l.qty) || 1);
        const rate = Math.max(0, parseFloat(l.rate) || 0);
        const disc = Math.max(0, Math.min(100, parseFloat(l.discount_pct) || 0));
        return {
          tenant_id: tenantId,
          quote_id: quote.id,
          description: String(l.description),
          uom: l.uom || null,
          qty,
          rate,
          discount_pct: disc,
          amount: qty * rate * (1 - disc / 100),
          sl_no:             l.sl_no             ?? null,
          group_id:          l.group_id          ?? null,
          group_label:       l.group_label       ?? null,
          group_type:        l.group_type        ?? null,
          group_description: l.group_description ?? null,
          category:          l.category          ?? null,
          deduction:         l.category === "material" ? Math.max(0, parseFloat(l.deduction) || 0) : 0,
          inventory_item_id: l.inventory_item_id  ?? null,
        };
      });
    if (lineRows.length > 0) {
      const { error: lErr } = await supabase.from("quote_lines").insert(lineRows);
      if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 });
    }
  }

  // Link quote back to the originating case
  if (case_id) {
    await supabase
      .from("service_cases")
      .update({ quote_id: quote.id, status: "quote_sent" })
      .eq("id", case_id)
      .eq("tenant_id", tenantId);
  }

  await supabase.from("quote_revisions").insert({
    tenant_id: tenantId,
    quote_id: quote.id,
    rev: 1,
    date: new Date().toISOString().split("T")[0],
    description: "Initial draft",
  });

  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "quotes", objectId: quote.id, objectLabel: quote.ref,
    action: "create", actorId: user?.id, actorEmail: user?.email,
    changes: diffForLog("quotes", {}, {
      account_id, type: type ?? "quotation", name, contact_id, total: total ?? 0,
      valid_until, ref_no, po_number, po_amount, gst_rate,
    }),
  });

  return NextResponse.json({ id: quote.id, ref: quote.ref }, { status: 201 });
}
