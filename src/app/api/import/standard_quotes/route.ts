import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { resolvePermissions, canEditWorkcenter } from "@/lib/permissions";
import { getEffectiveFieldConfig, getSalesConfig } from "@/lib/fieldConfig";
import { buildObjectSpec } from "@/lib/import/registrySchema";
import { validateRow, hasBlockingIssue } from "@/lib/import/validate";
import { collectCustomData, describeDbError, fetchAllRows, nameKey, readImportBody, summarise } from "@/lib/import/server";
import { diffForLog, logChangeBatch, type ChangeLogEntryParams } from "@/lib/changeLog";
import { generateNextStandardQuoteRef } from "@/lib/standardQuoteRef";
import { computeStandardQuoteTotals, clampPct, clampAmount } from "@/lib/standardQuoteTotals";
import { writeHeaderTolerant } from "@/lib/pricing/quoteLineFlags";
import type { RowOutcome } from "@/lib/import/types";

// Data Workbench import of standard quotes (bpmsquarecore 3b-4): creates DRAFT headers by account
// (and contact) NAME, the create-time business key (section 3). The Quote ID is generated here,
// never read from the file; status, subtotal and total are computed, never imported. A header
// made this way has no lines yet -- they are added with Standard Quote Lines, keyed on the Quote
// ID an export shows. Same insert path as POST /api/standard-quotes (own ref format, default
// template, tolerant of a pending 0209 custom_data column).

const REF_SEQ = /^(SQ-\d{4}-)(\d+)$/;

export async function POST(request: NextRequest) {
  let supabase, tenantId, userId, role;
  try {
    ({ supabase, tenantId, userId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  // A tenant without the module cannot read or write its data in bulk
  // either -- the gate is the same question the nav and the v1 API ask.
  const gate = await assertObjectFeature(tenantId, "standard_quotes");
  if (gate) return gate;
  const perms = await resolvePermissions(supabase, tenantId, userId, role);
  if (!canEditWorkcenter(perms, "standard_quotes")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rows = readImportBody(await request.json());
  if (!rows) return NextResponse.json({ error: "No rows provided" }, { status: 400 });

  const [fieldConfig, salesConfig, accounts, contacts, defaultTemplate] = await Promise.all([
    getEffectiveFieldConfig(supabase, tenantId, "standard_quote"),
    getSalesConfig(supabase, tenantId),
    fetchAllRows<{ id: string; name: string }>(supabase, "accounts", "id, name", tenantId),
    fetchAllRows<{ id: string; name: string; account_id: string | null }>(supabase, "contacts", "id, name, account_id", tenantId),
    supabase.from("standard_quote_templates").select("id").eq("tenant_id", tenantId).eq("is_default", true).maybeSingle(),
  ]);
  const spec = buildObjectSpec("standard_quotes", fieldConfig, salesConfig);
  const accountByName = new Map(accounts.map((a) => [nameKey(a.name), a.id]));
  const contactByKey = new Map(contacts.map((c) => [`${c.account_id}|${nameKey(c.name)}`, c.id]));
  const templateId = (defaultTemplate.data as { id?: string } | null)?.id ?? null;

  const outcomes: RowOutcome[] = [];
  const logRows: ChangeLogEntryParams[] = [];
  const user = await getAuthUser();
  let nextRef: string | null = null;

  for (const { rowNum, values } of rows) {
    const validated = validateRow(spec, values, rowNum);
    if (hasBlockingIssue(validated)) {
      outcomes.push({ rowNum, status: "failed", reason: validated.issues.filter((i) => i.severity === "error").map((i) => i.message).join("; ") });
      continue;
    }
    const v = validated.values;

    const accountId = accountByName.get(nameKey(v.account_name ?? ""));
    if (!accountId) {
      outcomes.push({ rowNum, status: "failed", reason: `Account "${v.account_name ?? ""}" was not found. Import accounts first, or check the spelling` });
      continue;
    }
    let contactId: string | null = null;
    if (v.contact_name) {
      contactId = contactByKey.get(`${accountId}|${nameKey(v.contact_name)}`) ?? null;
      if (!contactId) {
        outcomes.push({ rowNum, status: "failed", reason: `Contact "${v.contact_name}" was not found at that account` });
        continue;
      }
    }

    const headerDiscountPct = clampPct(v.header_discount_pct);
    const taxPct = clampPct(v.tax_pct);
    const shippingAmount = clampAmount(v.shipping_amount);
    const custom = collectCustomData(values);
    const record = {
      tenant_id: tenantId,
      account_id: accountId,
      contact_id: contactId,
      status: "draft",
      valid_until: v.valid_until || null,
      inquiry_date: v.inquiry_date || null,
      header_discount_pct: headerDiscountPct,
      tax_pct: taxPct,
      shipping_amount: shippingAmount,
      intro_text: v.intro_text || null,
      notes: v.notes || null,
      terms: v.terms || null,
      subtotal: 0,
      total: computeStandardQuoteTotals(0, headerDiscountPct, taxPct, shippingAmount).total,
      created_by: userId,
      template_id: templateId,
      // Dropped by writeHeaderTolerant while 0209 is pending.
      ...(custom ? { custom_data: custom } : {}),
    };

    let created: { id: string; ref: string } | null = null;
    let lastError = "";
    // A concurrent save or another import can claim the same ref; step to a fresh one.
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      const ref = nextRef ?? (await generateNextStandardQuoteRef(supabase, tenantId));
      const result = await writeHeaderTolerant({ ...record, ref }, async (row) => await supabase.from("standard_quotes").insert(row).select("id, ref").single());
      const m = REF_SEQ.exec(ref);
      // The next row in this file takes the next number without another round of lookups.
      nextRef = m ? `${m[1]}${String(parseInt(m[2], 10) + 1).padStart(4, "0")}` : null;
      if (!result.error && result.data) { created = result.data as { id: string; ref: string }; break; }
      lastError = describeDbError(result.error);
      if (result.error?.code === "23505") { nextRef = null; continue; }
      break;
    }

    if (!created) {
      outcomes.push({ rowNum, status: "failed", reason: lastError || "could not be saved" });
      continue;
    }

    outcomes.push({ rowNum, status: "inserted" });
    logRows.push({
      tenantId, objectType: "standard_quotes", objectId: created.id, objectLabel: created.ref,
      action: "create", actorId: user?.id, actorEmail: user?.email,
      changes: diffForLog("standard_quotes", {}, { account_id: accountId, contact_id: contactId, valid_until: record.valid_until, total: record.total }),
    });
  }

  if (logRows.length > 0) await logChangeBatch(supabase, logRows);
  return NextResponse.json(summarise(outcomes));
}
