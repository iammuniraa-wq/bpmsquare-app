import { NextResponse } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { DEFAULT_QUOTE_STATUSES, type QuoteStatusDef } from "@/lib/constants";

/**
 * Nova — the Flow Board's data.
 *
 * A normal CRM board asks the database "what status is this quote in", draws
 * a column per answer, and stops. That board can't tell you anything about
 * TIME: a quote that reached Sent this morning and one stuck there since
 * March render identically.
 *
 * change_log (0050) already records every status change with its from, its
 * to and its timestamp, so this route returns each quote's whole status
 * TIMELINE rather than its current status. Everything else -- which column
 * a quote sits in, how long it has been there, and what the entire board
 * looked like on any past date -- is derived from that timeline on the
 * client. One fetch, and the time scrubber then costs nothing.
 *
 * HISTORY_DAYS bounds the change_log read; quotes older than that still
 * appear, they just have no recorded movement before the window.
 */

const HISTORY_DAYS = 120;

type Change = { field: string; from: unknown; to: unknown };

export async function GET() {
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
  const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString();

  const [{ data: tenantRow }, { data: quoteRows }, { data: logRows }] = await Promise.all([
    admin.from("tenants").select("config").eq("id", tenantId).maybeSingle(),
    admin.from("quotes")
      .select("id, ref, account_id, status, outcome, total, created_at, quote_date, valid_until")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(400),
    admin.from("change_log")
      .select("object_id, changes, created_at")
      .eq("tenant_id", tenantId)
      .eq("object_type", "quotes")
      .eq("action", "update")
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(4000),
  ]);

  const statuses: QuoteStatusDef[] =
    (tenantRow?.config as { quote_statuses?: QuoteStatusDef[] } | null)?.quote_statuses ?? DEFAULT_QUOTE_STATUSES;

  const quotes = (quoteRows ?? []) as {
    id: string; ref: string; account_id: string; status: string;
    outcome: string; total: number; created_at: string; quote_date: string | null; valid_until: string | null;
  }[];

  const accountIds = [...new Set(quotes.map((q) => q.account_id).filter(Boolean))];
  const { data: accountRows } = accountIds.length
    ? await admin.from("accounts").select("id, name").eq("tenant_id", tenantId).in("id", accountIds)
    : { data: [] };
  const accountName = new Map((accountRows ?? []).map((a) => [a.id as string, a.name as string]));

  // Status moves per quote, oldest first.
  const movesByQuote = new Map<string, { at: string; from: string | null; to: string }[]>();
  for (const row of (logRows ?? []) as { object_id: string; changes: Change[]; created_at: string }[]) {
    const move = (row.changes ?? []).find((c) => c.field === "status");
    if (!move) continue;
    const list = movesByQuote.get(row.object_id) ?? [];
    list.push({
      at: row.created_at,
      from: typeof move.from === "string" ? move.from : null,
      to: typeof move.to === "string" ? move.to : "",
    });
    movesByQuote.set(row.object_id, list);
  }

  const payload = quotes.map((q) => {
    const moves = (movesByQuote.get(q.id) ?? []).filter((m) => m.to);
    // The quote's status at creation is the `from` of its first recorded
    // move; with no recorded moves it has simply always been where it is.
    const openingStatus = moves.length > 0 ? (moves[0].from ?? q.status) : q.status;
    const timeline = [
      { at: q.quote_date ?? q.created_at, status: openingStatus },
      ...moves.map((m) => ({ at: m.at, status: m.to })),
    ];
    // The live row is the authority on where the quote is NOW -- a status
    // written by a path that didn't log (or before the window) would
    // otherwise leave the board disagreeing with the record itself.
    if (timeline[timeline.length - 1].status !== q.status) {
      timeline.push({ at: new Date().toISOString(), status: q.status });
    }
    return {
      id: q.id,
      ref: q.ref,
      account: accountName.get(q.account_id) ?? "—",
      total: q.total ?? 0,
      outcome: q.outcome,
      valid_until: q.valid_until,
      created_at: q.quote_date ?? q.created_at,
      timeline,
    };
  });

  return NextResponse.json({
    statuses: statuses.map((s) => ({ value: s.value, label: s.label, color: s.color, is_closed: !!s.is_closed })),
    quotes: payload,
    history_days: HISTORY_DAYS,
  });
}
