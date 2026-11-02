"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import InfoTip from "@/components/ui/InfoTip";
import SidePanel from "@/components/ui/SidePanel";
import { useFeel } from "@/components/FeelProvider";
import { WBS_TIPS } from "@/lib/wbs/tips";
import { divideByShares, pctText } from "@/lib/wbs/tree";
import { NEW_ITEM, draftBlocker, draftFromLine, draftKey, draftToParts, draftTotals, leafItems, nextShare, withPct, withQty, trimPct, type DraftRow } from "@/lib/wbs/screen";
import { call } from "./api";
import s from "./Wbs.module.css";

// Split one BOQ line across WBS items (docs/design/wbs.md section 3a): a side panel on a desktop, a bottom sheet on a phone. Shares are kept as
// percent; the quantity is shown beside and can be typed instead. Save stays disabled until the shares add up to 100 % and every part names an
// item, and the reason is printed (a blocker is never hidden behind an "i"). Typing never loses focus: only the derived figures and the total change.

type Item = { id: string; code: string; name: string; parent_id: string | null; sort_order: number; code_is_manual: boolean; owner_employee_id: string | null };
type Line = { id: string; item_no: string | null; row_no: number; description: string; uom: string | null; qty: number; amount: number; priced: boolean; wbs_item_id?: string | null; wbs_parts?: readonly { wbs_item_id: string; share_pct: number }[] };

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const qtyText = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 3 });
const label = (l: Pick<Line, "item_no" | "row_no">) => (l.item_no && l.item_no.trim() ? l.item_no : `#${l.row_no}`);

