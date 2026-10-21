"use client";

import { useState } from "react";
import Link from "next/link";
import Button from "@/components/ui/Button";
import SidePanel from "@/components/ui/SidePanel";
import { Input, Select } from "@/components/ui/Input";
import { Opt } from "@/components/ui/Opt";
import InfoTip from "@/components/ui/InfoTip";
import { Notice, Segmented, Switch } from "../middleware/ui";
import s from "./people.module.css";
import { PEOPLE_TIPS } from "./tips";
import {
  draftFromPerson, employeeLabel, employeeName, passwordProblem, personDirty, planPersonSave, type EmployeeLite, type Person, type PersonDraft, type RoleLite,
} from "./logic";
import { run } from "./api";

/**
 * Everything about one person: their role, their business roles, whether they can sign in, and Remove. The rarely
 * needed login details (name, dates, seat, password, employee) sit behind one "More" so the panel stays short.
 */
export default function PersonPanel({ person, roles, businessRoles, employees, onClose, onSaved, onRemove }: {
  person: Person;
  roles: readonly RoleLite[];
  businessRoles: boolean;
  employees: readonly EmployeeLite[];
  onClose: () => void;
  onSaved: () => void;
  onRemove: (p: Person) => void;
}) {
  const [draft, setDraft] = useState<PersonDraft>(() => draftFromPerson(person));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<PersonDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const login = person.login;
  const linked = login?.employee_id ? employees.find((e) => e.id === login.employee_id) : undefined;
  const pwProblem = passwordProblem(draft.newPassword);
  const dirty = personDirty(person, draft);

  async function save() {
    if (pwProblem) { setError(pwProblem); return; }
    setSaving(true);
    setError(null);
    try {
      for (const call of planPersonSave(person, draft)) await run(call);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
      setSaving(false);
    }
  }

  const toggleRole = (id: string) => set({ roleIds: draft.roleIds.includes(id) ? draft.roleIds.filter((x) => x !== id) : [...draft.roleIds, id] });

  return (
    <SidePanel
      title={person.name}
      subtitle={linked
        ? <>{person.email} · <Link href={`/wfm/employees/${linked.id}`}>{employeeName(linked)}</Link></>
        : person.email}
      onClose={onClose}
      footer={
        <>
          <Button variant="danger" className={s.pushStart} onClick={() => onRemove(person)} disabled={saving}>Remove</Button>
          {error && <span role="alert" className={`${s.issue} ${s.footIssue}`}>{error}</span>}
          <Button variant="primary" onClick={() => void save()} loading={saving} disabled={!dirty}>Save</Button>
        </>
      }
    >
      <div className={s.stack}>
        <Opt label="Role" info={PEOPLE_TIPS.role}>
          <Segmented
            label="Role"
            value={draft.role}
            options={[{ id: "member", label: "Member" }, { id: "admin", label: "Admin" }]}
            onChange={(role) => set({ role })}
          />
        </Opt>

        {businessRoles && draft.role === "member" && (
          <Opt label="Business roles" info={PEOPLE_TIPS.businessRoles}>
            {roles.length === 0 ? (
              <span className={`${s.small} ${s.muted}`}>No roles yet. Create one in the Roles tab.</span>
            ) : (
              <div className={s.chipPick} role="group" aria-label="Business roles">
                {roles.map((r) => (
                  <button key={r.id} type="button" className={s.pick} aria-pressed={draft.roleIds.includes(r.id)} onClick={() => toggleRole(r.id)}>{r.name}</button>
                ))}
              </div>
            )}
          </Opt>
        )}

        {login && (
          <div className={s.switchRow}>
            <SwitchLabel label="Active" info={PEOPLE_TIPS.active} />
            <Switch checked={draft.active} label={`${person.name}: ${draft.active ? "active" : "locked"}`} onChange={(active) => set({ active })} />
          </div>
        )}

        {login && (
          <details className={s.more}>
            <summary>More</summary>
            <div className={s.moreBody}>
              <Opt label="Display name" htmlFor="pp-name">
                <Input id="pp-name" value={draft.displayName} onChange={(e) => set({ displayName: e.target.value })} />
              </Opt>
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
              <Opt label="New password" info={PEOPLE_TIPS.password} htmlFor="pp-pw">
                <Input id="pp-pw" type="password" autoComplete="new-password" value={draft.newPassword} onChange={(e) => set({ newPassword: e.target.value })} invalid={!!pwProblem} />
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
        )}

        {pwProblem && <Notice tone="warn">{pwProblem}</Notice>}
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
