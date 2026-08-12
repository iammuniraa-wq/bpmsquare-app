"use client";

import { useCallback, useEffect, useState } from "react";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";

type LeaveType = { id: string; name: string; category: "paid" | "unpaid" | "half_day"; active: boolean; annual_quota: number };

const lbl: React.CSSProperties = { display: "block", fontSize: 11.5, fontWeight: 600, color: c.muted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5 };
const inp: React.CSSProperties = { width: "100%", padding: "8px 11px", fontSize: 13, border: `1px solid ${c.line}`, borderRadius: 8, background: c.panel, color: c.ink, outline: "none", boxSizing: "border-box" };
const th: React.CSSProperties = { textAlign: "left", color: c.hint, fontWeight: 500, padding: "9px 12px", borderBottom: `1px solid ${c.line}`, fontSize: 11.5, whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "9px 12px", borderBottom: `1px solid ${c.line}`, fontSize: 12.5, verticalAlign: "middle" };
const btnPrimary: React.CSSProperties = { padding: "8px 14px", fontSize: 12.5, fontWeight: 600, borderRadius: 8, border: "none", background: "var(--tenant-accent, #378ADD)", color: "#fff", cursor: "pointer" };

export default function LeaveTypesClient() {
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [typeForm, setTypeForm] = useState({ name: "", category: "paid" as LeaveType["category"], annual_quota: "12" });

  const load = useCallback(async () => {
    const res = await fetch("/api/wfm/leave-types");
    if (res.ok) setTypes(await res.json());
    else setError((await res.json()).error ?? "Failed to load");
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addType() {
    if (!typeForm.name.trim()) { setError("Name is required"); return; }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/wfm/leave-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: typeForm.name, category: typeForm.category, annual_quota: parseFloat(typeForm.annual_quota) || 0 }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Request failed"); return; }
      setTypeForm({ name: "", category: "paid", annual_quota: "12" });
      await load();
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error && <div style={{ ...cardStyle, marginBottom: 14, color: "#ef4444", fontSize: 12.5 }}>{error}</div>}
      <section style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
        <div style={{ padding: "12px 12px 10px", borderBottom: `1px solid ${c.line}` }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>Leave types</div>
          <div style={{ fontSize: 12, color: c.muted, marginTop: 3, maxWidth: 780 }}>
            What people can request time off as. The <strong>quota</strong> is how many days a year each
            employee gets. Deactivate a type you no longer offer rather than deleting it — past records
            still refer to it.
          </div>
        </div>
        <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={th}>Name</th><th style={th}>Category</th><th style={th}>Default annual quota</th><th style={th}>Status</th></tr></thead>
          <tbody>
            {types.map((t) => (
              <tr key={t.id}>
                <td style={{ ...td, fontWeight: 600, color: c.ink }}>{t.name}</td>
                <td style={td}>{t.category}</td>
                <td style={td}>{t.annual_quota}</td>
                <td style={td}><Pill label={t.active ? "Active" : "Inactive"} tone={t.active ? "green" : "red"} /></td>
              </tr>
            ))}
            {types.length === 0 && (
              <tr>
                <td style={{ ...td, color: c.hint }} colSpan={4}>
                  No leave types yet. Until one exists, the Request leave button stays disabled for
                  every employee.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div style={{ display: "flex", gap: 10, padding: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: "1 1 140px" }}><label style={lbl}>Name</label><input style={inp} value={typeForm.name} onChange={(e) => setTypeForm({ ...typeForm, name: e.target.value })} placeholder="Paid leave" /></div>
          <div style={{ flex: "0 1 130px" }}>
            <label style={lbl}>Category</label>
            <select style={inp} value={typeForm.category} onChange={(e) => setTypeForm({ ...typeForm, category: e.target.value as LeaveType["category"] })}>
              <option value="paid">Paid</option><option value="unpaid">Unpaid</option><option value="half_day">Half-day</option>
            </select>
          </div>
          <div style={{ flex: "0 1 100px" }}><label style={lbl}>Default quota</label><input style={inp} value={typeForm.annual_quota} onChange={(e) => setTypeForm({ ...typeForm, annual_quota: e.target.value })} /></div>
          <button style={btnPrimary} disabled={busy} onClick={addType}>Add type</button>
        </div>
      </section>
    </>
  );
}
