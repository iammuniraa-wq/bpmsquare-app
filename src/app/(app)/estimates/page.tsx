import Link from "next/link";
import { requireFeature, getTenantCurrency } from "@/lib/tenant";
import { requireTenantUser } from "@/lib/supabase-server";
import { requireWorkcenterView } from "@/lib/permissions";
import { moneyFormatter } from "@/lib/currency";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import ObjectListPage, { type ListColumn } from "@/components/page/ObjectListPage";
import PageHeader from "@/components/PageHeader";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import { parseListParams, ESTIMATE_STATUSES, DEFAULT_PAGE_SIZE } from "@/lib/estimator/requests";
import { PENDING_MESSAGE, listEstimates, type ListedEstimate } from "@/lib/estimator/server";
import EstimateStatusPill from "./EstimateStatusPill";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const CHIP_LABEL: Record<string, string> = { draft: "Draft", quoted: "Quoted", won: "Won", lost: "Lost" };
const fmtDate = (s: string) => new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export default async function EstimatesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; sort?: string; dir?: string; page?: string }>;
}) {
  await requireWorkcenterView("estimates");
  await requireFeature("estimator");
  const { supabase, tenantId } = await requireTenantUser();
  const raw = await searchParams;
  const money = moneyFormatter(await getTenantCurrency(), { maximumFractionDigits: 0 });

  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) if (typeof v === "string") sp.set(k, v);
  const p = parseListParams(sp);

  const [list, ...counts] = await Promise.all([
    listEstimates(supabase, tenantId, p),
    ...ESTIMATE_STATUSES.map((s) => listEstimates(supabase, tenantId, { ...p, q: "", status: s, account_id: null, template_id: null, page: 1, page_size: 1 })),
  ]);

  if (list.missing) {
    return (
      <>
        <PageHeader title="Estimates" />
        <Card padding={0}>
          <EmptyState title="Estimates are waiting for a database update" text={PENDING_MESSAGE} />
        </Card>
      </>
    );
  }

  const countOf = (i: number) => counts[i].total;
  const all = counts.reduce((a, r) => a + r.total, 0);
  const href = (status: string | null) => {
    const q = new URLSearchParams();
    if (status) q.set("status", status);
    if (p.q) q.set("q", p.q);
    const s = q.toString();
    return s ? `${ROUTES.estimates}?${s}` : ROUTES.estimates;
  };
  const chips = [
    { id: "all", label: `All (${all})`, href: href(null), active: !p.status },
    ...ESTIMATE_STATUSES.map((s, i) => ({ id: s, label: `${CHIP_LABEL[s]} (${countOf(i)})`, href: href(s), active: p.status === s })),
  ];

  const COLUMNS: ListColumn<ListedEstimate>[] = [
    { id: "ref", label: "ID", sortKey: "ref", width: 88, card: "hidden", cellStyle: { fontFamily: MONO, fontSize: 11.5, color: c.hint, whiteSpace: "nowrap" }, render: (e) => e.ref ?? "—" },
    {
      id: "name", label: "Name", sortKey: "name", card: "title",
      render: (e) => (
        <Link href={ROUTES.estimate(e.id)} style={{ fontWeight: 600, color: c.ink, textDecoration: "none", fontSize: 13.5 }}>{e.name}</Link>
      ),
    },
    { id: "account", label: "Account", cellStyle: { color: c.muted, fontSize: 13 }, render: (e) => e.account_name ?? "—" },
    { id: "template", label: "Template", cellStyle: { color: c.muted, fontSize: 13 }, render: (e) => e.template_name ?? "—" },
    { id: "status", label: "Status", sortKey: "status", render: (e) => <EstimateStatusPill status={e.status} /> },
    {
      id: "price", label: "Price incl. VAT", cellStyle: { whiteSpace: "nowrap", fontWeight: 600 },
      render: (e) => (e.totals ? money(e.totals.price_incl_vat) : "—"),
    },
    { id: "created_at", label: "Created", sortKey: "created_at", cellStyle: { color: c.muted, fontSize: 13, whiteSpace: "nowrap" }, render: (e) => fmtDate(e.created_at) },
  ];

  const filtered = !!(p.q || p.status);
  return (
    <ObjectListPage
      title="Estimates"
      subtitle={`${all} total`}
      newLabel="Estimate"
      newHref={ROUTES.estimateNew}
      chips={chips}
      search={{ value: p.q || undefined, placeholder: "Search by name or ID…", hiddenParams: { status: p.status ?? undefined, sort: raw.sort, dir: raw.dir } }}
      columns={COLUMNS}
      columnSearch={false}
      rows={list.rows}
      rowKey={(e) => e.id}
      rowHref={(e) => ROUTES.estimate(e.id)}
      total={list.total}
      page={p.page}
      pageSize={DEFAULT_PAGE_SIZE}
      baseHref={ROUTES.estimates}
      sort={raw.sort}
      dir={p.dir}
      linkParams={{ q: p.q || undefined, status: p.status ?? undefined }}
      filtered={filtered}
      empty={{
        title: "No estimates yet",
        text: "Pick a template, enter the inputs and get a bill of materials, a cost build-up and a quote.",
        filteredTitle: p.q ? `No estimates match "${p.q}".` : "No estimates match these filters.",
      }}
    />
  );
}
