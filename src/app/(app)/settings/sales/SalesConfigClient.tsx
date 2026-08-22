"use client";

import { useCallback, useRef, useState } from "react";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { deriveCode, type PicklistItem, type ProductCategoryNode } from "@/lib/picklists";

// Every picklist value is { code, name } (owner decision 2026-08-22): the
// code is what records store and integrations match on — stable, shown as a
// mono chip, auto-derived from the name but editable until the value is
// saved; the name is the display label and stays freely renameable.

const inp: React.CSSProperties = {
  flex: 1, boxSizing: "border-box", padding: "7px 10px", borderRadius: 7,
  border: `1px solid ${c.line}`, fontSize: 13,
  background: c.panel, color: c.ink, outline: "none", fontFamily: "inherit",
};
const codeInp: React.CSSProperties = {
  ...inp, flex: "0 0 150px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 12, textTransform: "uppercase",
};
const codeChip: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 10.5,
  color: c.muted, background: c.panel, border: `1px solid ${c.line}`,
  borderRadius: 5, padding: "2px 7px", whiteSpace: "nowrap",
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

function AddRow({ placeholder, onAdd }: { placeholder: string; onAdd: (item: PicklistItem) => void }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);

  function add() {
    const n = name.trim();
    if (!n) return;
    onAdd({ code: deriveCode(codeTouched && code.trim() ? code : n), name: n });
    setName(""); setCode(""); setCodeTouched(false);
  }

  return (
    <div style={{ display: "flex", gap: 8 }}>
      <input
        style={inp}
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          if (!codeTouched) setCode(deriveCode(e.target.value));
        }}
        placeholder={placeholder}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
      />
      <input
        style={codeInp}
        value={code}
        onChange={(e) => { setCodeTouched(true); setCode(e.target.value); }}
        placeholder="CODE"
        title="Stable code — what records store and integrations match on. Auto-derived from the name; edit before adding if your ERP uses a different code."
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
      />
      <button type="button" onClick={add}
        style={{ padding: "7px 16px", borderRadius: 7, border: `1px solid ${c.accent}`, background: c.accentbg, color: c.accent, fontWeight: 600, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}>
        + Add
      </button>
    </div>
  );
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
  items: PicklistItem[];
  onChange: (next: PicklistItem[]) => void;
  placeholder: string;
}) {
  function add(item: PicklistItem) {
    if (!item.code || items.some((i) => i.code === item.code)) return;
    onChange([...items, item]);
  }

  function rename(idx: number, name: string) {
    onChange(items.map((it, i) => (i === idx ? { ...it, name } : it)));
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
          <div key={item.code} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={codeChip}>{item.code}</span>
            <input
              style={{ ...inp, background: c.panel2 }}
              value={item.name}
              onChange={(e) => rename(idx, e.target.value)}
              title="Display name — renaming never affects stored records; the code stays."
            />
            <button type="button" onClick={() => moveUp(idx)} disabled={idx === 0}
              style={{ background: "none", border: `1px solid ${c.line}`, borderRadius: 5, cursor: "pointer", color: c.muted, fontSize: 12, padding: "4px 7px" }}>↑</button>
            <button type="button" onClick={() => moveDown(idx)} disabled={idx === items.length - 1}
              style={{ background: "none", border: `1px solid ${c.line}`, borderRadius: 5, cursor: "pointer", color: c.muted, fontSize: 12, padding: "4px 7px" }}>↓</button>
            <button type="button" onClick={() => remove(idx)}
              style={{ background: "none", border: "1px solid var(--err-line)", borderRadius: 5, cursor: "pointer", color: "var(--err-ink)", fontSize: 12, padding: "4px 7px" }}>×</button>
          </div>
        ))}
      </div>

      <AddRow placeholder={placeholder} onAdd={add} />
    </div>
  );
}

