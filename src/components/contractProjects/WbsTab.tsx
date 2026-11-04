"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { c, pillar } from "@/lib/theme";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import InfoTip from "@/components/ui/InfoTip";
import { Select } from "@/components/ui/Input";
import MoreMenu from "@/components/ui/MoreMenu";
import { useFeel } from "@/components/FeelProvider";
import SplitPanel from "@/components/tender/wbs/SplitPanel";
import UnassignedList, { type UnassignedEntry } from "@/components/tender/wbs/UnassignedList";
import s from "@/components/tender/wbs/Wbs.module.css";
import { asTreeItem, lineMemberships, type AllocationView, type WbsRow } from "@/lib/contractProjects/allocation";
import { money } from "@/lib/contractProjects/format";
import { PROJECT_TIPS } from "@/lib/contractProjects/tips";
import type { AllocationBasis, BudgetLine, RevisionStatus, WorkPackageRow } from "@/lib/contractProjects/types";
import type { EmployeeChoice } from "@/lib/contractProjects/workPackagesServer";
import { leafItems, trimPct, visibleItems } from "@/lib/wbs/screen";
import { partsOf } from "@/lib/wbs/tree";
import { WBS_PENDING, WBS_TIPS } from "@/lib/wbs/tips";
import WbsItemPanel from "./WbsItemPanel";

// The WBS tab of a contract project (docs/design/wbs.md section 3c): the tree the project took over from the tender, with who owns each item,
// what it holds and what is allocated, the lines in no item, and the split of a line across items. The project owns its own copy: a change here
// never touches the tender. Structure and owners stay editable after the baseline is approved; the money does not (the amber line says so).

type Panel = { pkg: WorkPackageRow | null; parentId?: string | null } | null;
const foldKey = (projectId: string) => `cpwbs-fold:${projectId}`;
type Fold = { closed: string[]; open: string[] };
function readFold(projectId: string): Fold {
  try {
    const raw = JSON.parse(window.localStorage.getItem(foldKey(projectId)) ?? "null") as Partial<Fold> | null;
    return { closed: Array.isArray(raw?.closed) ? raw!.closed!.filter((x) => typeof x === "string") : [], open: Array.isArray(raw?.open) ? raw!.open!.filter((x) => typeof x === "string") : [] };
  } catch { return { closed: [], open: [] }; }
}

