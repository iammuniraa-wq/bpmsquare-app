"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { DEFAULT_QUOTE_STATUSES, type QuoteStatusDef } from "@/lib/constants";

// ── Helpers ───────────────────────────────────────────────────────────────────

function useSavedFlash(): [boolean, () => void] {
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback(() => {
    setSaved(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaved(false), 2000);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return [saved, flash];
}

function blankStatus(): QuoteStatusDef {
  return { value: "", label: "", color: "#6366f1" };
}

const inp: React.CSSProperties = {
  width: "100%", boxSizing: "border-box",
  padding: "8px 10px", borderRadius: 7,
  border: `1px solid ${c.line}`, fontSize: 13,
  background: c.panel, color: c.ink, outline: "none", fontFamily: "inherit",
};
const lbl: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: c.hint,
  textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4, display: "block",
};

const PILL_COLORS = [
  "#3b82f6", "#8b5cf6", "#10b981", "#ef4444",
  "#f59e0b", "#0ea5e9", "#ec4899", "#14b8a6",
  "#f97316", "#6366f1", "#84cc16", "#64748b",
];

// ── Component ─────────────────────────────────────────────────────────────────

const ALL_ASSET_FIELDS: { value: string; label: string; example: string }[] = [
  { value: "name",   label: "Equipment name",  example: "75 kW Induction Motor" },
  { value: "kind",   label: "Type",             example: "Motor" },
  { value: "make",   label: "Make / OEM",       example: "Crompton Greaves" },
  { value: "model",  label: "Model / Frame",    example: "ND315S-2" },
  { value: "rating", label: "Rating",           example: "75 kW · 415V" },
  { value: "rpm",    label: "RPM",              example: "1480" },
  { value: "serial", label: "Serial no.",       example: "CG-75-2291" },
  { value: "notes",  label: "Remarks",          example: "Stator rewound 2023" },

  // Motor/generator nameplate fields — see FIELD_REGISTRY.asset (src/lib/fieldRegistry.ts).
  { value: "frame_type",         label: "Frame / Type",         example: "4B 206-02H" },
  { value: "insulation_class",   label: "Insulation class",     example: "F" },
  { value: "connection",         label: "Connection",           example: "Star Connection" },
  { value: "duty",               label: "Duty",                 example: "S1" },
  { value: "ambient_temp",       label: "Ambient temp.",        example: "50°C" },
  { value: "output_kw",          label: "Output (kW)",          example: "2200" },
  { value: "stator_voltage",     label: "Stator voltage",       example: "11000" },
  { value: "stator_current",     label: "Stator current",       example: "133" },
  { value: "excitation_voltage", label: "Excitation voltage",   example: "54" },
  { value: "excitation_current", label: "Excitation current",   example: "295" },
  { value: "frequency",          label: "Frequency",            example: "50" },
];

export default function StatusesClient({ initial, initialAssetFields, assetCustomFields = [] }: {
  initial: QuoteStatusDef[] | null;
  initialAssetFields: string[];
  /** Tenant-defined custom fields for object_type "asset" (Settings -> Custom Fields), merged
   *  into the picker alongside the fixed base Asset columns. */
  assetCustomFields?: { value: string; label: string }[];
}) {
  const [statuses, setStatuses] = useState<QuoteStatusDef[]>(initial ?? DEFAULT_QUOTE_STATUSES);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, flash] = useSavedFlash();

  const allAssetFields = [
    ...ALL_ASSET_FIELDS,
    ...assetCustomFields.map((f) => ({ value: f.value, label: f.label, example: "" })),
  ];

  const [assetFields, setAssetFields] = useState<string[]>(initialAssetFields);
  const [savingFields, setSavingFields] = useState(false);
  const [savedFields, flashFields] = useSavedFlash();

  function toggleAssetField(value: string) {
    setAssetFields((p) => p.includes(value) ? p.filter((f) => f !== value) : [...p, value]);
  }

  async function saveAssetFields() {
    setSavingFields(true);
    const res = await fetch("/api/settings/asset-print-fields", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(assetFields),
    });
    setSavingFields(false);
    if (res.ok) flashFields();
  }

  function update(idx: number, patch: Partial<QuoteStatusDef>) {
    setStatuses((p) => p.map((s, i) => i === idx ? { ...s, ...patch } : s));
  }

  function moveUp(idx: number) {
    if (idx === 0) return;
    setStatuses((p) => { const n = [...p]; [n[idx - 1], n[idx]] = [n[idx], n[idx - 1]]; return n; });
  }
  function moveDown(idx: number) {
    setStatuses((p) => { if (idx >= p.length - 1) return p; const n = [...p]; [n[idx], n[idx + 1]] = [n[idx + 1], n[idx]]; return n; });
  }
  function remove(idx: number) {
    setStatuses((p) => p.filter((_, i) => i !== idx));
  }
  function add() {
    setStatuses((p) => [...p, blankStatus()]);
  }
  function setInitial(idx: number) {
    setStatuses((p) => p.map((s, i) => ({ ...s, is_initial: i === idx })));
  }
  function toggleTerminal(idx: number) {
    setStatuses((p) => p.map((s, i) => i === idx ? { ...s, is_terminal: !s.is_terminal } : s));
  }

  async function save() {
    setError("");
    for (const s of statuses) {
      if (!s.value.trim()) { setError("Every status must have a value (key)."); return; }
      if (!s.label.trim()) { setError("Every status must have a label."); return; }
      if (!/^[a-z0-9_]+$/.test(s.value.trim())) { setError(`Value "${s.value}" must be lowercase letters, numbers, underscores only.`); return; }
    }
    const values = statuses.map((s) => s.value);
    if (new Set(values).size !== values.length) { setError("Status values must be unique."); return; }

    setSaving(true);
    const res = await fetch("/api/settings/quote-statuses", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(statuses),
    });
    setSaving(false);
    if (res.ok) { flash(); }
    else { const j = await res.json(); setError(j.error ?? "Failed to save"); }
  }

  function resetToDefault() {
    setStatuses(DEFAULT_QUOTE_STATUSES);
  }

  return (
    <div style={{ maxWidth: 680 }}>
      <div style={{ ...cardStyle, padding: "20px 24px", marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: c.muted, lineHeight: 1.6 }}>
          Define the pipeline stages for quotations. The <strong>value</strong> (key) is stored in the database — once a quote has that status, renaming the value will break existing records. The <strong>label</strong> is what users see and can be changed freely.
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
        {statuses.map((s, idx) => (
          <div key={idx} style={{ ...cardStyle, padding: "14px 16px", display: "flex", alignItems: "flex-start", gap: 12 }}>
            {/* Colour swatch + picker */}
            <div style={{ paddingTop: 22, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: s.color, border: `2px solid ${c.line}`, position: "relative", cursor: "pointer", flexShrink: 0 }}>
                <input
                  type="color"
                  value={s.color}
                  onChange={(e) => update(idx, { color: e.target.value })}
                  style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" }}
                />
              </div>
              <div style={{ display: "flex", gap: 3, flexWrap: "wrap", width: 60, justifyContent: "center" }}>
                {PILL_COLORS.map((col) => (
                  <div
                    key={col}
                    onClick={() => update(idx, { color: col })}
                    style={{ width: 12, height: 12, borderRadius: 3, background: col, cursor: "pointer", border: s.color === col ? `2px solid ${c.ink}` : `1px solid transparent`, boxSizing: "border-box" }}
                  />
                ))}
              </div>
            </div>

            {/* Fields */}
            <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 12px" }}>
              <div>
                <label style={lbl}>Value (key)</label>
                <input
                  style={inp}
                  placeholder="e.g. po_received"
                  value={s.value}
                  onChange={(e) => update(idx, { value: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })}
                />
              </div>
              <div>
                <label style={lbl}>Label (displayed)</label>
                <input style={inp} placeholder="e.g. PO Received" value={s.label} onChange={(e) => update(idx, { label: e.target.value })} />
              </div>

              {/* Preview pill */}
              <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                <span style={{
                  display: "inline-block", padding: "2px 10px", borderRadius: 12,
                  fontSize: 11.5, fontWeight: 600,
                  background: `${s.color}22`, color: s.color, border: `1px solid ${s.color}55`,
                }}>
                  {s.label || "Preview"}
                </span>

                <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: c.muted, cursor: "pointer" }}>
                  <input type="radio" name="initial_status" checked={!!s.is_initial} onChange={() => setInitial(idx)} style={{ cursor: "pointer" }} />
                  Default (new quotes start here)
                </label>

                <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: c.muted, cursor: "pointer" }}>
                  <input type="checkbox" checked={!!s.is_terminal} onChange={() => toggleTerminal(idx)} style={{ cursor: "pointer" }} />
                  Terminal (locks editing)
                </label>
              </div>
            </div>

            {/* Order + delete */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingTop: 18 }}>
              <button type="button" onClick={() => moveUp(idx)} disabled={idx === 0} style={{ background: "none", border: `1px solid ${c.line}`, borderRadius: 5, cursor: "pointer", color: c.muted, fontSize: 13, lineHeight: 1, padding: "4px 7px" }}>↑</button>
              <button type="button" onClick={() => moveDown(idx)} disabled={idx === statuses.length - 1} style={{ background: "none", border: `1px solid ${c.line}`, borderRadius: 5, cursor: "pointer", color: c.muted, fontSize: 13, lineHeight: 1, padding: "4px 7px" }}>↓</button>
              <button type="button" onClick={() => remove(idx)} style={{ background: "none", border: `1px solid #fecaca`, borderRadius: 5, cursor: "pointer", color: "#dc2626", fontSize: 13, lineHeight: 1, padding: "4px 7px" }}>×</button>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <button type="button" onClick={add} style={{ padding: "8px 16px", borderRadius: 7, border: `1px solid ${c.line}`, background: c.panel, color: c.accent, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
          + Add status
        </button>
        <button type="button" onClick={resetToDefault} style={{ padding: "8px 16px", borderRadius: 7, border: `1px solid ${c.line}`, background: c.panel, color: c.muted, fontSize: 13, cursor: "pointer" }}>
          Reset to defaults
        </button>
      </div>

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
          {saving ? "Saving…" : "Save statuses"}
        </button>
        {saved && <span style={{ fontSize: 13, color: "#10b981", fontWeight: 600 }}>✓ Saved</span>}
      </div>

      {/* ── Asset fields on quote print ───────────────────────────────────── */}
      <div style={{ marginTop: 36, marginBottom: 8, fontSize: 15, fontWeight: 700, color: c.ink }}>
        Equipment details on quote print
      </div>
      <div style={{ ...cardStyle, padding: "20px 24px", marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: c.muted, marginBottom: 16, lineHeight: 1.6 }}>
          Choose which equipment fields appear in the <strong>Equipment Details</strong> section on the printed quote.
          The section is hidden when no fields are selected.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 24px" }}>
          {allAssetFields.map((f) => (
            <label key={f.value} style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", padding: "8px 10px", borderRadius: 8, border: `1px solid ${assetFields.includes(f.value) ? c.accent : c.line}`, background: assetFields.includes(f.value) ? `${c.accent}0d` : c.panel }}>
              <input
                type="checkbox"
                checked={assetFields.includes(f.value)}
                onChange={() => toggleAssetField(f.value)}
                style={{ marginTop: 2, cursor: "pointer", accentColor: c.accent }}
              />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>{f.label}</div>
                {f.example && <div style={{ fontSize: 11, color: c.hint, marginTop: 1 }}>e.g. {f.example}</div>}
              </div>
            </label>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 32 }}>
        <button
          type="button"
          onClick={saveAssetFields}
          disabled={savingFields}
          style={{ padding: "9px 22px", borderRadius: 7, border: "none", background: c.accent, color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
        >
          {savingFields ? "Saving…" : "Save equipment fields"}
        </button>
        {savedFields && <span style={{ fontSize: 13, color: "#10b981", fontWeight: 600 }}>✓ Saved</span>}
      </div>
    </div>
  );
}
