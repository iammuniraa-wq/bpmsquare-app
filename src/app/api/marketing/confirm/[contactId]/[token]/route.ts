import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { clientIp, hashIp, uaFamily } from "@/lib/marketing/forms/guards";
import { confirmPendingConsent, loadConfirmView } from "@/lib/marketing/forms/confirm";
import { verifyConfirmToken } from "@/lib/marketing/forms/confirmToken";

// The state change of the double opt-in - deliberately a POST from a button on the page, not the
// page's own load, since mail scanners open links inside emails. The signed, expiring token is
// verified before anything is read; the tenant is the contact row's own.
//
// POST /api/marketing/confirm/[contactId]/[token]

export async function POST(req: Request, { params }: { params: Promise<{ contactId: string; token: string }> }) {
  const { contactId, token } = await params;
  const check = verifyConfirmToken(contactId, token);
  if (!check.ok) {
    return NextResponse.json(
      { error: check.reason === "expired" ? "This link has expired. Please fill in the form again and we will send you a new one." : "This link is not valid." },
      { status: check.reason === "expired" ? 410 : 404 },
    );
  }
  const admin = createAdminSupabase();
  const view = await loadConfirmView(admin, contactId, check.windowStart);
  if (!view) return NextResponse.json({ error: "This link is not valid." }, { status: 404 });
  const r = await confirmPendingConsent(admin, view.tenantId, contactId, check.windowStart, { ipHash: hashIp(clientIp(req.headers)), uaFamily: uaFamily(req.headers.get("user-agent")) });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, confirmed: r.confirmed }, { headers: { "Cache-Control": "no-store" } });
}
