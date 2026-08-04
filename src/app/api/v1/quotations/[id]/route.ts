import { createAdminSupabase } from "@/lib/supabase-server";
import { diffForLog, diffLineItems, logChange, type LineSnapshot } from "@/lib/changeLog";
import { QUOTE_ENTITY } from "@/lib/api/quotes";
import { validateBody, validateChildren } from "@/lib/api/schema";
import {
  API_ACTOR_EMAIL, applyDateProfile, buildLineRows, sanitizeQuoteValues, serializeQuote, totalsFor, verifyQuoteRelations,
} from "@/lib/api/quoteService";
import {
  resolveTenantFromBearer, ERR_401_TENANT, jsonOk, jsonError, jsonValidationError,
  readJsonBody, optionsResponse, RW_METHODS,
} from "../../_auth";

type Ctx = { params: Promise<{ id: string }> };

async function loadQuote(supabase: ReturnType<typeof createAdminSupabase>, id: string, tenantId: string) {
  return supabase.from("quotes").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
}

export async function GET(req: Request, { params }: Ctx) {
  const tenantId = await resolveTenantFromBearer(req);
  if (!tenantId) return ERR_401_TENANT();

  const { id } = await params;
  const supabase = createAdminSupabase();

  const { data: quote, error } = await loadQuote(supabase, id, tenantId);
  if (error) return jsonError(500, error.message);
  if (!quote) return jsonError(404, "Quotation not found");

  const [{ data: lines }, { data: account }, { data: contact }] = await Promise.all([
    supabase.from("quote_lines").select("*").eq("quote_id", id).eq("tenant_id", tenantId).order("sl_no"),
    supabase.from("accounts").select("id, name").eq("id", quote.account_id).eq("tenant_id", tenantId).maybeSingle(),
    quote.contact_id
      ? supabase.from("contacts").select("id, name").eq("id", quote.contact_id).eq("tenant_id", tenantId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return jsonOk({
    data: serializeQuote(quote, lines ?? [], { account, contact }),
    _links: { self: `/api/v1/quotations/${id}`, metadata: "/api/v1/metadata/quotations" },
  }, RW_METHODS);
}

export async function PATCH(req: Request, { params }: Ctx) {
  const tenantId = await resolveTenantFromBearer(req);
  if (!tenantId) return ERR_401_TENANT();

  const { id } = await params;
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = (parsed.body ?? {}) as Record<string, unknown>;

  const header = validateBody(QUOTE_ENTITY, body, "update");
  if (!header.ok) return jsonValidationError(header.errors);

  const linesChild = QUOTE_ENTITY.children![0];
  const linesGiven = body[linesChild.key] !== undefined;
  const lines = linesGiven
    ? validateChildren(linesChild, body[linesChild.key])
    : { ok: true as const, values: [] as Record<string, unknown>[] };
  if (!lines.ok) return jsonValidationError(lines.errors);

  const supabase = createAdminSupabase();

  const { data: before } = await loadQuote(supabase, id, tenantId);
  if (!before) return jsonError(404, "Quotation not found");

  const relErr = await verifyQuoteRelations(supabase, tenantId, header.values);
  if (relErr) return jsonError(404, relErr);

  const values = sanitizeQuoteValues({ ...header.values });

  // Effective header values: what the caller sent, falling back to what is
  // already stored -- the total has to stay consistent with the discount and
  // selected option actually in force, not just the fields in this request.
  const effective = {
    discount_type: (values.discount_type ?? before.discount_type) as string | null,
    discount_pct: (values.discount_pct ?? before.discount_pct) as number | null,
    discount_fixed: (values.discount_fixed ?? before.discount_fixed) as number | null,
    selected_option_id: (values.selected_option_id ?? before.selected_option_id) as string | null,
  };

  // Lines are replaced wholesale when supplied; left alone when omitted. Either
  // way the total is recomputed, because a discount change alone moves it.
  const { data: existingLines } = await supabase
    .from("quote_lines").select("*").eq("quote_id", id).eq("tenant_id", tenantId);

  const nextLines = linesGiven
    ? buildLineRows(lines.values, tenantId, id)
    : buildLineRows((existingLines ?? []) as Record<string, unknown>[], tenantId, id);

  const totals = totalsFor(nextLines, effective);

  const patch: Record<string, unknown> = { ...values, total: totals.total };
  await applyDateProfile(supabase, tenantId, before as Record<string, unknown>, patch);

  const { data: updated, error: uErr } = await supabase
    .from("quotes").update(patch).eq("id", id).eq("tenant_id", tenantId).select("*").single();
  if (uErr) return jsonError(500, uErr.message);

  let finalLines = (existingLines ?? []) as Record<string, unknown>[];
  if (linesGiven) {
    const { error: dErr } = await supabase.from("quote_lines").delete().eq("quote_id", id).eq("tenant_id", tenantId);
    if (dErr) return jsonError(500, `Failed to replace lines: ${dErr.message}`);
    if (nextLines.length > 0) {
      const { data, error: iErr } = await supabase.from("quote_lines").insert(nextLines).select("*");
      if (iErr) return jsonError(500, `Failed to insert lines: ${iErr.message}`);
      finalLines = data ?? [];
    } else {
      finalLines = [];
    }
  }

  const snap = (rows: Record<string, unknown>[]): LineSnapshot[] =>
    rows.map((l) => ({ label: String(l.description), qty: Number(l.qty), rate: Number(l.rate), amount: Number(l.amount) }));

  // updated_at moves on every save by definition -- logging it would put a
  // meaningless entry on every change. Same exclusion the in-app route makes.
  const { updated_at: _updatedAt, ...diffPatch } = patch;
  const changes = [
    ...diffForLog("quotes", before as Record<string, unknown>, diffPatch),
    ...(linesGiven ? diffLineItems(snap((existingLines ?? []) as Record<string, unknown>[]), snap(finalLines)) : []),
  ];
  if (changes.length > 0) {
    await logChange(supabase, {
      tenantId, objectType: "quotes", objectId: id, objectLabel: (updated as { ref?: string }).ref ?? null,
      action: "update", actorEmail: API_ACTOR_EMAIL, changes,
    });
  }

  return jsonOk({ data: serializeQuote(updated, finalLines) }, RW_METHODS);
}

export async function DELETE(req: Request, { params }: Ctx) {
  const tenantId = await resolveTenantFromBearer(req);
  if (!tenantId) return ERR_401_TENANT();

  const { id } = await params;
  const supabase = createAdminSupabase();

  const { data: snap } = await supabase
    .from("quotes").select("ref, name, status, total, account_id, created_at")
    .eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!snap) return jsonError(404, "Quotation not found");

  const { error } = await supabase.from("quotes").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) return jsonError(500, error.message);

  // Mirror the in-app delete: keep the tenant's own deletion record so an API
  // deletion is as traceable as one made through the UI.
  const { data: tenant } = await supabase.from("tenants").select("config").eq("id", tenantId).maybeSingle();
  const cfg = (tenant?.config ?? {}) as Record<string, unknown>;
  const log = Array.isArray(cfg.deleted_quotes) ? (cfg.deleted_quotes as unknown[]) : [];
  log.push({
    id, ref: snap.ref, name: snap.name ?? null, status: snap.status, total: snap.total,
    account_id: snap.account_id, created_at: snap.created_at,
    deleted_at: new Date().toISOString(), deleted_by: API_ACTOR_EMAIL,
  });
  await supabase.from("tenants").update({ config: { ...cfg, deleted_quotes: log } }).eq("id", tenantId);

  await logChange(supabase, {
    tenantId, objectType: "quotes", objectId: id, objectLabel: snap.ref,
    action: "delete", actorEmail: API_ACTOR_EMAIL,
  });

  return jsonOk({ data: { id, ref: snap.ref, deleted: true } }, RW_METHODS);
}

export async function OPTIONS() {
  return optionsResponse(RW_METHODS);
}
