import Link from "next/link";
import { ACCOUNT_TYPE_LABEL } from "@/lib/data";
import { listAccountsLive } from "@/lib/data/live";
import type { Account } from "@/lib/types";
import { c } from "@/lib/theme";
import PageHeader from "@/components/PageHeader";
import { ROUTES } from "@/lib/constants";
import AccountsTable from "@/components/AccountsTable";

const ALL_TYPES: Account["type"][] = ["prospect", "oem", "direct", "end_customer"];

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; territory?: string }>;
}) {
  const { q, type: typeFilter } = await searchParams;
  const allRows = await listAccountsLive();

  const rows = allRows.filter(({ account }) => {
    const matchQ = !q || account.name.toLowerCase().includes(q.toLowerCase());
    const matchType = !typeFilter || account.type === typeFilter;
    return matchQ && matchType;
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
        <select
          name="type"
          defaultValue={typeFilter ?? ""}
          style={{
            padding: "7px 10px", borderRadius: 7,
            border: `1px solid ${c.line}`, fontSize: 13, color: typeFilter ? c.ink : c.hint,
            background: "#fff", outline: "none", cursor: "pointer",
          }}
        >
          <option value="">All types</option>
          {ALL_TYPES.map((t) => (
            <option key={t} value={t}>{ACCOUNT_TYPE_LABEL[t]}</option>
          ))}
        </select>
        <button
          type="submit"
          style={{
            padding: "7px 14px", borderRadius: 7, border: "none",
            background: c.accent, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}
        >
          Filter
        </button>
        {(q || typeFilter) && (
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

