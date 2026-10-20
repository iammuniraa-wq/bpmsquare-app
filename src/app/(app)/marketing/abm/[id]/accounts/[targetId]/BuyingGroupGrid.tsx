"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { c, pillar } from "@/lib/theme";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Field from "@/components/ui/Field";
import { Select } from "@/components/ui/Input";
import { useFeel } from "@/components/FeelProvider";
import { ABM_ROLES, ROLE_LABEL, type AbmRole } from "@/lib/abm/types";
import Modal from "../../../Modal";

export type GridMember = {
  id: string;
  contactId: string;
  name: string;
  jobTitle: string | null;
  role: AbmRole;
  isPrimary: boolean;
  ownerId: string | null;
  /** Server-formatted date of the last thing this person did, or null. */
  lastEngagement: string | null;
};

type User = { id: string; name: string };
type Contact = { id: string; name: string; role: string | null };

const th: React.CSSProperties = { textAlign: "left", color: c.hint, fontWeight: 600, padding: "8px 10px", fontSize: 11, letterSpacing: 0.4, textTransform: "uppercase", whiteSpace: "nowrap", background: c.panel2 };
const td: React.CSSProperties = { padding: "8px 10px", fontSize: 13, verticalAlign: "middle" };
const select: React.CSSProperties = { font: "inherit", fontSize: 13, padding: "4px 6px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--panel)", color: "var(--ink)", maxWidth: 170 };

const GAP_TEXT: Partial<Record<AbmRole, string>> = { decision_maker: "No decision maker yet", influencer: "No influencer yet", user: "No user named yet" };

/**
 * The buying group as a compact, editable grid: one row per person (name, role,
 * last engagement, owner), the role changed in place, a person added or removed,
 * and a ghost row for every required role nobody holds yet. Roles belong to this
 * program only. Naming someone here sends nothing and needs no consent.
 */
