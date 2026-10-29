import Link from "next/link";
import { requireFeature } from "@/lib/tenant";
import { requireTenantUser } from "@/lib/supabase-server";
import { requireWorkcenterView } from "@/lib/permissions";
import { c } from "@/lib/theme";
import StatusPill from "@/components/ui/StatusPill";
import ObjectListPage, { type ListColumn } from "@/components/page/ObjectListPage";
import { paginate } from "@/lib/paginate";
import { sortRows, readSortParams, applyColFilters, parseColFilterParams, colFilterQueryParams, type SortExtractor } from "@/lib/listSort";
import { ROUTES } from "@/lib/constants";
import { RFQ_STATUS_LABEL, type RfqStatus, type RfqOriginType } from "@/lib/rfq/types";
import { originHref, quoteLabel, itemsSummary, searchText, isDocumentOrigin, QUOTE_ORIGIN_TYPES } from "@/lib/rfq/linking";
import { RFQ_STATUS_TONE, fmtDate } from "@/components/rfq/rfqUi";

import { readAllPages } from "@/lib/pagedRead";
type Row = {
  id: string; ref: string | null; title: string; status: RfqStatus; origin_type: RfqOriginType; origin_id: string | null; origin_label: string | null;
  respond_by: string | null; created_at: string; asked: number; replied: number; unread: number;
  /** Line descriptions in order: the Items column and the search read these. */
  item_names: string[];
};

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

const SORT: Record<string, SortExtractor<Row>> = {
  ref: (r) => r.ref,
  title: (r) => r.title,
  status: (r) => r.status,
  quote: (r) => quoteLabel(r.origin_type, r.origin_label),
  items: (r) => r.item_names[0] ?? "",
  respond_by: (r) => r.respond_by,
  replies: (r) => r.replied,
  created_at: (r) => r.created_at,
};

const CHIPS: { id: string; label: string; match: (r: Pick<Row, "status" | "origin_type">) => boolean }[] = [
  { id: "open", label: "Open", match: (r) => ["draft", "sent", "partially_replied", "replied"].includes(r.status) },
  { id: "awaiting", label: "Waiting on suppliers", match: (r) => r.status === "sent" || r.status === "partially_replied" },
  { id: "to_award", label: "Ready to award", match: (r) => r.status === "replied" || r.status === "partially_replied" },
  { id: "awarded", label: "Awarded", match: (r) => r.status === "awarded" || r.status === "closed" },
  { id: "from_quote", label: "From a quote", match: (r) => QUOTE_ORIGIN_TYPES.includes(r.origin_type) },
  { id: "all", label: "All", match: () => true },
];

