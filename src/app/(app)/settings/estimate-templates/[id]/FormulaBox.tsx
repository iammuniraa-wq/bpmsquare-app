"use client";

import { c } from "@/lib/theme";
import Field from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import type { FormulaResult } from "@/components/estimator/useTemplateCheck";

/** The quantity formula box. Focus it and the editor checks it live and shows its value with the template's defaults. */
export default function FormulaBox({
  value, onChange, onFocus, active, result, loading, id,
}: {
  value: string;
  onChange: (v: string) => void;
  onFocus: () => void;
  active: boolean;
  result: FormulaResult | undefined;
  loading: boolean;
  id: string;
}) {
  const show = active && value.trim() !== "";
  return (
    <Field label="Quantity formula" required htmlFor={id}
      hint={!show ? "Uses inputs, rates, earlier lines (qty_<code>), group subtotals (sub_<group>) and piece totals. Click to check it live." : undefined}>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} onFocus={onFocus} spellCheck={false}
        placeholder="e.g. built_up_area * floors * 0.18" style={{ fontFamily: "ui-monospace, Menlo, monospace" }} invalid={show && !!result && !result.ok} />
      {show && (
        <div aria-live="polite" style={{ marginTop: 6, fontSize: 12.5 }}>
          {loading && !result ? <span style={{ color: c.hint }}>Checking…</span> : null}
          {result && result.ok && result.value !== null && (
            <span style={{ color: c.ink }}>= <strong>{result.value.toLocaleString("en-GB", { maximumFractionDigits: 4 })}</strong> <span style={{ color: c.hint }}>with the default inputs{loading ? " (updating…)" : ""}</span></span>
          )}
          {result && result.ok && result.value === null && result.note && <span style={{ color: c.muted }}>{result.note}</span>}
          {result && !result.ok && (
            <div role="alert" style={{ color: "var(--err-ink)" }}>
              {result.errors.map((e, i) => <div key={i}>{e.message}</div>)}
              {result.unknown.length > 0 && result.errors.length === 0 && <div>Unknown name{result.unknown.length === 1 ? "" : "s"}: {result.unknown.join(", ")}</div>}
            </div>
          )}
        </div>
      )}
    </Field>
  );
}