export default function BuyingGroupGrid({ targetId, accountId, members, requiredRoles, users, canEdit }: {
  targetId: string; accountId: string; members: GridMember[]; requiredRoles: AbmRole[]; users: User[]; canEdit: boolean;
}) {
  const router = useRouter();
  const { toast, confirm } = useFeel();
  const [adding, setAdding] = useState<{ role: AbmRole } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const held = new Set(members.map((m) => m.role));
  const ghosts = requiredRoles.filter((r) => !held.has(r));

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(id);
    const res = await fetch(`/api/abm/members/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(null);
    if (!res.ok) { const j = await res.json().catch(() => ({})); toast({ text: j.error ?? "Could not save that change", tone: "error" }); return; }
    router.refresh();
  }

  async function remove(m: GridMember) {
    if (!(await confirm({ title: `Remove ${m.name} from this buying group?`, body: "The person stays in your contacts. Only their place in this group goes." }))) return;
    setBusy(m.id);
    const res = await fetch(`/api/abm/members/${m.id}`, { method: "DELETE" });
    setBusy(null);
    if (!res.ok) { toast({ text: "Could not remove that person", tone: "error" }); return; }
    router.refresh();
  }

  return (
    <Card title="Buying group" padding={0} action={canEdit ? <Button size="sm" variant="primary" onClick={() => setAdding({ role: "unknown" })}>+ Add person</Button> : undefined}>
      {members.length === 0 && ghosts.length === 0 ? (
        <div style={{ padding: "22px 16px", color: c.muted, fontSize: 13 }}>No one named yet.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${c.line}` }}>
                <th style={th}>Person</th><th style={th}>Role in this program</th><th style={th}>Last activity</th><th style={th}>Our owner</th><th style={th}><span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} style={{ borderBottom: `1px solid ${c.line}`, opacity: busy === m.id ? 0.6 : 1 }}>
                  <td style={td}>
                    <span style={{ fontWeight: 600 }}>{m.name}</span>
                    {m.isPrimary && <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 700, color: pillar.teal.fg, background: pillar.teal.bg, padding: "1px 6px", borderRadius: 6 }}>Call first</span>}
                    {m.jobTitle && <div style={{ fontSize: 11.5, color: c.hint }}>{m.jobTitle}</div>}
                  </td>
                  <td style={td}>
                    {canEdit ? (
                      <select aria-label={`Role of ${m.name}`} style={select} value={m.role} onChange={(e) => patch(m.id, { role: e.target.value })}>
                        {ABM_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </select>
                    ) : ROLE_LABEL[m.role]}
                  </td>
                  <td style={{ ...td, color: c.muted }}>{m.lastEngagement ?? <span style={{ color: c.hint }}>Nothing yet</span>}</td>
                  <td style={td}>
                    {canEdit ? (
                      <select aria-label={`Our owner for ${m.name}`} style={select} value={m.ownerId ?? ""} onChange={(e) => patch(m.id, { owner_user_id: e.target.value || null })}>
                        <option value="">—</option>
                        {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                    ) : (users.find((u) => u.id === m.ownerId)?.name ?? "—")}
                  </td>
                  <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                    {canEdit && (
                      <>
                        {!m.isPrimary && <Button size="sm" variant="quiet" onClick={() => patch(m.id, { is_primary: true })} title="Mark as the person to call first">Call first</Button>}
                        <Button size="sm" variant="quiet" onClick={() => remove(m)} aria-label={`Remove ${m.name}`}>Remove</Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {ghosts.map((r) => (
                <tr key={`ghost-${r}`} style={{ borderBottom: `1px dashed ${c.line}` }}>
                  <td style={{ ...td, color: pillar.amber.fg, fontWeight: 600 }} colSpan={4}>
                    {GAP_TEXT[r] ?? `No ${ROLE_LABEL[r].toLowerCase()} yet`}
                    <span style={{ color: c.hint, fontWeight: 400 }}> · required by this program</span>
                  </td>
                  <td style={{ ...td, textAlign: "right" }}>{canEdit && <Button size="sm" onClick={() => setAdding({ role: r })}>Add one</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && <AddPerson targetId={targetId} accountId={accountId} initialRole={adding.role} taken={new Set(members.map((m) => m.contactId))} users={users} onClose={() => setAdding(null)} />}
    </Card>
  );
}

function AddPerson({ targetId, accountId, initialRole, taken, users, onClose }: { targetId: string; accountId: string; initialRole: AbmRole; taken: Set<string>; users: User[]; onClose: () => void }) {
  const router = useRouter();
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [contactId, setContactId] = useState("");
  const [role, setRole] = useState<AbmRole>(initialRole);
  const [ownerId, setOwnerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    fetch(`/api/abm/lookup?kind=contacts&account_id=${accountId}`).then((r) => r.json()).then((j: { items: Contact[] }) => { if (live) setContacts(j.items ?? []); }).catch(() => { if (live) setContacts([]); });
    return () => { live = false; };
  }, [accountId]);

  const available = (contacts ?? []).filter((x) => !taken.has(x.id));

  async function save() {
    if (!contactId) { setError("Choose a person."); return; }
    setBusy(true); setError("");
    const res = await fetch(`/api/abm/targets/${targetId}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contact_id: contactId, role, owner_user_id: ownerId || null }) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(j.error ?? "Could not add that person."); return; }
    onClose();
    router.refresh();
  }

  return (
    <Modal title="Add a person to the buying group" onClose={onClose}>
      <Field label="Person at this company" required>
        <Select value={contactId} onChange={(e) => setContactId(e.target.value)} disabled={contacts === null}>
          <option value="">{contacts === null ? "Loading…" : available.length === 0 ? "No more contacts at this company" : "— Choose —"}</option>
          {available.map((x) => <option key={x.id} value={x.id}>{x.name}{x.role ? ` — ${x.role}` : ""}</option>)}
        </Select>
      </Field>
      <div className="fg2">
        <Field label="Role in this program"><Select value={role} onChange={(e) => setRole(e.target.value as AbmRole)}>{ABM_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select></Field>
        <Field label="Our owner for this person"><Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}><option value="">—</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
      </div>
      <div style={{ fontSize: 12, color: c.hint, marginBottom: 12 }}>Naming someone sends nothing and needs no consent. A contact that does not exist yet is added from the account first.</div>
      {error && <div role="alert" style={{ color: "var(--err-ink)", fontSize: 13, marginBottom: 10 }}>{error}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={save}>Add person</Button>
      </div>
    </Modal>
  );
}
