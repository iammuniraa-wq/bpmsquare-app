import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { sanitizeRichText } from "@/lib/sanitizeHtml";
import { diffForLog, diffLineItems, logChange, type LineSnapshot } from "@/lib/changeLog";
import { parseDateOverride } from "@/lib/dateProfile";

// Full edit of a DRAFT quote: header fields + line items (replaced wholesale).
// Server enforces draft-only; sent/approved quotes must use /revise instead.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;
  const body = await request.json();
  const {
    quote_date, valid_until, notes, terms, scope_of_work, lines, selected_option_id, status,
    territory, sales_org, gst_rate, account_id, contact_id,
    name, entity_id, ref_no, pr_no, po_number, po_amount,
    discount_type, discount_pct, discount_fixed, asset_ids, custom_data,
    inquiry_date,
  } = body;

  const { data: quote, error: qErr } = await supabase
    .from("quotes")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .single();

  if (qErr || !quote) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }
  if (quote.superseded_by) {
    return NextResponse.json({ error: "This version has been superseded and is read-only -- edit the latest version instead." }, { status: 409 });
  }

  const { data: beforeLines } = await supabase
    .from("quote_lines")
    .select("description, qty, rate, amount")
    .eq("quote_id", id)
    .eq("tenant_id", tenantId)
    .order("sl_no", { ascending: true, nullsFirst: false });

  if (account_id !== undefined) {
    const { data: acct } = await supabase
      .from("accounts")
      .select("id")
      .eq("id", account_id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!acct) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  // contact_id/asset_ids come straight from the request body -- verify each
  // belongs to this tenant before it's written, same as the invoices route's
  // existing pattern. Without this, a tenant-A caller could splice in a
  // tenant-B contact/asset id and have that tenant's (decrypted) PII rendered
  // on this quote, including via the public print/WhatsApp link.
  if (contact_id !== undefined && contact_id) {
    const { data: contact } = await supabase.from("contacts").select("id").eq("id", contact_id).eq("tenant_id", tenantId).maybeSingle();
    if (!contact) return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }
  if (Array.isArray(asset_ids) && asset_ids.length > 0) {
    const { data: verifiedAssets } = await supabase.from("assets").select("id").in("id", asset_ids).eq("tenant_id", tenantId);
    if (!verifiedAssets || verifiedAssets.length !== new Set(asset_ids).size) {
      return NextResponse.json({ error: "One or more assets not found" }, { status: 404 });
    }
  }

  // Normalize incoming lines and compute total.
  const cleanLines = Array.isArray(lines)
    ? lines
        .filter((l) => l?.description?.trim())
        .slice(0, 200)
        .map((l) => {
          const qty  = Math.max(0, parseFloat(l.qty) || 0);
          const rate = Math.max(0, parseFloat(l.rate) || 0);
          const disc = Math.max(0, Math.min(100, parseFloat(l.discount_pct) || 0));
          const category = l.category || null;
          const deduction = category === "material" ? Math.max(0, parseFloat(l.deduction) || 0) : 0;
          return {
            tenant_id: tenantId,
            quote_id: id,
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
            category,
            deduction,
            inventory_item_id: l.inventory_item_id ?? null,
          };
        })
    : [];

  // Line-level inventory references are foreign ids from the body like any
  // other -- verify they belong to this tenant before they are written (same
  // check the v1 API's verifyQuoteRelations makes).
  const invIds = [...new Set(cleanLines.map((l) => l.inventory_item_id).filter((x): x is string => typeof x === "string"))];
  if (invIds.length > 0) {
    const { data: invRows } = await supabase.from("inventory_items").select("id").in("id", invIds).eq("tenant_id", tenantId);
    if (!invRows || invRows.length !== invIds.length) {
      return NextResponse.json({ error: "One or more inventory items were not found" }, { status: 404 });
    }
  }

  // selected_option_id marks which "alternative" (Option A/B) group counts toward the total;
  // items in other alternative groups are kept (so the option can be switched later) but excluded here.
  const effectiveAltId: string | null = selected_option_id !== undefined ? selected_option_id : (quote.selected_option_id ?? null);
  const effectiveLines = cleanLines.filter((l) => !l.group_id || l.group_type !== "alternative" || l.group_id === effectiveAltId);
  const subtotal = effectiveLines.reduce((s, l) => s + l.amount, 0);
  const totalDeductions = effectiveLines.reduce((s, l) => s + l.deduction, 0);

  // Discount type/pct/fixed: use body values when the caller sends them (the full
  // edit page does), otherwise fall back to what's already on the row (the modal
  // editor never sent these, so its total must keep matching the existing discount).
  const effectiveDiscountType = discount_type !== undefined ? discount_type : quote.discount_type;
  const effectiveDiscountPct = Math.max(0, Math.min(100, parseFloat(String(
    discount_pct !== undefined ? discount_pct : quote.discount_pct
  )) || 0));
  const effectiveDiscountFixed = Math.max(0, parseFloat(String(
    discount_fixed !== undefined ? discount_fixed : quote.discount_fixed
  )) || 0);
  const discAmount = effectiveDiscountType === "fixed"
    ? Math.min(Math.round(effectiveDiscountFixed), subtotal)
    : Math.round(subtotal * effectiveDiscountPct / 100);
  const total = subtotal - discAmount - totalDeductions;

  const inquiryParse = inquiry_date !== undefined ? parseDateOverride(inquiry_date) : { ok: true as const, date: null };
  if (!inquiryParse.ok) return NextResponse.json({ error: "inquiry_date must be a valid YYYY-MM-DD date" }, { status: 400 });
  const inquiryDateParsed = inquiryParse.ok ? inquiryParse.date : null;

  // Update header
  const headerPatch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    ...(inquiry_date !== undefined ? { inquiry_date: inquiryDateParsed } : {}),
    valid_until: valid_until || null,
    notes: notes ?? null,
    terms: terms ?? null,
    scope_of_work: sanitizeRichText(scope_of_work),
    selected_option_id: effectiveAltId,
    ...(quote_date !== undefined ? { quote_date: quote_date || null } : {}),
    ...(territory !== undefined ? { territory: territory || null } : {}),
    ...(sales_org !== undefined ? { sales_org: sales_org || null } : {}),
    ...(gst_rate !== undefined ? { gst_rate: gst_rate !== null && gst_rate !== "" ? parseFloat(gst_rate) : null } : {}),
    ...(account_id !== undefined ? { account_id } : {}),
    ...(contact_id !== undefined ? { contact_id: contact_id || null } : {}),
    ...(name !== undefined ? { name: name || null } : {}),
    ...(entity_id !== undefined ? { entity_id: entity_id || null } : {}),
    ...(ref_no !== undefined ? { ref_no: ref_no || null } : {}),
    ...(pr_no !== undefined ? { pr_no: pr_no || null } : {}),
    ...(po_number !== undefined ? { po_number: po_number || null } : {}),
    ...(po_amount !== undefined ? { po_amount: po_amount ? parseFloat(po_amount) : null } : {}),
    ...(discount_type !== undefined ? { discount_type: effectiveDiscountType } : {}),
    ...(discount_pct !== undefined ? { discount_pct: effectiveDiscountPct } : {}),
    ...(discount_fixed !== undefined ? { discount_fixed: effectiveDiscountFixed } : {}),
    ...(Array.isArray(asset_ids) ? { asset_ids } : {}),
    ...(custom_data !== undefined ? { custom_data: custom_data && Object.keys(custom_data).length > 0 ? custom_data : null } : {}),
    total,
  };
  if (status !== undefined) headerPatch.status = status;

  const admin = createAdminSupabase();

  const { error: uErr } = await admin
    .from("quotes")
    .update(headerPatch)
    .eq("id", id)
    .eq("tenant_id", tenantId);

  if (uErr) { console.error("[edit] header update failed", uErr); return NextResponse.json({ error: uErr.message }, { status: 500 }); }

  // Replace lines wholesale
  const { error: dErr } = await admin
    .from("quote_lines")
    .delete()
    .eq("quote_id", id)
    .eq("tenant_id", tenantId);

  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });

  if (cleanLines.length > 0) {
    const { error: iErr } = await admin.from("quote_lines").insert(cleanLines);
    if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });
  }

  const { updated_at: _updatedAt, ...headerDiffPatch } = headerPatch;
  const headerChanges = diffForLog("quotes", quote as Record<string, unknown>, headerDiffPatch);
  const beforeLineSnapshots: LineSnapshot[] = (beforeLines ?? []).map((l) => ({
    label: l.description, qty: l.qty, rate: l.rate, amount: l.amount,
  }));
  const afterLineSnapshots: LineSnapshot[] = cleanLines.map((l) => ({
    label: l.description, qty: l.qty, rate: l.rate, amount: l.amount,
  }));
  const changes = [...headerChanges, ...diffLineItems(beforeLineSnapshots, afterLineSnapshots)];
  if (changes.length > 0) {
    const user = await getAuthUser();
    await logChange(supabase, {
      tenantId, objectType: "quotes", objectId: id, objectLabel: (quote as { ref?: string }).ref ?? null,
      action: "update", actorId: user?.id, actorEmail: user?.email, changes,
    });
  }

  return NextResponse.json({ id, total }, { status: 200 });
}
