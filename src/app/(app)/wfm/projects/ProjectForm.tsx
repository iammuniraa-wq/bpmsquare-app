"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { c, statusInk } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { ROUTES } from "@/lib/constants";
import type { WfmProject, WfmProjectStatus } from "@/lib/wfm/types";

const STATUSES: { value: WfmProjectStatus; label: string }[] = [
  { value: "planned", label: "Planned" },
  { value: "active", label: "Active" },
  { value: "on_hold", label: "On hold" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

const label: React.CSSProperties = {
  display: "block", fontSize: 11.5, fontWeight: 600, color: c.hint,
  textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5,
};
const field: React.CSSProperties = {
  width: "100%", padding: "8px 10px", borderRadius: 7, fontSize: 13.5,
  border: `1px solid ${c.line}`, background: c.panel2, color: c.ink,
};

type Site = { id: string; name: string };

/**
 * Create/edit form for a project. Sites are picked here rather than on the
 * Sites screen because the link is a property of the PROJECT's life (it
 * starts and ends), not of the site, which outlives every project on it.
 */
export default function ProjectForm({ project }: { project?: WfmProject }) {
  const router = useRouter();
  const editing = !!project;

  const [name, setName] = useState(project?.name ?? "");
  const [code, setCode] = useState(project?.code ?? "");
  const [status, setStatus] = useState<WfmProjectStatus>(project?.status ?? "active");
  const [startDate, setStartDate] = useState(project?.start_date ?? "");
  const [endDate, setEndDate] = useState(project?.end_date ?? "");
  const [budgetHours, setBudgetHours] = useState(project?.budget_hours != null ? String(project.budget_hours) : "");
  const [siteIds, setSiteIds] = useState<string[]>(project?.site_ids ?? []);

  const [sites, setSites] = useState<Site[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/wfm/sites")
      .then((r) => (r.ok ? r.json() : []))
      .then((j) => setSites(Array.isArray(j) ? j : (j?.sites ?? [])))
      .catch(() => setSites([]));
  }, []);

  const toggleSite = (id: string) =>
    setSiteIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim()) { setError("Give the project a name."); return; }
    setSaving(true);

    const body = {
      name: name.trim(),
      code: code.trim() || null,
      status,
      start_date: startDate || null,
      end_date: endDate || null,
      budget_hours: budgetHours.trim() === "" ? null : Number(budgetHours),
      site_ids: siteIds,
    };

    const res = await fetch(
      editing ? `/api/wfm/projects/${project!.id}` : "/api/wfm/projects",
      {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    ).catch(() => null);

    setSaving(false);
    if (!res) { setError("Network error — nothing was saved."); return; }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setError(json.error ?? "Could not save the project."); return; }

    router.push(editing ? ROUTES.wfmProject(project!.id) : ROUTES.wfmProjects);
    router.refresh();
  }

  return (
    <form onSubmit={save} style={{ ...cardStyle, padding: 20, maxWidth: 720 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={label}>Project name</label>
          <input style={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tower B — lift installation" />
        </div>

        <div>
          <label style={label}>Job / contract no.</label>
          <input style={field} value={code} onChange={(e) => setCode(e.target.value)} placeholder="the client's own number" />
        </div>

        <div>
          <label style={label}>Status</label>
          <select style={field} value={status} onChange={(e) => setStatus(e.target.value as WfmProjectStatus)}>
            {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>

        <div>
          <label style={label}>Start date</label>
          <input type="date" style={field} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>

        <div>
          <label style={label}>End date</label>
          <input type="date" style={field} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>

        <div>
          <label style={label}>Budget hours</label>
          <input type="number" min="0" step="0.5" style={field} value={budgetHours} onChange={(e) => setBudgetHours(e.target.value)} placeholder="optional" />
        </div>

        <div style={{ gridColumn: "1 / -1" }}>
          <label style={label}>Sites</label>
          <div style={{ fontSize: 11.5, color: c.hint, marginBottom: 8, lineHeight: 1.5 }}>
            Where this project is worked. When a site has exactly one active project,
            punches there are attributed to it automatically — no roster entry needed.
            With two or more, the roster decides.
          </div>
          {sites.length === 0 ? (
            <div style={{ fontSize: 12.5, color: c.hint }}>No sites configured yet.</div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {sites.map((s) => {
                const on = siteIds.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggleSite(s.id)}
                    style={{
                      fontSize: 12.5, fontWeight: on ? 700 : 500, cursor: "pointer",
                      color: on ? c.accent : c.muted,
                      background: on ? c.accentbg : c.panel2,
                      border: `1px solid ${on ? c.accent + "60" : c.line}`,
                      borderRadius: 6, padding: "5px 12px",
                    }}
                  >
                    {on ? "✓ " : ""}{s.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {error && <div style={{ marginTop: 14, fontSize: 12.5, color: statusInk.bad }}>{error}</div>}

      <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
        <button
          type="submit"
          disabled={saving}
          style={{
            padding: "8px 18px", borderRadius: 7, fontSize: 13, fontWeight: 600,
            background: c.accent, color: "#fff", border: "none",
            cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? "Saving…" : editing ? "Save changes" : "Create project"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          style={{
            padding: "8px 18px", borderRadius: 7, fontSize: 13, fontWeight: 600,
            background: "none", color: c.muted, border: `1px solid ${c.line}`, cursor: "pointer",
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
