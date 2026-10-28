"use client";

import { useState } from "react";
import Link from "next/link";
import Button from "@/components/ui/Button";
import SidePanel from "@/components/ui/SidePanel";
import Tabs from "@/components/ui/Tabs";
import { useUrlTab } from "@/components/ui/useUrlTab";
import { Input, Select } from "@/components/ui/Input";
import { CheckOpt, Opt } from "@/components/ui/Opt";
import InfoTip from "@/components/ui/InfoTip";
import { useTenantFeature } from "@/lib/tenant-context";
import { Notice, Segmented, Switch } from "../middleware/ui";
import s from "./people.module.css";
import { PEOPLE_TIPS } from "./tips";
import {
  STATUS_WORD, draftFromPerson, employeeLabel, employeeName, passwordProblem, personDirty, planLockToggle, planPasswordReset, planPersonSave, roleSummary,
  type EmployeeLite, type Person, type PersonDraft, type RoleView,
} from "./logic";
import { run } from "./api";
import ChangesSection from "./ChangesSection";
import type { SignInDetails } from "./CredentialsNotice";

type Busy = "save" | "lock" | "reset" | null;

/**
 * One person, laid out like a business user in C4C: the actions at the top (Lock or Unlock, Reset password, Remove), then
 * the sections: Access rights (role and Business Roles), Validity (dates and seat) and Changes (this login's history).
 * A section strip appears only when there is more than one section to show.
 */
