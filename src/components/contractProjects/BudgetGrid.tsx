"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { c, pillar } from "@/lib/theme";
import Button from "@/components/ui/Button";
import InfoTip from "@/components/ui/InfoTip";
import { Select } from "@/components/ui/Input";
import StatTile, { StatStrip } from "@/components/ui/StatTile";
import SettingsSection from "@/components/settings/SettingsSection";
import { useFeel } from "@/components/FeelProvider";
import { useUnsavedChangesGuard } from "@/lib/unsavedChanges";
import { ROUTES } from "@/lib/constants";
import { marginState, marginView, round2 } from "@/lib/contractProjects/budget";
import type { AllocationView } from "@/lib/contractProjects/allocation";
import { marginTone, money, pct } from "@/lib/contractProjects/format";
import { PROJECT_TIPS } from "@/lib/contractProjects/tips";
import { REVISION_STATUS_LABEL, type AllocationBasis, type BudgetLine, type RevisionRow, type WorkPackageRow } from "@/lib/contractProjects/types";
import type { EmployeeChoice } from "@/lib/contractProjects/workPackagesServer";
import { LinesTable, PackagesTable, type ErpCols } from "./AllocationTable";
import LineDetailsPanel from "./LineDetailsPanel";
import WorkPackagesPanel from "./WorkPackagesPanel";
import { committedFor } from "./buyout/rules";
import type { BuyoutData } from "./buyout/types";
import { useBuyoutSummary } from "./buyout/useBuyoutSummary";

