"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import SidePanel from "@/components/ui/SidePanel";
import InfoTip from "@/components/ui/InfoTip";
import { Input } from "@/components/ui/Input";
import { CheckOpt, Opt } from "@/components/ui/Opt";
import { WORKCENTERS, WORKCENTER_PARTS } from "@/lib/workcenters";
import { AdaptDrawer } from "@/components/DashboardLayout";
import type { DashLayoutItem, TenantFeatures } from "@/lib/constants";
import s from "./people.module.css";
import { PEOPLE_TIPS } from "./tips";
import { createRole, duplicateRole, resyncRole, saveRoleDashboard, updateRole } from "./api";
import { grantDraftFrom, grantsFromDraft, roleProblem, emptyGrantDraft, type GrantDraft, type RoleFull } from "./logic";

type Action = "can_create" | "can_edit" | "can_delete";
const ACTIONS: { key: Action; label: string }[] = [{ key: "can_create", label: "Create" }, { key: "can_edit", label: "Edit" }, { key: "can_delete", label: "Delete" }];

/**
 * One role: its name and the areas it opens, as one checklist. A standard role is read-only (duplicate it to change
 * it); description and the role's own dashboard sit behind "More".
 */
export default function RolePanel({ role, features, onClose, onChanged, onDelete }: {
  role: RoleFull | null;
  features: TenantFeatures;
  onClose: () => void;
  onChanged: (reopenId?: string) => void;
  onDelete: (r: RoleFull) => void;
}) {
  const readOnly = !!role?.is_standard;
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [draft, setDraft] = useState<GrantDraft>(() => (role ? grantDraftFrom(role.grants) : emptyGrantDraft()));
  const [layout, setLayout] = useState<DashLayoutItem[] | null>(role?.dashboard_layout ?? null);
  const [dashOpen, setDashOpen] = useState(false);
  const [busy, setBusy] = useState<"save" | "dash" | "other" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = (key: string) => setDraft((d) => ({ ...d, [key]: { ...d[key], granted: !d[key].granted } }));
  // A part (Marketing, Intelligence) is granted by granting its keys: this ticks them all, or clears them when all are ticked.
  const togglePart = (keys: string[]) => setDraft((d) => {
    const all = keys.every((k) => d[k].granted);
    return { ...d, ...Object.fromEntries(keys.map((k) => [k, { ...d[k], granted: !all }])) };
  });
  const toggleAct = (key: string, a: Action) => setDraft((d) => ({ ...d, [key]: { ...d[key], [a]: !d[key][a] } }));

  async function attempt(kind: "save" | "other", fn: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong."); } finally { setBusy(null); }
  }

  const save = () => attempt("save", async () => {
    const problem = roleProblem(name);
    if (problem) { setError(problem); return; }
    const input = { name: name.trim(), description: description.trim() || null, grants: grantsFromDraft(draft) };
    if (role) await updateRole(role.id, input); else await createRole(input);
    onChanged();
  });

  const duplicate = () => attempt("other", async () => {
    if (!role) return;
    const copy = await duplicateRole(role.id);
    onChanged(copy.id);
  });

  const sync = () => attempt("other", async () => {
    if (!role) return;
    await resyncRole(role.id);
    onChanged(role.id);
  });

  async function saveDash(next: DashLayoutItem[]) {
    if (!role) return;
    setBusy("dash");
    try { await saveRoleDashboard(role.id, next); setLayout(next); } catch (e) { setError(e instanceof Error ? e.message : "Could not save the dashboard."); } finally { setBusy(null); }
  }

  return (
    <>
      <SidePanel
        title={role?.name ?? "New role"}
        subtitle={readOnly ? "Standard role" : undefined}
        onClose={onClose}
        footer={
          <>
            {role && !readOnly && <Button variant="danger" className={s.pushStart} onClick={() => onDelete(role)} disabled={busy !== null}>Delete</Button>}
            {error && <span role="alert" className={`${s.issue} ${s.footIssue}`}>{error}</span>}
            {role && <Button onClick={() => void duplicate()} loading={busy === "other"} disabled={busy === "save"}>{readOnly ? "Duplicate and edit" : "Duplicate"}</Button>}
            {!readOnly && <Button variant="primary" onClick={() => void save()} loading={busy === "save"}>Save</Button>}
          </>
        }
      >
        <div className={s.stack}>
          {!readOnly && (
            <Opt label="Name" htmlFor="role-name">
              <Input id="role-name" value={name} placeholder="Sales rep" onChange={(e) => setName(e.target.value)} />
            </Opt>
          )}

          <Opt label="Access" info={readOnly ? PEOPLE_TIPS.standardRole : PEOPLE_TIPS.roleAccess}>
            <div className={s.checklist} role="group" aria-label="Areas this role opens">
              {orderedWorkcenters().map((w) => {
                if ("heading" in w) {
                  const all = w.keys.every((k) => draft[k].granted);
                  return (
                    <div key={w.heading} className={s.checkRow} style={{ background: "var(--panel2)" }}>
                      <strong style={{ fontSize: 12.5 }}>{w.heading}</strong>
                      {!readOnly && <button type="button" className="bpm-btn bpm-btn-secondary bpm-btn-sm" onClick={() => togglePart(w.keys)}>{all ? "Clear all" : "Grant all"}</button>}
                    </div>
                  );
                }
                const g = draft[w.key];
                return (
                  <div key={w.key} className={s.checkRow}>
                    <CheckOpt label={w.label} checked={g.granted} disabled={readOnly} onChange={() => toggle(w.key)} />
                    {g.granted && (
                      <span className={s.acts}>
                        {ACTIONS.map((a) => (
                          <label key={a.key}>
                            <input type="checkbox" checked={g[a.key]} disabled={readOnly} onChange={() => toggleAct(w.key, a.key)} />
                            {a.label}
                          </label>
                        ))}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </Opt>

          {readOnly ? (
            <div className={s.bar}>
              <span className="bpm-label-row">
                <span className="bpm-opt-label">Catalog</span>
                <InfoTip label="Catalog">{PEOPLE_TIPS.syncRole}</InfoTip>
              </span>
              <Button size="sm" onClick={() => void sync()} loading={busy === "other"}>Sync with catalog</Button>
            </div>
          ) : (
            <details className={s.more}>
              <summary>More</summary>
              <div className={s.moreBody}>
                <Opt label="Description" htmlFor="role-desc">
                  <Input id="role-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
                </Opt>
                {role ? (
                  <div className={s.bar}>
                    <span className="bpm-label-row">
                      <span className="bpm-opt-label">Default dashboard</span>
                      <InfoTip label="Default dashboard">{PEOPLE_TIPS.roleDashboard}</InfoTip>
                    </span>
                    <Button size="sm" onClick={() => setDashOpen(true)}>{layout && layout.length > 0 ? `Edit (${layout.filter((b) => !b.hidden).length})` : "Set up"}</Button>
                  </div>
                ) : (
                  <span className={`${s.small} ${s.muted}`}>Save the role first to set its dashboard.</span>
                )}
              </div>
            </details>
          )}
        </div>
      </SidePanel>

      {dashOpen && role && (
        <AdaptDrawer
          layout={layout ?? []}
          features={features}
          onLayoutChange={saveDash}
          onClose={() => setDashOpen(false)}
          saving={busy === "dash"}
          title={`Dashboard: ${role.name}`}
          subtitle="Seen by everyone holding this role"
          onReset={layout && layout.length > 0 ? () => void saveDash([]) : undefined}
          resetLabel="Clear this role's dashboard"
        />
      )}
    </>
  );
}

/** The workcenter list with Marketing and Intelligence gathered under their own headings; every key appears exactly once. */
function orderedWorkcenters(): ({ key: string; label: string } | { heading: string; keys: string[] })[] {
  const inPart = new Set<string>(WORKCENTER_PARTS.flatMap((p) => p.keys));
  const out: ({ key: string; label: string } | { heading: string; keys: string[] })[] = WORKCENTERS.filter((w) => !inPart.has(w.key));
  for (const part of WORKCENTER_PARTS) {
    out.push({ heading: part.label, keys: part.keys });
    for (const k of part.keys) { const w = WORKCENTERS.find((x) => x.key === k); if (w) out.push(w); }
  }
  return out;
}
