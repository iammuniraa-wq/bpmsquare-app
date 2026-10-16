import Link from "next/link";
import { requireFeature, getTenantCurrency } from "@/lib/tenant";
import { moneyFormatter } from "@/lib/currency";
import { requireWorkcenterView } from "@/lib/permissions";
import { listContracts } from "@/lib/data/live";
import { c, pillar, type PillarKey } from "@/lib/theme";
import { CARD_SURFACE } from "@/components/ui/Card";
import StatusPill from "@/components/ui/StatusPill";
import ObjectListPage, { type ListColumn } from "@/components/page/ObjectListPage";
import { paginate } from "@/lib/paginate";
import { ROUTES } from "@/lib/constants";

type ContractStatus = "active" | "expired" | "pending" | "cancelled";
type ContractRow = Awaited<ReturnType<typeof listContracts>>[number];

const STATUS_TONE: Record<ContractStatus, PillarKey> = {
  active: "green", expired: "red", pending: "amber", cancelled: "red",
};
const STATUS_LABEL: Record<ContractStatus, string> = {
  active: "Active", expired: "Expired", pending: "Pending", cancelled: "Cancelled",
};

const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

function daysLeft(endDate: string | null): number {
  if (!endDate) return 0;
  return Math.ceil((new Date(endDate).getTime() - Date.now()) / 86_400_000);
}

export default async function AmcPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; expiring?: string; page?: string }>;
}) {
  await requireWorkcenterView("amc");
  await requireFeature("amc");
  const { q, status, expiring, page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const [contracts, cur] = await Promise.all([listContracts(), getTenantCurrency()]);
  const inr = moneyFormatter(cur, { maximumFractionDigits: 0 });
  const active = contracts.filter((con) => con.status === "active");
  const expiringSoon = active.filter((con) => daysLeft(con.end_date) <= 60);
  const totalValue = active.reduce((s, con) => s + (con.value ?? 0), 0);

  // KPI tiles stay whole-book figures -- they're the overview the filters
  // act on. Only the table below narrows.
  const needle = (q ?? "").trim().toLowerCase();
  const visible = contracts.filter((con) => {
    if (status && con.status !== status) return false;
    if (expiring === "1" && !(con.status === "active" && daysLeft(con.end_date) <= 60)) return false;
    if (!needle) return true;
    return (
      (con.ref ?? "").toLowerCase().includes(needle) ||
      (con.account_name ?? "").toLowerCase().includes(needle)
    );
  });
  const pageRows = paginate(visible, page);

  const columns: ListColumn<ContractRow>[] = [
    {
      id: "ref", label: "Ref", card: "title",
      render: (con) => <span style={{ fontFamily: "monospace", fontSize: 12.5, color: c.accent, fontWeight: 600 }}>{con.ref}</span>,
    },
    { id: "account", label: "Account", render: (con) => con.account_name },
    {
      id: "status", label: "Status",
      render: (con) => <StatusPill label={STATUS_LABEL[con.status as ContractStatus] ?? con.status} tone={STATUS_TONE[con.status as ContractStatus] ?? "blue"} />,
    },
    { id: "period", label: "Period", cellStyle: { color: c.muted, fontSize: 12 }, render: (con) => `${fmtDate(con.start_date)} – ${fmtDate(con.end_date)}` },
    {
      id: "left", label: "Days left",
      render: (con) => {
        const left = daysLeft(con.end_date);
        const isExpiringSoon = con.status === "active" && left <= 60;
        return <span style={{ fontWeight: 600, color: isExpiringSoon ? pillar.amber.base : c.ink }}>{con.status === "active" ? (left > 0 ? `${left}d` : "Expired") : "—"}</span>;
      },
    },
    { id: "value", label: "Value", cellStyle: { fontWeight: 700 }, render: (con) => (con.value ? inr(con.value) : "—") },
  ];

  const tiles = (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 14 }}>
      <div style={{ ...CARD_SURFACE, padding: 14, textAlign: "center" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Active</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: pillar.green.base }}>{active.length}</div>
      </div>
      <Link
        href={expiring === "1" ? ROUTES.amc : `${ROUTES.amc}?expiring=1`}
        className={`stat-tile is-clickable${expiring === "1" ? " is-active" : ""}`}
        style={{ ...CARD_SURFACE, padding: 14, textAlign: "center", textDecoration: "none", display: "block" }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Expiring ≤60 days</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: expiringSoon.length > 0 ? pillar.amber.base : pillar.green.base }}>{expiringSoon.length}</div>
      </Link>
      <div style={{ ...CARD_SURFACE, padding: 14, textAlign: "center" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Active Value</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: pillar.teal.base }}>{inr(totalValue)}</div>
      </div>
    </div>
  );

  return (
    <ObjectListPage
      title="AMC Contracts"
      subtitle={`${contracts.length} total · Annual Maintenance Contracts`}
      search={{
        value: q,
        placeholder: "Search contract ref or account…",
        selects: [{
          name: "status", value: status, placeholder: "All statuses",
          options: (Object.keys(STATUS_LABEL) as ContractStatus[]).map((k) => ({ value: k, label: STATUS_LABEL[k] })),
        }],
        hiddenParams: { expiring },
      }}
      beforeTable={tiles}
      columns={columns}
      rows={pageRows}
      rowKey={(con) => con.id}
      total={visible.length}
      page={page}
      baseHref={ROUTES.amc}
      linkParams={{ q, status, expiring }}
      filtered={!!(needle || status || expiring)}
      empty={{
        title: "No AMC contracts yet",
        text: "Annual maintenance contracts appear here once they are imported or created by an integration.",
        filteredTitle: "No contracts match these filters.",
      }}
    />
  );
}
