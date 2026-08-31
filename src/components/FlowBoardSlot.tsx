"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useIsNextgen3Layer } from "@/lib/tenant-context";
import FlowBoard from "@/components/FlowBoard";
import QuoteLanes from "@/components/QuoteLanes";
import QuoteField from "@/components/QuoteField";
import QuoteListNova from "@/components/QuoteListNova";
import QuoteQueryBar from "@/components/QuoteQueryBar";
import { parseQuoteQuery, tokensToFilter, filterToParams, matchesFilter, type QuoteToken } from "@/lib/quoteQuery";
import type { QuoteSummary } from "@/lib/data";
import type { QuoteStatusDef } from "@/lib/constants";

type View = "field" | "list" | "lanes" | "board";
const VIEWS: View[] = ["field", "list", "lanes", "board"];

/**
 * Nova gate for the Flow Board and Quote Lanes, both of which plot QUOTES
 * and so belong to Quotations -- not to Pipeline, which is reserved for
 * the Opportunity journey board (PROJECT.md §UX principles).
 *
 * A tenant without the flag never sees the toggle: the list is the page,
 * exactly as it is today. Lanes (added 2026-08-31, first slice of the
 * Quotations redesign -- see QuoteLanes.tsx) sits alongside Flow board
 * rather than replacing it; retiring Flow board is a later call once
 * Lanes is validated on a real tenant, not a day-one deletion.
 *
 * Field (second slice -- see QuoteField.tsx) originally rendered as a
 * band above Lanes rather than its own tab; owner feedback 2026-08-31
 * ("expecting [the mockup], got [a cramped combined view]") reversed
 * that -- Field is now a genuine fourth tab, matching the concept
 * mockup, and is the DEFAULT view for a Nova tenant (a tenant without
 * the flag is unaffected either way, since it never sees the switcher).
 *
 * List itself (third slice -- see QuoteListNova.tsx) is a genuine swap,
 * not an overlay like Field: a Nova tenant's "List" tab renders
 * QuoteListNova on the same `rows`, never the classic <QuotationsList>
 * passed in as `list`. That component is untouched and is exactly what
 * every non-Nova tenant still renders unconditionally -- this only ever
 * substitutes it after the nova flag is already confirmed true.
 *
 * The query bar (fourth slice -- see QuoteQueryBar.tsx / lib/quoteQuery.ts)
 * lives here, above the view switcher, not inside any one view -- "filtering
 * is not a property of a view; it belongs to the page." Tokens are seeded
 * once from `?q=` on mount and are independent state from then on (per
 * quoteQuery.ts's own doc comment); the resolved QuoteFilter is the single
 * shared source of truth, serialised as URL params for Lanes'/Field's own
 * fetches and applied directly to `rows` for List.
 */
export default function FlowBoardSlot({
  list, rows, quoteStatuses,
}: {
  list: React.ReactNode;
  rows: QuoteSummary[];
  quoteStatuses: QuoteStatusDef[];
}) {
  const nova = useIsNextgen3Layer();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // The view lives in the URL, not component state -- "send a colleague a
  // link to the exact thing they were looking at" only works if switching
  // views is a real navigation, not a client-only toggle. Other params
  // (the list's own `af` advanced-filter conditions, etc.) are preserved
  // untouched; this only ever writes its own `view` key.
  const requested = searchParams.get("view");
  const view: View = VIEWS.includes(requested as View) ? (requested as View) : "field";
  const setView = (v: View) => {
    const next = new URLSearchParams(searchParams.toString());
    if (v === "field") next.delete("view"); else next.set("view", v);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  // Seeded once from ?q= on mount, then independent state -- see
  // quoteQuery.ts: "once a token exists it's independent state, never
  // re-derived from text again."
  const [tokens, setTokens] = useState<QuoteToken[]>(() => {
    const q = searchParams.get("q");
    return q ? parseQuoteQuery(q).tokens : [];
  });
  const [leftover, setLeftover] = useState<string>(() => {
    const q = searchParams.get("q");
    return q ? parseQuoteQuery(q).leftover : "";
  });
  const commitQuery = (text: string) => {
    const parsed = parseQuoteQuery(text);
    setTokens((prev) => [...prev.filter((p) => !parsed.tokens.some((n) => n.kind === p.kind)), ...parsed.tokens]);
    setLeftover(parsed.leftover);
  };
  const removeToken = (index: number) => setTokens((prev) => prev.filter((_, i) => i !== index));

  const filter = useMemo(() => tokensToFilter(tokens), [tokens]);
  const filterQuery = useMemo(() => filterToParams(filter).toString(), [filter]);
  const filteredRows = useMemo(() => {
    const now = Date.now();
    return rows.filter((r) => {
      const idleDays = Math.max(0, Math.round((now - new Date(r.quote.updated_at ?? r.quote.created_at).getTime()) / 86_400_000));
      return matchesFilter({ total: r.quote.total ?? 0, status: r.quote.status, outcome: r.quote.outcome, idleDays }, filter);
    });
  }, [rows, filter]);

  if (!nova) return <>{list}</>;

  return (
    <>
      <QuoteQueryBar
        tokens={tokens}
        leftover={leftover}
        matchingCount={filteredRows.length}
        totalCount={rows.length}
        onCommit={commitQuery}
        onRemoveToken={removeToken}
      />
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <div style={{
          display: "flex", gap: 2, padding: 2, borderRadius: 9,
          border: "1px solid var(--line, #e5e7eb)", background: "var(--panel2, transparent)",
        }}>
          {([["Field", "field"], ["Lanes", "lanes"], ["List", "list"], ["Flow board", "board"]] as const).map(([label, v]) => (
            <button
              key={label}
              onClick={() => setView(v)}
              style={{
                padding: "6px 13px", borderRadius: 7, cursor: "pointer", font: "inherit",
                fontSize: 12.5, fontWeight: 650, border: "none",
                background: view === v ? "var(--panel, #fff)" : "transparent",
                color: view === v ? "var(--ink, #111827)" : "var(--muted, #6b7280)",
                boxShadow: view === v ? "0 1px 3px rgba(0,0,0,.10)" : "none",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {view === "board" ? <FlowBoard />
        : view === "lanes" ? <QuoteLanes filterQuery={filterQuery} />
        : view === "list" ? <QuoteListNova rows={filteredRows} quoteStatuses={quoteStatuses} />
        : <QuoteField filterQuery={filterQuery} />}
    </>
  );
}
