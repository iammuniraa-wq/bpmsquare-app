"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import { byLabel, viaLabel, type ChangeLogRow } from "@/app/(app)/administration/change-history/changeHistoryRows";
import s from "./people.module.css";
import { accessEventDetails, accessEventTitle } from "./logic";
import { loadAccessChanges } from "./api";

const FEW = 5;

/** The history rows, newest first: a few, then "Show all". Pure so it can be rendered with fixed data. */
export function ChangeRows({ rows, all, onShowAll }: { rows: readonly ChangeLogRow[]; all: boolean; onShowAll: () => void }) {
  if (rows.length === 0) return <span className={`${s.small} ${s.muted}`}>No changes recorded yet.</span>;
  const shown = all ? rows : rows.slice(0, FEW);
  return (
    <div className={s.stack}>
      <ul className={s.events} aria-label="Changes">
        {shown.map((r) => {
          const via = viaLabel(r.via);
          return (
            <li key={r.id} className={s.event}>
              <span className={s.eventTitle}>{accessEventTitle(r)}</span>
              <span className={`${s.small} ${s.muted}`}>{new Date(r.created_at).toLocaleString()} · {byLabel(r)}{via ? ` · ${via}` : ""}</span>
              {accessEventDetails(r).map((d, i) => <span key={i} className={`${s.small} ${s.muted}`}>{d}</span>)}
            </li>
          );
        })}
      </ul>
      {!all && rows.length > FEW && <Button size="sm" onClick={onShowAll}>{`Show all (${rows.length})`}</Button>}
    </div>
  );
}

/** The Changes section of the person panel: this login's change history, loaded when the section opens. */
export default function ChangesSection({ userId }: { userId: string }) {
  const [rows, setRows] = useState<ChangeLogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  useEffect(() => {
    let live = true;
    loadAccessChanges(userId).then((r) => { if (live) setRows(r); }).catch((e) => { if (live) setError(e instanceof Error ? e.message : "Could not load the changes."); });
    return () => { live = false; };
  }, [userId]);

  if (error) return <span role="alert" className={s.issue}>{error}</span>;
  if (!rows) return <span className={`${s.small} ${s.muted}`} role="status">Loading…</span>;
  return <ChangeRows rows={rows} all={all} onShowAll={() => setAll(true)} />;
}
