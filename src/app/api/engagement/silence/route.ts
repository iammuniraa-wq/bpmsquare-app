import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";

/**
 * Silence Detector -- engagement layer. Learns each account's ordering
 * rhythm from its own won-quote history (median gap between consecutive
 * wins, >= 3 wins required so a rhythm actually exists) and reports who
 * has gone quiet. Nothing is configured and nothing is stored for the
 * rhythm itself; it is recomputed from quotes on every call.
 *
 * "Saves" (POST) are the one stored artifact: the user reached out to an
 * overdue account before it drifted. A saved account leaves the overdue
 * list for 14 days so the list only ever shows what still needs a human.
 */

const MIN_WINS = 3;
const SAVE_SUPPRESS_DAYS = 14;

type OrderRow = { account_id: string; closed_at: string | null; updated_at: string };

export async function GET() {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (!(await tenantHasFeature(supabase, tenantId, "quotations"))) {
    return NextResponse.json({ error: "Quotations isn't enabled for your workspace" }, { status: 403 });
  }

  const { data: won } = await supabase
    .from("quotes")
    .select("account_id, closed_at, updated_at")
    .eq("tenant_id", tenantId)
    .eq("outcome", "won");

  const byAccount = new Map<string, number[]>();
  for (const q of (won ?? []) as OrderRow[]) {
    const t = new Date(q.closed_at ?? q.updated_at).getTime();
    if (!Number.isFinite(t)) continue;
    const arr = byAccount.get(q.account_id) ?? [];
    arr.push(t);
    byAccount.set(q.account_id, arr);
  }

  const now = Date.now();
  const DAY = 86_400_000;
  const rhythms: { account_id: string; rhythm_days: number; days_since: number; last_order_at: string }[] = [];
  for (const [accountId, times] of byAccount) {
    if (times.length < MIN_WINS) continue;
    times.sort((a, b) => a - b);
    const gaps = times.slice(1).map((t, i) => (t - times[i]) / DAY).filter((g) => g > 0);
    if (gaps.length < MIN_WINS - 1) continue;
    gaps.sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)];
    if (median < 7) continue; // several wins in one burst is a project, not a rhythm
    rhythms.push({
      account_id: accountId,
      rhythm_days: Math.round(median),
      days_since: Math.floor((now - times[times.length - 1]) / DAY),
      last_order_at: new Date(times[times.length - 1]).toISOString(),
    });
  }

  if (rhythms.length === 0) return NextResponse.json({ accounts: [], saves_this_month: 0 });

  const { data: accountRows } = await supabase
    .from("accounts")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .in("id", rhythms.map((r) => r.account_id));
  const nameById = new Map((accountRows ?? []).map((a) => [a.id as string, a.name as string]));

  // Saves are best-effort until migration 0087 runs -- a missing table must
  // degrade to "no saves yet", never break the whole card.
  let savesThisMonth = 0;
  const recentlySaved = new Set<string>();
  try {
    const monthStart = new Date();
    monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const { data: saves, error } = await supabase
      .from("engagement_events")
      .select("account_id, created_at")
      .eq("tenant_id", tenantId)
      .eq("kind", "silence_save")
      .gte("created_at", new Date(now - SAVE_SUPPRESS_DAYS * DAY).toISOString());
    if (!error) {
      for (const s of saves ?? []) {
        recentlySaved.add(s.account_id as string);
        if (new Date(s.created_at as string) >= monthStart) savesThisMonth++;
      }
    }
  } catch { /* table not migrated yet */ }

  const accounts = rhythms
    .map((r) => {
      const ratio = r.days_since / r.rhythm_days;
      const state = ratio >= 1 ? "overdue" : ratio >= 0.8 ? "due" : "ok";
      return {
        ...r,
        name: nameById.get(r.account_id) ?? "—",
        state,
        recently_saved: recentlySaved.has(r.account_id),
      };
    })
    // Only what deserves attention travels to the client: overdue first
    // (unless just saved), then due-soon; on-rhythm accounts stay silent.
    .filter((a) => a.state !== "ok" && !(a.state === "overdue" && a.recently_saved))
    .sort((a, b) => (b.days_since / b.rhythm_days) - (a.days_since / a.rhythm_days))
    .slice(0, 6);

  return NextResponse.json({ accounts, saves_this_month: savesThisMonth });
}

export async function POST(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const body = await request.json().catch(() => null);
  const accountId = typeof body?.account_id === "string" ? body.account_id : null;
  if (!accountId) return NextResponse.json({ error: "account_id is required" }, { status: 400 });

  // Guardrails: a client-supplied foreign id is verified against the tenant
  // before use, even with RLS behind it.
  const { data: account } = await supabase
    .from("accounts").select("id").eq("id", accountId).eq("tenant_id", tenantId).maybeSingle();
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const user = await getAuthUser();
  const { error } = await supabase.from("engagement_events").insert({
    tenant_id: tenantId,
    user_id: user?.id,
    account_id: accountId,
    kind: "silence_save",
  });
  if (error) {
    return NextResponse.json(
      { error: "Could not record the save — has migration 0087 been applied?" },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true });
}
