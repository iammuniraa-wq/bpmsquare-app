import { listQuotesForTenant } from "@/lib/data";
import { createAdminSupabase } from "@/lib/supabase-server";
import { generateNextQuoteRef } from "@/lib/quoteRef";
import { DEFAULT_QUOTE_ID_FORMAT, DEFAULT_QUOTE_STATUSES, type QuoteIdFormat, type QuoteStatusDef, type TenantConfig } from "@/lib/constants";
import { diffForLog, logChange } from "@/lib/changeLog";
import { QUOTE_ENTITY } from "@/lib/api/quotes";
import { validateBody, validateChildren } from "@/lib/api/schema";
import {
  API_ACTOR_EMAIL, buildLineRows, sanitizeQuoteValues, serializeQuote, totalsFor, verifyQuoteRelations,
} from "@/lib/api/quoteService";
import {
  resolveTenantFromBearer, ERR_401_TENANT, jsonOk, jsonCreated, jsonError, jsonValidationError,
  readJsonBody, optionsResponse, RW_METHODS,
} from "../_auth";

export async function GET(req: Request) {
  const tenantId = await resolveTenantFromBearer(req);
  if (!tenantId) return ERR_401_TENANT();

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const accountId = url.searchParams.get("account_id");

  let quotes = await listQuotesForTenant(tenantId);

  if (status)    quotes = quotes.filter((q) => q.quote.status === status);
  if (accountId) quotes = quotes.filter((q) => q.quote.account_id === accountId);

  return jsonOk({
    data: quotes.map(({ quote: q, account, lineCount }) => ({
      id: q.id,
      ref: q.ref,
      status: q.status,
      total: q.total,
      revision: q.revision,
      created_at: q.created_at,
      quote_date: q.quote_date ?? null,
      valid_until: q.valid_until,
      account: account ? { id: account.id, name: account.name } : null,
      line_count: lineCount,
      _links: {
        self: `/api/v1/quotations/${q.id}`,
        pdf: `/quotations/${q.id}/print`,
        account: `/api/v1/accounts/${q.account_id}`,
      },
    })),
    meta: {
      count: quotes.length,
      total_value: quotes.reduce((s, { quote: q }) => s + q.total, 0),
      filters: { status: status ?? null, account_id: accountId ?? null },
      generated_at: new Date().toISOString(),
    },
    _links: { self: "/api/v1/quotations", metadata: "/api/v1/metadata/quotations" },
  }, RW_METHODS);
}

