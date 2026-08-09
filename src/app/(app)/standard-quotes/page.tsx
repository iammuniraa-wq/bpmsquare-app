import Link from "next/link";
import { requireWorkcenterView } from "@/lib/permissions";
import { requireTenantUser } from "@/lib/supabase-server";
import { requireFeature } from "@/lib/tenant";
import { listStandardQuotes } from "@/lib/data/live";
import type { StandardQuoteRow } from "@/lib/data/live";
import { c, pillar, type PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import PageHeader from "@/components/PageHeader";
import ListFilterBar from "@/components/ListFilterBar";
import Pill from "@/components/Pill";
import SortableTh from "@/components/SortableTh";
import { sortRows, readSortParams, type SortExtractor } from "@/lib/listSort";
import { ROUTES } from "@/lib/constants";
import type { StandardQuoteStatus } from "@/lib/types";

const STATUS_TONE: Record<StandardQuoteStatus, PillarKey> = {
  draft: "blue", sent: "amber", accepted: "green", rejected: "red", expired: "red",
};
const STATUS_LABEL: Record<StandardQuoteStatus, string> = {
  draft: "Draft", sent: "Sent", accepted: "Accepted", rejected: "Rejected", expired: "Expired",
};
const SUMMARY_STATUSES: StandardQuoteStatus[] = ["draft", "sent", "accepted", "rejected"];

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

const th: React.CSSProperties = {
  textAlign: "left", color: c.hint, fontWeight: 500,
  padding: "9px 12px", borderBottom: `1px solid ${c.line}`, fontSize: 11.5,
};
const td: React.CSSProperties = {
  padding: "10px 12px", borderBottom: `1px solid ${c.line}`,
  fontSize: 12.5, verticalAlign: "middle",
};

const SORT_EXTRACTORS: Record<string, SortExtractor<StandardQuoteRow>> = {
  ref: (q) => q.ref,
  account_name: (q) => q.account_name,
  status: (q) => q.status,
  total: (q) => q.total,
  valid_until: (q) => q.valid_until,
  created_at: (q) => q.created_at,
};

export default async function StandardQuotesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; sort?: string; dir?: string }>;
}) {
  await requireWorkcenterView("standard_quotes");
  await requireFeature("standard_quotes");
  const params = await searchParams;
  const { status: statusFilter, q } = params;
  const { sort, dir } = readSortParams(params);
  const [quotes, { role }] = await Promise.all([listStandardQuotes(), requireTenantUser()]);

  const summary = SUMMARY_STATUSES.map((s) => ({
    status: s,
    count: quotes.filter((q) => q.status === s).length,
    total: quotes.filter((q) => q.status === s).reduce((acc, q) => acc + q.total, 0),
  }));

  const needle = (q ?? "").trim().toLowerCase();
  const statusFiltered = statusFilter ? quotes.filter((quote) => quote.status === statusFilter) : quotes;
  const searched = statusFiltered.filter((quote) => {
    if (!needle) return true;
    return (
      (quote.ref ?? "").toLowerCase().includes(needle) ||
      (quote.account_name ?? "").toLowerCase().includes(needle)
    );
  });
  const filtered = sortRows(searched, sort, dir, SORT_EXTRACTORS);

  return (
    <>
      <PageHeader
        title="Standard Quotes"
        subtitle={`${filtered.length}${statusFilter ? ` ${STATUS_LABEL[statusFilter as StandardQuoteStatus] ?? statusFilter}` : ""} of ${quotes.length} total`}
        action={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {role === "admin" && (
              <Link
                href={ROUTES.standardQuoteTemplates}
                style={{ fontSize: 12.5, fontWeight: 600, color: c.muted, textDecoration: "none", border: `1px solid ${c.line}`, borderRadius: 8, padding: "8px 14px" }}
              >
                Manage Templates
              </Link>
            )}
            <Link
              href={ROUTES.standardQuoteNew}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600,
                background: c.accent, color: "#fff", textDecoration: "none",
              }}
            >
              + New Standard Quote
            </Link>
          </div>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: statusFilter ? 8 : 20 }}>
        {summary.map(({ status, count, total }) => (
          <Link key={status} href={statusFilter === status ? ROUTES.standardQuotes : `${ROUTES.standardQuotes}?status=${status}`} style={{ textDecoration: "none" }}>
            <div style={{ ...cardStyle, textAlign: "center", borderColor: statusFilter === status ? pillar[STATUS_TONE[status]].base : undefined }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
                {STATUS_LABEL[status]}
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: pillar[STATUS_TONE[status]].base }}>{inr(total)}</div>
              <div style={{ fontSize: 11, color: c.hint, marginTop: 2 }}>{count} quote{count !== 1 ? "s" : ""}</div>
            </div>
          </Link>
        ))}
      </div>

      {statusFilter && (
        <div style={{ marginBottom: 12 }}>
          <Link href={ROUTES.standardQuotes} style={{ fontSize: 12, color: c.hint, textDecoration: "none" }}>← Show all standard quotes</Link>
        </div>
      )}

      <ListFilterBar
        searchValue={q}
        searchPlaceholder="Search quote ref or account…"
        hiddenParams={{ status: statusFilter }}
        clearHref={ROUTES.standardQuotes}
      />

      {filtered.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: "center", padding: "48px 24px", color: c.muted }}>
          No standard quotes yet.{" "}
          <Link href={ROUTES.standardQuoteNew} style={{ color: c.accent, fontWeight: 600, textDecoration: "none" }}>
            + Create one
          </Link>
        </div>
      ) : (
        <div style={{ ...cardStyle, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {(() => {
                  const hp = { status: statusFilter, q };
                  return (
                    <>
                      <SortableTh label="Ref" sortKey="ref" currentSort={sort} currentDir={dir} baseHref={ROUTES.standardQuotes} hiddenParams={hp} style={th} />
                      <SortableTh label="Account" sortKey="account_name" currentSort={sort} currentDir={dir} baseHref={ROUTES.standardQuotes} hiddenParams={hp} style={th} />
                      <SortableTh label="Status" sortKey="status" currentSort={sort} currentDir={dir} baseHref={ROUTES.standardQuotes} hiddenParams={hp} style={th} />
                      <SortableTh label="Total" sortKey="total" currentSort={sort} currentDir={dir} baseHref={ROUTES.standardQuotes} hiddenParams={hp} style={th} />
                      <SortableTh label="Valid until" sortKey="valid_until" currentSort={sort} currentDir={dir} baseHref={ROUTES.standardQuotes} hiddenParams={hp} style={th} />
                      <SortableTh label="Created" sortKey="created_at" currentSort={sort} currentDir={dir} baseHref={ROUTES.standardQuotes} hiddenParams={hp} style={th} />
                    </>
                  );
                })()}
              </tr>
            </thead>
            <tbody>
              {filtered.map((q) => (
                <tr key={q.id} style={{ cursor: "pointer" }}>
                  <td style={td}>
                    <Link href={ROUTES.standardQuote(q.id)} style={{ fontFamily: "monospace", fontSize: 12, color: c.accent, fontWeight: 600, textDecoration: "none" }}>
                      {q.ref}
                    </Link>
                  </td>
                  <td style={td}>
                    <Link href={ROUTES.standardQuote(q.id)} style={{ color: "inherit", textDecoration: "none" }}>{q.account_name}</Link>
                  </td>
                  <td style={td}>
                    <Pill
                      label={STATUS_LABEL[q.status as StandardQuoteStatus] ?? q.status}
                      tone={STATUS_TONE[q.status as StandardQuoteStatus] ?? "blue"}
                    />
                  </td>
                  <td style={{ ...td, fontWeight: 700 }}>{inr(q.total)}</td>
                  <td style={{ ...td, color: c.muted }}>{q.valid_until ? fmtDate(q.valid_until) : "—"}</td>
                  <td style={{ ...td, color: c.muted }}>{fmtDate(q.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
