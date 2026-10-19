"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import StatusPill from "@/components/ui/StatusPill";
import { Input, Select } from "@/components/ui/Input";
import { ESTIMATE_COMPONENTS, ESTIMATE_COMPONENT_LABEL, type EstimateComponent } from "@/lib/estimator/types";
import { defaultComponentFor } from "@/lib/estimator/productItems";

type Item = {
  id: string; ref: string | null; sku: string | null; name: string; uom: string | null;
  item_type: string | null; item_type_label: string | null; is_kit: boolean;
};

const linkButton: React.CSSProperties = {
  color: "var(--accent)", background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit", fontSize: 12.5,
};

/**
 * Adds a line that survives every recalculation. The default is to pick a product
 * or a BOM / kit from the catalogue (the line is then priced from it: a kit from its
 * components); a free-text line is still possible, one click away.
 */
export default function AddLineForm({ estimateId, groupNames }: { estimateId: string; groupNames: string[] }) {
  const router = useRouter();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  // "catalogue" until we learn the workspace has none, or the person chooses free text.
  const [mode, setMode] = useState<"catalogue" | "free">("catalogue");
  const [available, setAvailable] = useState<boolean | null>(null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Item[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<Item | null>(null);

  const [description, setDescription] = useState("");
  const [group, setGroup] = useState("");
  const [uom, setUom] = useState("");
  const [qty, setQty] = useState("1");
  const [unitCost, setUnitCost] = useState("");
  const [component, setComponent] = useState<EstimateComponent>("other");

  // Look the catalogue up as the person types (and once when the form opens).
  useEffect(() => {
    if (!open || mode !== "catalogue" || picked) return;
    let live = true;
    const timer = setTimeout(() => {
      setSearching(true);
      fetch(`/api/estimates/catalogue?q=${encodeURIComponent(search.trim())}`)
        .then(async (r) => ({ ok: r.ok, json: await r.json().catch(() => ({})) }))
        .then(({ ok, json }) => {
          if (!live) return;
          if (!ok || json.available === false) {
            setAvailable(false);
            setMode("free");
            return;
          }
          setAvailable(true);
          setResults(Array.isArray(json.items) ? json.items : []);
        })
        .catch(() => { if (live) { setAvailable(false); setMode("free"); } })
        .finally(() => { if (live) setSearching(false); });
    }, search ? 250 : 0);
    return () => { live = false; clearTimeout(timer); };
  }, [open, mode, picked, search]);

  function reset() {
    setDescription(""); setGroup(""); setUom(""); setQty("1"); setUnitCost(""); setComponent("other");
    setPicked(null); setSearch(""); setResults([]); setError("");
  }

  function pick(item: Item) {
    setPicked(item);
    setDescription(item.name);
    setUom(item.uom ?? "");
    setComponent(defaultComponentFor(item.item_type));
    setError("");
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "catalogue" && !picked) { setError("Pick a product from the catalogue, or add a free-text line."); return; }
    if (mode === "free" && !description.trim()) { setError("Describe the line."); return; }
    setError("");
    startTransition(async () => {
      const res = await fetch(`/api/estimates/${estimateId}/lines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: description.trim() || undefined, group: group.trim() || undefined, uom: uom.trim() || undefined,
          qty: Number(qty), unit_cost: unitCost.trim() === "" ? undefined : Number(unitCost), component,
          product_id: mode === "catalogue" && picked ? picked.id : undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error ?? "Could not add the line."); return; }
      reset();
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return <div><Button variant="secondary" size="sm" onClick={() => setOpen(true)}>+ Add a line</Button></div>;
  }

  const catalogue = mode === "catalogue";
  return (
    <Card title={catalogue ? "Add an item from the catalogue" : "Add a free-text line"} padding={18}>
      <form onSubmit={submit}>
        {catalogue && !picked && (
          <>
            <Field label="Find a product or kit" hint="Search by name, SKU or reference.">
              <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. hollow-core, PRD-0012, wall panel kit" autoFocus />
            </Field>
            <div role="listbox" aria-label="Catalogue results" style={{ border: `1px solid ${c.line}`, borderRadius: 8, maxHeight: 260, overflowY: "auto", marginBottom: 12 }}>
              {searching && results.length === 0 && <div className="bpm-t-help" style={{ padding: 12 }} role="status">Searching…</div>}
              {!searching && results.length === 0 && (
                <div className="bpm-t-help" style={{ padding: 12 }}>{search.trim() ? "Nothing in the catalogue matches that." : "The catalogue has no active products yet."}</div>
              )}
              {results.map((it) => (
                <button key={it.id} type="button" role="option" aria-selected={false} onClick={() => pick(it)}
                  style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: 0, borderTop: `1px solid ${c.line}`, padding: "9px 12px", cursor: "pointer", font: "inherit", color: c.ink }}>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>{it.name}</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 2, fontSize: 11.5, color: c.hint }}>
                    {it.ref && <span style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>{it.ref}</span>}
                    {it.sku && <span>{it.sku}</span>}
                    {it.uom && <span>per {it.uom}</span>}
                    {it.item_type_label && <StatusPill label={it.item_type_label} tone={it.is_kit ? "purple" : "teal"} />}
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {catalogue && picked && (
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", background: c.panel2, borderRadius: 8, padding: "10px 12px", marginBottom: 12 }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13, color: c.ink }}>{picked.name}</div>
              <div style={{ fontSize: 11.5, color: c.hint }}>
                {[picked.ref, picked.sku, picked.item_type_label].filter(Boolean).join(" · ")}
                {picked.is_kit ? " · priced from its components" : ""}
              </div>
            </div>
            <button type="button" style={linkButton} onClick={() => setPicked(null)}>Change</button>
          </div>
        )}

        {(!catalogue || picked) && (
          <>
            <Field label="Description" required><Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} required /></Field>
            <div className="fg2">
              <Field label="Group" hint="An existing group, or a new name.">
                <Input value={group} onChange={(e) => setGroup(e.target.value)} list={listId} placeholder="Manual items" />
                <datalist id={listId}>{groupNames.map((g) => <option key={g} value={g} />)}</datalist>
              </Field>
              <Field label="Cost component">
                <Select value={component} onChange={(e) => setComponent(e.target.value as EstimateComponent)}>
                  {ESTIMATE_COMPONENTS.map((k) => <option key={k} value={k}>{ESTIMATE_COMPONENT_LABEL[k]}</option>)}
                </Select>
              </Field>
              <Field label="Unit"><Input value={uom} onChange={(e) => setUom(e.target.value)} placeholder="e.g. m3, nr, lot" maxLength={20} /></Field>
              <Field label="Quantity"><Input type="number" step="any" min={0} value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
              <Field
                label="Unit cost"
                hint={catalogue ? "Leave empty to use the catalogue cost (a kit adds up its components)." : "Leave empty if you don't know it yet; the estimate can't be quoted until it has one."}
              >
                <Input type="number" step="any" min={0} value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
              </Field>
            </div>
          </>
        )}

        {error && <div role="alert" className="bpm-t-help" style={{ color: "var(--err-ink)", marginBottom: 10 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
          <div>
            {catalogue
              ? <button type="button" style={linkButton} onClick={() => { setMode("free"); setPicked(null); setError(""); }}>Add a free-text line instead</button>
              : available !== false && <button type="button" style={linkButton} onClick={() => { setMode("catalogue"); setError(""); }}>Pick from the catalogue instead</button>}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="secondary" onClick={() => { reset(); setOpen(false); }} disabled={pending}>Cancel</Button>
            <Button type="submit" variant="primary" loading={pending} disabled={catalogue && !picked}>Add line</Button>
          </div>
        </div>
        {!catalogue && available === false && (
          <p className="bpm-t-help" style={{ margin: "10px 0 0" }}>This workspace has no product catalogue, so lines are free text.</p>
        )}
      </form>
    </Card>
  );
}
