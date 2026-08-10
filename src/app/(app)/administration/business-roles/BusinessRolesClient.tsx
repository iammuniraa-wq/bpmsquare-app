"use client";

import { useEffect, useState } from "react";
import { c } from "@/lib/theme";
import { WORKCENTERS } from "@/lib/workcenters";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import { STANDARD_ROLE_CATEGORIES, STANDARD_ROLE_BY_KEY } from "@/lib/standardRoles";
import { AdaptDrawer } from "@/components/DashboardLayout";
import type { DashLayoutItem, TenantFeatures } from "@/lib/constants";

type Grant = {
  workcenter: string;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  data_scope: "all" | "territory";
  territories: string[];
};
type BusinessRole = {
  id: string; name: string; description: string | null; grants: Grant[];
  /** Set when this row was materialised from the standard catalog. */
  template_key?: string | null;
  /** Standard roles are read-only -- customise by duplicating (see
   * BUSINESS_ROLES_STANDARD_MAP.md §2). Enforced API-side too. */
  is_standard?: boolean;
  /** The default dashboard members of this role see, unioned with any other
   * role they hold that also defines one (see /api/business-roles/[id]/
   * dashboard). Null/undefined = this role doesn't define one. */
  dashboard_layout?: DashLayoutItem[] | null;
};

type GrantDraft = Record<string, { granted: boolean; can_create: boolean; can_edit: boolean; can_delete: boolean; data_scope: "all" | "territory"; territories: string[] }>;

function emptyDraft(): GrantDraft {
  const d: GrantDraft = {};
  for (const w of WORKCENTERS) d[w.key] = { granted: false, can_create: false, can_edit: false, can_delete: false, data_scope: "all", territories: [] };
  return d;
}

function draftFromGrants(grants: Grant[]): GrantDraft {
  const d = emptyDraft();
  for (const g of grants) {
    d[g.workcenter] = { granted: g.can_view, can_create: g.can_create, can_edit: g.can_edit, can_delete: g.can_delete, data_scope: g.data_scope, territories: g.territories };
  }
  return d;
}

function summarizeGrants(grants: Grant[]): string {
  const granted = grants.filter((g) => g.can_view);
  if (granted.length === 0) return "No workcenters granted";
  const labels = granted.map((g) => WORKCENTERS.find((w) => w.key === g.workcenter)?.label ?? g.workcenter);
  return labels.join(", ");
}

const inputStyle: React.CSSProperties = { padding: "8px 10px", borderRadius: 8, border: `1px solid ${c.line}`, fontSize: 13, background: c.panel, color: c.ink, width: "100%" };
const checkboxCell: React.CSSProperties = { textAlign: "center", padding: "6px 8px" };

