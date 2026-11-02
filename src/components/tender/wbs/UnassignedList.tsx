"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import InfoTip from "@/components/ui/InfoTip";
import { WBS_TIPS } from "@/lib/wbs/tips";
import { trimPct } from "@/lib/wbs/screen";
import { fmtMoney, type HeldLine } from "./WbsRow";
import s from "./Wbs.module.css";

// The lines in no WBS item, in amber (docs/design/wbs.md section 3a): whole unassigned lines are ticked here and grouped with the same bar as in
// the BOQ view; a split line whose item was removed shows what is left unassigned and is fixed in the split panel (it is not tickable). Five
// are shown, then "show all".

const SHOWN = 5;
const label = (l: Pick<HeldLine, "item_no" | "row_no">) => (l.item_no && l.item_no.trim() ? l.item_no : `#${l.row_no}`);

export type UnassignedEntry = { line: HeldLine; remainder: number; split: boolean };

export default function UnassignedList({ entries, selected, onToggle, canEdit, onSplit, onOpenLine }: {
  entries: readonly UnassignedEntry[];
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  canEdit: boolean;
  onSplit: (id: string) => void;
  onOpenLine: (id: string) => void;
}) {
  const [all, setAll] = useState(false);
  if (entries.length === 0) return null;
  const shown = all ? entries : entries.slice(0, SHOWN);
  return (
    <section className={s.unassigned} data-guide="boq.wbs_unassigned" aria-label="Unassigned lines">
      <div className={s.unTitle}>
        Unassigned: {entries.length} line{entries.length === 1 ? "" : "s"}
        <InfoTip label="Unassigned">{WBS_TIPS.unassigned}</InfoTip>
      </div>
      {shown.map(({ line, remainder, split }) => (
        <div key={line.id} className={s.unRow} data-guide="boq.wbs_unassigned_line">
          {split || !canEdit ? <span style={{ minWidth: 44 }} aria-hidden="true" /> : (
            <label className={s.check}>
              <input type="checkbox" checked={selected.has(line.id)} onChange={() => onToggle(line.id)} aria-label={`Select item ${label(line)}`} />
            </label>
          )}
          <button type="button" className={s.open} onClick={() => onOpenLine(line.id)} aria-label={`Open item ${label(line)}`}>{label(line)}</button>
          <span className={s.grow}>{line.description}</span>
          {split ? (
            <>
              <span style={{ color: "var(--amberink)", fontWeight: 600 }} data-guide="boq.wbs_remainder">{trimPct(remainder)} % unassigned</span>
              {canEdit && <Button variant="quiet" onClick={() => onSplit(line.id)} style={{ minHeight: 44 }} data-guide="boq.wbs_edit_split">Edit split</Button>}
            </>
          ) : (
            <span className={s.muted}>{line.qty.toLocaleString("en-US", { maximumFractionDigits: 3 })}{line.uom ? ` ${line.uom}` : ""}{line.priced ? ` · ${fmtMoney(line.amount)}` : ""}</span>
          )}
        </div>
      ))}
      {entries.length > SHOWN && (
        <div><Button variant="quiet" onClick={() => setAll(!all)} aria-expanded={all} style={{ minHeight: 44 }} data-guide="boq.wbs_unassigned_all">{all ? "Show fewer" : `Show all ${entries.length}`}</Button></div>
      )}
    </section>
  );
}
