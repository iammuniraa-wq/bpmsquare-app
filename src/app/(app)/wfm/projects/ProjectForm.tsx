"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { c, statusInk } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { ROUTES } from "@/lib/constants";
import type { WfmProject, WfmProjectStatus } from "@/lib/wfm/types";

const STATUSES: { value: WfmProjectStatus; label: string; hint: string }[] = [
  { value: "active", label: "Active", hint: "Collecting hours now" },
  { value: "planned", label: "Planned", hint: "Not started — collects nothing yet" },
  { value: "on_hold", label: "On hold", hint: "Paused — collects nothing" },
  { value: "completed", label: "Completed", hint: "Finished — stops collecting" },
  { value: "cancelled", label: "Cancelled", hint: "Collects nothing" },
];

const label: React.CSSProperties = {
  display: "block", fontSize: 11.5, fontWeight: 600, color: c.hint,
  textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5,
};
const field: React.CSSProperties = {
  width: "100%", padding: "8px 10px", borderRadius: 7, fontSize: 13.5,
  border: `1px solid ${c.line}`, background: c.panel2, color: c.ink,
};

type Option = { id: string; name: string };

/** The four ways a punch can find its project, in the order they are tried.
 *  Shown on the screen rather than buried in a doc — this is the whole mental
 *  model, and an admin choosing what to link needs it in front of them. */
const LADDER = [
  { n: "1", title: "The roster", body: "If a supervisor put someone on a job for that date, that wins." },
  { n: "2", title: "People", body: "Then: is this person linked to a job? Follows them anywhere." },
  { n: "3", title: "Shifts", body: "Then: is their shift linked to a job?" },
  { n: "4", title: "Sites", body: "Then: does their site have exactly one live job?" },
];

