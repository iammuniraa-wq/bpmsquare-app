"use client";

import { useCallback, useEffect, useState } from "react";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import StatusPill from "@/components/ui/StatusPill";
import { RecordList, RecordRow } from "@/components/settings/RecordRows";
import { SettingsHeaderActions } from "@/components/settings/SettingsHeaderActions";
import { useFeel } from "@/components/FeelProvider";
import type { WfmShift } from "@/lib/wfm/types";
import { useCurrency } from "@/lib/tenant-context";
import { formatMoney, moneyLabel } from "@/lib/currency";

const lbl: React.CSSProperties = {
  display: "block", fontSize: 11.5, fontWeight: 600,
  color: c.muted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5,
};
const inp: React.CSSProperties = {
  width: "100%", padding: "8px 11px", fontSize: 13,
  border: `1px solid ${c.line}`, borderRadius: 8,
  background: c.panel, color: c.ink, outline: "none", boxSizing: "border-box",
};

const hhmm = (t: string) => t.slice(0, 5);

const BLANK_FORM = {
  name: "", start_time: "09:00", end_time: "18:00", grace_minutes: "10",
  is_night_shift: false, night_allowance_amount: "0",
};

export default function ShiftsClient({ canEdit }: { canEdit: boolean }) {
  const cur = useCurrency();
  const { confirm } = useFeel();
  const [shifts, setShifts] = useState<WfmShift[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // null = adding a new shift; an id = editing that existing one. The form
  // card above the table always reflects whichever mode is active, so
  // there's exactly one form on the page, never a second copy per row.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [shiftForm, setShiftForm] = useState(BLANK_FORM);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/wfm/shifts");
    if (res.ok) setShifts(await res.json());
    else setError((await res.json()).error ?? "Failed to load");
  }, []);

  useEffect(() => { load(); }, [load]);

  async function post(url: string, body: unknown, method = "POST") {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Request failed"); return false; }
      await load();
      return true;
    } catch {
      setError("Network error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function startEdit(s: WfmShift) {
    setEditingId(s.id);
    setFormOpen(true);
    setShiftForm({
      name: s.name,
      start_time: hhmm(s.start_time),
      end_time: hhmm(s.end_time),
      grace_minutes: String(s.grace_minutes),
      is_night_shift: s.is_night_shift,
      night_allowance_amount: String(s.night_allowance_amount),
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setFormOpen(false);
    setShiftForm(BLANK_FORM);
    setError("");
  }

  async function deleteShift(s: WfmShift) {
    const ok = await confirm({
      title: `Delete "${s.name}"?`,
      body: "This can't be undone. If any employees or roster days still use this shift, deletion is blocked instead of silently reassigning them — you'll need to move those first.",
      confirmLabel: "Delete shift",
      tone: "danger",
    });
    if (!ok) return;
    const deleted = await post(`/api/wfm/shifts/${s.id}`, {}, "DELETE");
    if (deleted && editingId === s.id) cancelEdit();
  }

  async function saveShift() {
    if (!shiftForm.name.trim()) { setError("Shift needs a name"); return; }
    const payload = {
      name: shiftForm.name,
      start_time: shiftForm.start_time,
      end_time: shiftForm.end_time,
      grace_minutes: parseInt(shiftForm.grace_minutes) || 0,
      is_night_shift: shiftForm.is_night_shift,
      night_allowance_amount: parseFloat(shiftForm.night_allowance_amount) || 0,
    };
    const ok = editingId
      ? await post(`/api/wfm/shifts/${editingId}`, payload, "PATCH")
      : await post("/api/wfm/shifts", payload);
    if (ok) cancelEdit();
  }

  return (
    <>
      {error && (
        <div style={{ ...cardStyle, marginBottom: 14, color: "#ef4444", fontSize: 12.5 }}>{error}</div>
      )}

      {canEdit && formOpen && (
        <section style={{ ...cardStyle, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: c.ink, marginBottom: 10 }}>
            {editingId ? "Edit shift" : "New shift"}
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ flex: "1 1 150px" }}>
              <label style={lbl}>Name</label>
              <input style={inp} value={shiftForm.name} onChange={(e) => setShiftForm({ ...shiftForm, name: e.target.value })} placeholder="General shift" />
            </div>
            <div style={{ flex: "0 1 110px" }}>
              <label style={lbl}>Start</label>
              <input style={inp} type="time" value={shiftForm.start_time} onChange={(e) => setShiftForm({ ...shiftForm, start_time: e.target.value })} />
            </div>
            <div style={{ flex: "0 1 110px" }}>
              <label style={lbl}>End</label>
              <input style={inp} type="time" value={shiftForm.end_time} onChange={(e) => setShiftForm({ ...shiftForm, end_time: e.target.value })} />
            </div>
            <div style={{ flex: "0 1 90px" }}>
              <label style={lbl}>Grace (min)</label>
              <input style={inp} value={shiftForm.grace_minutes} onChange={(e) => setShiftForm({ ...shiftForm, grace_minutes: e.target.value })} />
            </div>
            <div style={{ flex: "0 1 120px" }}>
              <label style={lbl}>Night shift</label>
              <select
                style={inp}
                value={shiftForm.is_night_shift ? "yes" : "no"}
                onChange={(e) => setShiftForm({ ...shiftForm, is_night_shift: e.target.value === "yes" })}
              >
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            </div>
            {shiftForm.is_night_shift && (
              <div style={{ flex: "0 1 130px" }}>
                <label style={lbl}>{moneyLabel("Allowance", cur)}</label>
                <input style={inp} value={shiftForm.night_allowance_amount} onChange={(e) => setShiftForm({ ...shiftForm, night_allowance_amount: e.target.value })} />
              </div>
            )}
            <Button variant="primary" loading={busy} onClick={saveShift}>{busy ? "Saving…" : editingId ? "Save changes" : "Add shift"}</Button>
            <Button disabled={busy} onClick={cancelEdit}>Cancel</Button>
          </div>
          <div style={{ fontSize: 12, color: c.muted, marginTop: 10, maxWidth: 780 }}>
            Working hours people are expected to keep. <strong>Grace</strong> is how late someone can
            check in before it counts as a late mark. A shift whose end time is earlier than its start
            time runs past midnight — tick <strong>Night shift</strong> so those night hours are
            counted on the day the shift started, not split across two days.
          </div>
        </section>
      )}

      {canEdit && (
        <SettingsHeaderActions>
          <Button variant="primary" onClick={() => { setEditingId(null); setShiftForm(BLANK_FORM); setError(""); setFormOpen(true); }}>
            + New shift
          </Button>
        </SettingsHeaderActions>
      )}

      <RecordList
        empty={
          <EmptyState
            title="No shifts yet"
            text="Without one, nobody can be marked late or absent — attendance is recorded but never measured against expected hours."
            action={canEdit ? <Button variant="primary" onClick={() => setFormOpen(true)}>+ New shift</Button> : undefined}
          />
        }
      >
        {shifts.map((s) => (
          <RecordRow
            key={s.id}
            title={s.name}
            dim={!s.active}
            status={
              <>
                {s.is_night_shift && <StatusPill label="Night" tone="purple" />}
                <StatusPill label={s.active ? "Active" : "Inactive"} tone={s.active ? "green" : "red"} />
              </>
            }
            facts={[
              { label: "Timing", value: <>{hhmm(s.start_time)} – {hhmm(s.end_time)}{s.crosses_midnight && <span style={{ color: c.hint, marginLeft: 6, fontSize: 11 }}>next day</span>}</> },
              { label: "Grace", value: `${s.grace_minutes} min` },
              ...(s.is_night_shift ? [{ label: "Night allowance", value: `${formatMoney(s.night_allowance_amount, cur, {})}/shift` }] : []),
            ]}
            menu={canEdit ? [
              { label: "Edit", onSelect: () => startEdit(s) },
              { label: s.active ? "Deactivate" : "Activate", onSelect: () => { void post(`/api/wfm/shifts/${s.id}`, { active: !s.active }, "PATCH"); } },
              { label: "Delete", onSelect: () => { void deleteShift(s); }, danger: true },
            ] : undefined}
          />
        ))}
      </RecordList>
    </>
  );
}
