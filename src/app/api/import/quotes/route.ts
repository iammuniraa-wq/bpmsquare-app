import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";

const VALID_TYPES = ["quotation", "technical", "budgetary", "supply"] as const;

// Flat CSV structure: one row per line item.
// First row for a given quote_name carries all header fields.
// Subsequent rows with the same quote_name carry only line item columns.
//
// Columns: quote_name, account_name, contact_name, type, date, valid_until,
//          scope_of_work, notes, terms, po_number, po_amount,
//          line_description, line_uom, line_qty, line_rate, line_discount_pct,
//          ref_no, pr_no, discount_type, discount_pct, discount_fixed, gst_rate

type CsvRow = Record<string, string>;

interface LineItem {
  description: string;
  uom: string | null;
  qty: number;
  rate: number;
  discount_pct: number;
  amount: number;
}

interface QuoteGroup {
  quote_name: string;
  account_name: string;
  contact_name: string;
  type: string;
  date: string;
  valid_until: string;
  scope_of_work: string;
  notes: string;
  terms: string;
  po_number: string;
  po_amount: string;
  ref_no: string;
  pr_no: string;
  discount_type: string;
  discount_pct: string;
  discount_fixed: string;
  gst_rate: string;
  custom_data: Record<string, string>;
  lines: LineItem[];
  firstRowNum: number;
}

