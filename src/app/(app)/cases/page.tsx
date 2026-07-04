import Link from "next/link";
import { listCases, CASE_STATUS_LABEL, CASE_TYPE_LABEL } from "@/lib/data";
import type { ServiceCase } from "@/lib/types";
import { c, pillar } from "@/lib/theme";
import type { PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import PageHeader from "@/components/PageHeader";
import Pill from "@/components/Pill";
import { ROUTES } from "@/lib/constants";

const OPEN_STATUSES: ServiceCase["status"][] = [
  "intake","inspection","report_sent","report_approved",
  "quote_sent","quote_approved","in_repair","qa","ready",
];

const statusTone: Record<ServiceCase["status"], PillarKey> = {
  intake: "blue", inspection: "blue",
  report_sent: "purple", report_approved: "purple",
  quote_sent: "amber", quote_approved: "amber",
  in_repair: "teal", qa: "teal", ready: "green",
  closed: "green", buyback: "purple", scrapped: "red",
};

const typeTone: Record<ServiceCase["type"], PillarKey> = {
  amc: "teal", adhoc: "amber", direct: "blue",
};

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

type FilterKey = "open" | "in_repair" | "awaiting" | "closed" | "all";

const FILTERS: { id: FilterKey; label: string }[] = [
  { id: "open",     label: "Open"      },
  { id: "in_repair",label: "In repair" },
  { id: "awaiting", label: "Awaiting"  },
  { id: "closed",   label: "Closed"    },
  { id: "all",      label: "All"       },
];

export default async function CasesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string }>;
}) {
  const { q, filter: rawFilter } = await searchParams;
  const filter = (FILTERS.find((f) => f.id === rawFilter)?.id) ?? "open";

  const allCases = await listCases();

  const open      = allCases.filter((r) => OPEN_STATUSES.includes(r.serviceCase.status));
  const inRepair  = allCases.filter((r) => r.serviceCase.status === "in_repair");
  const awaiting  = allCases.filter((r) => ["report_sent","quote_sent"].includes(r.serviceCase.status));
  const closed    = allCases.filter((r) => ["closed","buyback","scrapped"].includes(r.serviceCase.status));

  // Apply status filter first
  const byFilter =
    filter === "open"      ? open
    : filter === "in_repair" ? inRepair
    : filter === "awaiting"  ? awaiting
    : filter === "closed"    ? closed
    : allCases;

  // Then apply search
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

  const filterHref = (f: FilterKey) =>
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

      {/* ── Stats strip ──────────────────────────────────────────────────── */}
      <div style={{ ...cardStyle, padding: "14px 20px", marginBottom: 14, display: "flex", gap: 0 }}>
        <StatChip value={open.length}     label="Open"              tone="blue"  active={filter === "open"}      href={filterHref("open")} />
        <StatChip value={inRepair.length} label="In repair"         tone="teal"  active={filter === "in_repair"} href={filterHref("in_repair")} />
        <StatChip value={awaiting.length} label="Awaiting approval" tone="amber" active={filter === "awaiting"}  href={filterHref("awaiting")} />
        <StatChip value={closed.length}   label="Closed"            tone="green" active={filter === "closed"}    href={filterHref("closed")} />
        <StatChip value={allCases.length} label="All cases"                      active={filter === "all"}       href={filterHref("all")} />
      </div>

      {/* ── Search + filter bar ──────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <form method="GET" style={{ flex: "1 1 240px" }}>
          {filter !== "open" && <input type="hidden" name="filter" value={filter} />}
          <input
            name="q"
            defaultValue={q}
            placeholder="Search by ref, equipment, account or complaint…"
            autoComplete="off"
            style={{
              width: "100%", padding: "8px 12px", borderRadius: 7,
              border: `1px solid ${c.line}`, fontSize: 13.5, color: c.ink,
              background: "#fff", outline: "none",
            }}
          />
        </form>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {FILTERS.map((f) => {
            const active = filter === f.id;
            return (
              <Link
                key={f.id}
                href={filterHref(f.id)}
                style={{
                  padding: "7px 14px", borderRadius: 6, fontSize: 12.5, fontWeight: 600,
                  background: active ? c.accent : c.panel2,
                  color: active ? "#fff" : c.muted,
                  textDecoration: "none", border: `1px solid ${active ? c.accent : c.line}`,
                  whiteSpace: "nowrap",
                }}
              >
                {f.label}
              </Link>
            );
          })}
        </div>
      </div>

      {/* ── Table ────────────────────────────────────────────────────────── */}
      <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
        {rows.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px 24px", color: c.hint, fontSize: 14 }}>
            {q ? `No cases match "${q}".` : "No cases in this category."}
            {!q && filter === "open" && (
              <div style={{ marginTop: 12 }}>
                <Link href={ROUTES.caseNew} style={{ color: c.accent, fontWeight: 600, textDecoration: "none" }}>
                  + Create your first case
                </Link>
              </div>
            )}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: c.panel2, borderBottom: `1px solid ${c.line}` }}>
                <th style={th}>Ref</th>
                <th style={th}>Equipment</th>
                <th style={th}>Account</th>
                <th style={th}>Stage</th>
                <th style={th}>Type</th>
                <th style={th}>Technician</th>
                <th style={th}>Intake</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ serviceCase: sc, account, technicianName }, i) => (
                <tr key={sc.id} style={{ borderBottom: `1px solid ${c.line}`, background: i % 2 === 1 ? c.panel2 : "#fff" }}>
                  <td style={td}>
                    <Link href={ROUTES.case(sc.id)} style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 12.5, color: c.accent, textDecoration: "none" }}>
                      {sc.ref}
                    </Link>
                  </td>
                  <td style={{ ...td, maxWidth: 260 }}>
                    <div style={{ fontWeight: 600, fontSize: 13.5, color: c.ink }}>{sc.equipment_label || "—"}</div>
                    {sc.complaint && (
                      <div style={{ fontSize: 12, color: c.muted, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {sc.complaint}
                      </div>
                    )}
                  </td>
                  <td style={td}>
                    <Link href={ROUTES.account(account.id)} style={{ fontSize: 13.5, fontWeight: 500, color: c.ink, textDecoration: "none" }}>
                      {account.name}
                    </Link>
                  </td>
                  <td style={td}><Pill label={CASE_STATUS_LABEL[sc.status]} tone={statusTone[sc.status]} /></td>
                  <td style={td}><Pill label={CASE_TYPE_LABEL[sc.type]} tone={typeTone[sc.type]} /></td>
                  <td style={{ ...td, color: technicianName ? c.ink : c.hint, fontSize: 13 }}>{technicianName ?? "—"}</td>
                  <td style={{ ...td, color: c.hint, fontSize: 12.5, whiteSpace: "nowrap" }}>{fmtDate(sc.intake_at)}</td>
                  <td style={td}>
                    <Link href={ROUTES.case(sc.id)} style={{
                      fontSize: 11.5, fontWeight: 600, color: c.accent,
                      background: c.accentbg, borderRadius: 6, padding: "4px 10px",
                      textDecoration: "none", whiteSpace: "nowrap",
                    }}>
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {rows.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 12.5, color: c.hint }}>
          {rows.length} case{rows.length !== 1 ? "s" : ""}
          {q && (
            <> · <Link href={`${ROUTES.cases}?filter=${filter}`} style={{ color: c.accent, textDecoration: "none" }}>Clear search</Link></>
          )}
        </div>
      )}
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

// ── Table styles ──────────────────────────────────────────────────────────────

const th: React.CSSProperties = {
  textAlign: "left", color: c.hint, fontWeight: 700,
  padding: "10px 14px", fontSize: 11.5,
  letterSpacing: 0.3, textTransform: "uppercase", whiteSpace: "nowrap",
};

const td: React.CSSProperties = {
  padding: "12px 14px", fontSize: 13.5, verticalAlign: "middle",
};
