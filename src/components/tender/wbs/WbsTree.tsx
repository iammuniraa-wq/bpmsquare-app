"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import InfoTip from "@/components/ui/InfoTip";
import { useFeel } from "@/components/FeelProvider";
import { WBS_TIPS } from "@/lib/wbs/tips";
import { holdersOf, partsOf, unassignedOf, type Figures } from "@/lib/wbs/tree";
import { rootBars, visibleItems } from "@/lib/wbs/screen";
import type { WbsItemView } from "@/lib/tender/wbs/types";
import { call } from "./api";
import UnassignedList from "./UnassignedList";
import WbsItemForm from "./WbsItemForm";
import WbsRow, { type HeldLine, type RowAction } from "./WbsRow";
import s from "./Wbs.module.css";

// The WBS view of the Bill of quantities (docs/design/wbs.md section 3a): one bar per top-level item, the tree with roll-ups on every branch,
// the lines (and parts of split lines) under each leaf, and the Unassigned list in amber. Branches and leaves fold and remember it per tender in
// this browser. Changes go to /api/opportunities/[id]/tender/wbs/*; the workspace and the deal are the server's, not this component's.

type FormState = { mode: "new" | "edit"; item?: WbsItemView; parentId?: string | null; focus?: "name" | "code" | "parent" | "owner" } | null;

const foldKey = (opportunityId: string) => `wbs-fold:${opportunityId}`;
type Fold = { closed: string[]; open: string[] };
function readFold(opportunityId: string): Fold {
  try {
    const raw = JSON.parse(window.localStorage.getItem(foldKey(opportunityId)) ?? "null") as Partial<Fold> | null;
    return { closed: Array.isArray(raw?.closed) ? raw!.closed!.filter((x) => typeof x === "string") : [], open: Array.isArray(raw?.open) ? raw!.open!.filter((x) => typeof x === "string") : [] };
  } catch { return { closed: [], open: [] }; }
}