export default function SplitPanel({ base, line, items, onClose, onDone, onError, initialRows }: {
  /** /api/opportunities/[id]/tender/wbs */
  base: string;
  line: Line;
  /** Every item of the tender: only the leaves can take a share. */
  items: readonly Item[];
  onClose: () => void;
  /** After a save or an unsplit, with the notice to show. */
  onDone: (notice: string) => void;
  onError: (m: string) => void;
  /** Lets a server render (and its test) show a prepared draft. The page never passes it. */
  initialRows?: DraftRow[];
}) {
  const { confirm } = useFeel();
  const leaves = leafItems(items);
  const [rows, setRows] = useState<DraftRow[]>(() => initialRows ?? draftFromLine({ qty: line.qty, wbs_item_id: line.wbs_item_id ?? null, wbs_parts: line.wbs_parts ?? [] }));
  const [mode, setMode] = useState<"pct" | "qty">("pct");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const isSplit = (line.wbs_parts?.length ?? 0) > 0;
  const totals = draftTotals(rows);
  const blocker = draftBlocker(rows, items);
  const pcts = rows.map((r) => (Number.isFinite(Number(r.pct)) && r.pct.trim() !== "" ? Number(r.pct) : 0));
  const amounts = divideByShares(line.priced ? line.amount : 0, pcts);
  const totalQty = Math.round(pcts.reduce((a, p) => a + (line.qty * p) / 100, 0) * 1000) / 1000;

  const addPart = () => setRows((rs) => {
    const pct = nextShare(rs);
    return [...rs, withPct({ key: draftKey(), item: "", newName: "", pct, qty: "" }, pct, line.qty)];
  });
  const update = (key: string, fn: (r: DraftRow) => DraftRow) => setRows((rs) => rs.map((r) => (r.key === key ? fn(r) : r)));
  const chosenElsewhere = (key: string, id: string) => rows.some((r) => r.key !== key && r.item === id);

  async function save() {
    setError(""); onError("");
    setBusy(true);
    const out = await call<{ kind: string }>(`${base}/split`, "PUT", { boq_id: line.id, parts: draftToParts(rows) });
    setBusy(false);
    if (!out.ok) { setError(out.error); onError(out.error); return; }
    onDone(out.data.kind === "whole" ? `${label(line)} sits whole in one WBS item` : `${label(line)} split across ${rows.length} WBS items`);
  }

  async function unsplit() {
    const first = rows.find((r) => r.item && r.item !== NEW_ITEM);
    const target = items.find((i) => i.id === (line.wbs_parts?.[0]?.wbs_item_id ?? first?.item));
    if (!(await confirm({ title: `Unsplit ${label(line)}?`, body: target ? `The whole line goes to ${target.code} ${target.name}. You can change it after.` : "The whole line goes to its first WBS item. You can change it after.", confirmLabel: "Unsplit" }))) return;
    setBusy(true);
    const out = await call(`${base}/split`, "DELETE", { boq_id: line.id });
    setBusy(false);
    if (!out.ok) { setError(out.error); onError(out.error); return; }
    onDone(`${label(line)} is no longer split`);
  }

  return (
    <SidePanel
      title={`${isSplit ? "Edit split" : "Split"} ${label(line)}`} label={`Split item ${label(line)} across WBS items`} onClose={onClose}
      subtitle={<span className={s.splitHead}>{line.description} · {qtyText(line.qty)}{line.uom ? ` ${line.uom}` : ""}{line.priced ? ` · ${money(line.amount)}` : ""}</span>}
      footer={
        <>
          {isSplit && <Button variant="quiet" disabled={busy} onClick={() => void unsplit()} style={{ minHeight: 44 }} data-guide="boq.split.unsplit">Unsplit</Button>}
          <Button variant="secondary" onClick={onClose} style={{ minHeight: 44 }} data-guide="boq.split.cancel">Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!!blocker} onClick={() => void save()} style={{ minHeight: 44 }} data-guide="boq.split.save">Save split</Button>
        </>
      }
    >
      <div className="bpm-tap" data-guide="boq.split.panel" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {error && <div role="alert" style={{ background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, color: "var(--err-ink)" }}>{error}</div>}

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span className="bpm-t-label">Share as</span>
          <span role="group" aria-label="Share as" className={s.switch}>
            <Button variant={mode === "pct" ? "primary" : "secondary"} aria-pressed={mode === "pct"} onClick={() => setMode("pct")} style={{ minHeight: 44 }} data-guide="boq.split.mode_pct">%</Button>
            <Button variant={mode === "qty" ? "primary" : "secondary"} aria-pressed={mode === "qty"} onClick={() => setMode("qty")} style={{ minHeight: 44 }} data-guide="boq.split.mode_qty">Quantity</Button>
          </span>
          <InfoTip label="Shares">{WBS_TIPS.splitQty}</InfoTip>
        </div>

        {rows.map((r, i) => (
          <div key={r.key} className={s.partBox} data-guide="boq.split.part">
            <div className={s.partTop}>
              <Select aria-label={`WBS item for part ${i + 1}`} value={r.item} onChange={(e) => update(r.key, (x) => ({ ...x, item: e.target.value }))} style={{ minHeight: 44 }}>
                <option value="">Choose a WBS item</option>
                {leaves.map((l) => <option key={l.id} value={l.id} disabled={chosenElsewhere(r.key, l.id)}>{l.code} {l.name}</option>)}
                <option value={NEW_ITEM}>New WBS item…</option>
              </Select>
              <Input
                className={s.partShare} type="number" min={0} step="any" inputMode="decimal" style={{ minHeight: 44 }}
                aria-label={mode === "pct" ? `Share of part ${i + 1} in percent` : `Quantity of part ${i + 1}`}
                value={mode === "pct" ? r.pct : r.qty}
                onChange={(e) => update(r.key, (x) => (mode === "pct" ? withPct(x, e.target.value, line.qty) : withQty(x, e.target.value, line.qty)))}
              />
              <Button variant="quiet" iconOnly aria-label={`Remove part ${i + 1}`} disabled={rows.length <= 1} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} style={{ minHeight: 44, minWidth: 44 }}>✕</Button>
            </div>
            {r.item === NEW_ITEM && (
              <Input aria-label={`Name of the new WBS item for part ${i + 1}`} placeholder="Name of the new WBS item" value={r.newName} maxLength={200} onChange={(e) => update(r.key, (x) => ({ ...x, newName: e.target.value }))} style={{ minHeight: 44 }} autoFocus />
            )}
            <div className={s.derived} data-guide="boq.split.derived">
              {mode === "pct"
                ? `${r.qty ? qtyText(Number(r.qty)) : "0"}${line.uom ? ` ${line.uom}` : ""}${line.priced ? ` · ${money(amounts[i])}` : ""}`
                : `${r.pct ? trimPct(Number(r.pct)) : "0"} %${line.priced ? ` · ${money(amounts[i])}` : ""}`}
            </div>
          </div>
        ))}

        <div>
          <Button variant="secondary" onClick={addPart} style={{ minHeight: 44 }} data-guide="boq.split.add">+ Add part</Button>
        </div>

        <div role="status" aria-live="polite" data-guide="boq.split.total" className={`${s.total} ${totals.balanced ? s.totalOk : s.totalWarn}`}>
          {totals.balanced
            ? "Balanced"
            : `Total ${pctText(totals.total)} % · ${qtyText(totalQty)}${line.uom ? ` ${line.uom}` : ""} — ${pctText(Math.abs(totals.remaining))} % ${totals.remaining > 0 ? "remaining" : "too much"}`}
        </div>
        {blocker && <div className={s.blocker} data-guide="boq.split.blocker">{blocker}</div>}
      </div>
    </SidePanel>
  );
}