export default function PersonPanel({ person, roles, businessRoles, employees, onClose, onSaved, onRemove }: {
  person: Person;
  roles: readonly RoleView[];
  businessRoles: boolean;
  employees: readonly EmployeeLite[];
  onClose: () => void;
  onSaved: (text: string, credentials?: SignInDetails | null) => void;
  onRemove: (p: Person) => void;
}) {
  const login = person.login;
  const hasHistory = useTenantFeature("change_history");
  const sections = [{ id: "access", label: "Access rights" }, ...(login ? [{ id: "validity", label: "Validity" }] : []), ...(hasHistory ? [{ id: "changes", label: "Changes" }] : [])];
  const [tab, setTab] = useUrlTab(sections.map((x) => x.id), "ptab");

  const [draft, setDraft] = useState<PersonDraft>(() => draftFromPerson(person));
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const set = (patch: Partial<PersonDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const linked = login?.employee_id ? employees.find((e) => e.id === login.employee_id) : undefined;
  const dirty = personDirty(person, draft);
  const locked = !!login?.is_locked;

  async function attempt(kind: Exclude<Busy, null>, fn: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong."); setBusy(null); }
  }

  const save = () => attempt("save", async () => {
    for (const call of planPersonSave(person, draft)) await run(call);
    onSaved("Saved");
  });

  const toggleLock = () => attempt("lock", async () => {
    await run(planLockToggle(person));
    onSaved(locked ? `${person.name} unlocked` : `${person.name} locked`);
  });

  const resetPassword = () => attempt("reset", async () => {
    const problem = passwordProblem(newPassword);
    if (!newPassword || problem) throw new Error(problem ?? "Enter a new password.");
    await run(planPasswordReset(person, newPassword));
    onSaved("Password reset. Share the new sign-in details below.", person.email ? { email: person.email, password: newPassword } : null);
  });

  const toggleRole = (id: string) => set({ roleIds: draft.roleIds.includes(id) ? draft.roleIds.filter((x) => x !== id) : [...draft.roleIds, id] });
  const pwProblem = passwordProblem(newPassword);

  return (
    <SidePanel
      title={person.name}
      subtitle={
        <>
          {person.email}
          {linked ? <> · <Link href={`/wfm/employees/${linked.id}`}>{employeeName(linked)}</Link></> : null}
          {login && person.status !== "active" ? <> · {STATUS_WORD[person.status]}</> : null}
        </>
      }
      onClose={onClose}
      footer={
        <>
          {error && <span role="alert" className={`${s.issue} ${s.footIssue}`}>{error}</span>}
          {tab !== "changes" && <Button variant="primary" onClick={() => void save()} loading={busy === "save"} disabled={!dirty || busy !== null}>Save</Button>}
        </>
      }
    >
      <div className={s.stack}>
        <div className={s.actions}>
          {login && <Button size="sm" onClick={() => void toggleLock()} loading={busy === "lock"} disabled={busy !== null}>{locked ? "Unlock" : "Lock"}</Button>}
          {login && <Button size="sm" aria-expanded={resetOpen} onClick={() => setResetOpen((o) => !o)} disabled={busy !== null}>Reset password</Button>}
          <Button size="sm" variant="danger" onClick={() => onRemove(person)} disabled={busy !== null}>Remove</Button>
        </div>

        {login && resetOpen && (
          <div className={s.resetRow}>
            <Opt label="New password" info={PEOPLE_TIPS.password} htmlFor="pp-pw">
              <Input id="pp-pw" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} invalid={!!pwProblem} />
            </Opt>
            <Button variant="primary" size="sm" onClick={() => void resetPassword()} loading={busy === "reset"} disabled={!newPassword || !!pwProblem || busy !== null}>Set password</Button>
          </div>
        )}
        {pwProblem && <Notice tone="warn">{pwProblem}</Notice>}

        {sections.length > 1 && <Tabs label="Sections" tabs={sections} value={tab} onChange={setTab} />}

        {tab === "access" && (
          <>
            <Opt label="Role" info={PEOPLE_TIPS.role}>
              <Segmented label="Role" value={draft.role} options={[{ id: "member", label: "Member" }, { id: "admin", label: "Admin" }]} onChange={(role) => set({ role })} />
            </Opt>
            {businessRoles && draft.role === "member" && (
              <Opt label="Business roles" info={PEOPLE_TIPS.businessRoles}>
                {roles.length === 0 ? (
                  <span className={`${s.small} ${s.muted}`}>No roles yet. Create one in the Roles tab.</span>
                ) : (
                  <div className={s.checklist} role="group" aria-label="Business roles">
                    {roles.map((r) => (
                      <div key={r.id} className={s.checkRow}>
                        <CheckOpt label={r.name} checked={draft.roleIds.includes(r.id)} onChange={() => toggleRole(r.id)} />
                        <span className={`${s.small} ${s.muted}`}>{roleSummary(r.grants)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Opt>
            )}
          </>
        )}

        {tab === "validity" && login && (
          <>
            <div className={s.fields}>
              <Opt label="Valid from" info={PEOPLE_TIPS.validity} htmlFor="pp-from">
                <Input id="pp-from" type="date" value={draft.validFrom} onChange={(e) => set({ validFrom: e.target.value })} />
              </Opt>
              <Opt label="Valid to" htmlFor="pp-to">
                <Input id="pp-to" type="date" value={draft.validTo} onChange={(e) => set({ validTo: e.target.value })} />
              </Opt>
            </div>
            <div className={s.switchRow}>
              <SwitchLabel label="Counted user" info={PEOPLE_TIPS.counted} />
              <Switch checked={draft.counted} label="Counted user" onChange={(counted) => set({ counted })} />
            </div>
            <details className={s.more}>
              <summary>More</summary>
              <div className={s.moreBody}>
                <Opt label="Display name" htmlFor="pp-name">
                  <Input id="pp-name" value={draft.displayName} onChange={(e) => set({ displayName: e.target.value })} />
                </Opt>
                {!login.employee_id && employees.length > 0 && (
                  <Opt label="Employee" info={PEOPLE_TIPS.employee} htmlFor="pp-emp">
                    <Select id="pp-emp" value={draft.employeeId} onChange={(e) => set({ employeeId: e.target.value })}>
                      <option value="">Not linked</option>
                      {employees.map((e) => <option key={e.id} value={e.id}>{employeeLabel(e)}</option>)}
                    </Select>
                  </Opt>
                )}
              </div>
            </details>
          </>
        )}

        {tab === "changes" && (
          <>
            <span className="bpm-label-row">
              <span className="bpm-opt-label">Changes</span>
              <InfoTip label="Changes">{PEOPLE_TIPS.changes}</InfoTip>
            </span>
            <ChangesSection userId={person.userId} />
          </>
        )}
      </div>
    </SidePanel>
  );
}

function SwitchLabel({ label, info }: { label: string; info: string }) {
  return (
    <span className="bpm-label-row">
      <span className="bpm-opt-label">{label}</span>
      <InfoTip label={label}>{info}</InfoTip>
    </span>
  );
}