export async function POST(req: Request) {
  const tenantId = await resolveTenantFromBearer(req);
  if (!tenantId) return ERR_401_TENANT();

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = (parsed.body ?? {}) as Record<string, unknown>;

  const header = validateBody(QUOTE_ENTITY, body, "create");
  if (!header.ok) return jsonValidationError(header.errors);

  const linesChild = QUOTE_ENTITY.children![0];
  const linesInput = body[linesChild.key];
  const lines = linesInput === undefined
    ? { ok: true as const, values: [] as Record<string, unknown>[] }
    : validateChildren(linesChild, linesInput);
  if (!lines.ok) return jsonValidationError(lines.errors);

  const supabase = createAdminSupabase();

  const relErr = await verifyQuoteRelations(supabase, tenantId, header.values, lines.values);
  if (relErr) return jsonError(404, relErr);

  const { data: account } = await supabase
    .from("accounts").select("id, territory, sales_org").eq("id", header.values.account_id).eq("tenant_id", tenantId).maybeSingle();

  const { data: tenantRow } = await supabase.from("tenants").select("config").eq("id", tenantId).maybeSingle();
  const tenantConfig = tenantRow?.config as TenantConfig | null;
  const quoteIdFormat: QuoteIdFormat = tenantConfig?.quote_id_format ?? DEFAULT_QUOTE_ID_FORMAT;

  const values = sanitizeQuoteValues({ ...header.values });

  // Status is tenant-configurable (Settings -> Quote statuses), so it can't be
  // checked as a fixed enum at the schema layer -- validated here against the
  // tenant's real pipeline instead. A quotation created directly in a closed
  // status still needs a decided outcome, same rule PATCH enforces.
  if (typeof values.status === "string") {
    const cfgStatuses: QuoteStatusDef[] = tenantConfig?.quote_statuses ?? DEFAULT_QUOTE_STATUSES;
    const statusDef = cfgStatuses.find((s) => s.value === values.status);
    if (!statusDef) {
      return jsonError(422, `Unknown status "${values.status}". Allowed values are tenant-configured -- see GET /api/v1/quotations?status= for values currently in use, or the app's Settings -> Quote statuses page.`);
    }
    if (statusDef.is_closed && values.outcome !== "won" && values.outcome !== "lost" && values.outcome !== "dropped") {
      return jsonError(422, "Set an outcome (won, lost, or dropped) when creating a quotation directly in a closed status.");
    }
    if (values.status === "rejected" && values.outcome === "won") {
      return jsonError(422, "A rejected quotation can't be marked won.");
    }
  }

  // Amounts and totals are always derived, never taken from the caller.
  const draftLines = buildLineRows(lines.values, tenantId, "pending");
  const totals = totalsFor(draftLines, {
    discount_type: (values.discount_type as string) ?? "pct",
    discount_pct: (values.discount_pct as number) ?? 0,
    discount_fixed: (values.discount_fixed as number) ?? 0,
    selected_option_id: (values.selected_option_id as string) ?? null,
  });

  const baseInsert = {
    tenant_id: tenantId,
    account_id: values.account_id,
    type: values.type ?? "quotation",
    status: values.status ?? "draft",
    outcome: values.outcome ?? "open",
    total: totals.total,
    quote_date: values.quote_date ?? null,
    valid_until: values.valid_until ?? null,
    notes: values.notes ?? null,
    terms: values.terms ?? null,
    scope_of_work: values.scope_of_work ?? null,
    entity_id: values.entity_id ?? null,
    name: values.name ?? null,
    contact_id: values.contact_id ?? null,
    ref_no: values.ref_no ?? null,
    pr_no: values.pr_no ?? null,
    po_number: values.po_number ?? null,
    po_amount: values.po_amount ?? null,
    discount_type: values.discount_type ?? "pct",
    discount_pct: values.discount_pct ?? 0,
    discount_fixed: values.discount_fixed ?? 0,
    gst_rate: values.gst_rate ?? null,
    asset_ids: values.asset_ids ?? [],
    revision: 1,
    selected_option_id: values.selected_option_id ?? null,
    custom_data: values.custom_data ?? null,
    meta: values.meta ?? null,
    // Date profile: only what the caller states. submitted_at/closed_at are
    // never auto-stamped at creation -- a historical import must be able to
    // land its own dates without the server overwriting them.
    inquiry_date: values.inquiry_date ?? null,
    submitted_at: values.submitted_at ?? null,
    closed_at: values.closed_at ?? null,
    updated_at: new Date().toISOString(),
    ...(values.business_status !== undefined ? { business_status: values.business_status } : {}),
    territory: values.territory ?? account?.territory ?? null,
    sales_org: values.sales_org ?? account?.sales_org ?? null,
  };

  // Retry on a (tenant_id, ref) collision -- narrow race between computing the
  // next sequence number and the insert landing, same as the internal route.
  let quote: Record<string, unknown> | null = null;
  let lastErr: { message: string; code?: string } | null = null;
  for (let attempt = 0; attempt < 3 && !quote; attempt++) {
    const ref = await generateNextQuoteRef(supabase, tenantId, quoteIdFormat);
    const result = await supabase.from("quotes").insert({ ...baseInsert, ref }).select("*").single();
    if (!result.error) { quote = result.data; break; }
    lastErr = result.error;
    if (result.error.code !== "23505") break;
  }
  if (!quote) return jsonError(500, lastErr?.message ?? "Failed to create quotation");

  const quoteId = quote.id as string;
  let insertedLines: Record<string, unknown>[] = [];
  if (lines.values.length > 0) {
    const rows = buildLineRows(lines.values, tenantId, quoteId);
    const { data, error } = await supabase.from("quote_lines").insert(rows).select("*");
    if (error) {
      // Don't leave a half-built quotation behind for the caller to clean up.
      await supabase.from("quotes").delete().eq("id", quoteId).eq("tenant_id", tenantId);
      return jsonError(500, `Failed to create quotation lines: ${error.message}`);
    }
    insertedLines = data ?? [];
  }

  await logChange(supabase, {
    tenantId, objectType: "quotes", objectId: quoteId, objectLabel: quote.ref as string,
    action: "create", actorEmail: API_ACTOR_EMAIL,
    changes: diffForLog("quotes", {}, {
      account_id: baseInsert.account_id, type: baseInsert.type, name: baseInsert.name,
      total: baseInsert.total, quote_date: baseInsert.quote_date, valid_until: baseInsert.valid_until,
    }),
  });

  return jsonCreated({ data: serializeQuote(quote, insertedLines) });
}

export async function OPTIONS() {
  return optionsResponse(RW_METHODS);
}
