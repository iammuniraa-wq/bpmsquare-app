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
              style={{ background: "none", border: "1px solid var(--err-line)", borderRadius: 5, cursor: "pointer", color: "var(--err-ink)", fontSize: 12, padding: "4px 7px" }}>×</button>
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

type ProductCategoryDef = { name: string; subs: string[] };

// Two-level product category editor (owner decision 2026-08-22: categories
// are tenant config, OOB depth is category -> sub-category, nothing deeper).
function CategoryTreeEditor({
  items,
  onChange,
}: {
  items: ProductCategoryDef[];
  onChange: (next: ProductCategoryDef[]) => void;
}) {
  const [catDraft, setCatDraft] = useState("");
  const [subDrafts, setSubDrafts] = useState<Record<number, string>>({});

  function addCat() {
    const v = catDraft.trim();
    if (!v || items.some((pc) => pc.name === v)) { setCatDraft(""); return; }
    onChange([...items, { name: v, subs: [] }]);
    setCatDraft("");
  }

  function removeCat(idx: number) {
    onChange(items.filter((_, i) => i !== idx));
  }

  function addSub(idx: number) {
    const v = (subDrafts[idx] ?? "").trim();
    if (!v || items[idx].subs.includes(v)) { setSubDrafts((d) => ({ ...d, [idx]: "" })); return; }
    onChange(items.map((pc, i) => (i === idx ? { ...pc, subs: [...pc.subs, v] } : pc)));
    setSubDrafts((d) => ({ ...d, [idx]: "" }));
  }

  function removeSub(idx: number, sub: string) {
    onChange(items.map((pc, i) => (i === idx ? { ...pc, subs: pc.subs.filter((s) => s !== sub) } : pc)));
  }

  return (
    <div style={{ ...cardStyle, padding: "20px 24px", marginBottom: 20 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: c.ink, marginBottom: 6 }}>Product categories</div>
      <div style={{ fontSize: 13, color: c.muted, marginBottom: 16, lineHeight: 1.6 }}>
        Two levels: category and sub-category. Products pick from this tree — while the tree is
        empty, the product form falls back to free-text category entry.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
        {items.length === 0 && (
          <div style={{ fontSize: 13, color: c.hint, fontStyle: "italic" }}>No categories yet — add one below.</div>
        )}
        {items.map((pc, idx) => (
          <div key={idx} style={{ border: `1px solid ${c.line}`, borderRadius: 8, padding: "10px 12px", background: c.panel2 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <div style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: c.ink }}>{pc.name}</div>
              <button type="button" onClick={() => removeCat(idx)}
                style={{ background: "none", border: "1px solid var(--err-line)", borderRadius: 5, cursor: "pointer", color: "var(--err-ink)", fontSize: 12, padding: "4px 7px" }}>×</button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {pc.subs.map((sub) => (
                <span key={sub} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: c.ink, border: `1px solid ${c.line}`, borderRadius: 999, padding: "3px 6px 3px 10px", background: c.panel }}>
                  {sub}
                  <button type="button" onClick={() => removeSub(idx, sub)} aria-label={`Remove ${sub}`}
                    style={{ background: "none", border: "none", cursor: "pointer", color: c.muted, fontSize: 12, padding: 0, lineHeight: 1 }}>×</button>
                </span>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                style={{ ...inp, fontSize: 12.5, padding: "6px 10px" }}
                value={subDrafts[idx] ?? ""}
                onChange={(e) => setSubDrafts((d) => ({ ...d, [idx]: e.target.value }))}
                placeholder={`Sub-category under ${pc.name}…`}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSub(idx); } }}
              />
              <button type="button" onClick={() => addSub(idx)}
                style={{ padding: "6px 12px", borderRadius: 7, border: `1px solid ${c.line}`, background: c.panel, color: c.muted, fontWeight: 600, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
                + Sub
              </button>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <input
          style={inp}
          value={catDraft}
          onChange={(e) => setCatDraft(e.target.value)}
          placeholder="e.g. Elevators"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCat(); } }}
        />
        <button type="button" onClick={addCat}
          style={{ padding: "7px 16px", borderRadius: 7, border: `1px solid ${c.accent}`, background: c.accentbg, color: c.accent, fontWeight: 600, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}>
          + Add category
        </button>
      </div>
    </div>
  );
}

export default function SalesConfigClient({
  initialTerritories,
  initialSalesOrgs,
  initialProductCategories,
}: {
  initialTerritories: string[];
  initialSalesOrgs: string[];
  initialProductCategories: ProductCategoryDef[];
}) {
  const [territories, setTerritories] = useState<string[]>(initialTerritories);
  const [salesOrgs, setSalesOrgs] = useState<string[]>(initialSalesOrgs);
  const [productCategories, setProductCategories] = useState<ProductCategoryDef[]>(initialProductCategories);
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
