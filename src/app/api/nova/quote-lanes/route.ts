import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { DEFAULT_QUOTE_STATUSES, type QuoteStatusDef } from "@/lib/constants";
import { filterFromParams, matchesFilter } from "@/lib/quoteQuery";

/**
 * Nova — Quote Lanes ("Living quotes"). First slice of the Quotations
 * redesign (owner discussion 2026-08-31): three lanes derived from real
 * fields only, never a fabricated signal. Deliberately narrower than the
 * original concept's "Waiting on you" lane, which assumed inbound-reply
 * tracking this codebase doesn't have -- there is no buyer-reply detection
 * anywhere in the app, so that lane is redefined here as "Needs first
 * send" (never submitted at all), which submitted_at already tells us
 * honestly. If reply-tracking ever gets built, this is the file to widen.
 *
 * Lane assignment, in priority order, over quotes that are still OPEN
 * (outcome === "open" -- won/lost quotes need nothing further):
 *   1. Cold      -- no touch (updated_at) in 14+ days.
 *   2. Needs send -- never submitted (submitted_at is null), touched recently.
 *   3. Normal    -- everything else open. Collapsed by default on the client.
 */

const COLD_DAYS = 14;

export async function GET(request: NextRequest) {
  // Same QuoteFilter every view resolves from the same URL params -- see
  // lib/quoteQuery.ts. Lanes' own base scope (outcome="open" only) is
  // untouched by this; a "won" filter combined with Lanes legitimately
  // shows nothing, since Lanes never shows a decided quote to begin with.
  const filter = filterFromParams(request.nextUrl.searchParams);
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (!(await tenantHasFeature(supabase, tenantId, "next_experience"))) {
    return NextResponse.json({ error: "Nova isn't enabled for your workspace" }, { status: 403 });
  }

  const admin = createAdminSupabase();

  const [{ data: tenantRow }, { data: quoteRows }] = await Promise.all([
    admin.from("tenants").select("config").eq("id", tenantId).maybeSingle(),
    admin.from("quotes")
      .select("id, ref, account_id, status, outcome, total, created_at, updated_at, submitted_at, valid_until")
      .eq("tenant_id", tenantId)
      .eq("outcome", "open")
      .order("updated_at", { ascending: true })
      .limit(500),
  ]);

  const statuses: QuoteStatusDef[] =
    (tenantRow?.config as { quote_statuses?: QuoteStatusDef[] } | null)?.quote_statuses ?? DEFAULT_QUOTE_STATUSES;
  const statusLabel = new Map(statuses.map((s) => [s.value, s.label]));

  const quotes = (quoteRows ?? []) as {
    id: string; ref: string; account_id: string; status: string; outcome: string;
    total: number; created_at: string; updated_at: string; submitted_at: string | null; valid_until: string | null;
  }[];

  const accountIds = [...new Set(quotes.map((q) => q.account_id).filter(Boolean))];
  const quoteIds = quotes.map((q) => q.id);
  const [{ data: accountRows }, { data: lineRows }] = await Promise.all([
    accountIds.length
      ? admin.from("accounts").select("id, name").eq("tenant_id", tenantId).in("id", accountIds)
      : Promise.resolve({ data: [] }),
    quoteIds.length
      ? admin.from("quote_lines").select("quote_id").eq("tenant_id", tenantId).in("quote_id", quoteIds)
      : Promise.resolve({ data: [] }),
  ]);
  const accountName = new Map((accountRows ?? []).map((a) => [a.id as string, a.name as string]));
  const lineCount = new Map<string, number>();
  for (const row of (lineRows ?? []) as { quote_id: string }[]) {
    lineCount.set(row.quote_id, (lineCount.get(row.quote_id) ?? 0) + 1);
  }

  const now = Date.now();
  const cards = quotes.filter((q) => {
    const touchedAt = new Date(q.updated_at ?? q.created_at).getTime();
    const ageDays = Math.max(0, Math.round((now - touchedAt) / 86_400_000));
    return matchesFilter({ total: q.total ?? 0, status: q.status, outcome: q.outcome, idleDays: ageDays }, filter);
  }).map((q) => {
    const touchedAt = new Date(q.updated_at ?? q.created_at).getTime();
    const ageDays = Math.max(0, Math.round((now - touchedAt) / 86_400_000));
    const neverSent = !q.submitted_at;
    let lane: "cold" | "action" | "normal";
    let situation: string;
    if (ageDays >= COLD_DAYS) {
      lane = "cold";
      situation = neverSent
        ? `Never sent. Created ${ageDays} days ago.`
        : `In ${statusLabel.get(q.status) ?? q.status} for ${ageDays} days with no update.`;
    } else if (neverSent) {
      lane = "action";
      situation = `Never sent. Created ${ageDays} day${ageDays === 1 ? "" : "s"} ago.`;
    } else {
      lane = "normal";
      situation = "";
    }
    return {
      id: q.id,
      ref: q.ref,
      account: accountName.get(q.account_id) ?? "—",
      total: q.total ?? 0,
      status: q.status,
      lineCount: lineCount.get(q.id) ?? 0,
      ageDays,
      neverSent,
      lane,
      situation,
    };
  });

  const summarize = (lane: string) => {
    const rows = cards.filter((c) => c.lane === lane);
    return { count: rows.length, value: rows.reduce((s, c) => s + c.total, 0) };
  };

  return NextResponse.json({
    cards: cards.filter((c) => c.lane !== "normal"),
    normal: summarize("normal"),
    cold: summarize("cold"),
    action: summarize("action"),
    cold_days: COLD_DAYS,
  });
}
