"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import { LINE_FLAG_HELP, LINE_FLAG_LABEL } from "@/lib/estimator/productItems";
import { itemKeyLabel } from "@/lib/estimator/productMatch";
import Button from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import StatusPill from "@/components/ui/StatusPill";
import { useFeel } from "@/components/FeelProvider";
import { useEstimateFocus } from "@/components/estimator/workspace/focus";
import KitComponents from "./KitComponents";
import type { BomLineView } from "./bomView";

export const SOURCE_LABEL: Record<BomLineView["source"], string> = { rule: "Rule", schedule: "Schedule", manual: "Manual" };
const SOURCE_TONE = { rule: "blue", schedule: "teal", manual: "amber" } as const;

const td: React.CSSProperties = { padding: "9px 12px", fontSize: 13, verticalAlign: "middle" };
const numCell: React.CSSProperties = { ...td, textAlign: "right", whiteSpace: "nowrap" };

const fmtQty = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 3 });
const fmtUnit = (n: number | null) => (n === null ? "—" : n.toLocaleString("en-GB", { maximumFractionDigits: 4 }));

/** One BOM line: read-only, or editing quantity and unit cost in place. */
export default function BomRow({
  line, estimateId, editable, money,
}: {
  line: BomLineView;
  estimateId: string;
  editable: boolean;
  money: (n: number) => string;
}) {
  const router = useRouter();
  const focus = useEstimateFocus();
  const { confirm } = useFeel();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [qty, setQty] = useState(String(line.qty));
  const [unit, setUnit] = useState(line.unit_cost === null ? "" : String(line.unit_cost));
  const [error, setError] = useState("");
  const [parts, setParts] = useState(false);

  function begin() { setQty(String(line.qty)); setUnit(line.unit_cost === null ? "" : String(line.unit_cost)); setError(""); setEditing(true); }

  function save() {
    const body: Record<string, unknown> = {};
    if (Number(qty) !== line.qty) body.qty = Number(qty);
    const nextUnit = unit.trim() === "" ? null : Number(unit);
    if (nextUnit !== line.unit_cost) body.unit_cost = nextUnit;
    if (Object.keys(body).length === 0) { setEditing(false); return; }
    setError("");
    startTransition(async () => {
      const res = await fetch(`/api/estimates/${estimateId}/lines/${line.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error ?? "Could not save the line."); return; }
      setEditing(false);
      router.refresh();
    });
  }

  async function remove() {
    if (!(await confirm({ title: `Delete "${line.description}"?`, body: "This manual line will be removed from the estimate.", tone: "danger" }))) return;
    startTransition(async () => {
      const res = await fetch(`/api/estimates/${estimateId}/lines/${line.id}`, { method: "DELETE" });
      if (res.ok) router.refresh();
      else { const j = await res.json().catch(() => ({})); setError(j.error ?? "Could not delete the line."); }
    });
  }

  return (
    <>
      <tr style={{ borderTop: `1px solid ${c.line}` }}>
        <td style={{ ...td, minWidth: 220 }}>
          <div style={{ color: c.ink, fontWeight: 500 }}>{line.description}</div>
          {line.product && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 3, alignItems: "center", fontSize: 12 }}>
              {line.product.linkable
                ? <Link href={ROUTES.product(line.product.id)} style={{ color: "var(--accent)" }}>{line.product.name}</Link>
                : <span style={{ color: c.muted }}>{line.product.name}</span>}
              {line.product.ref && <span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11, color: c.hint }}>{line.product.ref}</span>}
              {line.product.sku && <span style={{ fontSize: 11, color: c.hint }}>{line.product.sku}</span>}
              {line.product.itemTypeLabel && <StatusPill label={line.product.itemTypeLabel} tone={line.product.isKit ? "purple" : "teal"} />}
              {line.product.isKit && (
                <button type="button" onClick={() => setParts((v) => !v)} aria-expanded={parts}
                  style={{ color: "var(--accent)", background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit", fontSize: 11 }}>
                  {parts ? "Hide components" : "Show components"}
                </button>
              )}
            </div>
          )}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 3, alignItems: "center" }}>
            {line.code && <span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11, color: c.hint }}>{line.code}</span>}
            <StatusPill label={SOURCE_LABEL[line.source]} tone={SOURCE_TONE[line.source]} />
            {line.overridden && <StatusPill label="Edited by hand" tone="purple" />}
            {line.flags.map((f) => <span key={f} title={LINE_FLAG_HELP[f]}><StatusPill label={LINE_FLAG_LABEL[f]} tone="red" /></span>)}
            {line.flags.includes("unresolved") && line.sku && <span style={{ fontSize: 11, color: c.hint }}>Looking for {itemKeyLabel(line.sku)}</span>}
            {line.element_ref && <span style={{ fontSize: 11, color: c.hint }}>{line.element_ref}</span>}
            {line.element_ref && line.code && focus && (
              <button type="button" onClick={() => focus.show(line.code as string)}
                style={{ color: "var(--accent)", background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit", fontSize: 11 }}>
                Show in 3D
              </button>
            )}
          </div>
        </td>
        <td style={{ ...td, color: c.muted }}>{line.uom ?? "—"}</td>
        <td style={numCell}>
          {editing
            ? <Input type="number" step="any" min={0} value={qty} onChange={(e) => setQty(e.target.value)} aria-label="Quantity" style={{ width: 100 }} />
            : fmtQty(line.qty)}
        </td>
        <td style={numCell}>
          {editing
            ? <Input type="number" step="any" min={0} value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="Unit cost" style={{ width: 110 }} />
            : fmtUnit(line.unit_cost)}
        </td>
        <td style={{ ...numCell, fontWeight: 600 }}>{line.cost_total === null ? "—" : money(line.cost_total)}</td>
        {editable && (
          <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
            {editing ? (
              <span style={{ display: "inline-flex", gap: 6 }}>
                <Button size="sm" variant="primary" loading={pending} onClick={save}>Save</Button>
                <Button size="sm" variant="secondary" disabled={pending} onClick={() => setEditing(false)}>Cancel</Button>
              </span>
            ) : (
              <span style={{ display: "inline-flex", gap: 6 }}>
                <Button size="sm" variant="quiet" onClick={begin}>Edit</Button>
                {line.source === "manual" && <Button size="sm" variant="quiet" disabled={pending} onClick={remove}>Delete</Button>}
              </span>
            )}
          </td>
        )}
      </tr>
      {parts && line.product && (
        <tr>
          <td colSpan={editable ? 6 : 5} style={{ ...td, paddingTop: 0 }}>
            <KitComponents estimateId={estimateId} lineId={line.id} unit={line.uom} linkable={line.product.linkable} productId={line.product.id} money={money} />
          </td>
        </tr>
      )}
      {error && (
        <tr><td colSpan={editable ? 6 : 5} style={{ ...td, paddingTop: 0 }}><div role="alert" className="bpm-t-help" style={{ color: "var(--err-ink)" }}>{error}</div></td></tr>
      )}
    </>
  );
}
