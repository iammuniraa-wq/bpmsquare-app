import Link from "next/link";
import { requireFeature } from "@/lib/tenant";
import { requireTenantUser } from "@/lib/supabase-server";
import { requireWorkcenterView } from "@/lib/permissions";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import PageHeader from "@/components/PageHeader";
import Pill from "@/components/Pill";
import ListFilterBar from "@/components/ListFilterBar";
import SortableTh from "@/components/SortableTh";
import PagerLink from "@/components/PagerLink";
import { paginate, DEFAULT_PAGE_SIZE } from "@/lib/paginate";
import { sortRows, readSortParams, applyColFilters, parseColFilterParams, colFilterQueryParams, type SortExtractor } from "@/lib/listSort";
import { ROUTES } from "@/lib/constants";
import { RFQ_STATUS_LABEL, RFQ_ORIGIN_LABEL, type RfqStatus, type RfqOriginType } from "@/lib/rfq/types";
import { RFQ_STATUS_TONE, fmtDate } from "@/components/rfq/rfqUi";

type Row = {
  id: string; ref: string | null; title: string; status: RfqStatus; origin_type: RfqOriginType; origin_label: string | null;
  respond_by: string | null; created_at: string; asked: number; replied: number; unread: number;
};

const th: React.CSSProperties = {
  textAlign: "left", color: c.hint, fontWeight: 600, padding: "9px 14px", fontSize: 11, letterSpacing: 0.4,
  textTransform: "uppercase", whiteSpace: "nowrap", background: c.panel2,
};
const td: React.CSSProperties = { padding: "11px 14px", fontSize: 13.5, verticalAlign: "middle" };

const SORT: Record<string, SortExtractor<Row>> = {
  ref: (r) => r.ref,
  title: (r) => r.title,
  status: (r) => r.status,
  origin: (r) => `${r.origin_type} ${r.origin_label ?? ""}`,
  respond_by: (r) => r.respond_by,
  replies: (r) => r.replied,
  created_at: (r) => r.created_at,
};