// Two-level product category editor. Same code+name contract on both levels.
function CategoryTreeEditor({
  items,
  onChange,
}: {
  items: ProductCategoryNode[];
  onChange: (next: ProductCategoryNode[]) => void;
}) {
  function addCat(item: PicklistItem) {
    if (!item.code || items.some((pc) => pc.code === item.code)) return;
    onChange([...items, { ...item, subs: [] }]);
  }

  function renameCat(idx: number, name: string) {
    onChange(items.map((pc, i) => (i === idx ? { ...pc, name } : pc)));
  }

  function removeCat(idx: number) {
    onChange(items.filter((_, i) => i !== idx));
  }

  function addSub(idx: number, item: PicklistItem) {
    if (!item.code || items[idx].subs.some((s) => s.code === item.code)) return;
    onChange(items.map((pc, i) => (i === idx ? { ...pc, subs: [...pc.subs, item] } : pc)));
  }

  function removeSub(idx: number, code: string) {
    onChange(items.map((pc, i) => (i === idx ? { ...pc, subs: pc.subs.filter((s) => s.code !== code) } : pc)));
  }

  return (
    <div style={{ ...cardStyle, padding: "20px 24px", marginBottom: 20 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: c.ink, marginBottom: 6 }}>Product categories</div>
      <div style={{ fontSize: 13, color: c.muted, marginBottom: 16, lineHeight: 1.6 }}>
        Two levels: category and sub-category. Products store the code; screens show the name.
        While the tree is empty, the product form falls back to free-text entry.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
        {items.length === 0 && (
          <div style={{ fontSize: 13, color: c.hint, fontStyle: "italic" }}>No categories yet — add one below.</div>
        )}
        {items.map((pc, idx) => (
          <div key={pc.code} style={{ border: `1px solid ${c.line}`, borderRadius: 8, padding: "10px 12px", background: c.panel2 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={codeChip}>{pc.code}</span>
              <input
                style={{ ...inp, fontWeight: 600, fontSize: 13.5 }}
                value={pc.name}
                onChange={(e) => renameCat(idx, e.target.value)}
                title="Display name — renaming never affects stored records; the code stays."
              />
              <button type="button" onClick={() => removeCat(idx)}
                style={{ background: "none", border: "1px solid var(--err-line)", borderRadius: 5, cursor: "pointer", color: "var(--err-ink)", fontSize: 12, padding: "4px 7px" }}>×</button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {pc.subs.map((sub) => (
                <span key={sub.code} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: c.ink, border: `1px solid ${c.line}`, borderRadius: 999, padding: "3px 6px 3px 10px", background: c.panel }}>
                  {sub.name}
                  <span style={{ ...codeChip, padding: "1px 5px", fontSize: 9.5 }}>{sub.code}</span>
                  <button type="button" onClick={() => removeSub(idx, sub.code)} aria-label={`Remove ${sub.name}`}
                    style={{ background: "none", border: "none", cursor: "pointer", color: c.muted, fontSize: 12, padding: 0, lineHeight: 1 }}>×</button>
                </span>
              ))}
            </div>
            <AddRow placeholder={`Sub-category under ${pc.name}…`} onAdd={(item) => addSub(idx, item)} />
          </div>
        ))}
      </div>

      <AddRow placeholder="e.g. Elevators" onAdd={addCat} />
    </div>
  );
}

export default function SalesConfigClient({
  initialTerritories,
  initialSalesOrgs,
  initialProductCategories,
}: {
  initialTerritories: PicklistItem[];
  initialSalesOrgs: PicklistItem[];
  initialProductCategories: ProductCategoryNode[];
}) {
  const [territories, setTerritories] = useState<PicklistItem[]>(initialTerritories);
  const [salesOrgs, setSalesOrgs] = useState<PicklistItem[]>(initialSalesOrgs);
  const [productCategories, setProductCategories] = useState<ProductCategoryNode[]>(initialProductCategories);
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
        body: JSON.stringify({ territories, sales_orgs: salesOrgs, product_categories: productCategories }),
      });
      if (res.ok) { flash(); }
      else { const j = await res.json(); setError(j.error ?? "Failed to save"); }
    } catch { setError("Network error"); }
    finally { setSaving(false); }
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ fontSize: 12, color: c.hint, marginBottom: 16, lineHeight: 1.6 }}>
        Each value has a stable <strong>code</strong> (stored on records, used by integrations)
        and a display <strong>name</strong> (rename any time — records are unaffected).
        Match codes to your ERP&apos;s keys where an ERP is connected.
      </div>

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

      <CategoryTreeEditor items={productCategories} onChange={setProductCategories} />

      {error && (
        <div style={{ background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 7, padding: "10px 14px", fontSize: 13, color: "var(--err-ink)", marginBottom: 12 }}>
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