export async function POST(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { rows } = await request.json() as { rows: CsvRow[] };
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "No rows provided" }, { status: 400 });
  }

  // ── Resolve lookup maps ──────────────────────────────────────────────────────
  const [{ data: accounts }, { data: contacts }, { data: entities }] = await Promise.all([
    supabase.from("accounts").select("id, name").eq("tenant_id", tenantId),
    supabase.from("contacts").select("id, name, account_id").eq("tenant_id", tenantId),
    supabase.from("tenants").select("config").eq("id", tenantId).single(),
  ]);

  const accountMap = new Map<string, string>(
    (accounts ?? []).map((a: { id: string; name: string }) => [a.name.toLowerCase().trim(), a.id])
  );
  const contactMap = new Map<string, string>(
    (contacts ?? []).map((c: { id: string; name: string }) => [c.name.toLowerCase().trim(), c.id])
  );

  // Entity map: short_name or name → id
  type EntityRow = { id: string; name: string; short_name: string; is_default: boolean };
  const tenantEntities: EntityRow[] = (entities?.config as { entities?: EntityRow[] } | null)?.entities ?? [];
  const entityMap = new Map<string, string>();
  let defaultEntityId: string | null = null;
  for (const e of tenantEntities) {
    entityMap.set(e.name.toLowerCase(), e.id);
    if (e.short_name) entityMap.set(e.short_name.toLowerCase(), e.id);
    if (e.is_default) defaultEntityId = e.id;
  }

  // ── Group rows by quote_name ─────────────────────────────────────────────────
  const groups = new Map<string, QuoteGroup>();
  const groupOrder: string[] = [];

  rows.forEach((row, i) => {
    const qname = row.quote_name?.trim();
    if (!qname) return; // skip blank quote_name rows

    if (!groups.has(qname)) {
      // Collect any cf_* keys (header-level custom fields, first row only)
      const custom_data: Record<string, string> = {};
      for (const [k, v] of Object.entries(row)) {
        if (k.startsWith("cf_") && v?.trim()) custom_data[k.slice(3)] = v.trim();
      }

      groups.set(qname, {
        quote_name:   qname,
        account_name: row.account_name?.trim() ?? "",
        contact_name: row.contact_name?.trim() ?? "",
        type:         row.type?.trim() ?? "",
        date:         row.date?.trim() ?? "",
        valid_until:  row.valid_until?.trim() ?? "",
        scope_of_work: row.scope_of_work?.trim() ?? "",
        notes:        row.notes?.trim() ?? "",
        terms:        row.terms?.trim() ?? "",
        po_number:    row.po_number?.trim() ?? "",
        po_amount:    row.po_amount?.trim() ?? "",
        ref_no:       row.ref_no?.trim() ?? "",
        pr_no:        row.pr_no?.trim() ?? "",
        discount_type: row.discount_type?.trim() ?? "",
        discount_pct: row.discount_pct?.trim() ?? "",
        discount_fixed: row.discount_fixed?.trim() ?? "",
        gst_rate:     row.gst_rate?.trim() ?? "",
        custom_data,
        lines:        [],
        firstRowNum:  i + 2,
      });
      groupOrder.push(qname);
    }

    const desc = row.line_description?.trim();
    if (desc) {
      const qty  = Math.max(0, parseFloat(row.line_qty) || 1);
      const rate = Math.max(0, parseFloat(row.line_rate) || 0);
      const disc = Math.max(0, Math.min(100, parseFloat(row.line_discount_pct) || 0));
      groups.get(qname)!.lines.push({
        description: desc,
        uom: row.line_uom?.trim() || null,
        qty,
        rate,
        discount_pct: disc,
        amount: qty * rate * (1 - disc / 100),
      });
    }
  });

  // ── Validate + insert each quote ─────────────────────────────────────────────
  const errors: { row: number; error: string }[] = [];
  let inserted = 0;
  let skipped  = 0;

  // Fetch current quote count once for sequential refs
  const { count: currentCount } = await supabase
    .from("quotes")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  let seq = (currentCount ?? 0) + 1;
  const year = new Date().getFullYear();

  for (const qname of groupOrder) {
    const g = groups.get(qname)!;

    // Validate header
    if (!g.account_name) {
      errors.push({ row: g.firstRowNum, error: `"${qname}": account_name is required` });
      continue;
    }

    const accountId = accountMap.get(g.account_name.toLowerCase());
    if (!accountId) {
      errors.push({ row: g.firstRowNum, error: `"${qname}": account "${g.account_name}" not found` });
      continue;
    }

    const contactId = g.contact_name
      ? (contactMap.get(g.contact_name.toLowerCase()) ?? null)
      : null;

    const quoteType = VALID_TYPES.includes(g.type as typeof VALID_TYPES[number]) ? g.type : "quotation";

    if (g.lines.length === 0) {
      errors.push({ row: g.firstRowNum, error: `"${qname}": no line items found` });
      continue;
    }

    const discountType = g.discount_type === "fixed" ? "fixed" : "pct";
    const discountPct  = Math.max(0, Math.min(100, parseFloat(g.discount_pct) || 0));
    const discountFixed = Math.max(0, parseFloat(g.discount_fixed) || 0);
    const gstRate = g.gst_rate !== "" ? parseFloat(g.gst_rate) : null;

    const discountAmt = discountType === "fixed" ? discountFixed : 0;
    const linesSubtotal = g.lines.reduce((s, l) => s + l.amount, 0);
    const total = discountType === "pct"
      ? linesSubtotal * (1 - discountPct / 100)
      : linesSubtotal - discountAmt;
    const ref   = `QT-${year}-${String(seq).padStart(4, "0")}`;

    const { data: quote, error: qErr } = await supabase
      .from("quotes")
      .insert({
        tenant_id:     tenantId,
        account_id:    accountId,
        ref,
        type:          quoteType,
        status:        "draft",
        total,
        name:          g.quote_name,
        contact_id:    contactId,
        valid_until:   g.valid_until || null,
        scope_of_work: g.scope_of_work || null,
        notes:         g.notes || null,
        terms:         g.terms || null,
        po_number:     g.po_number || null,
        po_amount:     g.po_amount ? parseFloat(g.po_amount) : null,
        ref_no:        g.ref_no || null,
        pr_no:         g.pr_no || null,
        entity_id:     defaultEntityId,
        revision:      1,
        discount_type: discountType,
        discount_pct:  discountPct,
        discount_fixed: discountFixed,
        gst_rate:      gstRate,
        asset_ids:     [],
        ...(Object.keys(g.custom_data).length > 0 ? { custom_data: g.custom_data } : {}),
      })
      .select("id, ref")
      .single();

    if (qErr || !quote) {
      errors.push({ row: g.firstRowNum, error: `"${qname}": ${qErr?.message ?? "insert failed"}` });
      continue;
    }

    // Insert line items
    const lineRows = g.lines.map((l) => ({
      tenant_id:    tenantId,
      quote_id:     quote.id,
      description:  l.description,
      uom:          l.uom,
      qty:          l.qty,
      rate:         l.rate,
      discount_pct: l.discount_pct,
      amount:       l.amount,
      group_id:     null,
      group_label:  null,
      group_type:   null,
    }));

    const { error: lErr } = await supabase.from("quote_lines").insert(lineRows);
    if (lErr) {
      errors.push({ row: g.firstRowNum, error: `"${qname}": lines failed — ${lErr.message}` });
      // Roll back the quote header
      await supabase.from("quotes").delete().eq("id", quote.id).eq("tenant_id", tenantId);
      continue;
    }

    // Revision log entry
    await supabase.from("quote_revisions").insert({
      tenant_id:   tenantId,
      quote_id:    quote.id,
      rev:         1,
      date:        new Date().toISOString().split("T")[0],
      description: "Imported via Data Workbench",
    });

    inserted++;
    seq++;
  }

  return NextResponse.json({ inserted, skipped, errors });
}
