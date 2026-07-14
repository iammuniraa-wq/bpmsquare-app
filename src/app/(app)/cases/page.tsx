import Link from "next/link";
import { listCases } from "@/lib/data";
import type { ServiceCase } from "@/lib/types";
import { c, pillar } from "@/lib/theme";
import type { PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import PageHeader from "@/components/PageHeader";
import { ROUTES } from "@/lib/constants";
import CasesTable from "@/components/CasesTable";

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
  searchParams: Promise<{ q?: string; filter?: string; territory?: string }>;
}) {
  const { q, filter: rawFilter, territory: territoryFilter } = await searchParams;
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
    if (territoryFilter && !(sc.territory ?? "").toLowerCase().includes(territoryFilter.toLowerCase())) return false;
    if (!q) return true;
    const term = q.toLowerCase();
    return (
      sc.ref.toLowerCase().includes(term) ||
      (sc.equipment_label ?? "").toLowerCase().includes(term) ||
      account.name.toLowerCase().includes(term) ||
      (sc.complaint ?? "").toLowerCase().includes(term)
    );
  });

  const filterHref = (f: FilterKey) =>
    `${ROUTES.cases}?filter=${f}${q ? `&q=${encodeURIComponent(q)}` : ""}${territoryFilter ? `&territory=${encodeURIComponent(territoryFilter)}` : ""}`;

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

      {/* ── Stats strip — doubles as the filter nav ───────────────────────── */}
      <div style={{ ...cardStyle, padding: "14px 20px", marginBottom: 14, display: "flex", gap: 0 }}>
        <StatChip value={open.length}     label="Open"              tone="blue"  active={filter === "open"}      href={filterHref("open")} />
        <StatChip value={inRepair.length} label="In repair"         tone="teal"  active={filter === "in_repair"} href={filterHref("in_repair")} />
        <StatChip value={awaiting.length} label="Awaiting approval" tone="amber" active={filter === "awaiting"}  href={filterHref("awaiting")} />
        <StatChip value={closed.length}   label="Closed"            tone="green" active={filter === "closed"}    href={filterHref("closed")} />
        <StatChip value={allCases.length} label="All cases"                      active={filter === "all"}       href={filterHref("all")} />
      </div>

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
        <input
          name="territory"
          defaultValue={territoryFilter}
          placeholder="Territory…"
          autoComplete="off"
          style={{
            flex: "0 0 140px", padding: "8px 12px", borderRadius: 7,
            border: `1px solid ${c.line}`, fontSize: 13, color: c.ink,
            background: "#fff", outline: "none",
          }}
        />
        {(q || territoryFilter) && (
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

// ── Stat chip — clickable, shows active state ─────────────────────────────────

function StatChip({ value, label, tone, active, href }: {
  value: number; label: string; tone?: PillarKey; active: boolean; href: string;
}) {
  const color = tone ? pillar[tone].base : c.muted;
  return (
    <Link href={href} style={{
      textAlign: "center", padding: "0 24px",
      borderRight: `1px solid ${c.line}`,
      textDecoration: "none",
      borderBottom: active ? `2.5px solid ${color}` : "2.5px solid transparent",
      paddingBottom: active ? 0 : 2,
    }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: active ? color : c.ink, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11.5, color: active ? color : c.hint, marginTop: 4 }}>{label}</div>
    </Link>
  );
}
