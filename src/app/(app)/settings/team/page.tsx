"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { c } from "@/lib/theme";
import { useSettings, ACCENT_PRESETS } from "@/lib/settings";
import { useTenant } from "@/lib/tenant-context";
import { cardStyle } from "@/components/Shell";

type Member = {
  user_id: string;
  role: "admin" | "member";
  email: string | null;
  name: string | null;
  created_at: string;
};

function RolePill({ role }: { role: "admin" | "member" }) {
  const isAdmin = role === "admin";
  return (
    <span style={{
      fontSize: 11, fontWeight: 600,
      padding: "2px 10px", borderRadius: 20,
      background: isAdmin ? "#eff6ff" : "#f1f5f9",
      color: isAdmin ? "#1d4ed8" : "#475569",
      border: `1px solid ${isAdmin ? "#bfdbfe" : "#e2e8f0"}`,
    }}>
      {isAdmin ? "Admin" : "Member"}
    </span>
  );
}

function Avatar({ email, accent }: { email: string | null; accent: string }) {
  const initials = email ? email.slice(0, 2).toUpperCase() : "??";
  return (
    <div style={{
      width: 34, height: 34, borderRadius: "50%", flexShrink: 0,
      background: accent, color: "#fff",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 12, fontWeight: 700,
    }}>
      {initials}
    </div>
  );
}

export default function TeamPage() {
  const { settings } = useSettings();
  const tenant = useTenant();
  const accent = tenant?.accent_color ?? ACCENT_PRESETS[settings.accentPreset].color;

  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const res = await fetch("/api/settings/team");
    if (res.ok) {
      const json = await res.json();
      setMembers(json.members ?? []);
    } else {
      setError("Failed to load team members.");
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError("");
    setInviteSuccess("");
    setInviting(true);
    const res = await fetch("/api/settings/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
    });
    const json = await res.json().catch(() => ({}));
    setInviting(false);
    if (!res.ok) {
      setInviteError(json.error ?? "Failed to invite user.");
      return;
    }
    setInviteEmail("");
    setInviteSuccess("Invite sent!");
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

  async function removeMember(userId: string, email: string | null) {
    if (!window.confirm(`Remove ${email ?? "this user"} from the workspace?`)) return;
    const res = await fetch(`/api/settings/team/${userId}`, { method: "DELETE" });
    if (res.ok) load();
  }

  return (
    <div style={{ maxWidth: 680 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 19, margin: 0, fontWeight: 600, paddingLeft: 12, borderLeft: `3px solid ${accent}` }}>
          Team
        </h1>
        <p style={{ margin: "4px 0 0 12px", fontSize: 12, color: c.muted }}>
          Invite team members and manage their access
        </p>
      </div>

      {/* Invite form */}
      <section style={{ ...cardStyle, marginBottom: 14 }}>
        <h2 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 600, color: c.ink }}>Invite member</h2>
        <form onSubmit={handleInvite} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            type="email"
            required
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="colleague@company.com"
            style={{
              flex: 1, minWidth: 200,
              height: 38, padding: "0 12px",
              border: `1px solid ${c.line}`, borderRadius: 8,
              fontSize: 13, color: c.ink, outline: "none",
            }}
          />
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as "admin" | "member")}
            style={{
              height: 38, padding: "0 10px",
              border: `1px solid ${c.line}`, borderRadius: 8,
              fontSize: 13, color: c.ink, background: "#fff",
            }}
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <button
            type="submit"
            disabled={inviting}
            style={{
              height: 38, padding: "0 20px",
              background: inviting ? "#93c5fd" : accent,
              color: "#fff", border: "none", borderRadius: 8,
              fontSize: 13, fontWeight: 500,
              cursor: inviting ? "not-allowed" : "pointer",
            }}
          >
            {inviting ? "Sending…" : "Send invite"}
          </button>
        </form>

        {inviteError && (
          <div style={{ marginTop: 10, fontSize: 12, color: "#dc2626", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 7, padding: "8px 12px" }}>
            {inviteError}
          </div>
        )}
        {inviteSuccess && (
          <div style={{ marginTop: 10, fontSize: 12, color: "#166534", background: "#dcfce7", border: "1px solid #bbf7d0", borderRadius: 7, padding: "8px 12px" }}>
            ✓ {inviteSuccess}
          </div>
        )}
      </section>

      {/* Members list */}
      <section style={{ ...cardStyle }}>
        <h2 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 600, color: c.ink }}>
          Workspace members{members.length > 0 && <span style={{ fontWeight: 400, color: c.muted, marginLeft: 6 }}>({members.length})</span>}
        </h2>

        {loading && (
          <div style={{ fontSize: 13, color: c.muted, padding: "16px 0", textAlign: "center" }}>Loading…</div>
        )}
        {error && (
          <div style={{ fontSize: 12, color: "#dc2626" }}>{error}</div>
        )}

        {!loading && members.length === 0 && (
          <div style={{ fontSize: 13, color: c.muted, padding: "16px 0", textAlign: "center" }}>
            No team members yet. Invite someone above.
          </div>
        )}

        {!loading && members.map((m, idx) => (
          <div
            key={m.user_id}
            style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "12px 0",
              borderTop: idx > 0 ? `1px solid ${c.line}` : "none",
            }}
          >
            <Avatar email={m.email} accent={accent} />

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

            <RolePill role={m.role} />

            {/* Change role */}
            <select
              value={m.role}
              onChange={(e) => changeRole(m.user_id, e.target.value as "admin" | "member")}
              style={{
                height: 32, padding: "0 8px",
                border: `1px solid ${c.line}`, borderRadius: 7,
                fontSize: 12, color: c.ink, background: "#fff",
                cursor: "pointer",
              }}
              title="Change role"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>

            <button
              onClick={() => removeMember(m.user_id, m.email)}
              title="Remove from workspace"
              style={{
                height: 32, padding: "0 12px",
                background: "#fef2f2", color: "#dc2626",
                border: "1px solid #fecaca", borderRadius: 7,
                fontSize: 12, cursor: "pointer",
              }}
            >
              Remove
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}
