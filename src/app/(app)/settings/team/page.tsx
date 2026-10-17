"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFeel } from "@/components/FeelProvider";
import { c } from "@/lib/theme";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import MoreMenu from "@/components/ui/MoreMenu";
import StatusPill from "@/components/ui/StatusPill";
import EmptyState from "@/components/ui/EmptyState";
import { Input, Select } from "@/components/ui/Input";
import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import { SettingsHeaderActions } from "@/components/settings/SettingsHeaderActions";

type Member = {
  user_id: string;
  role: "admin" | "member";
  email: string | null;
  name: string | null;
  created_at: string;
  business_role_ids: string[];
};

type BusinessRole = { id: string; name: string };

function Avatar({ email }: { email: string | null }) {
  const initials = email ? email.slice(0, 2).toUpperCase() : "??";
  return (
    <div style={{
      width: 34, height: 34, borderRadius: "50%", flexShrink: 0,
      background: "var(--modern-accent, var(--accent))", color: "#fff",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 12, fontWeight: 700,
    }}>
      {initials}
    </div>
  );
}

export default function TeamPage() {
  const [inviteOpen, setInviteOpen] = useState(false);

  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [businessRoles, setBusinessRoles] = useState<BusinessRole[]>([]);
  const [editingRolesFor, setEditingRolesFor] = useState<string | null>(null);
  const [roleDraft, setRoleDraft] = useState<string[]>([]);
  const [savingRoles, setSavingRoles] = useState(false);

  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePassword, setInvitePassword] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const [teamRes, rolesRes] = await Promise.all([
      fetch("/api/settings/team"),
      fetch("/api/business-roles"),
    ]);
    if (teamRes.ok) {
      const json = await teamRes.json();
      setMembers(json.members ?? []);
    } else {
      setError("Failed to load team members.");
    }
    if (rolesRes.ok) {
      const json = await rolesRes.json();
      setBusinessRoles((json.roles ?? []).map((r: BusinessRole) => ({ id: r.id, name: r.name })));
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function startEditRoles(m: Member) {
    setEditingRolesFor(m.user_id);
    setRoleDraft(m.business_role_ids);
  }

  function toggleRoleDraft(roleId: string) {
    setRoleDraft((cur) => cur.includes(roleId) ? cur.filter((r) => r !== roleId) : [...cur, roleId]);
  }

  async function saveRoles(userId: string) {
    setSavingRoles(true);
    const res = await fetch(`/api/settings/team/${userId}/roles`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role_ids: roleDraft }),
    });
    setSavingRoles(false);
    if (res.ok) {
      setEditingRolesFor(null);
      load();
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError("");
    setInviteSuccess("");
    setInviting(true);
    const res = await fetch("/api/settings/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail, password: invitePassword || undefined, role: inviteRole }),
    });
    const json = await res.json().catch(() => ({}));
    setInviting(false);
    if (!res.ok) {
      setInviteError(json.error ?? "Failed to invite user.");
      return;
    }
    setInviteEmail("");
    setInvitePassword("");
    setInviteSuccess(json.passwordSet ? "Account created with that password!" : "Invite sent!");
    if (successTimer.current) clearTimeout(successTimer.current);
    successTimer.current = setTimeout(() => setInviteSuccess(""), 3000);
    load();
  }

  async function changeRole(userId: string, newRole: "admin" | "member") {
    const res = await fetch(`/api/settings/team/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: newRole }),
    });
    if (res.ok) load();
  }

  const { confirm, undoable } = useFeel();
  async function removeMember(userId: string, email: string | null) {
    if (!(await confirm({ title: `Remove ${email ?? "this user"} from the workspace?`, body: "They lose access when the undo window closes. Their login itself is not deleted.", confirmLabel: "Remove", tone: "danger" }))) return;
    undoable({
      text: `${email ?? "Member"} removed`,
      action: async () => {
        await fetch(`/api/settings/team/${userId}`, { method: "DELETE", keepalive: true });
        load();
      },
    });
  }

  return (
    <div style={{ maxWidth: 680 }}>
      <SettingsPageHeader title="Team" subtitle="Invite team members and manage their access" />
      <SettingsHeaderActions>
        <Button variant="primary" onClick={() => setInviteOpen((o) => !o)} aria-expanded={inviteOpen}>
          + Invite member
        </Button>
      </SettingsHeaderActions>

      {inviteOpen && (
        <div style={{ marginBottom: 14 }}>
          <Card title="Invite member">
            <form onSubmit={handleInvite} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <Input
                  type="email"
                  required
                  aria-label="Email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="colleague@company.com"
                />
              </div>
              <div style={{ width: 130 }}>
                <Select
                  aria-label="Role"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as "admin" | "member")}
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </Select>
              </div>
              <div style={{ width: "100%", maxWidth: 360 }}>
                <Input
                  type="text"
                  aria-label="Initial password"
                  value={invitePassword}
                  onChange={(e) => setInvitePassword(e.target.value)}
                  placeholder="Initial password (optional — leave blank to email an invite)"
                />
                <div className="bpm-t-help" style={{ marginTop: 4 }}>
                  If they already have an account, they&apos;re added to this workspace directly (password ignored).
                </div>
              </div>

              {inviteError && (
                <div role="alert" style={{ width: "100%", fontSize: 12, color: "var(--err-ink)", background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 7, padding: "8px 12px" }}>
                  {inviteError}
                </div>
              )}
              {inviteSuccess && (
                <div role="status" style={{ width: "100%", fontSize: 12, color: "var(--greenink)", background: "var(--greenbg)", border: "1px solid var(--green)", borderRadius: 7, padding: "8px 12px" }}>
                  ✓ {inviteSuccess}
                </div>
              )}

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", width: "100%" }}>
                <Button onClick={() => setInviteOpen(false)}>Close</Button>
                <Button type="submit" variant="primary" loading={inviting}>
                  {inviting ? "Adding…" : "Send invite"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      <Card title={`Workspace members${members.length > 0 ? ` (${members.length})` : ""}`}>
        {loading && (
          <div style={{ fontSize: 13, color: c.muted, padding: "16px 0", textAlign: "center" }}>Loading…</div>
        )}
        {error && (
          <div role="alert" style={{ fontSize: 12, color: "var(--err-ink)" }}>{error}</div>
        )}

        {!loading && !error && members.length === 0 && (
          <EmptyState
            title="No team members yet"
            text="Invite a colleague to give them access to this workspace."
            action={<Button variant="primary" onClick={() => setInviteOpen(true)}>+ Invite member</Button>}
          />
        )}

        {!loading && members.map((m, idx) => (
          <div key={m.user_id} style={{ borderTop: idx > 0 ? `1px solid ${c.line}` : "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0" }}>
              <Avatar email={m.email} />

              <div style={{ flex: 1, minWidth: 0 }}>
                {m.name && (
                  <div style={{ fontSize: 13, fontWeight: 600, color: c.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {m.name}
                  </div>
                )}
                <div style={{ fontSize: 12, color: c.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {m.email ?? m.user_id}
                </div>
              </div>

              <StatusPill label={m.role === "admin" ? "Admin" : "Member"} tone={m.role === "admin" ? "blue" : "teal"} />

              <MoreMenu
                label={`Actions for ${m.email ?? "member"}`}
                items={[
                  { label: m.role === "admin" ? "Change role to Member" : "Change role to Admin", onSelect: () => changeRole(m.user_id, m.role === "admin" ? "member" : "admin") },
                  // Admins bypass Business Roles entirely, so editing them only matters for members.
                  { label: "Edit business roles", onSelect: () => startEditRoles(m), hidden: m.role !== "member" },
                  { label: "Remove from workspace", onSelect: () => removeMember(m.user_id, m.email), danger: true },
                ]}
              />
            </div>

            {m.role === "member" && (
              <div style={{ padding: "0 0 12px 46px" }}>
                {editingRolesFor === m.user_id ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, background: "var(--panel2)", borderRadius: 8, padding: 12 }}>
                    {businessRoles.length === 0 ? (
                      <div className="bpm-t-help">No Business Roles exist yet — create one in Administrator → Business Roles first.</div>
                    ) : (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {businessRoles.map((br) => (
                          <label key={br.id} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: c.ink, border: `1px solid ${c.line}`, borderRadius: 6, padding: "4px 9px", cursor: "pointer", background: c.panel }}>
                            <input type="checkbox" checked={roleDraft.includes(br.id)} onChange={() => toggleRoleDraft(br.id)} />
                            {br.name}
                          </label>
                        ))}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 8 }}>
                      <Button size="sm" variant="primary" onClick={() => saveRoles(m.user_id)} loading={savingRoles}>
                        {savingRoles ? "Saving…" : "Save"}
                      </Button>
                      <Button size="sm" onClick={() => setEditingRolesFor(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <div className="bpm-t-help">
                    {m.business_role_ids.length === 0
                      ? "Full access (no Business Role assigned)"
                      : `Roles: ${m.business_role_ids.map((id) => businessRoles.find((br) => br.id === id)?.name ?? "—").join(", ")}`}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </Card>
    </div>
  );
}
