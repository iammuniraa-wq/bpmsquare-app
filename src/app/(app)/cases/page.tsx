import { requireFeature } from "@/lib/tenant";
import Link from "next/link";
import { listCases } from "@/lib/data";
import type { ServiceCase } from "@/lib/types";
import { c, pillar } from "@/lib/theme";
import PageHeader from "@/components/PageHeader";
import { ROUTES } from "@/lib/constants";
import CasesTable from "@/components/CasesTable";
import BreakdownBar from "@/components/BreakdownBar";
import { requireWorkcenterView } from "@/lib/permissions";
import ListFilterBar from "@/components/ListFilterBar";
import AdvancedFilterPanel from "@/components/AdvancedFilterPanel";
import { applyAdvancedFilter } from "@/lib/advancedFilter";

const OPEN_STATUSES: ServiceCase["status"][] = [
  "intake","inspection","report_sent","report_approved",
  "quote_sent","quote_approved","in_repair","qa","ready",
];

type FilterKey = "open" | "in_repair" | "awaiting" | "closed" | "all";

const FILTERS: { id: FilterKey; label: string }[] = [
  { id: "open",      label: "Open"      },
  { id: "in_repair", label: "In repair" },
  { id: "awaiting",  label: "Awaiting"  },
  { id: "closed",    label: "Closed"    },
  { id: "all",       label: "All"       },
];

export default async function CasesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string; af?: string }>;
}) {
  await requireWorkcenterView("cases");
  await requireFeature("cases");
  const { q, filter: rawFilter, af } = await searchParams;
  const filter = (FILTERS.find((f) => f.id === rawFilter)?.id) ?? "open";

  const allCases = await listCases();

  const open     = allCases.filter((r) => OPEN_STATUSES.includes(r.serviceCase.status));
  const inRepair = allCases.filter((r) => r.serviceCase.status === "in_repair");
  const awaiting = allCases.filter((r) => ["report_sent","quote_sent"].includes(r.serviceCase.status));
  const closed   = allCases.filter((r) => ["closed","buyback","scrapped"].includes(r.serviceCase.status));

  const byFilter =
    filter === "open"      ? open
    : filter === "in_repair" ? inRepair
    : filter === "awaiting"  ? awaiting
    : filter === "closed"    ? closed
    : allCases;

  const basicFiltered = byFilter.filter(({ serviceCase: sc, account }) => {
    if (!q) return true;
    const term = q.toLowerCase();
    return (
      sc.ref.toLowerCase().includes(term) ||
      (sc.equipment_label ?? "").toLowerCase().includes(term) ||
      account.name.toLowerCase().includes(term) ||
      (sc.complaint ?? "").toLowerCase().includes(term)
    );
  });

  const rows = applyAdvancedFilter(basicFiltered, af, ({ serviceCase }) => serviceCase as unknown as Record<string, unknown>);

  const href = (f: FilterKey) =>
    `${ROUTES.cases}?filter=${f}${q ? `&q=${encodeURIComponent(q)}` : ""}${af ? `&af=${encodeURIComponent(af)}` : ""}`;

  return (
    <>
      <PageHeader
        title="Cases"
        subtitle={`${allCases.length} total · ${open.length} open`}
        action={
          <Link
            href={ROUTES.caseNew}
            style={{
              padding: "8px 16px", borderRadius: 7, fontSize: 13, fontWeight: 600,
              background: c.accent, color: "#fff", textDecoration: "none",
            }}
          >
            + New Case
          </Link>
        }
      />

      {/* ── Breakdown bar — clickable metrics ────────────────────────────── */}
      <BreakdownBar items={[
        { label: "Open",      count: open.length,     color: pillar.blue.base,  href: href("open"),      active: filter === "open" },
        { label: "In repair", count: inRepair.length, color: pillar.teal.base,  href: href("in_repair"), active: filter === "in_repair" },
        { label: "Awaiting",  count: awaiting.length, color: pillar.amber.base, href: href("awaiting"),  active: filter === "awaiting" },
        { label: "Closed",    count: closed.length,   color: pillar.green.base, href: href("closed"),    active: filter === "closed" },
        { label: "All",       count: allCases.length, color: c.muted,           href: href("all"),       active: filter === "all" },
      ]} />

      {/* ── Search ───────────────────────────────────────────────────────── */}
      <ListFilterBar
        searchValue={q}
        searchPlaceholder="Search ref, equipment or account…"
        hiddenParams={{ filter, af }}
        clearHref={ROUTES.cases}
      />
      <AdvancedFilterPanel object="case" />

      {/* ── Table with adapt mode ────────────────────────────────────────── */}
      <CasesTable rows={rows} q={q} filter={filter} />
    </>
  );
}
