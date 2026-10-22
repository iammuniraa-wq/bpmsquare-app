"use client";

import s from "./SettingsList.module.css";

export type SettingsListRow = {
  key: string;
  /** The name: the one control in the row that opens its side panel. */
  title: React.ReactNode;
  /** One value per extra column, in order. */
  cells?: React.ReactNode[];
  dim?: boolean;
  /** Accessible name of the open button; defaults to the title when that is text. */
  label?: string;
};

/**
 * The one list for a settings screen: a table, one row per item, the name opens the item's side panel (a bottom
 * sheet on a phone). No per-item cards, no inline expanders (bpmsquarecore 6c, rule 4).
 */
export default function SettingsList({ label, headers = [], rows, onOpen, empty }: {
  label: string;
  /** Extra column headers after the name column. */
  headers?: string[];
  rows: SettingsListRow[];
  onOpen: (key: string) => void;
  empty?: React.ReactNode;
}) {
  if (rows.length === 0) return empty ? <div className={s.wrap}><div className={s.empty}>{empty}</div></div> : null;
  return (
    <div className={s.wrap}>
      <table className={s.table} aria-label={label}>
        <thead>
          <tr>
            <th scope="col">Name</th>
            {headers.map((h) => <th key={h} scope="col">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={`${s.row} ${r.dim ? s.dim : ""}`}>
              <td>
                <button type="button" className={s.open} onClick={() => onOpen(r.key)} aria-label={`Open ${r.label ?? (typeof r.title === "string" ? r.title : r.key)}`}>
                  {r.title}
                </button>
              </td>
              {headers.map((h, i) => <td key={h} data-label={h}>{r.cells?.[i] ?? ""}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The "+ New" line above a list. */
export function ListBar({ children }: { children: React.ReactNode }) {
  return <div className={s.bar}>{children}</div>;
}
