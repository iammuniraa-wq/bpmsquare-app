"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import InfoTip from "@/components/ui/InfoTip";
import { Select } from "@/components/ui/Input";
import SettingsSection from "@/components/settings/SettingsSection";
import { useUnsavedChangesGuard } from "@/lib/unsavedChanges";
import { ROUTES } from "@/lib/constants";
import { lineAmount, round2 } from "@/lib/contractProjects/budget";
import { money } from "@/lib/contractProjects/format";
import { PROJECT_TIPS } from "@/lib/contractProjects/tips";
import { REVISION_STATUS_LABEL, type BudgetLine, type RevisionRow } from "@/lib/contractProjects/types";
import MasterPicker from "./MasterPicker";
import { committedFor } from "./buyout/rules";
import type { BuyoutData } from "./buyout/types";
import { useBuyoutSummary } from "./buyout/useBuyoutSummary";

type Row = {
  key: string;
  line_key: string | null;
  resource_code: string;
  cost_code: string;
  wbs: string;
  description: string;
  qty: string;
  unit: string;
  unit_cost: string;
  cost_known: boolean;
  source_ref: string;
  reserve: boolean;
  committed: number | null;
  actual: number | null;
};

let counter = 0;
const toRow = (l: BudgetLine): Row => ({
  key: `l${++counter}`, line_key: l.line_key, resource_code: l.resource_code ?? "", cost_code: l.cost_code ?? "", wbs: l.wbs ?? "", description: l.description,
  qty: String(l.qty), unit: l.unit ?? "", unit_cost: String(l.unit_cost), cost_known: l.cost_known, source_ref: l.source_ref ?? "", reserve: l.reserve, committed: l.committed, actual: l.actual,
});
const blank = (resource: string): Row => ({ key: `l${++counter}`, line_key: null, resource_code: resource, cost_code: "", wbs: "", description: "", qty: "1", unit: "", unit_cost: "0", cost_known: true, source_ref: "", reserve: false, committed: null, actual: null });
const rowAmount = (r: Row) => lineAmount(Number(r.qty) || 0, Number(r.unit_cost) || 0);

const cell: React.CSSProperties = { padding: "4px 6px", verticalAlign: "middle" };
const head: React.CSSProperties = { textAlign: "left", fontSize: 11, color: c.hint, textTransform: "uppercase", letterSpacing: 0.4, padding: "8px 6px", whiteSpace: "nowrap", background: c.panel2, fontWeight: 600 };

/**
 * The budget of one revision: lines grouped by resource type with a subtotal each, edited in place while the revision is a draft.
 * The grid scrolls inside its own container (one column of everything else on a phone). Saving replaces the revision's lines
 * through PUT /api/contract-projects/[id]/budget; the amounts and the total are the server's.
 */