export default function WbsTree({ base, opportunityId, items, rollup, lines, canEdit, selected, onToggle, onChanged, onError, onNotice, onSplit, onOpenLine }: {
  /** /api/opportunities/[id]/tender/wbs */
  base: string;
  opportunityId: string;
  items: readonly WbsItemView[];
  rollup: Readonly<Record<string, Figures>>;
  lines: readonly HeldLine[];
  canEdit: boolean;
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onChanged: () => void;
  onError: (m: string) => void;
  onNotice: (m: string) => void;
  onSplit: (lineId: string) => void;
  onOpenLine: (lineId: string) => void;
}) {
  const { confirm } = useFeel();
  const [fold, setFold] = useState<Fold>({ closed: [], open: [] });
  const [form, setForm] = useState<FormState>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setFold(readFold(opportunityId)); }, [opportunityId]);

  const flip = useCallback((id: string, kind: "closed" | "open") => {
    setFold((f) => {
      const has = f[kind].includes(id);
      const next = { ...f, [kind]: has ? f[kind].filter((x) => x !== id) : [...f[kind], id] };
      try { window.localStorage.setItem(foldKey(opportunityId), JSON.stringify(next)); } catch { /* remembering is a convenience */ }
      return next;
    });
  }, [opportunityId]);

  const memberships = useMemo(() => lines.map((l) => ({ wbs_item_id: l.wbs_item_id, parts: l.wbs_parts })), [lines]);
  const holders = useMemo(() => holdersOf(memberships), [memberships]);
  const collapsed = useMemo(() => new Set(fold.closed), [fold.closed]);
  const visible = useMemo(() => visibleItems(items, collapsed), [items, collapsed]);
  const bars = useMemo(() => rootBars(items, rollup), [items, rollup]);
  const heldBy = useMemo(() => {
    const out = new Map<string, HeldLine[]>();
    for (const l of lines) for (const p of partsOf({ wbs_item_id: l.wbs_item_id, parts: l.wbs_parts })) out.set(p.wbs_item_id, [...(out.get(p.wbs_item_id) ?? []), l]);
    return out;
  }, [lines]);
  const unassigned = useMemo(() => unassignedOf(lines.map((l) => ({ ...l, wbs_item_id: l.wbs_item_id, parts: l.wbs_parts }))).map((u) => ({ line: lines.find((l) => l.id === u.line.id)!, remainder: u.remainder, split: u.split })), [lines]);

  async function remove(item: WbsItemView) {
    const held = heldBy.get(item.id) ?? [];
    const whole = held.filter((l) => l.wbs_parts.length === 0).length;
    const shared = held.length - whole;
    const kids = items.filter((i) => i.parent_id === item.id).length;
    const body = [
      whole > 0 ? `Its ${whole} line${whole === 1 ? "" : "s"} go${whole === 1 ? "es" : ""} to Unassigned.` : "",
      shared > 0 ? `${shared} share${shared === 1 ? "" : "s"} of split lines become${shared === 1 ? "s" : ""} an unassigned remainder.` : "",
      kids > 0 ? "Sub-items move up one level." : "",
    ].filter(Boolean).join(" ");
    if (!(await confirm({ title: `Remove ${item.code} ${item.name}?`, body: body || "Nothing is in it.", confirmLabel: "Remove", tone: "danger" }))) return;
    setBusy(true); onError("");
    const out = await call(`${base}/${item.id}`, "DELETE");
    setBusy(false);
    if (!out.ok) { onError(out.error); return; }
    onNotice(`WBS ${item.code} removed`);
    onChanged();
  }

  async function renumber() {
    if (!(await confirm({ title: "Renumber the WBS?", body: "Codes you typed are kept; the rest are recomputed.", confirmLabel: "Renumber" }))) return;
    setBusy(true); onError("");
    const out = await call<{ changed: number }>(`${base}/renumber`, "POST", {});
    setBusy(false);
    if (!out.ok) { onError(out.error); return; }
    onNotice(out.data.changed > 0 ? `${out.data.changed} code${out.data.changed === 1 ? "" : "s"} renumbered` : "The codes were already in order");
    onChanged();
  }

  function act(item: WbsItemView, a: RowAction) {
    if (a === "remove") { void remove(item); return; }
    if (a === "add") { setForm({ mode: "new", parentId: item.id }); return; }
    setForm({ mode: "edit", item, focus: a === "rename" ? "name" : a === "code" ? "code" : a === "move" ? "parent" : "owner" });
  }

  const done = (notice: string) => { setForm(null); onNotice(notice); onChanged(); };
  const total = bars.reduce((sum, b) => sum + b.client_amount, 0);

  return (
    <div className="bpm-tap" data-guide="boq.wbs_tree" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className={s.tools}>
        {canEdit && <Button variant="primary" disabled={busy} onClick={() => setForm({ mode: "new" })} style={{ minHeight: 44 }} data-guide="boq.wbs_new">New WBS item</Button>}
        {canEdit && items.length > 0 && <Button variant="secondary" disabled={busy} onClick={() => void renumber()} style={{ minHeight: 44 }} data-guide="boq.wbs_renumber">Renumber</Button>}
        <InfoTip label="WBS codes">{WBS_TIPS.code}</InfoTip>
        <InfoTip label="WBS totals">{WBS_TIPS.rollup}</InfoTip>
      </div>

      {items.length === 0 ? (
        <Card>
          <div data-guide="boq.wbs_empty" style={{ fontSize: 13 }}>
            {canEdit ? "No WBS yet. Tick lines on the BOQ view and choose Group into WBS, or Split one line across items." : "No WBS has been set up on this tender yet."}
          </div>
        </Card>
      ) : (
        <>
          {bars.length > 0 && total > 0 && (
            <div className={s.bars} data-guide="boq.wbs_bars" role="group" aria-label="Share of the client amount by top-level item">
              {bars.map((b) => (
                <div key={b.id} className={s.barLine}>
                  <span className={s.barLabel}><b>{b.code}</b> {b.name}</span>
                  <span className={s.track} aria-hidden="true">
                    <span className={s.fill} style={{ width: `${b.client_pct}%` }} />
                    {b.cost_pct != null && <span className={s.fillCost} style={{ width: `${Math.min(100, b.cost_pct)}%`, height: 3 }} />}
                  </span>
                  <span className={s.barNum}>{b.client_pct}%{b.cost_pct != null ? ` · cost ${b.cost_pct}%` : ""}</span>
                </div>
              ))}
            </div>
          )}

          <ul className={s.tree} role="tree" aria-label="WBS">
            <li className={s.treeHead} aria-hidden="true"><span>Item</span><span>Owner</span><span style={{ textAlign: "right" }}>Lines</span><span style={{ textAlign: "right" }}>Client amount</span><span style={{ textAlign: "right" }}>Cost</span><span /></li>
            {visible.map((it) => {
              const held = it.is_leaf ? heldBy.get(it.id) ?? [] : [];
              return (
                <WbsRow
                  key={it.id} item={it} figures={rollup[it.id]} items={items} lines={held} canEdit={canEdit}
                  branchOpen={!fold.closed.includes(it.id)} leafOpen={fold.open.includes(it.id)} hasContent={held.length > 0}
                  onToggle={() => flip(it.id, it.is_leaf ? "open" : "closed")} onAction={(a) => act(it, a)} onOpenLine={onOpenLine}
                />
              );
            })}
          </ul>
        </>
      )}

      <UnassignedList entries={unassigned} selected={selected} onToggle={onToggle} canEdit={canEdit} onSplit={onSplit} onOpenLine={onOpenLine} />

      {form && (
        <WbsItemForm
          key={`${form.mode}-${form.item?.id ?? form.parentId ?? "root"}`} base={base} mode={form.mode} items={items} item={form.item} parentId={form.parentId} holders={holders} focus={form.focus}
          onClose={() => setForm(null)} onDone={done} onError={onError}
        />
      )}
    </div>
  );
}
