"use client";

import { useState } from "react";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Button from "@/components/ui/Button";
import StatusPill from "@/components/ui/StatusPill";
import { RecordList, RecordRow } from "@/components/settings/RecordRows";
import { SettingsHeaderActions, SettingsSave } from "@/components/settings/SettingsHeaderActions";
import { useSettingsDirty } from "@/components/settings/useSettingsDirty";
import { typeLabel } from "@/lib/typeScale";
import type { ResolvedItemType } from "@/lib/products/itemTypes";

const inp: React.CSSProperties = { width: "100%", padding: "8px 11px", fontSize: 13, border: `1px solid ${c.line}`, borderRadius: 8, background: c.panel, color: c.ink, outline: "none", boxSizing: "border-box" };
const lbl: React.CSSProperties = { ...typeLabel, display: "block", marginBottom: 5 };

const FLAGS = [["stocked", "Stocked"], ["sellable", "Sellable"], ["purchasable", "Purchasable"], ["can_have_components", "Has components"]] as const;
const EDITABLE_FLAGS = ["stocked", "sellable", "purchasable"] as const;

const slug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
const BLANK = { label: "", description: "", stocked: false, sellable: false, purchasable: false };

/** What the server stores: renames and hides of the built-ins, plus the custom types. */
function toPayload(rows: ResolvedItemType[]) {
  return {
    labels: Object.fromEntries(rows.filter((r) => r.isDefault).map((r) => [r.key, r.label])),
    hidden: rows.filter((r) => r.hidden).map((r) => r.key),
    custom: rows.filter((r) => !r.isDefault).map((r) => ({
      key: r.key, label: r.label, description: r.description, stocked: r.stocked, sellable: r.sellable, purchasable: r.purchasable,
    })),
  };
}

export default function ItemTypesClient({ initial, usage }: { initial: ResolvedItemType[]; usage: Record<string, number> }) {
  const [rows, setRows] = useState(initial);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const payload = toPayload(rows);
  const { dirty, markSaved } = useSettingsDirty(payload);

  const patch = (key: string, p: Partial<ResolvedItemType>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));

  function addType() {
    const label = draft.label.trim();
    const key = slug(label);
    if (!label || key.length < 2) { setError("Give the item type a name"); return; }
    if (rows.some((r) => r.key === key || r.label.toLowerCase() === label.toLowerCase())) { setError("An item type with that name already exists"); return; }
    setRows((rs) => [...rs, { ...draft, key, label, description: draft.description.trim(), can_have_components: false, isDefault: false, hidden: false }]);
    setDraft(BLANK);
    setAdding(false);
    setError("");
  }

  async function save() {
    setSaving(true); setError("");
    try {
      const res = await fetch("/api/settings/item-types", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ item_types: payload }) });
      if (res.ok) { markSaved(); setSaved(true); } else setError((await res.json().catch(() => ({}))).error ?? "Failed to save");
    } catch { setError("Network error"); } finally { setSaving(false); }
  }

  return (
    <div style={{ maxWidth: 820 }}>
      <SettingsHeaderActions><Button onClick={() => { setAdding(true); setEditKey(null); }}>+ New item type</Button></SettingsHeaderActions>
      <SettingsSave dirty={dirty} saving={saving} saved={saved} error={error} onSave={save} />

      <div className="bpm-t-help" style={{ marginBottom: 12 }}>
        Each product can have one item type. <strong>Only BOM / kit items can have components</strong>, and that
        stays true for any type you add. Hiding a type keeps it on the products that already have it.
      </div>

      {adding && (
        <div style={{ ...cardStyle, marginBottom: 14, background: c.panel2 }}>
          <div className="bpm-t-section" style={{ marginBottom: 10 }}>New item type</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ flex: "1 1 180px" }}><label style={lbl}>Name</label><input style={inp} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="Packaging" /></div>
            <div style={{ flex: "2 1 240px" }}><label style={lbl}>What it means</label><input style={inp} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Cartons, pallets and wrap" /></div>
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", margin: "12px 0" }}>
            {FLAGS.filter(([f]) => f !== "can_have_components").map(([f, name]) => (
              <label key={f} style={{ fontSize: 13, display: "inline-flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={draft[f as (typeof EDITABLE_FLAGS)[number]]} onChange={(e) => setDraft({ ...draft, [f]: e.target.checked })} /> {name}
              </label>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6 }}><Button variant="primary" onClick={addType}>Add item type</Button><Button onClick={() => { setAdding(false); setError(""); }}>Cancel</Button></div>
        </div>
      )}

      <RecordList>
        {rows.map((r) => {
          const n = usage[r.key] ?? 0;
          return (
            <RecordRow
              key={r.key}
              title={r.label}
              subtitle={r.description || undefined}
              dim={r.hidden}
              status={r.hidden ? <StatusPill label="Hidden" tone="amber" /> : r.isDefault ? undefined : <StatusPill label="Custom" tone="blue" />}
              facts={[
                { label: "Flags", value: FLAGS.filter(([f]) => r[f]).map(([, name]) => name).join(", ") || "none" },
                { label: "Products", value: n },
              ]}
              menu={[
                { label: "Rename", onSelect: () => { setEditKey(r.key); setAdding(false); } },
                { label: r.hidden ? "Show" : "Hide", onSelect: () => patch(r.key, { hidden: !r.hidden }) },
                { label: "Remove", danger: true, hidden: r.isDefault || n > 0, onSelect: () => setRows((rs) => rs.filter((x) => x.key !== r.key)) },
              ]}
            >
              {editKey === r.key && (
                <div style={{ padding: 14, background: c.panel2, borderTop: `1px solid ${c.line}`, display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 220px" }}><label style={lbl}>Name</label><input style={inp} value={r.label} onChange={(e) => patch(r.key, { label: e.target.value })} autoFocus /></div>
                  <Button onClick={() => setEditKey(null)}>Done</Button>
                </div>
              )}
            </RecordRow>
          );
        })}
      </RecordList>
    </div>
  );
}