const LEFT_SHOWN = 3;
const num = (v: string | undefined): number | null => (v === undefined || v.trim() === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * The Budget tab: where the budget is ALLOCATED by a person (KAMCO feedback, 2026-10-29). Nothing here is guessed. The person chooses the
 * basis, a cost on each BOQ line or one cost per work package; the contract value less what is allocated is the margin, live as they type.
 * "Fill from tender costs" copies the costs recorded on the tender once. The detail of a line sits in a side panel. Saving writes the
 * revision's allocation through PUT /api/contract-projects/[id]/allocation; the amounts, totals and margin are the server's.
 */
export default function BudgetGrid({
  projectId, revision, revisions, lines, resources, canEdit, projectClosed, currency, buyoutOn = false, initialBuyout,
  contractValue = 0, marginFloor = null, basis = "line", allocation, packages = [], packagesPending = false, employees = [], fillAvailable = false,
}: {
  projectId: string;
  revision: Pick<RevisionRow, "id" | "rev_no" | "status">;
  revisions: Pick<RevisionRow, "id" | "rev_no" | "status">[];
  lines: BudgetLine[];
  resources: { code: string; name: string; revenue_side: boolean }[];
  canEdit: boolean;
  projectClosed: boolean;
  currency: string | null;
  /** The project came from a tender: an Ordered column shows the awarded price of the Buy-out package each line is in. */
  buyoutOn?: boolean;
  /** Lets a server render (and its test) show the column. The page never passes it. */
  initialBuyout?: BuyoutData | null;
  contractValue?: number;
  marginFloor?: number | null;
  basis?: AllocationBasis;
  allocation: AllocationView;
  packages?: WorkPackageRow[];
  packagesPending?: boolean;
  employees?: EmployeeChoice[];
  fillAvailable?: boolean;
}) {
  const router = useRouter();
  const { confirm } = useFeel();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [detail, setDetail] = useState<string | "new" | null>(null);
  const [pkgOpen, setPkgOpen] = useState<WorkPackageRow | "new" | null>(null);
  const editable = canEdit && revision.status === "draft" && !projectClosed;
  const basisLocked = revisions.some((r) => r.status === "approved" || r.status === "pending");

  // What is typed: the allocated cost per line (line mode) or per package (package mode), as the server last saved it.
  const initial = useMemo(() => {
    const t: Record<string, string> = {};
    if (basis === "package") for (const p of allocation.packageRows) t[p.id] = p.allocated_cost === null ? "" : String(p.allocated_cost);
    else for (const l of allocation.lineRows) t[l.line_key] = l.allocated ? String(l.amount) : "";
    return t;
  }, [allocation, basis]);
  const initialKey = JSON.stringify(initial);
  const [typed, setTyped] = useState(initial);
  const [savedKey, setSavedKey] = useState(initialKey);
  useEffect(() => { setTyped(initial); setSavedKey(initialKey); }, [initial, initialKey]);
  const dirty = JSON.stringify(typed) !== savedKey;
  useUnsavedChangesGuard(dirty, { body: "The allocation has unsaved edits. If you leave now they will be lost." });

  // The margin moves with every keystroke: the same arithmetic the server does on save.
  const live = useMemo(() => {
    const values = Object.values(typed).map(num).filter((v): v is number => v !== null);
    const total = round2(values.reduce((s, v) => s + v, 0));
    return { total, count: values.length, of: Object.keys(typed).length, margin: marginView(contractValue, { total, allocatedCount: values.length }, marginFloor) };
  }, [typed, contractValue, marginFloor]);
  const over = contractValue > 0 && live.total > contractValue;
  const state = marginState(live.margin.pct, marginFloor);

  // Ordered / Spent: the awarded price of the Buy-out package a line is in, and the cost the ERP booked. Left out until there is one.
  const buyout = useBuyoutSummary(projectId, buyoutOn, initialBuyout);
  const bought = buyout?.committed_by_line ?? null;
  const erp = useMemo(() => {
    const rows: Record<string, ErpCols> = {};
    for (const l of lines) rows[l.line_key] = { ordered: l.committed ?? committedFor(bought, { id: l.id, line_key: l.line_key }), spent: l.actual };
    const ordered = lines.some((l) => l.committed !== null) || (!!bought && Object.keys(bought).length > 0);
    return { rows, ordered, spent: lines.some((l) => l.actual !== null) };
  }, [lines, bought]);

  function type(key: string, value: string) { setTyped((t) => ({ ...t, [key]: value })); }

  function save() {
    setError(""); setNotice("");
    startTransition(async () => {
      const body = basis === "package"
        ? { revision_id: revision.id, packages: allocation.packageRows.map((p) => ({ id: p.id, allocated_cost: num(typed[p.id]) })) }
        : { revision_id: revision.id, basis_rows: allocation.lineRows.map((l) => ({ line_key: l.line_key, amount: num(typed[l.line_key]) })) };
      const res = await fetch(`/api/contract-projects/${projectId}/allocation`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "Could not save the allocation"); return; }
      setSavedKey(JSON.stringify(typed));
      setNotice("Allocation saved");
      router.refresh();
    });
  }

  async function switchBasis(next: AllocationBasis) {
    if (next === basis || !editable || basisLocked) return;
    if (dirty && !(await confirm({ title: "Discard what you typed?", body: "The allocation has unsaved edits.", confirmLabel: "Discard" }))) return;
    const label = next === "package" ? "work package" : "BOQ line";
    if (!(await confirm({ title: `Switch to allocating by ${label}?`, body: "Typed costs are cleared. Your package grouping is kept.", confirmLabel: "Switch" }))) return;
    setError(""); setNotice("");
    const res = await fetch(`/api/contract-projects/${projectId}/allocation/basis`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ basis: next }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setError(j.error ?? "Could not switch"); return; }
    router.refresh();
  }

  async function fill() {
    if (dirty) { setError("Save the allocation first, then fill from the tender."); return; }
    const anything = live.count > 0;
    if (anything && !(await confirm({ title: "Replace what you typed?", body: "Costs already allocated are replaced by the costs recorded on the tender.", confirmLabel: "Replace" }))) return;
    setError(""); setNotice("");
    startTransition(async () => {
      const res = await fetch(`/api/contract-projects/${projectId}/allocation/fill`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ replace: anything }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "Could not fill from the tender"); return; }
      const skipped = (j.skipped ?? []) as { item: string; reason: string }[];
      const list = skipped.slice(0, LEFT_SHOWN).map((s) => `${s.item} ${s.reason}`).join("; ");
      setNotice(`${j.filled} filled${skipped.length > 0 ? `, ${skipped.length} left: ${list}${skipped.length > LEFT_SHOWN ? `; +${skipped.length - LEFT_SHOWN}` : ""}` : ""}`);
      router.refresh();
    });
  }

  const rowsCount = basis === "package" ? allocation.packageRows.length : allocation.lineRows.length;
  const lockedWords = revision.status === "draft" ? "You can view this budget but not change it" : revision.status === "pending" ? "Locked while it waits for approval" : "Locked";

  return (
    <div data-guide="cp.budget" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <span className="bpm-label-row"><h2 className="bpm-t-section">Budget</h2><InfoTip label="Budget">{PROJECT_TIPS.budgetTab}</InfoTip></span>

      <div data-guide="cp.alloc.toolbar" style={{ display: "flex", alignItems: "center", gap: "8px 12px", flexWrap: "wrap" }}>
        {packagesPending ? (
          <span role="status" data-guide="cp.alloc.pending" style={{ fontSize: 13, color: "var(--amberink)" }}>Work packages need a database update (migration 0240). Ask your administrator to apply it.</span>
        ) : (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, color: c.muted }}>Allocate by <InfoTip label="Allocate by">{PROJECT_TIPS.allocateBy}</InfoTip></span>
            <span role="radiogroup" aria-label="Allocate by" data-guide="cp.alloc.basis" style={{ display: "inline-flex", gap: 6 }}>
              {([["line", "BOQ line"], ["package", "Work package"]] as const).map(([v, label]) => (
                <button
                  key={v} type="button" role="radio" aria-checked={basis === v} disabled={!editable || basisLocked || pending}
                  onClick={() => { void switchBasis(v); }}
                  style={{
                    minHeight: 44, padding: "0 14px", borderRadius: 8, fontSize: 13, fontWeight: basis === v ? 700 : 500, cursor: editable && !basisLocked ? "pointer" : "default",
                    border: `1px solid ${basis === v ? pillar.blue.base : c.line}`, background: basis === v ? pillar.blue.bg : "var(--card-bg)", color: basis === v ? pillar.blue.fg : c.ink,
                  }}
                >
                  {label}
                </button>
              ))}
            </span>
            {basisLocked && <InfoTip label="Locked basis">{PROJECT_TIPS.locked}</InfoTip>}
          </span>
        )}
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: c.muted }}>
          Revision
          <Select aria-label="Revision" data-guide="cp.budget.revision" value={revision.id} style={{ minHeight: 44, width: "auto" }}
            onChange={(e) => router.push(`${ROUTES.contractProject(projectId)}?tab=budget&revision=${e.target.value}`)}>
            {revisions.map((r) => <option key={r.id} value={r.id}>{r.rev_no === 0 ? "Baseline" : `Revision ${r.rev_no}`} · {REVISION_STATUS_LABEL[r.status]}</option>)}
          </Select>
        </label>
        {editable && basis === "line" && <Button variant="secondary" data-guide="cp.budget.add" style={{ minHeight: 44 }} onClick={() => setDetail("new")}>+ Add line</Button>}
        {!editable && !projectClosed && (
          <span data-guide="cp.budget.locked" role="status" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, color: "var(--amberink)" }}>
            {lockedWords}
            <InfoTip label="Locked budget">{PROJECT_TIPS.locked}</InfoTip>
          </span>
        )}
        {projectClosed && <span role="status" style={{ fontSize: 13, color: c.muted }}>This project is closed.</span>}
        {fillAvailable && editable && (
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Button variant="secondary" loading={pending} data-guide="cp.alloc.fill" style={{ minHeight: 44 }} onClick={() => { void fill(); }}>Fill from tender costs</Button>
            <InfoTip label="Fill from tender costs">{PROJECT_TIPS.fill}</InfoTip>
          </span>
        )}
      </div>

      <StatStrip guide="cp.alloc.tiles">
        <StatTile tone="info" label="Contract value" info={PROJECT_TIPS.contractValue} value={money(contractValue, currency)} sub="from the awarded tender" />
        <StatTile tone="neutral" label="Allocated" info={PROJECT_TIPS.allocated} value={money(live.total, currency)} sub={`${live.count} of ${live.of} ${basis === "package" ? "packages" : "lines"}`} />
        <StatTile
          tone={marginTone(live.margin.state)} label="Margin so far" info={PROJECT_TIPS.plannedMargin}
          value={live.margin.state === "none" ? "Not allocated yet" : pct(live.margin.pct)}
          sub={live.margin.state === "none" ? "type a cost" : `${money(live.margin.amount, currency)} left of ${money(contractValue, currency)}`}
        />
      </StatStrip>
      <div role="img" data-guide="cp.alloc.bar" aria-label={`Allocated ${money(live.total, currency)} of contract value ${money(contractValue, currency)}`} style={{ height: 14, borderRadius: 7, background: c.panel2, overflow: "hidden" }}>
        <div style={{ width: `${contractValue > 0 ? Math.min(100, (live.total / contractValue) * 100) : 0}%`, height: "100%", background: over || state === "over" ? pillar.red.base : pillar.blue.base }} />
      </div>

      {rowsCount === 0 && basis === "line" ? (
        <div style={{ fontSize: 13, color: c.hint, padding: "14px 0" }}>{editable ? "No lines yet. Add the first one." : "This budget has no lines."}</div>
      ) : (
        <div style={{ background: "var(--card-bg)", border: "1px solid var(--line)", borderRadius: "var(--card-radius)", overflow: "hidden" }}>
          {basis === "package"
            ? <PackagesTable rows={allocation.packageRows} typed={typed} onType={type} editable={editable} currency={currency} onOpen={(id) => setPkgOpen(packages.find((p) => p.id === id) ?? null)} />
            : <LinesTable rows={allocation.lineRows} typed={typed} onType={type} editable={editable} currency={currency} erp={erp} onOpen={(k) => setDetail(k)} />}
        </div>
      )}

      {basis === "package" && allocation.lineRows.length > 0 && (
        // The lines stay reachable (their resource type and cost code still need a person); their costs follow the packages, so nothing is typed here.
        <SettingsSection id="cp.alloc.lines" title="Lines" summary={`${allocation.lineRows.length} line${allocation.lineRows.length === 1 ? "" : "s"} · costs follow the packages`}>
          <LinesTable
            rows={allocation.lineRows} typed={Object.fromEntries(allocation.lineRows.map((l) => [l.line_key, l.allocated ? String(l.amount) : ""]))} onType={() => undefined}
            editable={false} currency={currency} erp={erp} onOpen={(k) => setDetail(k)}
          />
        </SettingsSection>
      )}

      {allocation.warnings.map((w) => <div key={w} role="status" data-guide="cp.alloc.warning" style={{ fontSize: 13, color: "var(--amberink)" }}>{w}</div>)}
      {(error || notice) && <div role={error ? "alert" : "status"} style={{ fontSize: 13, color: error ? "var(--err-ink)" : "var(--tealink)" }}>{error || notice}</div>}

      <WorkPackagesPanel
        projectId={projectId} basis={basis} packages={packages} unassigned={allocation.unassigned} lines={lines} employees={employees} currency={currency}
        canEdit={canEdit && !projectClosed} lockedReason={revision.status !== "draft" ? lockedWords : null} pending={packagesPending} rows={allocation.packageRows}
        open={pkgOpen} onOpen={setPkgOpen}
      />

      {editable && (
        <div style={{ position: "sticky", bottom: 0, display: "flex", alignItems: "center", gap: 10, padding: "10px 0", background: "var(--bg, transparent)", zIndex: 5 }}>
          <Button variant="primary" loading={pending} disabled={!dirty} data-guide="cp.alloc.save" style={{ minHeight: 44 }} onClick={save}>Save allocation</Button>
          {dirty && <span style={{ fontSize: 12.5, color: c.hint }}>Unsaved changes</span>}
        </div>
      )}

      {detail !== null && (
        <LineDetailsPanel
          projectId={projectId} revisionId={revision.id} lines={lines} lineKey={detail === "new" ? null : detail} resources={resources} currency={currency}
          canEdit={editable} blocked={dirty ? "Save the allocation first, then change the line." : null}
          onClose={() => setDetail(null)} onSaved={() => { setDetail(null); router.refresh(); }}
        />
      )}
    </div>
  );
}
