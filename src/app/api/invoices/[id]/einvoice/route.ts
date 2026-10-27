import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { logChange } from "@/lib/changeLog";
import { applyDefaultVat, einvoiceColumnsPresent, evaluateInvoiceById, loadEinvoiceTenant, type EinvoiceTenant } from "@/lib/einvoicing/server";
import { fromHalalas } from "@/lib/einvoicing/totals";

// Saudi e-invoicing, phase E1: the readiness of one invoice, and the two things a person can ask the server to do about it.
//   GET  -> { doc_type, ready, issues[], totals, uuid, seq }   (what the invoice's "Saudi e-invoice" panel shows)
//   POST { action: "apply_default_vat" }  -> gives every line without a VAT category the standard one (15%), draft only
//   POST { action: "check" }              -> as GET, and makes sure the invoice has its UUID
// A workspace without e-invoicing gets 404 from all of it: the route does not exist for them.

type Guarded = { supabase: SupabaseClient; tenantId: string; tenant: EinvoiceTenant };

async function guard(): Promise<{ error: NextResponse } | Guarded> {
  try {
    const { supabase, tenantId } = await requireTenantUser();
    const tenant = await loadEinvoiceTenant(supabase, tenantId);
    if (!tenant.on) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
    return { supabase, tenantId, tenant };
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return { error: NextResponse.json({ error: err.message }, { status: err.status }) };
  }
}

async function readiness(g: Guarded, id: string): Promise<NextResponse> {
  if (!(await einvoiceColumnsPresent(g.supabase))) {
    return NextResponse.json({ error: "Needs a database update (bundle 30, e-invoicing data).", needsDatabaseUpdate: true }, { status: 503 });
  }
  const ev = await evaluateInvoiceById(g.supabase, g.tenantId, id, g.tenant);
  if (!ev) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data: row } = await g.supabase.from("invoices").select("einvoice_uuid, einvoice_seq").eq("id", id).eq("tenant_id", g.tenantId).maybeSingle();
  return NextResponse.json({
    doc_type: ev.docType,
    ready: ev.ready,
    issues: ev.issues,
    uuid: (row as { einvoice_uuid?: string | null } | null)?.einvoice_uuid ?? null,
    seq: (row as { einvoice_seq?: number | null } | null)?.einvoice_seq ?? null,
    totals: {
      subtotal: fromHalalas(ev.totals.subtotal),
      discount: fromHalalas(ev.totals.discount),
      taxable: fromHalalas(ev.totals.taxableTotal),
      vat: fromHalalas(ev.totals.vatTotal),
      grand_total: fromHalalas(ev.totals.grandTotal),
      by_rate: ev.totals.groups.map((x) => ({
        category: x.category, rate: x.rate, taxable: fromHalalas(x.taxable), vat: fromHalalas(x.vat), lines: x.lines,
      })),
    },
  });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const g = await guard();
  if ("error" in g) return g.error;
  const { id } = await params;
  return readiness(g, id);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const g = await guard();
  if ("error" in g) return g.error;
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { action?: unknown };

  if (!(await einvoiceColumnsPresent(g.supabase))) {
    return NextResponse.json({ error: "Needs a database update (bundle 30, e-invoicing data).", needsDatabaseUpdate: true }, { status: 503 });
  }
  const { data: invoice } = await g.supabase.from("invoices").select("ref, status, einvoice_uuid").eq("id", id).eq("tenant_id", g.tenantId).maybeSingle();
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (body.action === "apply_default_vat") {
    if (invoice.status !== "draft") return NextResponse.json({ error: "Only a draft invoice's lines can be changed." }, { status: 409 });
    const res = await applyDefaultVat(g.supabase, g.tenantId, id);
    if (res.pending) return NextResponse.json({ error: "Needs a database update (bundle 30, e-invoicing data).", needsDatabaseUpdate: true }, { status: 503 });
    if (res.updated > 0) {
      const user = await getAuthUser();
      await logChange(g.supabase, {
        tenantId: g.tenantId, objectType: "invoices", objectId: id, objectLabel: invoice.ref,
        action: "update", actorId: user?.id, actorEmail: user?.email,
        changes: [{ field: "Line VAT category", from: null, to: `Standard rate set on ${res.updated} line${res.updated === 1 ? "" : "s"}` }],
      });
    }
    return readiness(g, id);
  }

  if (body.action === "check") {
    if (!invoice.einvoice_uuid) {
      await g.supabase.from("invoices").update({ einvoice_uuid: randomUUID() }).eq("id", id).eq("tenant_id", g.tenantId).is("einvoice_uuid", null);
    }
    return readiness(g, id);
  }

  return NextResponse.json({ error: "action must be apply_default_vat or check" }, { status: 400 });
}
