import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { diffForLog, diffLineItems, logChange, type LineSnapshot } from "@/lib/changeLog";
import { computeStandardQuoteTotals, clampPct, clampAmount } from "@/lib/standardQuoteTotals";
import { parseDateOverride, parseTimestampOverride } from "@/lib/dateProfile";

const VALID_STATUSES = ["draft", "sent", "accepted", "rejected", "expired"];

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (!(await tenantHasFeature(supabase, tenantId, "standard_quotes"))) {
    return NextResponse.json({ error: "Standard Quotes isn't enabled for your workspace" }, { status: 403 });
  }

  const { id } = await params;
  const [{ data: quote, error }, { data: lines }] = await Promise.all([
    supabase.from("standard_quotes").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle(),
    supabase.from("standard_quote_lines").select("*").eq("standard_quote_id", id).order("sl_no"),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!quote) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ...quote, lines: lines ?? [] });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (!(await tenantHasFeature(supabase, tenantId, "standard_quotes"))) {
    return NextResponse.json({ error: "Standard Quotes isn't enabled for your workspace" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();

  if (body.status && !VALID_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` }, { status: 400 });
  }

  const { data: before } = await supabase.from("standard_quotes").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (body.contact_id) {
    const { data: contact } = await supabase.from("contacts").select("id").eq("id", body.contact_id).eq("tenant_id", tenantId).maybeSingle();
    if (!contact) return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  if (body.template_id) {
    const { data: tmpl } = await supabase.from("standard_quote_templates").select("id").eq("id", body.template_id).eq("tenant_id", tenantId).maybeSingle();
    if (!tmpl) return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const { data: beforeLines } = await supabase
    .from("standard_quote_lines")
    .select("description, qty, rate, amount")
    .eq("standard_quote_id", id)
    .order("sl_no");

  const allowed = ["contact_id", "valid_until", "terms", "notes", "status", "template_id", "intro_text"];
  const patch: Record<string, unknown> = {};
  for (const key of allowed) if (key in body) patch[key] = body[key] || null;
  if ("status" in body) patch.status = body.status;

  // Date profile (0059). Manual overrides first -- null clears, a valid
  // YYYY-MM-DD sets, anything malformed is a 400 -- then auto-stamps, which
  // never fight an explicit override in the same request.
  if ("inquiry_date" in body) {
    const r = parseDateOverride(body.inquiry_date);
    if (!r.ok) return NextResponse.json({ error: "inquiry_date must be a valid YYYY-MM-DD date" }, { status: 400 });
    patch.inquiry_date = r.date;
  }
  if ("sent_at" in body) {
    const r = parseTimestampOverride(body.sent_at);
    if (!r.ok) return NextResponse.json({ error: "sent_at must be a valid YYYY-MM-DD date" }, { status: 400 });
    patch.sent_at = r.iso;
  }
  if ("closed_at" in body) {
    const r = parseTimestampOverride(body.closed_at);
    if (!r.ok) return NextResponse.json({ error: "closed_at must be a valid YYYY-MM-DD date" }, { status: 400 });
    patch.closed_at = r.iso;
  }

  if (!("sent_at" in body) && body.status === "sent" && before.status !== "sent" && !before.sent_at) {
    patch.sent_at = new Date().toISOString();
  }
  const TERMINAL = new Set(["accepted", "rejected", "expired"]);
  if ("status" in body && !("closed_at" in body)) {
    if (TERMINAL.has(body.status) && !TERMINAL.has(before.status)) patch.closed_at = new Date().toISOString();
    else if (!TERMINAL.has(body.status) && TERMINAL.has(before.status)) patch.closed_at = null;
  }
  patch.updated_at = new Date().toISOString();

  if ("header_discount_pct" in body) patch.header_discount_pct = clampPct(body.header_discount_pct);
  if ("tax_pct" in body) patch.tax_pct = clampPct(body.tax_pct);
  if ("shipping_amount" in body) patch.shipping_amount = clampAmount(body.shipping_amount);

  type CleanLine = { tenant_id: string; standard_quote_id: string; sl_no: string; description: string; uom: string | null; qty: number; rate: number; discount_pct: number; amount: number };
  let cleanLines: CleanLine[] | null = null;
  if (Array.isArray(body.lines)) {
    const built: CleanLine[] = body.lines
      .filter((l: { description?: string }) => l?.description?.trim())
      .slice(0, 200)
      .map((l: { sl_no?: string; description: string; uom?: string; qty?: string; rate?: string; discount_pct?: string }, i: number) => {
        const qty = Math.max(0, parseFloat(l.qty ?? "") || 1);
        const rate = Math.max(0, parseFloat(l.rate ?? "") || 0);
        const discountPct = Math.max(0, Math.min(100, parseFloat(l.discount_pct ?? "") || 0));
        return {
          tenant_id: tenantId,
          standard_quote_id: id,
          sl_no: l.sl_no || String(i + 1),
          description: String(l.description),
          uom: l.uom || null,
          qty, rate, discount_pct: discountPct,
          amount: qty * rate * (1 - discountPct / 100),
        };
      });
    cleanLines = built;
    patch.subtotal = built.reduce((s, l) => s + l.amount, 0);
  }

  if ("header_discount_pct" in patch || "tax_pct" in patch || "shipping_amount" in patch || "subtotal" in patch) {
    const effectiveSubtotal = (patch.subtotal as number | undefined) ?? before.subtotal;
    const effectiveDiscountPct = (patch.header_discount_pct as number | undefined) ?? before.header_discount_pct;
    const effectiveTaxPct = (patch.tax_pct as number | undefined) ?? before.tax_pct;
    const effectiveShipping = (patch.shipping_amount as number | undefined) ?? before.shipping_amount;
    patch.total = computeStandardQuoteTotals(effectiveSubtotal, effectiveDiscountPct, effectiveTaxPct, effectiveShipping).total;
  }

  const { error: uErr } = await supabase.from("standard_quotes").update(patch).eq("id", id).eq("tenant_id", tenantId);
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

  if (cleanLines) {
    const { error: dErr } = await supabase.from("standard_quote_lines").delete().eq("standard_quote_id", id).eq("tenant_id", tenantId);
    if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });
    if (cleanLines.length > 0) {
      const { error: iErr } = await supabase.from("standard_quote_lines").insert(cleanLines);
      if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });
    }
  }

  const { data: updated } = await supabase.from("standard_quotes").select("*").eq("id", id).eq("tenant_id", tenantId).single();

  // updated_at changes on every save by definition -- keep it out of the audit diff.
  const { updated_at: _updatedAt, ...diffPatch } = patch;
  const headerChanges = diffForLog("standard_quotes", before as Record<string, unknown>, diffPatch);
  const lineChanges = cleanLines
    ? diffLineItems(
        (beforeLines ?? []).map((l): LineSnapshot => ({ label: l.description, qty: l.qty, rate: l.rate, amount: l.amount })),
        cleanLines.map((l): LineSnapshot => ({ label: l.description, qty: l.qty, rate: l.rate, amount: l.amount }))
      )
    : [];
  const changes = [...headerChanges, ...lineChanges];

  if (changes.length > 0) {
    const user = await getAuthUser();
    await logChange(supabase, {
      tenantId, objectType: "standard_quotes", objectId: id, objectLabel: (updated as { ref?: string })?.ref ?? null,
      action: "update", actorId: user?.id, actorEmail: user?.email, changes,
    });
  }

  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (!(await tenantHasFeature(supabase, tenantId, "standard_quotes"))) {
    return NextResponse.json({ error: "Standard Quotes isn't enabled for your workspace" }, { status: 403 });
  }

  const { id } = await params;
  const { data: quote } = await supabase.from("standard_quotes").select("ref, status").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!quote) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (quote.status !== "draft") {
    return NextResponse.json({ error: "Only draft quotes can be deleted" }, { status: 409 });
  }

  const { error } = await supabase.from("standard_quotes").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "standard_quotes", objectId: id, objectLabel: quote.ref,
    action: "delete", actorId: user?.id, actorEmail: user?.email,
  });

  return new NextResponse(null, { status: 204 });
}
