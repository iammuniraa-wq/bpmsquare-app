"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import type { Employee } from "@/lib/types";
import InvitePanel from "../settings/people/InvitePanel";
import CredentialsNotice from "../settings/people/CredentialsNotice";
import { STATUS_WORD, personHref, type StatusKey } from "../settings/people/logic";
import s from "../settings/people/people.module.css";

/** The login linked to an employee, as the Employees page knows it: who it is and whether it can sign in right now. */
export type EmployeeLoginInfo = { userId: string; status: StatusKey };

const DOT = { active: `${s.dot} ${s.dotOn}`, locked: `${s.dot} ${s.dotOff}`, expired: `${s.dot} ${s.dotWarn}` } as const;

/**
 * The business-user action at the top of an employee record: "Create business user" while no login is linked (it opens
 * the same Add panel as Settings > People, with this employee and its e-mail already chosen), and, once one is, a chip
 * with its state that opens that person in Settings > People.
 */
export default function EmployeeLogin({ employee, login }: { employee: Employee; login: EmployeeLoginInfo | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<{ text: string; credentials: { email: string; password: string } | null } | null>(null);

  return (
    <div className={s.stack}>
      <div className={s.bar}>
        <span className="bpm-opt-label">Login</span>
        {login ? (
          <Link href={personHref(login.userId)} className={s.loginChip} aria-label={`Login: ${STATUS_WORD[login.status]}. Open in People`}>
            <span className={DOT[login.status]} aria-hidden="true" />
            {STATUS_WORD[login.status]}
          </Link>
        ) : (
          <Button size="sm" variant="primary" onClick={() => setOpen(true)}>Create business user</Button>
        )}
      </div>
      {notice && <CredentialsNotice text={notice.text} credentials={notice.credentials} onDismiss={() => setNotice(null)} />}
      {open && createPortal(
        <InvitePanel
          employees={[{ id: employee.id, first_name: employee.first_name, last_name: employee.last_name, email: employee.email, employee_code: employee.employee_code, valid_from: employee.valid_from, valid_to: employee.valid_to }]}
          existingEmails={[]}
          prefillEmployeeId={employee.id}
          onClose={() => setOpen(false)}
          onDone={(r) => { setOpen(false); setNotice(r); router.refresh(); }}
        />,
        document.body,
      )}
    </div>
  );
}
