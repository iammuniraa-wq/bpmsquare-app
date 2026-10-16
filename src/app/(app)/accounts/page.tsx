import { requireFeature } from "@/lib/tenant";
import Link from "next/link";
import { ACCOUNT_TYPE_LABEL } from "@/lib/data";
import { listAccountsLive, type AccountSummary } from "@/lib/data/live";
import type { Account } from "@/lib/types";
import { c, pillar, type PillarKey } from "@/lib/theme";
import StatusPill from "@/components/ui/StatusPill";
import ObjectListPage, { type ListColumn } from "@/components/page/ObjectListPage";
import Account360Button from "@/components/Account360Button";
import { MapPin } from "@/components/Icons";
import { applyAdvancedFilter } from "@/lib/advancedFilter";
import { paginate } from "@/lib/paginate";
import { sortRows, readSortParams, applyColFilters, parseColFilterParams, colFilterQueryParams, type SortExtractor } from "@/lib/listSort";
import { ROUTES } from "@/lib/constants";
import { requireWorkcenterView } from "@/lib/permissions";
import type { MenuItem } from "@/components/ui/menuItems";

const ALL_TYPES: Account["type"][] = ["prospect", "oem", "direct", "end_customer"];

const TYPE_TONE: Record<Account["type"], PillarKey> = {
  prospect: "amber", oem: "purple", direct: "green", end_customer: "teal",
};

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

const SORT_EXTRACTORS: Record<string, SortExtractor<AccountSummary>> = {
  ref: (r) => r.account.ref,
  name: (r) => r.account.name,
  type: (r) => r.account.type,
  city: (r) => r.account.city,
  phone: (r) => r.account.phone,
  contacts: (r) => r.counts.contacts,
  cases: (r) => r.counts.cases,
  assets: (r) => r.counts.assets,
  contracts: (r) => r.counts.contracts,
};

// Columns that are off until asked for (the old in-table "Columns" picker's
// defaults). Shown when listed in `?cols=`; the "..." menu toggles them.
const OPTIONAL: { id: string; label: string }[] = [
  { id: "phone", label: "Phone" },
  { id: "contracts", label: "AMC" },
];

const initials = (name: string) =>
  name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

