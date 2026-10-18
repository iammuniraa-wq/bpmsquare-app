"use client";

import { c } from "@/lib/theme";
import { useCurrency } from "@/lib/tenant-context";
import { moneyFormatter } from "@/lib/currency";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import BomRow from "./BomRow";
import AddLineForm from "./AddLineForm";
import ScheduleImport from "./ScheduleImport";
import ExportBar from "./ExportBar";
import type { BomGroupView } from "./bomView";

const th: React.CSSProperties = {
  textAlign: "left", fontSize: 11, fontWeight: 600, color: c.hint, background: c.panel2,
  textTransform: "uppercase", letterSpacing: 0.4, padding: "8px 12px", whiteSpace: "nowrap",
};

export default function BomTab({
  estimateId, groups, locked, canEdit, hasSchedule, hasTemplate,
}: {
  estimateId: string;
  groups: BomGroupView[];
  locked: boolean;
  canEdit: boolean;
  /** Any line came from an imported schedule. */
  hasSchedule: boolean;
  hasTemplate: boolean;
}) {
  const cur = useCurrency();
  const money = moneyFormatter(cur, { maximumFractionDigits: 2 });
  const editable = canEdit && !locked;
  const total = groups.reduce((a, g) => a + g.cost, 0);
  const lineCount = groups.reduce((a, g) => a + g.lines.length, 0);

  return (
    <>
      {locked && (
        <Card padding={14}><div style={{ fontSize: 13 }}><strong>Locked.</strong> This estimate already has a quote, so its lines can no longer change.</div></Card>
      )}
      <ExportBar estimateId={estimateId} />
      {lineCount === 0 ? (
        <Card padding={0}><EmptyState title="No lines yet" text="Lines come from the template's rules when the estimate is calculated, from an imported element schedule, or from lines you add by hand." /></Card>
      ) : (
        groups.map((g) => (
          <Card key={g.key} padding={0} style={{ overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "11px 14px", borderBottom: `1px solid ${c.line}` }}>
              <h3 className="bpm-t-section" style={{ margin: 0 }}>{g.name}</h3>
              <span style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>{money(g.cost)}</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: editable ? 640 : 520 }}>
                <thead>
                  <tr>
                    <th style={th}>Item</th>
                    <th style={th}>Unit</th>
                    <th style={{ ...th, textAlign: "right" }}>Qty</th>
                    <th style={{ ...th, textAlign: "right" }}>Unit cost</th>
                    <th style={{ ...th, textAlign: "right" }}>Cost</th>
                    {editable && <th style={th}><span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Actions</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {g.lines.map((l) => <BomRow key={l.id} line={l} estimateId={estimateId} editable={editable} money={money} />)}
                </tbody>
              </table>
            </div>
          </Card>
        ))
      )}
      {lineCount > 0 && (
        <div style={{ textAlign: "right", fontSize: 14, fontWeight: 700, color: c.ink }}>Total cost {money(total)}</div>
      )}
      {editable && <AddLineForm estimateId={estimateId} groupNames={groups.map((g) => g.name)} />}
      {editable && hasTemplate && <ScheduleImport estimateId={estimateId} hasSchedule={hasSchedule} />}
    </>
  );
}
