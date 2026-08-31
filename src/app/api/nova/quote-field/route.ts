import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { filterFromParams, matchesFilter } from "@/lib/quoteQuery";

/**
 * Nova — Quote Field. Second slice of the Quotations redesign (owner
 * discussion 2026-08-31), a plot of every open-or-recently-decided quote:
 * days idle across, value up, line count as size, three real colours for
 * status. Its own full-screen tab and the default view (see
 * FlowBoardSlot.tsx) -- an earlier pass shipped it as a compact band
 * above Lanes, which read as cluttered against the concept mockup.
 *
 * One deliberate deviation from the original written spec, worth being
 * explicit about: the spec's axis was "days since CREATED". This uses
 * "days since last touched" (updated_at) instead -- the same signal
 * Lanes already uses -- because that's what "quietly ageing" actually
 * means (a quote created 40 days ago but edited yesterday isn't
 * abandoned; one created 10 days ago and never touched since might be).
 * Using one idle-time definition everywhere the redesign needs one, not
 * two different clocks that happen to look similar, is worth more than
 * matching the mockup's axis label literally.
 *
 * Colour is derived from real fields only, no invented "negotiating"
 * status: draft (status="draft", still open), sent (any other open
 * status), accepted (outcome="won"). Lost quotes are excluded -- there's
 * no money still at stake in them.
 */

const EXPOSURE_VALUE = 100_000;
const EXPOSURE_DAYS = 14;

export async function GET(request: NextRequest) {
  // Same QuoteFilter every view resolves from the same URL params -- see
  // lib/quoteQuery.ts.
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

  const { data: quoteRows } = await admin
    .from("quotes")
    .select("id, ref, account_id, status, outcome, total, created_at, updated_at")
    .eq("tenant_id", tenantId)
    .neq("outcome", "lost")
    .order("updated_at", { ascending: false })
    .limit(500);

  const quotes = (quoteRows ?? []) as {
    id: string; ref: string; account_id: string; status: string; outcome: string;
    total: number; created_at: string; updated_at: string;
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
  const points = quotes.filter((q) => {
    const idleDays = Math.max(0, Math.round((now - new Date(q.updated_at ?? q.created_at).getTime()) / 86_400_000));
    return matchesFilter({ total: q.total ?? 0, status: q.status, outcome: q.outcome, idleDays }, filter);
  }).map((q) => {
    const idleDays = Math.max(0, Math.round((now - new Date(q.updated_at ?? q.created_at).getTime()) / 86_400_000));
    const color: "draft" | "sent" | "accepted" =
      q.outcome === "won" ? "accepted" : q.status === "draft" ? "draft" : "sent";
    return {
      id: q.id,
      ref: q.ref,
      account: accountName.get(q.account_id) ?? "—",
      total: q.total ?? 0,
      idleDays,
      lineCount: lineCount.get(q.id) ?? 0,
      color,
      exposed: q.total >= EXPOSURE_VALUE && idleDays >= EXPOSURE_DAYS,
    };
  });

  const exposed = points
    .filter((p) => p.exposed)
    .sort((a, b) => b.total - a.total);

  return NextResponse.json({
    points,
    exposed,
    exposure_value: EXPOSURE_VALUE,
    exposure_days: EXPOSURE_DAYS,
  });
}