function Picker({
  title, hint, options, selected, onToggle, empty,
}: {
  title: string;
  hint: string;
  options: Option[];
  selected: string[];
  onToggle: (id: string) => void;
  empty: string;
}) {
  return (
    <div style={{ padding: "12px 0", borderTop: `1px solid ${c.line}` }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: c.ink }}>{title}</span>
        <span style={{ fontSize: 12, color: c.hint }}>{hint}</span>
        {selected.length > 0 && (
          <span style={{ marginLeft: "auto", fontSize: 11.5, color: c.accent, fontWeight: 600 }}>
            {selected.length} selected
          </span>
        )}
      </div>
      {options.length === 0 ? (
        <div style={{ fontSize: 12.5, color: c.hint, marginTop: 8 }}>{empty}</div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 9 }}>
          {options.map((o) => {
            const on = selected.includes(o.id);
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => onToggle(o.id)}
                style={{
                  fontSize: 12.5, fontWeight: on ? 700 : 500, cursor: "pointer",
                  color: on ? c.accent : c.muted,
                  background: on ? c.accentbg : c.panel2,
                  border: `1px solid ${on ? c.accent + "60" : c.line}`,
                  borderRadius: 6, padding: "5px 11px",
                }}
              >
                {on ? "✓ " : ""}{o.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Create/edit a project.
 *
 * Deliberately in two halves: what the job IS (name, dates, budget), and
 * where its hours COME FROM (any mix of sites, people and shifts). Linking
 * lives here, on the project, rather than on the roster -- being on a job is
 * a standing fact, not a dated exception, and the roster's own section is for
 * exceptions.
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
  const [employeeIds, setEmployeeIds] = useState<string[]>(project?.employee_ids ?? []);
  const [shiftIds, setShiftIds] = useState<string[]>(project?.shift_ids ?? []);

  const [sites, setSites] = useState<Option[]>([]);
  const [employees, setEmployees] = useState<Option[]>([]);
  const [shifts, setShifts] = useState<Option[]>([]);

  const [showMore, setShowMore] = useState(
    !!(project?.code || project?.start_date || project?.end_date || project?.budget_hours)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const j = async (url: string) => {
      const r = await fetch(url).catch(() => null);
      if (!r || !r.ok) return [];
      const d = await r.json().catch(() => []);
      return Array.isArray(d) ? d : (d?.sites ?? d?.employees ?? d?.shifts ?? []);
    };
    (async () => {
      const [s, e, sh] = await Promise.all([
        j("/api/wfm/sites"),
        j("/api/wfm/employees"),
        j("/api/wfm/shifts"),
      ]);
      setSites(s.map((x: { id: string; name: string }) => ({ id: x.id, name: x.name })));
      setEmployees(
        e
          .filter((x: { status?: string }) => x.status !== "inactive")
          .map((x: { id: string; first_name: string; last_name: string; employee_code: string | null }) => ({
            id: x.id,
            name: [x.first_name, x.last_name].filter(Boolean).join(" ") + (x.employee_code ? ` (${x.employee_code})` : ""),
          }))
      );
      setShifts(
        sh
          .filter((x: { active?: boolean }) => x.active !== false)
          .map((x: { id: string; name: string; start_time?: string; end_time?: string }) => ({
            id: x.id,
            name: x.start_time ? `${x.name} ${x.start_time.slice(0, 5)}–${(x.end_time ?? "").slice(0, 5)}` : x.name,
          }))
      );
    })();
  }, []);

  const toggle = (setter: React.Dispatch<React.SetStateAction<string[]>>) => (id: string) =>
    setter((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const linkCount = siteIds.length + employeeIds.length + shiftIds.length;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim()) { setError("Give the job a name."); return; }
    setSaving(true);

    const body = {
      name: name.trim(),
      code: code.trim() || null,
      status,
      start_date: startDate || null,
      end_date: endDate || null,
      budget_hours: budgetHours.trim() === "" ? null : Number(budgetHours),
      site_ids: siteIds,
      employee_ids: employeeIds,
      shift_ids: shiftIds,
    };

    const res = await fetch(
      editing ? `/api/wfm/projects/${project!.id}` : "/api/wfm/projects",
      { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    ).catch(() => null);

    setSaving(false);
    if (!res) { setError("Network error — nothing was saved."); return; }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setError(json.error ?? "Could not save the job."); return; }

    router.push(editing ? ROUTES.wfmProject(project!.id) : ROUTES.wfmProjects);
    router.refresh();
  }

  return (
    <form onSubmit={save} style={{ maxWidth: 760 }}>
      <div style={{ ...cardStyle, padding: 20 }}>
        <div style={{ marginBottom: 16 }}>
          <label style={label}>Job name</label>
          <input
            style={field}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Tower A — lift overhaul"
            autoFocus
          />
          <div style={{ fontSize: 11.5, color: c.hint, marginTop: 5 }}>
            The only thing needed to create it. Its ID is assigned for you.
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
          <div>
            <label style={label}>Status</label>
            <select style={field} value={status} onChange={(e) => setStatus(e.target.value as WfmProjectStatus)}>
              {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <div style={{ fontSize: 11.5, color: c.hint, marginTop: 5 }}>
              {STATUSES.find((s) => s.value === status)?.hint}
            </div>
          </div>
        </div>

        {!showMore ? (
          <button
            type="button"
            onClick={() => setShowMore(true)}
            style={{
              marginTop: 14, fontSize: 12.5, fontWeight: 600, color: c.accent,
              background: "none", border: "none", cursor: "pointer", padding: 0,
            }}
          >
            + Add dates, budget or a job number
          </button>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginTop: 16 }}>
            <div>
              <label style={label}>Runs from</label>
              <input type="date" style={field} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <label style={label}>Until</label>
              <input type="date" style={field} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <div>
              <label style={label}>Budget hours</label>
              <input type="number" min="0" step="0.5" style={field} value={budgetHours} onChange={(e) => setBudgetHours(e.target.value)} placeholder="optional" />
            </div>
            <div>
              <label style={label}>Your job number</label>
              <input style={field} value={code} onChange={(e) => setCode(e.target.value)} placeholder="optional" />
            </div>
            <div style={{ gridColumn: "1 / -1", fontSize: 11.5, color: c.hint }}>
              Only punches inside the dates count toward this job. The budget is what the
              percentage on the job page is measured against.
            </div>
          </div>
        )}
      </div>

      <div style={{ ...cardStyle, padding: 20, marginTop: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: c.ink }}>Where its hours come from</div>
        <div style={{ fontSize: 12.5, color: c.muted, marginTop: 4, lineHeight: 1.55 }}>
          Link this job to whatever fits — any mix, or none at all. Nobody has to pick a job
          when they punch; it&apos;s worked out from these.
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "14px 0 2px" }}>
          {LADDER.map((r) => (
            <div
              key={r.n}
              style={{
                flex: "1 1 150px", background: c.panel2, borderRadius: 8, padding: "9px 11px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{
                  width: 17, height: 17, borderRadius: 99, background: c.line, color: c.ink,
                  fontSize: 10.5, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center",
                }}>{r.n}</span>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: c.ink }}>{r.title}</span>
              </div>
              <div style={{ fontSize: 11.5, color: c.hint, marginTop: 5, lineHeight: 1.45 }}>{r.body}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11.5, color: c.hint, marginTop: 8, lineHeight: 1.5 }}>
          First match wins. If a step finds two jobs at once, the hours are left
          <strong style={{ color: statusInk.warn }}> unassigned</strong> rather than guessed —
          you&apos;ll see them on the Projects screen and can settle it on the roster.
        </div>

        <div style={{ marginTop: 16 }}>
          <Picker
            title="People"
            hint="These employees, wherever they punch"
            options={employees}
            selected={employeeIds}
            onToggle={toggle(setEmployeeIds)}
            empty="No employees yet."
          />
          <Picker
            title="Shifts"
            hint="Everyone working that shift"
            options={shifts}
            selected={shiftIds}
            onToggle={toggle(setShiftIds)}
            empty="No shifts configured yet."
          />
          <Picker
            title="Sites"
            hint="Anyone punching there — used only if nothing above applies"
            options={sites}
            selected={siteIds}
            onToggle={toggle(setSiteIds)}
            empty="No sites configured yet."
          />
        </div>

        {linkCount === 0 && (
          <div style={{
            marginTop: 14, padding: "10px 12px", borderRadius: 8,
            background: c.panel2, fontSize: 12.5, color: c.muted, lineHeight: 1.5,
          }}>
            Nothing linked yet, which is fine — this job just won&apos;t pick up hours on its own.
            You can still put people on it day by day from the roster.
          </div>
        )}
      </div>

      {error && <div style={{ marginTop: 14, fontSize: 12.5, color: statusInk.bad }}>{error}</div>}

      <div style={{ marginTop: 18, display: "flex", gap: 10 }}>
        <button
          type="submit"
          disabled={saving}
          style={{
            padding: "9px 18px", borderRadius: 7, fontSize: 13, fontWeight: 600,
            background: c.accent, color: "#fff", border: "none",
            cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? "Saving…" : editing ? "Save changes" : "Create job"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          style={{
            padding: "9px 18px", borderRadius: 7, fontSize: 13, fontWeight: 600,
            background: "none", color: c.muted, border: `1px solid ${c.line}`, cursor: "pointer",
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
