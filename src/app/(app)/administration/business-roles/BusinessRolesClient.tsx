"use client";

import { useEffect, useState } from "react";
import { c } from "@/lib/theme";
import { WORKCENTERS } from "@/lib/workcenters";
import { STANDARD_ROLE_CATEGORIES, STANDARD_ROLE_BY_KEY } from "@/lib/standardRoles";
import { cardStyle } from "@/components/Shell";

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
  template_key: string | null; is_standard: boolean;
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

export default function BusinessRolesClient({ territories }: { territories: string[] }) {
  const [roles, setRoles] = useState<BusinessRole[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null); // null = not editing, "new" = creating
  const [editingIsStandard, setEditingIsStandard] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [draft, setDraft] = useState<GrantDraft>(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const standardRoles = (roles ?? []).filter((r) => r.is_standard);
  const customRoles = (roles ?? []).filter((r) => !r.is_standard);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/business-roles");
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Failed to load roles"); return; }
      setRoles(json.roles);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function startCreate() {
    setEditingId("new");
    setEditingIsStandard(false);
    setName("");
    setDescription("");
    setDraft(emptyDraft());
    setSaveError("");
  }

  function startEdit(r: BusinessRole) {
    setEditingId(r.id);
    setEditingIsStandard(r.is_standard);
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

  async function remove(r: BusinessRole) {
    if (r.is_standard) return;
    if (!window.confirm(`Delete the "${r.name}" role? Members holding only this role will revert to full (unrestricted) access.`)) return;
    const res = await fetch(`/api/business-roles/${r.id}`, { method: "DELETE" });
    if (res.ok) load();
  }

  /** Standard roles are read-only -- customising one means creating a normal
   * (non-standard) copy with the same starting grants, which the admin is
   * then free to edit like any hand-made role. */
  async function duplicate() {
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
    const res = await fetch("/api/business-roles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `${name} (Custom)`, description: description.trim() || null, grants }),
    });
    const json = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) { setSaveError(json.error ?? "Failed to duplicate"); return; }
    setEditingId(null);
    load();
  }

  if (editingId) {
    const readOnly = editingIsStandard;
    return (
      <div style={{ maxWidth: 900 }}>
        <div style={{ ...cardStyle, marginBottom: 16 }}>
          {readOnly && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, fontSize: 12.5, color: c.muted, background: c.panel2, border: `1px solid ${c.line}`, borderRadius: 8, padding: "9px 12px" }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: "#1d4ed8", background: "#dbeafe", borderRadius: 5, padding: "2px 7px", letterSpacing: 0.3 }}>STANDARD</span>
              Built-in role — grants are read-only. Duplicate it to customise.
            </div>
          )}
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
                        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: readOnly ? "default" : "pointer" }}>
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
                                    <label key={t} style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10.5, color: c.muted, border: `1px solid ${c.line}`, borderRadius: 5, padding: "2px 6px", cursor: readOnly ? "default" : "pointer" }}>
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
            {readOnly ? (
              <button onClick={duplicate} disabled={saving} style={{ padding: "9px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, background: c.accent, color: c.panel, border: "none", cursor: saving ? "wait" : "pointer" }}>
                {saving ? "Duplicating…" : "Duplicate as custom role"}
              </button>
            ) : (
              <button onClick={save} disabled={saving} style={{ padding: "9px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, background: c.accent, color: c.panel, border: "none", cursor: saving ? "wait" : "pointer" }}>
                {saving ? "Saving…" : "Save role"}
              </button>
            )}
            <button onClick={cancelEdit} style={{ padding: "9px 18px", borderRadius: 8, fontSize: 13, fontWeight: 500, background: "none", color: c.muted, border: `1px solid ${c.line}`, cursor: "pointer" }}>
              {readOnly ? "Close" : "Cancel"}
            </button>
          </div>
        </div>
      </div>
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

      {!loading && roles && roles.length === 0 && (
        <div style={{ ...cardStyle, textAlign: "center", color: c.muted, fontSize: 13, padding: 24 }}>
          No Business Roles yet. Everyone keeps full access until you create one and assign it to someone in Settings → Team.
        </div>
      )}

      {!loading && standardRoles.length > 0 && (
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 }}>
            Standard roles
          </div>
          {STANDARD_ROLE_CATEGORIES.map((cat) => {
            const inCategory = standardRoles.filter((r) => STANDARD_ROLE_BY_KEY.get(r.template_key ?? "")?.category === cat.key);
            if (inCategory.length === 0) return null;
            return (
              <div key={cat.key} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: c.muted, marginBottom: 6 }}>{cat.label}</div>
                {inCategory.map((r) => (
                  <div key={r.id} style={{ ...cardStyle, marginBottom: 8, display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: c.ink }}>{r.name}</span>
                        <span style={{ fontSize: 9.5, fontWeight: 700, color: "#1d4ed8", background: "#dbeafe", borderRadius: 5, padding: "2px 6px", letterSpacing: 0.3 }}>STANDARD</span>
                      </div>
                      {r.description && <div style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>{r.description}</div>}
                      <div style={{ fontSize: 11.5, color: c.hint, marginTop: 6 }}>{summarizeGrants(r.grants)}</div>
                    </div>
                    <button onClick={() => startEdit(r)} style={{ padding: "7px 14px", borderRadius: 7, fontSize: 12.5, fontWeight: 500, background: "none", color: c.accent, border: `1px solid ${c.line}`, cursor: "pointer", whiteSpace: "nowrap" }}>
                      View
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {!loading && customRoles.length > 0 && (
        <div>
          {standardRoles.length > 0 && (
            <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 }}>
              Custom roles
            </div>
          )}
          {customRoles.map((r) => (
            <div key={r.id} style={{ ...cardStyle, marginBottom: 10, display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: c.ink }}>{r.name}</div>
                {r.description && <div style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>{r.description}</div>}
                <div style={{ fontSize: 11.5, color: c.hint, marginTop: 6 }}>{summarizeGrants(r.grants)}</div>
              </div>
              <button onClick={() => startEdit(r)} style={{ padding: "7px 14px", borderRadius: 7, fontSize: 12.5, fontWeight: 500, background: "none", color: c.accent, border: `1px solid ${c.line}`, cursor: "pointer", whiteSpace: "nowrap" }}>
                Edit
              </button>
              <button onClick={() => remove(r)} style={{ padding: "7px 14px", borderRadius: 7, fontSize: 12.5, background: "var(--err-bg)", color: "var(--err-ink)", border: "1px solid var(--err-line)", cursor: "pointer", whiteSpace: "nowrap" }}>
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