export default function WbsTab({ projectId, basis, revisionStatus, projectClosed, packages, rows, unassigned, lines, employees, currency, canEdit, pending, treePending, fromTender }: {
  projectId: string;
  basis: AllocationBasis;
  revisionStatus: RevisionStatus | null;
  projectClosed: boolean;
  packages: WorkPackageRow[];
  rows: WbsRow[];
  unassigned: AllocationView["unassigned"];
  lines: BudgetLine[];
  employees: EmployeeChoice[];
  currency: string | null;
  canEdit: boolean;
  /** Migration 0240 is not applied: there is no WBS to read or make. */
  pending: boolean;
  /** Migration 0243 is not applied: the WBS is a flat list and cannot be split. */
  treePending: boolean;
  /** The project was made from a tender (so an empty WBS means the tender had none). */
  fromTender: boolean;
}) {
  const router = useRouter();
  const { confirm } = useFeel();
  const [panel, setPanel] = useState<Panel>(null);
  const [splitFor, setSplitFor] = useState<string | null>(null);
  const [owner, setOwner] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState("");
  const [fold, setFold] = useState<Fold>({ closed: [], open: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => { setFold(readFold(projectId)); }, [projectId]);

  const flip = (id: string, kind: "closed" | "open") => setFold((f) => {
    const next = { ...f, [kind]: f[kind].includes(id) ? f[kind].filter((x) => x !== id) : [...f[kind], id] };
    try { window.localStorage.setItem(foldKey(projectId), JSON.stringify(next)); } catch { /* remembering is a convenience */ }
    return next;
  });

  const items = useMemo(() => packages.map(asTreeItem), [packages]);
  const memberships = useMemo(() => lineMemberships(packages), [packages]);
  const lineByKey = useMemo(() => new Map(lines.map((l) => [l.line_key, l])), [lines]);
  const byId = useMemo(() => new Map(packages.map((p) => [p.id, p])), [packages]);
  const visible = useMemo(() => visibleItems(items, new Set(fold.closed)), [items, fold.closed]);
  const rowById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const loginOf = useMemo(() => new Map(employees.map((e) => [e.id, e.has_login])), [employees]);
  const owners = [...new Map(packages.filter((p) => p.owner_employee_id).map((p) => [p.owner_employee_id as string, p.owner_name ?? "Owner"])).entries()];
  const keep = owner ? new Set(packages.filter((p) => p.owner_employee_id === owner).map((p) => p.id)) : null;
  const shownRows = visible.filter((r) => !keep || keep.has(r.id));

  const editable = canEdit && !projectClosed;
  const linesLocked = basis === "package" && revisionStatus !== null && revisionStatus !== "draft" ? "Allocation locked: baseline approved. Structure and owners can still change." : null;
  const lockWords = projectClosed ? "This project is closed" : !canEdit ? "You can view this project but not change it" : null;
  const withoutOwner = packages.filter((p) => !p.owner_employee_id && !packages.some((k) => k.parent_id === p.id)).length;

  const entries: UnassignedEntry[] = unassigned.map((u) => {
    const l = lineByKey.get(u.line_key) as BudgetLine;
    return { remainder: u.remainder_pct, split: u.split, line: { id: l.line_key, item_no: l.wbs, row_no: l.line_no, description: l.description, uom: l.unit, qty: l.qty, amount: l.client_amount ?? 0, priced: l.client_amount !== null, removed: false, wbs_item_id: null, wbs_parts: [] } };
  });

  function heldBy(id: string) {
    return [...memberships].flatMap(([key, m]) => {
      const mine = partsOf(m).find((x) => x.wbs_item_id === id);
      const l = lineByKey.get(key);
      return mine && l ? [{ line: l, share: mine.share_pct, split: m.parts.length > 0 }] : [];
    });
  }

  async function call(url: string, method: string, body?: unknown): Promise<{ ok: boolean; j: Record<string, unknown> }> {
    setBusy(true); setError(""); setNotice("");
    try {
      const res = await fetch(url, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) { setError(typeof j.error === "string" ? j.error : "Could not save"); return { ok: false, j }; }
      return { ok: true, j };
    } catch { setError("Network error. Try again."); return { ok: false, j: {} }; } finally { setBusy(false); }
  }

  async function renumber() {
    if (!(await confirm({ title: "Renumber the WBS?", body: "Codes you typed are kept; the rest are recomputed.", confirmLabel: "Renumber" }))) return;
    const out = await call(`/api/contract-projects/${projectId}/work-packages/renumber`, "POST", {});
    if (out.ok) { setNotice(out.j.changed ? `${out.j.changed} code${out.j.changed === 1 ? "" : "s"} renumbered` : "The codes were already in order"); router.refresh(); }
  }

  async function remove(p: WorkPackageRow) {
    const whole = p.line_keys.length, shared = (p.line_parts ?? []).length, kids = packages.filter((k) => k.parent_id === p.id).length;
    const body = [
      whole > 0 ? `Its ${whole} line${whole === 1 ? "" : "s"} move to Unassigned.` : "",
      shared > 0 ? `${shared} share${shared === 1 ? "" : "s"} of split lines become${shared === 1 ? "s" : ""} an unassigned remainder.` : "",
      kids > 0 ? "Sub-items move up one level." : "",
    ].filter(Boolean).join(" ");
    if (!(await confirm({ title: `Remove ${p.code} ${p.name}?`, body: body || "Nothing is in it.", confirmLabel: "Remove", tone: "danger" }))) return;
    const out = await call(`/api/contract-projects/${projectId}/work-packages/${p.id}`, "DELETE");
    if (out.ok) { setNotice(`WBS ${p.code} removed`); router.refresh(); }
  }

  async function group() {
    if (!target || picked.size === 0) return;
    const out = await call(`/api/contract-projects/${projectId}/work-packages/assign`, "PUT", { line_keys: [...picked], package_id: target });
    if (out.ok) { setNotice(`${out.j.assigned} line${out.j.assigned === 1 ? "" : "s"} put in WBS ${byId.get(target)?.code ?? ""}`); setPicked(new Set()); router.refresh(); }
  }

  const splitLine = splitFor ? lineByKey.get(splitFor) ?? null : null;
  const splitMember = splitFor ? memberships.get(splitFor) : undefined;

  return (
    <div data-guide="cp.wbs" style={{ display: "flex", flexDirection: "column", gap: 12 }} className="bpm-tap">
      <span className="bpm-label-row"><h2 className="bpm-t-section">WBS</h2><InfoTip label="WBS">{PROJECT_TIPS.workBreakdown}</InfoTip></span>

      {pending ? (
        <div role="alert" data-guide="cp.wbs.pending" style={{ fontSize: 13, color: "var(--amberink)" }}>The WBS needs a database update (migration 0240). Ask your administrator to apply it.</div>
      ) : (
        <>
          {treePending && <div role="alert" data-guide="cp.wbs.tree_pending" style={{ fontSize: 13, color: "var(--amberink)" }}>{WBS_PENDING}</div>}
          {linesLocked && <div role="status" data-guide="cp.wbs.locked" style={{ fontSize: 13, color: "var(--amberink)" }}>{linesLocked}<InfoTip label="Locked">{WBS_TIPS.locked}</InfoTip></div>}
          {lockWords && <div role="status" style={{ fontSize: 13, color: c.muted }}>{lockWords}</div>}
          <div className={s.tools} data-guide="cp.wbs.tools">
            {editable && <Button variant="primary" data-guide="cp.wbs.add" disabled={busy} style={{ minHeight: 44 }} onClick={() => setPanel({ pkg: null })}>New WBS item</Button>}
            {editable && packages.length > 0 && !treePending && <Button variant="secondary" data-guide="cp.wbs.renumber" disabled={busy} style={{ minHeight: 44 }} onClick={() => void renumber()}>Renumber</Button>}
            <InfoTip label="WBS codes">{WBS_TIPS.code}</InfoTip>
            {owners.length > 1 && (
              <span data-guide="cp.wbs.filter" role="group" aria-label="Owner" style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", marginLeft: "auto" }}>
                <Button variant={owner === "" ? "primary" : "secondary"} size="sm" aria-pressed={owner === ""} style={{ minHeight: 44 }} onClick={() => setOwner("")}>All</Button>
                {owners.map(([id, name]) => <Button key={id} variant={owner === id ? "primary" : "secondary"} size="sm" aria-pressed={owner === id} style={{ minHeight: 44 }} onClick={() => setOwner(id)}>{name}</Button>)}
              </span>
            )}
          </div>
          {withoutOwner > 0 && packages.length > 0 && <div role="status" data-guide="cp.wbs.no_owners" style={{ fontSize: 13, color: "var(--amberink)" }}>{withoutOwner} WBS item{withoutOwner === 1 ? "" : "s"} without an owner</div>}

          {packages.length === 0 ? (
            <Card>
              <div data-guide="cp.wbs.empty" style={{ fontSize: 13, color: c.ink }}>
                {fromTender ? "No WBS was copied from the tender. Add the first item." : editable ? "No WBS yet. Add the first item." : "No WBS yet."}
              </div>
            </Card>
          ) : (
            <ul className={s.tree} role="tree" aria-label="WBS" data-guide="cp.wbs.tree">
              <li className={s.treeHead} aria-hidden="true"><span>Item</span><span>Owner</span><span style={{ textAlign: "right" }}>Lines</span><span style={{ textAlign: "right" }}>Client amount</span><span style={{ textAlign: "right" }}>Allocated</span><span /></li>
              {shownRows.map((r) => {
                const row = rowById.get(r.id) as WbsRow;
                const p = byId.get(r.id) as WorkPackageRow;
                const held = r.is_leaf ? heldBy(r.id) : [];
                const expandable = !r.is_leaf || held.length > 0;
                const open = r.is_leaf ? fold.open.includes(r.id) : !fold.closed.includes(r.id);
                const noLogin = !!p.owner_employee_id && loginOf.has(p.owner_employee_id) && loginOf.get(p.owner_employee_id) === false;
                return (
                  <li key={r.id} role="treeitem" aria-level={r.depth} aria-expanded={expandable ? open : undefined} data-guide="cp.wbs.item">
                    <div className={s.row}>
                      <div className={`${s.nameCell} ${s.cName}`} style={{ paddingLeft: (r.depth - 1) * 20 }}>
                        {expandable ? <button type="button" className={s.toggle} aria-label={`${open ? "Fold" : "Unfold"} ${r.code} ${r.name}`} aria-expanded={open} onClick={() => flip(r.id, r.is_leaf ? "open" : "closed")}>{open ? "▾" : "▸"}</button> : <span className={s.spacer} aria-hidden="true" />}
                        <button type="button" className={s.code} style={{ background: "transparent", border: 0, padding: 0, minHeight: 44, color: "inherit", font: "inherit", fontWeight: 700, cursor: "pointer" }} data-guide="cp.wbs.open" onClick={() => setPanel({ pkg: p })}>{r.code}</button>
                        <span className={s.name}>{r.name}</span>
                      </div>
                      <div className={`${s.cOwner} ${s.muted}`}>
                        <span className={s.label}>Owner</span>
                        <span>{p.owner_name ?? "No owner"}{noLogin && <span data-guide="cp.wbs.no_login" style={{ color: "var(--amberink)" }}> · no login</span>}</span>
                      </div>
                      <div className={`${s.cLines} ${s.num}`}><span className={s.label}>Lines</span><span>{row.rolled.line_count === 0 ? "–" : r.is_leaf && row.shared_count > 0 ? `${row.line_count} (${row.shared_count} shared)` : row.rolled.line_count}</span></div>
                      <div className={`${s.cClient} ${s.num}`}><span className={s.label}>Client amount</span><span style={{ color: r.is_leaf ? c.ink : c.muted }}>{row.rolled.client_amount === null ? "–" : money(row.rolled.client_amount, currency, 2)}</span></div>
                      <div className={`${s.cCost} ${s.num} ${s.muted}`}><span className={s.label}>Allocated</span><span>{row.rolled.allocated > 0 ? money(row.rolled.allocated, null, 2) : "–"}</span></div>
                      <div className={`${s.cActions} bpm-tap`}>
                        <MoreMenu label={`Actions for ${r.code}`} items={[
                          { label: editable ? "Edit" : "Open", onSelect: () => setPanel({ pkg: p }) },
                          { label: "Add sub-item", onSelect: () => setPanel({ pkg: null, parentId: r.id }), hidden: !editable || r.depth >= 3 || treePending },
                          { label: "Remove", onSelect: () => void remove(p), danger: true, hidden: !editable },
                        ]} />
                      </div>
                    </div>
                    {r.is_leaf && open && held.length > 0 && (
                      <ul className={s.itemLines} data-guide="cp.wbs.lines_list">
                        {held.map(({ line, share, split }) => (
                          <li key={line.line_key} className={s.itemLine} data-guide="cp.wbs.line">
                            <b>{line.wbs ?? `#${line.line_no}`}</b>
                            <span>{line.description}</span>
                            <span className={s.muted}>{split ? `${trimPct(share)} % of ${line.qty.toLocaleString("en-US", { maximumFractionDigits: 3 })}${line.unit ? ` ${line.unit}` : ""}` : `${line.qty.toLocaleString("en-US", { maximumFractionDigits: 3 })}${line.unit ? ` ${line.unit}` : ""}`}{line.client_amount !== null ? ` · ${money((line.client_amount * share) / 100, currency, 2)}` : ""}</span>
                            {editable && !treePending && <Button variant="quiet" style={{ minHeight: 44 }} data-guide="cp.wbs.split" onClick={() => setSplitFor(line.line_key)}>{split ? "Edit split" : "Split"}</Button>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <UnassignedList entries={entries} selected={picked} canEdit={editable && !linesLocked && !treePending} onToggle={(k) => setPicked((cur) => { const n = new Set(cur); if (n.has(k)) n.delete(k); else n.add(k); return n; })} onSplit={(k) => setSplitFor(k)} onOpenLine={() => undefined} />
          {picked.size > 0 && editable && (
            <div className={s.bar} data-guide="cp.wbs.group_bar" data-sticky="1" role="region" aria-label="Selected lines">
              <span className={s.barCount}>{picked.size} selected</span>
              <Select aria-label="Put the selected lines in" value={target} onChange={(e) => setTarget(e.target.value)} style={{ minHeight: 44, width: "auto", maxWidth: "100%" }} data-guide="cp.wbs.group_target">
                <option value="">Choose a WBS item</option>
                {leafItems(items).map((l) => <option key={l.id} value={l.id}>{l.code} {l.name}</option>)}
              </Select>
              <Button variant="primary" loading={busy} disabled={!target} onClick={() => void group()} style={{ minHeight: 44 }} data-guide="cp.wbs.group">Group into WBS</Button>
              <InfoTip label="Group into WBS">{WBS_TIPS.group}</InfoTip>
              <span className={s.grow} />
              <Button variant="quiet" onClick={() => setPicked(new Set())} style={{ minHeight: 44 }}>Clear</Button>
            </div>
          )}
        </>
      )}

      {error && <div role="alert" style={{ fontSize: 13, color: "var(--err-ink)" }}>{error}</div>}
      {notice && !error && <div role="status" style={{ fontSize: 13, color: pillar.teal.fg }}>{notice}</div>}

      {panel && (
        <WbsItemPanel
          key={panel.pkg?.id ?? `new-${panel.parentId ?? "root"}`} projectId={projectId} pkg={panel.pkg} parentId={panel.parentId} packages={packages} lines={lines} employees={employees}
          locked={lockWords} linesLocked={linesLocked ?? (treePending ? WBS_PENDING : null)} basis={basis} onClose={() => setPanel(null)}
          onSaved={() => { setPanel(null); router.refresh(); }} onEditSplit={treePending ? undefined : (k) => { setPanel(null); setSplitFor(k); }}
        />
      )}
      {splitLine && (
        <SplitPanel
          key={splitLine.line_key} base={`/api/contract-projects/${projectId}/work-packages`} idKey="line_key" itemKey="package_id" allowNew={false}
          line={{ id: splitLine.line_key, item_no: splitLine.wbs, row_no: splitLine.line_no, description: splitLine.description, uom: splitLine.unit, qty: splitLine.qty, amount: splitLine.client_amount ?? 0, priced: splitLine.client_amount !== null, wbs_item_id: splitMember?.wbs_item_id ?? null, wbs_parts: splitMember?.parts ?? [] }}
          items={items} locked={linesLocked} onClose={() => setSplitFor(null)} onError={(m) => setError(m)}
          onDone={(n) => { setSplitFor(null); setNotice(n); router.refresh(); }}
        />
      )}
    </div>
  );
}
