"use client";

import { useCallback, useRef, useState } from "react";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";

const inp: React.CSSProperties = {
  flex: 1, boxSizing: "border-box", padding: "7px 10px", borderRadius: 7,
  border: `1px solid ${c.line}`, fontSize: 13,
  background: c.panel, color: c.ink, outline: "none", fontFamily: "inherit",
};

function useSavedFlash(): [boolean, () => void] {
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback(() => {
    setSaved(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaved(false), 2000);
  }, []);
  return [saved, flash];
}

function ListEditor({
  title,
  description,
  items,
  onChange,
  placeholder,
}: {
  title: string;
  description: string;
  items: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const v = draft.trim();
    if (!v || items.includes(v)) { setDraft(""); return; }
    onChange([...items, v]);
    setDraft("");
  }

  function remove(idx: number) {
    onChange(items.filter((_, i) => i !== idx));
  }

  function moveUp(idx: number) {
    if (idx === 0) return;
    const n = [...items]; [n[idx - 1], n[idx]] = [n[idx], n[idx - 1]]; onChange(n);
  }

  function moveDown(idx: number) {
    if (idx >= items.length - 1) return;
    const n = [...items]; [n[idx], n[idx + 1]] = [n[idx + 1], n[idx]]; onChange(n);
  }

  return (
    <div style={{ ...cardStyle, padding: "20px 24px", marginBottom: 20 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: c.ink, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13, color: c.muted, marginBottom: 16, lineHeight: 1.6 }}>{description}</div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
        {items.length === 0 && (
          <div style={{ fontSize: 13, color: c.hint, fontStyle: "italic" }}>No values yet — add one below.</div>
        )}
        {items.map((item, idx) => (
          <div key={idx} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              flex: 1, padding: "7px 12px", borderRadius: 7,
              border: `1px solid ${c.line}`, fontSize: 13, color: c.ink, background: c.panel2,
            }}>
              {item}
            </div>
            <button type="button" onClick={() => moveUp(idx)} disabled={idx === 0}
              style={{ background: "none", border: `1px solid ${c.line}`, borderRadius: 5, cursor: "pointer", color: c.muted, fontSize: 12, padding: "4px 7px" }}>↑</button>
            <button type="button" onClick={() => moveDown(idx)} disabled={idx === items.length - 1}
              style={{ background: "none", border: `1px solid ${c.line}`, borderRadius: 5, cursor: "pointer", color: c.muted, fontSize: 12, padding: "4px 7px" }}>↓</button>
            <button type="button" onClick={() => remove(idx)}
              style={{ background: "none", border: "1px solid #fecaca", borderRadius: 5, cursor: "pointer", color: "#dc2626", fontSize: 12, padding: "4px 7px" }}>×</button>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <input
          style={inp}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
        />
        <button type="button" onClick={add}
          style={{ padding: "7px 16px", borderRadius: 7, border: `1px solid ${c.accent}`, background: c.accentbg, color: c.accent, fontWeight: 600, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}>
          + Add
        </button>
      </div>
    </div>
  );
}

export default function SalesConfigClient({
  initialTerritories,
  initialSalesOrgs,
}: {
  initialTerritories: string[];
  initialSalesOrgs: string[];
}) {
  const [territories, setTerritories] = useState<string[]>(initialTerritories);
  const [salesOrgs, setSalesOrgs] = useState<string[]>(initialSalesOrgs);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, flash] = useSavedFlash();

  async function save() {
    setError("");
    setSaving(true);
    try {
      const res = await fetch("/api/settings/sales-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ territories, sales_orgs: salesOrgs }),
      });
      if (res.ok) { flash(); }
      else { const j = await res.json(); setError(j.error ?? "Failed to save"); }
    } catch { setError("Network error"); }
    finally { setSaving(false); }
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <ListEditor
        title="Territories"
        description="Sales territories used across accounts, contacts, quotes and cases. Users pick from this list — no free-typing."
        items={territories}
        onChange={setTerritories}
        placeholder="e.g. West India"
      />

      <ListEditor
        title="Sales organisations"
        description="Sales org codes for your team structure. Drives reporting and assignment."
        items={salesOrgs}
        onChange={setSalesOrgs}
        placeholder="e.g. IN-West"
      />

      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 7, padding: "10px 14px", fontSize: 13, color: "#dc2626", marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          style={{ padding: "9px 22px", borderRadius: 7, border: "none", background: c.accent, color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && <span style={{ fontSize: 13, color: "#10b981", fontWeight: 600 }}>✓ Saved</span>}
      </div>
    </div>
  );
}
