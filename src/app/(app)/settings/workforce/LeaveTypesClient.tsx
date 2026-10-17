"use client";

import { useCallback, useEffect, useState } from "react";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { useFeel } from "@/components/FeelProvider";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import StatusPill from "@/components/ui/StatusPill";
import { RecordList, RecordRow } from "@/components/settings/RecordRows";
import { SettingsHeaderActions } from "@/components/settings/SettingsHeaderActions";

type LeaveType = {
  id: string; name: string; category: "paid" | "unpaid" | "half_day"; active: boolean; annual_quota: number;
  quota_period: "year" | "month";
  monthly_limit: number | null; paid_days_per_month: number | null;
  records_count: number; requests_count: number; pending_requests: number;
};

type Draft = { name: string; category: LeaveType["category"]; annual_quota: string; quota_period: "year" | "month"; monthly_limit: string; paid_days_per_month: string };
const EMPTY: Draft = { name: "", category: "paid", annual_quota: "1", quota_period: "month", monthly_limit: "", paid_days_per_month: "" };

const lbl: React.CSSProperties = { display: "block", fontSize: 11.5, fontWeight: 600, color: c.muted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5 };
const inp: React.CSSProperties = { width: "100%", padding: "8px 11px", fontSize: 13, border: `1px solid ${c.line}`, borderRadius: 8, background: c.panel, color: c.ink, outline: "none", boxSizing: "border-box" };

const CATEGORY_LABEL: Record<LeaveType["category"], string> = { paid: "Paid", unpaid: "Unpaid", half_day: "Half-day" };

function fmtLimit(n: number | null): string { return n === null ? "—" : String(n); }