export default function BusinessRolesClient({ territories, features }: { territories: string[]; features: TenantFeatures }) {
  const [roles, setRoles] = useState<BusinessRole[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null); // null = not editing, "new" = creating
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [draft, setDraft] = useState<GrantDraft>(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [dashboardSaving, setDashboardSaving] = useState(false);
  const [resyncBusy, setResyncBusy] = useState(false);
  const [resyncMsg, setResyncMsg] = useState("");

  async function load(): Promise<BusinessRole[]> {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/business-roles");
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Failed to load roles"); return []; }
      setRoles(json.roles);
      return json.roles ?? [];
    } catch {
      setError("Could not reach the server.");
      return [];
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function startCreate() {
    setEditingId("new");
    setName("");
    setDescription("");
    setDraft(emptyDraft());
    setSaveError("");
  }

  function startEdit(r: BusinessRole) {
    setEditingId(r.id);
    setName(r.name);
    setDescription(r.description ?? "");
    setDraft(draftFromGrants(r.grants));
    setSaveError("");
  }

  function cancelEdit() {
    setEditingId(null);
    setSaveError("");
  }

  function toggleGranted(key: string) {
    setDraft((d) => ({ ...d, [key]: { ...d[key], granted: !d[key].granted } }));
  }
  function toggleAction(key: string, action: "can_create" | "can_edit" | "can_delete") {
    setDraft((d) => ({ ...d, [key]: { ...d[key], [action]: !d[key][action] } }));
  }
  function setScope(key: string, scope: "all" | "territory") {
    setDraft((d) => ({ ...d, [key]: { ...d[key], data_scope: scope } }));
  }
  function toggleTerritory(key: string, territory: string) {
    setDraft((d) => {
      const current = d[key].territories;
      const next = current.includes(territory) ? current.filter((t) => t !== territory) : [...current, territory];
      return { ...d, [key]: { ...d[key], territories: next } };
    });
  }

  async function save() {
    if (!name.trim()) { setSaveError("Name is required"); return; }
    setSaving(true);
    setSaveError("");

    const grants = WORKCENTERS.filter((w) => draft[w.key].granted).map((w) => ({
      workcenter: w.key,
      can_view: true,
      can_create: draft[w.key].can_create,
      can_edit: draft[w.key].can_edit,
      can_delete: draft[w.key].can_delete,
      data_scope: draft[w.key].data_scope,
      territories: draft[w.key].territories,
    }));

    const isNew = editingId === "new";
    const res = await fetch(isNew ? "/api/business-roles" : `/api/business-roles/${editingId}`, {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), description: description.trim() || null, grants }),
    });
    const json = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) { setSaveError(json.error ?? "Failed to save"); return; }
    setEditingId(null);
    load();
  }

  /** Saves the role currently being edited's default dashboard. Only
   * callable once the role has a real id (not while still creating one) --
   * updates the local roles cache directly rather than a full reload so the
   * drawer's own layout state (seeded from `roles`) doesn't visibly reset. */
  async function saveRoleDashboard(next: DashLayoutItem[]) {
    if (!editingRole) return;
    setDashboardSaving(true);
    const res = await fetch(`/api/business-roles/${editingRole.id}/dashboard`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dashboard_layout: next }),
    });
    setDashboardSaving(false);
    if (!res.ok) return;
    setRoles((prev) => (prev ?? []).map((r) => (r.id === editingRole.id ? { ...r, dashboard_layout: next } : r)));
  }

  /** Re-syncs a standard role's grants/description against the current
   * catalog -- for a tenant that provisioned it before a catalog fix
   * shipped (provisionStandardRoles never updates an existing row). */
  async function resync(r: BusinessRole) {
    setResyncBusy(true);
    setResyncMsg("");
    const res = await fetch(`/api/business-roles/${r.id}/resync`, { method: "POST" });
    const json = await res.json().catch(() => ({}));
    setResyncBusy(false);
    if (!res.ok) { setResyncMsg(json.error ?? "Resync failed"); return; }
    setResyncMsg("Synced with the latest catalog.");
    const fresh = await load();
    const refreshed = fresh.find((x) => x.id === r.id);
    if (refreshed) startEdit(refreshed);
  }

  async function remove(r: BusinessRole) {
    if (!window.confirm(`Delete the "${r.name}" role? Members holding only this role will revert to full (unrestricted) access.`)) return;
    const res = await fetch(`/api/business-roles/${r.id}`, { method: "DELETE" });
    if (res.ok) load();
  }

  /** The supported way to customise a standard role: copy it, then edit the copy. */
  async function duplicate(r: BusinessRole) {
    setSaveError("");
    const res = await fetch("/api/business-roles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ duplicate_of: r.id }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setError(json.error ?? "Could not duplicate this role"); return; }
    await load();
    // Drop straight into the copy so "duplicate and adapt" is one motion.
    startEdit({ ...json, grants: json.grants ?? [] });
  }

  const standardRoles = (roles ?? []).filter((r) => r.is_standard);
  const customRoles = (roles ?? []).filter((r) => !r.is_standard);
  const templateOf = (r: BusinessRole) => (r.template_key ? STANDARD_ROLE_BY_KEY.get(r.template_key) : undefined);

  const editingRole = editingId && editingId !== "new" ? (roles ?? []).find((r) => r.id === editingId) : undefined;
  // A standard role opens in the same editor but read-only -- an admin still
  // wants to SEE exactly what it grants before assigning it.
  const readOnly = !!editingRole?.is_standard;

  if (editingId) {
    return (
      <>
      <div style={{ maxWidth: 900 }}>
        {readOnly && (
          <div style={{ ...cardStyle, marginBottom: 12, fontSize: 12.5, color: c.muted, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <Pill label="Standard role" tone="blue" />
            <span style={{ flex: 1, minWidth: 220 }}>
              This role ships with BPMSquare and stays up to date automatically, so it can&apos;t be edited directly.
              {resyncMsg && <span style={{ color: c.accent, fontWeight: 600, marginLeft: 6 }}>{resyncMsg}</span>}
            </span>
            <button
              onClick={() => editingRole && resync(editingRole)}
              disabled={resyncBusy}
              title="Re-apply this role's grants and description from the current catalog -- use this if it was provisioned before a catalog fix shipped."
              style={{ padding: "7px 14px", borderRadius: 7, fontSize: 12.5, fontWeight: 500, background: "none", color: c.accent, border: `1px solid ${c.line}`, cursor: resyncBusy ? "wait" : "pointer", whiteSpace: "nowrap" }}
            >
              {resyncBusy ? "Syncing…" : "Sync with catalog"}
            </button>
            <button
              onClick={() => editingRole && duplicate(editingRole)}
              style={{ padding: "7px 14px", borderRadius: 7, fontSize: 12.5, fontWeight: 600, background: c.accent, color: c.panel, border: "none", cursor: "pointer", whiteSpace: "nowrap" }}
            >
              Duplicate &amp; edit
            </button>
          </div>
        )}
        <div style={{ ...cardStyle, marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 }}>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sales Rep" style={inputStyle} disabled={readOnly} />
            </div>
            <div style={{ flex: 2, minWidth: 240 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 }}>Description (optional)</label>
              <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this role is for" style={inputStyle} disabled={readOnly} />
            </div>
          </div>

          <div style={{ overflowX: "auto", border: `1px solid ${c.line}`, borderRadius: 9 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr>
                  {["Workcenter", "View", "Create", "Edit", "Delete", "Data scope"].map((h) => (
                    <th key={h} style={{ padding: "9px 11px", textAlign: h === "Workcenter" ? "left" : "center", color: c.hint, fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, borderBottom: `1px solid ${c.line}`, background: c.panel2, whiteSpace: "nowrap" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {WORKCENTERS.map((w) => {
                  const g = draft[w.key];
                  return (
                    <tr key={w.key} style={{ opacity: g.granted ? 1 : 0.55 }}>
                      <td style={{ padding: "8px 11px", borderBottom: `1px solid ${c.line}`, color: c.ink, fontWeight: 500 }}>
                        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                          <input type="checkbox" checked={g.granted} onChange={() => toggleGranted(w.key)} disabled={readOnly} />
                          {w.label}
                        </label>
                      </td>
                      <td style={{ ...checkboxCell, borderBottom: `1px solid ${c.line}`, color: c.hint, fontSize: 11 }}>{g.granted ? "✓" : "—"}</td>
                      <td style={{ ...checkboxCell, borderBottom: `1px solid ${c.line}` }}>
                        <input type="checkbox" disabled={readOnly || !g.granted} checked={g.can_create} onChange={() => toggleAction(w.key, "can_create")} />
                      </td>
                      <td style={{ ...checkboxCell, borderBottom: `1px solid ${c.line}` }}>
                        <input type="checkbox" disabled={readOnly || !g.granted} checked={g.can_edit} onChange={() => toggleAction(w.key, "can_edit")} />
                      </td>
                      <td style={{ ...checkboxCell, borderBottom: `1px solid ${c.line}` }}>
                        <input type="checkbox" disabled={readOnly || !g.granted} checked={g.can_delete} onChange={() => toggleAction(w.key, "can_delete")} />
                      </td>
                      <td style={{ padding: "6px 11px", borderBottom: `1px solid ${c.line}`, minWidth: 220 }}>
                        {w.territoryScopable && g.granted ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <select
                              value={g.data_scope}
                              onChange={(e) => setScope(w.key, e.target.value as "all" | "territory")}
                              disabled={readOnly}
                              style={{ padding: "5px 8px", borderRadius: 6, border: `1px solid ${c.line}`, fontSize: 11.5, background: c.panel, color: c.ink }}
                            >
                              <option value="all">All territories</option>
                              <option value="territory">Specific territories</option>
                            </select>
                            {g.data_scope === "territory" && (
                              territories.length === 0 ? (
                                <span style={{ fontSize: 10.5, color: c.hint }}>No territories configured (Settings → Sales)</span>
                              ) : (
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                  {territories.map((t) => (
                                    <label key={t} style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10.5, color: c.muted, border: `1px solid ${c.line}`, borderRadius: 5, padding: "2px 6px", cursor: "pointer" }}>
                                      <input type="checkbox" checked={g.territories.includes(t)} onChange={() => toggleTerritory(w.key, t)} disabled={readOnly} style={{ width: 11, height: 11 }} />
                                      {t}
                                    </label>
                                  ))}
                                </div>
                              )
                            )}
                          </div>
                        ) : (
                          <span style={{ fontSize: 11, color: c.hint }}>{g.granted ? "N/A" : "—"}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {saveError && (
            <div style={{ marginTop: 12, fontSize: 12, color: "var(--err-ink)", background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 7, padding: "8px 12px" }}>
              {saveError}
            </div>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            {!readOnly && (
              <button onClick={save} disabled={saving} style={{ padding: "9px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, background: c.accent, color: c.panel, border: "none", cursor: saving ? "wait" : "pointer" }}>
                {saving ? "Saving…" : "Save role"}
              </button>
            )}
            <button onClick={cancelEdit} style={{ padding: "9px 18px", borderRadius: 8, fontSize: 13, fontWeight: 500, background: "none", color: c.muted, border: `1px solid ${c.line}`, cursor: "pointer" }}>
              {readOnly ? "Back to roles" : "Cancel"}
            </button>
          </div>
        </div>

        {!readOnly && editingRole && (
          <div style={{ ...cardStyle }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: c.ink, marginBottom: 3 }}>Dashboard</div>
            <div style={{ fontSize: 12, color: c.muted, marginBottom: 12 }}>
              What members holding this role see on their dashboard by default. Holding more than one role
              shows the union of every role's dashboard; a role left unset here contributes nothing, and members
              fall back to the tenant-wide default until you set one.
            </div>
            <div style={{ fontSize: 11.5, color: c.hint, marginBottom: 10 }}>
              {editingRole.dashboard_layout && editingRole.dashboard_layout.length > 0
                ? `${editingRole.dashboard_layout.filter((b) => !b.hidden).length} widget(s) configured`
                : "No custom dashboard set — members fall back to the tenant-wide default"}
            </div>
            <button
              onClick={() => setDashboardOpen(true)}
              style={{ padding: "8px 16px", borderRadius: 7, fontSize: 12.5, fontWeight: 600, background: "none", color: c.accent, border: `1px solid ${c.accent}`, cursor: "pointer" }}
            >
              Customize this role's dashboard →
            </button>
          </div>
        )}

        {!readOnly && editingId === "new" && (
          <div style={{ ...cardStyle, fontSize: 12, color: c.hint }}>
            Save this role first to customize its dashboard.
          </div>
        )}
      </div>

      {dashboardOpen && editingRole && (
        <AdaptDrawer
          layout={editingRole.dashboard_layout ?? []}
          features={features}
          onLayoutChange={saveRoleDashboard}
          onClose={() => setDashboardOpen(false)}
          saving={dashboardSaving}
          title={`Dashboard — ${editingRole.name}`}
          subtitle="Seen by everyone holding this role"
          onReset={editingRole.dashboard_layout && editingRole.dashboard_layout.length > 0 ? () => saveRoleDashboard([]) : undefined}
          resetLabel="Clear this role's dashboard"
        />
      )}
      </>
    );
  }

  return (
    <div style={{ maxWidth: 780 }}>
      <div style={{ marginBottom: 14 }}>
        <button onClick={startCreate} style={{ padding: "9px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, background: c.accent, color: c.panel, border: "none", cursor: "pointer" }}>
          + New role
        </button>
      </div>

      {error && (
        <div style={{ background: "#fbe9e7", border: "1px solid #c6282840", borderRadius: 10, padding: "13px 16px", fontSize: 12.5, color: "#c62828", marginBottom: 14 }}>
          {error}
        </div>
      )}
      {loading && <div style={{ fontSize: 13, color: c.muted, padding: "16px 0", textAlign: "center" }}>Loading…</div>}

      {!loading && roles && customRoles.length === 0 && standardRoles.length === 0 && (
        <div style={{ ...cardStyle, textAlign: "center", color: c.muted, fontSize: 13, padding: 24 }}>
          No Business Roles yet. Everyone keeps full access until you create one and assign it to someone in Settings → Team.
        </div>
      )}

      {!loading && standardRoles.length > 0 && (
        <>
          <SectionHeading
            title="Standard roles"
            hint="Shipped with BPMSquare and kept up to date for you, so they can't be edited directly. Duplicate one to make a version you can change."
          />
          {STANDARD_ROLE_CATEGORIES.map((cat) => {
            const inCat = standardRoles.filter((r) => templateOf(r)?.category === cat.key);
            if (inCat.length === 0) return null;
            return (
              <div key={cat.key} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, margin: "0 0 7px 2px" }}>
                  {cat.label}
                </div>
                {inCat.map((r) => (
                  <RoleCard
                    key={r.id}
                    role={r}
                    onPrimary={() => startEdit(r)}
                    primaryLabel="View"
                    onDuplicate={() => duplicate(r)}
                  />
                ))}
              </div>
            );
          })}
        </>
      )}

      {!loading && customRoles.length > 0 && (
        <>
          <SectionHeading title="Your roles" hint="Roles you created or adapted. Fully editable." />
          {customRoles.map((r) => (
            <RoleCard
              key={r.id}
              role={r}
              onPrimary={() => startEdit(r)}
              primaryLabel="Edit"
              onDuplicate={() => duplicate(r)}
              onDelete={() => remove(r)}
            />
          ))}
        </>
      )}
    </div>
  );
}

function SectionHeading({ title, hint }: { title: string; hint: string }) {
  return (
    <div style={{ margin: "18px 0 10px" }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: c.ink }}>{title}</div>
      <div style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>{hint}</div>
    </div>
  );
}

function RoleCard({
  role, onPrimary, primaryLabel, onDuplicate, onDelete,
}: {
  role: BusinessRole;
  onPrimary: () => void;
  primaryLabel: string;
  onDuplicate: () => void;
  onDelete?: () => void;
}) {
  const btn: React.CSSProperties = {
    padding: "7px 14px", borderRadius: 7, fontSize: 12.5, fontWeight: 500,
    background: "none", color: c.accent, border: `1px solid ${c.line}`,
    cursor: "pointer", whiteSpace: "nowrap",
  };
  return (
    <div style={{ ...cardStyle, marginBottom: 10, display: "flex", alignItems: "flex-start", gap: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: c.ink, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {role.name}
          {role.is_standard && <Pill label="Standard" tone="blue" />}
        </div>
        {role.description && <div style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>{role.description}</div>}
        <div style={{ fontSize: 11.5, color: c.hint, marginTop: 6 }}>{summarizeGrants(role.grants)}</div>
      </div>
      <button onClick={onPrimary} style={btn}>{primaryLabel}</button>
      <button onClick={onDuplicate} style={btn}>Duplicate</button>
      {onDelete && (
        <button onClick={onDelete} style={{ ...btn, background: "var(--err-bg)", color: "var(--err-ink)", border: "1px solid var(--err-line)" }}>
          Delete
        </button>
      )}
    </div>
  );
}
