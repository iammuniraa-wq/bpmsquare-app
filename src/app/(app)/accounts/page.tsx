import Link from "next/link";
import { ACCOUNT_TYPE_LABEL } from "@/lib/data";
import { listAccountsLive } from "@/lib/data/live";
import type { Account } from "@/lib/types";
import { c } from "@/lib/theme";
import PageHeader from "@/components/PageHeader";
import ListFilterBar from "@/components/ListFilterBar";
import { ROUTES } from "@/lib/constants";
import AccountsTable from "@/components/AccountsTable";
import { requireWorkcenterView } from "@/lib/permissions";

const ALL_TYPES: Account["type"][] = ["prospect", "oem", "direct", "end_customer"];

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; territory?: string }>;
}) {
  await requireWorkcenterView("accounts");
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
              background: `var(--modern-accent, ${c.accent})`, color: "#fff", textDecoration: "none",
            }}
          >
            + New account
          </Link>
        }
      />

      <ListFilterBar
        searchValue={q}
        searchPlaceholder="Search accounts…"
        selects={[{
          name: "type", value: typeFilter, placeholder: "All types",
          options: ALL_TYPES.map((t) => ({ value: t, label: ACCOUNT_TYPE_LABEL[t] })),
        }]}
        clearHref={ROUTES.accounts}
      />

      {/* Table — adapt mode + column sort live inside */}
      <AccountsTable rows={rows} q={q} typeFilter={typeFilter} />
    </>
  );
}