export default function LeaveTypesClient() {
  const { confirm } = useFeel();
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState<Draft>(EMPTY);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Draft>(EMPTY);

  const load = useCallback(async () => {
    const res = await fetch("/api/wfm/leave-types");
    if (res.ok) setTypes(await res.json());
    else setError((await res.json()).error ?? "Failed to load");
  }, []);
  useEffect(() => { load(); }, [load]);

  function draftBody(d: Draft) {
    return {
      name: d.name.trim(), category: d.category,
      annual_quota: parseFloat(d.annual_quota) || 0,
      quota_period: d.quota_period,
      // With a per-month quota the quota IS the cap; a separate cap only
      // makes sense against a yearly quota.
      monthly_limit: d.quota_period === "month" || d.monthly_limit.trim() === "" ? null : parseFloat(d.monthly_limit),
      paid_days_per_month: d.paid_days_per_month.trim() === "" ? null : parseFloat(d.paid_days_per_month),
    };
  }

  async function call(url: string, method: string, body?: unknown): Promise<boolean> {
    setBusy(true); setError("");
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (!res.ok && res.status !== 204) { const j = await res.json().catch(() => ({})); setError(j.error ?? "Request failed"); return false; }
      await load();
      return true;
    } catch { setError("Network error"); return false; } finally { setBusy(false); }
  }

  async function addType() {
    if (!addForm.name.trim()) { setError("Name is required"); return; }
    if (await call("/api/wfm/leave-types", "POST", draftBody(addForm))) { setAddForm(EMPTY); setShowAdd(false); }
  }

  function startEdit(t: LeaveType) {
    setEditId(t.id);
    setEditForm({ name: t.name, category: t.category, annual_quota: String(t.annual_quota), quota_period: t.quota_period ?? "year", monthly_limit: t.monthly_limit === null ? "" : String(t.monthly_limit), paid_days_per_month: t.paid_days_per_month === null ? "" : String(t.paid_days_per_month) });
  }

  async function saveEdit(id: string) {
    if (!editForm.name.trim()) { setError("Name is required"); return; }
    if (await call(`/api/wfm/leave-types/${id}`, "PATCH", draftBody(editForm))) setEditId(null);
  }

  async function toggleActive(t: LeaveType) {
    if (t.active) {
      const ok = await confirm({
        title: `Deactivate "${t.name}"?`,
        body: "Nobody can request it from now on. Past leave under it stays exactly as recorded, and you can reactivate it any time.",
        tone: "danger",
      });
      if (!ok) return;
    }
    await call(`/api/wfm/leave-types/${t.id}`, "PATCH", { active: !t.active });
  }

  async function remove(t: LeaveType) {
    const ok = await confirm({ title: `Delete "${t.name}"?`, body: "It has no leave records or requests, so nothing else refers to it. This can't be undone.", tone: "danger" });
    if (!ok) return;
    await call(`/api/wfm/leave-types/${t.id}`, "DELETE");
  }

  function limitFields(d: Draft, set: (d: Draft) => void) {
    return (
      <>
        <div style={{ flex: "1 1 160px", minWidth: 140 }}><label style={lbl}>Name</label><input style={inp} value={d.name} onChange={(e) => set({ ...d, name: e.target.value })} placeholder="Paid leave" /></div>
        <div style={{ flex: "0 1 120px" }}>
          <label style={lbl}>Category</label>
          <select style={inp} value={d.category} onChange={(e) => set({ ...d, category: e.target.value as LeaveType["category"] })}>
            <option value="paid">Paid</option><option value="unpaid">Unpaid</option><option value="half_day">Half-day</option>
          </select>
        </div>
        <div style={{ flex: "0 1 90px" }}><label style={lbl}>Days</label><input style={inp} type="number" min="0" step="0.5" value={d.annual_quota} onChange={(e) => set({ ...d, annual_quota: e.target.value })} /></div>
        <div style={{ flex: "0 1 120px" }}>
          <label style={lbl}>Per</label>
          <select style={inp} value={d.quota_period} onChange={(e) => set({ ...d, quota_period: e.target.value as "year" | "month" })}>
            <option value="month">Month</option><option value="year">Year</option>
          </select>
        </div>
        {d.quota_period === "year" && (
          <div style={{ flex: "0 1 110px" }}><label style={lbl} title="At most this many days of the type per calendar month. Empty = no monthly cap.">Max a month</label><input style={inp} type="number" min="0.5" max="31" step="0.5" placeholder="no cap" value={d.monthly_limit} onChange={(e) => set({ ...d, monthly_limit: e.target.value })} /></div>
        )}
        <div style={{ flex: "0 1 120px" }}><label style={lbl} title="The first N days in a month are paid; any beyond count as unpaid on the summary. Empty = every day follows the category.">Paid days a month</label><input style={inp} type="number" min="0" max="31" step="0.5" placeholder="all" value={d.paid_days_per_month} onChange={(e) => set({ ...d, paid_days_per_month: e.target.value })} /></div>
      </>
    );
  }

  const formButtons = (onSave: () => void, saveLabel: string, onCancel: () => void) => (
    <div style={{ display: "flex", gap: 6 }}>
      <Button variant="primary" loading={busy} onClick={onSave}>{saveLabel}</Button>
      <Button disabled={busy} onClick={onCancel}>Cancel</Button>
    </div>
  );

  return (
    <>
      <SettingsHeaderActions>
        <Button variant="primary" onClick={() => { setShowAdd(true); setEditId(null); }}>+ New leave type</Button>
      </SettingsHeaderActions>

      {error && <div role="alert" style={{ ...cardStyle, marginBottom: 14, color: "var(--err-ink)", fontSize: 12.5 }}>{error}</div>}

      <div style={{ fontSize: 12, color: c.muted, marginBottom: 12, maxWidth: 780, lineHeight: 1.5 }}>
        What people can request time off as. The <strong>quota</strong> is each employee&apos;s default,
        per month or per year; a monthly quota is also the most anyone can take in that month (a request or an
        entry beyond it is refused). A yearly quota can carry a separate <strong>Max a month</strong> cap.
        <strong> Paid days a month</strong> pays only the first N days of a type each month; the rest count as
        unpaid on the time summary. A type with history can be deactivated, never deleted.
      </div>

      {showAdd && (
        <div style={{ ...cardStyle, marginBottom: 14, background: c.panel2 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: c.ink, marginBottom: 10 }}>New leave type</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            {limitFields(addForm, setAddForm)}
            {formButtons(addType, busy ? "Adding…" : "Add type", () => { setShowAdd(false); setAddForm(EMPTY); setError(""); })}
          </div>
        </div>
      )}

      <RecordList
        empty={
          <EmptyState
            title="No leave types yet"
            text="Until one exists, the Request leave button stays disabled for every employee."
            action={<Button variant="primary" onClick={() => setShowAdd(true)}>+ New leave type</Button>}
          />
        }
      >
        {types.map((t) => {
          const inUse = t.records_count + t.requests_count;
          const usage = inUse === 0
            ? "—"
            : `${t.records_count} record${t.records_count === 1 ? "" : "s"}${t.requests_count ? `, ${t.requests_count} request${t.requests_count === 1 ? "" : "s"}` : ""}${t.pending_requests ? ` (${t.pending_requests} pending)` : ""}`;
          return (
            <RecordRow
              key={t.id}
              title={t.name}
              dim={!t.active}
              status={<StatusPill label={t.active ? "Active" : "Inactive"} tone={t.active ? "green" : "red"} />}
              facts={[
                { label: "Category", value: CATEGORY_LABEL[t.category] ?? t.category },
                { label: "Quota", value: `${t.annual_quota} / ${t.quota_period === "month" ? "month" : "year"}` },
                { label: "Max a month", value: t.quota_period === "month" ? `${t.annual_quota} (quota)` : fmtLimit(t.monthly_limit) },
                { label: "Paid days a month", value: fmtLimit(t.paid_days_per_month) },
                { label: "In use", value: usage },
              ]}
              menu={[
                { label: "Edit", onSelect: () => { startEdit(t); setShowAdd(false); } },
                { label: t.active ? "Deactivate" : "Reactivate", onSelect: () => toggleActive(t) },
                // In use: deactivate instead, or remove its records first.
                { label: "Delete", onSelect: () => remove(t), danger: true, hidden: inUse > 0 },
              ]}
            >
              {editId === t.id && (
                <div style={{ padding: 14, background: c.panel2, borderTop: `1px solid ${c.line}` }}>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                    {limitFields(editForm, setEditForm)}
                    {formButtons(() => saveEdit(t.id), busy ? "Saving…" : "Save", () => { setEditId(null); setError(""); })}
                  </div>
                </div>
              )}
            </RecordRow>
          );
        })}
      </RecordList>
    </>
  );
}
