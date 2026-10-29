import Link from "next/link";
import { c } from "@/lib/theme";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import ListFilterBar, { type DateFilter, type SelectFilter } from "@/components/ListFilterBar";
import AdvancedFilterPanel from "@/components/AdvancedFilterPanel";
import SortableTh from "@/components/SortableTh";
import PagerLink from "@/components/PagerLink";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import InfoTip from "@/components/ui/InfoTip";
import EmptyState from "@/components/ui/EmptyState";
import MoreMenu from "@/components/ui/MoreMenu";
import type { MenuItem } from "@/components/ui/menuItems";
import { DEFAULT_PAGE_SIZE } from "@/lib/paginate";
import type { SortDir } from "@/lib/listSort";
import type { PilotObjectType } from "@/lib/fieldRegistry";

export type ListColumn<T> = {
  id: string;
  label: string;
  /** Makes the header a sort toggle (and gives it the per-column search). */
  sortKey?: string;
  render: (row: T) => React.ReactNode;
  width?: number;
  /** Extra cell style on the desktop table. */
  cellStyle?: React.CSSProperties;
  /** Phone card: "title" is the card heading (one column), "meta" a label/value row, "hidden" is left out. */
  card?: "title" | "meta" | "hidden";
  /** What the column means, behind an "i" in the header (and beside the label on a phone card): two short sentences at most. */
  info?: string;
};

export type ListChip = { id: string; label: string; href: string; active: boolean };

const th: React.CSSProperties = {
  textAlign: "left", color: c.hint, fontWeight: 600,
  padding: "9px 14px", fontSize: 11, letterSpacing: 0.4,
  textTransform: "uppercase", whiteSpace: "nowrap", background: c.panel2,
};
const td: React.CSSProperties = { padding: "11px 14px", fontSize: 13.5, verticalAlign: "middle" };

/**
 * The shared list page.
 *
 *   Title                                         [...] [+ New Object]
 *   [chips]
 *   [search ........] [filters]   [Advanced filter]
 *   table, sortable headers (a stack of cards under 780px)
 *   pager
 *
 * Server component. The page keeps its own query, filtering and sorting
 * (this template does none of that, so list semantics cannot change) and
 * hands over the already-filtered, already-paged `rows`.
 */