function CountBadge({ n }: { n: number }) {
  if (!n) return <span style={{ color: c.line, fontSize: 12 }}>—</span>;
  return <span style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>{n}</span>;
}

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; af?: string; cols?: string; sort?: string; dir?: string; page?: string } & Record<string, string | undefined>>;
}) {
  await requireWorkcenterView("accounts");
  await requireFeature("accounts");
  const params = await searchParams;
  const { q, type: typeFilter, af } = params;
  const colFilters = parseColFilterParams(params);
  const cfParams = colFilterQueryParams(colFilters);
  const { sort, dir } = readSortParams(params);
  const page = Math.max(1, Number(params.page) || 1);
  const shownOptional = new Set((params.cols ?? "").split(",").filter(Boolean));

  const allRows = await listAccountsLive();

  const basicFiltered = allRows.filter(({ account }) => {
    const matchQ = !q || account.name.toLowerCase().includes(q.toLowerCase());
    const matchType = !typeFilter || account.type === typeFilter;
    return matchQ && matchType;
  });
  const advFiltered = applyAdvancedFilter(basicFiltered, af, ({ account }) => account as unknown as Record<string, unknown>);
  const colFiltered = applyColFilters(advFiltered, colFilters, SORT_EXTRACTORS);
  const filtered = sortRows(colFiltered, sort, dir, SORT_EXTRACTORS);
  const pageRows = paginate(filtered, page);

  const colsParam = [...shownOptional].join(",") || undefined;
  const linkParams = { q, type: typeFilter, af, cols: colsParam, ...cfParams };

  const columns: ListColumn<AccountSummary>[] = [
    {
      id: "ref", label: "ID", sortKey: "ref", width: 88, card: "hidden",
      cellStyle: { fontFamily: MONO, fontSize: 11.5, color: c.hint, whiteSpace: "nowrap" },
      render: ({ account }) => account.ref ?? "—",
    },
    {
      id: "name", label: "Account", sortKey: "name", card: "title",
      render: ({ account, referredBy }) => {
        const p = pillar[TYPE_TONE[account.type]];
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Link href={ROUTES.account(account.id)} style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", minWidth: 0 }}>
              <div style={{
                width: 30, height: 30, borderRadius: 8, flexShrink: 0, background: p.bg, color: p.fg,
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700,
              }}>
                {initials(account.name)}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5, color: c.ink }}>{account.name}</div>
                {referredBy && <div style={{ fontSize: 11, color: c.hint, marginTop: 1, fontWeight: 400 }}>via {referredBy.name}</div>}
              </div>
            </Link>
            {/* Nova only (self-gates): opens the 360 drawer without leaving the list. */}
            <Account360Button accountId={account.id} variant="link" />
          </div>
        );
      },
    },
    {
      id: "type", label: "Type", sortKey: "type",
      render: ({ account }) => <StatusPill label={ACCOUNT_TYPE_LABEL[account.type]} tone={TYPE_TONE[account.type]} />,
    },
    {
      id: "city", label: "City", sortKey: "city", cellStyle: { color: c.muted, whiteSpace: "nowrap" },
      render: ({ account }) => account.city
        ? <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><MapPin size={11} color={c.hint} />{account.city}</span>
        : <span style={{ color: c.line }}>—</span>,
    },
    ...(shownOptional.has("phone") ? [{
      id: "phone", label: "Phone", sortKey: "phone", cellStyle: { color: c.muted, whiteSpace: "nowrap" as const },
      render: ({ account }: AccountSummary) => account.phone ?? <span style={{ color: c.line }}>—</span>,
    }] : []),
    { id: "contacts", label: "Contacts", sortKey: "contacts", cellStyle: { textAlign: "center" }, render: ({ counts }) => <CountBadge n={counts.contacts} /> },
    { id: "cases", label: "Cases", sortKey: "cases", cellStyle: { textAlign: "center" }, render: ({ counts }) => <CountBadge n={counts.cases} /> },
    { id: "assets", label: "Assets", sortKey: "assets", cellStyle: { textAlign: "center" }, render: ({ counts }) => <CountBadge n={counts.assets} /> },
    ...(shownOptional.has("contracts") ? [{
      id: "contracts", label: "AMC", sortKey: "contracts", cellStyle: { textAlign: "center" as const },
      render: ({ counts }: AccountSummary) => <CountBadge n={counts.contracts} />,
    }] : []),
  ];

  const colsHref = (id: string) => {
    const next = new Set(shownOptional);
    if (next.has(id)) next.delete(id); else next.add(id);
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...linkParams, cols: [...next].join(",") || undefined, sort, dir: sort ? dir : undefined })) if (v) qs.set(k, v);
    const s = qs.toString();
    return s ? `${ROUTES.accounts}?${s}` : ROUTES.accounts;
  };
  const menuItems: MenuItem[] = OPTIONAL.map((o) => ({
    label: `${shownOptional.has(o.id) ? "Hide" : "Show"} ${o.label} column`,
    href: colsHref(o.id),
  }));

  const hasFilter = !!(q || typeFilter || af || Object.keys(cfParams).length > 0);

  return (
    <ObjectListPage
      title="Accounts"
      subtitle={`${allRows.length} total`}
      newLabel="Account"
      newHref={ROUTES.accountNew}
      menuItems={menuItems}
      search={{
        value: q,
        placeholder: "Search accounts…",
        selects: [{
          name: "type", value: typeFilter, placeholder: "All types",
          options: ALL_TYPES.map((t) => ({ value: t, label: ACCOUNT_TYPE_LABEL[t] })),
        }],
        hiddenParams: { af, cols: colsParam, ...cfParams },
      }}
      advancedFilterObject="account"
      columns={columns}
      rows={pageRows}
      rowKey={({ account }) => account.id}
      rowHref={({ account }) => ROUTES.account(account.id)}
      total={filtered.length}
      page={page}
      baseHref={ROUTES.accounts}
      sort={sort}
      dir={dir}
      linkParams={linkParams}
      filtered={hasFilter}
      empty={{
        title: "No accounts yet",
        text: "Accounts are the customers and prospects you sell to and service. Add the first one to start.",
        filteredTitle: "No accounts match this filter.",
      }}
    />
  );
}
