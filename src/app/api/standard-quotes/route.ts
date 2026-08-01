import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { generateNextStandardQuoteRef } from "@/lib/standardQuoteRef";
import { diffForLog, logChange } from "@/lib/changeLog";

export async function GET(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const accountId = searchParams.get("account_id");

  let query = supabase.from("standard_quotes").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);
  if (accountId) query = query.eq("account_id", accountId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  let supabase, tenantId, userId;
  try {
    ({ supabase, tenantId, userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const body = await request.json();
  const { account_id, contact_id, valid_until, terms, notes, lines, template_id } = body;

  if (!account_id) {
    return NextResponse.json({ error: "account_id is required" }, { status: 400 });
  }

  const { data: acct } = await supabase.from("accounts").select("id").eq("id", account_id).eq("tenant_id", tenantId).maybeSingle();
  if (!acct) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  if (contact_id) {
    const { data: contact } = await supabase.from("contacts").select("id").eq("id", contact_id).eq("tenant_id", tenantId).maybeSingle();
    if (!contact) return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  let templateId: string | null = null;
  if (template_id) {
    const { data: tmpl } = await supabase.from("standard_quote_templates").select("id").eq("id", template_id).eq("tenant_id", tenantId).maybeSingle();
    if (!tmpl) return NextResponse.json({ error: "Template not found" }, { status: 404 });
    templateId = tmpl.id;
  } else {
    const { data: defaultTmpl } = await supabase.from("standard_quote_templates").select("id").eq("tenant_id", tenantId).eq("is_default", true).maybeSingle();
    templateId = defaultTmpl?.id ?? null;
  }

  const cleanLines = Array.isArray(lines)
    ? lines
        .filter((l) => l?.description?.trim())
        .slice(0, 200)
        .map((l, i) => {
          const qty = Math.max(0, parseFloat(l.qty) || 1);
          const rate = Math.max(0, parseFloat(l.rate) || 0);
          const discountPct = Math.max(0, Math.min(100, parseFloat(l.discount_pct) || 0));
          return {
            tenant_id: tenantId,
            sl_no: l.sl_no || String(i + 1),
            description: String(l.description),
            uom: l.uom || null,
            qty,
            rate,
            discount_pct: discountPct,
            amount: qty * rate * (1 - discountPct / 100),
          };
        })
    : [];

  const subtotal = cleanLines.reduce((s, l) => s + l.amount, 0);

  const baseInsert = {
    tenant_id: tenantId,
    account_id,
    contact_id: contact_id || null,
    status: "draft",
    valid_until: valid_until || null,
    terms: terms || null,
    notes: notes || null,
    subtotal,
    total: subtotal,
    created_by: userId,
    template_id: templateId,
  };

  let quote: { id: string; ref: string } | null = null;
  let qErr: { message: string; code?: string } | null = null;
  for (let attempt = 0; attempt < 3 && !quote; attempt++) {
    const ref = await generateNextStandardQuoteRef(supabase, tenantId);
    const result = await supabase.from("standard_quotes").insert({ ...baseInsert, ref }).select("id, ref").single();
    if (!result.error) {
      quote = result.data;
    } else if (result.error.code === "23505") {
      qErr = result.error;
      continue;
    } else {
      qErr = result.error;
      break;
    }
  }

  if (!quote) return NextResponse.json({ error: qErr?.message ?? "Failed to create quote" }, { status: 500 });

  if (cleanLines.length > 0) {
    const { error: linesErr } = await supabase
      .from("standard_quote_lines")
      .insert(cleanLines.map((l) => ({ ...l, standard_quote_id: quote!.id })));
    if (linesErr) return NextResponse.json({ error: linesErr.message }, { status: 500 });
  }

  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "standard_quotes", objectId: quote.id, objectLabel: quote.ref,
    action: "create", actorId: user?.id, actorEmail: user?.email,
    changes: diffForLog("standard_quotes", {}, { account_id, contact_id, valid_until, total: subtotal }),
  });

  return NextResponse.json(quote, { status: 201 });
}
