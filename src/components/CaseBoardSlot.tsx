"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useIsNextgen3Layer } from "@/lib/tenant-context";
import CaseLanes from "@/components/CaseLanes";
import CaseField from "@/components/CaseField";
import CaseListNova from "@/components/CaseListNova";
import NovaQueryBar from "@/components/NovaQueryBar";
import { parseCaseQuery, tokensToFilter, filterToParams, matchesFilter, type CaseToken } from "@/lib/caseQuery";
import type { CaseSummary } from "@/lib/data";

type View = "field" | "lanes" | "list";
const VIEWS: View[] = ["field", "lanes", "list"];

/**
 * Nova gate for the Cases redesign (owner request 2026-09-01, same
 * treatment as Quotations' FlowBoardSlot -- see that file for the fuller
 * rationale, repeated here only where Cases genuinely differs).
 *
 * A tenant without the flag never sees the toggle: `list` (the classic
 * <CasesTable>) is the page, exactly as it is today. Only three tabs,
 * not four -- there is no case-equivalent of Quotations' Flow board
 * kanban, so nothing stands in that slot.
 *
 * `rows` here is the SAME already-page-filtered CaseSummary[] the page
 * would otherwise hand straight to <CasesTable> (post breakdown-bar tab,
 * search, and advanced-filter) -- this only adds a second, Nova-only
 * layer of filtering (the query bar) on top, never replaces the page's
 * own filtering.
 */
export default function CaseBoardSlot({
  list, rows,
}: {
  list: React.ReactNode;
  rows: CaseSummary[];
}) {
  const nova = useIsNextgen3Layer();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requested = searchParams.get("view");
  const view: View = VIEWS.includes(requested as View) ? (requested as View) : "field";
  const setView = (v: View) => {
    const next = new URLSearchParams(searchParams.toString());
    if (v === "field") next.delete("view"); else next.set("view", v);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const [tokens, setTokens] = useState<CaseToken[]>(() => {
    const q = searchParams.get("cq");
    return q ? parseCaseQuery(q).tokens : [];
  });
  const [leftover, setLeftover] = useState<string>(() => {
    const q = searchParams.get("cq");
    return q ? parseCaseQuery(q).leftover : "";
  });
  const commitQuery = (text: string) => {
    const parsed = parseCaseQuery(text);
    setTokens((prev) => [...prev.filter((p) => !parsed.tokens.some((n) => n.kind === p.kind)), ...parsed.tokens]);
    setLeftover(parsed.leftover);
  };
  const removeToken = (index: number) => setTokens((prev) => prev.filter((_, i) => i !== index));

  const filter = useMemo(() => tokensToFilter(tokens), [tokens]);
  const filterQuery = useMemo(() => filterToParams(filter).toString(), [filter]);
  const filteredRows = useMemo(() => {
    const now = Date.now();
    return rows.filter((r) => {
      const ageDays = Math.max(0, Math.round((now - new Date(r.serviceCase.intake_at).getTime()) / 86_400_000));
      return matchesFilter({ status: r.serviceCase.status, type: r.serviceCase.type, unassigned: !r.serviceCase.assigned_to, ageDays }, filter);
    });
  }, [rows, filter]);

  if (!nova) return <>{list}</>;

  const switcher = (
    <div style={{
      display: "flex", gap: 2, padding: 2, borderRadius: 9,
      border: "1px solid var(--line, #e5e7eb)", background: "var(--panel2, transparent)",
    }}>
      {([["Field", "field"], ["Lanes", "lanes"], ["List", "list"]] as const).map(([label, v]) => (
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
  );

  return (
    <>
      <NovaQueryBar
        tokens={tokens}
        leftover={leftover}
        matchingCount={filteredRows.length}
        totalCount={rows.length}
        onCommit={commitQuery}
        onRemoveToken={removeToken}
        right={switcher}
        noun="cases"
        placeholder="Ask for what you want — e.g. unassigned cases open over a fortnight"
      />
      {view === "lanes" ? <CaseLanes filterQuery={filterQuery} />
        : view === "list" ? <CaseListNova rows={filteredRows} />
        : <CaseField filterQuery={filterQuery} />}
    </>
  );
}
