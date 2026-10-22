"use client";

import s from "./RowTable.module.css";

export type RowTableRow = {
  id: string;
  /** What the opening button says to a screen reader, for example "Offers: edit". */
  openLabel: string;
  onOpen: () => void;
  /** One node per column. The first sits inside the button that opens the row. */
  cells: React.ReactNode[];
  dim?: boolean;
};

/**
 * The one list pattern for a settings page: one row per thing, a row opens its side panel (the pattern of the
 * Integration middleware and the Webhooks library). A table on a desktop, a stack of cards under 780 px with each
 * column's name before its value. No inline editing: the row only shows, the panel edits.
 */
export default function RowTable({ label, columns, rows, empty }: {
  label: string;
  columns: string[];
  rows: RowTableRow[];
  empty?: React.ReactNode;
}) {
  if (rows.length === 0 && empty) return <div className={s.card}>{empty}</div>;
  return (
    <div className={s.card}>
      <table className={s.table} aria-label={label}>
        <thead>
          <tr>{columns.map((c) => <th key={c} scope="col">{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.dim ? s.dim : undefined}>
              {r.cells.map((cell, i) => (
                <td key={i} data-label={i === 0 ? undefined : columns[i]}>
                  {i === 0 ? (
                    <button type="button" className={s.open} aria-label={r.openLabel} onClick={r.onOpen}>{cell}</button>
                  ) : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