const CHIPS: { id: string; label: string; match: (s: RfqStatus) => boolean }[] = [
  { id: "open", label: "Open", match: (s) => ["draft", "sent", "partially_replied", "replied"].includes(s) },
  { id: "awaiting", label: "Waiting on suppliers", match: (s) => s === "sent" || s === "partially_replied" },
  { id: "to_award", label: "Ready to award", match: (s) => s === "replied" || s === "partially_replied" },
  { id: "awarded", label: "Awarded", match: (s) => s === "awarded" || s === "closed" },
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

  const { data, error } = await supabase.from("rfqs")
    .select("id, ref, title, status, origin_type, origin_label, respond_by, created_at")
    .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(2000);
  const pending = !!error;
  const base = (data ?? []) as Omit<Row, "asked" | "replied" | "unread">[];

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
  const rows: Row[] = base.map((r) => ({ ...r, ...(counts.get(r.id) ?? { asked: 0, replied: 0, unread: 0 }) }));

  const term = (q ?? "").trim().toLowerCase();
  const searched = rows.filter((r) => view.match(r.status) && (!term || `${r.ref ?? ""} ${r.title} ${r.origin_label ?? ""}`.toLowerCase().includes(term)));
  const filtered = sortRows(applyColFilters(searched, colFilters, SORT), sort, dir, SORT);
  const pageRows = paginate(filtered, page);
  const openCount = rows.filter((r) => CHIPS[0].match(r.status)).length;
  const unreadTotal = rows.reduce((a, r) => a + r.unread, 0);
  const hp = { q, view: view.id, ...cfParams };

  return (
    <>
      <PageHeader
        title="RFQs"
        subtitle={pending ? "Waiting for the RFQ database update (migration 0128)" : `${openCount} open${unreadTotal ? ` · ${unreadTotal} unread supplier message${unreadTotal === 1 ? "" : "s"}` : ""}`}
        action={<Link href={ROUTES.rfqNew} style={{ padding: "8px 16px", borderRadius: 7, fontSize: 13, fontWeight: 600, background: c.accent, color: "#fff", textDecoration: "none" }}>+ New RFQ</Link>}
      />

      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        {CHIPS.map((x) => {
          const on = x.id === view.id;
          const n = rows.filter((r) => x.match(r.status)).length;
          return (
            <Link key={x.id} href={`${ROUTES.rfqs}?view=${x.id}${q ? `&q=${encodeURIComponent(q)}` : ""}`} style={{
              fontSize: 12.5, fontWeight: on ? 700 : 500, color: on ? c.accent : c.muted, background: on ? c.accentbg : c.panel2,
              border: `1px solid ${on ? c.accent + "60" : c.line}`, borderRadius: 6, padding: "5px 12px", textDecoration: "none",
            }}>{x.label} ({n})</Link>
          );
        })}
      </div>

      <ListFilterBar searchValue={q} searchPlaceholder="Search by RFQ number, title or source…" hiddenParams={{ view: view.id, ...cfParams }} clearHref={ROUTES.rfqs} />

      <div style={{ ...cardStyle, overflow: "hidden", padding: 0 }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px 24px", color: c.hint, fontSize: 14 }}>
            {pending ? "RFQs will appear here once the database update has been applied." : term ? `No RFQs match "${q}".` : "No RFQs here yet. Raise one from a quote, case or work order when a price can't be found — or start one by hand."}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${c.line}` }}>
                  <SortableTh label="RFQ" sortKey="ref" searchId="ref" currentSort={sort} currentDir={dir} baseHref={ROUTES.rfqs} hiddenParams={hp} style={{ ...th, width: 96 }} />
                  <SortableTh label="Title" sortKey="title" searchId="title" currentSort={sort} currentDir={dir} baseHref={ROUTES.rfqs} hiddenParams={hp} style={th} />
                  <SortableTh label="For" sortKey="origin" searchId="origin" currentSort={sort} currentDir={dir} baseHref={ROUTES.rfqs} hiddenParams={hp} style={th} />
                  <SortableTh label="Replies" sortKey="replies" currentSort={sort} currentDir={dir} baseHref={ROUTES.rfqs} hiddenParams={hp} style={th} />
                  <SortableTh label="Reply by" sortKey="respond_by" currentSort={sort} currentDir={dir} baseHref={ROUTES.rfqs} hiddenParams={hp} style={th} />
                  <SortableTh label="Status" sortKey="status" searchId="status" currentSort={sort} currentDir={dir} baseHref={ROUTES.rfqs} hiddenParams={hp} style={th} />
                  <SortableTh label="Raised" sortKey="created_at" currentSort={sort} currentDir={dir} baseHref={ROUTES.rfqs} hiddenParams={hp} style={th} />
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={r.id} style={{ borderBottom: `1px solid ${c.line}` }}>
                    <td style={{ ...td, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11.5, color: c.hint, whiteSpace: "nowrap" }}>{r.ref ?? "—"}</td>
                    <td style={td}>
                      <Link href={ROUTES.rfq(r.id)} style={{ fontWeight: 600, color: c.ink, textDecoration: "none" }}>{r.title}</Link>
                      {r.unread > 0 && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: "#fff", background: c.accent, borderRadius: 10, padding: "1px 7px" }}>{r.unread} new</span>}
                    </td>
                    <td style={{ ...td, color: c.muted, fontSize: 12.5 }}>{RFQ_ORIGIN_LABEL[r.origin_type]}{r.origin_label ? ` · ${r.origin_label}` : ""}</td>
                    <td style={{ ...td, fontVariantNumeric: "tabular-nums", color: c.muted }}>{r.asked ? `${r.replied}/${r.asked}` : "—"}</td>
                    <td style={{ ...td, color: c.muted, fontSize: 12.5, whiteSpace: "nowrap" }}>{fmtDate(r.respond_by)}</td>
                    <td style={td}><Pill label={RFQ_STATUS_LABEL[r.status]} tone={RFQ_STATUS_TONE[r.status]} /></td>
                    <td style={{ ...td, color: c.hint, fontSize: 12, whiteSpace: "nowrap" }}>{fmtDate(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <PagerLink page={page} total={filtered.length} pageSize={DEFAULT_PAGE_SIZE} baseHref={ROUTES.rfqs} hiddenParams={{ ...hp, sort, dir }} />
          </div>
        )}
      </div>
    </>
  );
}
