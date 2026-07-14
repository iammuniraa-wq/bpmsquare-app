import Link from "next/link";
import { listCases } from "@/lib/data";
import type { ServiceCase } from "@/lib/types";
import { c, pillar } from "@/lib/theme";
import PageHeader from "@/components/PageHeader";
import { ROUTES } from "@/lib/constants";
import CasesTable from "@/components/CasesTable";
import BreakdownBar from "@/components/BreakdownBar";

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
  searchParams: Promise<{ q?: string; filter?: string }>;
}) {
  const { q, filter: rawFilter } = await searchParams;
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

  const rows = byFilter.filter(({ serviceCase: sc, account }) => {
    if (!q) return true;
    const term = q.toLowerCase();
    return (
      sc.ref.toLowerCase().includes(term) ||
      (sc.equipment_label ?? "").toLowerCase().includes(term) ||
      account.name.toLowerCase().includes(term) ||
      (sc.complaint ?? "").toLowerCase().includes(term)
    );
  });

  const href = (f: FilterKey) =>
    `${ROUTES.cases}?filter=${f}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

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
      <form method="GET" style={{ marginBottom: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {filter !== "open" && <input type="hidden" name="filter" value={filter} />}
        <input
          name="q"
          defaultValue={q}
          placeholder="Search by ref, equipment, account or complaint…"
          autoComplete="off"
          style={{
            flex: "1 1 300px", maxWidth: 420, padding: "8px 12px", borderRadius: 7,
            border: `1px solid ${c.line}`, fontSize: 13.5, color: c.ink,
            background: "#fff", outline: "none",
          }}
        />
        {q && (
          <Link href={`${ROUTES.cases}?filter=${filter}`} style={{ fontSize: 12, color: c.hint, textDecoration: "none" }}>
            Clear ✕
          </Link>
        )}
      </form>

      {/* ── Table with adapt mode ────────────────────────────────────────── */}
      <CasesTable rows={rows} q={q} filter={filter} />
    </>
  );
}
