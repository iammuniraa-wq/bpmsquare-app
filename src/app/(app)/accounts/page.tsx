import Link from "next/link";
import { ACCOUNT_TYPE_LABEL } from "@/lib/data";
import { listAccountsLive } from "@/lib/data/live";
import type { Account } from "@/lib/types";
import { c, pillar } from "@/lib/theme";
import PageHeader from "@/components/PageHeader";
import { ROUTES } from "@/lib/constants";
import AccountsTable from "@/components/AccountsTable";
import type { PillarKey } from "@/lib/theme";

const typeTone: Record<Account["type"], PillarKey> = {
  prospect: "amber", oem: "purple", direct: "green", end_customer: "teal",
};

const ALL_TYPES: Account["type"][] = ["prospect", "oem", "direct", "end_customer"];

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; territory?: string }>;
}) {
  const { q, type: typeFilter, territory: territoryFilter } = await searchParams;
  const allRows = await listAccountsLive();

  const rows = allRows.filter(({ account }) => {
    const matchQ = !q || account.name.toLowerCase().includes(q.toLowerCase());
    const matchType = !typeFilter || account.type === typeFilter;
    const matchTerritory = !territoryFilter || (account.territory ?? "").toLowerCase().includes(territoryFilter.toLowerCase());
    return matchQ && matchType && matchTerritory;
  });

  return (
    <>
      <PageHeader
        title="Accounts"
        subtitle={`${allRows.length} total`}
        action={
          <Link
            href={ROUTES.accountNew}
            style={{
              padding: "7px 15px", borderRadius: 7, fontSize: 13, fontWeight: 600,
              background: c.accent, color: "#fff", textDecoration: "none",
            }}
          >
            + New account
          </Link>
        }
      />

      {/* Search + type filter */}
      <form method="GET" style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <input
          name="q"
          defaultValue={q}
          placeholder="Search accounts…"
          autoComplete="off"
          style={{
            flex: "1 1 200px", padding: "7px 12px", borderRadius: 7,
            border: `1px solid ${c.line}`, fontSize: 13, color: c.ink,
            background: "#fff", outline: "none",
          }}
        />
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          <Link
            href={ROUTES.accounts + (q ? `?q=${encodeURIComponent(q)}` : "")}
            style={filterPill(!typeFilter)}
          >
            All
          </Link>
          {ALL_TYPES.map((t) => {
            const active = typeFilter === t;
            const p = pillar[typeTone[t]];
            return (
              <Link
                key={t}
                href={`${ROUTES.accounts}?${q ? `q=${encodeURIComponent(q)}&` : ""}type=${t}`}
                style={{
                  ...filterPill(false),
                  background: active ? p.base : c.panel2,
                  color:      active ? "#fff" : c.muted,
                  border:     `1px solid ${active ? p.base : c.line}`,
                }}
              >
                {ACCOUNT_TYPE_LABEL[t]}
              </Link>
            );
          })}
        </div>
        <input
          name="territory"
          defaultValue={territoryFilter}
          placeholder="Territory…"
          autoComplete="off"
          style={{
            flex: "0 0 140px", padding: "7px 12px", borderRadius: 7,
            border: `1px solid ${c.line}`, fontSize: 13, color: c.ink,
            background: "#fff", outline: "none",
          }}
        />
        {(q || typeFilter || territoryFilter) && (
          <Link href={ROUTES.accounts} style={{ fontSize: 12, color: c.hint, textDecoration: "none", whiteSpace: "nowrap" }}>
            Clear ✕
          </Link>
        )}
      </form>

      {/* Table — adapt mode lives inside */}
      <AccountsTable rows={rows} q={q} typeFilter={typeFilter} />
    </>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function filterPill(active: boolean): React.CSSProperties {
  return {
    padding: "6px 12px", borderRadius: 6, fontSize: 12.5, fontWeight: 600,
    background: active ? c.accent : c.panel2,
    color:      active ? "#fff"    : c.muted,
    textDecoration: "none",
    border: `1px solid ${active ? c.accent : c.line}`,
    display: "inline-block",
  };
}
