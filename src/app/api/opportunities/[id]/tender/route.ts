import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { diffForLog, logChange } from "@/lib/changeLog";
import { loadOpportunity } from "@/lib/sales/opportunityServer";
import { tenantTimezone } from "@/lib/tenantClock";
import { closingDateKey, parseTenderFields } from "@/lib/tender/rules";
import { accountInTenant, loadTender } from "@/lib/tender/server";

// GET / PATCH /api/opportunities/[id]/tender -- the tender block of a tender deal (docs/design/gcc-tender-deals.md
// section 3). A deal without a tender row answers 404. PATCH takes an explicit allow-list (parseTenderFields): the bid
// decision, who decided and when, the reminders already sent, the source e-mail, the deal type and the tenant are not
// settable here. The decision has its own route (./decision).

async function guard() {
  const ctx = await requireTenantUser();
  if (!(await tenantHasFeature(ctx.supabase, ctx.tenantId, "gcc_tender"))) {
    throw Object.assign(new Error("Not found"), { status: 404 });
  }
  if (!(await tenantHasFeature(ctx.supabase, ctx.tenantId, "pipeline"))) {
    throw Object.assign(new Error("Pipeline isn't enabled for your workspace"), { status: 403 });
  }
  return ctx;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let tenantId;
  try { ({ tenantId } = await guard()); } catch (e: unknown) {
    const err = e as { status?: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
  }
  const { id } = await params;
  const admin = createAdminSupabase();
  const tender = await loadTender(admin, tenantId, id);
  if (!tender) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(tender);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try { ({ supabase, tenantId } = await guard()); } catch (e: unknown) {
    const err = e as { status?: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const admin = createAdminSupabase();
  const opp = await loadOpportunity(admin, tenantId, id);
  const before = opp ? await loadTender(admin, tenantId, id) : null;
  if (!opp || !before) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = parseTenderFields(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const patch: Record<string, unknown> = { ...parsed.values };

  if (parsed.values.issuer_account_id && !(await accountInTenant(admin, tenantId, parsed.values.issuer_account_id))) {
    return NextResponse.json({ error: "Issuer account not found" }, { status: 404 });
  }
  if (parsed.values.tender_no && parsed.values.tender_no !== before.tender_no) {
    const { data: dup } = await admin.from("opportunity_tenders").select("opportunity_id").eq("tenant_id", tenantId).eq("tender_no", parsed.values.tender_no).neq("opportunity_id", id).maybeSingle();
    if (dup) return NextResponse.json({ error: `Tender number ${parsed.values.tender_no} already exists` }, { status: 409 });
  }
  if ("custom_data" in body && body.custom_data && typeof body.custom_data === "object") {
    // Only tenant-defined custom fields (cf_*) may land in custom_data.
    const cf = Object.fromEntries(Object.entries(body.custom_data as Record<string, unknown>).filter(([k]) => k.startsWith("cf_")));
    patch.custom_data = { ...(before.custom_data ?? {}), ...cf };
  }

  // A new closing date starts the reminder schedule over, and the deal's expected close follows it when the two were in step.
  const closingChanged = "closing_at" in patch && patch.closing_at !== before.closing_at;
  if (closingChanged) patch.reminders_sent = [];
  patch.updated_at = new Date().toISOString();

  const { error } = await admin.from("opportunity_tenders").update(patch).eq("opportunity_id", id).eq("tenant_id", tenantId);
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "That tender number already exists" }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (closingChanged) {
    const tz = await tenantTimezone(tenantId);
    const oldKey = closingDateKey(before.closing_at, tz);
    const newKey = closingDateKey(patch.closing_at as string | null, tz);
    if (newKey && (!opp.expected_close || opp.expected_close === oldKey)) {
      await admin.from("opportunities").update({ expected_close: newKey, updated_at: new Date().toISOString() }).eq("id", id).eq("tenant_id", tenantId);
    }
  }

  const user = await getAuthUser();
  const { updated_at: _u, reminders_sent: _r, ...diffPatch } = patch;
  const changes = diffForLog("opportunity_tenders", before as unknown as Record<string, unknown>, diffPatch);
  if (changes.length > 0) {
    await logChange(supabase, {
      tenantId, objectType: "opportunity_tenders", objectId: id, objectLabel: `${opp.ref ?? ""} ${opp.title}`.trim(),
      action: "update", actorId: user?.id, actorEmail: user?.email, changes,
    });
  }
  return NextResponse.json(await loadTender(admin, tenantId, id));
}