export default function ObjectListPage<T>({
  title, subtitle, info, newLabel, newHref, newAction, menuItems, chips, search, advancedFilterObject,
  columns, rows, rowKey, rowHref, total, page, pageSize = DEFAULT_PAGE_SIZE, baseHref,
  sort, dir, linkParams, empty, filtered, beforeTable, wrapBody, columnSearch = true,
}: {
  title: string;
  subtitle?: string;
  /** An explanation of the list, behind an "i" after the title. */
  info?: string;
  /** Singular object name: "Supplier" -> "+ New Supplier". Omit when the list has no create route. */
  newLabel?: string;
  newHref?: string;
  /** The "+ New" control when creating is a dialog rather than a page (Leads): replaces the link button. */
  newAction?: React.ReactNode;
  /** Bulk / secondary actions, as link items. */
  menuItems?: MenuItem[];
  chips?: ListChip[];
  search: {
    value?: string;
    placeholder: string;
    /** Filters that live outside the bar and must survive a search submit. */
    hiddenParams?: Record<string, string | undefined>;
    selects?: SelectFilter[];
    dates?: DateFilter[];
  };
  advancedFilterObject?: PilotObjectType;
  columns: ListColumn<T>[];
  /** The current page's rows. */
  rows: T[];
  rowKey: (row: T) => string;
  /** Adds the trailing "Open" link and the card's open link. */
  rowHref?: (row: T) => string;
  /** Row count after filtering, before paging. */
  total: number;
  page: number;
  pageSize?: number;
  baseHref: string;
  sort?: string;
  dir?: SortDir;
  /** Every active filter / search param, carried by the sort links and the pager. */
  linkParams: Record<string, string | undefined>;
  empty: { title: string; text?: string; filteredTitle: string };
  /** A search / filter is active (picks which empty message to show). */
  filtered: boolean;
  /** Extra content between the filter bar and the table (a summary card the list keeps, e.g. Assets' loaner stock). */
  beforeTable?: React.ReactNode;
  /** Wraps the table / cards / pager (or the empty state) -- for a list that offers alternative views of the same rows (Cases on Nova). */
  wrapBody?: (body: React.ReactNode) => React.ReactNode;
  /** Per-column search boxes in the sortable headers (default on); off for a list whose rows are filtered in the database and cannot honour them. */
  columnSearch?: boolean;
}) {
  const titleCol = columns.find((col) => col.card === "title") ?? columns.find((col) => col.card !== "hidden") ?? columns[0];
  const metaCols = columns.filter((col) => col !== titleCol && col.card !== "hidden");

  const body = (
    <>
      {total === 0 ? (
        <Card padding={0}>
          <EmptyState
            title={filtered ? empty.filteredTitle : empty.title}
            text={filtered ? undefined : empty.text}
            action={!filtered && newHref ? <Button href={newHref} variant="primary">+ New {newLabel}</Button> : undefined}
          />
        </Card>
      ) : (
        <>
          <div className="bpm-list-table">
            <Card padding={0} style={{ overflow: "hidden" }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${c.line}` }}>
                      {columns.map((col) => col.sortKey ? (
                        <SortableTh
                          key={col.id}
                          label={col.label}
                          sortKey={col.sortKey}
                          searchId={columnSearch ? col.id : undefined}
                          info={col.info}
                          currentSort={sort}
                          currentDir={dir}
                          baseHref={baseHref}
                          hiddenParams={linkParams}
                          style={{ ...th, width: col.width }}
                        />
                      ) : (
                        <th key={col.id} style={{ ...th, width: col.width }}>{col.label}{col.info && <InfoTip label={col.label}>{col.info}</InfoTip>}</th>
                      ))}
                      {rowHref && <th style={{ ...th, width: 60 }}><span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Open</span></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={rowKey(row)} style={{ borderBottom: `1px solid ${c.line}` }}>
                        {columns.map((col) => (
                          <td key={col.id} style={{ ...td, ...col.cellStyle }}>{col.render(row)}</td>
                        ))}
                        {rowHref && (
                          <td style={{ ...td, textAlign: "right" }}>
                            <Link href={rowHref(row)} style={{
                              fontSize: 11.5, fontWeight: 600, color: c.accent,
                              background: c.accentbg, borderRadius: 6, padding: "4px 10px",
                              textDecoration: "none", whiteSpace: "nowrap",
                            }}>
                              Open →
                            </Link>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          <div className="bpm-list-cards">
            {rows.map((row) => (
              <div key={rowKey(row)} className="bpm-list-card">
                <div style={{ fontSize: 14.5, fontWeight: 600 }}>{titleCol.render(row)}</div>
                <dl style={{ margin: "8px 0 0", display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: "4px 14px", fontSize: 12.5 }}>
                  {metaCols.map((col) => (
                    <div key={col.id} style={{ display: "contents" }}>
                      <dt style={{ color: c.hint }}>{col.label}{col.info && <InfoTip label={col.label}>{col.info}</InfoTip>}</dt>
                      <dd style={{ margin: 0, color: c.muted, minWidth: 0, wordBreak: "break-word" }}>{col.render(row)}</dd>
                    </div>
                  ))}
                </dl>
                {rowHref && (
                  <div style={{ marginTop: 10, textAlign: "right" }}>
                    <Button href={rowHref(row)} variant="quiet" size="sm">Open →</Button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <PagerLink page={page} total={total} pageSize={pageSize} baseHref={baseHref} hiddenParams={{ ...linkParams, sort, dir: sort ? dir : undefined }} />
        </>
      )}
    </>
  );

  return (
    <>
      <TabTitle title={title} />
      <PageHeader
        title={title}
        subtitle={subtitle}
        info={info}
        action={(newHref || newAction || (menuItems && menuItems.length > 0)) ? (
          <>
            {menuItems && menuItems.length > 0 && <MoreMenu items={menuItems} />}
            {newAction ?? (newHref && <Button href={newHref} variant="primary" data-guide="list.new">+ New {newLabel}</Button>)}
          </>
        ) : undefined}
      />

      {chips && chips.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          {chips.map((chip) => (
            <Link key={chip.id} href={chip.href} aria-current={chip.active ? "true" : undefined} style={{
              fontSize: 12.5, fontWeight: chip.active ? 700 : 500,
              color: chip.active ? c.accent : c.muted,
              background: chip.active ? c.accentbg : c.panel2,
              border: `1px solid ${chip.active ? c.accent + "60" : c.line}`,
              borderRadius: 6, padding: "5px 12px", textDecoration: "none",
            }}>
              {chip.label}
            </Link>
          ))}
        </div>
      )}

      <ListFilterBar
        searchValue={search.value}
        searchPlaceholder={search.placeholder}
        hiddenParams={search.hiddenParams}
        selects={search.selects}
        dates={search.dates}
        clearHref={baseHref}
      />
      {advancedFilterObject && <AdvancedFilterPanel object={advancedFilterObject} />}
      {beforeTable}

      {wrapBody ? wrapBody(body) : body}
    </>
  );
}
