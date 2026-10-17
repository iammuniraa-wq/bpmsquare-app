"use client";

import { useMemo, useState } from "react";
import type { TenantFeatures } from "@/lib/tenant";
import { WORKCENTERS } from "@/lib/workcenters";
import { explainNav, LAYER_LABEL, type AccessInput } from "@/lib/accessView";

type UserRow = { user_id: string; email: string | null; role: string };

/**
 * Read-only: pick a person, see which sidebar entries their login gets and,
 * for each one it does not, which of the four layers takes it away (module
 * off / Business Role / Navigation visibility / supervisor-only). It reads
 * the flags currently set in this form, so a flag you have just ticked shows
 * its effect before you save. Nothing here writes anything.
 */
export default function WhoSeesWhat({
  users, access, features, hiddenHrefs,
}: {
  users: UserRow[];
  access: Record<string, AccessInput>;
  features: TenantFeatures;
  hiddenHrefs: string[];
}) {
  const [userId, setUserId] = useState("");
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const choices = useMemo(
    () => users.filter((u) => !q || (u.email ?? "").toLowerCase().includes(q)).slice(0, 200),
    [users, q],
  );
  const a = userId ? access[userId] : undefined;
  const verdicts = useMemo(
    () => (a ? explainNav({ features, hiddenHrefs, access: a }) : []),
    [a, features, hiddenHrefs],
  );

  const groups = useMemo(() => {
    const map = new Map<string, typeof verdicts>();
    for (const v of verdicts) map.set(v.group, [...(map.get(v.group) ?? []), v]);
    return [...map.entries()];
  }, [verdicts]);

  const workcenterLabels = a && a.viewable !== "all"
    ? a.viewable.map((k) => WORKCENTERS.find((w) => w.key === k)?.label ?? k)
    : [];

  return (
    <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 20, marginBottom: 16 }}>
      <h2 style={{ margin: "0 0 6px", fontSize: 14, fontWeight: 600, color: "#374151" }}>Who sees what</h2>
      <p style={{ margin: "0 0 14px", fontSize: 12, color: "#6b7280" }}>
        Four layers decide what a person gets in the sidebar: the module being on for the workspace, their Business Role, the
        workspace&apos;s Navigation visibility, and — for Workforce screens — being a supervisor. Pick someone to see which layer
        hides each thing they are missing. Uses the flags as currently set above; changes nothing.
      </p>

      {users.length > 12 && (
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by email…"
          aria-label="Search users"
          style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", marginBottom: 8, fontSize: 12, border: "1px solid #e5e7eb", borderRadius: 8 }}
        />
      )}
      <select
        value={userId}
        onChange={(e) => setUserId(e.target.value)}
        aria-label="Person"
        style={{ height: 38, border: "1px solid #d1d5db", borderRadius: 8, padding: "0 10px", fontSize: 13, width: "100%", boxSizing: "border-box", color: "#111827" }}
      >
        <option value="">— choose a person —</option>
        {choices.map((u) => (
          <option key={u.user_id} value={u.user_id}>{u.email ?? u.user_id.slice(0, 16)} ({u.role})</option>
        ))}
      </select>

      {a && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, color: "#374151", lineHeight: 1.7, marginBottom: 12 }}>
            <div><b>Role:</b> {a.role}{a.role === "admin" ? " — sees every workcenter their workspace owns" : ""}</div>
            <div>
              <b>Business Roles:</b>{" "}
              {a.role === "admin" ? "not applied to admins" : a.roleNames.length ? a.roleNames.join(", ") : "none assigned — full access (today's default)"}
            </div>
            {a.viewable !== "all" && (
              <div><b>Workcenters granted:</b> {workcenterLabels.length ? workcenterLabels.join(", ") : "none"}</div>
            )}
            <div><b>Workforce supervisor:</b> {a.isWfmSupervisor ? "yes" : "no"}</div>
            {a.blocked && (
              <div style={{ color: "#b91c1c" }}><b>{a.blocked}</b> — they cannot sign in to this workspace, so they see nothing.</div>
            )}
          </div>

          {groups.map(([group, items]) => (
            <div key={group} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}>{group}</div>
              <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
                {items.map((v, i) => (
                  <div
                    key={`${v.parent ?? ""}/${v.href}`}
                    style={{
                      display: "flex", alignItems: "flex-start", gap: 10, padding: "7px 12px", fontSize: 12.5,
                      borderTop: i > 0 ? "1px solid #f3f4f6" : "none",
                      background: v.visible ? "#fff" : "#fafafa",
                    }}
                  >
                    <span aria-hidden style={{ width: 14, color: v.visible ? "#16a34a" : "#9ca3af", fontWeight: 700 }}>{v.visible ? "✓" : "✕"}</span>
                    <span style={{ flex: 1, color: v.visible ? "#111827" : "#6b7280" }}>
                      {v.parent && <span style={{ color: "#9ca3af" }}>{v.parent} › </span>}
                      {v.label}
                    </span>
                    <span style={{ fontSize: 11.5, color: v.visible ? "#16a34a" : "#92400e", textAlign: "right" }}>
                      {v.visible ? "Visible" : v.hiddenBy.map((l) => LAYER_LABEL[l]).join(" · ")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
