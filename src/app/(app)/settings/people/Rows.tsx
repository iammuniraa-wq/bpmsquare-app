"use client";

import s from "./people.module.css";
import { STATUS_WORD, accessWord, linkedEmployeeName, peopleWithRole, roleChips, type EmployeeLite, type Person, type RoleFull, type RoleLite } from "./logic";

const DOT = { active: `${s.dot} ${s.dotOn}`, locked: `${s.dot} ${s.dotOff}`, expired: `${s.dot} ${s.dotWarn}` } as const;

/**
 * One row per person: name, email, employee (when logins can be tied to employees), role chips, status. The whole row opens
 * the panel. The employee column is left out of the phone card.
 */
export function PeopleRows({ items, roles, employees, onOpen }: { items: readonly Person[]; roles: readonly RoleLite[]; employees?: readonly EmployeeLite[]; onOpen: (p: Person) => void }) {
  return (
    <div className={`${s.people} ${employees ? s.withEmployee : ""}`} role="list" aria-label="People">
      <div className={s.listHead} aria-hidden="true">
        <span>Name</span><span>Email</span>{employees && <span className={s.employeeCell}>Employee</span>}<span>Role</span><span>Status</span>
      </div>
      {items.map((p) => (
        <div key={p.userId} className={s.item} role="listitem">
          <button type="button" className={`${s.open} ${s.nameCell}`} onClick={() => onOpen(p)} aria-label={`${p.name}: open`}>
            <span className={s.name}>{p.name}</span>
          </button>
          <span className={`${s.email} ${s.emailCell}`}>{p.email ?? ""}</span>
          {employees && <span className={`${s.email} ${s.employeeCell}`}>{linkedEmployeeName(p, employees)}</span>}
          <span className={`${s.chips} ${s.chipsCell}`}>
            {roleChips(p, roles).map((c, i) => (
              <span key={`${c}-${i}`} className={`${s.chip} ${i === 0 && p.role === "admin" ? s.chipAdmin : ""}`}>{c}</span>
            ))}
          </span>
          <span className={`${s.status} ${s.statusCell}`}>
            <span className={DOT[p.status]} aria-hidden="true" />
            <span>{STATUS_WORD[p.status]}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/** One row per role: name, how much it grants, how many people hold it. */
export function RoleRows({ items, people, onOpen }: { items: readonly RoleFull[]; people: readonly Person[]; onOpen: (r: RoleFull) => void }) {
  return (
    <div className={s.roles} role="list" aria-label="Roles">
      <div className={s.listHead} aria-hidden="true">
        <span>Role</span><span>Access</span><span>People</span>
      </div>
      {items.map((r) => (
        <div key={r.id} className={s.item} role="listitem">
          <button type="button" className={s.open} onClick={() => onOpen(r)} aria-label={`${r.name}: open`}>
            <span className={s.name}>
              {r.name}
              {r.is_standard ? <> <span className={`${s.chip} ${s.chipStd}`}>Standard</span></> : null}
            </span>
            {r.description ? <span className={s.sub}>{r.description}</span> : null}
          </button>
          <span className={`${s.count} ${s.accessCell}`}>{accessWord(r.grants)}</span>
          <span className={`${s.count} ${s.countCell}`}>{peopleWithRole(people, r.id)}</span>
        </div>
      ))}
    </div>
  );
}