export default function BudgetGrid({ projectId, revision, revisions, lines, resources, canEdit, projectClosed, currency, buyoutOn = false, initialBuyout }: {
  projectId: string;
  revision: Pick<RevisionRow, "id" | "rev_no" | "status">;
  revisions: Pick<RevisionRow, "id" | "rev_no" | "status">[];
  lines: BudgetLine[];
  resources: { code: string; name: string; revenue_side: boolean }[];
  canEdit: boolean;
  projectClosed: boolean;
  currency: string | null;
  /** The project came from a tender: a Committed column shows the awarded price of the Buy-out package each line is in. */
  buyoutOn?: boolean;
  /** Lets a server render (and its test) show the column. The page never passes it. */
  initialBuyout?: BuyoutData | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const costResources = resources.filter((r) => !r.revenue_side);
  const initial = useMemo(() => lines.map(toRow), [lines]);
  const [rows, setRows] = useState<Row[]>(initial);
  const [savedKey, setSavedKey] = useState(() => JSON.stringify(initial.map(({ key: _k, ...r }) => r)));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const editable = canEdit && revision.status === "draft" && !projectClosed;
  const dirty = JSON.stringify(rows.map(({ key: _k, ...r }) => r)) !== savedKey;
  useUnsavedChangesGuard(dirty, { body: "The budget has unsaved edits. If you leave now they will be lost." });

  const nameOf = new Map(resources.map((r) => [r.code, r.name]));
  const groups = useMemo(() => {
    const by = new Map<string, Row[]>();
    for (const r of rows) by.set(r.resource_code, [...(by.get(r.resource_code) ?? []), r]);
    return [...by.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  }, [rows]);
  const total = round2(rows.reduce((s, r) => s + rowAmount(r), 0));
  const showErp = rows.some((r) => r.committed !== null || r.actual !== null);
  // The awarded price of the Buy-out package a line is in, read from the buy-out summary; the column is left out while there is none.
  const buyout = useBuyoutSummary(projectId, buyoutOn, initialBuyout);
  const bought = buyout?.committed_by_line ?? null;
  const idOfKey = useMemo(() => new Map(lines.map((l) => [l.line_key, l.id])), [lines]);
  const boughtFor = (r: Row) => committedFor(bought, { id: r.line_key ? idOfKey.get(r.line_key) : null, line_key: r.line_key });
  const showCommitted = showErp || (!!bought && Object.keys(bought).length > 0);

  const patch = (key: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));

  function save() {
    setError(""); setNotice("");
    startTransition(async () => {
      const res = await fetch(`/api/contract-projects/${projectId}/budget`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          revision_id: revision.id,
          lines: rows.map((r) => ({
            line_key: r.line_key, resource_code: r.resource_code || null, cost_code: r.cost_code.trim() || null, wbs: r.wbs || null, description: r.description,
            qty: r.qty === "" ? 1 : Number(r.qty), unit: r.unit || null, unit_cost: r.unit_cost === "" ? 0 : Number(r.unit_cost), cost_known: r.cost_known, source_ref: r.source_ref || null, reserve: r.reserve,
          })),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(`${j.row ? `Line ${j.row}: ` : ""}${j.error ?? "Could not save the budget"}`); return; }
      const next = ((j.lines ?? []) as BudgetLine[]).map(toRow);
      setRows(next); setSavedKey(JSON.stringify(next.map(({ key: _k, ...r }) => r)));
      setNotice("Budget saved");
      router.refresh();
    });
  }

  return (
    <div data-guide="cp.budget" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: c.muted }}>
          Revision
          <Select aria-label="Revision" data-guide="cp.budget.revision" value={revision.id} style={{ minHeight: 44, width: "auto" }}
            onChange={(e) => router.push(`${ROUTES.contractProject(projectId)}?tab=budget&revision=${e.target.value}`)}>
            {revisions.map((r) => <option key={r.id} value={r.id}>{r.rev_no === 0 ? "Baseline" : `Revision ${r.rev_no}`} · {REVISION_STATUS_LABEL[r.status]}</option>)}
          </Select>
        </label>
        {editable && <Button variant="secondary" data-guide="cp.budget.add" style={{ minHeight: 44 }} onClick={() => setRows((rs) => [...rs, blank(costResources.find((r) => r.code === "11")?.code ?? costResources[0]?.code ?? "")])}>+ Add line</Button>}
        {!editable && !projectClosed && (
          <span data-guide="cp.budget.locked" role="status" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, color: "var(--amberink)" }}>
            {revision.status === "draft" ? "You can view this budget but not change it" : revision.status === "pending" ? "Locked while it waits for approval" : "Locked"}
            <InfoTip label="Locked budget">{PROJECT_TIPS.locked}</InfoTip>
          </span>
        )}
        {projectClosed && <span role="status" style={{ fontSize: 13, color: c.muted }}>This project is closed.</span>}
        <span style={{ marginLeft: "auto", fontSize: 14, fontWeight: 700, color: c.ink, fontVariantNumeric: "tabular-nums" }}>Total {money(total, currency, 2)}</span>
      </div>

      {rows.length === 0 ? (
        <div style={{ fontSize: 13, color: c.hint, padding: "14px 0" }}>{editable ? "No lines yet. Add the first one." : "This budget has no lines."}</div>
      ) : groups.map(([code, group]) => (
        <SettingsSection
          key={code || "none"} id={`cp.budget.group.${code || "none"}`} defaultOpen
          title={`${code ? `${code} · ${nameOf.get(code) ?? "Resource"}` : "No resource type"} · ${money(round2(group.reduce((s, r) => s + rowAmount(r), 0)), currency, 2)}`}
          summary={`${group.length} line${group.length === 1 ? "" : "s"}`}
        >
          <div style={{ overflowX: "auto" }} data-guide="cp.budget.scroll">
            <table style={{ width: "100%", minWidth: 980, borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={head}>Description</th>
                  <th style={head}><span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>Resource <InfoTip label="Resource">{PROJECT_TIPS.resource}</InfoTip></span></th>
                  <th style={head}><span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>Cost code <InfoTip label="Cost code">{PROJECT_TIPS.costCode}</InfoTip></span></th>
                  <th style={head}>Qty</th><th style={head}>Unit</th>
                  <th style={head}><span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>Unit cost <InfoTip label="Unit cost">{PROJECT_TIPS.estimated}</InfoTip></span></th>
                  <th style={{ ...head, textAlign: "right" }}>Amount</th>
                  <th style={head}><span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>Reserve <InfoTip label="Reserve">{PROJECT_TIPS.reserve}</InfoTip></span></th>
                  {showCommitted && <th data-guide="cp.budget.committed" style={{ ...head, textAlign: "right" }}><span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>Committed <InfoTip label="Committed">{PROJECT_TIPS.committed}</InfoTip></span></th>}
                  {showErp && <th style={{ ...head, textAlign: "right" }}><span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>Actual <InfoTip label="Actual">{PROJECT_TIPS.actual}</InfoTip></span></th>}
                  <th style={head}><span style={{ position: "absolute", left: -9999 }}>Remove</span></th>
                </tr>
              </thead>
              <tbody>
                {group.map((r) => (
                  <Fragment key={r.key}>
                    <tr style={{ borderTop: `1px solid ${c.line}` }}>
                      <td style={{ ...cell, minWidth: 220 }}>
                        <input className="bpm-input" aria-label="Description" value={r.description} disabled={!editable} maxLength={500} style={{ minHeight: 44, width: "100%" }} onChange={(e) => patch(r.key, { description: e.target.value })} />
                        {r.wbs && <div style={{ fontSize: 11, color: c.hint, padding: "2px 2px 0" }}>{r.wbs}</div>}
                      </td>
                      <td style={{ ...cell, minWidth: 150 }}>
                        <Select aria-label="Resource type" value={r.resource_code} disabled={!editable} style={{ minHeight: 44 }} onChange={(e) => patch(r.key, { resource_code: e.target.value })}>
                          <option value="">— Choose —</option>
                          {costResources.map((x) => <option key={x.code} value={x.code}>{x.code} · {x.name}</option>)}
                          {r.resource_code && !costResources.some((x) => x.code === r.resource_code) && <option value={r.resource_code}>{r.resource_code}</option>}
                        </Select>
                      </td>
                      <td style={{ ...cell, minWidth: 130 }}><MasterPicker kind="cost_code" label="Cost code" value={r.cost_code} disabled={!editable} onChange={(v) => patch(r.key, { cost_code: v })} guide="cp.budget.cost_code" /></td>
                      <td style={{ ...cell, width: 90 }}><input className="bpm-input" type="number" min="0" step="any" inputMode="decimal" aria-label="Quantity" value={r.qty} disabled={!editable} style={{ minHeight: 44, width: "100%" }} onChange={(e) => patch(r.key, { qty: e.target.value })} /></td>
                      <td style={{ ...cell, width: 80 }}><input className="bpm-input" aria-label="Unit" value={r.unit} disabled={!editable} maxLength={30} style={{ minHeight: 44, width: "100%" }} onChange={(e) => patch(r.key, { unit: e.target.value })} /></td>
                      <td style={{ ...cell, width: 130 }}>
                        <input className="bpm-input" type="number" min="0" step="any" inputMode="decimal" aria-label="Unit cost" value={r.unit_cost} disabled={!editable} style={{ minHeight: 44, width: "100%" }} onChange={(e) => patch(r.key, { unit_cost: e.target.value, cost_known: true })} />
                        {!r.cost_known && <div data-guide="cp.budget.estimated" style={{ fontSize: 11, color: "var(--amberink)", padding: "2px 2px 0" }}>estimated</div>}
                      </td>
                      <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", color: c.ink }}>{money(rowAmount(r), null, 2)}</td>
                      <td style={{ ...cell, width: 60, textAlign: "center" }}><input type="checkbox" aria-label="Reserve line" checked={r.reserve} disabled={!editable} style={{ width: 20, height: 20 }} onChange={(e) => patch(r.key, { reserve: e.target.checked })} /></td>
                      {showCommitted && <td style={{ ...cell, textAlign: "right", color: c.muted }}>{(r.committed ?? boughtFor(r)) === null ? "—" : money((r.committed ?? boughtFor(r)) as number, null, 2)}</td>}
                      {showErp && <td style={{ ...cell, textAlign: "right", color: c.muted }}>{r.actual === null ? "—" : money(r.actual, null, 2)}</td>}
                      <td style={{ ...cell, width: 50 }}>
                        {editable && <Button variant="quiet" iconOnly aria-label="Remove line" data-guide="cp.budget.remove" style={{ minWidth: 44, minHeight: 44 }} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>×</Button>}
                      </td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </SettingsSection>
      ))}

      {(error || notice) && <div role={error ? "alert" : "status"} style={{ fontSize: 13, color: error ? "var(--err-ink)" : "var(--tealink)" }}>{error || notice}</div>}
      {editable && (
        <div style={{ position: "sticky", bottom: 0, display: "flex", alignItems: "center", gap: 10, padding: "10px 0", background: "var(--bg, transparent)", zIndex: 5 }}>
          <Button variant="primary" loading={pending} disabled={!dirty} data-guide="cp.budget.save" style={{ minHeight: 44 }} onClick={save}>Save budget</Button>
          {dirty && <span style={{ fontSize: 12.5, color: c.hint }}>Unsaved changes</span>}
        </div>
      )}
    </div>
  );
}
