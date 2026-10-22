import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import { CARD_SURFACE } from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";

export type RelatedColumn<T> = {
  label: string;
  render: (row: T) => React.ReactNode;
  align?: "left" | "right" | "center";
  /** Extra cell style. */
  cellStyle?: React.CSSProperties;
};

const th: React.CSSProperties = {
  textAlign: "left", fontSize: 11, fontWeight: 600, color: c.hint, background: c.panel2,
  textTransform: "uppercase", letterSpacing: 0.4, padding: "9px 14px", whiteSpace: "nowrap",
  borderBottom: `1px solid ${c.line}`,
};
const td: React.CSSProperties = { padding: "11px 14px", fontSize: 13.5, verticalAlign: "middle" };

/**
 * A table of related records inside a record page's tab: a titled card with
 * the one quiet "+ New" action in its header, an optional summary figure
 * ("Outstanding: 1,200"), a scrollable table, and a real empty state that
 * offers the same action. Server component.
 */
export default function RelatedList<T>({
  title, newHref, newLabel, summary, columns, rows, rowKey, rowHref, emptyText, footer,
}: {
  title: string;
  /** Where the header's "+ New <label>" goes; omit when the tenant cannot create one here. */
  newHref?: string;
  newLabel?: string;
  summary?: React.ReactNode;
  columns: RelatedColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  rowHref?: (row: T) => string;
  emptyText: string;
  /** Under the table (a total row). */
  footer?: React.ReactNode;
}) {
  const action = newHref ? <Button href={newHref} variant="quiet" size="sm" data-guide="related.new">+ New {newLabel}</Button> : null;
  return (
    <section style={{ ...CARD_SURFACE, padding: 0, overflow: "hidden", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: "12px 16px", borderBottom: rows.length ? `1px solid ${c.line}` : undefined }}>
        <h2 style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: c.ink }}>{title}</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          {summary && <div style={{ fontSize: 13, color: c.muted }}>{summary}</div>}
          {action}
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState title={emptyText} action={newHref ? <Button href={newHref} variant="primary">+ New {newLabel}</Button> : undefined} />
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {columns.map((col) => <th key={col.label} style={{ ...th, textAlign: col.align ?? "left" }}>{col.label}</th>)}
                {rowHref && <th style={{ ...th, width: 60 }}><span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Open</span></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={rowKey(row)} style={{ borderTop: `1px solid ${c.line}` }}>
                  {columns.map((col) => (
                    <td key={col.label} style={{ ...td, textAlign: col.align ?? "left", ...col.cellStyle }}>{col.render(row)}</td>
                  ))}
                  {rowHref && (
                    <td style={{ ...td, textAlign: "right" }}>
                      <Button href={rowHref(row)} variant="quiet" size="sm">Open →</Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {footer && rows.length > 0 && <div style={{ display: "flex", justifyContent: "flex-end", padding: "10px 16px", borderTop: `1px solid ${c.line}` }}>{footer}</div>}
    </section>
  );
}
