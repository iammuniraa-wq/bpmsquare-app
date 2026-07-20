import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { DEFAULT_QUOTE_ID_FORMAT, type QuoteIdFormat, type TenantConfig } from "@/lib/constants";
import { formatQuoteRef } from "@/lib/quoteRefFormat";
import { getObjectSpec } from "@/lib/import/schema";
import { validateQuoteRows } from "@/lib/import/validate";
import {
  collectCustomData,
  describeDbError,
  fetchAllRows,
  nameKey,
  readImportBody,
  summarise,
} from "@/lib/import/server";
import type { RowOutcome } from "@/lib/import/types";

type Line = { description: string; uom: string | null; qty: number; rate: number; discount_pct: number; amount: number };

type Group = {
  name: string;
  firstRowNum: number;
  rowNums: number[];
  header: Record<string, string>;
  customData?: Record<string, string>;
  lines: Line[];
};

const num = (v: string | undefined, fallback = 0): number => {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export async function POST(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const rows = readImportBody(await request.json());
  if (!rows) return NextResponse.json({ error: "No rows provided" }, { status: 400 });

  const spec = getObjectSpec("quotes");
  const validated = validateQuoteRows(spec, rows);

  // Custom fields are tenant-defined and absent from the static spec, so they are
  // read from the raw payload rather than the validated (spec-filtered) values.
  const rawByRowNum = new Map(rows.map((r) => [r.rowNum, r.values]));

  const outcomes: RowOutcome[] = [];
  const groups = new Map<string, Group>();
  const order: string[] = [];

  for (const row of validated) {
    const blocking = row.issues.filter((i) => i.severity === "error");
    if (blocking.length > 0) {
      outcomes.push({ rowNum: row.rowNum, status: "failed", reason: blocking.map((i) => i.message).join("; ") });
      continue;
    }

    const name = row.values.quote_name;
    const key = nameKey(name);

    if (!groups.has(key)) {
      groups.set(key, {
        name,
        firstRowNum: row.rowNum,
        rowNums: [],
        header: row.values,
        customData: collectCustomData(rawByRowNum.get(row.rowNum) ?? {}),
        lines: [],
      });
      order.push(key);
    }

    const group = groups.get(key)!;
    group.rowNums.push(row.rowNum);

    const description = row.values.line_description;
    if (description) {
      const qty = Math.max(0, num(row.values.line_qty, 1));
      const rate = Math.max(0, num(row.values.line_rate, 0));
      const discount = clamp(num(row.values.line_discount_pct, 0), 0, 100);
      group.lines.push({
        description,
        uom: row.values.line_uom ?? null,
        qty,
        rate,
        discount_pct: discount,
        amount: qty * rate * (1 - discount / 100),
      });
    }
  }

  const [accounts, contacts, { data: tenantRow }] = await Promise.all([
    fetchAllRows<{ id: string; name: string }>(supabase, "accounts", "id, name", tenantId),
    fetchAllRows<{ id: string; name: string }>(supabase, "contacts", "id, name", tenantId),
    supabase.from("tenants").select("config").eq("id", tenantId).single(),
  ]);

  const accountByName = new Map(accounts.map((a) => [nameKey(a.name), a.id]));
  const contactByName = new Map(contacts.map((c) => [nameKey(c.name), c.id]));

  const config = tenantRow?.config as TenantConfig | null;
  const quoteFormat: QuoteIdFormat = config?.quote_id_format ?? DEFAULT_QUOTE_ID_FORMAT;

  type EntityRow = { id: string; name: string; short_name?: string; is_default?: boolean };
  const entities: EntityRow[] = (config as { entities?: EntityRow[] } | null)?.entities ?? [];
  const defaultEntityId = entities.find((e) => e.is_default)?.id ?? null;

  const now = new Date();
  let seq = await nextSequence(supabase, tenantId, quoteFormat, now);

  for (const key of order) {
    const group = groups.get(key)!;
    const fail = (reason: string) => {
      outcomes.push({ rowNum: group.firstRowNum, status: "failed", reason: `"${group.name}": ${reason}` });
    };

    const accountId = accountByName.get(nameKey(group.header.account_name ?? ""));
    if (!accountId) {
      fail(`account "${group.header.account_name ?? ""}" was not found — import accounts first`);
      continue;
    }

    if (group.lines.length === 0) {
      fail("no line items were found for this quote");
      continue;
    }

    const contactId = group.header.contact_name
      ? contactByName.get(nameKey(group.header.contact_name)) ?? null
      : null;

    const discountType = group.header.discount_type === "fixed" ? "fixed" : "pct";
    const discountPct = clamp(num(group.header.discount_pct, 0), 0, 100);
    const discountFixed = Math.max(0, num(group.header.discount_fixed, 0));
    const subtotal = group.lines.reduce((sum, l) => sum + l.amount, 0);
    const total = discountType === "pct" ? subtotal * (1 - discountPct / 100) : subtotal - discountFixed;

    const record = {
      tenant_id: tenantId,
      account_id: accountId,
      type: group.header.type ?? "quotation",
      status: "draft",
      total,
      name: group.name,
      contact_id: contactId,
      valid_until: group.header.valid_until ?? null,
      scope_of_work: group.header.scope_of_work ?? null,
      notes: group.header.notes ?? null,
      terms: group.header.terms ?? null,
      po_number: group.header.po_number ?? null,
      po_amount: group.header.po_amount ? num(group.header.po_amount) : null,
      ref_no: group.header.ref_no ?? null,
      pr_no: group.header.pr_no ?? null,
      territory: group.header.territory ?? null,
      sales_org: group.header.sales_org ?? null,
      entity_id: defaultEntityId,
      revision: 1,
      discount_type: discountType,
      discount_pct: discountPct,
      discount_fixed: discountFixed,
      gst_rate: group.header.gst_rate ? num(group.header.gst_rate) : null,
      asset_ids: [],
      ...(group.customData ? { custom_data: group.customData } : {}),
    };

    let quoteId: string | null = null;
    let lastError = "";

    // A concurrent import or UI-created quote can claim the same ref; step past it.
    for (let attempt = 0; attempt < 5 && !quoteId; attempt++) {
      const ref = formatQuoteRef(quoteFormat, now, seq);
      const { data, error } = await supabase
        .from("quotes")
        .insert({ ...record, ref })
        .select("id")
        .single();

      seq++;
      if (data?.id) { quoteId = data.id; break; }
      lastError = describeDbError(error);
      if (error?.code !== "23505") break;
    }

    if (!quoteId) {
      fail(lastError || "could not be saved");
      continue;
    }

    const { error: lineError } = await supabase.from("quote_lines").insert(
      group.lines.map((l) => ({
        tenant_id: tenantId,
        quote_id: quoteId,
        description: l.description,
        uom: l.uom,
        qty: l.qty,
        rate: l.rate,
        discount_pct: l.discount_pct,
        amount: l.amount,
        group_id: null,
        group_label: null,
        group_type: null,
      }))
    );

    if (lineError) {
      await supabase.from("quotes").delete().eq("id", quoteId).eq("tenant_id", tenantId);
      fail(`line items could not be saved — ${describeDbError(lineError)}`);
      continue;
    }

    await supabase.from("quote_revisions").insert({
      tenant_id: tenantId,
      quote_id: quoteId,
      rev: 1,
      date: now.toISOString().split("T")[0],
      description: "Imported via Data Workbench",
    });

    outcomes.push({ rowNum: group.firstRowNum, status: "inserted" });
    for (const rowNum of group.rowNums.slice(1)) {
      outcomes.push({ rowNum, status: "skipped", reason: `line item of "${group.name}"` });
    }
  }

  return NextResponse.json(summarise(outcomes));
}

async function nextSequence(
  supabase: Awaited<ReturnType<typeof requireTenantUser>>["supabase"],
  tenantId: string,
  fmt: QuoteIdFormat,
  date: Date
): Promise<number> {
  let query = supabase.from("quotes").select("*", { count: "exact", head: true }).eq("tenant_id", tenantId);

  if (fmt.reset === "yearly") {
    const yearStart = new Date(date.getFullYear(), 0, 1).toISOString();
    const yearEnd = new Date(date.getFullYear() + 1, 0, 1).toISOString();
    query = query.gte("created_at", yearStart).lt("created_at", yearEnd);
  }

  const { count } = await query;
  return (count ?? 0) + 1;
}
