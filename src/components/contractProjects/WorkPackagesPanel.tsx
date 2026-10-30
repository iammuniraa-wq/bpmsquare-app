"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { c, pillar } from "@/lib/theme";
import Button from "@/components/ui/Button";
import SettingsSection from "@/components/settings/SettingsSection";
import type { AllocationView } from "@/lib/contractProjects/allocation";
import { money } from "@/lib/contractProjects/format";
import { PROJECT_TIPS } from "@/lib/contractProjects/tips";
import type { AllocationBasis, BudgetLine, WorkPackageRow } from "@/lib/contractProjects/types";
import type { EmployeeChoice } from "@/lib/contractProjects/workPackagesServer";
import WorkPackagePanel from "./WorkPackagePanel";

const SHOWN = 5;

/**
 * The work breakdown (WBS) of a project: its work packages, who owns each, which BOQ lines each holds and the lines that are in none. Folded
 * away while the project is allocated by BOQ line (the packages are optional there) and open when it is allocated by package. An owner sees
 * their packages with the Owner chips. Opens a side panel to add or change a package.
 */
export default function WorkPackagesPanel({ projectId, basis, packages, unassigned, lines, employees, currency, canEdit, lockedReason, pending, rows, open, onOpen }: {
  projectId: string;
  basis: AllocationBasis;
  packages: WorkPackageRow[];
  unassigned: AllocationView["unassigned"];
  lines: BudgetLine[];
  employees: EmployeeChoice[];
  currency: string | null;
  canEdit: boolean;
  /** Why the packages cannot change now, or null. */
  lockedReason: string | null;
  pending: boolean;
  rows: AllocationView["packageRows"];
  /** The package being looked at, "new" for a new one: held by the screen so a row of the allocation table can open it too. */
  open: WorkPackageRow | "new" | null;
  onOpen: (p: WorkPackageRow | "new" | null) => void;
}) {
  const router = useRouter();
  const [owner, setOwner] = useState<string>("");
  const owners = [...new Map(packages.filter((p) => p.owner_employee_id).map((p) => [p.owner_employee_id as string, p.owner_name ?? "Owner"])).entries()];
  const shown = owner ? packages.filter((p) => p.owner_employee_id === owner) : packages;
  const figures = new Map(rows.map((r) => [r.id, r]));
  const itemOf = (p: WorkPackageRow) => p.line_keys.map((k) => lines.find((l) => l.line_key === k)).filter((l): l is BudgetLine => !!l).map((l) => l.wbs ?? l.description);
  const rest = unassigned.length - SHOWN;

  return (
    <>
    <SettingsSection
      id="cp.wbs" title="Work breakdown (WBS)" info={PROJECT_TIPS.workBreakdown} defaultOpen={basis === "package"}
      summary={pending ? "Needs a database update" : `${packages.length} package${packages.length === 1 ? "" : "s"} · ${unassigned.length === 0 ? "no unassigned lines" : `${unassigned.length} unassigned`}`}
    >
      <div data-guide="cp.wbs" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {pending ? (
          <div role="alert" data-guide="cp.wbs.pending" style={{ fontSize: 13, color: "var(--amberink)" }}>Work packages need a database update (migration 0240). Ask your administrator to apply it.</div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {canEdit && <Button variant="secondary" data-guide="cp.wbs.add" disabled={!!lockedReason} style={{ minHeight: 44 }} onClick={() => onOpen("new")}>New work package</Button>}
              {lockedReason && <span role="status" style={{ fontSize: 13, color: "var(--amberink)" }}>{lockedReason}</span>}
              {owners.length > 1 && (
                <span data-guide="cp.wbs.filter" role="group" aria-label="Owner" style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", marginLeft: "auto" }}>
                  <Button variant={owner === "" ? "primary" : "secondary"} size="sm" aria-pressed={owner === ""} style={{ minHeight: 44 }} onClick={() => setOwner("")}>All</Button>
                  {owners.map(([id, name]) => <Button key={id} variant={owner === id ? "primary" : "secondary"} size="sm" aria-pressed={owner === id} style={{ minHeight: 44 }} onClick={() => setOwner(id)}>{name}</Button>)}
                </span>
              )}
            </div>
            {packages.length === 0 ? (
              <div style={{ fontSize: 13, color: c.hint }}>{canEdit ? "No work packages yet. Add one and put BOQ lines in it." : "No work packages yet."}</div>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
                {shown.map((p) => {
                  const items = itemOf(p);
                  return (
                    <li key={p.id}>
                      <button
                        type="button" data-guide="cp.wbs.open" onClick={() => onOpen(p)}
                        style={{ all: "unset", boxSizing: "border-box", width: "100%", minHeight: 64, padding: "8px 12px", border: `1px solid ${c.line}`, borderRadius: 10, cursor: "pointer", display: "flex", flexDirection: "column", gap: 2 }}
                      >
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: c.ink }}>{p.code} {p.name}</span>
                        <span style={{ fontSize: 12.5, color: c.muted }}>{p.owner_name ?? "No owner"}</span>
                        <span style={{ fontSize: 12.5, color: c.hint, overflowWrap: "anywhere" }}>
                          {items.length === 0 ? "No lines" : `${items.slice(0, SHOWN).join(", ")}${items.length > SHOWN ? ` +${items.length - SHOWN}` : ""}`}
                          {basis === "package" && figures.get(p.id)?.allocated_cost != null ? ` · allocated ${money(figures.get(p.id)?.allocated_cost ?? 0, currency)}` : ""}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div data-guide="cp.wbs.unassigned" role="status" style={{ fontSize: 13, color: unassigned.length === 0 ? c.muted : pillar.amber.fg, fontWeight: unassigned.length === 0 ? 400 : 600 }}>
              {unassigned.length === 0 ? "Unassigned lines: none" : `Unassigned lines: ${unassigned.length} (${unassigned.slice(0, SHOWN).map((u) => u.item ?? u.description).join(", ")}${rest > 0 ? ` +${rest}` : ""})`}
            </div>
          </>
        )}
      </div>
    </SettingsSection>
    {open && (
      <WorkPackagePanel
        projectId={projectId} pkg={open === "new" ? null : open} packages={packages} lines={lines} employees={employees}
        locked={!canEdit ? "You can view this project but not change it" : lockedReason} onClose={() => onOpen(null)}
        onSaved={() => { onOpen(null); router.refresh(); }}
      />
    )}
    </>
  );
}
