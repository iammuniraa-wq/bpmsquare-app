import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { diffForLog, diffLineItems, logChange, type LineSnapshot } from "@/lib/changeLog";

const VALID_STATUSES = ["draft", "sent", "accepted", "rejected", "expired"];

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
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

  const allowed = ["contact_id", "valid_until", "terms", "notes", "status", "template_id"];
  const patch: Record<string, unknown> = {};
  for (const key of allowed) if (key in body) patch[key] = body[key] || null;
  if ("status" in body) patch.status = body.status;
  if (body.status === "sent" && before.status !== "sent") patch.sent_at = new Date().toISOString();

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
    const subtotal = built.reduce((s, l) => s + l.amount, 0);
    patch.subtotal = subtotal;
    patch.total = subtotal;
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

  const headerChanges = diffForLog("standard_quotes", before as Record<string, unknown>, patch);
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