export default async function RfqsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireWorkcenterView("rfqs");
  await requireFeature("rfq");
  const { supabase, tenantId } = await requireTenantUser();
  const params = await searchParams;
  const { q } = params;
  const view = CHIPS.find((x) => x.id === params.view) ?? CHIPS[0];
  const colFilters = parseColFilterParams(params);
  const cfParams = colFilterQueryParams(colFilters);
  const { sort, dir } = readSortParams(params);
  const page = Math.max(1, Number(params.page) || 1);

  const { data, error } = await readAllPages((lo, hi) => supabase.from("rfqs")
    .select("id, ref, title, status, origin_type, origin_id, origin_label, respond_by, created_at")
    .eq("tenant_id", tenantId).order("created_at", { ascending: false }).order("id", { ascending: true }).range(lo, hi));
  const pending = !!error;
  const base = (data ?? []) as Omit<Row, "asked" | "replied" | "unread" | "item_names">[];

  const ids = base.map((r) => r.id);
  const counts = new Map<string, { asked: number; replied: number; unread: number }>();
  if (ids.length) {
    const [{ data: sups }, { data: unread }] = await Promise.all([
      supabase.from("rfq_suppliers").select("rfq_id, status").eq("tenant_id", tenantId).in("rfq_id", ids.slice(0, 1000)),
      supabase.from("rfq_messages").select("rfq_id").eq("tenant_id", tenantId).eq("direction", "in").is("read_at", null).in("rfq_id", ids.slice(0, 1000)),
    ]);
    for (const s of (sups ?? []) as { rfq_id: string; status: string }[]) {
      const x = counts.get(s.rfq_id) ?? { asked: 0, replied: 0, unread: 0 };
      if (s.status !== "cancelled" && s.status !== "pending") x.asked++;
      if (s.status === "replied" || s.status === "declined") x.replied++;
      counts.set(s.rfq_id, x);
    }
    for (const m of (unread ?? []) as { rfq_id: string }[]) {
      const x = counts.get(m.rfq_id) ?? { asked: 0, replied: 0, unread: 0 };
      x.unread++;
      counts.set(m.rfq_id, x);
    }
  }
  const itemNames = new Map<string, string[]>();
  for (let i = 0; i < ids.length; i += 150) {
    const { data: ls } = await supabase.from("rfq_lines").select("rfq_id, sl_no, description").eq("tenant_id", tenantId).in("rfq_id", ids.slice(i, i + 150)).order("sl_no");
    for (const l of (ls ?? []) as { rfq_id: string; description: string }[]) {
      const list = itemNames.get(l.rfq_id) ?? [];
      list.push(l.description);
      itemNames.set(l.rfq_id, list);
    }
  }
  const rows: Row[] = base.map((r) => ({ ...r, ...(counts.get(r.id) ?? { asked: 0, replied: 0, unread: 0 }), item_names: itemNames.get(r.id) ?? [] }));

  const term = (q ?? "").trim().toLowerCase();
  const searched = rows.filter((r) => view.match(r) && (!term || searchText(r).includes(term)));
  const filtered = sortRows(applyColFilters(searched, colFilters, SORT), sort, dir, SORT);
  const pageRows = paginate(filtered, page);
  const openCount = rows.filter((r) => CHIPS[0].match(r)).length;
  const unreadTotal = rows.reduce((a, r) => a + r.unread, 0);

  const chips = CHIPS.map((x) => ({
    id: x.id,
    label: `${x.label} (${rows.filter((r) => x.match(r)).length})`,
    href: `${ROUTES.rfqs}?view=${x.id}${q ? `&q=${encodeURIComponent(q)}` : ""}`,
    active: x.id === view.id,
  }));

  const columns: ListColumn<Row>[] = [
    {
      id: "ref", label: "RFQ", sortKey: "ref", width: 96, card: "hidden",
      cellStyle: { fontFamily: MONO, fontSize: 11.5, color: c.hint, whiteSpace: "nowrap" },
      render: (r) => r.ref ?? "—",
    },
    {
      id: "title", label: "Title", sortKey: "title", card: "title",
      render: (r) => (
        <>
          <Link href={ROUTES.rfq(r.id)} style={{ fontWeight: 600, color: c.ink, textDecoration: "none" }}>{r.title}</Link>
          {r.unread > 0 && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: "#fff", background: c.accent, borderRadius: 10, padding: "1px 7px" }}>{r.unread} new</span>}
        </>
      ),
    },
    {
      id: "quote", label: "Quote", sortKey: "quote", cellStyle: { fontSize: 12.5 },
      render: (r) => {
        const href = isDocumentOrigin(r.origin_type) ? originHref(r.origin_type, r.origin_id) : null;
        const text = quoteLabel(r.origin_type, r.origin_label);
        return href
          ? <Link href={href} style={{ color: c.accent, textDecoration: "none", fontWeight: 600 }}>{text}</Link>
          : <span style={{ color: c.hint }}>{text}</span>;
      },
    },
    {
      id: "items", label: "Items", sortKey: "items", cellStyle: { color: c.muted, fontSize: 12.5 },
      render: (r) => <span title={r.item_names.join(", ")}>{itemsSummary(r.item_names)}</span>,
    },
    { id: "replies", label: "Replies", sortKey: "replies", cellStyle: { fontVariantNumeric: "tabular-nums", color: c.muted }, render: (r) => (r.asked ? `${r.replied}/${r.asked}` : "—") },
    { id: "respond_by", label: "Reply by", sortKey: "respond_by", cellStyle: { color: c.muted, fontSize: 12.5, whiteSpace: "nowrap" }, render: (r) => fmtDate(r.respond_by) },
    { id: "status", label: "Status", sortKey: "status", render: (r) => <StatusPill label={RFQ_STATUS_LABEL[r.status]} tone={RFQ_STATUS_TONE[r.status]} /> },
  ];

  return (
    <ObjectListPage
      title="RFQs"
      subtitle={pending ? "Waiting for the RFQ database update (migration 0128)" : `${openCount} open${unreadTotal ? ` · ${unreadTotal} unread supplier message${unreadTotal === 1 ? "" : "s"}` : ""}`}
      newLabel="RFQ"
      newHref={ROUTES.rfqNew}
      chips={chips}
      search={{
        value: q,
        placeholder: "Search by RFQ number, title, quote or item…",
        hiddenParams: { view: view.id, ...cfParams },
      }}
      columns={columns}
      rows={pageRows}
      rowKey={(r) => r.id}
      rowHref={(r) => ROUTES.rfq(r.id)}
      total={filtered.length}
      page={page}
      baseHref={ROUTES.rfqs}
      sort={sort}
      dir={dir}
      linkParams={{ q, view: view.id, ...cfParams }}
      filtered={!!(term || Object.keys(cfParams).length > 0)}
      empty={{
        title: pending ? "RFQs will appear here once the database update has been applied." : "No RFQs here yet",
        text: pending ? undefined : "Raise one from a quote, case or work order when a price can't be found — or start one by hand.",
        filteredTitle: term ? `No RFQs match "${q}".` : "No RFQs match these filters.",
      }}
    />
  );
}
