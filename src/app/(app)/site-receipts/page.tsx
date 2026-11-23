import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSitePage } from "@/lib/site/pageGuard";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import StatusPill from "@/components/ui/StatusPill";
import ObjectListPage, { type ListColumn } from "@/components/page/ObjectListPage";
import { applyAdvancedFilter } from "@/lib/advancedFilter";
import { paginate } from "@/lib/paginate";
import { sortRows, readSortParams, applyColFilters, parseColFilterParams, colFilterQueryParams, type SortExtractor } from "@/lib/listSort";
import { listReceipts, type ReceiptListRow } from "@/lib/site/receiptsServer";
import { openSiteRequest } from "@/lib/site/server";
import { RECEIPT_OUTCOME_LABEL, RECEIPT_STATUS_LABEL, type ReceiptOutcome } from "@/lib/site/types";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const outcomeTone = (o: ReceiptOutcome) => (o === "complete" ? "green" : o === "partial" ? "amber" : "red") as "green" | "amber" | "red";

const SORT: Record<string, SortExtractor<ReceiptListRow>> = {
  ref: (r) => r.ref, delivery: (r) => r.delivery_note_ref, project: (r) => r.project_name, by: (r) => r.received_by_name, received: (r) => r.received_at, outcome: (r) => r.outcome,
};

const COLUMNS: ListColumn<ReceiptListRow>[] = [
  { id: "ref", label: "ID", sortKey: "ref", width: 88, card: "hidden", cellStyle: { fontFamily: MONO, fontSize: 11.5, color: c.hint, whiteSpace: "nowrap" }, render: (r) => r.ref ?? "—" },
  {
    id: "delivery", label: "Delivery", sortKey: "delivery", card: "title",
    render: (r) => (
      <>
        <Link href={ROUTES.siteReceipt(r.id)} style={{ fontWeight: 600, color: c.ink, textDecoration: "none", fontSize: 13.5 }}>{r.delivery_note_ref ?? "Delivery"}</Link>
        <div style={{ fontSize: 11.5, color: c.hint, marginTop: 2 }}>{r.project_ref ? `${r.project_ref} · ` : ""}{r.project_name}</div>
      </>
    ),
  },
  { id: "by", label: "Received by", sortKey: "by", cellStyle: { color: c.muted, fontSize: 13 }, render: (r) => r.received_by_name ?? "—" },
  { id: "received", label: "Received", sortKey: "received", cellStyle: { color: c.muted, fontSize: 13, whiteSpace: "nowrap" }, render: (r) => new Date(r.received_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) },
  { id: "items", label: "Items", cellStyle: { fontVariantNumeric: "tabular-nums", color: c.muted, fontSize: 13 }, render: (r) => `${r.lines} · ${r.accepted} accepted${r.rejected ? ` · ${r.rejected} rejected` : ""}` },
  { id: "outcome", label: "Outcome", sortKey: "outcome", render: (r) => (r.status === "cancelled" ? <StatusPill label={RECEIPT_STATUS_LABEL.cancelled} tone="blue" /> : <StatusPill label={RECEIPT_OUTCOME_LABEL[r.outcome]} tone={outcomeTone(r.outcome)} />) },
];

/** Every site receipt of the workspace's projects, newest first. A confirmed receipt is evidence; a manager can cancel one with a reason. */
export default async function SiteReceiptsPage({ searchParams }: { searchParams: Promise<{ q?: string; outcome?: string; sort?: string; dir?: string; page?: string; af?: string } & Record<string, string | undefined>> }) {
  await requireSitePage("site_receipts");
  const gate = await openSiteRequest("site_receipts");
  if (!gate.ok) notFound();
  const params = await searchParams;
  const { q, outcome, af } = params;
  const colFilters = parseColFilterParams(params);
  const cfParams = colFilterQueryParams(colFilters);
  const { sort, dir } = readSortParams(params);
  const page = Math.max(1, Number(params.page) || 1);

  const { rows: all, pending } = await listReceipts(gate.req, { limit: 1000 });
  if (pending) return <div role="alert" style={{ fontSize: 13, color: "var(--amberink)" }}>Site receipts need a database update (migration 0259). Ask your administrator to apply it.</div>;

  const live = all.filter((r) => r.status === "confirmed");
  const count = (o: ReceiptOutcome) => live.filter((r) => r.outcome === o).length;
  const byOutcome = outcome === "cancelled" ? all.filter((r) => r.status === "cancelled") : outcome && outcome !== "all" ? live.filter((r) => r.outcome === outcome) : all;
  const term = q?.toLowerCase();
  const searched = byOutcome.filter((r) => !term || [r.ref, r.delivery_note_ref, r.project_name, r.received_by_name, r.vehicle, r.handed_by].some((v) => (v ?? "").toLowerCase().includes(term)));
  const adv = applyAdvancedFilter(searched, af, (r) => r as unknown as Record<string, unknown>);
  const filtered = sortRows(applyColFilters(adv, colFilters, SORT), sort, dir, SORT);
  const rows = paginate(filtered, page);

  const href = (s: string) => `${ROUTES.siteReceipts}?outcome=${s}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  const chips = [
    { id: "all", label: `All (${all.length})` }, { id: "complete", label: `Complete (${count("complete")})` }, { id: "partial", label: `Partial (${count("partial")})` },
    { id: "rejected", label: `Rejected (${count("rejected")})` }, { id: "cancelled", label: `Cancelled (${all.length - live.length})` },
  ].map(({ id, label }) => ({ id, label, href: href(id), active: (outcome ?? "all") === id }));

  return (
    <ObjectListPage
      title="Site receipts"
      subtitle={`${live.length} confirmed · ${count("partial") + count("rejected")} with a problem`}
      newLabel="receipt"
      newHref={ROUTES.siteReceiptNew}
      chips={chips}
      search={{ value: q, placeholder: "Search by number, delivery note, person or project…", hiddenParams: { outcome: outcome && outcome !== "all" ? outcome : undefined, af, ...cfParams } }}
      advancedFilterObject="site_receipt"
      columns={COLUMNS}
      rows={rows}
      rowKey={(r) => r.id}
      rowHref={(r) => ROUTES.siteReceipt(r.id)}
      total={filtered.length}
      page={page}
      baseHref={ROUTES.siteReceipts}
      sort={sort}
      dir={dir}
      linkParams={{ q, outcome, af, ...cfParams }}
      filtered={!!(q || af || (outcome && outcome !== "all") || Object.keys(cfParams).length > 0)}
      empty={{ title: "No site receipts yet", text: "A person on site confirms a delivery from a phone: pick it, count it, confirm.", filteredTitle: q ? `No receipts match "${q}".` : "No receipts match these filters." }}
    />
  );
}
