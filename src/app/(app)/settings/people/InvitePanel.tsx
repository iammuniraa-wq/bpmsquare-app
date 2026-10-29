"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import SidePanel from "@/components/ui/SidePanel";
import { Input, Select } from "@/components/ui/Input";
import { Opt } from "@/components/ui/Opt";
import { Segmented } from "../middleware/ui";
import s from "./people.module.css";
import { PEOPLE_TIPS } from "./tips";
import { emptyInvite, employeeLabel, inviteSuccessText, planInvite, validityWord, type EmployeeLite, type InviteDraft } from "./logic";
import { run } from "./api";

export type Invited = { text: string; credentials: { email: string; password: string } | null };

/**
 * Add someone: an email, a role (always), and optionally a password or an employee to give a login to. Opened from the
 * employee record it arrives with that employee and its e-mail already chosen.
 */
export default function InvitePanel({ employees, existingEmails, prefillEmployeeId, onClose, onDone }: {
  employees: readonly EmployeeLite[];
  existingEmails: readonly string[];
  prefillEmployeeId?: string;
  onClose: () => void;
  onDone: (r: Invited) => void;
}) {
  const [draft, setDraft] = useState<InviteDraft>(() => {
    const emp = employees.find((e) => e.id === prefillEmployeeId);
    return emp ? { ...emptyInvite(), employeeId: emp.id, email: emp.email ?? "" } : emptyInvite();
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<InviteDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const picked = employees.find((e) => e.id === draft.employeeId);
  const validity = picked ? validityWord(picked.valid_from, picked.valid_to) : null;

  function pickEmployee(id: string) {
    const emp = employees.find((e) => e.id === id);
    set({ employeeId: id, email: draft.email || emp?.email || "" });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const plan = planInvite(draft, existingEmails);
    if (!plan.call) { setError(plan.problem); return; }
    setSaving(true);
    setError(null);
    try {
      const json = await run<{ passwordSet?: boolean; linkedExisting?: boolean; user_id?: string }>(plan.call);
      onDone({
        text: inviteSuccessText(json, plan.viaEmployee),
        credentials: json.passwordSet ? { email: draft.email.trim().toLowerCase(), password: draft.password } : null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add this person.");
      setSaving(false);
    }
  }

  return (
    <SidePanel
      title="Invite"
      onClose={onClose}
      footer={
        <>
          {error && <span role="alert" className={`${s.issue} ${s.footIssue}`}>{error}</span>}
          <Button type="submit" form="people-invite" variant="primary" loading={saving}>{draft.password || draft.employeeId ? "Add" : "Send invite"}</Button>
        </>
      }
    >
      <form id="people-invite" className={s.stack} onSubmit={(e) => void submit(e)}>
        <Opt label="Email" htmlFor="inv-email">
          <Input id="inv-email" type="email" required autoComplete="off" placeholder="colleague@company.com" value={draft.email} onChange={(e) => set({ email: e.target.value })} />
        </Opt>
        <Opt label="Role" info={PEOPLE_TIPS.role}>
          <Segmented label="Role" value={draft.role} options={[{ id: "member", label: "Member" }, { id: "admin", label: "Admin" }]} onChange={(role) => set({ role })} />
        </Opt>
        <Opt label="Password" info={draft.employeeId ? PEOPLE_TIPS.inviteEmployee : PEOPLE_TIPS.invitePassword} htmlFor="inv-pw">
          <Input id="inv-pw" type="password" autoComplete="new-password" placeholder={draft.employeeId ? "Required for a new login" : "Optional"} value={draft.password} onChange={(e) => set({ password: e.target.value })} />
        </Opt>
        {employees.length > 0 && (
          <Opt label="Employee" info={PEOPLE_TIPS.employee} htmlFor="inv-emp">
            <Select id="inv-emp" value={draft.employeeId} onChange={(e) => pickEmployee(e.target.value)}>
              <option value="">None</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{employeeLabel(e)}</option>)}
            </Select>
          </Opt>
        )}
        {validity && (
          <Opt label="Validity" info={PEOPLE_TIPS.inviteValidity}>
            <span className={s.small}>{validity}</span>
          </Opt>
        )}
      </form>
    </SidePanel>
  );
}
