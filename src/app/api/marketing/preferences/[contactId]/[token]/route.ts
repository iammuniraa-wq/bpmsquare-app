import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { clientIp, hashIp, uaFamily } from "@/lib/marketing/forms/guards";
import { applyPreferenceChanges, loadPreferences, parseChanges } from "@/lib/marketing/forms/preferences";
import { verifyPreferenceToken } from "@/lib/marketing/forms/preferenceToken";

// The state change of the preference centre - deliberately a POST from a button on the page, not
// the page's own load, since mail scanners open links inside emails. The signed token is verified
// before anything is read; the tenant is the contact row's own. Every change is one new row in the
// consent ledger (source "preference_centre").
//
// POST /api/marketing/preferences/[contactId]/[token]  { changes: [{ topic: key | null, on: boolean }] }
//   topic null + on false = "unsubscribe from all".

export async function POST(req: Request, { params }: { params: Promise<{ contactId: string; token: string }> }) {
  const { contactId, token } = await params;
  if (!verifyPreferenceToken(contactId, token)) return NextResponse.json({ error: "This link is invalid." }, { status: 404 });
  const raw = await req.text().catch(() => "");
  if (raw.length > 4000) return NextResponse.json({ error: "That is too much to send." }, { status: 413 });
  let body: unknown = null;
  try { body = JSON.parse(raw); } catch { /* handled below */ }
  const changes = parseChanges(body);
  if (!changes) return NextResponse.json({ error: "That could not be read." }, { status: 400 });

  const admin = createAdminSupabase();
  const loaded = await loadPreferences(admin, contactId);
  if (!loaded) return NextResponse.json({ error: "This link is invalid." }, { status: 404 });
  const r = await applyPreferenceChanges(admin, loaded, changes, { ipHash: hashIp(clientIp(req.headers)), uaFamily: uaFamily(req.headers.get("user-agent")) });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  const after = await loadPreferences(admin, contactId);
  return NextResponse.json({ ok: true, changed: r.changed, topics: after?.view.topics ?? [], blocked: after?.view.blocked ?? null }, { headers: { "Cache-Control": "no-store" } });
}
