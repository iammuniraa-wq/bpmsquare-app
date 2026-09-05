"use client";

import { useCallback, useEffect, useState } from "react";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import { useFeel } from "@/components/FeelProvider";

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
const th: React.CSSProperties = { textAlign: "left", color: c.hint, fontWeight: 500, padding: "9px 12px", borderBottom: `1px solid ${c.line}`, fontSize: 11.5, whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "9px 12px", borderBottom: `1px solid ${c.line}`, fontSize: 12.5, verticalAlign: "middle" };
const btnPrimary: React.CSSProperties = { padding: "8px 14px", fontSize: 12.5, fontWeight: 600, borderRadius: 8, border: "none", background: "var(--tenant-accent, #378ADD)", color: "#fff", cursor: "pointer", whiteSpace: "nowrap" };
const btnQuiet: React.CSSProperties = { padding: "5px 10px", fontSize: 12, fontWeight: 600, borderRadius: 7, border: `1px solid ${c.line}`, background: "transparent", color: c.muted, cursor: "pointer", whiteSpace: "nowrap" };
const btnDanger: React.CSSProperties = { ...btnQuiet, color: "var(--err-ink)", borderColor: "var(--err-line)" };

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

  return (
    <>
      {error && <div style={{ ...cardStyle, marginBottom: 14, color: "#ef4444", fontSize: 12.5 }}>{error}</div>}
      <section style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
        <div style={{ padding: "12px 12px 10px", borderBottom: `1px solid ${c.line}`, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>Leave types</div>
            <div style={{ fontSize: 12, color: c.muted, marginTop: 3, maxWidth: 780 }}>
              What people can request time off as. The <strong>quota</strong> is each employee&apos;s default,
              per month or per year; a monthly quota is also the most anyone can take in that month (a request or an
              entry beyond it is refused). A yearly quota can carry a separate <strong>Max a month</strong> cap.
              <strong> Paid days a month</strong> pays only the first N days of a type each month; the rest count as
              unpaid on the time summary. A type with history can be deactivated, never deleted.
            </div>
          </div>
          {!showAdd && <button style={btnPrimary} onClick={() => { setShowAdd(true); setEditId(null); }}>+ Add type</button>}
        </div>

        {showAdd && (
          <div style={{ display: "flex", gap: 10, padding: 12, flexWrap: "wrap", alignItems: "flex-end", borderBottom: `1px solid ${c.line}`, background: c.panel2 }}>
            {limitFields(addForm, setAddForm)}
            <div style={{ display: "flex", gap: 6 }}>
              <button style={btnPrimary} disabled={busy} onClick={addType}>{busy ? "Adding…" : "Add type"}</button>
              <button style={btnQuiet} disabled={busy} onClick={() => { setShowAdd(false); setAddForm(EMPTY); setError(""); }}>Cancel</button>
            </div>
          </div>
        )}

        <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Name</th><th style={th}>Category</th><th style={th}>Quota</th>
              <th style={th}>Max a month</th><th style={th}>Paid days a month</th><th style={th}>In use</th><th style={th}>Status</th><th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {types.map((t) => {
              const inUse = t.records_count + t.requests_count;
              if (editId === t.id) {
                return (
                  <tr key={t.id}>
                    <td style={{ ...td, background: c.panel2 }} colSpan={8}>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                        {limitFields(editForm, setEditForm)}
                        <div style={{ display: "flex", gap: 6 }}>
                          <button style={btnPrimary} disabled={busy} onClick={() => saveEdit(t.id)}>{busy ? "Saving…" : "Save"}</button>
                          <button style={btnQuiet} disabled={busy} onClick={() => { setEditId(null); setError(""); }}>Cancel</button>
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={t.id} style={{ opacity: t.active ? 1 : 0.6 }}>
                  <td style={{ ...td, fontWeight: 600, color: c.ink }}>{t.name}</td>
                  <td style={td}>{CATEGORY_LABEL[t.category] ?? t.category}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{t.annual_quota} / {t.quota_period === "month" ? "month" : "year"}</td>
                  <td style={td}>{t.quota_period === "month" ? `${t.annual_quota} (quota)` : fmtLimit(t.monthly_limit)}</td>
                  <td style={td}>{fmtLimit(t.paid_days_per_month)}</td>
                  <td style={{ ...td, color: c.muted, whiteSpace: "nowrap" }}>
                    {inUse === 0 ? "—" : `${t.records_count} record${t.records_count === 1 ? "" : "s"}${t.requests_count ? `, ${t.requests_count} request${t.requests_count === 1 ? "" : "s"}` : ""}${t.pending_requests ? ` (${t.pending_requests} pending)` : ""}`}
                  </td>
                  <td style={td}><Pill label={t.active ? "Active" : "Inactive"} tone={t.active ? "green" : "red"} /></td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      <button style={btnQuiet} disabled={busy} onClick={() => { startEdit(t); setShowAdd(false); }}>Edit</button>
                      <button style={btnQuiet} disabled={busy} onClick={() => toggleActive(t)}>{t.active ? "Deactivate" : "Reactivate"}</button>
                      <button
                        style={{ ...btnDanger, opacity: inUse > 0 ? 0.45 : 1, cursor: inUse > 0 ? "not-allowed" : "pointer" }}
                        disabled={busy || inUse > 0}
                        title={inUse > 0 ? "In use — deactivate it instead, or remove its records first" : "Delete this type"}
                        onClick={() => remove(t)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {types.length === 0 && (
              <tr>
                <td style={{ ...td, color: c.hint }} colSpan={8}>
                  No leave types yet. Until one exists, the Request leave button stays disabled for every employee.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}
