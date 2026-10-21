"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import Tabs from "@/components/ui/Tabs";
import { useUrlTab } from "@/components/ui/useUrlTab";
import { useFeel } from "@/components/FeelProvider";
import { useTenant } from "@/lib/tenant-context";
import type { TenantFeatures } from "@/lib/constants";
import { Notice, PlusIcon } from "../middleware/ui";
import s from "./people.module.css";
import { deleteRole, loadPeople, removeMember, type PeopleData } from "./api";
import { filterPeople, freeEmployees, mergePeople, sortRoles, type Person, type RoleFull } from "./logic";
import { PeopleRows, RoleRows } from "./Rows";
import PersonPanel from "./PersonPanel";
import InvitePanel, { type Invited } from "./InvitePanel";
import RolePanel from "./RolePanel";

type Sel = { kind: "person"; id: string } | { kind: "invite" } | { kind: "role"; id: string | null } | null;

/**
 * Settings > People. One table of everyone with access (a row opens a panel), and, when the Business Roles module
 * is on, a second tab with one table of roles. Replaces Settings > Team, Administration > Business users and
 * Administration > Business roles, which set the same things through the same routes.
 */
export default function PeopleClient() {
  const tenant = useTenant();
  const businessRoles = tenant?.features?.business_roles === true;
  const features = (tenant?.features ?? {}) as TenantFeatures;
  const [tab, setTab] = useUrlTab(businessRoles ? ["people", "roles"] : ["people"]);
  const { confirm, undoable } = useFeel();

  const [data, setData] = useState<PeopleData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  const [sel, setSel] = useState<Sel>(null);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<{ text: string; credentials: Invited["credentials"] } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async () => {
    try {
      setData(await loadPeople(businessRoles));
      setError(null);
      setRev((r) => r + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load.");
    }
  }, [businessRoles]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function flash(text: string, credentials: Invited["credentials"] = null) {
    if (timer.current) clearTimeout(timer.current);
    setNotice({ text, credentials });
    if (!credentials) timer.current = setTimeout(() => setNotice(null), 4000);
  }

  const people = data ? mergePeople(data.members, data.logins) : [];
  const roles = data ? sortRoles(data.roles) : [];
  const shown = filterPeople(people, roles, query);
  const openPerson = sel?.kind === "person" ? people.find((p) => p.userId === sel.id) ?? null : null;
  const openRole = sel?.kind === "role" && sel.id ? roles.find((r) => r.id === sel.id) ?? null : null;

  async function remove(p: Person) {
    if (!(await confirm({ title: `Remove ${p.email ?? p.name} from the workspace?`, body: "They lose access when the undo window closes. Their login itself is not deleted.", confirmLabel: "Remove", tone: "danger" }))) return;
    setSel(null);
    undoable({
      text: `${p.name} removed`,
      action: async () => {
        try { await removeMember(p.userId); } catch (e) { setError(e instanceof Error ? e.message : "Could not remove."); }
        void reload();
      },
    });
  }

  async function removeRole(r: RoleFull) {
    if (!(await confirm({ title: `Delete the "${r.name}" role?`, body: "Members holding only this role revert to full, unrestricted access.", confirmLabel: "Delete", tone: "danger" }))) return;
    setSel(null);
    undoable({
      text: `Role "${r.name}" deleted`,
      action: async () => {
        try { await deleteRole(r.id); } catch (e) { setError(e instanceof Error ? e.message : "Could not delete."); }
        void reload();
      },
    });
  }

  function changeTab(id: string) { setSel(null); setQuery(""); setTab(id); }

  const copyDetails = async (c: NonNullable<Invited["credentials"]>) => {
    try { await navigator.clipboard.writeText(`Sign-in: ${window.location.origin}\nEmail: ${c.email}\nInitial password: ${c.password}`); } catch { /* the details stay on screen to copy by hand */ }
  };

  if (error && !data) {
    return <Notice tone="err" action={<Button size="sm" onClick={() => void reload()}>Try again</Button>}>{error}</Notice>;
  }
  if (!data) return <div className={`${s.small} ${s.muted}`} role="status">Loading…</div>;

  const onRoles = tab === "roles";

  return (
    <div className={s.shell}>
      {error && <Notice tone="err">{error}</Notice>}
      {notice && (
        <Notice tone="ok" action={<Button size="sm" onClick={() => setNotice(null)}>Dismiss</Button>}>
          <div className={s.creds}>
            <span>{notice.text}</span>
            {notice.credentials && (
              <>
                <code>{notice.credentials.email} / {notice.credentials.password}</code>
                <Button size="sm" onClick={() => void copyDetails(notice.credentials!)}>Copy details</Button>
              </>
            )}
          </div>
        </Notice>
      )}

      {businessRoles && (
        <Tabs
          label="People"
          tabs={[{ id: "people", label: "People", count: people.length }, { id: "roles", label: "Roles", count: roles.length }]}
          value={tab}
          onChange={changeTab}
        />
      )}

      <div className={s.bar}>
        {onRoles ? (
          <span className={`${s.small} ${s.muted}`} aria-live="polite">{roles.length === 0 ? "" : `${roles.length} role${roles.length === 1 ? "" : "s"}`}</span>
        ) : (
          <div className={s.barStart}>
            <div className={s.search}>
              <Input type="search" aria-label="Search people" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <span className={`${s.small} ${s.muted}`} aria-live="polite">{`${shown.length} of ${people.length}`}</span>
          </div>
        )}
        {onRoles
          ? <Button variant="primary" icon={<PlusIcon />} onClick={() => setSel({ kind: "role", id: null })}>New role</Button>
          : <Button variant="primary" icon={<PlusIcon />} onClick={() => setSel({ kind: "invite" })}>Invite</Button>}
      </div>

      <div className={s.card}>
        {onRoles ? (
          roles.length === 0 ? (
            <EmptyState
              title="No roles yet"
              text="Everyone keeps full access until you create a role and give it to someone."
              action={<Button variant="primary" icon={<PlusIcon />} onClick={() => setSel({ kind: "role", id: null })}>New role</Button>}
            />
          ) : (
            <RoleRows items={roles} people={people} onOpen={(r) => setSel({ kind: "role", id: r.id })} />
          )
        ) : shown.length === 0 ? (
          <EmptyState title={query ? "No one matches" : "No one here yet"} text={query ? undefined : "Invite a colleague to give them access."} />
        ) : (
          <PeopleRows items={shown} roles={roles} onOpen={(p) => setSel({ kind: "person", id: p.userId })} />
        )}
      </div>

      {sel?.kind === "invite" && (
        <InvitePanel
          employees={freeEmployees(data.employees, data.logins)}
          existingEmails={people.map((p) => p.email).filter((e): e is string => !!e)}
          onClose={() => setSel(null)}
          onDone={(r) => { setSel(null); flash(r.text, r.credentials); void reload(); }}
        />
      )}
      {openPerson && (
        <PersonPanel
          key={`${openPerson.userId}:${rev}`}
          person={openPerson}
          roles={roles}
          businessRoles={businessRoles}
          employees={freeEmployees(data.employees, data.logins)}
          onClose={() => setSel(null)}
          onSaved={() => { setSel(null); flash("Saved"); void reload(); }}
          onRemove={(p) => void remove(p)}
        />
      )}
      {sel?.kind === "role" && (sel.id === null || openRole) && (
        <RolePanel
          key={`${sel.id ?? "new"}:${rev}`}
          role={openRole}
          features={features}
          onClose={() => setSel(null)}
          onChanged={(reopenId) => { setSel(reopenId ? { kind: "role", id: reopenId } : null); if (!reopenId) flash("Saved"); void reload(); }}
          onDelete={(r) => void removeRole(r)}
        />
      )}
    </div>
  );
}
